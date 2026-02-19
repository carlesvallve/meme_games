import Phaser from 'phaser';
import { GAME, PLAYER, COLORS, PX, PIXEL_SCALE, TRANSITION, ARENA, POWERUP_TYPES, POWERUP_DROP, TOUCH, XP_GEM, INTRO, VFX, PARALLAX, WEAPONS, KNOCKBACK, UI, LIGHTING } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';
import { Player } from '../entities/Player.js';
import { WaveSystem } from '../systems/WaveSystem.js';
import { WeaponSystem } from '../systems/WeaponSystem.js';
import { LevelSystem } from '../systems/LevelSystem.js';
import { XPGem } from '../entities/XPGem.js';
import { PowerUp } from '../entities/PowerUp.js';
import { BlastPickup, BLAST_CONFIG } from '../entities/BlastPickup.js';
import { VFXSystem } from '../systems/VFXSystem.js';
// Pixel art imports kept for potential future use
// import { renderPixelArt } from '../core/PixelRenderer.js';
// import { DECO_SLOP_DEBRIS } from '../sprites/tiles.js';
// import { PALETTE } from '../sprites/palette.js';
import { DialogBubble } from '../ui/DialogBubble.js';
import { SpeechBubble } from '../ui/SpeechBubble.js';
import { DEV_QUOTES, MONSTER_QUOTES } from '../ui/DevQuotes.js';
import { showPowerupChoiceOverlay } from '../scenes/PowerupChoiceOverlay.js';
import { showGameOverOverlay } from '../scenes/GameOverOverlay.js';
import { playStartEngine, playUpdateEngine, playStopEngine, playPauseEngine, playResumeEngine, duckMusic, unduckMusic, startFootsteps, stopFootsteps, playEnemyHitSfx, playTitleAppearSfx, playTitleDismissSfx } from '../audio/AudioBridge.js';
import { EnemyProjectile } from '../entities/EnemyProjectile.js';
import { EnemyMine } from '../entities/EnemyMine.js';
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
    // Reset stale flags from previous session (Phaser reuses Scene instances)
    this._deathTransitioning = false;
    this._worldFrozen = false;
    this._lastPowerupDropTime = 0; // throttle powerup drops
    this._lastBlastDropTime = 0;   // throttle blast pickups
    this._vortexActive = false;
    this._vortexTimer = 0;
    this._vortexLastTick = 0;
    this._vortexGfx = null;
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

    // --- Arena edge barriers (glowing energy) ---
    this.createEdgeBarriers();

    // --- Player ---
    this.player = new Player(this);

    // --- Camera reset ---
    this.cameras.main.setZoom(GAME.MOBILE_SCALE);
    this.cameras.main.setAlpha(1);
    // Don't start following player yet — intro will set up camera follow on the dev character.
    // Camera follow + bounds are set after intro completes.
    this.cameras.main.setBounds(0, 0, ARENA.WIDTH, ARENA.HEIGHT);

    // --- Systems ---
    this.waveSystem = new WaveSystem(this);
    this.weaponSystem = new WeaponSystem(this);
    this.levelSystem = new LevelSystem(this);
    this.vfxSystem = new VFXSystem(this);

    // --- Lighting system ---
    this.lighting = new LightingSystem(this, {
      width: GAME.WIDTH,
      height: GAME.HEIGHT,
      ambient: LIGHTING.AMBIENT,
      ambientColor: LIGHTING.AMBIENT_COLOR,
      maxLights: LIGHTING.MAX_LIGHTS,
      gradientSize: LIGHTING.GRADIENT_SIZE,
      falloffInner: LIGHTING.FALLOFF_INNER,
      falloffMid: LIGHTING.FALLOFF_MID,
      innerAlpha: LIGHTING.INNER_ALPHA,
      midAlpha: LIGHTING.MID_ALPHA,
    });
    this.lighting.setActive(true);

    // --- Collectibles ---
    this.xpGems = [];
    this.powerUps = [];
    this.blastPickups = [];

    // --- Enemy hazards (projectiles + mines from behavior variants) ---
    this.enemyProjectiles = [];
    this.enemyMines = [];

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
    this.onPowerupChosen = this.handlePowerupChosen.bind(this);
    this.onBossSpawn = this.handleBossSpawn.bind(this);
    this.onLevelUp = this.handleLevelUp.bind(this);
    this.onEnemySplit = this.handleEnemySplit.bind(this);
    this.onWaveStart = this.handleWaveStart.bind(this);

    eventBus.on(Events.ENEMY_KILLED, this.onEnemyKilled);
    eventBus.on(Events.WEAPON_UPGRADE, this.onWeaponUpgrade);
    eventBus.on(Events.POWERUP_COLLECTED, this.onPowerupCollected);
    eventBus.on(Events.POWERUP_CHOSEN, this.onPowerupChosen);
    eventBus.on(Events.BOSS_SPAWN, this.onBossSpawn);
    eventBus.on(Events.LEVEL_UP, this.onLevelUp);
    eventBus.on(Events.ENEMY_SPLIT, this.onEnemySplit);
    eventBus.on(Events.WAVE_START, this.onWaveStart);

    // --- Intro cutscene (handles audio init + menu music) ---
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
      eventBus.off(Events.POWERUP_CHOSEN, this.onPowerupChosen);
      eventBus.off(Events.BOSS_SPAWN, this.onBossSpawn);
      eventBus.off(Events.LEVEL_UP, this.onLevelUp);
      eventBus.off(Events.ENEMY_SPLIT, this.onEnemySplit);
      eventBus.off(Events.WAVE_START, this.onWaveStart);
      // Clean up vortex
      if (this._vortexGfx) { this._vortexGfx.destroy(); this._vortexGfx = null; }
      this._vortexActive = false;
      // Clean up enemy hazards
      this.enemyProjectiles.forEach(p => { if (!p.dead) p.destroy(); });
      this.enemyMines.forEach(m => { if (!m.dead) m.destroy(); });
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
      lineAlpha: 0.18,
      lineWidth: 1,
      glowColor: 0xffffff,
      glowAlpha: 0.06,
    });

    // --- Mid layer (depth -20, scrollFactor 0.6): Nebula clouds (no grid lines) ---
    this._parallaxMid = this._createNebulaLayer({
      depth: -20,
      scrollFactor: PARALLAX.MID_FACTOR,
      count: 25,
      minRadius: 40 * PX,
      maxRadius: 120 * PX,
      color: 0xffffff,
      minAlpha: 0.08,
      maxAlpha: 0.22,
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
      minAlpha: 0.15,
      maxAlpha: 0.38,
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

      // Fade edge barrier — always vivid so the energy field pops
      const edgeTheme = vivid[Phaser.Math.Between(0, vivid.length - 1)];
      this._tweenEdgeBarrierColors(edgeTheme, PARALLAX.COLOR_FADE_DURATION);

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

  /**
   * Smoothly tween edge barrier particle/tendril colors to a new theme.
   */
  _tweenEdgeBarrierColors(themeColors, duration) {
    if (!this._edgeParticles || this._edgeParticles.length === 0) return;

    // Pick ONE base color for the entire edge energy field
    const base = Phaser.Utils.Array.GetRandom(themeColors);
    const brighten = (c, amount) => {
      let r = Math.min(255, ((c >> 16) & 0xff) + amount);
      let g = Math.min(255, ((c >> 8) & 0xff) + amount);
      let b = Math.min(255, (c & 0xff) + amount);
      return (r << 16) | (g << 8) | b;
    };
    const bright = brighten(base, 60);

    // Tween ALL particles to the same base color (with slight bright variation)
    for (const p of this._edgeParticles) {
      const target = Math.random() < 0.7 ? base : bright;
      const current = p.obj.fillColor || 0xaa44ff;

      const cr = (current >> 16) & 0xff, cg = (current >> 8) & 0xff, cb = current & 0xff;
      const tr = (target >> 16) & 0xff, tg = (target >> 8) & 0xff, tb = target & 0xff;

      const proxy = { r: cr, g: cg, b: cb };
      this.tweens.add({
        targets: proxy,
        r: tr, g: tg, b: tb,
        duration: duration + Math.random() * 1000, // slight stagger
        ease: 'Sine.easeInOut',
        onUpdate: () => {
          if (p.obj && p.obj.active) {
            const color = (Math.round(proxy.r) << 16) | (Math.round(proxy.g) << 8) | Math.round(proxy.b);
            p.obj.setFillStyle(color);
          }
        },
      });
    }

    // Tendrils — all same base color
    if (this._edgeTendrils) {
      for (const t of this._edgeTendrils) {
        t.color = Math.random() < 0.7 ? base : bright;
      }
    }
  }

  async playIntro() {
    const { BED_X, BED_Y, STAND_X, STAND_Y, SHIP_PARK_X, SHIP_PARK_Y, WAKE_DURATION, GET_OUT_DURATION, WALK_DURATION, BOARD_DURATION } = INTRO;

    // Init audio and play menu music (replaces MenuScene's role)
    eventBus.emit(Events.AUDIO_INIT);
    eventBus.emit(Events.MUSIC_MENU);

    this.introDialog = new DialogBubble(this);

    // Stop default follow — we'll follow the dev character throughout intro
    this.cameras.main.stopFollow();

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
    floorLine.lineStyle(12 * PX, 0x5588ff, 0.35);
    floorLine.lineBetween(
      ARENA.CENTER_X - 280 * PX, floorY,
      ARENA.CENTER_X + 280 * PX, floorY
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

    // Camera follows an invisible anchor above the dev — offset tweens to 0 on liftoff
    this._introCamOffsetY = -60 * PX;
    this._introCamTarget = this.add.rectangle(dev.x, dev.y + this._introCamOffsetY, 1, 1, 0, 0);
    this.cameras.main.useBounds = false;
    this.cameras.main.centerOn(this._introCamTarget.x, this._introCamTarget.y);
    this.cameras.main.startFollow(this._introCamTarget, true, 0.05, 0.05);

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

    // --- Step 3b: Title overlay in GameScene (keeps lighting) ---
    await this._showTitleOverlay();

    // --- Step 4: Launch UIScene (HUD fades in) ---
    this.scene.launch('UIScene');

    // Stop menu music, will start gameplay music after boarding
    eventBus.emit(Events.AUDIO_INIT); // ensure audio is initialized on user gesture
    eventBus.emit(Events.MUSIC_STOP);

    // --- Step 5: Walk from standing position to ship ---
    // Smoothly tween camera offset to 0 (centered) during walk
    this.tweens.add({
      targets: this,
      _introCamOffsetY: 0,
      duration: WALK_DURATION,
      ease: 'Sine.easeInOut',
    });

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

    // --- Step 6: Board ship — ship becomes controllable immediately ---
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

    // Reset ship origin back to center for gameplay and restore original Y
    this.player.sprite.setOrigin(0.5, 0.5);
    this.player.sprite.setY(SHIP_PARK_Y);

    // Clean up intro camera target
    if (this._introCamTarget) {
      this._introCamTarget.destroy();
      this._introCamTarget = null;
    }
    this._introCamOffsetY = 0;

    // Re-enable camera follow for gameplay, restore bounds
    this.cameras.main.useBounds = true;
    this.cameras.main.setBounds(0, 0, ARENA.WIDTH, ARENA.HEIGHT);
    this.cameras.main.setFollowOffset(0, 0);
    this.cameras.main.startFollow(this.player.sprite, true, 0.08, 0.08);

    // --- Ship is NOW controllable — no scripted liftoff ---
    this.introPlaying = false;
    gameState.started = true;
    this.waveSystem.start();
    this.introDialog = null;

    // Start gameplay music
    eventBus.emit(Events.MUSIC_GAMEPLAY);

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

  /** Show floating title overlay in UIScene and wait for space/tap to dismiss */
  _showTitleOverlay() {
    return new Promise((resolve) => {
      const w = GAME.WIDTH;
      const h = GAME.HEIGHT;
      const cx = w / 2;
      const cy = h / 2;
      const lift = 20 * PX;
      const DEPTH = 100;

      // Track elements for cleanup
      const elements = [];
      const add = (el) => { elements.push(el); return el; };

      // Title appear sound
      playTitleAppearSfx();

      // Title
      const titleSize = Math.round(UI.BASE * UI.TITLE_RATIO * (GAME.IS_MOBILE ? 0.8 : 1));
      const titleY = cy - UI.BASE * 0.18 - lift;
      const title = add(this.add.text(cx, titleY, 'SLOP SURVIVOR', {
        fontSize: titleSize + 'px',
        fontFamily: UI.FONT,
        color: '#44ff44',
        fontStyle: 'bold',
        shadow: { offsetX: 0, offsetY: 4, color: 'rgba(0,80,0,0.6)', blur: 12, fill: true },
      }).setOrigin(0.5).setDepth(DEPTH).setScrollFactor(0));

      // Title float animation
      this.tweens.add({
        targets: title,
        y: titleY - 6 * PX,
        duration: 2000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });

      // Subtitle
      const subSize = Math.round(UI.BASE * UI.SMALL_RATIO);
      const subtitle = add(this.add.text(cx, cy - UI.BASE * 0.06 - lift, 'Survive the AI slop coding invasion', {
        fontSize: subSize + 'px',
        fontFamily: UI.FONT,
        color: '#66cc66',
      }).setOrigin(0.5).setDepth(DEPTH).setScrollFactor(0));

      // Control hints
      const hintSize = Math.round(UI.BASE * UI.SMALL_RATIO * 0.9);
      const isMobile = GAME.IS_MOBILE;
      const hintText = isMobile
        ? 'Tap to Start'
        : 'Press Space to Start';
      const hint = add(this.add.text(cx, cy + UI.BASE * 0.28 - lift, hintText, {
        fontSize: hintSize + 'px',
        fontFamily: UI.FONT,
        color: COLORS.MUTED_TEXT,
        align: 'center',
      }).setOrigin(0.5).setDepth(DEPTH).setScrollFactor(0));

      // Hint pulse
      this.tweens.add({
        targets: hint,
        alpha: 0.3,
        duration: 1200,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });

      // Mute button
      const muteSize = Math.max(36 * PX, UI.MIN_TOUCH);
      const muteX = w - muteSize / 2 - 10 * PX;
      const muteY = muteSize / 2 + 10 * PX;
      const muteIcon = add(this.add.text(muteX, muteY, gameState.isMuted ? '🔇' : '🔊', {
        fontSize: Math.round(muteSize * 0.5) + 'px',
      }).setOrigin(0.5).setDepth(DEPTH + 1).setScrollFactor(0));
      muteIcon.setInteractive({ useHandCursor: true });
      muteIcon.on('pointerup', (pointer, lx, ly, event) => {
        event.stopPropagation();
        eventBus.emit(Events.AUDIO_TOGGLE_MUTE);
        muteIcon.setText(gameState.isMuted ? '🔇' : '🔊');
      });

      const dismiss = () => {
        this.input.keyboard.off('keydown-SPACE', onKey);
        this.input.off('pointerdown', onTap);

        playTitleDismissSfx();

        this.tweens.add({
          targets: [title, subtitle, muteIcon],
          y: '-=60',
          alpha: 0,
          duration: 400,
          ease: 'Quad.easeIn',
        });

        this.tweens.add({
          targets: hint,
          y: '+=60',
          alpha: 0,
          duration: 400,
          ease: 'Quad.easeIn',
          onComplete: () => {
            elements.forEach(el => el.destroy());
            resolve();
          },
        });
      };

      const onKey = () => dismiss();
      const onTap = (pointer) => {
        // Don't dismiss if tapping the mute button
        const dist = Math.sqrt((pointer.x - muteIcon.x) ** 2 + (pointer.y - muteIcon.y) ** 2);
        if (dist < muteSize) return;
        dismiss();
      };

      // Input on GameScene (which has focus during intro)
      this.input.keyboard.on('keydown-SPACE', onKey);
      this.input.on('pointerdown', onTap);
    });
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

  createEdgeBarriers() {
    const W = ARENA.WIDTH;
    const H = ARENA.HEIGHT;
    const depth = 50;
    const colors = [0xaa44ff, 0xdd66ff, 0x7733cc, 0xff44aa, 0x8855ee, 0xcc55ff];
    const particleCount = 300; // spread across all 4 edges

    this._edgeParticles = [];

    // Edges: 0=top, 1=bottom, 2=left, 3=right
    for (let i = 0; i < particleCount; i++) {
      const edge = i % 4;
      const size = (4 + Math.random() * 12) * PX;
      const color = Phaser.Utils.Array.GetRandom(colors);

      const circle = this.add.circle(0, 0, size, color, 1);
      circle.setDepth(depth);
      circle.setBlendMode(Phaser.BlendModes.ADD);

      // Position along the edge
      const pos = Math.random(); // 0-1 along edge length
      let x, y;
      if (edge === 0)      { x = pos * W; y = 0; }
      else if (edge === 1) { x = pos * W; y = H; }
      else if (edge === 2) { x = 0; y = pos * H; }
      else                 { x = W; y = pos * H; }

      circle.setPosition(x, y);

      const p = {
        obj: circle,
        edge,
        pos,               // normalized position along edge (0-1)
        baseSize: size,
        drift: 10 * PX + Math.random() * 50 * PX,  // how far it drifts inward
        speed: 0.3 + Math.random() * 0.7,           // drift animation speed
        slideSpeed: (0.002 + Math.random() * 0.008) * (Math.random() < 0.5 ? 1 : -1), // slide along edge
        phase: Math.random() * Math.PI * 2,          // unique phase offset
        pulseSpeed: 1.5 + Math.random() * 2.5,       // size pulsing speed
        maxAlpha: 0.3 + Math.random() * 0.5,          // peak alpha (higher for ADD blend)
      };

      this._edgeParticles.push(p);
    }

    // Wispy tendrils — larger, elongated shapes that flow along edges
    this._edgeTendrils = [];
    const tendrilCount = 40;
    for (let i = 0; i < tendrilCount; i++) {
      const edge = i % 4;
      const gfx = this.add.graphics();
      gfx.setDepth(depth - 1);
      gfx.setBlendMode(Phaser.BlendModes.ADD);

      const tendril = {
        gfx,
        edge,
        pos: Math.random(),
        length: (30 + Math.random() * 60) * PX,
        width: (4 + Math.random() * 8) * PX,
        drift: 20 * PX + Math.random() * 50 * PX,
        speed: 0.2 + Math.random() * 0.4,
        slideSpeed: (0.003 + Math.random() * 0.006) * (Math.random() < 0.5 ? 1 : -1),
        phase: Math.random() * Math.PI * 2,
        color: Phaser.Utils.Array.GetRandom(colors),
        maxAlpha: 0.08 + Math.random() * 0.15,
        waveFreq: 2 + Math.random() * 3,
        waveAmp: (5 + Math.random() * 15) * PX,
      };

      this._edgeTendrils.push(tendril);
    }
  }

  _updateEdgeBarriers() {
    if (!this._edgeParticles) return;
    const time = this.time.now / 1000;
    const W = ARENA.WIDTH;
    const H = ARENA.HEIGHT;

    // Update floating particles
    for (const p of this._edgeParticles) {
      // Slide along edge
      p.pos += p.slideSpeed * 0.016; // ~60fps normalized
      if (p.pos > 1) p.pos -= 1;
      if (p.pos < 0) p.pos += 1;

      // Drift inward with sine wave (breathes in and out from edge)
      const driftAmount = Math.sin(time * p.speed + p.phase) * 0.5 + 0.5; // 0-1
      const inward = driftAmount * p.drift;

      let x, y;
      if (p.edge === 0)      { x = p.pos * W; y = inward; }
      else if (p.edge === 1) { x = p.pos * W; y = H - inward; }
      else if (p.edge === 2) { x = inward; y = p.pos * H; }
      else                   { x = W - inward; y = p.pos * H; }

      p.obj.setPosition(x, y);

      // Pulse size and alpha — brighter when closer to edge
      const pulse = 0.6 + Math.sin(time * p.pulseSpeed + p.phase) * 0.4;
      const edgeProximity = 1 - driftAmount; // 1 at edge, 0 at max drift
      const alpha = p.maxAlpha * edgeProximity * pulse;

      p.obj.setAlpha(alpha);
      p.obj.setScale(pulse * (0.5 + edgeProximity * 0.5));
    }

    // Update wispy tendrils
    for (const t of this._edgeTendrils) {
      t.pos += t.slideSpeed * 0.016;
      if (t.pos > 1.2) t.pos -= 1.4;
      if (t.pos < -0.2) t.pos += 1.4;

      const driftAmount = Math.sin(time * t.speed + t.phase) * 0.5 + 0.5;
      const inward = driftAmount * t.drift;
      const alpha = t.maxAlpha * (1 - driftAmount * 0.7);

      t.gfx.clear();
      t.gfx.lineStyle(t.width, t.color, alpha);
      t.gfx.beginPath();

      const segments = 10;
      for (let s = 0; s <= segments; s++) {
        const st = s / segments;
        // Wave perpendicular to edge
        const wave = Math.sin(st * t.waveFreq * Math.PI + time * 2 + t.phase) * t.waveAmp;

        let x, y;
        const along = (t.pos + st * t.length / (t.edge < 2 ? W : H));

        if (t.edge === 0) {
          x = along * W;
          y = inward + wave;
        } else if (t.edge === 1) {
          x = along * W;
          y = H - inward + wave;
        } else if (t.edge === 2) {
          x = inward + wave;
          y = along * H;
        } else {
          x = W - inward + wave;
          y = along * H;
        }

        if (s === 0) t.gfx.moveTo(x, y);
        else t.gfx.lineTo(x, y);
      }

      t.gfx.strokePath();
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
      // Keep lighting alive after death — large radius so game over UI is readable.
      // Divide radius by current zoom so the on-screen light size stays
      // constant regardless of the death-zoom tween (LightingSystem already
      // multiplies radius × zoom internally).
      if (this.lighting && this.lighting.active && this.player.sprite) {
        const zoom = this.cameras.main.zoom;
        this.lighting.setLight(
          'player',
          this.player.sprite.x,
          this.player.sprite.y,
          GAME.HEIGHT * (GAME.IS_MOBILE ? 0.35 : 0.5) / zoom,
          1.0,
          1.0, 1.0, 1.0
        );
        this.lighting.update();
      }
      return;
    }

    // Always animate amoeba blobs (even during intro/freeze)
    this._updateAmoebas(delta);
    this._updateEdgeBarriers();

    // Always update thruster particles (even during intro)
    this.player.updateThrusterParticles(delta);

    // During intro, update camera target + lighting on the dev character and return early
    if (this.introPlaying) {
      // Keep camera anchor synced with dev + offset
      if (this._introCamTarget && this._introDev) {
        this._introCamTarget.setPosition(
          this._introDev.x,
          this._introDev.y + (this._introCamOffsetY || 0)
        );
      }
      if (this.player.isThrusting) {
        this.player.emitThrusterParticles();
      }
      // Keep lighting active during intro — divide by zoom so coverage is consistent across devices
      if (this.lighting && this.lighting.active && this._introDev) {
        const zoom = this.cameras.main.zoom;
        this.lighting.setLight(
          'player',
          this._introDev.x,
          this._introDev.y,
          GAME.HEIGHT * (GAME.IS_MOBILE ? 0.35 : 0.5) / zoom,
          1.0,
          1.0, 1.0, 1.0
        );
        this.lighting.update();
      }
      return;
    }

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

    // --- Process enemy behavior outputs (shooter projectiles, mine drops) ---
    for (const enemy of enemies) {
      if (enemy.dead) continue;

      // Shooter fires a projectile
      if (enemy.pendingShot) {
        const shot = enemy.pendingShot;
        enemy.pendingShot = null;
        const ep = new EnemyProjectile(this, shot.x, shot.y, shot.targetX, shot.targetY);
        this.enemyProjectiles.push(ep);
      }

      // Mine layer drops a mine
      if (enemy.pendingMine) {
        const mine = enemy.pendingMine;
        enemy.pendingMine = null;
        const em = new EnemyMine(this, mine.x, mine.y);
        this.enemyMines.push(em);
      }
    }

    // --- Collision: enemy projectiles vs player ---
    for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
      const ep = this.enemyProjectiles[i];
      if (ep.dead || !ep.sprite.active) {
        this.enemyProjectiles.splice(i, 1);
        continue;
      }
      const dx = px - ep.sprite.x;
      const dy = py - ep.sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < PLAYER.WIDTH * 0.4 + 8 * PX) {
        // Knockback
        if (dist > 0) {
          const kx = (dx / dist) * PLAYER.HIT_KNOCKBACK * 0.5;
          const ky = (dy / dist) * PLAYER.HIT_KNOCKBACK * 0.5;
          this.player.vx += kx;
          this.player.vy += ky;
        }
        playEnemyHitSfx();
        ep.destroy();
        const dead = this.player.hit(ep.damage);
        if (dead) {
          this.triggerGameOver();
          return;
        }
      }
    }

    // --- Collision: enemy mines vs player ---
    for (let i = this.enemyMines.length - 1; i >= 0; i--) {
      const em = this.enemyMines[i];
      if (em.dead) {
        this.enemyMines.splice(i, 1);
        continue;
      }
      if (em.checkPlayerCollision(px, py)) {
        playEnemyHitSfx();
        const dead = this.player.hit(em.damage);
        if (dead) {
          this.triggerGameOver();
          return;
        }
        this.enemyMines.splice(i, 1);
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
      const dx = px - pu.sprite.x;
      const dy = py - pu.sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < PLAYER.WIDTH * 0.5 + POWERUP_DROP.TOKEN_SIZE) {
        pu.collect();
      }
    }

    // --- Update blast pickups (instant explosion on touch) ---
    for (let i = this.blastPickups.length - 1; i >= 0; i--) {
      const bp = this.blastPickups[i];
      if (bp.collected || !bp.sprite.active) {
        this.blastPickups.splice(i, 1);
        continue;
      }
      const dx = px - bp.sprite.x;
      const dy = py - bp.sprite.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < PLAYER.WIDTH * 0.5 + POWERUP_DROP.TOKEN_SIZE) {
        bp.collect(enemies);
      }
    }

    // --- Update Code Review vortex ---
    if (this._vortexActive) {
      this._vortexTimer += delta;
      const cfg = POWERUP_TYPES.CODE_REVIEW;
      // Pull enemies toward player and deal periodic damage
      if (this._vortexTimer - this._vortexLastTick >= cfg.vortexTickRate) {
        this._vortexLastTick = this._vortexTimer;
        for (const enemy of enemies) {
          if (enemy.dead) continue;
          const edx = enemy.sprite.x - px;
          const edy = enemy.sprite.y - py;
          const eDist = Math.sqrt(edx * edx + edy * edy);
          if (eDist <= cfg.vortexRadius && eDist > 0) {
            enemy.takeDamage(cfg.vortexDamage);
          }
        }
      }
      // Continuous pull force (every frame)
      const pullDt = delta / 1000;
      for (const enemy of enemies) {
        if (enemy.dead) continue;
        const edx = enemy.sprite.x - px;
        const edy = enemy.sprite.y - py;
        const eDist = Math.sqrt(edx * edx + edy * edy);
        if (eDist <= cfg.vortexRadius && eDist > 10) {
          const pull = cfg.vortexPullForce * pullDt;
          const nx = -edx / eDist;
          const ny = -edy / eDist;
          enemy.sprite.x += nx * pull;
          enemy.sprite.y += ny * pull;
        }
      }
      // Visual: spinning ring around player
      if (this._vortexGfx && this._vortexGfx.active) {
        this._vortexAngle += delta * 0.003;
        this._vortexGfx.clear();
        this._vortexGfx.setPosition(px, py);
        // Outer ring
        this._vortexGfx.lineStyle(3 * PX, cfg.color, 0.5);
        this._vortexGfx.strokeCircle(0, 0, cfg.vortexRadius);
        // Spinning dashes
        const dashCount = 8;
        for (let d = 0; d < dashCount; d++) {
          const angle = this._vortexAngle + (Math.PI * 2 * d) / dashCount;
          const innerR = cfg.vortexRadius * 0.3;
          const outerR = cfg.vortexRadius * 0.9;
          this._vortexGfx.lineStyle(2 * PX, cfg.color, 0.6);
          this._vortexGfx.beginPath();
          this._vortexGfx.moveTo(Math.cos(angle) * innerR, Math.sin(angle) * innerR);
          this._vortexGfx.lineTo(Math.cos(angle) * outerR, Math.sin(angle) * outerR);
          this._vortexGfx.strokePath();
        }
      }
    }

    // --- Update lighting ---
    this._updateLighting(enemies);
  }

  // Toggle flags for lighting features
  _enemyLightsEnabled = false;

  _updateLighting(enemies) {
    if (!this.lighting || !this.lighting.active) return;

    // Player glow — bright radial light around the ship
    this.lighting.setLight(
      'player',
      this.player.sprite.x,
      this.player.sprite.y,
      320 * PX,
      1.0,
      1.0, 1.0, 1.0
    );

    // Headlight cone — bright directional beam, the main light source
    const facing = Math.atan2(this.player.facingY, this.player.facingX);
    this.lighting.setConeLight(
      'headlight',
      this.player.sprite.x,
      this.player.sprite.y,
      facing,
      700 * PX,
      Math.PI / 3,
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

    // Power-up glows (generic teal for all tokens)
    for (let i = 0; i < this.powerUps.length; i++) {
      const pu = this.powerUps[i];
      if (pu.collected || !pu.sprite.active) continue;
      this.lighting.setLight(
        `powerup-${i}`,
        pu.sprite.x,
        pu.sprite.y,
        100 * PX,
        0.7,
        0.3, 0.5, 1.0
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

    const elapsed = this.gameTimer;

    // Blast pickup drop (Code Review — instant explosion)
    const blastTimeSinceLast = elapsed - this._lastBlastDropTime;
    if (blastTimeSinceLast >= BLAST_CONFIG.MIN_INTERVAL && Math.random() < BLAST_CONFIG.DROP_CHANCE) {
      const bp = new BlastPickup(this, x, y);
      this.blastPickups.push(bp);
      this._lastBlastDropTime = elapsed;
    }

    // Powerup token drop (choice system)
    const puTimeSinceLast = elapsed - this._lastPowerupDropTime;
    if (puTimeSinceLast >= POWERUP_DROP.MIN_INTERVAL) {
      const minutes = elapsed / 60000;
      const rampExtra = minutes > POWERUP_DROP.RAMP_START_MINUTE
        ? POWERUP_DROP.RAMP_PER_MINUTE * (minutes - POWERUP_DROP.RAMP_START_MINUTE)
        : 0;
      const dropChance = Math.min(POWERUP_DROP.MAX_CHANCE, POWERUP_DROP.BASE_CHANCE + rampExtra);

      if (Math.random() < dropChance) {
        const pu = new PowerUp(this, x, y);
        this.powerUps.push(pu);
        this._lastPowerupDropTime = elapsed;
      }
    }
  }

  handleWeaponUpgrade({ upgrade }) {
    this.weaponSystem.applyUpgrade(upgrade);
    // Resume game after level-up scene
    this.scene.resume('GameScene');
  }

  /**
   * Token collected — pause game and show the powerup choice overlay.
   */
  handlePowerupCollected() {
    // Pause GameScene and show choice overlay in UIScene
    this.scene.pause('GameScene');

    const uiScene = this.scene.get('UIScene');
    if (!uiScene) return;

    // Pick 2 random powerups from the unlocked pool (avoid duplicates, prefer not-active)
    const options = this.getRandomPowerupChoices(POWERUP_DROP.CHOICE_COUNT);
    showPowerupChoiceOverlay(uiScene, options);
  }

  /**
   * Player chose a powerup — apply it and resume game.
   */
  handlePowerupChosen({ type }) {
    const config = POWERUP_TYPES[type];
    if (!config) return;

    const enemies = this.waveSystem.getActiveEnemies();

    switch (type) {
      case 'CODE_REVIEW':
        this._activateVortex(config);
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
      case 'HOMING':
        this.weaponSystem.homingUnlocked = true;
        this.time.delayedCall(config.duration, () => {
          this.weaponSystem.homingUnlocked = false;
        });
        break;
    }

    // Resume game
    this.scene.resume('GameScene');
  }

  /**
   * Pick N random powerup types from those unlocked at current elapsed time.
   * Avoids duplicates and prefers powerups the player doesn't currently have active.
   */
  getRandomPowerupChoices(count) {
    const minutes = this.gameTimer / 60000;
    const allTypes = Object.entries(POWERUP_TYPES);

    // Filter to unlocked powerups
    const unlocked = allTypes.filter(([, cfg]) => minutes >= cfg.unlockMinute);
    if (unlocked.length === 0) return allTypes.slice(0, count).map(([t]) => ({ type: t }));

    // Deprioritize currently active powerups
    const active = new Set();
    if (this._vortexActive) active.add('CODE_REVIEW');
    if (this.player.shieldActive) active.add('GITIGNORE');
    if (this.weaponSystem.minesUnlocked) active.add('MINES');
    if (this.weaponSystem.tripleUnlocked) active.add('TRIPLE_SHOT');
    if (this.weaponSystem.homingUnlocked) active.add('HOMING');

    // Sort: non-active first, then shuffle within groups
    const preferred = unlocked.filter(([t]) => !active.has(t));
    const activeCandidates = unlocked.filter(([t]) => active.has(t));

    const shuffled = [
      ...preferred.sort(() => Math.random() - 0.5),
      ...activeCandidates.sort(() => Math.random() - 0.5),
    ];

    return shuffled.slice(0, count).map(([t]) => ({ type: t }));
  }

  /**
   * Activate the Code Review vortex — pulls enemies in and damages them.
   */
  _activateVortex(config) {
    this._vortexActive = true;
    this._vortexTimer = 0;
    this._vortexLastTick = 0;

    // Visual: spinning ring around the player
    const gfx = this.add.graphics();
    gfx.setDepth(15);
    this._vortexGfx = gfx;
    this._vortexAngle = 0;

    // Deactivate after duration
    this.time.delayedCall(config.duration, () => {
      this._deactivateVortex();
    });
  }

  /**
   * Deactivate the vortex effect.
   */
  _deactivateVortex() {
    this._vortexActive = false;
    if (this._vortexGfx) {
      this.tweens.add({
        targets: this._vortexGfx,
        alpha: 0,
        duration: 300,
        onComplete: () => {
          if (this._vortexGfx) {
            this._vortexGfx.destroy();
            this._vortexGfx = null;
          }
        },
      });
    }
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
   * Splitter death: spawn smaller, faster children via WaveSystem.
   */
  handleEnemySplit({ x, y, count, speedMult, healthMult }) {
    this.waveSystem.spawnSplitChildren(x, y, count, speedMult, healthMult);
  }

  /** Wave label — rendered in GameScene so lighting affects it */
  handleWaveStart({ wave }) {
    if (wave > 0 && wave % 5 === 0) {
      const waveText = this.add.text(GAME.WIDTH / 2, GAME.HEIGHT / 2, `WAVE ${wave}`, {
        fontSize: Math.round(UI.BASE * UI.HEADING_RATIO * 0.8) + 'px',
        fontFamily: UI.FONT,
        color: '#44ff44',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 3 * PX,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(997).setAlpha(0);

      this.tweens.add({
        targets: waveText,
        alpha: 0.8,
        scaleX: 1.1,
        scaleY: 1.1,
        duration: 300,
        yoyo: true,
        hold: 500,
        ease: 'Quad.easeOut',
        onComplete: () => waveText.destroy(),
      });
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
    const baseZoom = GAME.MOBILE_SCALE;
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

    // Resume audio: restore engine, unduck soundtrack (skip if game over — about to play game over music)
    if (!gameState.gameOver) {
      playResumeEngine();
      unduckMusic();
    }

    // Resume wave/boss timers
    if (this.waveSystem.spawnTimer) this.waveSystem.spawnTimer.paused = false;
    if (this.waveSystem.bossTimer) this.waveSystem.bossTimer.paused = false;

    // Zoom back to normal
    const baseZoom = GAME.MOBILE_SCALE;
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

    // If world was frozen, unfreeze it
    if (this._worldFrozen) {
      this.unfreezeWorld();
    }

    playStopEngine();

    // Pause wave/boss timers to prevent boss warnings after death
    if (this.waveSystem.spawnTimer) this.waveSystem.spawnTimer.paused = true;
    if (this.waveSystem.bossTimer) this.waveSystem.bossTimer.paused = true;

    // Remove headlight and enemy lights, brighten ambient for game over readability
    if (this.lighting) {
      this.lighting.removeLight('headlight');
      // Remove all enemy lights
      const activeEnemies = this.waveSystem.getActiveEnemies();
      for (const enemy of activeEnemies) {
        this.lighting.removeLight(`enemy_${enemy.id}`);
      }
      // Brighten ambient so game over UI is readable
      this.lighting.setAmbientColor(0.25, 0.2, 0.35);
    }

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

    // Lower ship depth so enemies render on top of the wreckage
    this.player.sprite.setDepth(3);

    // Hide virtual controls on death
    if (this.joystick) this.joystick.setVisible(false);

    // Switch to game over music immediately
    eventBus.emit(Events.MUSIC_GAMEOVER);

    // Slowly zoom in on death position (camera still follows player sprite)
    const cam = this.cameras.main;
    const deathZoomTarget = GAME.MOBILE_SCALE * 1.5;
    this._deathZoomTween = this.tweens.add({
      targets: cam,
      zoom: deathZoomTarget,
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

    const showOverlay = () => {
      if (this._deathTransitioning) return;
      this._deathTransitioning = true;
      deathAnchor.destroy();
      this.input.off('pointerdown', onTap);
      this.input.keyboard.off('keydown-SPACE', onTap);

      // Stop the death zoom tween so it doesn't fight with overlay animations
      if (this._deathZoomTween) {
        this._deathZoomTween.stop();
        cam.zoom = deathZoomTarget;
      }

      // Unlink camera from player so the pan tween works
      cam.stopFollow();

      // Pan camera downward so ship sits in upper area, game over UI below
      this.tweens.add({
        targets: cam,
        scrollY: cam.scrollY + 35 * PX,
        duration: 600,
        delay: 150,
        ease: 'Sine.easeOut',
      });

      // Show game over overlay simultaneously with camera pan
      showGameOverOverlay(this, {
        score: gameState.score,
        enemiesKilled: gameState.enemiesKilled,
        timeSurvived: gameState.timeSurvived,
        level: gameState.level,
        bestScore: gameState.bestScore,
      }, () => {
        // On restart: stop UIScene and restart GameScene
        this.scene.stop('UIScene');
        eventBus.emit(Events.MUSIC_STOP);
        eventBus.emit(Events.GAME_RESTART);
        this.scene.restart();
      });
    };
    const onTap = () => showOverlay();

    // Allow tap to skip after 1s (real time, unaffected by slow-mo)
    setTimeout(() => {
      this.input.on('pointerdown', onTap);
      this.input.keyboard.on('keydown-SPACE', onTap);
    }, 1000);
    // Auto-show overlay after 3s regardless
    setTimeout(() => showOverlay(), 3000);
  }
}
