import * as THREE from 'three';
import { useGameStore } from '../../store';
import type { Terrain } from '../Terrain';
import type { MovementParams } from './CharacterSettings';

/** Owner interface — fields the combat module reads/writes on the character. */
export interface CombatOwner {
  mesh: THREE.Mesh;
  groundY: number;
  isEnemy: boolean;
  params: MovementParams;
  terrain: Terrain;
  /** Trigger VOX action animation */
  playActionAnim(): void;
  /** Get number of action frames from current VOX data (0 = no action frames) */
  getActionFrameCount(): number;
  /** Get current VOX animation state */
  getVoxAnimState(): string;
  /** Get current VOX frame index */
  getVoxFrameIndex(): number;
}

export class CharacterCombat {
  hp = 10;
  maxHp = 10;
  isAlive = true;
  knockbackVX = 0;
  knockbackVZ = 0;
  private justTookDamage = false;
  invulnTimer = 0;
  flashTimer = 0;
  attackTimer = 0;
  isAttacking = false;
  attackJustStarted = false;
  private attackHitApplied = false;
  attackCount = 0;
  exhaustTimer = 0;
  private timeSinceLastAttack = 0;
  stunTimer = 0;
  lastHitDirX = 0;
  lastHitDirZ = 0;
  private originalEmissive = new THREE.Color(0, 0, 0);
  private originalEmissiveIntensity = 0;

  /** Fraction of attack duration for time-based fallback when VOX action has no frames. */
  private static readonly MELEE_HIT_WINDOW_RATIO = 0.5;

  consumeJustTookDamage(): boolean {
    const v = this.justTookDamage;
    this.justTookDamage = false;
    return v;
  }

  takeDamage(owner: CombatOwner, amount: number, fromX: number, fromZ: number): boolean {
    if (!this.isAlive || this.invulnTimer > 0) return false;

    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.isAlive = false;
    }
    this.justTookDamage = true;

    const dx = owner.mesh.position.x - fromX;
    const dz = owner.mesh.position.z - fromZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    this.lastHitDirX = dist > 0.001 ? dx / dist : 0;
    this.lastHitDirZ = dist > 0.001 ? dz / dist : 0;
    const knockbackSpeed = owner.params.knockbackSpeed;
    if (dist > 0.001) {
      this.knockbackVX = (dx / dist) * knockbackSpeed;
      this.knockbackVZ = (dz / dist) * knockbackSpeed;
    } else {
      const angle = Math.random() * Math.PI * 2;
      this.knockbackVX = Math.cos(angle) * knockbackSpeed;
      this.knockbackVZ = Math.sin(angle) * knockbackSpeed;
    }

    this.invulnTimer = owner.params.invulnDuration;
    this.flashTimer = owner.params.flashDuration;
    this.stunTimer = owner.params.stunDuration;

    const mat = owner.mesh.material as THREE.MeshStandardMaterial;
    if (mat.emissive) {
      this.originalEmissive.copy(mat.emissive);
      this.originalEmissiveIntensity = mat.emissiveIntensity;
    }

    return true;
  }

  startAttack(owner: CombatOwner): boolean {
    if (!this.isAlive || this.isAttacking || this.exhaustTimer > 0 || this.stunTimer > 0) return false;

    if (this.timeSinceLastAttack > 1.0) {
      this.attackCount = 0;
    }

    this.isAttacking = true;
    this.attackJustStarted = true;
    this.attackTimer = owner.params.attackDuration;
    this.timeSinceLastAttack = 0;
    this.attackCount++;

    if (useGameStore.getState().characterParams.exhaustionEnabled && this.attackCount >= 7) {
      this.exhaustTimer = owner.params.exhaustDuration;
      this.attackCount = 0;
    }

    owner.playActionAnim();
    return true;
  }

  isInAttackHitWindow(owner: CombatOwner): boolean {
    if (!this.isAttacking) return false;
    const actionFrameCount = owner.getActionFrameCount();
    if (actionFrameCount > 0) {
      const climaxFrameIndex = actionFrameCount - 1;
      return owner.getVoxAnimState() === 'action' && owner.getVoxFrameIndex() === climaxFrameIndex;
    }
    return this.attackTimer <= owner.params.attackDuration * CharacterCombat.MELEE_HIT_WINDOW_RATIO;
  }

  markAttackHitApplied(): void {
    this.attackHitApplied = true;
  }

  canApplyAttackHit(owner: CombatOwner): boolean {
    return this.isInAttackHitWindow(owner) && !this.attackHitApplied;
  }

  update(owner: CombatOwner, dt: number): void {
    this.timeSinceLastAttack += dt;

    // Knockback decay
    if (Math.abs(this.knockbackVX) > 0.01 || Math.abs(this.knockbackVZ) > 0.01) {
      const kbX = this.knockbackVX * dt;
      const kbZ = this.knockbackVZ * dt;
      const resolved = owner.terrain.resolveMovement(
        owner.mesh.position.x + kbX,
        owner.mesh.position.z + kbZ,
        owner.groundY,
        owner.params.stepHeight,
        owner.params.capsuleRadius,
        owner.mesh.position.x,
        owner.mesh.position.z,
        owner.params.slopeHeight,
      );
      owner.mesh.position.x = resolved.x;
      owner.mesh.position.z = resolved.z;
      owner.groundY = resolved.y;

      const decay = Math.exp(-owner.params.knockbackDecay * dt);
      this.knockbackVX *= decay;
      this.knockbackVZ *= decay;
    }

    // Invuln blink
    if (this.invulnTimer > 0) {
      this.invulnTimer -= dt;
      owner.mesh.visible = Math.floor(this.invulnTimer * 10) % 2 === 0;
      if (this.invulnTimer <= 0) {
        owner.mesh.visible = true;
        this.invulnTimer = 0;
      }
    }

    // Flash
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const mat = owner.mesh.material as THREE.MeshStandardMaterial;
      if (mat.emissive) {
        mat.emissive.setRGB(1, 1, 1);
        const fd = Math.max(owner.params.flashDuration, 0.001);
        mat.emissiveIntensity = 2.0 * (this.flashTimer / fd);
      }
      if (this.flashTimer <= 0) {
        this.flashTimer = 0;
        if (mat.emissive) {
          mat.emissive.copy(this.originalEmissive);
          mat.emissiveIntensity = this.originalEmissiveIntensity;
        }
      }
    }

    // Attack timer
    if (this.isAttacking) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) {
        this.isAttacking = false;
        this.attackTimer = 0;
        this.attackHitApplied = false;
      }
    }

    // Exhaustion
    if (this.exhaustTimer > 0) {
      this.exhaustTimer -= dt;
      if (this.exhaustTimer <= 0) {
        this.exhaustTimer = 0;
        this.attackCount = 0;
      }
    }

    // Stun
    if (this.stunTimer > 0) {
      this.stunTimer -= dt;
      if (this.stunTimer <= 0) this.stunTimer = 0;
    }
  }
}
