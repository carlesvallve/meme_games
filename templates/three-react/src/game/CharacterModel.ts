import * as THREE from 'three';
import { ANIM_SETS } from './CharacterModelDefs';
import { createGLTFLoader } from './loaders';

const BASE_MOVE_SPEED = 5;

/** Global cache: animation GLB URL → promise of parsed clips. Shared across all characters. */
const animClipCache = new Map<string, Promise<THREE.AnimationClip[]>>();

/** Root bone name — only this bone keeps position tracks. */
const ROOT_BONE = 'LowManHips';

/** Strip position/scale tracks from non-root bones.
 *  The Blender bake writes loc/rot/scale for ALL bones, but only the root
 *  should move in world space. Other bones need rotation only — their positions
 *  come from the mesh skeleton's rest pose. */
function cleanupClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  clip.tracks = clip.tracks.filter((track) => {
    const dotIdx = track.name.lastIndexOf('.');
    const boneName = track.name.slice(0, dotIdx);
    const prop = track.name.slice(dotIdx + 1);
    if (boneName === ROOT_BONE) return true; // keep all root tracks
    if (prop === 'quaternion') return true;   // keep all rotations
    return false; // strip position/scale from non-root bones
  });
  return clip;
}

function loadAnimClips(url: string): Promise<THREE.AnimationClip[]> {
  let cached = animClipCache.get(url);
  if (cached) return cached;
  const loader = createGLTFLoader();
  cached = new Promise<THREE.AnimationClip[]>((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        const clips = gltf.animations.map(cleanupClip);
        console.log(`[AnimCache] Loaded ${clips.length} clips from ${url}`);
        resolve(clips);
      },
      undefined,
      reject,
    );
  });
  animClipCache.set(url, cached);
  return cached;
}

/** Mesh part groups — each group shows one variant at a time. */
export interface MeshPartGroup {
  name: string;
  variants: string[];
  active: number; // index into variants (-1 = none visible)
}

export interface CharacterModelOpts {
  meshUrl: string;
  scale?: number;
  /** Y offset for the model root (e.g. to align feet with ground) */
  offsetY?: number;
  /** Rotation in degrees [x, y, z] applied to the model root (e.g. [-90,0,0] for Z-up FBX) */
  rotation?: [number, number, number];
  /** Called when mesh is ready (model visible, before animations load) */
  onMeshReady?: () => void;
  /** Called when model + animations finish loading */
  onLoaded?: (animNames: string[]) => void;
}

/**
 * CharacterModel — loads a mesh-only GLB, then shared animation GLBs.
 * Manages animation mixer, crossfade transitions, and time scaling.
 * Designed to be attached to CharacterController.root as a child.
 */
export class CharacterModel {
  readonly group: THREE.Group;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private currentAction: THREE.AnimationAction | null = null;
  private currentClipName = '';
  private loaded = false;
  private meshReady = false;
  private scale: number;
  private offsetY: number;
  private modelRoot: THREE.Object3D | null = null;
  /** Foot bones used for ground-pinning each frame */
  private footBones: THREE.Bone[] = [];
  /** Named mesh nodes in the GLB, keyed by name (may be Object3D parent of mesh primitives) */
  private meshMap = new Map<string, THREE.Object3D>();
  /** Mesh part groups for toggling variants */
  partGroups: MeshPartGroup[] = [];
  private groundPinEnabled = true;

  constructor(opts: CharacterModelOpts) {
    this.group = new THREE.Group();
    this.scale = opts.scale ?? 1;
    this.offsetY = opts.offsetY ?? 0;

    // Phase 1: Load mesh GLB
    const loader = createGLTFLoader();
    loader.load(opts.meshUrl, (gltf) => {
      const model = gltf.scene;
      model.scale.setScalar(this.scale);
      model.position.y = this.offsetY;

      if (opts.rotation) {
        const [rx, ry, rz] = opts.rotation;
        model.rotation.set(
          rx * Math.PI / 180,
          ry * Math.PI / 180,
          rz * Math.PI / 180,
        );
      }

      // GLTFLoader may nest: Node("Head 1 Male Bald") → Mesh("Untitled.002")
      // or primitives: Node("Helmet 1 Assault") → Mesh("Untitled.014") + Mesh("Untitled.014_1") + ...
      // We want to control visibility at the NODE level, not individual primitive meshes.
      // Collect top-level named nodes that contain mesh children.
      const namedMeshNodes = new Map<string, THREE.Object3D>();
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          // Find the named parent node (the GLTF node with the human-readable name)
          const node = mesh.parent && mesh.parent !== model ? mesh.parent : mesh;
          if (!namedMeshNodes.has(node.name)) {
            namedMeshNodes.set(node.name, node);
          }
        }
      });
      // Store nodes (not individual mesh primitives) for part toggling
      for (const [name, node] of namedMeshNodes) {
        this.meshMap.set(name, node as THREE.Mesh);
      }
      console.log(`[CharacterModel] Mesh nodes: ${Array.from(namedMeshNodes.keys()).join(', ')}`);

