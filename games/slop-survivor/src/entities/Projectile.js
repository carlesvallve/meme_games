import Phaser from 'phaser';
import { WEAPONS, PX, PIXEL_SCALE } from '../core/Constants.js';
import { renderPixelArt } from '../core/PixelRenderer.js';
import { BRACKET_PROJECTILE } from '../sprites/projectiles.js';
import { PALETTE } from '../sprites/palette.js';

const SPRITE_SCALE = PX;

export class Projectile {
  constructor(scene, x, y, dirX, dirY, weaponStats) {
    this.scene = scene;
    this.damage = weaponStats.damage;
    this.dead = false;

    const size = weaponStats.projectileSize;

    // Render projectile texture
    renderPixelArt(scene, BRACKET_PROJECTILE, PALETTE, 'projectile-bracket', PIXEL_SCALE);

    this.sprite = scene.physics.add.sprite(x, y, 'projectile-bracket');
    this.sprite.setScale(SPRITE_SCALE * 0.7);
    this.sprite.setDepth(8);
    this.sprite.body.setSize(size * 2 / SPRITE_SCALE, size * 2 / SPRITE_SCALE);
    this.sprite.body.setCircle(size / SPRITE_SCALE);
    this.sprite.entityRef = this;

    // Rotate towards direction
    const angle = Math.atan2(dirY, dirX);
    this.sprite.setRotation(angle);

    // Set velocity
    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    if (len > 0) {
      const speed = weaponStats.projectileSpeed;
      this.sprite.body.setVelocity(
        (dirX / len) * speed,
        (dirY / len) * speed
      );
    }

    // Auto-destroy after lifetime
    this.lifetimeTimer = scene.time.delayedCall(
      weaponStats.projectileLifetime || WEAPONS.AUTO_ATTACK.projectileLifetime,
      () => this.destroy()
    );
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    if (this.lifetimeTimer) this.lifetimeTimer.destroy();
    if (this.sprite && this.sprite.active) {
      this.sprite.destroy();
    }
  }
}
