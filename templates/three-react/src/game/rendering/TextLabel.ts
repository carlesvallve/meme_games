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
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(height * aspect, height, 1);
  sprite.renderOrder = renderOrder;
  return sprite;
}
