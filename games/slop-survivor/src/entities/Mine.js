import Phaser from 'phaser';
import { WEAPONS, PX, PIXEL_SCALE } from '../core/Constants.js';
import { renderPixelArt } from '../core/PixelRenderer.js';
import { MINE_SPRITE } from '../sprites/projectiles.js';
import { PALETTE } from '../sprites/palette.js';
import { eventBus, Events } from '../core/EventBus.js';
import { playSmallExplosionSfx } from '../audio/AudioBridge.js';

const SPRITE_SCALE = PX;

/**
 * Mine — dropped behind the player while moving fast.
 * Blinks during fuse time, then arms. Explodes on enemy proximity or after lifetime.
 */
export class Mine {
  constructor(scene, x, y, enemies) {
    this.scene = scene;
    this.dead = false;
    this.enemies = enemies;
    this.armed = false;

    const stats = WEAPONS.MINE;
    this.damage = stats.damage;
    this.blastRadius = stats.blastRadius;
    this.fuseTime = stats.fuseTime;
    this.proximityRadius = stats.projectileSize * 2.5;

    renderPixelArt(scene, MINE_SPRITE, PALETTE, 'mine-sprite', PIXEL_SCALE);

    this.sprite = scene.physics.add.sprite(x, y, 'mine-sprite');
    this.sprite.setScale(SPRITE_SCALE * 0.8);
    this.sprite.setDepth(5); // below projectiles
    this.sprite.body.setCircle(4);
    this.sprite.body.setImmovable(true);
    this.sprite.body.setVelocity(0, 0);
    this.sprite.entityRef = this;

    // Fuse blink animation
    this._blinkTimer = scene.time.addEvent({
      delay: 200,
      callback: () => {
        if (this.dead) return;
        this.sprite.setAlpha(this.sprite.alpha < 1 ? 1 : 0.4);
      },
      loop: true,
    });

    // Arm after fuse time
    this._fuseTimer = scene.time.delayedCall(stats.fuseTime, () => {
      if (this.dead) return;
      this.armed = true;
      this.sprite.setAlpha(1);
      this._blinkTimer.destroy();
      // Steady glow pulse when armed
      scene.tweens.add({
        targets: this.sprite,
        alpha: 0.7,
        duration: 400,
        yoyo: true,
        repeat: -1,
      });
    });

    // Auto-detonate after lifetime
    this._lifetimeTimer = scene.time.delayedCall(stats.lifetime, () => {
      this.explode();
    });
  }

  update() {
    if (this.dead || !this.armed) return;

    // Check proximity to enemies
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.sprite.x - this.sprite.x;
      const dy = enemy.sprite.y - this.sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < this.proximityRadius + enemy.config.width * 0.5) {
        this.explode();
        return;
      }
    }
  }

  explode() {
    if (this.dead) return;

    const x = this.sprite.x;
    const y = this.sprite.y;

    playSmallExplosionSfx();

    // Visual blast — purple explosion (position at center, draw at 0,0)
    const blast = this.scene.add.graphics();
    blast.setPosition(x, y);
    blast.fillStyle(0xcc33ff, 0.3);
    blast.fillCircle(0, 0, this.blastRadius);
    blast.lineStyle(3 * PX, 0xcc33ff, 0.8);
    blast.strokeCircle(0, 0, this.blastRadius);
    blast.lineStyle(2 * PX, 0xffffff, 0.4);
    blast.strokeCircle(0, 0, this.blastRadius * 0.5);

    this.scene.tweens.add({
      targets: blast,
      alpha: 0,
      scaleX: 1.6,
      scaleY: 1.6,
      duration: 400,
      ease: 'Quad.easeOut',
      onComplete: () => blast.destroy(),
    });

    // Screen shake
    eventBus.emit(Events.SCREEN_SHAKE, {
      intensity: 0.008,
      duration: 150,
    });

    // Damage all enemies in blast radius
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.sprite.x - x;
      const dy = enemy.sprite.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= this.blastRadius) {
        enemy.takeDamage(this.damage);
      }
    }

    this.destroy();
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    if (this._blinkTimer) this._blinkTimer.destroy();
    if (this._fuseTimer) this._fuseTimer.destroy();
    if (this._lifetimeTimer) this._lifetimeTimer.destroy();
    if (this.sprite && this.sprite.active) {
      this.scene.tweens.killTweensOf(this.sprite);
      this.sprite.destroy();
    }
  }
}
