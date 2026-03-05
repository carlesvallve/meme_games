// ── Potion Visual Effects ──────────────────────────────────────────────
// Floating numbers, persistent status icons arranged in a row, and
// shadow opacity. Sprites are added to the scene (not parented to
// character) and positioned each frame relative to the character mesh.

import * as THREE from 'three';
import type { PotionEffect } from './PotionEffectSystem';
import { EFFECT_META } from './PotionEffectSystem';

import type { Character } from '../character/Character';

// ── Floating number (heal +N / poison -1 / damage) ──

interface FloatingNumber {
  sprite: THREE.Sprite;
  startY: number;
  age: number;
  lifetime: number;
  baseScaleX: number;
  baseScaleY: number;
}

function createCanvasSprite(
  text: string,
  color: string,
  fontSize = 24,
  width = 64,
  height = 32,
): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.strokeText(text, width / 2, height / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.4, 0.2, 1);
  sprite.renderOrder = 1002;
  sprite.raycast = () => {};
  return sprite;
}

/** SVG path data for clean flat status icons (16×16 viewBox) */
const STATUS_SVG: Record<string, { path: string; color: string }> = {
  heal:    { path: 'M8 2C6.3 2 4 3.6 4 6.4c0 3.2 4 7.6 4 7.6s4-4.4 4-7.6C12 3.6 9.7 2 8 2z', color: '#ff4466' },
  poison:  { path: 'M8 1a2 2 0 0 0-2 2v2.5L4 8v1h1v4a3 3 0 0 0 6 0V9h1V8l-2-2.5V3a2 2 0 0 0-2-2zM7 10a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm2.5 2a1 1 0 1 1 0-2 1 1 0 0 1 0 2z', color: '#88dd44' },
  speed:   { path: 'M13 3L7 8h4l-5 6 2-4.5H5L9 3h4z', color: '#ffcc22' },
  slow:    { path: 'M8 1C4.1 1 1 4.1 1 8s3.1 7 7 7 7-3.1 7-7-3.1-7-7-7zm0 12.5c-3 0-5.5-2.5-5.5-5.5S5 2.5 8 2.5 13.5 5 13.5 8 11 13.5 8 13.5zM8.5 4H7v5l4 2.4.8-1.2-3.3-2V4z', color: '#8888cc' },
  armor:   { path: 'M8 1L2 4v4c0 4 2.7 6.6 6 8 3.3-1.4 6-4 6-8V4L8 1z', color: '#55aaff' },
  fragile: { path: 'M8 14s-6-4.4-6-8.4C2 3.3 4.3 1 7 1c1 0 1.8.5 1 1.2C7.2.5 8 0 9 1c2.7 0 5 2.3 5 4.6 0 4-6 8.4-6 8.4zM6 6l4 4M10 6l-4 4', color: '#dd6644' },
  shadow:  { path: 'M8 2C5.2 2 3 4.2 3 7c0 1.6.8 3 2 4v2a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-2c1.2-1 2-2.4 2-4 0-2.8-2.2-5-5-5zm0 2a3 3 0 0 1 3 3c0 1-.5 1.8-1.3 2.4l-.7.5V12H7v-2.1l-.7-.5C5.5 8.8 5 8 5 7a3 3 0 0 1 3-3z', color: '#aa88ff' },
  frenzy:    { path: 'M8 1c-.6 2-2.5 3.5-2.5 6C5.5 9.5 6.6 11 8 11s2.5-1.5 2.5-4C10.5 4.5 8.6 3 8 1zM8 13c-1 0-1.8-.5-2.2-1.2C4 12.5 3 13.8 3 15h10c0-1.2-1-2.5-2.8-3.2-.4.7-1.2 1.2-2.2 1.2z', color: '#ff6622' },
  clarity:   { path: 'M8 3C5.8 3 4 4.8 4 7s1.8 4 4 4 4-1.8 4-4-1.8-4-4-4zm0 6.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5zM8 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM3 2l1.5 1.5M13 2l-1.5 1.5M3 12l1.5-1.5M13 12l-1.5-1.5', color: '#44ddff' },
  confusion: { path: 'M8 2C6 2 5 3.5 5.5 5c.3.8 1 1.2 1 2s-.5 1.5-1 2.5C5 10.5 5.5 12 7 13c1 .7 2.5.5 3-.5.3-.6 0-1.2-.5-1.5s-1-.5-1-1.2c0-.5.5-1 1-1.5s1.5-1 2-2c.7-1.3.3-3-1-4C10 1.5 9 2 8 2zm0 12a1 1 0 1 0 0 2 1 1 0 0 0 0-2z', color: '#dd44ff' },
};

