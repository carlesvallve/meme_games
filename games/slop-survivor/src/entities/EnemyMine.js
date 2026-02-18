import Phaser from 'phaser';
import { ENEMY_BEHAVIORS, PX, PIXEL_SCALE } from '../core/Constants.js';

const STATS = ENEMY_BEHAVIORS.MINE_LAYER;

/**
 * A mine dropped by an enemy mine-layer.
 * Arms after a delay, then damages the player on proximity.
 */
export class EnemyMine {
  constructor(scene, x, y) {
    this.scene = scene;
    this.dead = false;
    this.armed = false;
    this.damage = STATS.mineDamage;
    this.blastRadius = STATS.mineRadius;
    this.detonated = false;

    // Create texture if needed
    const texKey = 'enemy-mine';
    if (!scene.textures.exists(texKey)) {
      const size = 10;
      const s = PIXEL_SCALE;
      const canvas = document.createElement('canvas');
      canvas.width = size * s;
      canvas.height = size * s;
      const ctx = canvas.getContext('2d');

      // Pinkish-red mine circle
      const center = size * s / 2;
      const radius = center - 2;
      ctx.fillStyle = '#331122';
      ctx.beginPath();
      ctx.arc(center, center, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ff3366';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Inner dot
      ctx.fillStyle = '#ff3366';
      ctx.beginPath();
      ctx.arc(center, center, radius * 0.3, 0, Math.PI * 2);
      ctx.fill();

      scene.textures.addCanvas(texKey, canvas);
    }

    this.sprite = scene.add.sprite(x, y, texKey);
    this.sprite.setScale(STATS.mineRadius * 2 / (10 * PIXEL_SCALE));
    this.sprite.setDepth(3);
    this.sprite.setAlpha(0.4); // dim until armed

    // Arm after delay
    this._armTimer = scene.time.delayedCall(STATS.mineArmTime, () => {
      this.armed = true;
      this.sprite.setAlpha(0.8);
      // Blinking when armed
      this._blinkTween = scene.tweens.add({
        targets: this.sprite,
        alpha: { from: 0.8, to: 0.3 },
        duration: 400,
        yoyo: true,
        repeat: -1,
      });
    });

    // Auto-despawn after lifetime
    this._lifeTimer = scene.time.delayedCall(STATS.mineLifetime, () => this.destroy());
  }

  /**
   * Check if player is within blast radius. Called from GameScene.
   * Returns true if mine detonated.
   */
  checkPlayerCollision(playerX, playerY) {
    if (this.dead || !this.armed || this.detonated) return false;

    const dx = playerX - this.sprite.x;
    const dy = playerY - this.sprite.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < this.blastRadius) {
      this.detonate();
      return true;
    }
    return false;
  }

  detonate() {
    if (this.detonated || this.dead) return;
    this.detonated = true;

    // Visual explosion
    const x = this.sprite.x;
    const y = this.sprite.y;
    const blast = this.scene.add.circle(x, y, this.blastRadius, STATS.mineColor, 0.4);
    blast.setDepth(4);
    this.scene.tweens.add({
      targets: blast,
      alpha: 0,
      scale: 1.5,
      duration: 300,
      onComplete: () => blast.destroy(),
    });

    // Particles
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8;
      const speed = 40 + Math.random() * 40;
      const p = this.scene.add.circle(x, y, 2 * PX, STATS.mineColor, 0.8);
      p.setDepth(4);
      this.scene.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * speed,
        y: y + Math.sin(angle) * speed,
        alpha: 0,
        duration: 300,
        onComplete: () => p.destroy(),
      });
    }

    this.destroy();
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    if (this._armTimer) this._armTimer.destroy();
    if (this._lifeTimer) this._lifeTimer.destroy();
    if (this._blinkTween) this._blinkTween.destroy();
    if (this.sprite && this.sprite.active) {
      this.sprite.destroy();
    }
  }
}
