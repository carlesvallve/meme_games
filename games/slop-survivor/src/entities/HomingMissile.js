import Phaser from 'phaser';
import { WEAPONS, PX, PIXEL_SCALE } from '../core/Constants.js';
import { renderPixelArt } from '../core/PixelRenderer.js';
import { HOMING_MISSILE } from '../sprites/projectiles.js';
import { PALETTE } from '../sprites/palette.js';
import { eventBus, Events } from '../core/EventBus.js';
import { playSmallExplosionSfx } from '../audio/AudioBridge.js';

const SPRITE_SCALE = PX;

/**
 * Homing missile — auto-fires at nearest enemy, tracks target,
 * explodes on impact with blast radius dealing splash damage.
 */
export class HomingMissile {
  constructor(scene, x, y, target, enemies) {
    this.scene = scene;
    this.dead = false;
    this.enemies = enemies;

    const stats = WEAPONS.HOMING_MISSILE;
    this.damage = stats.damage;
    this.blastRadius = stats.blastRadius;
    this.blastDamage = stats.blastDamage;
    this.maxSpeed = stats.maxSpeed;
    this.acceleration = stats.acceleration;
    this.turnRate = stats.turnRate;
    this.currentSpeed = stats.projectileSpeed;
    this.target = target;

    renderPixelArt(scene, HOMING_MISSILE, PALETTE, 'projectile-homing', PIXEL_SCALE);

    this.sprite = scene.physics.add.sprite(x, y, 'projectile-homing');
    this.sprite.setScale(SPRITE_SCALE * 0.7);
    this.sprite.setDepth(8);
    this.sprite.body.setCircle(5);
    this.sprite.entityRef = this;

    // Initial direction toward target
    const dx = target.sprite.x - x;
    const dy = target.sprite.y - y;
    this.angle = Math.atan2(dy, dx);
    this.sprite.setRotation(this.angle);

    // Trail particles
    this._trailTimer = scene.time.addEvent({
      delay: 40,
      callback: () => this._emitTrail(),
      loop: true,
    });

    // Auto-destroy after lifetime
    this.lifetimeTimer = scene.time.delayedCall(
      stats.projectileLifetime,
      () => this.explode()
    );
  }

  update(delta) {
    if (this.dead) return;

    const dt = delta / 1000;

    // Retarget if target is dead
    if (!this.target || this.target.dead || !this.target.sprite.active) {
      this.target = this._findNewTarget();
    }

    // Steer toward target
    if (this.target && !this.target.dead) {
      const dx = this.target.sprite.x - this.sprite.x;
      const dy = this.target.sprite.y - this.sprite.y;
      const targetAngle = Math.atan2(dy, dx);

      // Compute shortest angle difference
      let angleDiff = targetAngle - this.angle;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      // Turn toward target
      const maxTurn = this.turnRate * dt;
      if (Math.abs(angleDiff) < maxTurn) {
        this.angle = targetAngle;
      } else {
        this.angle += Math.sign(angleDiff) * maxTurn;
      }
    }

    // Accelerate
    this.currentSpeed = Math.min(this.currentSpeed + this.acceleration * dt, this.maxSpeed);

    // Apply velocity
    const vx = Math.cos(this.angle) * this.currentSpeed;
    const vy = Math.sin(this.angle) * this.currentSpeed;
    this.sprite.body.setVelocity(vx, vy);
    this.sprite.setRotation(this.angle);
  }

  _findNewTarget() {
    let nearest = null;
    let bestDist = Infinity;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.sprite.x - this.sprite.x;
      const dy = enemy.sprite.y - this.sprite.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        nearest = enemy;
      }
    }
    return nearest;
  }

  /** Explode on impact — deals splash damage in radius */
  explode() {
    if (this.dead) return;

    const x = this.sprite.x;
    const y = this.sprite.y;

    playSmallExplosionSfx();

    // Visual blast effect — position at explosion center, draw at (0,0)
    const blast = this.scene.add.graphics();
    blast.setPosition(x, y);
    blast.fillStyle(0xff6633, 0.3);
    blast.fillCircle(0, 0, this.blastRadius);
    blast.lineStyle(3 * PX, 0xff6633, 0.8);
    blast.strokeCircle(0, 0, this.blastRadius);

    this.scene.tweens.add({
      targets: blast,
      alpha: 0,
      scaleX: 1.5,
      scaleY: 1.5,
      duration: 300,
      ease: 'Quad.easeOut',
      onComplete: () => blast.destroy(),
    });

    // Screen shake
    eventBus.emit(Events.SCREEN_SHAKE, {
      intensity: 0.006,
      duration: 120,
    });

    // Splash damage to nearby enemies
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.sprite.x - x;
      const dy = enemy.sprite.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= this.blastRadius) {
        enemy.takeDamage(this.blastDamage);
      }
    }

    this.destroy();
  }

  _emitTrail() {
    if (this.dead || !this.sprite || !this.sprite.active) return;
    const trailColor = WEAPONS.HOMING_MISSILE.trailColor;
    const p = this.scene.add.circle(
      this.sprite.x, this.sprite.y,
      1.5 * PX + Math.random() * PX,
      trailColor, 0.6
    );
    p.setDepth(7);
    this.scene.tweens.add({
      targets: p,
      alpha: 0,
      scale: 0.2,
      duration: 200,
      ease: 'Quad.easeOut',
      onComplete: () => p.destroy(),
    });
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    if (this._trailTimer) this._trailTimer.destroy();
    if (this.lifetimeTimer) this.lifetimeTimer.destroy();
    if (this.sprite && this.sprite.active) {
      this.sprite.destroy();
    }
  }
}
