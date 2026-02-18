import Phaser from 'phaser';
import { GAME, PX, UI, COLORS } from '../core/Constants.js';
import { playTypeBlip } from '../audio/AudioBridge.js';

const _isMobile = GAME.IS_MOBILE;

const DIALOG = {
  BOX_W_RATIO: _isMobile ? 0.90 : 0.85,
  BOX_H_RATIO: _isMobile ? 0.12 : 0.18,
  PADDING: (_isMobile ? 10 : 16) * PX,
  BORDER_WIDTH: 2 * PX,
  BORDER_COLOR: 0x9944ff,      // default purple (overridden by accentColor)
  BG_COLOR: 0x0a050f,          // dark background
  BG_ALPHA: 0.7,
  TEXT_COLOR: '#f0e8ff',        // near-white lavender text
  TEXT_STROKE: '#110022',       // dark stroke for legibility
  TEXT_STROKE_WIDTH: 3 * PX,
  SPEAKER_COLOR: '#dd99ff',    // default (overridden by accentColor)
  TYPEWRITER_SPEED: 20, // ms per character
  DISMISS_DELAY: 300, // min ms before tap can dismiss
  CORNER_RADIUS: 6 * PX,
  DEPTH: 1100, // above lighting overlay (999)
};

/**
 * Final Fantasy-style dialog box with typewriter text.
 * Usage:
 *   const dialog = new DialogBubble(scene);
 *   await dialog.show('Speaker', 'Hello world!', { onShow: async () => {}, onDismiss: async () => {} });
 *   dialog.destroy();
 */
export class DialogBubble {
  constructor(scene) {
    this.scene = scene;
    this.container = null;
    this.typewriterEvent = null;
    this.resolvePromise = null;
    this.canDismiss = false;
    this.isShowing = false;
    this.fullText = '';
    this.displayedChars = 0;
    this.textObj = null;
    this.speakerObj = null;
  }

