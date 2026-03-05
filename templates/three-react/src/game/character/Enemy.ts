import * as THREE from 'three';
import { Character } from './Character';
import type { Environment } from '../environment';
import type { NavGrid } from '../pathfinding';
import type { LadderDef } from '../dungeon';
import type { VoxCharEntry } from './VoxCharacterDB';
import {
  getFilteredEnemies,
  getMonsterStats,
  randomInRange,
} from './VoxCharacterDB';
import { getFloorConfig } from '../dungeon';
import { ChaseBehavior } from '../behaviors/ChaseBehavior';
import { Roaming } from '../behaviors/Roaming';
import { FleeBehavior } from '../behaviors/FleeBehavior';
import type { BehaviorContext } from '../behaviors/Behavior';
import type { CharacterType } from './characters';
import { useGameStore, type EnemyParams } from '../../store';

/** How long an enemy keeps chasing after losing sight of the player */
const CHASE_MEMORY = 2.0;

/** HP ratio thresholds for flee/recover behavior. */
const FLEE_THRESHOLD = 0.3;
const RECOVER_THRESHOLD = 0.6;

export class Enemy extends Character {
  private chaseBehavior: ChaseBehavior | null = null;
  private roamBehavior: Roaming | null = null;
  private fleeBehavior: FleeBehavior | null = null;
  private isChasing = false;
  private isFleeing = false;
  private chaseMemoryTimer = 0;

  /** Base movement speed (before status effects like slow). */
  baseSpeed = 1.0;
  /** Stamina (reserved for future use). */
  mp = 0;
  maxMp = 0;

  constructor(
    scene: THREE.Scene,
    terrain: Environment,
    navGrid: NavGrid,
    position: THREE.Vector3,
    ladderDefs: ReadonlyArray<LadderDef> = [],
    /** Pre-selected entry — if provided, skip random pool selection */
    preselectedEntry?: VoxCharEntry,
  ) {
    super(
      scene,
      terrain,
      navGrid,
      'slot0' as CharacterType,
      position,
      ladderDefs,
      true,
    );

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

    // Apply enemy VOX skin: use preselected entry or pick from filtered pool
    const entry =
      preselectedEntry ??
      (() => {
        const pool = getFilteredEnemies(ep.allowedTypes);
        return pool[Math.floor(Math.random() * pool.length)];
      })();
    this.applyVoxSkin(entry);

    // Apply per-monster stats based on archetype, scaled by floor multipliers
    const stats = getMonsterStats(entry.name);
    const floorCfg = getFloorConfig(useGameStore.getState().floor);
    this.hp = this.maxHp = Math.round(
      randomInRange(stats.hp) * floorCfg.hpMult,
    );
    this.mp = this.maxMp = Math.round(randomInRange(stats.mp));
    this.params.attackDamage = Math.max(
      1,
      Math.floor(randomInRange(stats.damage) * floorCfg.damageMult),
    );
    // Difficulty (0-2): scales hp, damage, speed (only slower, not faster)
    const diff = useGameStore.getState().enemyParams.difficulty;
    const diffStatMult = 0.5 + 0.5 * diff; // 0.5× at 0, 1× at 1, 1.5× at 2
    const diffSpeedMult = Math.min(1, 0.7 + 0.3 * diff); // 0.7× at 0, 1× at 1+
    this.hp = this.maxHp = Math.max(1, Math.round(this.hp * diffStatMult));
    this.params.attackDamage = Math.max(1, Math.round(this.params.attackDamage * diffStatMult));
    this.params.attackCooldown = 1 / (randomInRange(stats.atkSpeed) * diffSpeedMult);
    this.params.speed = randomInRange(stats.movSpeed) * diffSpeedMult;
    this.baseSpeed = this.params.speed;
    this.critChance = stats.critChance;
    this.armour = stats.armour;

    // Regen: scale by tier (low=0.5×, mid=1×, high=1.5×)
    const tierScale =
      stats.tier === 'low' ? 0.5 : stats.tier === 'high' ? 1.5 : 1.0;
    this.regenDelay = ep.regenDelay ?? 5.0;
    this.regenRate = (ep.regenRate ?? 0.1) * tierScale;
  }

  /** Initialize chase behavior — call after construction */
  initChaseBehavior(
    navGrid: NavGrid,
    ladderDefs: ReadonlyArray<LadderDef>,
    isDungeon = false,
  ): void {
    const ctx: BehaviorContext = { navGrid, ladderDefs };
    // In dungeons, use a generous but finite chase range — EnemySystem controls aggro via visibility
    const behaviorChaseRange = isDungeon ? 20 : this.params.chaseRange;
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
    this.fleeBehavior = new FleeBehavior(ctx, this.params);
    this.behavior = this.roamBehavior;
  }

  /** Set the chase target each frame */
  setChaseTarget(target: Character | null, dt: number): void {
    if (!this.chaseBehavior) return;

    // Flee check: if HP is low, flee instead of chasing
    if (this.isFleeing) {
      // Recover check: HP above threshold → stop fleeing, return to roam
      if (this.hp / this.maxHp >= RECOVER_THRESHOLD) {
        this.isFleeing = false;
        this.isChasing = false;
        this.behavior = this.roamBehavior!;
      }
      return; // don't override flee behavior with chase
    }

    // Start fleeing if HP drops low while aware of a target
    if (target && this.hp / this.maxHp < FLEE_THRESHOLD && this.fleeBehavior) {
      this.isFleeing = true;
      this.isChasing = false;
      this.fleeBehavior.setThreat(target);
      this.behavior = this.fleeBehavior;
      return;
    }

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

  /** Check if this enemy is fleeing (low HP, running away) */
  isCurrentlyFleeing(): boolean {
    return this.isFleeing;
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
