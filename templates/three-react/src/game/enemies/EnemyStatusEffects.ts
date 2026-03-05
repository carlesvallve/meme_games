import * as THREE from 'three';
import type { Enemy } from '../character';
import { audioSystem } from '../../utils/AudioSystem';
import type { Character } from '../character';
import type { EnemyVFX } from './EnemyVFX';

// ── Status effect types ──

export interface EnemyStatusEffect {
  remaining: number;
  tickTimer?: number;
}

export const ENEMY_POISON_TICK = 2.0;
export const ENEMY_POISON_DAMAGE = 1;

export interface StatusEffectCallbacks {
  spawnStatusIcon(enemy: Enemy, effectName: string): void;
  cleanupStatusIcon(enemy: Enemy, effectName: string): void;
}

export class EnemyStatusEffects {
  private effects = new Map<Enemy, Map<string, EnemyStatusEffect>>();
  private callbacks: StatusEffectCallbacks;
  private vfx: EnemyVFX;

  constructor(callbacks: StatusEffectCallbacks, vfx: EnemyVFX) {
    this.callbacks = callbacks;
    this.vfx = vfx;
  }

  applyStatusEffect(enemy: Enemy, effectName: string, duration: number): void {
    if (!enemy.isAlive) return;
    let effects = this.effects.get(enemy);
    if (!effects) {
      effects = new Map();
      this.effects.set(enemy, effects);
    }
    const existing = effects.get(effectName);
    if (existing) {
      existing.remaining = Math.max(existing.remaining, duration);
    } else {
      const entry: EnemyStatusEffect = { remaining: duration };
      if (effectName === 'poison') entry.tickTimer = ENEMY_POISON_TICK;
      effects.set(effectName, entry);
    }

    if (effectName === 'slow') {
      enemy.params.speed *= 0.4;
    }
    if (effectName === 'confusion') {
      enemy.setConfused(true);
    }
    this.callbacks.spawnStatusIcon(enemy, effectName);
  }

  tick(dt: number): void {
    for (const [enemy, effects] of this.effects) {
      if (!enemy.isAlive) {
        this.effects.delete(enemy);
        continue;
      }
      for (const [name, state] of effects) {
        state.remaining -= dt;

        if (name === 'poison' && state.tickTimer !== undefined) {
          state.tickTimer -= dt;
          if (state.tickTimer <= 0) {
            state.tickTimer += ENEMY_POISON_TICK;
            const ex = enemy.mesh.position.x;
            const ey = enemy.mesh.position.y;
            const ez = enemy.mesh.position.z;
            enemy.takeDamage(ENEMY_POISON_DAMAGE, ex, ez, 0);
            this.vfx.pushFloatingLabel(ex, ey + 0.3, ez, `${ENEMY_POISON_DAMAGE}`, '#88ff44');
          }
        }

        if (state.remaining <= 0) {
          effects.delete(name);
          if (name === 'slow') {
            enemy.params.speed = enemy.baseSpeed;
          }
          if (name === 'confusion') {
            enemy.setConfused(false);
          }
          this.callbacks.cleanupStatusIcon(enemy, name);
        }
      }
      if (effects.size === 0) {
        this.effects.delete(enemy);
      }
    }
  }

  hasFragile(enemy: Enemy): boolean {
    return this.effects.get(enemy)?.has('fragile') ?? false;
  }

  hasConfusion(enemy: Enemy): boolean {
    return this.effects.get(enemy)?.has('confusion') ?? false;
  }

  /** Confused enemy redirects attack to a random nearby alive enemy. Returns true if redirected. */
  tryConfusionFriendlyFire(
    attacker: Enemy,
    eax: number,
    eaz: number,
    enemies: ReadonlyArray<Enemy>,
    scene: THREE.Scene,
    goreSystem: import('../combat/GoreSystem').GoreSystem | null,
    getAllCharacters: () => Character[],
  ): boolean {
    const candidates: Enemy[] = [];
    for (const other of enemies) {
      if (other === attacker || !other.isAlive || !other.mesh.visible) continue;
      const dx = other.mesh.position.x - eax;
      const dz = other.mesh.position.z - eaz;
      if (dx * dx + dz * dz < 9) {
        candidates.push(other);
      }
    }
    if (candidates.length === 0) return false;
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const hit = target.takeDamage(attacker.params.attackDamage, eax, eaz, attacker.params.melee.knockback * 0.5);
    if (hit) {
      attacker.markAttackHitApplied();
      const tx = target.mesh.position.x, ty = target.mesh.position.y, tz = target.mesh.position.z;
      audioSystem.sfxAt('fleshHit', tx, tz);
      this.vfx.pushDamageNumber(tx, ty + 0.3, tz, attacker.params.attackDamage, 0, 0);
      const hitDirX = tx - eax, hitDirZ = tz - eaz;
      const hitDist = Math.sqrt(hitDirX * hitDirX + hitDirZ * hitDirZ) || 1;
      this.vfx.pushHitSparks(tx, ty, tz, hitDirX / hitDist, hitDirZ / hitDist);
      if (goreSystem) {
        goreSystem.spawnBloodSplash(tx, ty, tz, target.groundY, getAllCharacters());
      }
    }
    return true;
  }

  deleteEnemy(enemy: Enemy): void {
    this.effects.delete(enemy);
  }

  dispose(): void {
    this.effects.clear();
  }
}