/** Render an SVG path to a canvas-based Three.js sprite with optional number badge */
export function createSvgIconSprite(
  effect: string,
  num: number | null = null,
  size = 64,
): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const svg = STATUS_SVG[effect];
  if (!svg) {
    // Fallback: draw first letter
    ctx.font = `bold ${size * 0.5}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(effect[0].toUpperCase(), size / 2, size / 2);
  } else {
    // Draw circular background
    const cx = size / 2;
    const cy = size / 2;
    const r = size * 0.42;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fill();
    ctx.strokeStyle = svg.color;
    ctx.lineWidth = size * 0.04;
    ctx.stroke();

    // Draw SVG path scaled to fit inside the circle
    const iconScale = size / 16 * 0.55;
    const offsetX = (size - 16 * iconScale) / 2;
    const offsetY = (size - 16 * iconScale) / 2;
    // Scale the path to fit inside the circle
    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(iconScale, iconScale);
    const p = new Path2D(svg.path);
    ctx.fillStyle = svg.color;
    ctx.fill(p);
    ctx.restore();
  }

  // Number badge (for armor hits)
  if (num !== null) {
    const badgeR = size * 0.20;
    const bx = size * 0.76;
    const by = size * 0.76;
    ctx.beginPath();
    ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fill();
    ctx.font = `bold ${Math.round(size * 0.28)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(`${num}`, bx, by);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.20, 0.20, 1);
  sprite.renderOrder = 1001;
  sprite.raycast = () => {};
  return sprite;
}

// ── Persistent status icon ──

interface StatusIcon {
  effect: PotionEffect;
  sprite: THREE.Sprite;
  age: number;
}

// Icon spacing for horizontal row layout
const ICON_SIZE = 0.18;
const ICON_GAP = 0.03;
const ICON_BASE_Y = 0.6;

// ── System ──

export class PotionVFX {
  private scene: THREE.Scene;
  private floatingNumbers: FloatingNumber[] = [];
  private statusIcons: StatusIcon[] = [];
  private armorHitsRemaining = 0; // track for badge update
  private targetOpacity = 1.0;
  private currentOpacity = 1.0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  // ── Floating numbers ──

  spawnHealNumber(char: Character, amount: number): void {
    const pos = char.mesh.position;
    const sprite = createCanvasSprite(`+${amount}`, '#44dd66');
    const y = pos.y + 0.5;
    sprite.position.set(pos.x, y, pos.z);
    this.scene.add(sprite);
    this.floatingNumbers.push({ sprite, startY: y, age: 0, lifetime: 1.6, baseScaleX: 0.4, baseScaleY: 0.2 });
  }

  spawnPoisonTick(char: Character): void {
    const pos = char.mesh.position;
    // Poison icon
    const icon = createSvgIconSprite('poison', null, 32);
    const y = pos.y + 0.55;
    icon.position.set(pos.x - 0.08, y, pos.z);
    icon.scale.set(0.18, 0.18, 1);
    this.scene.add(icon);
    this.floatingNumbers.push({ sprite: icon, startY: y, age: 0, lifetime: 1.4, baseScaleX: 0.18, baseScaleY: 0.18 });

    // -1 number
    const num = createCanvasSprite('-1', '#dd4444');
    num.position.set(pos.x + 0.08, y, pos.z);
    this.scene.add(num);
    this.floatingNumbers.push({ sprite: num, startY: y, age: 0, lifetime: 1.4, baseScaleX: 0.4, baseScaleY: 0.2 });
  }

  // ── Status icons ──

  private createIconForEffect(effect: PotionEffect, armorHits?: number): THREE.Sprite | null {
    if (!STATUS_SVG[effect]) return null;
    const num = effect === 'armor' ? (armorHits ?? 3) : null;
    return createSvgIconSprite(effect, num);
  }

