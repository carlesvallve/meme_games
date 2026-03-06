import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { NavGrid } from './pathfinding/NavGrid';
import { findPath } from './pathfinding/AStar';

const TURN_SPEED = 12;
const WAYPOINT_THRESHOLD = 0.3;

// Hop: synced to footstep — 2 steps per cycle (one per foot)
const HOP_HEIGHT = 0.06;

// Base movement speed for animation timeScale reference
const BASE_MOVE_SPEED = 5;

type AnimState = 'idle' | 'move' | 'preview';

export class KaykitCharacter {
  readonly root: THREE.Group;
  private navGrid: NavGrid;
  private facingAngle = 0;
  private path: { x: number; z: number }[] = [];
  private pathIndex = 0;
  private moveSpeed = 0;

  // Animation
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Map<string, THREE.AnimationAction> = new Map();
  private currentAction: THREE.AnimationAction | null = null;
  private currentClipName = '';
  private animState: AnimState = 'idle';
  private loaded = false;

  // Hop
  private hopEnabled = true;
  private hopPhase = 0;

  // Store-driven preview
  private previewClip = '';
  private previewSpeed = 1;

  /** Called when model finishes loading — passes animation name list */
  onAnimationsLoaded: ((names: string[]) => void) | null = null;

  constructor(navGrid: NavGrid) {
    this.navGrid = navGrid;
    this.root = new THREE.Group();

    const loader = new GLTFLoader();
    loader.load('/models/kaykit/Knight.glb', (gltf) => {
      const model = gltf.scene;
      model.scale.setScalar(0.5);
      // Randomize one attachment per hand slot, hide the rest
      const LEFT_SLOT = ['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield'];
      const RIGHT_SLOT = ['1H_Sword', '2H_Sword'];
      const pickLeft = LEFT_SLOT[Math.floor(Math.random() * LEFT_SLOT.length)];
      const pickRight = RIGHT_SLOT[Math.floor(Math.random() * RIGHT_SLOT.length)];
      const allAttachments = new Set([...LEFT_SLOT, ...RIGHT_SLOT]);

      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
        if (allAttachments.has(child.name)) {
          child.visible = (child.name === pickLeft || child.name === pickRight);
        }
      });
      this.root.add(model);

      this.mixer = new THREE.AnimationMixer(model);
      const names: string[] = [];
      for (const clip of gltf.animations) {
        const action = this.mixer.clipAction(clip);
        this.actions.set(clip.name, action);
        names.push(clip.name);
      }

      this.playAnim('Idle');
      this.loaded = true;
      this.onAnimationsLoaded?.(names);
    });
  }

  private playAnim(name: string, fadeTime = 0.2): void {
    if (name === this.currentClipName && this.currentAction) return;
    const action = this.actions.get(name);
    if (!action) return;

    if (this.currentAction) {
      this.currentAction.fadeOut(fadeTime);
    }
    action.reset().fadeIn(fadeTime).play();
    this.currentAction = action;
    this.currentClipName = name;
  }

  private setAnimState(state: AnimState, speed: number): void {
    if (state === this.animState && state !== 'preview') {
      this.syncTimeScale(speed);
      return;
    }
    this.animState = state;
    switch (state) {
      case 'idle':
        this.playAnim('Idle');
        break;
      case 'move':
        this.playAnim('Running_B');
        this.syncTimeScale(speed);
        break;
      case 'preview':
        break;
    }
  }

  private syncTimeScale(moveSpeed: number): void {
    if (!this.currentAction) return;
    this.currentAction.timeScale = moveSpeed / BASE_MOVE_SPEED;
  }

  /** Called from Game.ts each frame with store values */
  setPreview(clipName: string, speed: number, hop: boolean): void {
    this.hopEnabled = hop;
    this.previewSpeed = speed;

    if (clipName !== this.previewClip) {
      this.previewClip = clipName;
      // If character is idle (not moving via WASD/pathfind), show preview
      if (this.moveSpeed === 0 && this.path.length === 0) {
        this.animState = 'preview';
        this.playAnim(clipName);
        if (this.currentAction) {
          this.currentAction.timeScale = speed;
        }
      }
    }

    // Update timeScale for preview while idle
    if (this.animState === 'preview' && this.currentAction) {
      this.currentAction.timeScale = speed;
    }
  }

  /** Camera-relative WASD movement. Cancels any active A* path. */
  moveDirectional(dx: number, dz: number, cameraAngleY: number, dt: number, speed: number): void {
    if (dx === 0 && dz === 0) {
      if (this.moveSpeed > 0 && this.path.length === 0) {
        this.moveSpeed = 0;
        // Return to preview or idle
        if (this.previewClip && this.previewClip !== 'Idle') {
          this.animState = 'preview';
          this.playAnim(this.previewClip);
          if (this.currentAction) this.currentAction.timeScale = this.previewSpeed;
        } else {
          this.setAnimState('idle', 0);
        }
      }
      return;
    }

    // Cancel A* path
    this.path.length = 0;

    // Rotate input by camera Y angle
    const cos = Math.cos(cameraAngleY);
    const sin = Math.sin(cameraAngleY);
    const worldX = dx * cos + dz * sin;
    const worldZ = -dx * sin + dz * cos;

    const len = Math.sqrt(worldX * worldX + worldZ * worldZ);
    const nx = worldX / len;
    const nz = worldZ / len;

    this.moveSpeed = speed;
    const pos = this.root.position;
    pos.x += nx * speed * dt;
    pos.z += nz * speed * dt;

    // Clamp to navGrid bounds
    const half = this.navGrid.getHalfSize();
    pos.x = Math.max(-half, Math.min(half, pos.x));
    pos.z = Math.max(-half, Math.min(half, pos.z));

    // Smooth facing
    const targetAngle = Math.atan2(nx, nz);
    this.facingAngle = lerpAngle(this.facingAngle, targetAngle, 1 - Math.exp(-TURN_SPEED * dt));
    this.root.rotation.y = this.facingAngle;

    this.setAnimState('move', speed);
  }

  /** Click-to-move: find A* path and follow it. */
  goTo(worldX: number, worldZ: number, speed: number): boolean {
    const pos = this.root.position;
    const result = findPath(this.navGrid, pos.x, pos.z, worldX, worldZ);
    if (!result.found || result.path.length < 2) return false;
    this.path = result.path;
    this.pathIndex = 1;
    this.moveSpeed = speed;
    this.setAnimState('move', speed);
    return true;
  }

  /** Advance path following + animation. Call every frame. */
  update(dt: number, speed: number): void {
    // Follow A* path
    if (this.path.length > 0 && this.pathIndex < this.path.length) {
      const target = this.path[this.pathIndex];
      const pos = this.root.position;
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < WAYPOINT_THRESHOLD) {
        this.pathIndex++;
        if (this.pathIndex >= this.path.length) {
          this.path.length = 0;
          this.moveSpeed = 0;
          if (this.previewClip && this.previewClip !== 'Idle') {
            this.animState = 'preview';
            this.playAnim(this.previewClip);
            if (this.currentAction) this.currentAction.timeScale = this.previewSpeed;
          } else {
            this.setAnimState('idle', 0);
          }
        }
      } else {
        const step = Math.min(speed * dt, dist);
        pos.x += (dx / dist) * step;
        pos.z += (dz / dist) * step;

        const targetAngle = Math.atan2(dx / dist, dz / dist);
        this.facingAngle = lerpAngle(this.facingAngle, targetAngle, 1 - Math.exp(-TURN_SPEED * dt));
        this.root.rotation.y = this.facingAngle;

        this.moveSpeed = speed;
        this.syncTimeScale(speed);
      }
    }

    // Hop animation — synced to walk/run animation time
    if (this.hopEnabled && this.currentAction && this.animState === 'move') {
      const time = this.currentAction.time;
      const duration = this.currentAction.getClip().duration;
      if (duration > 0) {
        this.hopPhase = (time / duration) * Math.PI * 2 * 2;
        const hop = Math.abs(Math.sin(this.hopPhase)) * HOP_HEIGHT;
        this.root.position.y = hop;
      }
    } else if (this.hopEnabled && this.animState === 'preview' && this.currentAction) {
      const name = this.currentClipName;
      if (name.startsWith('Walking') || name.startsWith('Running')) {
        const time = this.currentAction.time;
        const duration = this.currentAction.getClip().duration;
        if (duration > 0) {
          this.hopPhase = (time / duration) * Math.PI * 2 * 2;
          const hop = Math.abs(Math.sin(this.hopPhase)) * HOP_HEIGHT;
          this.root.position.y = hop;
        }
      } else {
        this.root.position.y = 0;
      }
    } else {
      this.root.position.y = 0;
    }

    // Update animation mixer
    if (this.mixer) {
      this.mixer.update(dt);
    }
  }

  getPosition(): THREE.Vector3 {
    return this.root.position;
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.root.traverse((child) => {
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

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