      // Build part groups and hide overlapping variants
      this.buildPartGroups();

      this.group.add(model);
      this.modelRoot = model;

      // Find foot/toe bones for ground-pinning
      const footNames = ['LowManLeftToeBase', 'LowManRightToeBase', 'LowManLeftFoot', 'LowManRightFoot'];
      model.traverse((child) => {
        if ((child as THREE.Bone).isBone) {
          if (footNames.includes(child.name)) this.footBones.push(child as THREE.Bone);
        }
      });

      // Compute T-pose ground offset so feet sit at Y=0
      this.computeRestPoseOffset(model);

      this.mixer = new THREE.AnimationMixer(model);

      console.log(`[CharacterModel] Mesh parts: ${Array.from(this.meshMap.keys()).join(', ')}`);
      console.log(`[CharacterModel] Part groups: ${this.partGroups.map(g => `${g.name}(${g.variants.length})`).join(', ')}`);

      // Mesh is visible immediately — don't wait for animations
      this.meshReady = true;
      opts.onMeshReady?.();

      console.log(`[CharacterModel] Mesh loaded, loading shared animations...`);

      // Phase 2: Load shared animation GLBs
      this.loadSharedAnimations(opts);
    });
  }

  /** Load shared animation GLBs. */
  private loadSharedAnimations(opts: CharacterModelOpts): void {
    if (ANIM_SETS.length === 0) {
      this.finishLoading(opts);
      return;
    }

    // Load each set independently — don't let one failure kill everything
    const promises = ANIM_SETS.map((set) =>
      loadAnimClips(set.url)
        .then((clips) => {
          for (const clip of clips) {
            // Prefix clip name with set id for group/anim dropdowns: "Idles/Idle01"
            const groupedName = `${set.id}/${clip.name}`;
            if (!this.actions.has(groupedName) && this.mixer) {
              const action = this.mixer.clipAction(clip);
              this.actions.set(groupedName, action);
            }
          }
          // Debug: dump first clip's track names to compare with mesh bones
          if (clips.length > 0) {
            const trackNames = clips[0].tracks.slice(0, 10).map(t => t.name);
            console.log(`[CharacterModel] Anim "${set.id}" first clip "${clips[0].name}" tracks:`, trackNames);
          }
          console.log(`[CharacterModel] Loaded anim set "${set.id}": ${clips.length} clips`);
        })
        .catch((err) => {
          console.warn(`[CharacterModel] Failed to load anim set "${set.id}":`, err);
        })
    );

    Promise.allSettled(promises).then(() => {
      this.finishLoading(opts);
    });
  }

  /** Mark as loaded, play default idle, fire callback. */
  private finishLoading(opts: CharacterModelOpts): void {
    this.loaded = true;
    const allNames = ['T-Pose', ...Array.from(this.actions.keys())];
    console.log(`[CharacterModel] Ready: ${allNames.length - 1} total animations`);
    const idleAnim = allNames.find((n) => /idle/i.test(n)) ?? allNames[1];
    if (idleAnim) this.play(idleAnim, 0);
    opts.onLoaded?.(allNames);
  }

  /** Compute ground offset from T-pose so feet sit at Y=0 in group space. */
  private computeRestPoseOffset(model: THREE.Object3D): void {
    this.group.updateMatrixWorld(true);
    const groupY = this.group.getWorldPosition(new THREE.Vector3()).y;

    let minY = Infinity;
    const bonePos = new THREE.Vector3();
    model.traverse((child) => {
      if ((child as THREE.Bone).isBone) {
        child.getWorldPosition(bonePos);
        if (bonePos.y < minY) minY = bonePos.y;
      }
    });

    if (minY < Infinity) {
      const correction = minY - groupY;
      this.offsetY -= correction;
      model.position.y = this.offsetY;
      console.log(`[CharacterModel] T-pose ground offset: ${correction.toFixed(4)}, offsetY: ${this.offsetY.toFixed(4)}`);
    }
  }

  /** Get the lowest foot bone Y in group-local space. */
  private getLowestFootY(): number {
    if (this.footBones.length === 0) return 0;
    const invGroup = this.group.matrixWorld.clone().invert();
    const pos = new THREE.Vector3();
    let minY = Infinity;
    for (const bone of this.footBones) {
      bone.getWorldPosition(pos);
      pos.applyMatrix4(invGroup);
      if (pos.y < minY) minY = pos.y;
    }
    return minY < Infinity ? minY : 0;
  }

  /** Build part groups from mesh names. Groups meshes by keyword prefix. */
  private buildPartGroups(): void {
    const names = Array.from(this.meshMap.keys());
    const groups = new Map<string, string[]>();

    // Group by category keyword
    for (const name of names) {
      const lower = name.toLowerCase();
      let group = 'Other';
      if (lower.includes('helmet')) group = 'Helmet';
      else if (lower.includes('head') || lower.includes('hair') || lower.includes('bald')) group = 'Head';
      else if (lower.includes('torso') || lower.includes('sleeve')) group = 'Torso';
      else if (lower.includes('legs') || lower.includes('pants')) group = 'Legs';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(name);
    }

    this.partGroups = [];
    for (const [groupName, variants] of groups) {
      // For helmet group, add a "None" option (index -1) and default to no helmet
      const defaultIdx = groupName === 'Helmet' ? -1 : 0;
      for (let i = 0; i < variants.length; i++) {
        const mesh = this.meshMap.get(variants[i]);
        if (mesh) mesh.visible = defaultIdx >= 0 && i === defaultIdx;
      }
      this.partGroups.push({ name: groupName, variants, active: defaultIdx });
    }
  }

  /** Set which variant is active in a part group (-1 = none visible). */
  setPartVariant(groupName: string, variantIndex: number): void {
    const group = this.partGroups.find(g => g.name === groupName);
    if (!group) return;
    for (let i = 0; i < group.variants.length; i++) {
      const mesh = this.meshMap.get(group.variants[i]);
      if (mesh) mesh.visible = i === variantIndex;
    }
    group.active = variantIndex;
  }

  /** Randomize all part groups — pick a random variant for each.
   *  For groups with multiple variants (helmet, torso, legs), pick randomly.
   *  For single-variant groups (head), always show it. */
  randomizeParts(): void {
    for (const group of this.partGroups) {
      if (group.variants.length <= 1) {
        // Single variant — always show
        this.setPartVariant(group.name, 0);
      } else if (group.name === 'Helmet') {
        // Helmets: 50% chance of no helmet, otherwise random
        const idx = Math.random() < 0.5 ? -1 : Math.floor(Math.random() * group.variants.length);
        this.setPartVariant(group.name, idx);
      } else {
        const idx = Math.floor(Math.random() * group.variants.length);
        this.setPartVariant(group.name, idx);
      }
    }
  }

  /** Raycast against character meshes. Returns part info including material details. */
  pickMesh(raycaster: THREE.Raycaster): {
    groupName: string; variantName: string; point: THREE.Vector3;
    meshName: string; materialName: string; vertCount: number;
  } | null {
    if (!this.modelRoot) return null;
    const allMeshes: THREE.Mesh[] = [];
    this.modelRoot.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && child.visible) {
        allMeshes.push(child as THREE.Mesh);
      }
    });
    const hits = raycaster.intersectObjects(allMeshes, false);
    if (hits.length === 0) return null;

    const hitMesh = hits[0].object as THREE.Mesh;
    const vertCount = hitMesh.geometry.getAttribute('position')?.count ?? 0;

    // Get material name
    let materialName = '(none)';
    const mat = hitMesh.material;
    if (Array.isArray(mat)) {
      materialName = mat.map(m => m.name || '?').join(', ');
    } else if (mat) {
      materialName = (mat as THREE.Material).name || '(unnamed)';
    }

    // Walk up to find the named node that's in our meshMap
    let node: THREE.Object3D | null = hitMesh;
    let foundName = '';
    while (node && node !== this.modelRoot) {
      for (const [name, obj] of this.meshMap) {
        if (obj === node) { foundName = name; break; }
      }
      if (foundName) break;
      node = node.parent;
    }
    if (!foundName) foundName = hitMesh.parent?.name || hitMesh.name || '(unknown)';

    // Find which group this belongs to
    let groupName = '';
    for (const g of this.partGroups) {
      if (g.variants.includes(foundName)) { groupName = g.name; break; }
    }

    return {
      groupName: groupName || 'Unknown', variantName: foundName, point: hits[0].point,
      meshName: hitMesh.name, materialName, vertCount,
    };
  }

  /** Build a flat hierarchy list of all mesh nodes for the UI panel. */
  getHierarchy(): { uuid: string; name: string; type: string; visible: boolean; vertCount: number; materialName: string; depth: number; childCount: number }[] {
    if (!this.modelRoot) return [];
    const result: { uuid: string; name: string; type: string; visible: boolean; vertCount: number; materialName: string; depth: number; childCount: number }[] = [];
    const walk = (node: THREE.Object3D, depth: number) => {
      const isMesh = (node as THREE.Mesh).isMesh;
      const isBone = (node as THREE.Bone).isBone;
      if (isBone) return;
      let vertCount = 0;
      let materialName = '';
      if (isMesh) {
        const mesh = node as THREE.Mesh;
        vertCount = mesh.geometry.getAttribute('position')?.count ?? 0;
        const mat = mesh.material;
        if (Array.isArray(mat)) materialName = mat.map(m => m.name || '?').join(', ');
        else if (mat) materialName = (mat as THREE.Material).name || '';
      }
      const nonBoneChildren = node.children.filter(c => !(c as THREE.Bone).isBone);
      const hasMeshDescendant = isMesh || nonBoneChildren.length > 0;
      if (hasMeshDescendant) {
        result.push({
          uuid: node.uuid,
          name: node.name || '(unnamed)',
          type: isMesh ? 'Mesh' : 'Node',
          visible: node.visible,
          vertCount, materialName, depth,
          childCount: nonBoneChildren.length,
        });
      }
      for (const child of nonBoneChildren) walk(child, depth + 1);
    };
    walk(this.modelRoot, 0);
    return result;
  }

  /** Toggle visibility of a node by UUID. */
  toggleNodeByUuid(uuid: string): void {
    if (!this.modelRoot) return;
    this.modelRoot.traverse((node) => {
      if (node.uuid === uuid) {
        node.visible = !node.visible;
      }
    });
  }

  setGroundPin(enabled: boolean): void {
    if (this.groundPinEnabled && !enabled && this.modelRoot) {
      this.modelRoot.position.y = this.offsetY;
    }
    this.groundPinEnabled = enabled;
  }

  isMeshReady(): boolean {
    return this.meshReady;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  getAnimationNames(): string[] {
    return Array.from(this.actions.keys());
  }

  /** Play an animation clip by name with crossfade. Use "T-Pose" to stop all animations. */
  play(name: string, fadeTime = 0.2): boolean {
    if (name === this.currentClipName && this.currentAction) return true;

    // Special: stop all actions and show rest pose
    if (name === 'T-Pose') {
      if (this.currentAction) {
        this.currentAction.fadeOut(fadeTime);
      }
      this.currentAction = null;
      this.currentClipName = 'T-Pose';
      return true;
    }

    const action = this.actions.get(name);
    if (!action) return false;

    if (this.currentAction) {
      this.currentAction.fadeOut(fadeTime);
    }
    action.reset().fadeIn(fadeTime).play();
    this.currentAction = action;
    this.currentClipName = name;
    return true;
  }

  /** Get the currently playing clip name. */
  getCurrentClip(): string {
    return this.currentClipName;
  }

  /** Set the timeScale of the current action (for speed-synced walk/run). */
  setTimeScale(moveSpeed: number): void {
    if (!this.currentAction) return;
    this.currentAction.timeScale = moveSpeed / BASE_MOVE_SPEED;
  }

  /** Set the timeScale directly (for animation preview). */
  setRawTimeScale(scale: number): void {
    if (!this.currentAction) return;
    this.currentAction.timeScale = scale;
  }

  /** Get the current animation time and duration for hop sync. */
  getAnimProgress(): { time: number; duration: number } | null {
    if (!this.currentAction) return null;
    const clip = this.currentAction.getClip();
    return { time: this.currentAction.time, duration: clip.duration };
  }

  /** Advance the animation mixer + ground-pin feet. Call every frame. */
  update(dt: number): void {
    if (!this.mixer) return;
    this.mixer.update(dt);

    // Ground-pin: keep lowest foot at Y=0 in group-local space.
    if (this.groundPinEnabled && this.footBones.length > 0 && this.modelRoot) {
      this.modelRoot.position.y = this.offsetY;
      this.group.updateMatrixWorld(true);
      const footY = this.getLowestFootY();
      this.modelRoot.position.y = this.offsetY - footY;
    }
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else (mat as THREE.Material).dispose();
      }
    });
  }
}
