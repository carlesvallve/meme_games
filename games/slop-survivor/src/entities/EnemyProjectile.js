import Phaser from 'phaser';
import { ENEMY_BEHAVIORS, PX, PIXEL_SCALE } from '../core/Constants.js';

const STATS = ENEMY_BEHAVIORS.SHOOTER;

/**
 * A projectile fired by an enemy toward the player.
 * Slow-moving, telegraphed, and visually distinct from player projectiles.
 */
export class EnemyProjectile {
  constructor(scene, x, y, targetX, targetY) {
    this.scene = scene;
    this.dead = false;
    this.damage = STATS.projectileDamage;

    // Direction toward target
    const dx = targetX - x;
    const dy = targetY - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const fx = dist > 0 ? dx / dist : 1;
    const fy = dist > 0 ? dy / dist : 0;

    // Create texture if needed
    const texKey = 'enemy-projectile';
    if (!scene.textures.exists(texKey)) {
      const size = 8;
      const canvas = document.createElement('canvas');
      canvas.width = size * PIXEL_SCALE;
      canvas.height = size * PIXEL_SCALE;
      const ctx = canvas.getContext('2d');

      // Orange-red glowing circle
      const center = size * PIXEL_SCALE / 2;
      const radius = center - 1;
      const grad = ctx.createRadialGradient(center, center, 0, center, center, radius);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.3, '#ff8844');
      grad.addColorStop(0.7, '#ff4400');
      grad.addColorStop(1, 'rgba(255,68,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      scene.textures.addCanvas(texKey, canvas);
    }

    this.sprite = scene.physics.add.sprite(x, y, texKey);
    this.sprite.setScale(STATS.projectileSize / (8 * PIXEL_SCALE));
    this.sprite.setDepth(8);
    this.sprite.body.setCircle(STATS.projectileSize * 0.4);
    this.sprite.body.setVelocity(fx * STATS.projectileSpeed, fy * STATS.projectileSpeed);
    this.sprite.entityRef = this;

    // Rotation to face movement direction
    this.sprite.setRotation(Math.atan2(fy, fx));

    // Pulsing glow effect
    scene.tweens.add({
      targets: this.sprite,
      alpha: { from: 1, to: 0.6 },
      duration: 200,
      yoyo: true,
      repeat: -1,
    });

    // Trail particles
    this._trailTimer = scene.time.addEvent({
      delay: 50,
      callback: () => this._emitTrail(),
      loop: true,
    });

    // Auto-destroy after lifetime
    this.lifetimeTimer = scene.time.delayedCall(STATS.projectileLifetime, () => this.destroy());
  }

  _emitTrail() {
    if (this.dead || !this.sprite.active) return;
    const trail = this.scene.add.circle(
      this.sprite.x, this.sprite.y,
      2 * PX + Math.random() * 2 * PX,
      STATS.projectileColor, 0.5
    );
    trail.setDepth(7);
    this.scene.tweens.add({
      targets: trail,
      alpha: 0,
      scale: 0.3,
      duration: 250,
      onComplete: () => trail.destroy(),
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
