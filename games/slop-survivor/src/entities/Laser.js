import Phaser from 'phaser';
import { WEAPONS, PX, PIXEL_SCALE } from '../core/Constants.js';
import { renderPixelArt } from '../core/PixelRenderer.js';
import { LASER_CAPSULE } from '../sprites/projectiles.js';
import { PALETTE } from '../sprites/palette.js';

const SPRITE_SCALE = PX;

/**
 * Manual laser projectile — fired by the player in the ship's facing direction.
 * Yellow capsule that travels fast and deals more damage than auto-attack.
 */
export class Laser {
  constructor(scene, x, y, facingX, facingY) {
    this.scene = scene;
    this.dead = false;

    const stats = WEAPONS.LASER;
    this.damage = stats.damage;

    // Render laser texture (cached after first call)
    renderPixelArt(scene, LASER_CAPSULE, PALETTE, 'projectile-laser', PIXEL_SCALE);

    this.sprite = scene.physics.add.sprite(x, y, 'projectile-laser');
    this.sprite.setScale(SPRITE_SCALE * 0.8);
    this.sprite.setDepth(8);
    this.sprite.body.setSize(10, 6);
    this.sprite.body.setCircle(5);
    this.sprite.entityRef = this;

    // Rotate towards direction
    const angle = Math.atan2(facingY, facingX);
    this.sprite.setRotation(angle);

    // Set velocity in ship's facing direction
    this.sprite.body.setVelocity(
      facingX * stats.projectileSpeed,
      facingY * stats.projectileSpeed,
    );

    // Trail particles for visual flair
    this._trailTimer = scene.time.addEvent({
      delay: 30,
      callback: () => this._emitTrail(),
      loop: true,
    });

    // Auto-destroy after lifetime
    this.lifetimeTimer = scene.time.delayedCall(
      stats.projectileLifetime,
      () => this.destroy()
    );
  }

  _emitTrail() {
    if (this.dead || !this.sprite || !this.sprite.active) return;

    const p = this.scene.add.circle(
      this.sprite.x,
      this.sprite.y,
      1.5 * PX + Math.random() * 1 * PX,
      WEAPONS.LASER.trailColor,
      0.6
    );
    p.setDepth(7);

    this.scene.tweens.add({
      targets: p,
      alpha: 0,
      scale: 0.2,
      duration: 180,
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
