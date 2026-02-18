import Phaser from 'phaser';
import { GAME, COLORS, UI, TRANSITION, PX, VFX } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';
import { playClickSfx } from '../audio/AudioBridge.js';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  create() {
    const w = GAME.WIDTH;
    const h = GAME.HEIGHT;
    const cx = w / 2;

    this._transitioning = false;

    // --- Audio: try to init and play menu music ---
    // Browser autoplay policy may block until first user gesture.
    // initStrudel() is idempotent, so we call it here and again on first interaction.
    eventBus.emit(Events.AUDIO_INIT);
    eventBus.emit(Events.MUSIC_MENU);

    // --- Mute button (top-right) ---
    this.createMuteButton();

    // --- Gradient background ---
    this.drawGradient(w, h, COLORS.BG_TOP, COLORS.BG_BOTTOM);

    // --- Floating particle background ---
    this.menuParticles = [];
    this.spawnMenuParticles(w, h);

    // --- Slop drip decorations ---
    this.drawSlopDecor(w, h);

    // --- Create all content elements first, then distribute evenly ---

    const titleSize = Math.round(h * UI.TITLE_RATIO);
    const title = this.add.text(cx, 0, 'SLOP SURVIVOR', {
      fontSize: titleSize + 'px',
      fontFamily: UI.FONT,
      color: '#44ff44',
      fontStyle: 'bold',
      shadow: { offsetX: 0, offsetY: 4, color: 'rgba(0,80,0,0.6)', blur: 12, fill: true },
    }).setOrigin(0.5);

    const subSize = Math.round(h * UI.SMALL_RATIO);
    const subtitle = this.add.text(cx, 0, 'The return of the #Microslop', {
      fontSize: subSize + 'px',
      fontFamily: UI.FONT,
      color: '#66cc66',
    }).setOrigin(0.5);

    const tagSize = Math.round(h * UI.SMALL_RATIO * 0.85);
    const tagline = this.add.text(cx, 0, 'Survive the AI slop coding invasion', {
      fontSize: tagSize + 'px',
      fontFamily: UI.FONT,
      color: COLORS.MUTED_TEXT,
    }).setOrigin(0.5);

    const btnH = Math.max(GAME.HEIGHT * UI.BTN_H_RATIO, UI.MIN_TOUCH);
    const playBtn = this.createButton(cx, 0, 'PLAY', () => this.startGame());

    const hintSize = Math.round(h * UI.SMALL_RATIO * 0.9);
    const isMobile = GAME.IS_MOBILE;
    const hintText = isMobile
      ? 'Drag to Move  |  Tap to Shoot'
      : 'WASD to Move  |  Space to Shoot';
    const hint = this.add.text(cx, 0, hintText, {
      fontSize: hintSize + 'px',
      fontFamily: UI.FONT,
      color: COLORS.MUTED_TEXT,
      align: 'center',
      lineSpacing: 8 * PX,
      wordWrap: { width: w * 0.9 },
    }).setOrigin(0.5);

    // --- Distribute content evenly within usable area ---
    // Content rows: title, subtitle+tagline (grouped), play button, hint
    const topMargin = h * 0.18;
    const bottomMargin = h * 0.18;
    const usableH = h - topMargin - bottomMargin;

    // Measure content heights
    const subTagGap = 12 * PX; // gap between subtitle and tagline
    const rowHeights = [
      title.height,
      subtitle.height + subTagGap + tagline.height,
      btnH,
      hint.height,
    ];
    const totalContentH = rowHeights.reduce((s, rh) => s + rh, 0);
    const gap = (usableH - totalContentH) / (rowHeights.length - 1);

    // Position each row
    let curY = topMargin + rowHeights[0] / 2;
    title.setY(curY);

    curY += rowHeights[0] / 2 + gap + rowHeights[1] / 2;
    // Center the subtitle+tagline group
    const groupCenterY = curY;
    subtitle.setY(groupCenterY - (tagline.height + subTagGap) / 2);
    tagline.setY(groupCenterY + (subtitle.height + subTagGap) / 2);

    curY += rowHeights[1] / 2 + gap + rowHeights[2] / 2;
    playBtn.setY(curY);

    curY += rowHeights[2] / 2 + gap + rowHeights[3] / 2;
    hint.setY(curY);

    // --- Animations ---
    // Title float
    this.tweens.add({
      targets: title,
      y: title.y - 6 * PX,
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Hint pulse
    this.tweens.add({
      targets: hint,
      alpha: 0.3,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // --- Keyboard shortcut ---
    this.input.keyboard.once('keydown-SPACE', () => this.startGame());

    // --- Touch to start ---
    this.input.once('pointerdown', () => this.startGame());

    // --- Fade in ---
    this.cameras.main.fadeIn(TRANSITION.FADE_DURATION, 0, 0, 0);
  }

  spawnMenuParticles(w, h) {
    const colors = [0x44ff44, 0x22cc22, 0x9944ff, 0x66ccff];
    for (let i = 0; i < VFX.MENU_PARTICLE_COUNT; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const size = VFX.MENU_PARTICLE_SIZE.min +
        Math.random() * (VFX.MENU_PARTICLE_SIZE.max - VFX.MENU_PARTICLE_SIZE.min);
      const alpha = VFX.MENU_PARTICLE_ALPHA.min +
        Math.random() * (VFX.MENU_PARTICLE_ALPHA.max - VFX.MENU_PARTICLE_ALPHA.min);
      const color = Phaser.Utils.Array.GetRandom(colors);

      const p = this.add.circle(x, y, size, color, alpha).setDepth(0);
      p._vy = -(VFX.MENU_PARTICLE_SPEED * (0.3 + Math.random() * 0.7));
      p._vx = (Math.random() - 0.5) * VFX.MENU_PARTICLE_SPEED * 0.5;
      p._baseAlpha = alpha;
      this.menuParticles.push(p);
    }
  }

  update(time, delta) {
    const dt = delta / 1000;
    for (const p of this.menuParticles) {
      p.x += p._vx * dt;
      p.y += p._vy * dt;
      // Wrap around
      if (p.y < -10) p.y = GAME.HEIGHT + 10;
      if (p.x < -10) p.x = GAME.WIDTH + 10;
      if (p.x > GAME.WIDTH + 10) p.x = -10;
      // Subtle pulse
      p.alpha = p._baseAlpha + Math.sin(time * 0.003 + p.x) * 0.08;
    }
  }

  drawSlopDecor(w, h) {
    const gfx = this.add.graphics();
    gfx.fillStyle(0x44ff44, 0.08);
    // Dripping blobs at top
    for (let i = 0; i < 8; i++) {
      const x = Math.random() * w;
      const r = 20 * PX + Math.random() * 40 * PX;
      gfx.fillCircle(x, -r * 0.3, r);
      // Drip
      const dripH = 30 * PX + Math.random() * 60 * PX;
      gfx.fillRect(x - r * 0.15, 0, r * 0.3, dripH);
      gfx.fillCircle(x, dripH, r * 0.2);
    }
  }

  startGame() {
    if (this._transitioning) return;
    this._transitioning = true;

    // Ensure audio is initialized on this user gesture
    eventBus.emit(Events.AUDIO_INIT);
    playClickSfx();
    eventBus.emit(Events.MUSIC_STOP);
    eventBus.emit(Events.GAME_START);
    this.cameras.main.fadeOut(TRANSITION.FADE_DURATION, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('GameScene');
      this.scene.launch('UIScene');
    });
  }

  // --- Helpers ---

  drawGradient(w, h, topColor, bottomColor) {
    const bg = this.add.graphics();
    const top = Phaser.Display.Color.IntegerToColor(topColor);
    const bot = Phaser.Display.Color.IntegerToColor(bottomColor);
    const steps = 64;
    const bandH = Math.ceil(h / steps);

    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const r = Math.round(top.red + (bot.red - top.red) * t);
      const g = Math.round(top.green + (bot.green - top.green) * t);
      const b = Math.round(top.blue + (bot.blue - top.blue) * t);
      bg.fillStyle(Phaser.Display.Color.GetColor(r, g, b));
      bg.fillRect(0, i * bandH, w, bandH + 1);
    }
  }

  createButton(x, y, label, callback) {
    const btnW = Math.max(GAME.WIDTH * UI.BTN_W_RATIO, 160);
    const btnH = Math.max(GAME.HEIGHT * UI.BTN_H_RATIO, UI.MIN_TOUCH);
    const radius = UI.BTN_RADIUS;

    const container = this.add.container(x, y);

    const bg = this.add.graphics();
    this.fillBtn(bg, btnW, btnH, radius, COLORS.BTN_PRIMARY);
    container.add(bg);

    const fontSize = Math.round(GAME.HEIGHT * UI.BODY_RATIO);
    const text = this.add.text(0, 0, label, {
      fontSize: fontSize + 'px',
      fontFamily: UI.FONT,
      color: COLORS.BTN_TEXT,
      fontStyle: 'bold',
    }).setOrigin(0.5);

    container.add(text);

    container.setSize(btnW, btnH);
    container.setInteractive({ useHandCursor: true });

    container.on('pointerover', () => {
      this.fillBtn(bg, btnW, btnH, radius, COLORS.BTN_PRIMARY_HOVER);
      this.tweens.add({ targets: container, scaleX: 1.05, scaleY: 1.05, duration: 80 });
    });

    container.on('pointerout', () => {
      this.fillBtn(bg, btnW, btnH, radius, COLORS.BTN_PRIMARY);
      this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 80 });
    });

    container.on('pointerdown', (pointer, lx, ly, event) => {
      event.stopPropagation();
      this.fillBtn(bg, btnW, btnH, radius, COLORS.BTN_PRIMARY_PRESS);
      container.setScale(0.95);
    });

    container.on('pointerup', () => {
      container.setScale(1);
      callback();
    });

    return container;
  }

  fillBtn(gfx, w, h, radius, color) {
    gfx.clear();
    gfx.fillStyle(color, 1);
    gfx.fillRoundedRect(-w / 2, -h / 2, w, h, radius);
  }

  createMuteButton() {
    const size = Math.max(36 * PX, UI.MIN_TOUCH);
    const x = GAME.WIDTH - size / 2 - 10 * PX;
    const y = size / 2 + 10 * PX;

    this.muteIcon = this.add.text(x, y, gameState.isMuted ? '🔇' : '🔊', {
      fontSize: Math.round(size * 0.5) + 'px',
    }).setOrigin(0.5).setDepth(200);

    this.muteIcon.setInteractive({ useHandCursor: true });
    this.muteIcon.on('pointerup', () => {
      eventBus.emit(Events.AUDIO_TOGGLE_MUTE);
      this.muteIcon.setText(gameState.isMuted ? '🔇' : '🔊');
    });

    // M key shortcut
    this.input.keyboard.on('keydown-M', () => {
      eventBus.emit(Events.AUDIO_TOGGLE_MUTE);
      if (this.muteIcon) this.muteIcon.setText(gameState.isMuted ? '🔇' : '🔊');
    });
  }
}
