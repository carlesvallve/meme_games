import Phaser from 'phaser';
import { VFX, COLORS, PX, GAME, UI } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';

/**
 * Visual effects system: particles, screen shake, floating numbers, vignette.
 * Listens to EventBus and renders all VFX for the GameScene.
 */
export class VFXSystem {
  constructor(scene) {
    this.scene = scene;

    // Vignette overlay (drawn once, stays on top)
    this.vignetteGfx = null;
    this.drawVignette();

    // Bind handlers
    this._onSlopSplatter = this.slopSplatter.bind(this);
    this._onXPSparkle = this.xpSparkle.bind(this);
    this._onScreenShake = this.screenShake.bind(this);
    this._onCameraFlash = this.cameraFlash.bind(this);
    this._onDamageNumber = this.damageNumber.bind(this);
    this._onDeathExplosion = this.deathExplosion.bind(this);
    this._onEnemyKilled = this.handleEnemyKilled.bind(this);
    this._onXPCollected = this.handleXPCollected.bind(this);
    this._onPlayerHit = this.handlePlayerHit.bind(this);
    this._onBossSpawn = this.handleBossSpawn.bind(this);
    this._onLevelUp = this.handleLevelUp.bind(this);
    this._onPlayerDied = this.handlePlayerDied.bind(this);

    // Subscribe
    eventBus.on(Events.SLOP_SPLATTER, this._onSlopSplatter);
    eventBus.on(Events.XP_SPARKLE, this._onXPSparkle);
    eventBus.on(Events.SCREEN_SHAKE, this._onScreenShake);
    eventBus.on(Events.CAMERA_FLASH, this._onCameraFlash);
    eventBus.on(Events.DAMAGE_NUMBER, this._onDamageNumber);
    eventBus.on(Events.DEATH_EXPLOSION, this._onDeathExplosion);

    // Listen to game events to auto-trigger VFX
    eventBus.on(Events.ENEMY_KILLED, this._onEnemyKilled);
    eventBus.on(Events.XP_COLLECTED, this._onXPCollected);
    eventBus.on(Events.PLAYER_HIT, this._onPlayerHit);
    eventBus.on(Events.BOSS_SPAWN, this._onBossSpawn);
    eventBus.on(Events.LEVEL_UP, this._onLevelUp);
    eventBus.on(Events.PLAYER_DIED, this._onPlayerDied);
  }

  // --- High-level event handlers ---

  handleEnemyKilled({ x, y, isBoss, config }) {
    const color = config ? config.color : COLORS.SLOP_GREEN;
    const count = isBoss ? VFX.BOSS_SPLATTER_COUNT : VFX.SLOP_SPLATTER_COUNT;
    const speed = isBoss ? VFX.BOSS_SPLATTER_SPEED : VFX.SLOP_SPLATTER_SPEED;
    this.slopSplatter({ x, y, color, count, speed });
  }

  handleXPCollected({ x, y }) {
    this.xpSparkle({ x, y });
  }

  handlePlayerHit() {
    this.screenShake({
      intensity: VFX.SHAKE_DAMAGE_INTENSITY,
      duration: VFX.SHAKE_DAMAGE_DURATION,
    });
  }