  /** Called when a potion is drunk — spawn appropriate VFX */
  onDrink(effect: PotionEffect, char: Character, armorHits?: number): void {
    // Remove any existing icon for this effect (or its opposite)
    const opposite = EFFECT_META[effect].opposite;
    this.removeStatusIcon(effect);
    this.removeStatusIcon(opposite);

    if (effect === 'armor') this.armorHitsRemaining = armorHits ?? 3;

    const sprite = this.createIconForEffect(effect, armorHits);
    if (sprite) {
      sprite.position.copy(char.mesh.position);
      this.scene.add(sprite);
      this.statusIcons.push({ effect, sprite, age: 0 });
    }
  }

  /** Called when an effect expires or is cancelled */
  onExpire(effect: PotionEffect): void {
    this.removeStatusIcon(effect);
  }

  /** Called when armor absorbs a hit — update the badge number */
  onArmorAbsorb(hitsRemaining: number): void {
    this.armorHitsRemaining = hitsRemaining;
    // Rebuild the armor icon sprite with updated number
    const idx = this.statusIcons.findIndex(i => i.effect === 'armor');
    if (idx < 0) return;
    const old = this.statusIcons[idx];
    this.scene.remove(old.sprite);
    (old.sprite.material as THREE.SpriteMaterial).map?.dispose();
    (old.sprite.material as THREE.SpriteMaterial).dispose();

    if (hitsRemaining <= 0) {
      // Armor depleted — remove icon
      this.statusIcons.splice(idx, 1);
      return;
    }

    const sprite = createSvgIconSprite('armor', hitsRemaining);
    sprite.position.copy(old.sprite.position);
    this.scene.add(sprite);
    this.statusIcons[idx] = { effect: 'armor', sprite, age: old.age };
  }

  private removeStatusIcon(effect: PotionEffect): void {
    for (let i = this.statusIcons.length - 1; i >= 0; i--) {
      if (this.statusIcons[i].effect === effect) {
        const icon = this.statusIcons[i];
        this.scene.remove(icon.sprite);
        (icon.sprite.material as THREE.SpriteMaterial).map?.dispose();
        (icon.sprite.material as THREE.SpriteMaterial).dispose();
        this.statusIcons.splice(i, 1);
      }
    }
  }

  // ── Update ──

  /** Reusable camera-right vector for horizontal icon layout */
  private static _camRight = new THREE.Vector3();

