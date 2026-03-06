import * as THREE from 'three';
import type { Environment } from '../environment';
import type { MovementParams } from './CharacterSettings';

/** Owner interface — fields the combat module reads/writes on the character. */
export interface CombatOwner {
  mesh: THREE.Mesh;
  groundY: number;
  isEnemy: boolean;
  isMoving: boolean;
  params: MovementParams;
  terrain: Environment;
  /** Trigger VOX action animation */
  playActionAnim(): void;
  /** Get number of action frames from current VOX data (0 = no action frames) */
  getActionFrameCount(): number;
  /** Get current VOX animation state */
  getVoxAnimState(): string;
  /** Get current VOX frame index */
  getVoxFrameIndex(): number;
  /** Whether the animator is holding the last action frame (combo window) */
  isActionHolding(): boolean;
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
  isAttacking = false;
  attackJustStarted = false;
  private attackHitApplied = false;
  attackCount = 0;
  exhaustTimer = 0;
  private lungeElapsed = 0;
  /** Buffered combo attack — fires when current hold finishes. */
  private comboBuffered = false;
  /** Exhaust triggers after 3rd attack animation finishes, not immediately. */
  private pendingExhaust = false;
  stunTimer = 0;

  /** Combo damage multipliers per hit (1-indexed by attackCount). */
  private static readonly COMBO_MULTIPLIERS = [1.0, 1.25, 1.5];

  // ── Regeneration ──────────────────────────────────────────────────
  /** Seconds after last damage before regen activates. */
  regenDelay = 8.0;
  /** HP per second once regen is active. */
  regenRate = 0.05;
  /** Seconds since last damage was taken. */
  timeSinceLastDamage = 999;

  // ── Hunger (non-enemy characters only) ─────────────────────────────
  /** Whether hunger is enabled (non-enemy characters). */
  hungerEnabled = false;
  /** Current hunger level 0–100. */
  hunger = 80;
  /** Maximum hunger. */
  maxHunger = 100;
  /** Hunger points lost per second. */
  hungerDecayRate = 0.5;
  /** HP lost per second when hunger ≤ starvation threshold. */
  starvationDamage = 0.2;
  /** Hunger threshold below which starvation damage kicks in. */
  starvationThreshold = 15;
  lastHitDirX = 0;
  lastHitDirZ = 0;
  private originalEmissive = new THREE.Color(0, 0, 0);
  private originalEmissiveIntensity = 0;

  // Combo: alternate swing direction by mirroring mesh on X
  private comboFlipped = false;

  // Lunge: push character forward during attack
  private lungeDist = 0;
  private lungeDir = { x: 0, z: 0 };
  /** Max allowed lunge distance — capped by nearby targets to prevent passing through */
  private lungeMaxDist = Infinity;

  /** Restore hunger by the given amount (clamped to maxHunger). */
  restoreHunger(amount: number): void {
    this.hunger = Math.min(this.maxHunger, this.hunger + amount);
  }

  /** Current combo damage multiplier based on attack count. */
  get comboDamageMultiplier(): number {
    const idx = Math.max(0, this.attackCount - 1);
    return CharacterCombat.COMBO_MULTIPLIERS[Math.min(idx, CharacterCombat.COMBO_MULTIPLIERS.length - 1)];
  }

  /** Cap lunge so the character stops short of a target (call after startAttack). */
  capLungeToTarget(ownerX: number, ownerZ: number, targetX: number, targetZ: number, stopDist: number): void {
    const dx = targetX - ownerX;
    const dz = targetZ - ownerZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const maxLunge = Math.max(0, dist - stopDist);
    this.lungeMaxDist = Math.min(this.lungeMaxDist, maxLunge);
  }

  consumeJustTookDamage(): boolean {
    const v = this.justTookDamage;
    this.justTookDamage = false;
    return v;
  }

  takeDamage(
    owner: CombatOwner,
    amount: number,
    fromX: number,
    fromZ: number,
    knockback: number,
  ): boolean {
    if (!this.isAlive || this.invulnTimer > 0) return false;

    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.isAlive = false;
    }
    this.justTookDamage = true;
    this.timeSinceLastDamage = 0;

    const dx = owner.mesh.position.x - fromX;
    const dz = owner.mesh.position.z - fromZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    this.lastHitDirX = dist > 0.001 ? dx / dist : 0;
    this.lastHitDirZ = dist > 0.001 ? dz / dist : 0;
    if (dist > 0.001) {
      this.knockbackVX = (dx / dist) * knockback;
      this.knockbackVZ = (dz / dist) * knockback;
    } else {
      const angle = Math.random() * Math.PI * 2;
      this.knockbackVX = Math.cos(angle) * knockback;
      this.knockbackVZ = Math.sin(angle) * knockback;
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
    if (
      !this.isAlive ||
      this.exhaustTimer > 0 ||
      this.stunTimer > 0
    )
      return false;

    // If mid-attack, buffer the combo input — it fires when hold finishes
    if (this.isAttacking) {
      this.comboBuffered = true;
      return false;
    }

    this.executeAttack(owner, false);
    return true;
  }

  /** Actually start an attack (called directly or from combo buffer). */
  private executeAttack(owner: CombatOwner, isCombo = false): void {
    // Reset combo if animation already returned to idle/walk (skip for buffered combos)
    if (!isCombo && owner.getVoxAnimState() !== 'action') {
      this.attackCount = 0;
    }

    this.isAttacking = true;
    this.attackJustStarted = true;
    this.attackHitApplied = false;
    this.comboBuffered = false;
    this.lungeElapsed = 0;
    this.attackCount++;

    if (this.attackCount >= 3) {
      this.pendingExhaust = true;
      this.attackCount = 0;
    }

    // Combo: alternate swing direction on even attacks (mirror mesh on X)
    this.comboFlipped = this.attackCount % 2 === 0;
    owner.mesh.scale.x = this.comboFlipped
      ? -Math.abs(owner.mesh.scale.x)
      : Math.abs(owner.mesh.scale.x);

    // Lunge: store facing direction, lunge will be applied in update
    const facing = owner.mesh.rotation.y;
    this.lungeDir.x = -Math.sin(facing);
    this.lungeDir.z = -Math.cos(facing);
    this.lungeDist = 0;
    this.lungeMaxDist = Infinity;

    owner.playActionAnim();
  }

