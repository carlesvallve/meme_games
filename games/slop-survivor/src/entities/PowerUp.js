import Phaser from 'phaser';
import { POWERUP_DROP, PX, PIXEL_SCALE, GAME } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';

/**
 * Generic powerup token drop.
 * Collecting it triggers the powerup choice overlay — the token itself
 * has no type. Visual: glowing teal orb with "POWER UP" tag.
 */
export class PowerUp {
  constructor(scene, x, y) {
    this.scene = scene;
    this.collected = false;

    const size = POWERUP_DROP.TOKEN_SIZE;
    const color = POWERUP_DROP.TOKEN_COLOR;

    // Halo glow
    const haloRadius = size * 1.5;
    this.halo = scene.add.circle(x, y, haloRadius, color, 0.12);
    this.halo.setDepth(3);

    // Use a simple circle texture for the token
    const texKey = 'powerup-token';
    if (!scene.textures.exists(texKey)) {
      const gfx = scene.add.graphics();
      const r = Math.round(size * 0.5);
      gfx.fillStyle(color, 1);
      gfx.fillCircle(r, r, r);
      // Inner bright core
      gfx.fillStyle(0xffffff, 0.6);
      gfx.fillCircle(r, r, r * 0.4);
      gfx.generateTexture(texKey, r * 2, r * 2);
      gfx.destroy();
    }

    this.sprite = scene.physics.add.sprite(x, y, texKey);
    this.sprite.setScale(PIXEL_SCALE * 0.8);
    this.sprite.setDepth(4);
    this.sprite.body.setSize(size * 1.5 / PIXEL_SCALE, size * 1.5 / PIXEL_SCALE);
    this.sprite.entityRef = this;

    // Pulsing glow
    scene.tweens.add({
      targets: this.sprite,
      scaleX: PIXEL_SCALE * 1.1,
      scaleY: PIXEL_SCALE * 1.1,
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    scene.tweens.add({
      targets: this.halo,
      alpha: 0.25,
      scaleX: 1.5,
      scaleY: 1.5,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Name tag
    const tagSize = Math.round(GAME.HEIGHT * 0.014);
    this.nameTag = scene.add.text(x, y - size * 1.2, 'POWER UP', {
      fontSize: tagSize + 'px',
      fontFamily: '"Courier New", Courier, monospace',
      color: '#4488ff',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(5).setAlpha(0.8);

    // Despawn after 10 seconds
    this.despawnTimer = scene.time.delayedCall(10000, () => {
      if (!this.collected) this.destroy();
    });
  }

  collect() {
    if (this.collected) return;
    this.collected = true;

    eventBus.emit(Events.POWERUP_COLLECTED, {
      x: this.sprite.x,
      y: this.sprite.y,
    });

    // Quick collect animation
    const s = PIXEL_SCALE;
    this.scene.tweens.add({
      targets: this.sprite,
      alpha: 0,
      scaleX: s * 2,
      scaleY: s * 2,
      duration: 200,
      onComplete: () => this.destroy(),
    });
    if (this.halo && this.halo.active) {
      this.scene.tweens.add({
        targets: this.halo,
        alpha: 0,
        scaleX: 3,
        scaleY: 3,
        duration: 250,
      });
    }
    if (this.nameTag && this.nameTag.active) {
      this.scene.tweens.add({
        targets: this.nameTag,
        alpha: 0,
        y: this.nameTag.y - 10 * PX,
        duration: 200,
      });
    }
  }

  destroy() {
    if (this.despawnTimer) this.despawnTimer.destroy();
    if (this.halo && this.halo.active) {
      this.halo.destroy();
    }
    if (this.nameTag && this.nameTag.active) {
      this.nameTag.destroy();
    }
    if (this.sprite && this.sprite.active) {
      this.sprite.destroy();
    }
  }
}