  handleBossSpawn({ x, y }) {
    // Screen-edge flash + shake
    this.cameraFlash({
      duration: VFX.BOSS_WARN_FLASH_DURATION,
      r: VFX.BOSS_WARN_FLASH_COLOR.r,
      g: VFX.BOSS_WARN_FLASH_COLOR.g,
      b: VFX.BOSS_WARN_FLASH_COLOR.b,
    });
    this.screenShake({
      intensity: VFX.SHAKE_BOSS_INTENSITY,
      duration: VFX.SHAKE_BOSS_DURATION,
    });

    // Boss warning text — scrollFactor(0) pins to screen
    const warnText = this.scene.add.text(GAME.WIDTH / 2, GAME.HEIGHT / 2, 'BOSS INCOMING!', {
      fontSize: Math.round(UI.BASE * UI.HEADING_RATIO) + 'px',
      fontFamily: UI.FONT,
      color: '#ff4444',
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 4 * PX,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1100).setAlpha(0);

    this.scene.tweens.add({
      targets: warnText,
      alpha: 1,
      scaleX: 1.2,
      scaleY: 1.2,
      duration: 300,
      yoyo: true,
      hold: 400,
      ease: 'Quad.easeOut',
      onComplete: () => warnText.destroy(),
    });
  }

  handleLevelUp() {
    // No camera flash — the level-up overlay provides visual feedback.
    // (A flash here would freeze mid-fade because GameScene gets paused.)
  }

  handlePlayerDied() {
    const player = this.scene.player;
    if (!player || !player.sprite) return;
    const px = player.sprite.x;
    const py = player.sprite.y;

    // Hide the ship immediately
    player.sprite.setVisible(false);

    // Heavy screen shake
    this.screenShake({
      intensity: VFX.SHAKE_DEATH_INTENSITY,
      duration: VFX.SHAKE_DEATH_DURATION,
    });

    // Bright white flash
    this.cameraFlash({ duration: 350, r: 255, g: 255, b: 255 });

    // --- Big multi-phase explosion ---

    // Phase 1: Bright core flash (expanding circle)
    const coreFlash = this.scene.add.circle(px, py, 8 * PX, 0xffffff, 1).setDepth(30);
    this.scene.tweens.add({
      targets: coreFlash,
      scaleX: 6,
      scaleY: 6,
      alpha: 0,
      duration: 400,
      ease: 'Quad.easeOut',
      onComplete: () => coreFlash.destroy(),
    });

    // Phase 2: Expanding shockwave ring
    const ring = this.scene.add.graphics().setDepth(28);
    let ringRadius = 10 * PX;
    const ringMax = 120 * PX;
    const ringTimer = this.scene.time.addEvent({
      delay: 16,
      repeat: 25,
      callback: () => {
        ringRadius += (ringMax - ringRadius) * 0.15;
        const alpha = 1 - ringRadius / ringMax;
        ring.clear();
        ring.lineStyle(3 * PX * alpha, 0x66ccff, alpha * 0.8);
        ring.strokeCircle(px, py, ringRadius);
        ring.lineStyle(1.5 * PX * alpha, 0xffffff, alpha * 0.5);
        ring.strokeCircle(px, py, ringRadius * 0.7);
      },
    });
    this.scene.time.delayedCall(500, () => {
      ringTimer.destroy();
      ring.destroy();
    });

    // Phase 3: Fiery explosion particles (orange/yellow/red)
    const fireColors = [0xff6633, 0xffcc00, 0xff4444, 0xff8833, 0xffff66];
    for (let i = 0; i < 24; i++) {
      const angle = (Math.PI * 2 * i) / 24 + (Math.random() - 0.5) * 0.5;
      const vel = (100 + Math.random() * 120) * PX;
      const size = (3 + Math.random() * 5) * PX;
      const color = Phaser.Utils.Array.GetRandom(fireColors);
      const particle = this.scene.add.circle(px, py, size, color, 1).setDepth(26);
      this.scene.tweens.add({
        targets: particle,
        x: px + Math.cos(angle) * vel,
        y: py + Math.sin(angle) * vel,
        alpha: 0,
        scale: 0.1,
        duration: 600 + Math.random() * 400,
        ease: 'Quad.easeOut',
        onComplete: () => particle.destroy(),
      });
    }

    // Phase 4: Ship debris (blue/cyan fragments — the ship breaking apart)
    const debrisColors = [0x4488ff, 0x66ccff, 0x44ddff, 0xffffff];
    for (let i = 0; i < 12; i++) {
      const angle = (Math.PI * 2 * i) / 12 + (Math.random() - 0.5) * 0.3;
      const vel = (40 + Math.random() * 80) * PX;
      const size = (2 + Math.random() * 3) * PX;
      const color = Phaser.Utils.Array.GetRandom(debrisColors);
      const shard = this.scene.add.rectangle(
        px, py, size, size * (1 + Math.random()), color, 1
      ).setDepth(27).setRotation(Math.random() * Math.PI * 2);
      this.scene.tweens.add({
        targets: shard,
        x: px + Math.cos(angle) * vel,
        y: py + Math.sin(angle) * vel + 20 * PX, // slight gravity
        alpha: 0,
        rotation: shard.rotation + (Math.random() - 0.5) * 6,
        scale: 0.2,
        duration: 800 + Math.random() * 500,
        ease: 'Quad.easeOut',
        onComplete: () => shard.destroy(),
      });
    }

    // Phase 5: Smoke wisps (delayed, darker)
    this.scene.time.delayedCall(200, () => {
      for (let i = 0; i < 8; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * 30 * PX;
        const smoke = this.scene.add.circle(
          px + Math.cos(angle) * dist,
          py + Math.sin(angle) * dist,
          (6 + Math.random() * 10) * PX,
          0x333333, 0.3
        ).setDepth(25);
        this.scene.tweens.add({
          targets: smoke,
          y: smoke.y - (30 + Math.random() * 40) * PX,
          alpha: 0,
          scaleX: 2,
          scaleY: 2,
          duration: 800 + Math.random() * 400,
          ease: 'Sine.easeOut',
          onComplete: () => smoke.destroy(),
        });
      }
    });

    // Phase 6: Show destroyed ship wreck (fades in after the flash)
    this.scene.time.delayedCall(300, () => {
      const wreck = this.scene.add.image(px, py, 'ship-destroyed');
      wreck.setScale(PX);
      wreck.setDepth(3);
      wreck.setAlpha(0);
      wreck.setRotation(player.sprite.rotation + (Math.random() - 0.5) * 0.4);
      // Slight tint to look scorched
      wreck.setTint(0xaa6644);

      this.scene.tweens.add({
        targets: wreck,
        alpha: 0.9,
        duration: 400,
        ease: 'Sine.easeOut',
      });

      // Intermittent spark flickers on the wreck
      const sparkTimer = this.scene.time.addEvent({
        delay: 300,
        repeat: 5,
        callback: () => {
          if (!wreck.active) return;
          const sx = px + (Math.random() - 0.5) * 12 * PX;
          const sy = py + (Math.random() - 0.5) * 12 * PX;
          const spark = this.scene.add.circle(sx, sy, 2 * PX, 0xffcc00, 1).setDepth(26);
          this.scene.tweens.add({
            targets: spark,
            alpha: 0,
            scale: 0.2,
            duration: 200,
            onComplete: () => spark.destroy(),
          });
        },
      });

      // Store reference so scene cleanup can destroy it
      this.scene._deathWreck = wreck;
      this.scene._deathSparkTimer = sparkTimer;
    });
  }

  // --- Particle effects ---

  slopSplatter({ x, y, color, count, speed }) {
    const c = color || COLORS.SLOP_GREEN;
    const n = count || VFX.SLOP_SPLATTER_COUNT;
    const spd = speed || VFX.SLOP_SPLATTER_SPEED;

    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i) / n + (Math.random() - 0.5) * 0.6;
      const vel = spd * (0.5 + Math.random() * 0.5);
      const size = VFX.SLOP_SPLATTER_SIZE.min +
        Math.random() * (VFX.SLOP_SPLATTER_SIZE.max - VFX.SLOP_SPLATTER_SIZE.min);

      const particle = this.scene.add.circle(x, y, size, c, 1).setDepth(20);

      this.scene.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * vel,
        y: y + Math.sin(angle) * vel,
        alpha: 0,
        scale: 0.2,
        duration: VFX.SLOP_SPLATTER_LIFETIME * (0.7 + Math.random() * 0.6),
        ease: 'Quad.easeOut',
        onComplete: () => particle.destroy(),
      });
    }
  }

  xpSparkle({ x, y }) {
    const colors = [0x9944ff, 0xcc66ff, 0xffffff, 0x7733cc];

    for (let i = 0; i < VFX.XP_SPARKLE_COUNT; i++) {
      const angle = (Math.PI * 2 * i) / VFX.XP_SPARKLE_COUNT + Math.random() * 0.5;
      const vel = VFX.XP_SPARKLE_SPEED * (0.5 + Math.random() * 0.5);
      const size = VFX.XP_SPARKLE_SIZE.min +
        Math.random() * (VFX.XP_SPARKLE_SIZE.max - VFX.XP_SPARKLE_SIZE.min);
      const color = Phaser.Utils.Array.GetRandom(colors);

      // Star-shaped particle: just use a small diamond/circle
      const particle = this.scene.add.star(x, y, 4, size * 0.4, size, color, 1).setDepth(20);

      this.scene.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * vel,
        y: y + Math.sin(angle) * vel,
        alpha: 0,
        scale: 0.1,
        angle: 180,
        duration: VFX.XP_SPARKLE_LIFETIME * (0.7 + Math.random() * 0.6),
        ease: 'Quad.easeOut',
        onComplete: () => particle.destroy(),
      });
    }
  }

  deathExplosion({ x, y }) {
    const colors = [0x4488ff, 0x66ccff, 0xffffff, 0xff4444];

    for (let i = 0; i < VFX.DEATH_PARTICLE_COUNT; i++) {
      const angle = (Math.PI * 2 * i) / VFX.DEATH_PARTICLE_COUNT + (Math.random() - 0.5) * 0.4;
      const vel = VFX.DEATH_PARTICLE_SPEED * (0.4 + Math.random() * 0.6);
      const size = 3 * PX + Math.random() * 4 * PX;
      const color = Phaser.Utils.Array.GetRandom(colors);

      const particle = this.scene.add.circle(x, y, size, color, 1).setDepth(25);

      this.scene.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * vel,
        y: y + Math.sin(angle) * vel,
        alpha: 0,
        scale: 0.1,
        duration: VFX.DEATH_PARTICLE_LIFETIME * (0.6 + Math.random() * 0.8),
        ease: 'Quad.easeOut',
        onComplete: () => particle.destroy(),
      });
    }
  }

  // --- Camera effects ---

  screenShake({ intensity, duration }) {
    this.scene.cameras.main.shake(duration, intensity);
  }

  cameraFlash({ duration, r, g, b }) {
    this.scene.cameras.main.flash(duration, r || 255, g || 255, b || 255);
  }

  // --- Floating damage numbers ---

  damageNumber({ x, y, amount, color }) {
    const textColor = color || '#ffffff';
    const size = Math.round(UI.BASE * VFX.DAMAGE_NUM_SIZE_RATIO);

    const dmgText = this.scene.add.text(
      x + (Math.random() - 0.5) * 10 * PX,
      y - 10 * PX,
      `${amount}`,
      {
        fontSize: size + 'px',
        fontFamily: UI.FONT,
        color: textColor,
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 2 * PX,
      }
    ).setOrigin(0.5).setDepth(30);

    this.scene.tweens.add({
      targets: dmgText,
      y: dmgText.y - VFX.DAMAGE_NUM_RISE,
      alpha: 0,
      scaleX: 0.6,
      scaleY: 0.6,
      duration: VFX.DAMAGE_NUM_DURATION,
      ease: 'Quad.easeOut',
      onComplete: () => dmgText.destroy(),
    });
  }

  // --- Vignette ---

  drawVignette() {
    const w = GAME.WIDTH;
    const h = GAME.HEIGHT;

    // Use a canvas with a radial gradient for a proper single-pass vignette
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.sqrt(cx * cx + cy * cy);
    const innerR = maxR * VFX.VIGNETTE_RADIUS_RATIO;

    const gradient = ctx.createRadialGradient(cx, cy, innerR, cx, cy, maxR);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, `rgba(0,0,0,${VFX.VIGNETTE_ALPHA})`);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // Add as texture and create image
    const texKey = '__vignette__';
    if (!this.scene.textures.exists(texKey)) {
      this.scene.textures.addCanvas(texKey, canvas);
    }
    this.vignetteGfx = this.scene.add.image(cx, cy, texKey).setDepth(1050).setScrollFactor(0);
  }

  // --- Cleanup ---

  destroy() {
    eventBus.off(Events.SLOP_SPLATTER, this._onSlopSplatter);
    eventBus.off(Events.XP_SPARKLE, this._onXPSparkle);
    eventBus.off(Events.SCREEN_SHAKE, this._onScreenShake);
    eventBus.off(Events.CAMERA_FLASH, this._onCameraFlash);
    eventBus.off(Events.DAMAGE_NUMBER, this._onDamageNumber);
    eventBus.off(Events.DEATH_EXPLOSION, this._onDeathExplosion);
    eventBus.off(Events.ENEMY_KILLED, this._onEnemyKilled);
    eventBus.off(Events.XP_COLLECTED, this._onXPCollected);
    eventBus.off(Events.PLAYER_HIT, this._onPlayerHit);
    eventBus.off(Events.BOSS_SPAWN, this._onBossSpawn);
    eventBus.off(Events.LEVEL_UP, this._onLevelUp);
    eventBus.off(Events.PLAYER_DIED, this._onPlayerDied);
    if (this.vignetteGfx) this.vignetteGfx.destroy();
  }
}
