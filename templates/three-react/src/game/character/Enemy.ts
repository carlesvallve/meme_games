import * as THREE from 'three';
import { Character } from './Character';
import type { Terrain } from '../Terrain';
import type { NavGrid } from '../NavGrid';
import type { LadderDef } from '../Ladder';
import type { VoxCharEntry } from './VoxCharacterDB';
import { getFilteredEnemies, getArchetype, getMonsterStats, randomInRange } from './VoxCharacterDB';
import { ChaseBehavior } from '../behaviors/ChaseBehavior';
import { Roaming } from '../behaviors/Roaming';
import type { BehaviorContext } from '../behaviors/Behavior';
import type { CharacterType } from './characters';
import { useGameStore, type EnemyParams } from '../../store';

/** How long an enemy keeps chasing after losing sight of the player */
const CHASE_MEMORY = 2.0;

export class Enemy extends Character {
  private chaseBehavior: ChaseBehavior | null = null;
  private roamBehavior: Roaming | null = null;
  private isChasing = false;
  private chaseMemoryTimer = 0;

  /** Base movement speed (before status effects like slow). */
  baseSpeed = 1.0;
  /** Stamina (reserved for future use). */
  mp = 0;
  maxMp = 0;

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

    // Override character params with enemy-specific values from the store
    Object.assign(this.params, {
      hopHeight: 0.03,
      chaseRange: ep.chaseRange * 0.25,
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

    // Apply random enemy VOX skin (filtered by allowed types)
    const pool = getFilteredEnemies(ep.allowedTypes);
    const entry = pool[Math.floor(Math.random() * pool.length)];
    this.applyVoxSkin(entry);

    // Apply per-monster stats based on archetype
    const stats = getMonsterStats(getArchetype(entry.name));
    this.hp = this.maxHp = Math.round(randomInRange(stats.hp));
    this.mp = this.maxMp = Math.round(randomInRange(stats.mp));
    this.params.attackDamage = Math.floor(randomInRange(stats.damage));
    this.params.attackCooldown = 1 / randomInRange(stats.atkSpeed);
    this.params.speed = randomInRange(stats.movSpeed);
    this.baseSpeed = this.params.speed;
    this.critChance = stats.critChance;
    this.armour = stats.armour;
  }

  /** Initialize chase behavior — call after construction */
  initChaseBehavior(navGrid: NavGrid, ladderDefs: ReadonlyArray<LadderDef>, isDungeon = false): void {
    const ctx: BehaviorContext = { navGrid, ladderDefs };
    // In dungeons, chase range is infinite — chasing is controlled by flood-fill visibility
    const behaviorChaseRange = isDungeon ? Infinity : this.params.chaseRange;
    this.chaseBehavior = new ChaseBehavior(
      ctx,
      this.params,
      this.params.attackReach,
      this.params.attackCooldown,
      behaviorChaseRange,
    );
    this.roamBehavior = new Roaming(ctx, this.params, {
      radiusMin: 2,
      radiusMax: 5,
      idleMin: 2,
      idleMax: 5,
    });
    this.behavior = this.roamBehavior;
  }

  /** Set the chase target each frame */
  setChaseTarget(target: Character | null, dt: number): void {
    if (!this.chaseBehavior) return;
    if (target) {
      this.chaseBehavior.setTarget(target, target.isAlive);
      this.chaseMemoryTimer = CHASE_MEMORY;
      if (!this.isChasing) {
        this.isChasing = true;
        this.behavior = this.chaseBehavior;
      }
    } else if (this.isChasing) {
      // Lost sight — keep chasing on memory timer
      this.chaseMemoryTimer -= dt;
      if (this.chaseMemoryTimer <= 0) {
        this.isChasing = false;
        this.behavior = this.roamBehavior!;
      }
    }
  }

  /** Check if this enemy is currently in chase mode (active chase or memory timer) */
  isCurrentlyChasing(): boolean {
    return this.isChasing;
  }

  /** Check if the chase behavior is in attack state (wants to attack) */
  wantsToAttack(): boolean {
    return this.chaseBehavior?.getState() === 'attack';
  }

  /** Set confusion state on chase and roam behaviors */
  setConfused(active: boolean): void {
    if (this.chaseBehavior) this.chaseBehavior.confusionActive = active;
    if (this.roamBehavior) this.roamBehavior.confusionActive = active;
  }

  override updateTorch(_dt: number): void {
    // No-op: enemies don't have torches
  }

  override dispose(): void {
    super.dispose();
  }
}
