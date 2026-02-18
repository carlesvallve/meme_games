import Phaser from 'phaser';
import { POWERUP_TYPES, PX, PIXEL_SCALE, GAME } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';
import { renderPixelArt } from '../core/PixelRenderer.js';
import { POWERUP_CODE_REVIEW, POWERUP_GITIGNORE, POWERUP_LINTER } from '../sprites/items.js';
import { MINE_SPRITE, ICON_TRIPLE } from '../sprites/projectiles.js';
import { PALETTE } from '../sprites/palette.js';

const POWERUP_TEXTURES = {
  CODE_REVIEW: { pixels: POWERUP_CODE_REVIEW, key: 'powerup-code-review' },
  GITIGNORE: { pixels: POWERUP_GITIGNORE, key: 'powerup-gitignore' },
  LINTER: { pixels: POWERUP_LINTER, key: 'powerup-linter' },
  MINES: { pixels: MINE_SPRITE, key: 'powerup-mines' },
  TRIPLE_SHOT: { pixels: ICON_TRIPLE, key: 'powerup-triple-shot' },
};

const SPRITE_SCALE = PX;

export class PowerUp {
  constructor(scene, x, y, typeName) {
    this.scene = scene;
    this.typeName = typeName;
    this.collected = false;

    const config = POWERUP_TYPES[typeName];
    this.config = config;

    // Render power-up texture
    const texData = POWERUP_TEXTURES[typeName];
    renderPixelArt(scene, texData.pixels, PALETTE, texData.key, PIXEL_SCALE);

    // Color halo per type
    const HALO_COLORS = {
      CODE_REVIEW: 0xff6633,
      GITIGNORE: 0x3388ff,
      LINTER: 0xffdd33,
      MINES: 0xcc33ff,
      TRIPLE_SHOT: 0x33ccff,
    };
    const haloColor = HALO_COLORS[typeName] || 0xffffff;
    const haloRadius = config.width * 1.5;
    this.halo = scene.add.circle(x, y, haloRadius, haloColor, 0.12);
    this.halo.setDepth(3);

    this.sprite = scene.physics.add.sprite(x, y, texData.key);
    this.sprite.setScale(SPRITE_SCALE * 1.2);
    this.sprite.setDepth(4);
    this.sprite.body.setSize(config.width * 1.5 / SPRITE_SCALE, config.width * 1.5 / SPRITE_SCALE);
    this.sprite.entityRef = this;

    // Pulsing glow on sprite + halo
    scene.tweens.add({
      targets: this.sprite,
      scaleX: SPRITE_SCALE * 1.4,
      scaleY: SPRITE_SCALE * 1.4,
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    scene.tweens.add({
      targets: this.halo,
      alpha: 0.25,
      scaleX: 1.4,
      scaleY: 1.4,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Name tag floating above
    const TAG_NAMES = {
      CODE_REVIEW: 'CODE REVIEW',
      GITIGNORE: '.GITIGNORE',
      LINTER: 'LINTER',
      MINES: 'MINE LAYER',
      TRIPLE_SHOT: 'TRIPLE SHOT',
    };
    const tagSize = Math.round(GAME.HEIGHT * 0.014);
    this.nameTag = scene.add.text(x, y - config.width * 1.2, TAG_NAMES[typeName] || typeName, {
      fontSize: tagSize + 'px',
      fontFamily: '"Courier New", Courier, monospace',
      color: '#' + haloColor.toString(16).padStart(6, '0'),
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
      type: this.typeName,
      x: this.sprite.x,
      y: this.sprite.y,
      config: this.config,
    });

    // Quick collect animation — sprite + halo burst
    this.scene.tweens.add({
      targets: this.sprite,
      alpha: 0,
      scaleX: SPRITE_SCALE * 2,
      scaleY: SPRITE_SCALE * 2,
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
