import * as THREE from 'three';
import { Character } from './Character';
import type { Terrain } from '../Terrain';
import type { NavGrid } from '../NavGrid';
import type { LadderDef } from '../Ladder';
import type { VoxCharEntry } from './VoxCharacterDB';
import { VOX_ENEMIES } from './VoxCharacterDB';
import { ChaseBehavior } from '../behaviors/ChaseBehavior';
import type { CharacterType } from './characters';
import { useGameStore, type EnemyParams } from '../../store';

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

    const ep = useGameStore.getState().enemyParams;
    this.isEnemy = true;
    this.hp = ep.hp;
    this.maxHp = ep.hp;

    // Override character params with enemy-specific values from the store
    Object.assign(this.params, {
      speed: ep.speed[0] + Math.random() * (ep.speed[1] - ep.speed[0]),
      hopHeight: 0.03,
      attackDamage: Math.floor(Math.random() * 4) + 1,
      attackCooldown: ep.attackCooldown,
      chaseRange: ep.chaseRange,
      invulnDuration: ep.invulnDuration,
      stunDuration: ep.stunDuration,
      melee: { ...ep.melee },
      ranged: { ...ep.ranged },
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
