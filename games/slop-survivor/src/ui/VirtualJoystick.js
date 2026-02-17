import Phaser from 'phaser';
import { GAME, PX } from '../core/Constants.js';

const JOYSTICK = {
  BASE_RADIUS: 50 * PX,
  KNOB_RADIUS: 22 * PX,
  BASE_COLOR: 0xffffff,
  BASE_ALPHA: 0.12,
  KNOB_COLOR: 0xffffff,
  KNOB_ALPHA: 0.3,
  DEAD_ZONE: 8 * PX,
};

/**
 * Convert screen coords to scrollFactor(0) object coords with zoom.
 */
function screenToObj(sx, sy, zoom) {
  return {
    x: (sx - GAME.WIDTH / 2) / zoom + GAME.WIDTH / 2,
    y: (sy - GAME.HEIGHT / 2) / zoom + GAME.HEIGHT / 2,
  };
}

/**
 * Dynamic virtual joystick — appears wherever you put your finger.
 * Returns a directional vector (dx, dy) normalized to -1..1.
 * No buttons — auto-attack and laser are automatic.
 */
export class VirtualJoystick {
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this._dx = 0;
    this._dy = 0;
    this._magnitude = 0;
    this._joyPointerId = null;
    this._baseX = 0;
    this._baseY = 0;

    const zoom = scene.cameras.main.zoom || 1;
    this._zoom = zoom;
    this.maxDist = JOYSTICK.BASE_RADIUS / zoom;

    // Graphics (hidden until touch)
    this.baseGfx = scene.add.graphics();
    this.baseGfx.setScrollFactor(0);
    this.baseGfx.setDepth(1200);
    this.baseGfx.setVisible(false);

    this.knobGfx = scene.add.graphics();
    this.knobGfx.setScrollFactor(0);
    this.knobGfx.setDepth(1201);
    this.knobGfx.setVisible(false);

    // Input
    scene.input.addPointer(2);
    scene.input.on('pointerdown', this._onDown, this);
    scene.input.on('pointermove', this._onMove, this);
    scene.input.on('pointerup', this._onUp, this);
    scene.input.on('pointerupoutside', this._onUp, this);
  }

  // --- Drawing ---

  _drawBase() {
    const g = this.baseGfx;
    const r = this.maxDist;
    g.clear();
    g.lineStyle(2 * PX / this._zoom, JOYSTICK.BASE_COLOR, JOYSTICK.BASE_ALPHA * 1.5);
    g.strokeCircle(this._baseX, this._baseY, r);
    g.fillStyle(JOYSTICK.BASE_COLOR, JOYSTICK.BASE_ALPHA * 0.3);
    g.fillCircle(this._baseX, this._baseY, r);
  }

  _drawKnob(x, y) {
    const g = this.knobGfx;
    const r = JOYSTICK.KNOB_RADIUS / this._zoom;
    g.clear();
    g.fillStyle(JOYSTICK.KNOB_COLOR, JOYSTICK.KNOB_ALPHA);
    g.fillCircle(x, y, r);
    g.lineStyle(1.5 * PX / this._zoom, JOYSTICK.KNOB_COLOR, JOYSTICK.KNOB_ALPHA * 1.5);
    g.strokeCircle(x, y, r);
  }

  // --- Input ---

  _screenToObj(pointer) {
    return screenToObj(pointer.x, pointer.y, this._zoom);
  }

  _onDown(pointer) {
    // Second finger while joystick is active = fire
    if (this._joyPointerId !== null && pointer.id !== this._joyPointerId) {
      this.tapped = true;
      return;
    }
    if (this._joyPointerId !== null) return;

    const pt = this._screenToObj(pointer);
    this._joyPointerId = pointer.id;
    this._baseX = pt.x;
    this._baseY = pt.y;
    this._downTime = pointer.downTime;
    this._downX = pointer.x;
    this._downY = pointer.y;
    this._dragged = false;
    this.active = true;

    this.baseGfx.setVisible(true);
    this.knobGfx.setVisible(true);
    this._drawBase();
    this._drawKnob(pt.x, pt.y);
  }

  _onMove(pointer) {
    if (pointer.id !== this._joyPointerId) return;

    // Track if finger moved enough to count as a drag (not a tap)
    if (!this._dragged) {
      const mdx = pointer.x - this._downX;
      const mdy = pointer.y - this._downY;
      if (Math.sqrt(mdx * mdx + mdy * mdy) > 10) {
        this._dragged = true;
      }
    }

    const pt = this._screenToObj(pointer);
    this._updateJoystick(pt);
  }

  _onUp(pointer) {
    if (pointer.id !== this._joyPointerId) return;

    // Detect tap: short press with minimal movement
    const elapsed = pointer.upTime - this._downTime;
    if (elapsed < 250 && !this._dragged) {
      this.tapped = true; // consumed by GameScene
    }

    this._joyPointerId = null;
    this.active = false;
    this._dx = 0;
    this._dy = 0;
    this._magnitude = 0;
    this.baseGfx.setVisible(false);
    this.knobGfx.setVisible(false);
  }

  _updateJoystick(pt) {
    let dx = pt.x - this._baseX;
    let dy = pt.y - this._baseY;
    let dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > this.maxDist) {
      dx = (dx / dist) * this.maxDist;
      dy = (dy / dist) * this.maxDist;
      dist = this.maxDist;
    }

    const deadZone = JOYSTICK.DEAD_ZONE / this._zoom;
    if (dist < deadZone) {
      this._dx = 0;
      this._dy = 0;
      this._magnitude = 0;
      this._drawKnob(this._baseX, this._baseY);
      return;
    }

    this._dx = dx / this.maxDist;
    this._dy = dy / this.maxDist;
    this._magnitude = dist / this.maxDist;

    this._drawKnob(this._baseX + dx, this._baseY + dy);
  }

  /**
   * Get directional movement input.
   * @returns {{ moveX: number, moveY: number, magnitude: number }}
   */
  getInput() {
    return {
      moveX: this._dx,
      moveY: this._dy,
      magnitude: this._magnitude,
    };
  }

  setVisible(visible) {
    if (!visible) {
      this.baseGfx.setVisible(false);
      this.knobGfx.setVisible(false);
      this.active = false;
      this._joyPointerId = null;
      this._dx = 0;
      this._dy = 0;
      this._magnitude = 0;
    }
  }

  destroy() {
    this.scene.input.off('pointerdown', this._onDown, this);
    this.scene.input.off('pointermove', this._onMove, this);
    this.scene.input.off('pointerup', this._onUp, this);
    this.scene.input.off('pointerupoutside', this._onUp, this);
    if (this.baseGfx) this.baseGfx.destroy();
    if (this.knobGfx) this.knobGfx.destroy();
  }
}
