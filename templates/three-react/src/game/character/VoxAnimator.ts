import * as THREE from 'three';
import { loadVoxCharacter } from '../../utils/VoxModelLoader';
import type { VoxCharacterData } from '../../utils/VoxModelLoader';
import type { VoxCharEntry, StepMode } from './VoxCharacterDB';
import { audioSystem } from '../../utils/AudioSystem';
import type { FootIK } from './FootIK';
import { VOX_FPS, FOOT_SFX_COOLDOWN, type MovementParams } from './CharacterSettings';

/** Owner interface — fields the animator reads/writes on the character. */
export interface VoxAnimOwner {
  mesh: THREE.Mesh;
  isEnemy: boolean;
  groundY: number;
  footSfxTimer: number;
  params: MovementParams;
  /** Multiplier for walk animation FPS and hop frequency (1.0 = default rhythm). */
  animSpeedScale: number;
}

export class VoxAnimator {
  voxEntry: VoxCharEntry | null = null;
  private voxData: VoxCharacterData | null = null;
  private voxAnimState: 'idle' | 'walk' | 'action' = 'idle';
  private voxFrameIndex = 0;
  private voxFrameTimer = 0;
  private voxLoaded = false;

  getStepMode(): StepMode {
    return this.voxEntry?.stepMode ?? 'walker';
  }

  getVoxAnimState(): string {
    return this.voxAnimState;
  }

  getVoxFrameIndex(): number {
    return this.voxFrameIndex;
  }

  getActionFrameCount(): number {
    return this.voxData?.frames['action']?.length ?? 0;
  }

  async applySkin(owner: VoxAnimOwner, entry: VoxCharEntry, footIK: FootIK): Promise<void> {
    this.voxEntry = entry;
    if (this.voxData) {
      this.voxData.base.dispose();
      for (const frames of Object.values(this.voxData.frames)) {
        for (const geo of frames) {
          if (geo && geo !== this.voxData.base) geo.dispose();
        }
      }
      this.voxData = null;
      this.voxLoaded = false;
      footIK.clear();
    }

    try {
      const data = await loadVoxCharacter(entry.folderPath, entry.prefix);
      this.voxData = data;
      this.voxLoaded = true;
      this.voxAnimState = 'idle';
      this.voxFrameIndex = 0;
      this.voxFrameTimer = 0;
      owner.mesh.geometry.dispose();
      owner.mesh.geometry = data.base;
      // console.log(`[Character] VOX skin applied: '${entry.name}' (${entry.category})`);
      footIK.build(data);
    } catch (err) {
      console.error(`[Character] Failed to apply VOX skin '${entry.name}':`, err);
    }
  }

  update(owner: VoxAnimOwner, dt: number, isMoving: boolean, footIK: FootIK): void {
    if (!this.voxData || !this.voxLoaded) return;

    // Action animation: let it finish then revert
    if (this.voxAnimState === 'action') {
      const frames = this.voxData.frames['action'];
      if (!frames || frames.length === 0) {
        this.voxAnimState = isMoving ? 'walk' : 'idle';
      } else {
        const fps = VOX_FPS['action'] ?? 9;
        this.voxFrameTimer += dt;
        if (this.voxFrameTimer >= 1 / fps) {
          this.voxFrameTimer -= 1 / fps;
          this.voxFrameIndex++;
          if (this.voxFrameIndex >= frames.length) {
            this.voxAnimState = isMoving ? 'walk' : 'idle';
            this.voxFrameIndex = 0;
            this.voxFrameTimer = 0;
          } else {
            const newGeo = frames[this.voxFrameIndex];
            if (newGeo && newGeo !== owner.mesh.geometry) {
              owner.mesh.geometry = newGeo;
            }
          }
        }
        if (owner.params.footIKEnabled) footIK.apply(owner.mesh, owner.groundY);
        return;
      }
    }

    const newState = isMoving ? 'walk' : 'idle';
    if (newState !== this.voxAnimState) {
      this.voxAnimState = newState;
      this.voxFrameIndex = 0;
      this.voxFrameTimer = 0;
      const firstFrames = this.voxData.frames[newState];
      if (firstFrames.length > 0 && firstFrames[0] && firstFrames[0] !== owner.mesh.geometry) {
        owner.mesh.geometry = firstFrames[0];
      }
    }

    const frames = this.voxData.frames[this.voxAnimState];
    if (frames.length === 0) return;

    const baseFps = VOX_FPS[this.voxAnimState] ?? 4;
    // Scale walk animation speed with movement speed (idle/action stay at base rate)
    const fps = this.voxAnimState === 'walk' ? baseFps * owner.animSpeedScale : baseFps;
    this.voxFrameTimer += dt;

    if (this.voxFrameTimer >= 1 / fps) {
      this.voxFrameTimer -= 1 / fps;
      this.voxFrameIndex = (this.voxFrameIndex + 1) % frames.length;
      const newGeo = frames[this.voxFrameIndex];
      if (newGeo && newGeo !== owner.mesh.geometry) {
        owner.mesh.geometry = newGeo;
      }
      // Jumper step SFX on last walk frame
      const stepMode = this.getStepMode();
      if (this.voxAnimState === 'walk' && stepMode === 'jumper' && owner.footSfxTimer >= FOOT_SFX_COOLDOWN) {
        const lastWalkFrame = frames.length > 0 ? frames.length - 1 : 0;
        if (this.voxFrameIndex === lastWalkFrame) {
          const vol = owner.isEnemy ? 0.35 : 0.7;
          audioSystem.sfxAt('step', owner.mesh.position.x, owner.mesh.position.z, vol);
          owner.footSfxTimer = 0;
        }
      }
    }
    if (owner.params.footIKEnabled) footIK.apply(owner.mesh, owner.groundY);
  }

  playAction(owner: VoxAnimOwner): void {
    if (!this.voxData || !this.voxLoaded) return;
    this.voxAnimState = 'action';
    this.voxFrameIndex = 0;
    this.voxFrameTimer = 0;
    const frames = this.voxData.frames['action'];
    if (frames && frames.length > 0 && frames[0]) {
      owner.mesh.geometry = frames[0];
    }
  }
}