  update(dt: number, char: Character, shadowActive = false, camera?: THREE.Camera): void {
    // Auto-detect shadow state
    this.targetOpacity = shadowActive ? 0.5 : 1.0;
    const pos = char.mesh.position;

    // Floating numbers — pop scale, then slow drift up + late fade
    for (let i = this.floatingNumbers.length - 1; i >= 0; i--) {
      const fn = this.floatingNumbers[i];
      fn.age += dt;
      if (fn.age >= fn.lifetime) {
        this.scene.remove(fn.sprite);
        (fn.sprite.material as THREE.SpriteMaterial).map?.dispose();
        (fn.sprite.material as THREE.SpriteMaterial).dispose();
        this.floatingNumbers.splice(i, 1);
        continue;
      }
      const t = fn.age / fn.lifetime;

      // Phase 1 (0-0.15): pop scale — grow to 1.6x then shrink back
      const popEnd = 0.15;
      let scale: number;
      if (t < popEnd) {
        const pt = t / popEnd;
        scale = 1 + 0.6 * Math.sin(pt * Math.PI);
      } else {
        scale = 1;
      }
      fn.sprite.scale.set(fn.baseScaleX * scale, fn.baseScaleY * scale, 1);

      // Drift: hold still during pop, then drift up slowly
      const driftT = Math.max(0, t - popEnd) / (1 - popEnd);
      fn.sprite.position.y = fn.startY + driftT * 0.35;

      // Fade: fully visible until 60%, then fade to 0
      const fadeStart = 0.6;
      (fn.sprite.material as THREE.SpriteMaterial).opacity =
        t < fadeStart ? 1 : 1 - ((t - fadeStart) / (1 - fadeStart));
    }

    // Extra Y offset when HP bar is visible (so icons sit above it)
    const hpBarBump = char.showingHpBar ? 0.22 : 0;

    // Status icons — arrange in centered horizontal row above character
    // Use camera-right vector so the row is always screen-horizontal
    const count = this.statusIcons.length;
    const totalWidth = count > 0 ? count * ICON_SIZE + (count - 1) * ICON_GAP : 0;
    const startOff = -totalWidth / 2 + ICON_SIZE / 2;

    const camRight = PotionVFX._camRight;
    if (camera) {
      camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    } else {
      camRight.set(1, 0, 0);
    }

    for (let i = 0; i < this.statusIcons.length; i++) {
      const icon = this.statusIcons[i];
      icon.age += dt;

      const off = startOff + i * (ICON_SIZE + ICON_GAP);
      const oy = ICON_BASE_Y + hpBarBump + Math.sin(icon.age * 2) * 0.02;

      // Frenzy: pulsing scale
      if (icon.effect === 'frenzy') {
        const pulse = 1 + Math.sin(icon.age * 6) * 0.15;
        icon.sprite.scale.set(0.20 * pulse, 0.20 * pulse, 1);
      }

      icon.sprite.position.set(
        pos.x + camRight.x * off,
        pos.y + oy,
        pos.z + camRight.z * off,
      );
    }

    // Shadow opacity lerp
    if (this.currentOpacity !== this.targetOpacity) {
      const speed = 12.0;
      if (this.currentOpacity < this.targetOpacity) {
        this.currentOpacity = Math.min(this.targetOpacity, this.currentOpacity + speed * dt);
      } else {
        this.currentOpacity = Math.max(this.targetOpacity, this.currentOpacity - speed * dt);
      }
      const mat = char.mesh.material as THREE.MeshStandardMaterial;
      if (this.currentOpacity < 0.99) {
        if (!mat.transparent) { mat.transparent = true; mat.needsUpdate = true; }
        mat.opacity = this.currentOpacity;
      } else {
        if (mat.transparent) { mat.transparent = false; mat.needsUpdate = true; }
        mat.opacity = 1;
      }
    }
  }

  /** Rebuild status icons from active effects (e.g. after floor transition with new scene) */
  restoreActiveEffects(
    activeEffects: Array<{ effect: PotionEffect }>,
    char: Character,
    armorHits: number,
  ): void {
    // Clear any stale icons (shouldn't be any after dispose, but safety)
    for (const icon of this.statusIcons) {
      this.scene.remove(icon.sprite);
      (icon.sprite.material as THREE.SpriteMaterial).map?.dispose();
      (icon.sprite.material as THREE.SpriteMaterial).dispose();
    }
    this.statusIcons.length = 0;
    this.armorHitsRemaining = armorHits;

    let hasShadow = false;
    for (const { effect } of activeEffects) {
      if (effect === 'shadow') hasShadow = true;
      const hits = effect === 'armor' ? armorHits : undefined;
      const sprite = this.createIconForEffect(effect, hits);
      if (sprite) {
        sprite.position.copy(char.mesh.position);
        this.scene.add(sprite);
        this.statusIcons.push({ effect, sprite, age: 0 });
      }
    }

    // Restore shadow opacity immediately (skip lerp)
    if (hasShadow) {
      this.targetOpacity = 0.5;
      this.currentOpacity = 0.5;
      const mat = char.mesh.material as THREE.MeshStandardMaterial;
      mat.transparent = true;
      mat.opacity = 0.5;
    }
  }

  /** Clear all effects (on death or new run) */
  clearAll(): void {
    for (const fn of this.floatingNumbers) {
      this.scene.remove(fn.sprite);
      (fn.sprite.material as THREE.SpriteMaterial).map?.dispose();
      (fn.sprite.material as THREE.SpriteMaterial).dispose();
    }
    this.floatingNumbers.length = 0;

    for (const icon of this.statusIcons) {
      this.scene.remove(icon.sprite);
      (icon.sprite.material as THREE.SpriteMaterial).map?.dispose();
      (icon.sprite.material as THREE.SpriteMaterial).dispose();
    }
    this.statusIcons.length = 0;

    this.armorHitsRemaining = 0;
    this.targetOpacity = 1.0;
    this.currentOpacity = 1.0;
  }

  dispose(): void {
    this.clearAll();
  }
}
