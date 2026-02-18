import Phaser from 'phaser';
import { renderSpriteSheet, renderPixelArt } from '../core/PixelRenderer.js';
import { PIXEL_SCALE } from '../core/Constants.js';
import { PLAYER_FRAMES } from '../sprites/player.js';
// Enemy sprites are now generated procedurally in Enemy.js constructor
import { XP_GEM_SMALL, XP_GEM_MEDIUM, XP_GEM_LARGE, POWERUP_CODE_REVIEW, POWERUP_GITIGNORE, POWERUP_LINTER } from '../sprites/items.js';
import { BRACKET_PROJECTILE, LASER_CAPSULE, LINTER_ORB, MINE_SPRITE, ICON_TRIPLE } from '../sprites/projectiles.js';
import { DECO_SLOP_DEBRIS } from '../sprites/tiles.js';
import { BED_SPRITE } from '../sprites/intro.js';
import { SHIP_FRAMES, SHIP_DESTROYED } from '../sprites/ship.js';
import { PALETTE } from '../sprites/palette.js';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create() {
    const S = PIXEL_SCALE;

    // Pre-render all textures in BootScene so they are cached globally

    // Player (intro cutscene dev character)
    renderSpriteSheet(this, PLAYER_FRAMES, PALETTE, 'player-sheet', S);

    // Enemies (old static sprites — still imported but no longer used for rendering)
    // Enemies now generate their own procedural textures in Enemy.js constructor

    // Items
    renderPixelArt(this, XP_GEM_SMALL, PALETTE, 'xp-gem-small', S);
    renderPixelArt(this, XP_GEM_MEDIUM, PALETTE, 'xp-gem-medium', S);
    renderPixelArt(this, XP_GEM_LARGE, PALETTE, 'xp-gem-large', S);
    renderPixelArt(this, POWERUP_CODE_REVIEW, PALETTE, 'powerup-code-review', S);
    renderPixelArt(this, POWERUP_GITIGNORE, PALETTE, 'powerup-gitignore', S);
    renderPixelArt(this, POWERUP_LINTER, PALETTE, 'powerup-linter', S);
    renderPixelArt(this, MINE_SPRITE, PALETTE, 'powerup-mines', S);
    renderPixelArt(this, ICON_TRIPLE, PALETTE, 'powerup-triple-shot', S);

    // Ship — hand-crafted sprites
    renderSpriteSheet(this, SHIP_FRAMES, PALETTE, 'ship-sheet', S);
    renderPixelArt(this, SHIP_DESTROYED, PALETTE, 'ship-destroyed', S);

    // Intro bed
    renderPixelArt(this, BED_SPRITE, PALETTE, 'intro-bed', S);

    // Projectiles
    renderPixelArt(this, BRACKET_PROJECTILE, PALETTE, 'projectile-bracket', S);
    renderPixelArt(this, LASER_CAPSULE, PALETTE, 'projectile-laser', S);
    renderPixelArt(this, LINTER_ORB, PALETTE, 'linter-orb', S);

    // Decorations
    renderPixelArt(this, DECO_SLOP_DEBRIS, PALETTE, 'deco-slop', S);

    // Create animations
    this.anims.create({
      key: 'player-idle',
      frames: [{ key: 'player-sheet', frame: 0 }],
      frameRate: 1,
      repeat: 0,
    });
    this.anims.create({
      key: 'player-walk',
      frames: this.anims.generateFrameNumbers('player-sheet', { start: 0, end: 3 }),
      frameRate: 8,
      repeat: -1,
    });

    this.scene.start('MenuScene');
  }

}
