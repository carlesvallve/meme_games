import Phaser from 'phaser';
import { GAME, PLAYER, COLORS, PX, PIXEL_SCALE, TRANSITION, ARENA, POWERUP_TYPES, TOUCH, XP_GEM, INTRO, VFX, PARALLAX, WEAPONS, KNOCKBACK } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';
import { Player } from '../entities/Player.js';
import { WaveSystem } from '../systems/WaveSystem.js';
import { WeaponSystem } from '../systems/WeaponSystem.js';
import { LevelSystem } from '../systems/LevelSystem.js';
import { XPGem } from '../entities/XPGem.js';
import { PowerUp } from '../entities/PowerUp.js';
import { VFXSystem } from '../systems/VFXSystem.js';
// Pixel art imports kept for potential future use
// import { renderPixelArt } from '../core/PixelRenderer.js';
// import { DECO_SLOP_DEBRIS } from '../sprites/tiles.js';
// import { PALETTE } from '../sprites/palette.js';
import { DialogBubble } from '../ui/DialogBubble.js';
import { SpeechBubble } from '../ui/SpeechBubble.js';
import { POWERUP_QUOTES } from '../ui/PowerupQuotes.js';
import { DEV_QUOTES, MONSTER_QUOTES } from '../ui/DevQuotes.js';
import { playStartEngine, playUpdateEngine, playStopEngine, playPauseEngine, playResumeEngine, duckMusic, unduckMusic, startFootsteps, stopFootsteps, playEnemyHitSfx } from '../audio/AudioBridge.js';
import { LightingSystem } from '../core/LightingSystem.js';
import { VirtualJoystick } from '../ui/VirtualJoystick.js';

/** Convert a 0xRRGGBB integer to a CSS 'rgb(r,g,b)' string */
function intToCSS(c) {
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  return `rgb(${r},${g},${b})`;
}

/** Color schemes for speech bubbles — color-coded by entity type */
const BUBBLE_COLORS = {
  // Dev / player: blue tones
  DEV: { borderColor: 0x4488ff, textColor: '#bbddff' },
  // Monsters: each type's color
  COPILOT: { borderColor: 0x44ff44, textColor: '#aaffaa' },
  PR: { borderColor: 0xff8833, textColor: '#ffcc88' },
  SUGGESTION: { borderColor: 0x9944ff, textColor: '#ddaaff' },
  BOSS: { borderColor: 0xff4444, textColor: '#ffaa88' },
};

/** Get bubble colors for an enemy based on its type */
function getEnemyBubbleColors(enemy) {
  if (enemy.isBoss) return BUBBLE_COLORS.BOSS;
  return BUBBLE_COLORS[enemy.typeName] || BUBBLE_COLORS.COPILOT;
}

