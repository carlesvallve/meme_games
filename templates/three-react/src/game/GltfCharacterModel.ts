import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { MeshPartGroup, CharacterModelOpts } from './CharacterModel';
const BASE_MOVE_SPEED = 2;

/**
 * GltfCharacterModel — loads self-contained glTF files with embedded animations.
 * Drop-in replacement for CharacterModel when using pre-retargeted glTF models
 * (e.g. from the /Downloads/glTF/ library).
 *
 * Each glTF contains mesh + skeleton + all animation clips in one file.
 * No shared animation loading needed — everything is self-contained.
 */
export class GltfCharacterModel {
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
  private footBones: THREE.Bone[] = [];
  private meshMap = new Map<string, THREE.Object3D>();
  partGroups: MeshPartGroup[] = [];
  private groundPinEnabled = true;

  constructor(opts: CharacterModelOpts) {
    this.group = new THREE.Group();
    this.scale = opts.scale ?? 1;
    this.offsetY = opts.offsetY ?? 0;

    const loader = new GLTFLoader();
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

      // Collect mesh nodes + fix material colors.
      // These glTF models store baseColorFactor in linear space but with values
      // that appear to have been double-linearized (sRGB values stored as linear).
      // Apply sRGB→linear decode to recover intended brightness.
      const namedMeshNodes = new Map<string, THREE.Object3D>();
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          // Fix double-linearized colors: convert from sRGB to linear to undo the extra gamma
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) {
            if ((mat as THREE.MeshStandardMaterial).color) {
              const c = (mat as THREE.MeshStandardMaterial).color;
              c.convertLinearToSRGB();
            }
          }
          const node = mesh.parent && mesh.parent !== model ? mesh.parent : mesh;
          if (!namedMeshNodes.has(node.name)) {
            namedMeshNodes.set(node.name, node);
          }
        }
      });
      for (const [name, node] of namedMeshNodes) {
        this.meshMap.set(name, node);
      }

      this.buildPartGroups();
      this.group.add(model);
      this.modelRoot = model;

      // Find foot bones for ground-pinning (these models use Foot.L / Foot.R / Toe.L / Toe.R)
      const footPatterns = ['foot', 'toe'];
      model.traverse((child) => {
        if ((child as THREE.Bone).isBone) {
          const lower = child.name.toLowerCase();
          if (footPatterns.some(p => lower.includes(p))) {
            this.footBones.push(child as THREE.Bone);
          }
        }
      });

      this.computeRestPoseOffset(model);
      this.mixer = new THREE.AnimationMixer(model);

      // Register embedded animations
      for (const clip of gltf.animations) {
        const action = this.mixer.clipAction(clip);
        this.actions.set(clip.name, action);
      }

      console.log(`[GltfCharModel] Loaded: ${gltf.animations.length} anims, ${namedMeshNodes.size} mesh nodes, ${this.footBones.length} foot bones`);

      this.meshReady = true;
      opts.onMeshReady?.();

      this.loaded = true;
      const allNames = ['T-Pose', ...Array.from(this.actions.keys())];
      const idleAnim = allNames.find((n) => /idle/i.test(n)) ?? allNames[1];
      if (idleAnim) this.play(idleAnim, 0);
      opts.onLoaded?.(allNames);
    });
  }

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
    }
  }

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

  private buildPartGroups(): void {
    const names = Array.from(this.meshMap.keys());
    // These models typically have a single mesh, so just list it
    this.partGroups = [];
    if (names.length > 0) {
      for (const name of names) {
        const mesh = this.meshMap.get(name);
        if (mesh) mesh.visible = true;
      }
      this.partGroups.push({ name: 'Body', variants: names, active: 0 });
    }
  }

  setPartVariant(groupName: string, variantIndex: number): void {
    const group = this.partGroups.find(g => g.name === groupName);
    if (!group) return;
    for (let i = 0; i < group.variants.length; i++) {
      const mesh = this.meshMap.get(group.variants[i]);
      if (mesh) mesh.visible = i === variantIndex;
    }
    group.active = variantIndex;
  }

  randomizeParts(): void {
    // Single-mesh models — nothing to randomize
  }

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
    let materialName = '(none)';
    const mat = hitMesh.material;
    if (Array.isArray(mat)) materialName = mat.map(m => m.name || '?').join(', ');
    else if (mat) materialName = (mat as THREE.Material).name || '(unnamed)';
    return {
      groupName: 'Body',
      variantName: hitMesh.name || '(mesh)',
      point: hits[0].point,
      meshName: hitMesh.name,
      materialName,
      vertCount,
    };
  }

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

  toggleNodeByUuid(uuid: string): void {
    if (!this.modelRoot) return;
    this.modelRoot.traverse((node) => {
      if (node.uuid === uuid) node.visible = !node.visible;
    });
  }

  setGroundPin(enabled: boolean): void {
    if (this.groundPinEnabled && !enabled && this.modelRoot) {
      // Reset to base offset when disabling
      this.modelRoot.position.y = this.offsetY;
    }
    this.groundPinEnabled = enabled;
  }

  isMeshReady(): boolean { return this.meshReady; }
  isLoaded(): boolean { return this.loaded; }
  getAnimationNames(): string[] { return Array.from(this.actions.keys()); }

  play(name: string, fadeTime = 0.2): boolean {
    if (name === this.currentClipName && this.currentAction) return true;
    if (name === 'T-Pose') {
      if (this.currentAction) this.currentAction.fadeOut(fadeTime);
      this.currentAction = null;
      this.currentClipName = 'T-Pose';
      return true;
    }
    const action = this.actions.get(name);
    if (!action) return false;
    if (this.currentAction) this.currentAction.fadeOut(fadeTime);
    action.reset().fadeIn(fadeTime).play();
    this.currentAction = action;
    this.currentClipName = name;
    return true;
  }

  getCurrentClip(): string { return this.currentClipName; }

  setTimeScale(moveSpeed: number): void {
    if (!this.currentAction) return;
    this.currentAction.timeScale = moveSpeed / BASE_MOVE_SPEED;
  }

  setRawTimeScale(scale: number): void {
    if (!this.currentAction) return;
    this.currentAction.timeScale = scale;
  }

  getAnimProgress(): { time: number; duration: number } | null {
    if (!this.currentAction) return null;
    const clip = this.currentAction.getClip();
    return { time: this.currentAction.time, duration: clip.duration };
  }

  update(dt: number): void {
    if (!this.mixer) return;
    this.mixer.update(dt);
    // Ground-pin feet
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
