import Phaser from 'phaser';
import { PX, UI, GAME } from '../core/Constants.js';

const _isMobile = GAME.IS_MOBILE;

const BUBBLE = {
  PADDING_X: (_isMobile ? 6 : 8) * PX,
  PADDING_Y: (_isMobile ? 4 : 5) * PX,
  BORDER_RADIUS: 4 * PX,
  TAIL_SIZE: 5 * PX,
  MAX_WIDTH_RATIO: 0.45,
  BG_ALPHA: 0.9,
  FLOAT_SPEED: 15 * PX,
  FADE_IN: 120,
  FADE_OUT: 200,
  DEPTH: 200,
};

// Track active bubbles per target to enforce one-at-a-time rule
const _activeBubbles = new WeakMap();

/**
 * Small speech bubble that floats above a target sprite.
 * Auto-dismisses after duration. Does NOT pause the game.
 * Only one bubble per target at a time — previous is dismissed first.
 *
 * Usage:
 *   SpeechBubble.show(scene, targetSprite, 'Hello!', { duration: 2000 });
 */
export class SpeechBubble {
  /**
   * @param {Phaser.Scene} scene
   * @param {Phaser.GameObjects.Sprite} target - sprite to float above
   * @param {string} text
   * @param {object} [opts]
   * @param {number} [opts.duration=2000] - ms before auto-dismiss
   * @param {string} [opts.bgColor='#0a0f0a'] - bubble background
   * @param {string} [opts.borderColor='#44ff44'] - bubble border
   * @param {string} [opts.textColor='#ccffcc'] - text color
   * @param {number} [opts.offsetY=0] - extra vertical offset above sprite
   * @param {boolean} [opts.persistent=false] - if true, never auto-dismiss or dismiss on off-screen
   */
  /**
   * Dismiss any active bubble on the given target.
   */
  static hasActive(target) {
    const existing = _activeBubbles.get(target);
    return !!(existing && existing.alive);
  }

  static dismiss(target) {
    const existing = _activeBubbles.get(target);
    if (existing && existing.alive) {
      existing._fadeOut();
    }
  }

  static show(scene, target, text, opts = {}) {
    // Only show if target is visible inside the camera viewport (skip for persistent bubbles)
    if (!opts.persistent) {
      const wv = scene.cameras.main.worldView;
      const tx = target.x;
      const ty = target.y;
      const margin = 20 * PX;
      if (tx < wv.x - margin || tx > wv.right + margin ||
          ty < wv.y - margin || ty > wv.bottom + margin) return null;
    }

    // Dismiss any existing bubble on this target first
    SpeechBubble.dismiss(target);
    const bubble = new SpeechBubble(scene, target, text, opts);
    _activeBubbles.set(target, bubble);
    return bubble;
  }

