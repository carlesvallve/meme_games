import * as THREE from 'three';
import { Character } from './Character';
import type { CharacterType } from './characters';
import type { Terrain } from './Terrain';
import type { InputState } from './Input';
import type { PlayerParams } from '../store';
import { audioSystem } from '../utils/AudioSystem';

export class Player extends Character {
  constructor(scene: THREE.Scene, terrain: Terrain, type: CharacterType, position: THREE.Vector3) {
    super(scene, terrain, type, position);
  }

  update(dt: number, inputState: InputState, cameraAngleY: number, params: PlayerParams): void {
    // Camera-relative movement
    let mx = 0;
    let mz = 0;

    if (inputState.forward) { mx -= Math.sin(cameraAngleY); mz -= Math.cos(cameraAngleY); }
    if (inputState.backward) { mx += Math.sin(cameraAngleY); mz += Math.cos(cameraAngleY); }
    if (inputState.left) { mx -= Math.cos(cameraAngleY); mz += Math.sin(cameraAngleY); }
    if (inputState.right) { mx += Math.cos(cameraAngleY); mz -= Math.sin(cameraAngleY); }

    const moveLen = Math.sqrt(mx * mx + mz * mz);
    if (moveLen > 0.001) {
      mx /= moveLen;
      mz /= moveLen;

      this.move(mx, mz, params.speed, params.stepHeight, params.capsuleRadius, dt, params.slopeHeight);

      // Hop + step SFX (respects foot sound cooldown)
      const currentHopHalf = this.applyHop(params.hopHeight);
      if (currentHopHalf !== this.lastHopHalf && this.footSfxTimer >= 0.12) {
        this.lastHopHalf = currentHopHalf;
        this.footSfxTimer = 0;
        audioSystem.sfx('step');
      }
    } else {
      this.updateIdle(dt);
    }

    this.updateTorch(dt);
  }

  getCameraTarget(): { x: number; y: number; z: number } {
    return {
      x: this.mesh.position.x,
      y: this.visualGroundY + 0.5,
      z: this.mesh.position.z,
    };
  }
}
