import Phaser from 'phaser';
import { PX, PLAYER, PIXEL_SCALE } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';
import { renderPixelArt } from '../core/PixelRenderer.js';
import { PALETTE } from '../sprites/palette.js';

// 8x8 heart pixel art using palette indices (14=red, 7=white)
const HEART_PIXELS = [
  [0, 14, 14, 0, 0, 14, 14, 0],
  [14, 7, 14, 14, 14, 7, 14, 14],
  [14, 14, 14, 14, 14, 14, 14, 14],
  [14, 14, 14, 14, 14, 14, 14, 14],
  [0, 14, 14, 14, 14, 14, 14, 0],
  [0, 0, 14, 14, 14, 14, 0, 0],
  [0, 0, 0, 14, 14, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

const TEX_KEY = 'health-heart';
const SPRITE_SCALE = PX;
const BOB_AMPLITUDE = 5 * PX;
const BOB_SPEED = 0.005;
const LIFETIME = 12000; // ms before despawn
const PICKUP_SIZE = 20 * PX;

export class HealthPickup {
  constructor(scene, x, y) {
    this.scene = scene;
    this.collected = false;

    renderPixelArt(scene, HEART_PIXELS, PALETTE, TEX_KEY, PIXEL_SCALE);

    this.sprite = scene.physics.add.sprite(x, y, TEX_KEY);
    this.sprite.setScale(SPRITE_SCALE * 1.2);
    this.sprite.setDepth(4);
    this.sprite.body.setSize(PICKUP_SIZE / SPRITE_SCALE, PICKUP_SIZE / SPRITE_SCALE);
    this.sprite.entityRef = this;

    this._bobPhase = Math.random() * Math.PI * 2;

    // Spawn animation — pop in
    this.sprite.setScale(0);
    scene.tweens.add({
      targets: this.sprite,
      scaleX: SPRITE_SCALE * 1.2,
      scaleY: SPRITE_SCALE * 1.2,
      duration: 300,
      ease: 'Back.easeOut',
    });

    // Lifetime
    this.lifetimeTimer = scene.time.delayedCall(LIFETIME, () => {
      if (!this.collected) this.destroy();
    });
  }

  update(playerX, playerY) {
    if (this.collected || !this.sprite.active) return;

    // Bob
    this._bobPhase += BOB_SPEED * 16;
    const bobOffset = Math.sin(this._bobPhase) * BOB_AMPLITUDE;
    this.sprite.body.setVelocityY(bobOffset * 3);

    // Magnetic attraction when close
    const dx = playerX - this.sprite.x;
    const dy = playerY - this.sprite.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < PLAYER.MAGNET_RANGE * 0.7 && dist > 1) {
      const t = 1 - dist / (PLAYER.MAGNET_RANGE * 0.7);
      const speed = PLAYER.MAGNET_SPEED * (0.3 + t * 1.5);
      this.sprite.body.setVelocity(
        (dx / dist) * speed,
        (dy / dist) * speed
      );
    }
  }

  collect() {
    if (this.collected) return;
    if (gameState.health >= gameState.maxHealth) return; // already full HP

    this.collected = true;
    gameState.health = Math.min(gameState.maxHealth, gameState.health + 1);
    eventBus.emit(Events.PLAYER_HEAL, { health: gameState.health });

    // Collect animation
    this.scene.tweens.add({
      targets: this.sprite,
      alpha: 0,
      scaleX: SPRITE_SCALE * 2,
      scaleY: SPRITE_SCALE * 2,
      duration: 200,
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