  isInAttackHitWindow(owner: CombatOwner): boolean {
    if (!this.isAttacking) return false;
    const actionFrameCount = owner.getActionFrameCount();
    if (actionFrameCount > 0) {
      const climaxFrameIndex = actionFrameCount - 1;
      return (
        owner.getVoxAnimState() === 'action' &&
        owner.getVoxFrameIndex() === climaxFrameIndex
      );
    }
    // No action frames — hit on first update
    return true;
  }

  markAttackHitApplied(): void {
    this.attackHitApplied = true;
  }

  canApplyAttackHit(owner: CombatOwner): boolean {
    return this.isInAttackHitWindow(owner) && !this.attackHitApplied;
  }

  update(owner: CombatOwner, dt: number): void {
    // Knockback decay
    if (
      Math.abs(this.knockbackVX) > 0.01 ||
      Math.abs(this.knockbackVZ) > 0.01
    ) {
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

    // Invuln blink (skip if dead — hideBody() controls visibility after death)
    if (this.invulnTimer > 0) {
      this.invulnTimer -= dt;
      if (this.isAlive) {
        owner.mesh.visible = Math.floor(this.invulnTimer * 10) % 2 === 0;
      }
      if (this.invulnTimer <= 0) {
        if (this.isAlive) owner.mesh.visible = true;
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

    // Attack — animation-driven, ends when anim leaves 'action' state
    if (this.isAttacking) {
      // Check if animation returned to idle/walk → attack finished or combo fires
      if (owner.getVoxAnimState() !== 'action') {
        if (this.comboBuffered) {
          // Fire buffered combo immediately
          this.isAttacking = false;
          this.executeAttack(owner, true);
        } else {
          this.isAttacking = false;
          this.attackHitApplied = false;
          owner.mesh.scale.x = Math.abs(owner.mesh.scale.x);
          this.comboFlipped = false;
          this.lungeDist = 0;
          // Apply exhaust after 3rd combo attack finishes
          if (this.pendingExhaust) {
            this.pendingExhaust = false;
            this.exhaustTimer = owner.params.exhaustDuration;
          }
        }
      } else {
        // Lunge forward during attack
        this.lungeElapsed += dt;
        const t = Math.min(1, this.lungeElapsed / owner.params.lungeDuration);
        const prevLunge = this.lungeDist;
        if (t < 0.5) {
          // Ease-out push forward
          const lt = t / 0.5;
          this.lungeDist = owner.params.lungeDistance * (1 - (1 - lt) * (1 - lt));
        } else {
          // Settle at 90%
          const lt = (t - 0.5) / 0.5;
          const target = owner.params.lungeDistance * 0.9;
          this.lungeDist = owner.params.lungeDistance + (target - owner.params.lungeDistance) * (lt * lt);
        }
        // Cap lunge to avoid passing through targets
        if (this.lungeDist > this.lungeMaxDist) this.lungeDist = this.lungeMaxDist;
        const lungeDelta = this.lungeDist - prevLunge;
        if (Math.abs(lungeDelta) > 0.0001) {
          const oldX = owner.mesh.position.x;
          const oldZ = owner.mesh.position.z;
          const newX = oldX + this.lungeDir.x * lungeDelta;
          const newZ = oldZ + this.lungeDir.z * lungeDelta;
          const resolved = owner.terrain.resolveMovement(
            newX, newZ, owner.groundY,
            owner.params.stepHeight, owner.params.capsuleRadius,
            oldX, oldZ, owner.params.slopeHeight,
          );
          owner.mesh.position.x = resolved.x;
          owner.mesh.position.z = resolved.z;
          owner.groundY = resolved.y;
        }
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

    // ── Hunger decay (non-enemy characters) ───────────────────────────
    // Only decays when the player is active (moving, attacking, taking damage)
    if (this.hungerEnabled && this.isAlive) {
      const isActive =
        owner.isMoving || this.isAttacking || this.timeSinceLastDamage < 1.0;
      if (isActive) {
        this.hunger = Math.max(0, this.hunger - this.hungerDecayRate * dt);
      }

      // Starvation: slow HP drain when very hungry (never kills — floor at 1)
      if (this.hunger <= this.starvationThreshold) {
        this.hp = Math.max(1, this.hp - this.starvationDamage * dt);
      }
    }

    // ── HP Regeneration ───────────────────────────────────────────────
    this.timeSinceLastDamage += dt;
    // Only regen while active (moving/attacking/recently hit) — matches hunger decay logic
    const regenActive = this.hungerEnabled
      ? (owner.isMoving || this.isAttacking || this.timeSinceLastDamage < 1.0)
      : true; // enemies always regen
    if (
      regenActive &&
      this.isAlive &&
      this.hp < this.maxHp &&
      this.timeSinceLastDamage >= this.regenDelay
    ) {
      let effectiveRate = this.regenRate;
      // Gate regen by hunger (non-enemy characters)
      if (this.hungerEnabled) {
        effectiveRate *= Math.min(1, this.hunger / 50);
      }
      if (effectiveRate > 0) {
        this.hp = Math.min(this.maxHp, this.hp + effectiveRate * dt);
      }
    }
  }
}
