import * as THREE from 'three';
import type { Character } from '../character';
import type { Enemy } from '../character';
import type { Environment } from '../environment';
import type { NavGrid } from '../pathfinding';
import type { EnemyVFX } from './EnemyVFX';
import type { GoreSystem } from '../combat/GoreSystem';
import type { PotionEffectSystem } from '../combat/PotionEffectSystem';
import type { LootSystem } from '../combat/Loot';
import { audioSystem } from '../../utils/AudioSystem';
import { getArchetype, getSlashStyle } from '../character';
import { findPath } from '../pathfinding';
import { useGameStore } from '../../store';

// ── Attack arc helper ────────────────────────────────────────────────

const MELEE_Y_TOLERANCE = 1.0;

export function isInAttackArc(
  attackerX: number,
  attackerY: number,
  attackerZ: number,
  attackerFacing: number,
  targetX: number,
  targetY: number,
  targetZ: number,
  reach: number,
  halfAngle: number,
): boolean {
  const fwdX = -Math.sin(attackerFacing);
  const fwdZ = -Math.cos(attackerFacing);

  const dx = targetX - attackerX;
  const dy = targetY - attackerY;
  const dz = targetZ - attackerZ;

  if (Math.abs(dy) > MELEE_Y_TOLERANCE) return false;

  const dist2D = Math.sqrt(dx * dx + dz * dz);
  if (dist2D > reach) return false;
  if (dist2D < 0.001) return true;

  const dot = fwdX * (dx / dist2D) + fwdZ * (dz / dist2D);
  return dot >= Math.cos(halfAngle);
}

// ── Crit chain ──────────────────────────────────────────────────────

export interface HitImpactCallbacks {
  onHitstop: (duration: number) => void;
  onCameraShake: (
    intensity: number,
    duration: number,
    dirX: number,
    dirZ: number,
  ) => void;
}

const CRIT_CHANCE = 0.2;
const CRIT_RANGE_SQ = 4 * 4;
const CRIT_MAX_PATH_STEPS = 12;
const CRIT_CHAIN_MAX = 3;
const CRIT_DASH_SPEED = 16;
const CRIT_DASH_STOP_DIST = 0.4;
const AGGRO_DURATION = 8.0;

export class EnemyCombat {
  private critChain: {
    targets: Enemy[];
    index: number;
    dashing: boolean;
  } | null = null;

  private readonly enemies: Enemy[];
  private readonly terrain: Environment;
  private readonly navGrid: NavGrid;
  private readonly vfx: EnemyVFX;
  private readonly lootSystem: LootSystem;
  private readonly getGoreSystem: () => GoreSystem | null;
  private readonly getPotionSystem: () => PotionEffectSystem | null;
  private readonly getImpactCallbacks: () => HitImpactCallbacks | null;
  private readonly aggroTimers: Map<Enemy, number>;
  private readonly getAllCharacters: () => Character[];
  private readonly cleanupEnemy: (enemy: Enemy) => void;

  constructor(
    enemies: Enemy[],
    terrain: Environment,
    navGrid: NavGrid,
    vfx: EnemyVFX,
    lootSystem: LootSystem,
    aggroTimers: Map<Enemy, number>,
    getGoreSystem: () => GoreSystem | null,
    getPotionSystem: () => PotionEffectSystem | null,
    getImpactCallbacks: () => HitImpactCallbacks | null,
    getAllCharacters: () => Character[],
    cleanupEnemy: (enemy: Enemy) => void,
  ) {
    this.enemies = enemies;
    this.terrain = terrain;
    this.navGrid = navGrid;
    this.vfx = vfx;
    this.lootSystem = lootSystem;
    this.aggroTimers = aggroTimers;
    this.getGoreSystem = getGoreSystem;
    this.getPotionSystem = getPotionSystem;
    this.getImpactCallbacks = getImpactCallbacks;
    this.getAllCharacters = getAllCharacters;
    this.cleanupEnemy = cleanupEnemy;
  }

  get isCritChainActive(): boolean {
    return this.critChain !== null;
  }

  rollCrit(): boolean {
    const critChance = CRIT_CHANCE + (this.getPotionSystem()?.critBonus ?? 0);
    return Math.random() < critChance;
  }

  startCritChain(playerChar: Character): void {
    if (this.critChain) return;

    const px = playerChar.mesh.position.x;
    const pz = playerChar.mesh.position.z;

    const prefiltered: { enemy: Enemy; distSq: number }[] = [];
    for (const enemy of this.enemies) {
      if (!enemy.isAlive || !enemy.mesh.visible) continue;
      const dx = enemy.mesh.position.x - px,
        dz = enemy.mesh.position.z - pz;
      const distSq = dx * dx + dz * dz;
      if (distSq < CRIT_RANGE_SQ) {
        prefiltered.push({ enemy, distSq });
      }
    }
    if (prefiltered.length === 0) return;

    const candidates: { enemy: Enemy; distSq: number }[] = [];
    for (const c of prefiltered) {
      const result = findPath(
        this.navGrid,
        px,
        pz,
        c.enemy.mesh.position.x,
        c.enemy.mesh.position.z,
        200,
      );
      if (result.found && result.path.length <= CRIT_MAX_PATH_STEPS) {
        candidates.push(c);
      }
    }
    if (candidates.length === 0) return;

    candidates.sort((a, b) => a.distSq - b.distSq);

    const targets: Enemy[] = [];
    for (let i = 0; i < CRIT_CHAIN_MAX; i++) {
      targets.push(candidates[i % candidates.length].enemy);
    }

    this.critChain = { targets, index: 0, dashing: true };
  }

