import * as THREE from 'three';
import { DUNGEON } from '../core/Constants.js';

/**
 * Renders combat meters as a textured plane on the dungeon floor.
 * This makes them look like they're truly lying on the ground,
 * matching the 3D camera perspective perfectly.
 */
export class FloorMeterDisplay {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.canvas = null;
    this.ctx = null;
    this.texture = null;
    this._panelImg = null;

    // Preload panel image
    const img = new Image();
    img.src = '/images/ui/frames/frame-black.png';
    img.onload = () => { this._panelImg = img; this._redraw(); };

    // State
    this.playerMeter = 0;
    this.enemyMeter = 0;
    this.playerMax = 12;
    this.enemyMax = 12;
    this.playerBusted = false;
    this.enemyBusted = false;
    this.playerCards = [];
    this.enemyCards = [];
    this.round = 1;
    this.playerStood = false;
    this.enemyStood = false;
  }

  show(x, z, playerMax, enemyMax) {
    this.playerMax = playerMax;
    this.enemyMax = enemyMax;
    this.playerMeter = 0;
    this.enemyMeter = 0;
    this.playerBusted = false;
    this.enemyBusted = false;
    this.playerCards = [];
    this.enemyCards = [];
    this.round = 1;
    this.playerStood = false;
    this.enemyStood = false;

    if (this.mesh) this.hide();

    // Canvas for the meter texture
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 140;
    this.ctx = this.canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    // Flip U to correct back-face mirroring on floor plane
    this.texture.wrapS = THREE.RepeatWrapping;
    this.texture.repeat.x = -1;

    const geo = new THREE.PlaneGeometry(DUNGEON.CELL_SIZE * 0.45, DUNGEON.CELL_SIZE * 0.18);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    // Flat on the floor, face up
    this.mesh.rotation.x = Math.PI / 2;
    this.mesh.position.set(
      x * DUNGEON.CELL_SIZE,
      0.08,
      z * DUNGEON.CELL_SIZE
    );

    this.scene.add(this.mesh);
    this._redraw();
  }

  /**
   * Position the meters between player and the enemy ahead
   */
  positionBetween(playerX, playerZ, facingIndex) {
    if (!this.mesh) return;
    const dirs = [
      { x: 0, z: -1 }, // N
      { x: 1, z: 0 },  // E
      { x: 0, z: 1 },  // S
      { x: -1, z: 0 }, // W
    ];
    const dir = dirs[facingIndex];
    // Player is ON the enemy cell, so go slightly back but not too far
    const ahead = -0.15;
    this.mesh.position.set(
      (playerX + dir.x * ahead) * DUNGEON.CELL_SIZE,
      0.08,
      (playerZ + dir.z * ahead) * DUNGEON.CELL_SIZE
    );
    // Rotate on the floor plane so gauge reads correctly from player's viewpoint
    // rotation.z spins around local Z (= world Y after rotation.x = PI/2)
    // N(0): camera looks -Z, top edge already at -Z → z = 0
    // E(1): camera looks +X, need top at +X → z = -PI/2
    // S(2): camera looks +Z, need top at +Z → z = PI
    // W(3): camera looks -X, need top at -X → z = PI/2
    this.mesh.rotation.z = [Math.PI, -Math.PI / 2, 0, Math.PI / 2][facingIndex];
  }

  updateMeter(target, meter, busted) {
    if (target === 'player') {
      this.playerMeter = meter;
      this.playerBusted = busted;
    } else {
      this.enemyMeter = meter;
      this.enemyBusted = busted;
    }
    this._redraw();
  }

  addCard(target, value) {
    if (target === 'player') this.playerCards.push(value);
    else this.enemyCards.push(value);
    this._redraw();
  }

  setStood(target) {
    if (target === 'player') this.playerStood = true;
    else this.enemyStood = true;
    this._redraw();
  }

  newRound(round) {
    this.round = round;
    this.playerMeter = 0;
    this.enemyMeter = 0;
    this.playerBusted = false;
    this.enemyBusted = false;
    this.playerCards = [];
    this.enemyCards = [];
    this.playerStood = false;
    this.enemyStood = false;
    this._redraw();
  }

  _redraw() {
    if (!this.ctx) return;
    const c = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;

    c.clearRect(0, 0, W, H);

    // 9-slice black panel background
    if (this._panelImg) {
      this._draw9Slice(c, this._panelImg, 0, 0, W, H, 14);
    } else {
      c.fillStyle = 'rgba(0, 0, 0, 0.45)';
      this._roundRect(c, 4, 4, W - 8, H - 8, 12);
      c.fill();
    }

    const padX = 38;
    const padY = 18;
    const meterH = 44;
    const gap = 10;
    const trackW = W - padX * 2 - 36;

    // Enemy meter first (top = further from camera = enemy)
    const meterY1 = padY;
    // Player meter second (bottom = closer to camera = player)
    const meterY2 = padY + meterH + gap;

    // Draw enemy meter (top)
    this._drawMeter(c, padX + 36, meterY1, trackW, meterH,
      this.enemyMax, this.enemyMeter, this.enemyBusted, this.enemyStood,
      'enemy', this.enemyCards);

    // Draw player meter (bottom)
    this._drawMeter(c, padX + 36, meterY2, trackW, meterH,
      this.playerMax, this.playerMeter, this.playerBusted, this.playerStood,
      'player', this.playerCards);

    // Value labels
    c.font = 'bold 26px monospace';
    c.textAlign = 'center';
    // Enemy value (top) — red
    c.fillStyle = this.enemyBusted ? '#f44' : '#f88';
    const eText = this.enemyStood ? `${this.enemyMeter}✓` : `${this.enemyMeter}`;
    c.fillText(eText, 28, meterY1 + meterH / 2 + 9);
    // Player value (bottom) — blue
    c.fillStyle = this.playerBusted ? '#f44' : '#8bf';
    const pText = this.playerStood ? `${this.playerMeter}✓` : `${this.playerMeter}`;
    c.fillText(pText, 28, meterY2 + meterH / 2 + 9);

    // Drawn cards chips (debug: uncomment to see card values below gauge)
    // this._drawChips(c, padX + 36, meterY1 + meterH + 1, this.enemyCards, 'enemy');
    // this._drawChips(c, padX + 36, meterY2 + meterH + 1, this.playerCards, 'player');

    this.texture.needsUpdate = true;
  }

  _drawMeter(c, x, y, w, h, maxSteps, meter, busted, stood, side, cards) {
    const maxPossible = Math.max(this.playerMax, this.enemyMax, 12);
    const gap = 6;
    const stepW = (w - gap * (maxPossible - 1)) / maxPossible;
    const isPlayer = side === 'player';
    const otherMeter = isPlayer ? this.enemyMeter : this.playerMeter;
    const winning = meter > otherMeter;

    const halfMax = Math.floor(maxSteps / 2);

    for (let i = 0; i < maxSteps; i++) {
      const sx = x + i * (stepW + gap);
      const filled = i < meter;
      const aboveHalf = i >= halfMax;

      if (filled) {
        if (busted) {
          c.fillStyle = '#d52222';
        } else if (aboveHalf) {
          c.fillStyle = '#d5a82a'; // bright yellow
        } else {
          c.fillStyle = '#7a5a18'; // dimmed dark yellow
        }
      } else {
        c.fillStyle = isPlayer ? '#2a4a6a' : '#6a2a2a';
        c.globalAlpha = 0.3;
      }

      this._roundRect(c, sx, y, stepW, h, 4);
      c.fill();
      c.globalAlpha = 1;

      // Subtle border
      c.strokeStyle = filled
        ? (busted ? '#ff4444' : (aboveHalf ? '#e8c040' : '#a08028'))
        : (isPlayer ? 'rgba(74,138,213,0.25)' : 'rgba(213,74,74,0.25)');
      c.lineWidth = 1;
      this._roundRect(c, sx, y, stepW, h, 4);
      c.stroke();
    }
  }

  _drawChips(c, x, y, cards, side) {
    if (cards.length === 0) return;
    const chipW = 22;
    const gap = 3;
    const totalW = cards.length * (chipW + gap) - gap;
    const startX = x + (this.canvas.width - 100 - x * 2) / 2 + x - totalW / 2;

    cards.forEach((val, i) => {
      const cx = startX + i * (chipW + gap);
      c.fillStyle = side === 'player' ? '#1a2a3a' : '#3a1a1a';
      this._roundRect(c, cx, y, chipW, 18, 3);
      c.fill();
      c.strokeStyle = side === 'player' ? '#2a6ab5' : '#b52a2a';
      c.lineWidth = 1;
      this._roundRect(c, cx, y, chipW, 18, 3);
      c.stroke();
      c.fillStyle = '#fff';
      c.font = '12px monospace';
      c.textAlign = 'center';
      c.fillText(val, cx + chipW / 2, y + 13);
    });
  }

  /**
   * Draw a 9-slice image onto the canvas context.
   * @param {CanvasRenderingContext2D} c - Canvas context
   * @param {HTMLImageElement} img - Source 9-slice image
   * @param {number} dx - Destination X
   * @param {number} dy - Destination Y
   * @param {number} dw - Destination width
   * @param {number} dh - Destination height
   * @param {number} slice - Border slice size in source pixels
   */
  _draw9Slice(c, img, dx, dy, dw, dh, slice) {
    const sw = img.width;
    const sh = img.height;
    const s = slice;

    c.imageSmoothingEnabled = false;

    // Corners
    c.drawImage(img, 0, 0, s, s, dx, dy, s, s);                           // top-left
    c.drawImage(img, sw - s, 0, s, s, dx + dw - s, dy, s, s);             // top-right
    c.drawImage(img, 0, sh - s, s, s, dx, dy + dh - s, s, s);             // bottom-left
    c.drawImage(img, sw - s, sh - s, s, s, dx + dw - s, dy + dh - s, s, s); // bottom-right

    // Edges
    c.drawImage(img, s, 0, sw - 2 * s, s, dx + s, dy, dw - 2 * s, s);                   // top
    c.drawImage(img, s, sh - s, sw - 2 * s, s, dx + s, dy + dh - s, dw - 2 * s, s);     // bottom
    c.drawImage(img, 0, s, s, sh - 2 * s, dx, dy + s, s, dh - 2 * s);                   // left
    c.drawImage(img, sw - s, s, s, sh - 2 * s, dx + dw - s, dy + s, s, dh - 2 * s);     // right

    // Center fill
    c.drawImage(img, s, s, sw - 2 * s, sh - 2 * s, dx + s, dy + s, dw - 2 * s, dh - 2 * s);
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  hide() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      if (this.texture) this.texture.dispose();
      this.mesh = null;
      this.texture = null;
      this.canvas = null;
      this.ctx = null;
    }
  }
}