  /**
   * Show a dialog box with typewriter text. Returns a Promise that resolves when dismissed.
   * @param {string|null} speaker - Speaker name (shown above text) or null
   * @param {string} text - The dialog text
   * @param {object} [opts] - { autoDismiss, pauseScene, onShow, onDismiss, accentColor, iconKey }
   */
  show(speaker, text, opts = {}) {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.isShowing = true;
      this.canDismiss = false;
      this.fullText = text;
      this.displayedChars = 0;

      const { autoDismiss = 0, pauseScene = null, onShow = null, onDismiss = null, accentColor = null, iconKey = null, typeSpeed = DIALOG.TYPEWRITER_SPEED } = opts;
      this._iconKey = iconKey;
      this._accentColor = accentColor;
      this._typeSpeed = typeSpeed;
      this.pausedScene = pauseScene;
      this._onDismissCallback = onDismiss;

      // Pause the target scene if requested
      if (pauseScene) {
        const target = this.scene.scene.get(pauseScene);
        if (target && target.scene.isActive()) {
          this.scene.scene.pause(pauseScene);
        }
      }

      // Call onShow callback (can be async, but we don't await it — box appears immediately)
      if (onShow) {
        onShow();
      }

      // Build the dialog box
      this._createBox(speaker);

      // Start typewriter
      this._startTypewriter();

      // Enable dismiss after a short delay
      this.scene.time.delayedCall(DIALOG.DISMISS_DELAY, () => {
        this.canDismiss = true;
      });

      // Input: tap/click/space to advance
      this._inputHandler = () => this._handleInput();
      this.scene.input.on('pointerdown', this._inputHandler);
      this._keyHandler = this.scene.input.keyboard.on('keydown-SPACE', this._inputHandler);

      // Auto-dismiss
      if (autoDismiss > 0) {
        this._autoDismissTimer = this.scene.time.delayedCall(autoDismiss, () => {
          if (this.isShowing) this._dismiss();
        });
      }
    });
  }

  _createBox(speaker) {
    const zoom = this.scene.cameras.main.zoom || 1;
    // Visible area in scrollFactor(0) coordinate space = GAME / zoom
    const visW = GAME.WIDTH / zoom;
    const visH = GAME.HEIGHT / zoom;
    const w = visW * DIALOG.BOX_W_RATIO;
    const fontSize = Math.round(UI.BASE * UI.SMALL_RATIO * (GAME.IS_MOBILE ? 1.35 : 1) / zoom);

    // Pre-measure text height to size the box dynamically
    const measureText = this.scene.add.text(0, 0, this.fullText, {
      fontSize: fontSize + 'px',
      fontFamily: UI.FONT,
      color: DIALOG.TEXT_COLOR,
      wordWrap: { width: w - DIALOG.PADDING * 2 },
      lineSpacing: 4 * PX,
    });
    const textHeight = measureText.height;
    measureText.destroy();

    const speakerHeight = speaker ? fontSize + 6 * PX : 0;
    const minH = visH * DIALOG.BOX_H_RATIO;
    const h = Math.max(minH, speakerHeight + textHeight + DIALOG.PADDING * 2 + 8 * PX);

    // scrollFactor(0) objects are zoom-scaled from the camera center point,
    // so the visible center is always at (GAME.WIDTH/2, GAME.HEIGHT/2) in
    // the object's coordinate space, regardless of zoom.
    const bottomMargin = 36 * PX / zoom;
    const x = GAME.WIDTH / 2;
    // Bottom of visible area in scrollFactor(0) coords
    const visBottom = GAME.HEIGHT / 2 + visH / 2;
    const y = visBottom - h / 2 - bottomMargin;

    this.container = this.scene.add.container(x, y);
    this.container.setDepth(DIALOG.DEPTH);
    this.container.setScrollFactor(0);

    // Resolve accent color (hex number) for border/glow
    const borderColor = this._accentColor || DIALOG.BORDER_COLOR;

    // Background
    const bg = this.scene.add.graphics();
    bg.fillStyle(DIALOG.BG_COLOR, DIALOG.BG_ALPHA);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, DIALOG.CORNER_RADIUS);
    bg.lineStyle(DIALOG.BORDER_WIDTH, borderColor, 0.8);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, DIALOG.CORNER_RADIUS);
    this.container.add(bg);

    // Inner glow line (subtle FF aesthetic)
    const innerGlow = this.scene.add.graphics();
    innerGlow.lineStyle(1, borderColor, 0.2);
    innerGlow.strokeRoundedRect(
      -w / 2 + 3 * PX, -h / 2 + 3 * PX,
      w - 6 * PX, h - 6 * PX,
      DIALOG.CORNER_RADIUS - 2 * PX
    );
    this.container.add(innerGlow);

    let textX = -w / 2 + DIALOG.PADDING;
    let textY = -h / 2 + DIALOG.PADDING;

    // Icon (rendered to the left of the speaker name, vertically centered with it)
    let iconOffset = 0;
    if (this._iconKey && this.scene.textures.exists(this._iconKey)) {
      const iconSize = fontSize * 2;
      const texFrame = this.scene.textures.getFrame(this._iconKey);
      const iconScale = iconSize / Math.max(texFrame.width, texFrame.height);
      const iconY = textY + fontSize * 0.5; // center icon with speaker text line
      const icon = this.scene.add.image(textX, iconY, this._iconKey);
      icon.setScale(iconScale);
      icon.setOrigin(0, 0.5);
      this.container.add(icon);
      iconOffset = iconSize + 10 * PX;
    }

    // Speaker name — colored by accent
    if (speaker) {
      // Convert accent hex number to CSS color string
      const speakerColor = this._accentColor
        ? '#' + this._accentColor.toString(16).padStart(6, '0')
        : DIALOG.SPEAKER_COLOR;
      this.speakerObj = this.scene.add.text(textX + iconOffset, textY, speaker, {
        fontSize: fontSize + 'px',
        fontFamily: UI.FONT,
        color: speakerColor,
        fontStyle: 'bold',
        stroke: DIALOG.TEXT_STROKE,
        strokeThickness: DIALOG.TEXT_STROKE_WIDTH,
      });
      this.container.add(this.speakerObj);
      textY += fontSize + 6 * PX;
    }

    // Dialog text (starts empty, filled by typewriter)
    this.textObj = this.scene.add.text(textX, textY, '', {
      fontSize: fontSize + 'px',
      fontFamily: UI.FONT,
      color: DIALOG.TEXT_COLOR,
      stroke: DIALOG.TEXT_STROKE,
      strokeThickness: DIALOG.TEXT_STROKE_WIDTH,
      wordWrap: { width: w - DIALOG.PADDING * 2 },
      lineSpacing: 4 * PX,
    });
    this.container.add(this.textObj);

    // Blinking advance indicator (bottom-right triangle)
    this.advanceIndicator = this.scene.add.triangle(
      w / 2 - DIALOG.PADDING, h / 2 - DIALOG.PADDING,
      0, 0, 8 * PX, 0, 4 * PX, 6 * PX,
      borderColor, 1
    );
    this.advanceIndicator.setAlpha(0);
    this.container.add(this.advanceIndicator);

    // Scale-in animation
    this.container.setScale(0.8);
    this.container.setAlpha(0);
    this.scene.tweens.add({
      targets: this.container,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      duration: 150,
      ease: 'Back.easeOut',
    });
  }

  _startTypewriter() {
    this.typewriterEvent = this.scene.time.addEvent({
      delay: this._typeSpeed,
      callback: () => {
        this.displayedChars++;
        this.textObj.setText(this.fullText.substring(0, this.displayedChars));
        // Blip sound every 2nd non-space character
        const ch = this.fullText[this.displayedChars - 1];
        if (ch && ch !== ' ' && this.displayedChars % 2 === 0) {
          playTypeBlip();
        }
        if (this.displayedChars >= this.fullText.length) {
          this._onTypewriterComplete();
        }
      },
      repeat: this.fullText.length - 1,
    });
  }

  _onTypewriterComplete() {
    if (this.typewriterEvent) {
      this.typewriterEvent.destroy();
      this.typewriterEvent = null;
    }
    // Show blinking advance indicator
    if (this.advanceIndicator) {
      this.scene.tweens.add({
        targets: this.advanceIndicator,
        alpha: 0.8,
        duration: 400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  _handleInput() {
    if (!this.isShowing) return;

    // If typewriter is still going, skip to end
    if (this.displayedChars < this.fullText.length) {
      if (this.typewriterEvent) {
        this.typewriterEvent.destroy();
        this.typewriterEvent = null;
      }
      this.displayedChars = this.fullText.length;
      this.textObj.setText(this.fullText);
      this._onTypewriterComplete();
      return;
    }

    // Dismiss if allowed
    if (this.canDismiss) {
      this._dismiss();
    }
  }

  _dismiss() {
    if (!this.isShowing) return;
    this.isShowing = false;

    // Clean up input
    this.scene.input.off('pointerdown', this._inputHandler);
    if (this._keyHandler) {
      this.scene.input.keyboard.off('keydown-SPACE', this._inputHandler);
    }
    if (this._autoDismissTimer) {
      this._autoDismissTimer.destroy();
      this._autoDismissTimer = null;
    }
    if (this.typewriterEvent) {
      this.typewriterEvent.destroy();
      this.typewriterEvent = null;
    }

    // Call onDismiss callback before animating out
    if (this._onDismissCallback) {
      this._onDismissCallback();
      this._onDismissCallback = null;
    }

    // Animate out
    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      scaleY: 0.8,
      duration: 120,
      ease: 'Quad.easeIn',
      onComplete: () => {
        if (this.container) {
          this.container.destroy();
          this.container = null;
        }

        // Resume paused scene
        if (this.pausedScene) {
          const target = this.scene.scene.get(this.pausedScene);
          if (target && target.scene.isPaused()) {
            this.scene.scene.resume(this.pausedScene);
          }
          this.pausedScene = null;
        }

        if (this.resolvePromise) {
          this.resolvePromise();
          this.resolvePromise = null;
        }
      },
    });
  }

  destroy() {
    if (this.typewriterEvent) this.typewriterEvent.destroy();
    if (this._autoDismissTimer) this._autoDismissTimer.destroy();
    if (this.container) this.container.destroy();
    if (this._inputHandler) {
      this.scene.input.off('pointerdown', this._inputHandler);
    }
    this.isShowing = false;
  }
}
