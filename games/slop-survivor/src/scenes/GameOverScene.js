import Phaser from 'phaser';
import { GAME, COLORS, UI, TRANSITION, PX, VFX } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';
import { playClickSfx } from '../audio/AudioBridge.js';

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOverScene');
  }

  create() {
    const w = GAME.WIDTH;
    const h = GAME.HEIGHT;
    const cx = w / 2;

    this._transitioning = false;

    // --- Audio: game over music ---
    eventBus.emit(Events.MUSIC_GAMEOVER);

    // --- Mute button ---
    this.createMuteButton();

    // --- Gradient background ---
    this.drawGradient(w, h, COLORS.BG_TOP, COLORS.BG_BOTTOM);

    // --- Floating particles ---
    this.bgParticles = [];
    this.spawnBGParticles(w, h);

    // --- "GAME OVER" title (green + float, matching menu title) ---
    const titleSize = Math.round(h * UI.TITLE_RATIO);
    const title = this.add.text(cx, h * 0.12, 'GAME OVER', {
      fontSize: titleSize + 'px',
      fontFamily: UI.FONT,
      color: '#44ff44',
      fontStyle: 'bold',
      shadow: { offsetX: 0, offsetY: 4, color: 'rgba(0,80,0,0.6)', blur: 12, fill: true },
    }).setOrigin(0.5);

    // Gentle float
    this.tweens.add({
      targets: title,
      y: title.y - 6 * PX,
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // --- Stats panel ---
    const isMobile = GAME.IS_MOBILE;
    const panelW = w * (isMobile ? 0.88 : 0.65);
    const panelH = h * (isMobile ? 0.32 : 0.38);
    const panelY = h * 0.40;

    const panel = this.add.graphics();
    panel.fillStyle(0x000000, 0.4);
    panel.fillRoundedRect(cx - panelW / 2, panelY - panelH / 2, panelW, panelH, 12 * PX);
    panel.lineStyle(2, 0x44ff44, 0.4);
    panel.strokeRoundedRect(cx - panelW / 2, panelY - panelH / 2, panelW, panelH, 12 * PX);

    const labelSize = Math.round(h * UI.SMALL_RATIO);
    const valueSize = Math.round(h * UI.BODY_RATIO);
    const rowCount = 5;
    const rowSpacing = panelH / (rowCount + 1);
    let yOff = panelY - panelH / 2 + rowSpacing;

    // Score (animated counter)
    this.addStatRowAnimated(cx, yOff, 'SCORE', gameState.score, labelSize, valueSize, COLORS.SCORE_GOLD);
    yOff += rowSpacing;

    // Enemies killed
    this.addStatRow(cx, yOff, 'SLOP DESTROYED', `${gameState.enemiesKilled}`, labelSize, valueSize, '#44ff44');
    yOff += rowSpacing;

    // Time survived
    const mins = Math.floor(gameState.timeSurvived / 60);
    const secs = gameState.timeSurvived % 60;
    this.addStatRow(cx, yOff, 'TIME SURVIVED', `${mins}:${secs.toString().padStart(2, '0')}`, labelSize, valueSize, '#ffffff');
    yOff += rowSpacing;

    // Level reached
    this.addStatRow(cx, yOff, 'LEVEL REACHED', `${gameState.level}`, labelSize, valueSize, '#9944ff');
    yOff += rowSpacing;

    // Best score
    this.addStatRow(cx, yOff, 'BEST SCORE', `${gameState.bestScore}`, labelSize, valueSize, COLORS.MUTED_TEXT);

    // --- Play Again button ---
    this.createButton(cx, h * 0.72, 'PLAY AGAIN', () => this.restartGame());

    // --- Keyboard shortcut ---
    this.input.keyboard.once('keydown-SPACE', () => this.restartGame());

    // --- Touch to restart ---
    // Use a delayed listener to avoid instant restart from death tap
    this.time.delayedCall(800, () => {
      if (!this._transitioning) {
        this.input.once('pointerdown', (pointer) => {
          // Only if not on button area
          if (pointer.y > GAME.HEIGHT * 0.85 || pointer.y < GAME.HEIGHT * 0.65) {
            // Do nothing, let button handle it
          }
        });
      }
    });

    // --- Fade in ---
    this.cameras.main.fadeIn(TRANSITION.FADE_DURATION, 0, 0, 0);
  }

  spawnBGParticles(w, h) {
    const colors = [0xff4444, 0x44ff44, 0x9944ff, 0x333355];
    for (let i = 0; i < 15; i++) {
      const x = Math.random() * w;
      const y2 = Math.random() * h;
      const size = 1 * PX + Math.random() * 2.5 * PX;
      const alpha = 0.08 + Math.random() * 0.15;
      const color = Phaser.Utils.Array.GetRandom(colors);
      const p = this.add.circle(x, y2, size, color, alpha).setDepth(0);
      p._vy = -(10 * PX * (0.3 + Math.random() * 0.7));
      p._vx = (Math.random() - 0.5) * 8 * PX;
      p._baseAlpha = alpha;
      this.bgParticles.push(p);
    }
  }

  update(time, delta) {
    const dt = delta / 1000;
    for (const p of this.bgParticles) {
      p.x += p._vx * dt;
      p.y += p._vy * dt;
      if (p.y < -10) p.y = GAME.HEIGHT + 10;
      if (p.x < -10) p.x = GAME.WIDTH + 10;
      if (p.x > GAME.WIDTH + 10) p.x = -10;
    }
  }

  addStatRowAnimated(cx, y, label, finalValue, labelSize, valueSize, valueColor) {
    const colSpread = GAME.IS_MOBILE ? 0.35 : 0.2;
    this.add.text(cx - GAME.WIDTH * colSpread, y, label, {
      fontSize: labelSize + 'px',
      fontFamily: UI.FONT,
      color: COLORS.MUTED_TEXT,
    }).setOrigin(0, 0.5);

    const vText = this.add.text(cx + GAME.WIDTH * colSpread, y, '0', {
      fontSize: valueSize + 'px',
      fontFamily: UI.FONT,
      color: valueColor,
      fontStyle: 'bold',
    }).setOrigin(1, 0.5);

    // Animate counter from 0 to finalValue
    const counter = { val: 0 };
    this.tweens.add({
      targets: counter,
      val: finalValue,
      duration: VFX.SCORE_COUNTER_DURATION,
      delay: 400,
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        vText.setText(`${Math.round(counter.val)}`);
      },
      onComplete: () => {
        vText.setText(`${finalValue}`);
        // Final pop
        this.tweens.add({
          targets: vText,
          scaleX: 1.3,
          scaleY: 1.3,
          duration: 100,
          yoyo: true,
          ease: 'Quad.easeOut',
        });
      },
    });

    // Scale-in
    vText.setScale(0);
    this.tweens.add({
      targets: vText,
      scaleX: 1,
      scaleY: 1,
      duration: 400,
      delay: 200,
      ease: 'Back.easeOut',
    });
  }

  addStatRow(cx, y, label, value, labelSize, valueSize, valueColor) {
    const colSpread = GAME.IS_MOBILE ? 0.35 : 0.2;
    this.add.text(cx - GAME.WIDTH * colSpread, y, label, {
      fontSize: labelSize + 'px',
      fontFamily: UI.FONT,
      color: COLORS.MUTED_TEXT,
    }).setOrigin(0, 0.5);

    const vText = this.add.text(cx + GAME.WIDTH * colSpread, y, value, {
      fontSize: valueSize + 'px',
      fontFamily: UI.FONT,
      color: valueColor,
      fontStyle: 'bold',
    }).setOrigin(1, 0.5);

    // Scale-in animation
    vText.setScale(0);
    this.tweens.add({
      targets: vText,
      scaleX: 1,
      scaleY: 1,
      duration: 400,
      delay: 200,
      ease: 'Back.easeOut',
    });
  }

  restartGame() {
    if (this._transitioning) return;
    this._transitioning = true;

    playClickSfx();
    eventBus.emit(Events.MUSIC_STOP);
    eventBus.emit(Events.GAME_RESTART);
    this.cameras.main.fadeOut(TRANSITION.FADE_DURATION, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('MenuScene');
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

    container.on('pointerdown', () => {
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
