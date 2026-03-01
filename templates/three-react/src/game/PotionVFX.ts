// ── Potion Visual Effects ──────────────────────────────────────────────
// Floating numbers, persistent status icons arranged in a row, and
// shadow opacity. Sprites are added to the scene (not parented to
// character) and positioned each frame relative to the character mesh.

import * as THREE from 'three';
import type { PotionEffect } from './PotionEffectSystem';
import { EFFECT_META } from './PotionEffectSystem';
import type { Character } from './character/Character';

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

/** Create a sprite with emoji + optional small number overlay (e.g. 🛡️ with "3") */
function createEmojiWithNumber(
  emoji: string,
  num: number | null,
  emojiFontSize = 24,
  size = 48,
): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // Emoji
  ctx.font = `${emojiFontSize}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2);
  // Number badge
  if (num !== null) {
    ctx.font = `bold ${Math.round(emojiFontSize * 0.5)}px monospace`;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2.5;
    ctx.strokeText(`${num}`, size * 0.72, size * 0.75);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${num}`, size * 0.72, size * 0.75);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.25, 0.25, 1);
  sprite.renderOrder = 1001;
  sprite.raycast = () => {};
  return sprite;
}

function createEmojiSprite(emoji: string, fontSize = 28, size = 48): THREE.Sprite {
  return createEmojiWithNumber(emoji, null, fontSize, size);
}

// ── Persistent status icon ──

interface StatusIcon {
  effect: PotionEffect;
  sprite: THREE.Sprite;
  age: number;
}

// Icon spacing for horizontal row layout
const ICON_SIZE = 0.22;
const ICON_GAP = 0.04;
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
    // Skull icon
    const skull = createEmojiSprite('☠️', 20, 32);
    const y = pos.y + 0.55;
    skull.position.set(pos.x - 0.08, y, pos.z);
    skull.scale.set(0.18, 0.18, 1);
    this.scene.add(skull);
    this.floatingNumbers.push({ sprite: skull, startY: y, age: 0, lifetime: 1.4, baseScaleX: 0.18, baseScaleY: 0.18 });

    // -1 number
    const num = createCanvasSprite('-1', '#dd4444');
    num.position.set(pos.x + 0.08, y, pos.z);
    this.scene.add(num);
    this.floatingNumbers.push({ sprite: num, startY: y, age: 0, lifetime: 1.4, baseScaleX: 0.4, baseScaleY: 0.2 });
  }

  // ── Status icons ──

  private createIconForEffect(effect: PotionEffect, armorHits?: number): THREE.Sprite | null {
    switch (effect) {
      case 'armor':   return createEmojiWithNumber('🛡️', armorHits ?? 3, 22, 40);
      case 'shadow':  return createEmojiSprite('👻', 22, 40);
      case 'frenzy':  return createEmojiSprite('❗', 22, 40);
      case 'speed':   return createEmojiSprite('⚡', 22, 40);
      case 'slow':    return createEmojiSprite('🐌', 22, 40);
      case 'fragile': {
        const s = createCanvasSprite('x2', '#dd4444', 18, 40, 24);
        s.scale.set(0.22, 0.11, 1);
        return s;
      }
      default: return null;
    }
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

    const sprite = createEmojiWithNumber('🛡️', hitsRemaining, 22, 40);
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

  update(dt: number, char: Character, shadowActive = false): void {
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
    const hpBarBump = char.showingHpBar ? 0.12 : 0;

    // Status icons — arrange in centered horizontal row above character
    const count = this.statusIcons.length;
    const totalWidth = count > 0 ? count * ICON_SIZE + (count - 1) * ICON_GAP : 0;
    const startX = -totalWidth / 2 + ICON_SIZE / 2;

    for (let i = 0; i < this.statusIcons.length; i++) {
      const icon = this.statusIcons[i];
      icon.age += dt;

      const ox = startX + i * (ICON_SIZE + ICON_GAP);
      let oy = ICON_BASE_Y + hpBarBump;

      // Frenzy: pulsing scale
      if (icon.effect === 'frenzy') {
        const pulse = 1 + Math.sin(icon.age * 6) * 0.15;
        icon.sprite.scale.set(0.25 * pulse, 0.25 * pulse, 1);
      }

      // Gentle bob
      oy += Math.sin(icon.age * 2) * 0.02;
      icon.sprite.position.set(pos.x + ox, pos.y + oy, pos.z);
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
