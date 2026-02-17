import Phaser from 'phaser';
import { XP_GEM, PLAYER, PX, PIXEL_SCALE } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';
import { renderPixelArt } from '../core/PixelRenderer.js';
import { XP_GEM_SMALL, XP_GEM_MEDIUM, XP_GEM_LARGE } from '../sprites/items.js';
import { PALETTE } from '../sprites/palette.js';

const GEM_TEXTURES = {
  SMALL: { pixels: XP_GEM_SMALL, key: 'xp-gem-small' },
  MEDIUM: { pixels: XP_GEM_MEDIUM, key: 'xp-gem-medium' },
  LARGE: { pixels: XP_GEM_LARGE, key: 'xp-gem-large' },
};

const SPRITE_SCALE = PX;
const BOB_AMPLITUDE = 4 * PX;
const BOB_SPEED = 0.004; // radians per ms

export class XPGem {
  constructor(scene, x, y, size) {
    this.scene = scene;
    this.collected = false;
    this._attracted = false;

    // size: 'SMALL', 'MEDIUM', 'LARGE'
    const config = XP_GEM[size] || XP_GEM.SMALL;
    this.config = config;
    this.value = config.value;

    // Render gem texture
    const gemTex = GEM_TEXTURES[size] || GEM_TEXTURES.SMALL;
    renderPixelArt(scene, gemTex.pixels, PALETTE, gemTex.key, PIXEL_SCALE);

    this.sprite = scene.physics.add.sprite(x, y, gemTex.key);
    this.sprite.setScale(SPRITE_SCALE * 0.8);
    this.sprite.setDepth(3);
    this.sprite.body.setSize(config.size * 2 / SPRITE_SCALE, config.size * 2 / SPRITE_SCALE);
    this.sprite.entityRef = this;

    // Bob phase — use manual sine wave instead of tween to avoid fighting physics
    this._bobPhase = Math.random() * Math.PI * 2;

    // Lifetime timer
    this.lifetimeTimer = scene.time.delayedCall(XP_GEM.LIFETIME, () => {
      if (!this.collected) this.destroy();
    });
  }

  update(playerX, playerY) {
    if (this.collected || !this.sprite.active) return;

    const dx = playerX - this.sprite.x;
    const dy = playerY - this.sprite.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Magnetic attraction — accelerates as gem gets closer
    if (dist < PLAYER.MAGNET_RANGE && dist > 1) {
      this._attracted = true;
      const t = 1 - dist / PLAYER.MAGNET_RANGE; // 0 at edge, 1 at center
      const speed = PLAYER.MAGNET_SPEED * (0.3 + t * 2.0); // ramps up aggressively
      this.sprite.body.setVelocity(
        (dx / dist) * speed,
        (dy / dist) * speed
      );
    } else {
      this.sprite.body.setVelocity(0, 0);

      // Bob only when not being attracted — apply as a visual offset via the body
      this._bobPhase += BOB_SPEED * 16; // ~16ms per frame
      const bobOffset = Math.sin(this._bobPhase) * BOB_AMPLITUDE;
      this.sprite.body.setVelocityY(bobOffset * 3);
    }
  }

  collect() {
    if (this.collected) return;
    this.collected = true;

    const leveled = gameState.addXP(this.value);
    eventBus.emit(Events.XP_COLLECTED, {
      value: this.value,
      x: this.sprite.x,
      y: this.sprite.y,
    });
    eventBus.emit(Events.XP_CHANGED, {
      xp: gameState.xp,
      xpToNext: gameState.xpToNext,
      level: gameState.level,
    });

    if (leveled) {
      eventBus.emit(Events.LEVEL_UP, { level: gameState.level });
    }

    // Quick collect animation
    this.scene.tweens.add({
      targets: this.sprite,
      alpha: 0,
      scaleX: SPRITE_SCALE * 1.5,
      scaleY: SPRITE_SCALE * 1.5,
      duration: 150,
      onComplete: () => this.destroy(),
    });
  }

  destroy() {
    if (this.lifetimeTimer) this.lifetimeTimer.destroy();
    if (this.sprite && this.sprite.active) {
      this.sprite.destroy();
    }
  }
}