export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  create() {
    gameState.reset();
    this.cameras.main.setBackgroundColor(0x080808);

    // Mobile detection — prefer display config, fallback to device detection
    this.isMobile = GAME.IS_MOBILE || this.sys.game.device.os.android ||
      this.sys.game.device.os.iOS || this.sys.game.device.os.iPad;

    // --- Physics world bounds (arena-sized) ---
    this.physics.world.setBounds(0, 0, ARENA.WIDTH, ARENA.HEIGHT);

    // --- Parallax background layers ---
    this.createParallaxLayers();

    // --- Arena floor with grid ---
    this.drawArenaFloor();

    // --- Player ---
    this.player = new Player(this);

    // --- Camera follow ---
    this.cameras.main.startFollow(this.player.sprite, true, 0.08, 0.08);
    this.cameras.main.setBounds(0, 0, ARENA.WIDTH, ARENA.HEIGHT);

    // Mobile: zoom in so game objects are larger and more visible
    if (this.isMobile) {
      this.cameras.main.setZoom(1.8);
    }

    // --- Systems ---
    this.waveSystem = new WaveSystem(this);
    this.weaponSystem = new WeaponSystem(this);
    this.levelSystem = new LevelSystem(this);
    this.vfxSystem = new VFXSystem(this);

    // --- Lighting system ---
    this.lighting = new LightingSystem(this, {
      width: GAME.WIDTH,
      height: GAME.HEIGHT,
      ambient: 0.75,
      maxLights: 32,
      gradientSize: 128,
      falloffInner: 0.3,
      falloffMid: 0.6,
      innerAlpha: 0.95,
      midAlpha: 0.5,
    });
    this.lighting.setActive(true);

    // --- Collectibles ---
    this.xpGems = [];
    this.powerUps = [];

    // --- Timer ---
    this.gameTimer = 0;

    // --- Speech bubble tracking ---
    this._slopDetectedTriggered = false;
    this._lastDevBubbleTime = 0;
    this._devBubbleCooldown = 12000; // ms between random dev battle cries
    this._lastMonsterBubbleTime = 0;
    this._monsterBubbleCooldown = 8000; // ms between random monster bubbles
    this._lastBossQuoteTime = 0;

    // --- Adaptive music intensity tracking ---
    this._musicTier = 1;
    this._lastIntensityCheck = 0;
    this._intensityCheckInterval = 3000; // evaluate every 3 seconds
    this._recentKills = []; // timestamps of recent kills for kill-rate calc

    // --- Input ---
    this.setupInput();

    // --- Event listeners ---
    this.onEnemyKilled = this.handleEnemyKilled.bind(this);
    this.onWeaponUpgrade = this.handleWeaponUpgrade.bind(this);
    this.onPowerupCollected = this.handlePowerupCollected.bind(this);
    this.onBossSpawn = this.handleBossSpawn.bind(this);
    this.onLevelUp = this.handleLevelUp.bind(this);

    eventBus.on(Events.ENEMY_KILLED, this.onEnemyKilled);
    eventBus.on(Events.WEAPON_UPGRADE, this.onWeaponUpgrade);
    eventBus.on(Events.POWERUP_COLLECTED, this.onPowerupCollected);
    eventBus.on(Events.BOSS_SPAWN, this.onBossSpawn);
    eventBus.on(Events.LEVEL_UP, this.onLevelUp);

    // --- Audio: start gameplay music ---
    eventBus.emit(Events.MUSIC_GAMEPLAY);

    // --- Intro cutscene ---
    this.introPlaying = true;
    this.playIntro();

    // Fade in
    this.cameras.main.fadeIn(TRANSITION.FADE_DURATION, 0, 0, 0);

    // Cleanup on shutdown
    this.events.on('shutdown', () => {
      playStopEngine();
      eventBus.off(Events.ENEMY_KILLED, this.onEnemyKilled);
      eventBus.off(Events.WEAPON_UPGRADE, this.onWeaponUpgrade);
      eventBus.off(Events.POWERUP_COLLECTED, this.onPowerupCollected);
      eventBus.off(Events.BOSS_SPAWN, this.onBossSpawn);
      eventBus.off(Events.LEVEL_UP, this.onLevelUp);
      this.waveSystem.destroy();
      this.weaponSystem.destroy();
      this.levelSystem.destroy();
      this.vfxSystem.destroy();
      if (this.lighting) this.lighting.destroy();
    });
  }

  createParallaxLayers() {
    // Each layer is drawn onto a canvas texture, then tiled as a TileSprite
    // so it seamlessly repeats as the camera scrolls.

    // --- Far layer (depth -30, scrollFactor 0.3): Hexagonal grid ---
    this._parallaxFar = this._createHexGridLayer({
      depth: -30,
      scrollFactor: PARALLAX.FAR_FACTOR,
      cellSize: 80,
      lineColor: 0xffffff,
      lineAlpha: 0.06,
      lineWidth: 1,
      glowColor: 0xffffff,
      glowAlpha: 0.02,
    });

    // --- Mid layer (depth -20, scrollFactor 0.6): Nebula clouds (no grid lines) ---
    this._parallaxMid = this._createNebulaLayer({
      depth: -20,
      scrollFactor: PARALLAX.MID_FACTOR,
      count: 25,
      minRadius: 40 * PX,
      maxRadius: 120 * PX,
      color: 0xffffff,
      minAlpha: 0.02,
      maxAlpha: 0.06,
    });

    // --- Grid layer (depth -12, scrollFactor 0.7): Created lazily at tier 2+ ---
    this._parallaxGrid = null;

    // --- Near layer (depth -15, scrollFactor 0.85): Clean translucent circles ---
    this._parallaxNearCircles = this._createCircleLayer({
      depth: -15,
      scrollFactor: PARALLAX.NEAR_FACTOR,
      count: 30,
      minRadius: 15 * PX,
      maxRadius: 60 * PX,
      color: 0xffffff,
      minAlpha: 0.05,
      maxAlpha: 0.14,
    });
    // Store a dummy for tint fading (we tint circles directly)
    this._parallaxNear = null;

    // --- Set initial tint to random themes per layer (no grid at start) ---
    const allPools = [PARALLAX.COLOR_THEMES_VIVID, PARALLAX.COLOR_THEMES_MUTED];
    const pickRandom = () => {
      const pool = Phaser.Utils.Array.GetRandom(allPools);
      return Phaser.Utils.Array.GetRandom(pool);
    };
    const farStart = pickRandom();
    const midStart = pickRandom();
    const nearStart = pickRandom();
    this._parallaxFar.setTint(farStart[0]);
    // Mid layer is now nebula blobs — set their fill color
    if (this._parallaxMid) {
      for (const c of this._parallaxMid) {
        c.obj.setFillStyle(midStart[1], c.baseAlpha);
      }
    }
    // Grid layer created lazily at tier 2+ — nothing to set here
    // Near layer uses circles — set their fill color
    if (this._parallaxNearCircles) {
      for (const c of this._parallaxNearCircles) {
        c.obj.setFillStyle(nearStart[2], c.baseAlpha);
      }
    }

    // --- BG color fading system ---
    this._initColorFading();
  }

  _createHexGridLayer({ depth, scrollFactor, cellSize, lineColor, lineAlpha, lineWidth, glowColor, glowAlpha }) {
    // Canvas-based hex grid texture that tiles seamlessly
    const tileW = Math.ceil(cellSize * 3);
    const tileH = Math.ceil(cellSize * Math.sqrt(3) * 2);
    const canvas = document.createElement('canvas');
    canvas.width = tileW;
    canvas.height = tileH;
    const ctx = canvas.getContext('2d');

    const r = cellSize;
    const h = r * Math.sqrt(3) / 2;

    // Draw hex edges
    const hexColor = intToCSS(lineColor);
    const glowHex = intToCSS(glowColor);

    const drawHex = (cx, cy) => {
      // Glow
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const px = cx + r * 0.9 * Math.cos(angle);
        const py = cy + r * 0.9 * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = glowHex;
      ctx.globalAlpha = glowAlpha;
      ctx.lineWidth = lineWidth + 4;
      ctx.stroke();

      // Crisp line
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const px = cx + r * 0.9 * Math.cos(angle);
        const py = cy + r * 0.9 * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = hexColor;
      ctx.globalAlpha = lineAlpha;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    };

    // Tile hex grid pattern (offset rows)
    const colSpacing = r * 1.5;
    const rowSpacing = h * 2;
    for (let row = -1; row < tileH / rowSpacing + 1; row++) {
      for (let col = -1; col < tileW / colSpacing + 1; col++) {
        const offsetY = col % 2 === 0 ? 0 : h;
        drawHex(col * colSpacing, row * rowSpacing + offsetY);
      }
    }

    const texKey = '__parallax_hex__';
    if (this.textures.exists(texKey)) this.textures.remove(texKey);
    this.textures.addCanvas(texKey, canvas);

    // Cover enough area to account for parallax shift
    const coverW = ARENA.WIDTH + GAME.WIDTH;
    const coverH = ARENA.HEIGHT + GAME.HEIGHT;
    const layer = this.add.tileSprite(coverW / 2, coverH / 2, coverW, coverH, texKey);
    layer.setDepth(depth);
    layer.setScrollFactor(scrollFactor);
    layer.setAlpha(1);
    return layer;
  }

  _createDiagonalLayer({ depth, scrollFactor, spacing, lineColor, lineAlpha, lineWidth, dotColor, dotAlpha, dotCount }) {
    const tileSize = spacing * 4;
    const canvas = document.createElement('canvas');
    canvas.width = tileSize;
    canvas.height = tileSize;
    const ctx = canvas.getContext('2d');

    const color = intToCSS(lineColor);
    ctx.strokeStyle = color;
    ctx.globalAlpha = lineAlpha;
    ctx.lineWidth = lineWidth;

    // Diagonal lines (both directions)
    for (let i = -tileSize; i < tileSize * 2; i += spacing) {
      // Top-left to bottom-right
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + tileSize, tileSize);
      ctx.stroke();
      // Top-right to bottom-left
      ctx.beginPath();
      ctx.moveTo(i + tileSize, 0);
      ctx.lineTo(i, tileSize);
      ctx.stroke();
    }

    // Glowing dots at intersections
    const dot = intToCSS(dotColor);
    ctx.fillStyle = dot;
    for (let i = 0; i < dotCount; i++) {
      const dx = Math.random() * tileSize;
      const dy = Math.random() * tileSize;
      ctx.globalAlpha = dotAlpha * (0.3 + Math.random() * 0.7);
      ctx.beginPath();
      ctx.arc(dx, dy, 1.5 + Math.random(), 0, Math.PI * 2);
      ctx.fill();
    }

    const texKey = '__parallax_diag__';
    if (this.textures.exists(texKey)) this.textures.remove(texKey);
    this.textures.addCanvas(texKey, canvas);

    const coverW = ARENA.WIDTH + GAME.WIDTH;
    const coverH = ARENA.HEIGHT + GAME.HEIGHT;
    const layer = this.add.tileSprite(coverW / 2, coverH / 2, coverW, coverH, texKey);
    layer.setDepth(depth);
    layer.setScrollFactor(scrollFactor);
    layer.setAlpha(1);
    return layer;
  }

  _createGridLayer({ depth, scrollFactor }) {
    // Randomly pick a grid style
    const style = Phaser.Math.Between(0, 2); // 0=hex, 1=square, 2=diamond
    const cellSize = 200;
    const lineAlpha = 0.15;
    const lineWidth = 1.5;

    let tileW, tileH;
    if (style === 0) {
      // Hex grid tile dimensions
      tileW = Math.ceil(cellSize * 3);
      tileH = Math.ceil(cellSize * Math.sqrt(3) * 2);
    } else {
      tileW = cellSize * 4;
      tileH = cellSize * 4;
    }

    const canvas = document.createElement('canvas');
    canvas.width = tileW;
    canvas.height = tileH;
    const ctx = canvas.getContext('2d');

    ctx.strokeStyle = 'rgb(255,255,255)';
    ctx.globalAlpha = lineAlpha;
    ctx.lineWidth = lineWidth;

    if (style === 0) {
      // Hexagonal grid
      const r = cellSize;
      const h = r * Math.sqrt(3) / 2;
      const colSpacing = r * 1.5;
      const rowSpacing = h * 2;
      const drawHex = (cx, cy) => {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i - Math.PI / 6;
          const px = cx + r * 0.9 * Math.cos(angle);
          const py = cy + r * 0.9 * Math.sin(angle);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.stroke();
      };
      for (let row = -1; row < tileH / rowSpacing + 1; row++) {
        for (let col = -1; col < tileW / colSpacing + 1; col++) {
          const offsetY = col % 2 === 0 ? 0 : h;
          drawHex(col * colSpacing, row * rowSpacing + offsetY);
        }
      }
    } else if (style === 1) {
      // Square grid
      for (let x = 0; x <= tileW; x += cellSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, tileH);
        ctx.stroke();
      }
      for (let y = 0; y <= tileH; y += cellSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(tileW, y);
        ctx.stroke();
      }
    } else {
      // Diamond / diagonal grid
      for (let i = -tileH; i < tileW + tileH; i += cellSize) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + tileH, tileH);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(i + tileH, 0);
        ctx.lineTo(i, tileH);
        ctx.stroke();
      }
    }

    const texKey = '__parallax_gridlayer__';
    if (this.textures.exists(texKey)) this.textures.remove(texKey);
    this.textures.addCanvas(texKey, canvas);

    const coverW = ARENA.WIDTH + GAME.WIDTH;
    const coverH = ARENA.HEIGHT + GAME.HEIGHT;
    const layer = this.add.tileSprite(coverW / 2, coverH / 2, coverW, coverH, texKey);
    layer.setDepth(depth);
    layer.setScrollFactor(scrollFactor);
    layer.setAlpha(0); // starts hidden — only fades in at higher intensity tiers
    return layer;
  }

  _createCircleLayer({ depth, scrollFactor, count, minRadius, maxRadius, color, minAlpha, maxAlpha }) {
    const circles = [];
    for (let i = 0; i < count; i++) {
      const x = Phaser.Math.Between(0, ARENA.WIDTH);
      const y = Phaser.Math.Between(0, ARENA.HEIGHT);
      const radius = minRadius + Math.random() * (maxRadius - minRadius);
      const alpha = minAlpha + Math.random() * (maxAlpha - minAlpha);

      const circle = this.add.circle(x, y, radius, color, alpha);
      circle.setDepth(depth);
      circle.setScrollFactor(scrollFactor);
      circles.push({ obj: circle, baseAlpha: alpha });
    }
    return circles;
  }

  _createNebulaLayer({ depth, scrollFactor, count, minRadius, maxRadius, color, minAlpha, maxAlpha }) {
    const blobs = [];
    for (let i = 0; i < count; i++) {
      const x = Phaser.Math.Between(0, ARENA.WIDTH);
      const y = Phaser.Math.Between(0, ARENA.HEIGHT);
      const radius = minRadius + Math.random() * (maxRadius - minRadius);
      const alpha = minAlpha + Math.random() * (maxAlpha - minAlpha);

      // Each nebula blob is a soft ellipse (stretched circle)
      const blob = this.add.circle(x, y, radius, color, alpha);
      blob.setDepth(depth);
      blob.setScrollFactor(scrollFactor);
      blob.setScale(1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
      blobs.push({ obj: blob, baseAlpha: alpha });
    }
    return blobs;
  }

  /**
   * Initialize the BG color fading system.
   * Periodically picks a new color theme and tweens each parallax layer's tint.
   */
  _initColorFading() {
    const vivid = PARALLAX.COLOR_THEMES_VIVID;
    const muted = PARALLAX.COLOR_THEMES_MUTED;
    this._bgColorIndex = 0;

    /** Pick a random theme for a layer, independently choosing muted or vivid */
    const pickLayerTheme = () => {
      const useVivid = Math.random() < 0.55; // slight bias toward vivid
      const pool = useVivid ? vivid : muted;
      return pool[Phaser.Math.Between(0, pool.length - 1)];
    };

    // Schedule recurring color transitions
    const scheduleNext = () => {
      if (!this.scene || !this.scene.isActive()) return;

      // Each layer picks independently — muted or vivid, different theme index
      // This creates natural contrast: a vivid near layer over a muted far layer, etc.
      const farTheme = pickLayerTheme();
      const midTheme = pickLayerTheme();
      const nearTheme = pickLayerTheme();

      // Tween each layer's tint
      this._tweenLayerTint(this._parallaxFar, farTheme[0], PARALLAX.COLOR_FADE_DURATION);
      // Mid layer is nebula blobs — tween circle fill colors
      this._tweenCircleColors(this._parallaxMid, midTheme[1], PARALLAX.COLOR_FADE_DURATION);
      this._tweenLayerTint(this._parallaxGrid, midTheme[1], PARALLAX.COLOR_FADE_DURATION);
      // Near layer — tween circle fill colors
      this._tweenCircleColors(this._parallaxNearCircles, nearTheme[2], PARALLAX.COLOR_FADE_DURATION);

      // Also fade the amoeba blobs — mix of current layer colors
      if (this._amoebas && Math.random() < 0.5) {
        const blobColors = [farTheme[0], midTheme[1], nearTheme[2]];
        for (const blob of this._amoebas) {
          blob.color = Phaser.Utils.Array.GetRandom(blobColors);
        }
      }

      // Schedule next transition after fade + hold
      this.time.delayedCall(
        PARALLAX.COLOR_FADE_DURATION + PARALLAX.COLOR_HOLD_DURATION,
        scheduleNext
      );
    };

    // Start after initial hold
    this.time.delayedCall(PARALLAX.COLOR_HOLD_DURATION, scheduleNext);
  }

  /**
   * Smoothly tween a TileSprite's tint from current to target color.
   */
  _tweenLayerTint(layer, targetColor, duration) {
    if (!layer || !layer.active) return;

    // Extract current tint RGB (Phaser stores tint per corner, use tintTopLeft)
    const currentTint = layer.tintTopLeft || 0xffffff;
    const cr = (currentTint >> 16) & 0xff;
    const cg = (currentTint >> 8) & 0xff;
    const cb = currentTint & 0xff;

    const tr = (targetColor >> 16) & 0xff;
    const tg = (targetColor >> 8) & 0xff;
    const tb = targetColor & 0xff;

    // Use a proxy object for the tween
    const proxy = { r: cr, g: cg, b: cb };
    this.tweens.add({
      targets: proxy,
      r: tr,
      g: tg,
      b: tb,
      duration,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        if (!layer.active) return;
        const color = (Math.round(proxy.r) << 16) | (Math.round(proxy.g) << 8) | Math.round(proxy.b);
        layer.setTint(color);
      },
    });
  }

  /**
   * Smoothly tween circle layer fill colors.
   */
  _tweenCircleColors(circles, targetColor, duration) {
    if (!circles || circles.length === 0) return;

    // Use the first circle's current color as the starting point
    const sample = circles[0].obj;
    const currentColor = sample.fillColor || 0x44ddff;
    const cr = (currentColor >> 16) & 0xff;
    const cg = (currentColor >> 8) & 0xff;
    const cb = currentColor & 0xff;

    const tr = (targetColor >> 16) & 0xff;
    const tg = (targetColor >> 8) & 0xff;
    const tb = targetColor & 0xff;

    const proxy = { r: cr, g: cg, b: cb };
    this.tweens.add({
      targets: proxy,
      r: tr,
      g: tg,
      b: tb,
      duration,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        const color = (Math.round(proxy.r) << 16) | (Math.round(proxy.g) << 8) | Math.round(proxy.b);
        for (const c of circles) {
          if (c.obj && c.obj.active) {
            c.obj.setFillStyle(color, c.baseAlpha);
          }
        }
      },
    });
  }

  async playIntro() {
    const { BED_X, BED_Y, STAND_X, STAND_Y, SHIP_PARK_X, SHIP_PARK_Y, WAKE_DURATION, GET_OUT_DURATION, WALK_DURATION, BOARD_DURATION } = INTRO;

    this.introDialog = new DialogBubble(this);

    // Snap camera to intro area immediately
    this.cameras.main.centerOn(ARENA.CENTER_X, ARENA.CENTER_Y);

    // Place ship at parked position (will be adjusted to floor after floorY is computed)
    this.player.sprite.setPosition(SHIP_PARK_X, SHIP_PARK_Y);
    this.player.sprite.setAlpha(1);
    this.player.sprite.setFrame(0);
    this.player.sprite.setRotation(0);

    // Common floor level — everything rests here
    const floorY = BED_Y + 12 * PX;
    // Bottom transparent padding = empty rows × PIXEL_SCALE (texture) × PX (runtime scale)
    // so art pixels (not canvas edge) touch the floor
    const pxSize = PIXEL_SCALE * PX; // size of one sprite-matrix pixel on screen
    const devPadding = 4 * pxSize;   // player: rows 12-15 empty
    const bedPadding = 0;            // bed fills its grid
    const shipPadding = 0;           // ship fills its grid

    // Adjust ship to sit on floor — origin bottom so sprite bottom touches line
    this.player.sprite.setOrigin(0.5, 1);
    this.player.sprite.setY(floorY + shipPadding);

    // Floor line (thick, matching character blue)
    const floorLine = this.add.graphics();
    floorLine.lineStyle(10 * PX, 0x5588ff, 0.35);
    floorLine.lineBetween(
      ARENA.CENTER_X - 180 * PX, floorY,
      ARENA.CENTER_X + 300 * PX, floorY
    );
    floorLine.setDepth(4);
    this._introFloorLine = floorLine;

    // Create bed sprite (bigger, origin bottom-center, sits on floor)
    const bedScale = PX * 1.8;
    const bed = this.add.image(BED_X, floorY + bedPadding, 'intro-bed');
    bed.setScale(bedScale);
    bed.setOrigin(0.5, 1); // bottom edge on floor
    bed.setDepth(5);

    // Dev sprite — origin bottom so sprite bottom sits on floor
    const dev = this.add.sprite(BED_X, floorY + devPadding, 'player-sheet', 0);
    dev.setScale(PX);
    dev.setOrigin(0.5, 1); // bottom edge on floor
    dev.setDepth(12);
    dev.setAlpha(0);
    this._introDev = dev; // store ref so update loop can track it for lighting

    // --- Step 1: Wake up (appear at bed) ---
    await this._tweenPromise({
      targets: dev,
      alpha: 1,
      scaleX: PX,
      scaleY: PX,
      duration: WAKE_DURATION,
      ease: 'Back.easeOut',
    });

    // --- Step 2: Get out of bed (walk away so bed and dev are both visible) ---
    if (this.anims.exists('player-walk')) {
      dev.play('player-walk');
    }
    startFootsteps(220);
    await this._tweenPromise({
      targets: dev,
      x: STAND_X,
      y: floorY + devPadding,
      duration: GET_OUT_DURATION,
      ease: 'Sine.easeOut',
    });
    stopFootsteps();
    dev.stop();
    dev.setFrame(0);

    // --- Step 3: Dialog (dev is standing, bed visible behind) ---
    await this.introDialog.show('Dev', "Let's do some Vibe Coding today!", {
      onShow: () => this.freezeWorld(),
      onDismiss: () => this.unfreezeWorld(),
    });

    // --- Step 4: Walk from standing position to ship ---
    if (this.anims.exists('player-walk')) {
      dev.play('player-walk');
    }
    startFootsteps(200);
    await this._tweenPromise({
      targets: dev,
      x: SHIP_PARK_X,
      y: floorY + devPadding,
      duration: WALK_DURATION,
      ease: 'Sine.easeInOut',
    });
    stopFootsteps();

    // --- Step 5: Board ship — ship becomes controllable immediately ---
    dev.stop();

    // Dev fades into ship
    const devFade = this._tweenPromise({
      targets: dev,
      alpha: 0,
      scaleX: PX * 0.5,
      scaleY: PX * 0.5,
      duration: BOARD_DURATION,
      ease: 'Quad.easeIn',
    });

    // Blink effect on ship as dev boards
    this.time.addEvent({
      delay: 80,
      repeat: 4,
      callback: () => {
        if (this.player.sprite.active) {
          this.player.sprite.setTint(0x66ccff);
          this.time.delayedCall(40, () => {
            if (this.player.sprite.active) this.player.sprite.clearTint();
          });
        }
      },
    });

    await devFade;
    dev.destroy();
    this._introDev = null;

    // Fade out bed and floor line
    this.tweens.add({
      targets: bed,
      alpha: 0,
      duration: 800,
      onComplete: () => bed.destroy(),
    });
    if (this._introFloorLine) {
      this.tweens.add({
        targets: this._introFloorLine,
        alpha: 0,
        duration: 800,
        onComplete: () => {
          this._introFloorLine.destroy();
          this._introFloorLine = null;
        },
      });
    }

    // Reset ship origin back to center for gameplay
    this.player.sprite.setOrigin(0.5, 0.5);

    // --- Ship is NOW controllable — no scripted liftoff ---
    this.introPlaying = false;
    gameState.started = true;
    this.waveSystem.start();
    this.introDialog = null;

    // Engines on sound + start continuous engine hum
    eventBus.emit(Events.SHIP_BOARD);
    playStartEngine();

    // Initial thrust bump — ship lurches forward on boarding
    const bumpForce = PLAYER.THRUST_FORCE * 0.4;
    this.player.vx += this.player.facingX * bumpForce;
    this.player.vy += this.player.facingY * bumpForce;

    // Track first thrust to show a liftoff speech bubble
    this._waitingForFirstThrust = true;
  }

  /** Promisified tween helper */
  _tweenPromise(config) {
    return new Promise((resolve) => {
      this.tweens.add({
        ...config,
        onComplete: () => resolve(),
      });
    });
  }

  /** Promisified delay helper */
  _delay(ms) {
    return new Promise((resolve) => {
      this.time.delayedCall(ms, resolve);
    });
  }

  drawArenaFloor() {
    // No opaque floor tiles — the parallax layers ARE the background.
    // Create animated amoeba-like blobs that drift, expand, and morph.
    this._amoebas = [];
    const blobCount = 18;
    const colors = [0x0044ff, 0x00cc44, 0xff4400, 0x8800ff, 0xffcc00, 0xff0055, 0x00dddd];

    for (let i = 0; i < blobCount; i++) {
      const gfx = this.add.graphics();
      gfx.setDepth(-8);

      const blob = {
        gfx,
        x: Phaser.Math.Between(100, ARENA.WIDTH - 100),
        y: Phaser.Math.Between(100, ARENA.HEIGHT - 100),
        baseRadius: 40 * PX + Math.random() * 80 * PX,
        color: Phaser.Utils.Array.GetRandom(colors),
        alpha: 0.05 + Math.random() * 0.08,
        // Movement
        driftAngle: Math.random() * Math.PI * 2,
        driftSpeed: 3 * PX + Math.random() * 8 * PX, // very slow
        // Morphing — each blob has unique phase offsets for organic feel
        lobes: 5 + Math.floor(Math.random() * 4), // 5-8 lobes
        phaseOffsets: [],
        ampFactors: [],
        freqFactors: [],
        pulsePhase: Math.random() * Math.PI * 2,
        pulseSpeed: 0.3 + Math.random() * 0.5,
        morphSpeed: 0.4 + Math.random() * 0.6,
      };

      // Each lobe gets a unique phase, amplitude, and speed modifier
      for (let l = 0; l < blob.lobes; l++) {
        blob.phaseOffsets.push(Math.random() * Math.PI * 2);
        blob.ampFactors.push(0.15 + Math.random() * 0.25);
        blob.freqFactors.push(0.8 + Math.random() * 0.4);
      }

      this._amoebas.push(blob);
    }
  }

  /**
   * Update amoeba blobs — called each frame for organic morphing movement.
   */
  _updateAmoebas(delta) {
    if (!this._amoebas) return;
    const dt = delta / 1000;
    const time = this.time.now / 1000;

    for (const blob of this._amoebas) {
      // Slow drift movement
      blob.x += Math.cos(blob.driftAngle) * blob.driftSpeed * dt;
      blob.y += Math.sin(blob.driftAngle) * blob.driftSpeed * dt;

      // Gently change drift direction
      blob.driftAngle += (Math.random() - 0.5) * 0.3 * dt;

      // Wrap within arena
      if (blob.x < -blob.baseRadius) blob.x = ARENA.WIDTH + blob.baseRadius;
      if (blob.x > ARENA.WIDTH + blob.baseRadius) blob.x = -blob.baseRadius;
      if (blob.y < -blob.baseRadius) blob.y = ARENA.HEIGHT + blob.baseRadius;
      if (blob.y > ARENA.HEIGHT + blob.baseRadius) blob.y = -blob.baseRadius;

      // Pulsing radius
      const pulse = 1 + Math.sin(time * blob.pulseSpeed + blob.pulsePhase) * 0.15;
      const r = blob.baseRadius * pulse;

      // Redraw the blob shape
      blob.gfx.clear();
      blob.gfx.fillStyle(blob.color, blob.alpha);

      // Draw amoeba shape using sin-modulated radius per angle
      const steps = 32;
      blob.gfx.beginPath();
      for (let s = 0; s <= steps; s++) {
        const angle = (s / steps) * Math.PI * 2;
        // Sum of lobe distortions for organic shape
        let distortion = 0;
        for (let l = 0; l < blob.lobes; l++) {
          distortion += Math.sin(
            angle * (l + 2) + time * blob.morphSpeed * blob.freqFactors[l] + blob.phaseOffsets[l]
          ) * blob.ampFactors[l];
        }
        const pr = r * (1 + distortion);
        const px = blob.x + Math.cos(angle) * pr;
        const py = blob.y + Math.sin(angle) * pr;
        if (s === 0) blob.gfx.moveTo(px, py);
        else blob.gfx.lineTo(px, py);
      }
      blob.gfx.closePath();
      blob.gfx.fillPath();

      // Optional subtle glow ring
      blob.gfx.lineStyle(1.5, blob.color, blob.alpha * 0.6);
      blob.gfx.beginPath();
      for (let s = 0; s <= steps; s++) {
        const angle = (s / steps) * Math.PI * 2;
        let distortion = 0;
        for (let l = 0; l < blob.lobes; l++) {
          distortion += Math.sin(
            angle * (l + 2) + time * blob.morphSpeed * blob.freqFactors[l] + blob.phaseOffsets[l]
          ) * blob.ampFactors[l];
        }
        const pr = r * 1.15 * (1 + distortion * 0.7);
        const px = blob.x + Math.cos(angle) * pr;
        const py = blob.y + Math.sin(angle) * pr;
        if (s === 0) blob.gfx.moveTo(px, py);
        else blob.gfx.lineTo(px, py);
      }
      blob.gfx.closePath();
      blob.gfx.strokePath();
    }
  }

  setupInput() {
    // Keyboard
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    });
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

    // Touch zone state
    this.touchRotateLeft = false;
    this.touchRotateRight = false;
    this.touchThrust = false;
    this.touchFire = false;

    if (this.isMobile) {
      this.input.addPointer(2);
      this.joystick = new VirtualJoystick(this);
    }
  }

  /** Convert screen pointer coords to world coords accounting for camera */
  _pointerToWorld(pointer) {
    const cam = this.cameras.main;
    const wx = (pointer.x - cam.width * 0.5) / cam.zoom + cam.scrollX + cam.width * 0.5;
    const wy = (pointer.y - cam.height * 0.5) / cam.zoom + cam.scrollY + cam.height * 0.5;
    return { x: wx, y: wy };
  }

  update(time, delta) {
    if (gameState.gameOver) {
      // Keep lighting alive after death — just the player glow, no headlight/enemies
      if (this.lighting && this.lighting.active && this.player.sprite) {
        this.lighting.setLight(
          'player',
          this.player.sprite.x,
          this.player.sprite.y,
          180 * PX,
          0.6,
          1.0, 1.0, 1.0
        );
      }
      return;
    }

    // Always animate amoeba blobs (even during intro/freeze)
    this._updateAmoebas(delta);

    // Always update thruster particles (even during intro)
    this.player.updateThrusterParticles(delta);

    // During intro, update lighting on the dev character and return early
    if (this.introPlaying) {
      if (this.player.isThrusting) {
        this.player.emitThrusterParticles();
      }
      // Keep lighting active during intro — follow the dev sprite
      if (this.lighting && this.lighting.active && this._introDev) {
        this.lighting.setLight(
          'player',
          this._introDev.x,
          this._introDev.y,
          200 * PX,
          0.8,
          1.0, 0.95, 0.8
        );
        this.lighting.update();
      }
      return;
    }

    // Pause gameplay during powerup dialog
    if (this._powerupDialogActive) return;

    // Update timer
    this.gameTimer += delta;
    gameState.timeSurvived = Math.floor(this.gameTimer / 1000);

    // --- Input ---
    let rotateInput = 0;
    let thrustInput = 0;
    let fireInput = false;

    // Keyboard
    if (this.cursors.left.isDown || this.wasd.left.isDown) rotateInput -= 1;
    if (this.cursors.right.isDown || this.wasd.right.isDown) rotateInput += 1;
    if (this.cursors.up.isDown || this.wasd.up.isDown) thrustInput = 1;
    if (this.cursors.down.isDown || this.wasd.down.isDown) thrustInput = -1; // reverse thrust
    if (this.spaceKey.isDown) fireInput = true;

    // Mobile: dynamic joystick for direct movement
    // Merged with keyboard so Chrome DevTools mobile sim still works
    if (this.isMobile && this.joystick) {
      const joyInput = this.joystick.getInput();
      if (joyInput.magnitude > 0.01) {
        // Convert joystick direction into rotation + thrust for the ship
        const targetAngle = Math.atan2(joyInput.moveY, joyInput.moveX);
        let rotDiff = targetAngle - this.player.angle;
        while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
        while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
        rotateInput = Math.max(-1, Math.min(1, rotDiff * 3));

        // Detect circular motion: if joystick angle changes fast, user is rotating not thrusting
        if (this._prevJoyAngle !== undefined) {
          let angleDelta = targetAngle - this._prevJoyAngle;
          while (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
          while (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
          // Angular velocity (radians per frame) — high = spinning the stick
          const angularSpeed = Math.abs(angleDelta) / (delta / 1000);
          // Scale thrust down when spinning (>2 rad/s = mostly rotating)
          const spinFactor = Math.max(0, 1 - angularSpeed / 4);
          this._joyThrustScale = spinFactor;
        } else {
          this._joyThrustScale = 1;
        }
        this._prevJoyAngle = targetAngle;

        // If joystick points mostly opposite to facing, reverse while still rotating
        const absDiff = Math.abs(rotDiff);
        if (absDiff > Math.PI * 0.65) {
          thrustInput = -joyInput.magnitude * this._joyThrustScale; // reverse
        } else {
          thrustInput = joyInput.magnitude * this._joyThrustScale;
        }
      } else {
        this._prevJoyAngle = undefined;
      }
    }

    // --- Update systems ---
    this.player.update(rotateInput, thrustInput, delta);

    // Engine sound — always-on hum, pitch/volume scale with velocity
    const speed = Math.sqrt(this.player.vx * this.player.vx + this.player.vy * this.player.vy);
    const speedRatio = Math.min(speed / PLAYER.MAX_SPEED, 1);
    playUpdateEngine(speedRatio);

    // First thrust after boarding triggers a liftoff speech bubble
    if (this._waitingForFirstThrust && thrustInput > 0) {
      this._waitingForFirstThrust = false;
      const line = Phaser.Utils.Array.GetRandom(DEV_QUOTES.LIFTOFF);
      SpeechBubble.show(this, this.player.sprite, line, { duration: 2500, ...BUBBLE_COLORS.DEV });
    }

    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    const enemies = this.waveSystem.getActiveEnemies();

    // --- Laser fire: space bar on desktop, tap-to-shoot on mobile ---
    if (this.isMobile && this.joystick && this.joystick.tapped) {
      this.joystick.tapped = false;
      fireInput = true;
    }
    if (fireInput) {
      this.weaponSystem.fireLaser(
        this.player.sprite.x, this.player.sprite.y,
        this.player.facingX, this.player.facingY, time, enemies
      );
    }

    // Update shield position to follow player
    if (this.player._shieldFollow && this.player.shieldGfx) {
      this.player.shieldGfx.setPosition(this.player.sprite.x, this.player.sprite.y);
    }

    this.waveSystem.update(px, py, delta);
    this.weaponSystem.update(px, py, this.player.facingX, this.player.facingY, enemies, time, this.player.vx, this.player.vy);

    // --- First slop detection: speech bubble when first enemy starts chasing ---
    if (!this._slopDetectedTriggered && enemies.length > 0) {
      for (const enemy of enemies) {
        if (enemy.isChasing) {
          this._slopDetectedTriggered = true;
          // Dev reacts with a blue speech bubble
          const line = Phaser.Utils.Array.GetRandom(DEV_QUOTES.SLOP_DETECTED);
          SpeechBubble.show(this, this.player.sprite, line, { duration: 3000, ...BUBBLE_COLORS.DEV });
          // The chasing enemy also says something in its type color
          const monsterLine = Phaser.Utils.Array.GetRandom(MONSTER_QUOTES.CHASE);
          const eColors = getEnemyBubbleColors(enemy);
          SpeechBubble.show(this, enemy.sprite, monsterLine, {
            duration: 2500,
            ...eColors,
          });
          this._lastDevBubbleTime = this.gameTimer;
          this._lastMonsterBubbleTime = this.gameTimer;
          break;
        }
      }
    }

    // --- Periodic random speech bubbles (no pause) ---
    this._updateRandomBubbles(enemies);

    // --- Adaptive music intensity ---
    this._updateMusicIntensity(enemies);

    // --- Collision: projectiles vs enemies ---
    const projectiles = this.weaponSystem.getActiveProjectiles();
    for (const proj of projectiles) {
      if (proj.dead) continue;
      for (const enemy of enemies) {
        if (enemy.dead) continue;
        const dx = proj.sprite.x - enemy.sprite.x;
        const dy = proj.sprite.y - enemy.sprite.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const hitDist = enemy.config.width * 0.5 + proj.sprite.body.halfWidth;
        if (dist < hitDist) {
          // Knockback: push enemy away from projectile
          if (enemy.sprite.body && dist > 0) {
            const kx = -dx / dist * KNOCKBACK.ENEMY_HIT;
            const ky = -dy / dist * KNOCKBACK.ENEMY_HIT;
            enemy.sprite.body.velocity.x += kx;
            enemy.sprite.body.velocity.y += ky;
          }

          playEnemyHitSfx();

          // Homing missiles explode on impact (splash damage)
          if (proj.explode) {
            proj.explode();
          } else {
            enemy.takeDamage(proj.damage);
            proj.destroy();
          }
          break;
        }
      }
    }

    // --- Collision: enemies vs player ---
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      const dx = px - enemy.sprite.x;
      const dy = py - enemy.sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const hitDist = PLAYER.WIDTH * 0.4 + enemy.config.width * 0.4;
      if (dist < hitDist) {
        // Knockback: push player away from enemy
        if (dist > 0) {
          const kx = (dx / dist) * PLAYER.HIT_KNOCKBACK;
          const ky = (dy / dist) * PLAYER.HIT_KNOCKBACK;
          this.player.vx += kx;
          this.player.vy += ky;
        }

        playEnemyHitSfx();

        const dead = this.player.hit(enemy.damage);
        if (dead) {
          this.triggerGameOver();
          return;
        }
      }
    }

    // --- Update XP gems ---
    for (let i = this.xpGems.length - 1; i >= 0; i--) {
      const gem = this.xpGems[i];
      if (gem.collected || !gem.sprite.active) {
        this.xpGems.splice(i, 1);
        continue;
      }
      gem.update(px, py);

      // Check collection
      const dx = px - gem.sprite.x;
      const dy = py - gem.sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < PLAYER.WIDTH * 0.8 + gem.config.size) {
        gem.collect();
      }
    }

    // --- Update power-ups ---
    for (let i = this.powerUps.length - 1; i >= 0; i--) {
      const pu = this.powerUps[i];
      if (pu.collected || !pu.sprite.active) {
        this.powerUps.splice(i, 1);
        continue;
      }
      // Check collection
      const dx = px - pu.sprite.x;
      const dy = py - pu.sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < PLAYER.WIDTH * 0.5 + pu.config.width) {
        pu.collect();
      }
    }

    // --- Update lighting ---
    this._updateLighting(enemies);
  }

  // Toggle flags for lighting features
  _enemyLightsEnabled = false;

  _updateLighting(enemies) {
    if (!this.lighting || !this.lighting.active) return;

    // Player glow — dimmer ambient glow so headlight stands out
    this.lighting.setLight(
      'player',
      this.player.sprite.x,
      this.player.sprite.y,
      180 * PX,
      0.6,
      1.0, 1.0, 1.0
    );

    // Headlight cone — bright directional beam, the main light source
    const facing = Math.atan2(this.player.facingY, this.player.facingX);
    this.lighting.setConeLight(
      'headlight',
      this.player.sprite.x,
      this.player.sprite.y,
      facing,
      500 * PX,
      Math.PI / 3.5,
      1.0,
      1.0, 1.0, 1.0
    );

    // Enemy lights — color-coded per type, short radius
    const ENEMY_LIGHT_COLORS = {
      COPILOT: [0.3, 1.0, 0.3],    // green
      PR: [1.0, 0.5, 0.2],         // orange
      SUGGESTION: [0.6, 0.3, 1.0], // purple
    };
    let enemyIdx = 0;
    const maxEnemyLights = this.lighting.config.maxLights - 6; // reserve slots for player + powerups
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      if (enemy.isBoss) {
        // Boss always gets a light — larger, red
        this.lighting.setLight(
          `enemy-${enemyIdx}`,
          enemy.sprite.x,
          enemy.sprite.y,
          150 * PX,
          0.7,
          1.0, 0.3, 0.2 // red
        );
      } else if (this._enemyLightsEnabled && enemyIdx < maxEnemyLights) {
        const c = ENEMY_LIGHT_COLORS[enemy.typeName] || [0.3, 1.0, 0.3];
        this.lighting.setLight(
          `enemy-${enemyIdx}`,
          enemy.sprite.x,
          enemy.sprite.y,
          60 * PX,
          0.5,
          c[0], c[1], c[2]
        );
      }
      enemyIdx++;
    }
    // Clean stale enemy lights
    for (let i = enemyIdx; i < this._lastEnemyLightCount || 0; i++) {
      this.lighting.removeLight(`enemy-${i}`);
    }
    this._lastEnemyLightCount = enemyIdx;

    // Power-up glows
    for (let i = 0; i < this.powerUps.length; i++) {
      const pu = this.powerUps[i];
      if (pu.collected || !pu.sprite.active) continue;
      const colors = {
        CODE_REVIEW: [1.0, 0.4, 0.2],
        GITIGNORE: [0.2, 0.5, 1.0],
        LINTER: [1.0, 0.9, 0.2],
      };
      const c = colors[pu.typeName] || [1, 1, 1];
      this.lighting.setLight(
        `powerup-${i}`,
        pu.sprite.x,
        pu.sprite.y,
        100 * PX,
        0.7,
        c[0], c[1], c[2]
      );
    }
    // Clean stale power-up lights
    for (let i = this.powerUps.length; i < 10; i++) {
      this.lighting.removeLight(`powerup-${i}`);
    }

    this.lighting.update();
  }

  handleEnemyKilled({ x, y, type, isBoss, xpDrop, config }) {
    // Track kill timestamp for intensity calculation
    this._recentKills.push(this.gameTimer);

    // Spawn XP gem
    let gemSize = 'SMALL';
    if (xpDrop >= 8) gemSize = 'LARGE';
    else if (xpDrop >= 3) gemSize = 'MEDIUM';

    const gem = new XPGem(this, x, y, gemSize);
    this.xpGems.push(gem);

    // Random power-up drop
    const roll = Math.random();
    let cumChance = 0;
    for (const [typeName, cfg] of Object.entries(POWERUP_TYPES)) {
      cumChance += cfg.dropChance;
      if (roll < cumChance) {
        const pu = new PowerUp(this, x, y, typeName);
        this.powerUps.push(pu);
        break;
      }
    }
  }

  handleWeaponUpgrade({ upgrade }) {
    this.weaponSystem.applyUpgrade(upgrade);
    // Resume game after level-up scene
    this.scene.resume('GameScene');
  }

  handlePowerupCollected({ type, x, y, config }) {
    // Apply the powerup effect
    const enemies = this.waveSystem.getActiveEnemies();

    switch (type) {
      case 'CODE_REVIEW':
        this.weaponSystem.activateCodeReview(
          this.player.sprite.x, this.player.sprite.y, enemies
        );
        break;
      case 'GITIGNORE':
        this.player.setShield(true);
        this.time.delayedCall(config.duration, () => {
          this.player.setShield(false);
        });
        break;
      case 'LINTER':
        this.weaponSystem.activateLinter(
          this.player.sprite.x, this.player.sprite.y
        );
        break;
      case 'MINES':
        this.weaponSystem.minesUnlocked = true;
        this.time.delayedCall(config.duration, () => {
          this.weaponSystem.minesUnlocked = false;
        });
        break;
      case 'TRIPLE_SHOT':
        this.weaponSystem.tripleUnlocked = true;
        this.time.delayedCall(config.duration, () => {
          this.weaponSystem.tripleUnlocked = false;
        });
        break;
    }

    // Show a quote dialog (pauses game briefly)
    this.showPowerupQuote(type);
  }

  /**
   * Show a powerup quote with game freeze — the only dialog that pauses gameplay.
   * Gives the player a brief break and shows a deeper quote.
   */
  async showPowerupQuote(type) {
    const quotes = POWERUP_QUOTES[type];
    if (!quotes || quotes.length === 0) return;

    // 50% chance: show specific powerup quote, 50% chance: dev reaction
    const useDevReaction = Math.random() < 0.5 && DEV_QUOTES.POWERUP.length > 0;
    const quoteText = useDevReaction
      ? Phaser.Utils.Array.GetRandom(DEV_QUOTES.POWERUP)
      : Phaser.Utils.Array.GetRandom(quotes).text;

    const dialog = new DialogBubble(this);
    this._powerupDialogActive = true;

    // Use the powerup's name + description as speaker, so player knows what it does
    const powerupConfig = POWERUP_TYPES[type];
    const accentColor = powerupConfig ? powerupConfig.color : null;
    const speaker = powerupConfig ? powerupConfig.name : type;
    const desc = powerupConfig && powerupConfig.desc ? powerupConfig.desc : '';
    const text = desc ? `${desc}\n\n"${quoteText}"` : quoteText;

    // Map type to texture key for the icon
    const ICON_KEYS = {
      CODE_REVIEW: 'powerup-code-review',
      GITIGNORE: 'powerup-gitignore',
      LINTER: 'powerup-linter',
      MINES: 'powerup-mines',
      TRIPLE_SHOT: 'powerup-triple-shot',
    };

    await dialog.show(speaker, text, {
      onShow: () => this.freezeWorld(),
      onDismiss: () => this.unfreezeWorld(),
      accentColor,
      iconKey: ICON_KEYS[type] || null,
    });

    this._powerupDialogActive = false;
    dialog.destroy();
  }

  /**
   * Periodic random speech bubbles on dev and monsters — no pause.
   */
  _updateRandomBubbles(enemies) {
    // Dev battle cry every ~12s
    if (this.gameTimer - this._lastDevBubbleTime > this._devBubbleCooldown) {
      this._lastDevBubbleTime = this.gameTimer;
      // Pick from BATTLE or SURVIVE based on health
      const isLowHealth = this.player.health <= 2;
      const pool = isLowHealth ? DEV_QUOTES.SURVIVE : DEV_QUOTES.BATTLE;
      const line = Phaser.Utils.Array.GetRandom(pool);
      SpeechBubble.show(this, this.player.sprite, line, { duration: 2500, ...BUBBLE_COLORS.DEV });
      // Randomize next cooldown a bit
      this._devBubbleCooldown = 10000 + Math.random() * 8000;
    }

    // Monster bubble every ~8s on a random chasing enemy
    // Enemies in the headlight cone get a much shorter cooldown
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    const fx = this.player.facingX;
    const fy = this.player.facingY;
    const coneHalf = PLAYER.AIM_CONE_HALF;

    // Check if any enemy is in the headlight cone and not already talking
    const litEnemies = enemies.filter(e => {
      if (e.dead || SpeechBubble.hasActive(e.sprite)) return false;
      const dx = e.sprite.x - px;
      const dy = e.sprite.y - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 20 * PX || dist > 400 * PX) return false;
      const dot = (dx * fx + dy * fy) / dist;
      return dot > Math.cos(coneHalf);
    });

    // Lit enemies have a short cooldown (1.5-3s), normal is 6-12s
    const headlightCooldown = 1500 + Math.random() * 1500;
    const useHeadlight = litEnemies.length > 0 &&
      this.gameTimer - this._lastMonsterBubbleTime > headlightCooldown;
    const useNormal = this.gameTimer - this._lastMonsterBubbleTime > this._monsterBubbleCooldown;

    if ((useHeadlight || useNormal) && enemies.length > 0) {
      // Prefer a lit enemy, fall back to any chasing enemy
      const pool_enemies = litEnemies.length > 0
        ? litEnemies
        : enemies.filter(e => e.isChasing && !e.dead);

      if (pool_enemies.length > 0) {
        this._lastMonsterBubbleTime = this.gameTimer;
        const enemy = Phaser.Utils.Array.GetRandom(pool_enemies);

        // Pick type-specific or generic quote
        const typePool = MONSTER_QUOTES[enemy.typeName] || MONSTER_QUOTES.IDLE;
        const quotePool = Math.random() < 0.6 ? typePool : MONSTER_QUOTES.IDLE;
        const line = Phaser.Utils.Array.GetRandom(quotePool);

        // Monster bubbles use their type color
        const eColors = getEnemyBubbleColors(enemy);
        SpeechBubble.show(this, enemy.sprite, line, {
          duration: 2000,
          ...eColors,
        });
        this._monsterBubbleCooldown = 6000 + Math.random() * 6000;
      }
    }
  }

  /**
   * Evaluate gameplay intensity and update the adaptive music tier.
   * Factors: nearby enemy count, kill rate, time survived, boss presence.
   */
  _updateMusicIntensity(enemies) {
    if (this.gameTimer - this._lastIntensityCheck < this._intensityCheckInterval) return;
    this._lastIntensityCheck = this.gameTimer;

    // Prune old kills (only count last 15 seconds)
    const killWindow = 15000;
    const cutoff = this.gameTimer - killWindow;
    this._recentKills = this._recentKills.filter(t => t > cutoff);

    // Kill rate (kills per 10 seconds, normalized)
    const killRate = (this._recentKills.length / killWindow) * 10000;

    // Count enemies near the player (within 1.5x tracking range)
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;
    const nearRange = 450 * PX;
    let nearbyCount = 0;
    let hasBoss = false;
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      if (enemy.isBoss) hasBoss = true;
      const dx = enemy.sprite.x - px;
      const dy = enemy.sprite.y - py;
      if (dx * dx + dy * dy < nearRange * nearRange) {
        nearbyCount++;
      }
    }

    // Time factor — game gets naturally more intense over time
    const timeFactor = Math.min(this.gameTimer / 120000, 1); // 0 to 1 over 2 minutes

    // Compute intensity score (0 to 1)
    const enemyScore = Math.min(nearbyCount / 15, 1); // 15+ nearby = maxed
    const killScore = Math.min(killRate / 8, 1);       // 8+ kills per 10s = maxed
    const bossBonus = hasBoss ? 0.25 : 0;

    const intensity = enemyScore * 0.35 + killScore * 0.25 + timeFactor * 0.25 + bossBonus;

    // Map intensity to tier (1-5) with hysteresis to avoid flip-flopping
    let newTier;
    if (intensity < 0.15) newTier = 1;
    else if (intensity < 0.3) newTier = 2;
    else if (intensity < 0.5) newTier = 3;
    else if (intensity < 0.7) newTier = 4;
    else newTier = 5;

    // Hysteresis: only change if moving more than 1 tier or holding for this check
    if (newTier !== this._musicTier) {
      this._musicTier = newTier;
      eventBus.emit(Events.MUSIC_INTENSITY, { tier: newTier });

      // Fade grid layer in/out based on intensity (created lazily at tier 2+)
      const gridAlpha = newTier >= 4 ? 1 : newTier >= 3 ? 0.6 : newTier >= 2 ? 0.3 : 0;
      if (gridAlpha > 0 && !this._parallaxGrid) {
        this._parallaxGrid = this._createGridLayer({ depth: -12, scrollFactor: 0.7 });
      }
      if (this._parallaxGrid) {
        this.tweens.add({
          targets: this._parallaxGrid,
          alpha: gridAlpha,
          duration: 2000,
          ease: 'Sine.easeInOut',
        });
      }
    }
  }

  /**
   * Boss spawn: dev reacts + boss taunts (no pause, just bubbles).
   */
  handleBossSpawn({ x, y }) {
    // Camera flash for drama
    this.cameras.main.flash(300, 40, 10, 10);

    // Dev reacts in blue
    const devLine = Phaser.Utils.Array.GetRandom(DEV_QUOTES.BOSS);
    SpeechBubble.show(this, this.player.sprite, devLine, { duration: 3000, ...BUBBLE_COLORS.DEV });

    // Find the boss enemy just spawned and give it a red taunt
    this.time.delayedCall(800, () => {
      const enemies = this.waveSystem.getActiveEnemies();
      const boss = enemies.find(e => e.isBoss && !e.dead);
      if (boss && boss.sprite && boss.sprite.active) {
        const bossLine = Phaser.Utils.Array.GetRandom(MONSTER_QUOTES.BOSS);
        SpeechBubble.show(this, boss.sprite, bossLine, {
          duration: 3000,
          ...BUBBLE_COLORS.BOSS,
        });
      }
    });
  }

  /**
   * Level up: dev celebrates (no pause — the level-up scene already pauses).
   */
  handleLevelUp() {
    const line = Phaser.Utils.Array.GetRandom(DEV_QUOTES.LEVEL_UP);
    SpeechBubble.show(this, this.player.sprite, line, { duration: 2500, ...BUBBLE_COLORS.DEV });
  }

  /**
   * Smoothly freeze the game world: store velocities, pause physics, darken + zoom.
   */
  freezeWorld() {
    if (this._worldFrozen) return;
    this._worldFrozen = true;

    // Store all enemy velocities and zero them
    this._frozenEnemyVelocities = [];
    const enemies = this.waveSystem.getActiveEnemies();
    for (const enemy of enemies) {
      if (enemy.sprite && enemy.sprite.body) {
        this._frozenEnemyVelocities.push({
          enemy,
          vx: enemy.sprite.body.velocity.x,
          vy: enemy.sprite.body.velocity.y,
        });
        enemy.sprite.body.setVelocity(0, 0);
      }
    }

    // Store player velocity
    this._frozenPlayerVx = this.player.vx;
    this._frozenPlayerVy = this.player.vy;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.sprite.body.setVelocity(0, 0);

    // Store projectile velocities
    this._frozenProjectileVelocities = [];
    const projectiles = this.weaponSystem.getActiveProjectiles();
    for (const proj of projectiles) {
      if (proj.sprite && proj.sprite.body) {
        this._frozenProjectileVelocities.push({
          proj,
          vx: proj.sprite.body.velocity.x,
          vy: proj.sprite.body.velocity.y,
        });
        proj.sprite.body.setVelocity(0, 0);
      }
    }

    // Pause physics
    this.physics.world.pause();

    // Dark overlay (smooth fade-in)
    this._freezeOverlay = this.add.graphics();
    this._freezeOverlay.setScrollFactor(0);
    this._freezeOverlay.setDepth(400);
    this._freezeOverlay.fillStyle(0x000000, 0.4);
    this._freezeOverlay.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);
    this._freezeOverlay.setAlpha(0);

    this.tweens.add({
      targets: this._freezeOverlay,
      alpha: 1,
      duration: 250,
      ease: 'Sine.easeOut',
    });

    // Hide mobile controls
    if (this.joystick) this.joystick.setVisible(false);

    // Pause audio: mute engine, duck soundtrack
    playPauseEngine();
    duckMusic();

    // Pause wave/boss timers
    if (this.waveSystem.spawnTimer) this.waveSystem.spawnTimer.paused = true;
    if (this.waveSystem.bossTimer) this.waveSystem.bossTimer.paused = true;

    // Subtle camera zoom in
    const baseZoom = this.isMobile ? 1.8 : 1;
    this.tweens.add({
      targets: this.cameras.main,
      zoom: baseZoom * 1.02,
      duration: 300,
      ease: 'Sine.easeOut',
    });
  }

  /**
   * Smoothly unfreeze the game world: restore velocities, resume physics, clear overlay.
   */
  unfreezeWorld() {
    if (!this._worldFrozen) return;
    this._worldFrozen = false;

    // Resume physics
    this.physics.world.resume();

    // Restore enemy velocities
    if (this._frozenEnemyVelocities) {
      for (const { enemy, vx, vy } of this._frozenEnemyVelocities) {
        if (enemy.sprite && enemy.sprite.body && !enemy.dead) {
          enemy.sprite.body.setVelocity(vx, vy);
        }
      }
      this._frozenEnemyVelocities = null;
    }

    // Restore player velocity
    if (this._frozenPlayerVx !== undefined) {
      this.player.vx = this._frozenPlayerVx;
      this.player.vy = this._frozenPlayerVy;
      this.player.sprite.body.setVelocity(this._frozenPlayerVx, this._frozenPlayerVy);
      this._frozenPlayerVx = undefined;
      this._frozenPlayerVy = undefined;
    }

    // Restore projectile velocities
    if (this._frozenProjectileVelocities) {
      for (const { proj, vx, vy } of this._frozenProjectileVelocities) {
        if (proj.sprite && proj.sprite.body && !proj.dead) {
          proj.sprite.body.setVelocity(vx, vy);
        }
      }
      this._frozenProjectileVelocities = null;
    }

    // Fade out overlay
    if (this._freezeOverlay) {
      this.tweens.add({
        targets: this._freezeOverlay,
        alpha: 0,
        duration: 200,
        ease: 'Sine.easeIn',
        onComplete: () => {
          if (this._freezeOverlay) {
            this._freezeOverlay.destroy();
            this._freezeOverlay = null;
          }
        },
      });
    }

    // Show mobile controls
    if (this.joystick) this.joystick.setVisible(true);

    // Resume audio: restore engine, unduck soundtrack
    playResumeEngine();
    unduckMusic();

    // Resume wave/boss timers
    if (this.waveSystem.spawnTimer) this.waveSystem.spawnTimer.paused = false;
    if (this.waveSystem.bossTimer) this.waveSystem.bossTimer.paused = false;

    // Zoom back to normal
    const baseZoom = this.isMobile ? 1.8 : 1;
    this.tweens.add({
      targets: this.cameras.main,
      zoom: baseZoom,
      duration: 250,
      ease: 'Sine.easeIn',
    });
  }

  triggerGameOver() {
    if (gameState.gameOver) return;
    gameState.gameOver = true;
    playStopEngine();
    gameState.saveBest();
    eventBus.emit(Events.GAME_OVER, {
      score: gameState.score,
      enemiesKilled: gameState.enemiesKilled,
      timeSurvived: gameState.timeSurvived,
    });

    // Dev's dying words — shown as a speech bubble at the explosion site
    const px = this.player.sprite.x;
    const py = this.player.sprite.y;

    // Keep camera following the player sprite (now stationary at death pos)
    this.player.sprite.body.setVelocity(0, 0);
    this.player.vx = 0;
    this.player.vy = 0;

    // Hide virtual controls on death
    if (this.joystick) this.joystick.setVisible(false);

    // Switch to game over music immediately
    eventBus.emit(Events.MUSIC_GAMEOVER);

    // Slowly zoom in on death position (camera still follows player sprite)
    const cam = this.cameras.main;
    this.tweens.add({
      targets: cam,
      zoom: (this.isMobile ? 1.8 : 1) * 1.5,
      duration: 2000,
      ease: 'Sine.easeInOut',
    });

    // Remove all health bars from enemies
    const activeEnemies = this.waveSystem.getActiveEnemies();
    for (const enemy of activeEnemies) {
      if (enemy.healthBar) {
        enemy.healthBar.destroy();
        enemy.healthBar = null;
      }
    }

    // Dismiss any active bubble on the player before showing dying words
    SpeechBubble.dismiss(this.player.sprite);

    const dyingLine = Phaser.Utils.Array.GetRandom(DEV_QUOTES.DYING);
    // Create a temporary anchor at the death position (ship will be hidden)
    const deathAnchor = this.add.circle(px, py, 1, 0x000000, 0).setDepth(0);
    SpeechBubble.show(this, deathAnchor, dyingLine, {
      offsetY: -30 * PX,
      persistent: true,
      ...BUBBLE_COLORS.DEV,
    });

    // Use real-time setTimeout (not scene time, which is affected by slow-mo timeScale)
    const goToGameOver = () => {
      if (this._deathTransitioning) return;
      this._deathTransitioning = true;
      deathAnchor.destroy();
      this.input.off('pointerdown', onTap);
      this.input.keyboard.off('keydown-SPACE', onTap);
      this.scene.stop('UIScene');
      this.cameras.main.fadeOut(TRANSITION.FADE_DURATION, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => {
        this.scene.start('GameOverScene');
      });
    };
    const onTap = () => goToGameOver();

    // Allow tap to skip after 1s (real time, unaffected by slow-mo)
    setTimeout(() => {
      this.input.on('pointerdown', onTap);
      this.input.keyboard.on('keydown-SPACE', onTap);
    }, 1000);
    // Auto-transition after 3s regardless
    setTimeout(() => goToGameOver(), 3000);
  }
}
