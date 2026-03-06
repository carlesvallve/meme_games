/**
 * TextLabel — shared utility for creating 3D floating text sprites.
 *
 * Used for POI names (towns, dungeons), room labels, item names, etc.
 * Canvas-rendered text on a billboard sprite with configurable size/color.
 */

import * as THREE from 'three';

export interface TextLabelOpts {
  /** Text color (CSS). Default '#fff' */
  color?: string;
  /** Outline color (CSS). Default 'rgba(0,0,0,0.85)' */
  outlineColor?: string;
  /** Outline width in canvas px. Default 5 */
  outlineWidth?: number;
  /** Canvas font size in px (higher = sharper). Default 42 */
  fontSize?: number;
  /** World-space height of the sprite. Default 0.5 */
  height?: number;
  /** Whether to depth-test against scene geometry. Default true */
  depthTest?: boolean;
  /** Initial opacity (0-1). Default 1 */
  opacity?: number;
  /** Render order. Default 900 */
  renderOrder?: number;
  /** Max chars per line before wrapping. Default 28 */
  maxLineChars?: number;
  /** World-space offset toward camera. When set, the label's onBeforeRender
   *  automatically pushes it toward the camera by this distance from its
   *  base position. Useful for POI labels on 3D structures. Default undefined (no offset). */
  cameraOffset?: number;
}

/** Split text into lines, wrapping at word boundaries when exceeding maxChars. */
function wrapText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Create a billboard text sprite. Position it yourself after creation. */
export function createTextLabel(text: string, opts: TextLabelOpts = {}): THREE.Sprite {
  const {
    color = '#fff',
    outlineColor = 'rgba(0,0,0,0.85)',
    outlineWidth = 5,
    fontSize = 42,
    height = 0.5,
    depthTest = true,
    opacity = 1,
    renderOrder = 900,
    maxLineChars = 28,
  } = opts;

  const lines = wrapText(text, maxLineChars);
  const lineHeight = fontSize * 1.25;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `bold ${fontSize}px monospace`;
  ctx.font = font;

  // Measure widest line
  let maxWidth = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w > maxWidth) maxWidth = w;
  }

  const pad = Math.ceil(fontSize * 0.4);
  canvas.width = Math.ceil(maxWidth) + pad * 2;
  canvas.height = Math.ceil(lineHeight * lines.length) + pad * 2;

  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const cx = canvas.width / 2;
  const startY = pad + lineHeight / 2;

  for (let i = 0; i < lines.length; i++) {
    const ly = startY + i * lineHeight;
    // Outline
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = outlineWidth;
    ctx.strokeText(lines[i], cx, ly);
    // Fill
    ctx.fillStyle = color;
    ctx.fillText(lines[i], cx, ly);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest,
    depthWrite: false,
    fog: false,
    opacity,
  });
  const sprite = new THREE.Sprite(mat);
  const scaledH = height * lines.length;
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(scaledH * aspect, scaledH, 1);
  sprite.renderOrder = renderOrder;

  // Auto-offset toward camera if requested
  const cameraOffset = opts.cameraOffset;
  if (cameraOffset != null && cameraOffset > 0) {
    const basePos = new THREE.Vector3();
    let baseSet = false;
    sprite.onBeforeRender = (_r, _s, camera) => {
      // Capture base position on first render (after caller sets position)
      if (!baseSet) { basePos.copy(sprite.position); baseSet = true; }
      const dx = camera.position.x - basePos.x;
      const dz = camera.position.z - basePos.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > 0.01) {
        sprite.position.x = basePos.x + (dx / len) * cameraOffset;
        sprite.position.z = basePos.z + (dz / len) * cameraOffset;
      }
    };
  }

  // Stash opts for updateTextLabel
  (sprite as any).__textLabelOpts = { color, outlineColor, outlineWidth, fontSize, height, depthTest, opacity, renderOrder, maxLineChars };
  return sprite;
}

/** Re-render a text label sprite with new text, reusing the same material/texture. */
export function updateTextLabel(sprite: THREE.Sprite, text: string): void {
  const opts = (sprite as any).__textLabelOpts as TextLabelOpts | undefined;
  if (!opts) return;
  const {
    color = '#fff',
    outlineColor = 'rgba(0,0,0,0.85)',
    outlineWidth = 5,
    fontSize = 42,
    height = 0.5,
    maxLineChars = 28,
  } = opts;

  const lines = wrapText(text, maxLineChars);
  const lineHeight = fontSize * 1.25;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = `bold ${fontSize}px monospace`;
  ctx.font = font;

  let maxWidth = 0;
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    if (w > maxWidth) maxWidth = w;
  }

  const pad = Math.ceil(fontSize * 0.4);
  canvas.width = Math.ceil(maxWidth) + pad * 2;
  canvas.height = Math.ceil(lineHeight * lines.length) + pad * 2;

  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cx = canvas.width / 2;
  const startY = pad + lineHeight / 2;

  for (let i = 0; i < lines.length; i++) {
    const ly = startY + i * lineHeight;
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = outlineWidth;
    ctx.strokeText(lines[i], cx, ly);
    ctx.fillStyle = color;
    ctx.fillText(lines[i], cx, ly);
  }

  const mat = sprite.material as THREE.SpriteMaterial;
  if (mat.map) mat.map.dispose();
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  mat.map = texture;
  mat.needsUpdate = true;
  // Scale height by line count so each character stays the same size
  const scaledH = height * lines.length;
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(scaledH * aspect, scaledH, 1);
}
