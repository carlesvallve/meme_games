import * as THREE from 'three';
import { Character } from './Character';
import type { Terrain } from './Terrain';
import type { NavGrid } from './NavGrid';
import type { LadderDef } from './Ladder';
import type { VoxCharEntry } from './VoxCharacterDB';
import { VOX_ENEMIES } from './VoxCharacterDB';
import { ChaseBehavior } from './behaviors/ChaseBehavior';
import type { CharacterType } from './characters';

export class Enemy extends Character {
  private chaseBehavior: ChaseBehavior | null = null;

  constructor(
    scene: THREE.Scene,
    terrain: Terrain,
    navGrid: NavGrid,
    position: THREE.Vector3,
    ladderDefs: ReadonlyArray<LadderDef> = [],
  ) {
    super(scene, terrain, navGrid, 'slot0' as CharacterType, position, ladderDefs, true);

    this.isEnemy = true;
    this.hp = 4;
    this.maxHp = 4;

    // Override only what differs from DEFAULT_CHARACTER_PARAMS (from CharacterParams via super)
    Object.assign(this.params, {
      speed: 0.5 + Math.random() * 1,
      hopHeight: 0.03,
      attackCooldown: 1.2,
      chaseRange: 8,
      knockbackSpeed: 2,
      invulnDuration: 0.5,
      stunDuration: 0.15,
    });

    // Remove torch lights (enemies don't carry torches)
    this.torchLight.intensity = 0;
    this.fillLight.intensity = 0;
    scene.remove(this.torchLight);
    scene.remove(this.fillLight);

    // Apply random enemy VOX skin
    const entry = VOX_ENEMIES[Math.floor(Math.random() * VOX_ENEMIES.length)];
    this.applyVoxSkin(entry);
  }

  /** Initialize chase behavior — call after construction */
  initChaseBehavior(navGrid: NavGrid, ladderDefs: ReadonlyArray<LadderDef>): void {
    this.chaseBehavior = new ChaseBehavior(
      { navGrid, ladderDefs },
      this.params,
      this.params.attackReach,
      this.params.attackCooldown,
      this.params.chaseRange,
    );
    this.behavior = this.chaseBehavior;
  }

  /** Set the chase target each frame */
  setChaseTarget(target: Character | null): void {
    if (this.chaseBehavior && target) {
      this.chaseBehavior.setTarget(target, target.isAlive);
    }
  }

  /** Check if the chase behavior is in attack state (wants to attack) */
  wantsToAttack(): boolean {
    return this.chaseBehavior?.getState() === 'attack';
  }

  override updateTorch(_dt: number): void {
    // No-op: enemies don't have torches
  }

  override dispose(): void {
    super.dispose();
  }
}
