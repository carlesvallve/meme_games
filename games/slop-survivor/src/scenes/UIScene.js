import Phaser from 'phaser';
import { GAME, COLORS, UI, TRANSITION, PX, VFX } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';
import { playClickSfx } from '../audio/AudioBridge.js';

export class UIScene extends Phaser.Scene {
  constructor() {
    super('UIScene');
  }

  create() {
    const padding = UI.HUD_PADDING;

    // --- Health hearts (top-left) ---
    this.hearts = [];
    this.drawHearts();

    // --- Score (top-right) ---
    const scoreSize = Math.round(GAME.HEIGHT * UI.SCORE_SIZE_RATIO);
    this.scoreText = this.add.text(GAME.WIDTH - padding, padding, 'Score: 0', {
      fontSize: scoreSize + 'px',
      fontFamily: UI.FONT,
      color: COLORS.SCORE_GOLD,
      fontStyle: 'bold',
      stroke: COLORS.UI_SHADOW,
      strokeThickness: UI.SCORE_STROKE,
    }).setOrigin(1, 0);

    // --- Enemies killed (below score) ---
    const smallSize = Math.round(GAME.HEIGHT * UI.SMALL_RATIO);
    this.killsText = this.add.text(GAME.WIDTH - padding, padding + scoreSize + 4 * PX, 'Kills: 0', {
      fontSize: smallSize + 'px',
      fontFamily: UI.FONT,
      color: COLORS.UI_TEXT,
      stroke: COLORS.UI_SHADOW,
      strokeThickness: 2 * PX,
    }).setOrigin(1, 0);

    // --- Timer (below kills) ---
    this.timerText = this.add.text(GAME.WIDTH - padding, padding + scoreSize + smallSize + 10 * PX, 'Time: 0:00', {
      fontSize: smallSize + 'px',
      fontFamily: UI.FONT,
      color: COLORS.UI_TEXT,
      stroke: COLORS.UI_SHADOW,
      strokeThickness: 2 * PX,
    }).setOrigin(1, 0);

    // --- Level indicator (below hearts) ---
    this.levelText = this.add.text(padding, padding + UI.HEART_SIZE + 10 * PX, 'Lv.1', {
      fontSize: smallSize + 'px',
      fontFamily: UI.FONT,
      color: COLORS.XP_PURPLE,
      fontStyle: 'bold',
      stroke: COLORS.UI_SHADOW,
      strokeThickness: 2 * PX,
    });

    // --- XP bar (below level) ---
    this.xpBarX = padding;
    this.xpBarY = padding + UI.HEART_SIZE + 10 * PX + smallSize + 6 * PX;
    this.xpBar = this.add.graphics();
    this.drawXPBar(0, 1);

    // --- Mute button (top-right, below timer) ---
    this.createMuteButton();

    // --- Fade in all HUD elements ---
    const hudElements = [this.scoreText, this.killsText, this.timerText, this.levelText, this.xpBar, this.muteIcon, ...this.hearts];
    for (const el of hudElements) {
      if (el) el.setAlpha(0);
    }
    this.tweens.add({
      targets: hudElements.filter(Boolean),
      alpha: 1,
      duration: 300,
      ease: 'Quad.easeOut',
    });

    // --- Event handlers ---
    this._lastScore = 0;
    this.onScoreChanged = ({ score }) => {
      const delta = score - this._lastScore;
      this._lastScore = score;
      this.scoreText.setText(`Score: ${score}`);
      this.tweens.add({
        targets: this.scoreText,
        scaleX: TRANSITION.SCORE_POP_SCALE,
        scaleY: TRANSITION.SCORE_POP_SCALE,
        duration: TRANSITION.SCORE_POP_DURATION,
        yoyo: true,
        ease: 'Quad.easeOut',
      });

      // Floating "+N" near score text
      if (delta > 0) {
        const floater = this.add.text(
          this.scoreText.x - this.scoreText.width * 0.5,
          this.scoreText.y + this.scoreText.height + 4 * PX,
          `+${delta}`,
          {
            fontSize: Math.round(GAME.HEIGHT * UI.SMALL_RATIO) + 'px',
            fontFamily: UI.FONT,
            color: '#ffff00',
            fontStyle: 'bold',
            stroke: '#000000',
            strokeThickness: 2 * PX,
          }
        ).setOrigin(0.5, 0);

        this.tweens.add({
          targets: floater,
          y: floater.y - 20 * PX,
          alpha: 0,
          duration: 500,
          ease: 'Quad.easeOut',
          onComplete: () => floater.destroy(),
        });
      }
    };

    this.onPlayerHit = () => {
      this.drawHearts();
      // Red flash on UI camera
      this.cameras.main.flash(150, 255, 0, 0, false, null, this);
      // Shake the hearts briefly
      for (const h of this.hearts) {
        this.tweens.add({
          targets: h,
          x: h.x + 3 * PX,
          duration: 40,
          yoyo: true,
          repeat: 2,
        });
      }
    };

    this.onXPChanged = ({ xp, xpToNext, level }) => {
      this.drawXPBar(xp, xpToNext);
      const prevLevel = parseInt(this.levelText.text.replace('Lv.', ''), 10);
      this.levelText.setText(`Lv.${level}`);
      // Pop the level text on level up
      if (level > prevLevel) {
        this.tweens.add({
          targets: this.levelText,
          scaleX: 1.5,
          scaleY: 1.5,
          duration: 120,
          yoyo: true,
          ease: 'Quad.easeOut',
        });
        // Floating "LEVEL UP!" text
        const lvlUp = this.add.text(GAME.WIDTH / 2, GAME.HEIGHT * 0.15, 'LEVEL UP!', {
          fontSize: Math.round(GAME.HEIGHT * UI.HEADING_RATIO) + 'px',
          fontFamily: UI.FONT,
          color: '#ffcc00',
          fontStyle: 'bold',
          stroke: '#000000',
          strokeThickness: 4 * PX,
        }).setOrigin(0.5);
        this.tweens.add({
          targets: lvlUp,
          y: lvlUp.y - 30 * PX,
          alpha: 0,
          scaleX: 1.3,
          scaleY: 1.3,
          duration: 800,
          ease: 'Quad.easeOut',
          onComplete: () => lvlUp.destroy(),
        });
      }
    };

    this.onEnemyKilled = () => {
      this.killsText.setText(`Kills: ${gameState.enemiesKilled}`);
    };

    this.onWaveStart = ({ wave }) => {
      if (wave > 0 && wave % 5 === 0) {
        const waveText = this.add.text(GAME.WIDTH / 2, GAME.HEIGHT * 0.5, `WAVE ${wave}`, {
          fontSize: Math.round(GAME.HEIGHT * UI.HEADING_RATIO * 0.8) + 'px',
          fontFamily: UI.FONT,
          color: '#44ff44',
          fontStyle: 'bold',
          stroke: '#000000',
          strokeThickness: 3 * PX,
        }).setOrigin(0.5).setAlpha(0);

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
    };

    eventBus.on(Events.SCORE_CHANGED, this.onScoreChanged);
    eventBus.on(Events.PLAYER_HIT, this.onPlayerHit);
    eventBus.on(Events.XP_CHANGED, this.onXPChanged);
    eventBus.on(Events.ENEMY_KILLED, this.onEnemyKilled);
    eventBus.on(Events.WAVE_START, this.onWaveStart);

    // Update timer every second
    this.timerEvent = this.time.addEvent({
      delay: 1000,
      callback: () => {
        const t = gameState.timeSurvived;
        const mins = Math.floor(t / 60);
        const secs = t % 60;
        this.timerText.setText(`Time: ${mins}:${secs.toString().padStart(2, '0')}`);
      },
      loop: true,
    });

    this.events.on('shutdown', () => {
      eventBus.off(Events.SCORE_CHANGED, this.onScoreChanged);
      eventBus.off(Events.PLAYER_HIT, this.onPlayerHit);
      eventBus.off(Events.XP_CHANGED, this.onXPChanged);
      eventBus.off(Events.ENEMY_KILLED, this.onEnemyKilled);
      eventBus.off(Events.WAVE_START, this.onWaveStart);
      if (this.timerEvent) this.timerEvent.destroy();
    });
  }

  drawHearts() {
    // Clear existing
    this.hearts.forEach(h => h.destroy());
    this.hearts = [];

    const padding = UI.HUD_PADDING;
    const size = UI.HEART_SIZE;
    const spacing = UI.HEART_SPACING;

    for (let i = 0; i < gameState.maxHealth; i++) {
      const x = padding + i * spacing + size / 2;
      const y = padding + size / 2;
      const gfx = this.add.graphics();

      if (i < gameState.health) {
        // Filled heart
        gfx.fillStyle(0xff4444, 1);
      } else {
        // Empty heart
        gfx.fillStyle(0x333333, 0.6);
      }

      // Simple heart shape using circles + triangle
      const hs = size * 0.45;
      gfx.fillCircle(x - hs * 0.35, y - hs * 0.2, hs * 0.5);
      gfx.fillCircle(x + hs * 0.35, y - hs * 0.2, hs * 0.5);
      gfx.fillTriangle(
        x - hs * 0.7, y,
        x + hs * 0.7, y,
        x, y + hs * 0.8
      );

      this.hearts.push(gfx);
    }
  }

  createMuteButton() {
    const size = Math.max(36 * PX, UI.MIN_TOUCH);
    // Position below the timer text area
    const scoreSize = Math.round(GAME.HEIGHT * UI.SCORE_SIZE_RATIO);
    const smallSize = Math.round(GAME.HEIGHT * UI.SMALL_RATIO);
    const x = GAME.WIDTH - size / 2 - 6 * PX;
    const y = UI.HUD_PADDING + scoreSize + smallSize * 2 + 24 * PX;

    this.muteIcon = this.add.text(x, y, gameState.isMuted ? '🔇' : '🔊', {
      fontSize: Math.round(size * 0.45) + 'px',
    }).setOrigin(0.5).setDepth(200);

    this.muteIcon.setInteractive({ useHandCursor: true });
    this.muteIcon.on('pointerup', () => {
      eventBus.emit(Events.AUDIO_TOGGLE_MUTE);
      this.muteIcon.setText(gameState.isMuted ? '🔇' : '🔊');
    });

    // M key shortcut
    this._muteKeyHandler = this.input.keyboard.on('keydown-M', () => {
      eventBus.emit(Events.AUDIO_TOGGLE_MUTE);
      if (this.muteIcon) this.muteIcon.setText(gameState.isMuted ? '🔇' : '🔊');
    });
  }

  drawXPBar(xp, xpToNext) {
    this.xpBar.clear();
    const w = UI.XP_BAR_WIDTH;
    const h = UI.XP_BAR_HEIGHT;
    const x = this.xpBarX;
    const y = this.xpBarY;

    // Background
    this.xpBar.fillStyle(0x222222, 0.8);
    this.xpBar.fillRoundedRect(x, y, w, h, h / 2);

    // Fill
    const ratio = Math.min(xp / xpToNext, 1);
    if (ratio > 0) {
      this.xpBar.fillStyle(0x9944ff, 1);
      this.xpBar.fillRoundedRect(x, y, w * ratio, h, h / 2);
    }

    // Border
    this.xpBar.lineStyle(1, 0x9944ff, 0.5);
    this.xpBar.strokeRoundedRect(x, y, w, h, h / 2);
  }
}