  constructor(scene, target, text, opts = {}) {
    this.scene = scene;
    this.target = target;
    this.alive = true;

    const {
      duration = 2000,
      bgColor = 0x050a14,
      borderColor = 0x4488ff,
      textColor = '#88bbff',
      offsetY = 0,
      persistent = false,
    } = opts;
    this._persistent = persistent;

    const fontSize = Math.round(scene.game.config.height * UI.SMALL_RATIO * 0.85);
    const zoom = scene.cameras.main.zoom || 1;
    this._baseZoom = zoom; // zoom at creation time — used to counter-scale
    const visibleW = GAME.WIDTH / zoom;
    const maxWidth = visibleW * BUBBLE.MAX_WIDTH_RATIO;

    // Create text first to measure it
    this.textObj = scene.add.text(0, 0, text, {
      fontSize: fontSize + 'px',
      fontFamily: UI.FONT,
      color: textColor,
      wordWrap: { width: maxWidth - BUBBLE.PADDING_X * 2 },
      lineSpacing: 2 * PX,
    });
    this.textObj.setOrigin(0.5, 0.5);

    const textW = this.textObj.width;
    const textH = this.textObj.height;
    const boxW = textW + BUBBLE.PADDING_X * 2;
    const boxH = textH + BUBBLE.PADDING_Y * 2;

    // Container positioned above target
    const startX = target.x;
    // Extra clearance for health bars and other UI above sprites
    const healthBarClearance = 18 * PX;
    const startY = target.y - (target.displayHeight || target.height || 32 * PX) * 0.5 - boxH / 2 - BUBBLE.TAIL_SIZE - healthBarClearance + offsetY;

    this.container = scene.add.container(startX, startY);
    this.container.setDepth(BUBBLE.DEPTH);

    // Background bubble (no tail — tail is drawn separately so it can move)
    const bg = scene.add.graphics();
    bg.fillStyle(bgColor, BUBBLE.BG_ALPHA);
    bg.fillRoundedRect(-boxW / 2, -boxH / 2, boxW, boxH, BUBBLE.BORDER_RADIUS);
    bg.lineStyle(1 * PX, borderColor, 0.7);
    bg.strokeRoundedRect(-boxW / 2, -boxH / 2, boxW, boxH, BUBBLE.BORDER_RADIUS);

    this.container.add(bg);
    this.container.add(this.textObj);

    // Speech tail (separate graphics so we can reposition it each frame)
    this._tailGfx = scene.add.graphics();
    this._tailBgColor = bgColor;
    this._tailBorderColor = borderColor;
    this.container.add(this._tailGfx);
    this._drawTail(0);

    // Fade in + slight pop
    this.container.setScale(0.6);
    this.container.setAlpha(0);
    scene.tweens.add({
      targets: this.container,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      duration: BUBBLE.FADE_IN,
      ease: 'Back.easeOut',
    });

    // Float upward gently while visible (animate the offset)
    this._floatTween = scene.tweens.add({
      targets: this,
      _offsetY: this._offsetY - 10 * PX,
      duration: duration,
      ease: 'Sine.easeOut',
    });

    // Store the Y offset from the target so we can follow both X and Y
    this._offsetY = startY - target.y;

    // Store box dimensions for viewport clamping
    this._boxW = boxW;
    this._boxH = boxH;

    // Follow target position each frame (both X and Y), clamped to camera viewport
    this._followUpdate = () => {
      if (!this.alive || !this.container) return;

      if (!this._persistent) {
        // If target is destroyed or inactive, dismiss the bubble
        if (!this.target || !this.target.active) {
          this._fadeOut();
          return;
        }

        // Dismiss if target moved off-screen
        const viewRect = this.scene.cameras.main.worldView;
        const viewMargin = 20 * PX;
        if (this.target.x < viewRect.x - viewMargin || this.target.x > viewRect.right + viewMargin ||
            this.target.y < viewRect.y - viewMargin || this.target.y > viewRect.bottom + viewMargin) {
          this._fadeOut();
          return;
        }
      }
      if (!this.target) return;
      const cam = this.scene.cameras.main;
      const wv = cam.worldView; // exact visible world rect — robust at any zoom

      // Counter-scale so bubble stays same visual size regardless of zoom
      const zoomRatio = this._baseZoom / cam.zoom;
      this.container.setScale(zoomRatio);

      const rawX = this.target.x;
      const rawY = this.target.y + this._offsetY * zoomRatio;

      if (this._persistent) {
        // Persistent bubbles stay centered on target — no clamping
        this.container.x = Math.round(rawX);
        this.container.y = Math.round(rawY);
        this._drawTail(0);
      } else {
        // Clamp to visible viewport using worldView
        const halfW = (this._boxW / 2) * zoomRatio;
        const halfH = (this._boxH / 2) * zoomRatio;
        const margin = 6 * PX;

        const left = wv.x + margin + halfW;
        const right = wv.right - margin - halfW;
        const top = wv.y + margin + halfH;
        const bottom = wv.bottom - margin - halfH;

        const clampedX = Math.round(Math.max(left, Math.min(right, rawX)));
        const clampedY = Math.round(Math.max(top, Math.min(bottom, rawY)));
        this.container.x = clampedX;
        this.container.y = clampedY;

        // Move tail toward target's actual X position
        this._drawTail((rawX - clampedX) / zoomRatio);
      }
    };
    scene.events.on('update', this._followUpdate);

    // Auto-dismiss after duration (unless persistent)
    if (!persistent) {
      this._dismissTimer = scene.time.delayedCall(duration, () => {
        this._fadeOut();
      });
    }
  }

  _drawTail(offsetX) {
    if (!this._tailGfx) return;
    const g = this._tailGfx;
    const halfW = this._boxW / 2;
    const halfH = this._boxH / 2;
    const ts = BUBBLE.TAIL_SIZE;
    // Clamp tail X within the box bounds
    const tailX = Math.max(-halfW + ts + 2 * PX, Math.min(halfW - ts - 2 * PX, offsetX));

    g.clear();
    g.fillStyle(this._tailBgColor, BUBBLE.BG_ALPHA);
    g.fillTriangle(
      tailX - ts, halfH - 1,
      tailX + ts, halfH - 1,
      tailX, halfH + ts
    );
    g.lineStyle(1 * PX, this._tailBorderColor, 0.7);
    g.lineBetween(tailX - ts, halfH - 1, tailX, halfH + ts);
    g.lineBetween(tailX + ts, halfH - 1, tailX, halfH + ts);
  }

  _fadeOut() {
    if (!this.alive) return;
    this.alive = false;

    // Clear from active tracking
    if (this.target && _activeBubbles.get(this.target) === this) {
      _activeBubbles.delete(this.target);
    }

    if (this._dismissTimer) {
      this._dismissTimer.destroy();
      this._dismissTimer = null;
    }

    if (this._floatTween) {
      this._floatTween.stop();
      this._floatTween = null;
    }

    if (this._followUpdate) {
      this.scene.events.off('update', this._followUpdate);
      this._followUpdate = null;
    }

    if (!this.container) return;

    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      scaleY: 0.5,
      y: this.container.y - 8 * PX,
      duration: BUBBLE.FADE_OUT,
      ease: 'Quad.easeIn',
      onComplete: () => {
        if (this.container) {
          this.container.destroy();
          this.container = null;
        }
      },
    });
  }

  destroy() {
    this.alive = false;
    if (this._followUpdate) {
      this.scene.events.off('update', this._followUpdate);
      this._followUpdate = null;
    }
    if (this._floatTween) {
      this._floatTween.stop();
      this._floatTween = null;
    }
    if (this._dismissTimer) {
      this._dismissTimer.destroy();
      this._dismissTimer = null;
    }
    if (this.container) {
      this.container.destroy();
      this.container = null;
    }
  }
}