  updateCritChain(
    dt: number,
    playerChar: Character,
    onEnemyDied: () => void,
    showSlashEffect: boolean,
  ): boolean {
    if (!this.critChain) return false;
    const chain = this.critChain;

    if (chain.index >= chain.targets.length) {
      this.critChain = null;
      return false;
    }

    const target = chain.targets[chain.index];
    const px = playerChar.mesh.position.x;
    const pz = playerChar.mesh.position.z;
    const tx = target.mesh.position.x;
    const tz = target.mesh.position.z;

    if (!target.isAlive) {
      chain.index++;
      chain.dashing = true;
      return true;
    }

    if (chain.dashing) {
      const dx = tx - px,
        dz = tz - pz;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist <= CRIT_DASH_STOP_DIST) {
        chain.dashing = false;
      } else {
        const step = CRIT_DASH_SPEED * dt;
        const move = Math.min(step, dist - CRIT_DASH_STOP_DIST * 0.5);
        const nx = dx / dist,
          nz = dz / dist;
        playerChar.mesh.position.x += nx * move;
        playerChar.mesh.position.z += nz * move;
        playerChar.facing = Math.atan2(-nx, -nz);
        playerChar.mesh.rotation.y = playerChar.facing;
        playerChar.groundY = this.terrain.getTerrainY(
          playerChar.mesh.position.x,
          playerChar.mesh.position.z,
        );
        playerChar.mesh.position.y = playerChar.groundY;
        return true;
      }
    }

    // Apply guaranteed crit hit
    const damage = playerChar.params.attackDamage;
    const ex = target.mesh.position.x;
    const ey = target.mesh.position.y;
    const ez = target.mesh.position.z;
    const hdx = ex - playerChar.mesh.position.x;
    const hdz = ez - playerChar.mesh.position.z;
    const hdist = Math.sqrt(hdx * hdx + hdz * hdz) || 1;
    const hitDirX = hdx / hdist,
      hitDirZ = hdz / hdist;

    playerChar.facing = Math.atan2(-hitDirX, -hitDirZ);
    playerChar.mesh.rotation.y = playerChar.facing;

    playerChar.startAttack();
    audioSystem.sfx('slash');
    if (showSlashEffect) {
      const critSlashStyle = playerChar.voxEntry
        ? getSlashStyle(getArchetype(playerChar.voxEntry.name))
        : 'horizontal';
      this.vfx.pushSlashArc(playerChar.mesh, critSlashStyle);
    }

    // Armour deflect check
    if (target.armour > 0 && Math.random() < target.armour) {
      this.aggroTimers.set(target, AGGRO_DURATION);
      audioSystem.sfxAt('clank', ex, ez);
      this.vfx.pushMetalSparks(ex, ey, ez, hitDirX, hitDirZ);
      this.vfx.pushFloatingLabel(ex, ey + 0.3, ez, 'CLANK!', '#ccddff', 'md');
      const callbacks = this.getImpactCallbacks();
      if (callbacks) {
        if (useGameStore.getState().characterParams.melee.hitstopEnabled) callbacks.onHitstop(0.08);
        callbacks.onCameraShake(0.15, 0.12, -hitDirX, -hitDirZ);
      }
    } else {
      const hit = target.takeDamage(
        damage,
        playerChar.mesh.position.x,
        playerChar.mesh.position.z,
        playerChar.params.melee.knockback * 1.5,
      );
      if (hit) {
        this.aggroTimers.set(target, AGGRO_DURATION);
        this.vfx.pushDamageNumber(
          ex,
          ey + 0.3,
          ez,
          damage,
          hitDirX,
          hitDirZ,
          true,
        );
        audioSystem.sfxAt('fleshHit', ex, ez);
        this.vfx.pushHitSparks(ex, ey, ez, hitDirX, hitDirZ);
        const goreSystem = this.getGoreSystem();
        if (goreSystem) {
          goreSystem.spawnBloodSplash(
            ex,
            ey,
            ez,
            target.groundY,
            this.getAllCharacters(),
          );
        }
        const callbacks = this.getImpactCallbacks();
        if (callbacks) {
          const isKill = !target.isAlive;
          if (useGameStore.getState().characterParams.melee.hitstopEnabled) callbacks.onHitstop(isKill ? 0.12 : 0.08);
          callbacks.onCameraShake(
            isKill ? 0.25 : 0.15,
            isKill ? 0.25 : 0.15,
            hitDirX,
            hitDirZ,
          );
        }

        if (!target.isAlive) {
          const pos = target.mesh.position;
          if (this.getGoreSystem()) {
            this.getGoreSystem()!.spawnGore(
              target.mesh,
              target.groundY,
              this.getAllCharacters(),
              target.lastHitDirX,
              target.lastHitDirZ,
            );
          }
          this.lootSystem.spawnLoot(pos.clone());
          if (Math.random() < 0.4) this.lootSystem.spawnFood(pos.clone());
          audioSystem.sfxAt('death', pos.x, pos.z);
          this.cleanupEnemy(target);
          target.dispose();
          const idx = this.enemies.indexOf(target);
          if (idx >= 0) this.enemies.splice(idx, 1);
          onEnemyDied();
        }
      }
    }

    chain.index++;
    chain.dashing = true;
    return true;
  }
}
