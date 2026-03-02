// ── Potion Effect System ──────────────────────────────────────────────
// 10 distinct effects (5 positive/negative pairs), randomized color mapping per run,
// timed buffs, identification tracking, and modifier getters.

import * as THREE from 'three';
import { SeededRandom } from '../../utils/SeededRandom';

// ── Effect types ──

export type PotionEffect =
  | 'heal' | 'poison'
  | 'speed' | 'slow'
  | 'armor' | 'fragile'
  | 'shadow' | 'frenzy'
  | 'clarity' | 'confusion';

export interface EffectMeta {
  label: string;
  positive: boolean;
  /** Duration in seconds (0 = instant, like heal) */
  duration: number;
  /** The opposite effect that cancels this one */
  opposite: PotionEffect;
}

export const EFFECT_META: Record<PotionEffect, EffectMeta> = {
  heal:    { label: 'Heal',    positive: true,  duration: 0,  opposite: 'poison'  },
  poison:  { label: 'Poison',  positive: false, duration: 12, opposite: 'heal'    },
  speed:   { label: 'Speed',   positive: true,  duration: 45, opposite: 'slow'    },
  slow:    { label: 'Slow',    positive: false, duration: 12, opposite: 'speed'   },
  armor:   { label: 'Armor',   positive: true,  duration: 60, opposite: 'fragile' },
  fragile: { label: 'Fragile', positive: false, duration: 40, opposite: 'armor'   },
  shadow:    { label: 'Shadow',    positive: true,  duration: 45, opposite: 'frenzy'    },
  frenzy:    { label: 'Frenzy',    positive: false, duration: 25, opposite: 'shadow'    },
  clarity:   { label: 'Clarity',   positive: true,  duration: 30, opposite: 'confusion' },
  confusion: { label: 'Confusion', positive: false, duration: 20, opposite: 'clarity'   },
};

// ── 10 distinct hue values for tinting ──

/** HSL hue values (0-1) for the 10 potion colors. */
export const POTION_HUES: number[] = [
  0.0,    // red
  0.08,   // orange
  0.33,   // green
  0.50,   // cyan
  0.60,   // blue
  0.75,   // purple
  0.88,   // pink
  0.16,   // yellow
  0.42,   // teal
  0.92,   // magenta
];

/** Display colors (THREE.Color) for sparkles, labels, etc. */
export const POTION_COLORS: THREE.Color[] = POTION_HUES.map(h => {
  const c = new THREE.Color();
  c.setHSL(h, 0.8, 0.55);
  return c;
});

// ── Active effect tracking ──

interface ActiveEffect {
  remaining: number;   // seconds left
  duration: number;    // total duration (for display)
}

export interface DrinkResult {
  effect: PotionEffect;
  label: string;
  positive: boolean;
  firstTime: boolean;  // true if this color was just identified
}

export interface TickEvent {
  effect: PotionEffect;
  type: 'tick' | 'expired';
}

// ── Armor tracking ──

const ARMOR_HITS = 3; // number of hits absorbed

// ── System ──

export class PotionEffectSystem {
  /** Maps colorIndex (0-9) → PotionEffect. Shuffled per run. */
  readonly colorMapping: PotionEffect[];

  /** Currently active timed effects */
  private activeEffects = new Map<PotionEffect, ActiveEffect>();

  /** Set of colorIndices that have been identified (drunk at least once) */
  private identified = new Set<number>();

  /** Armor hits remaining (when armor effect is active) */
  private armorHits = 0;

  /** Poison tick timer */
  private poisonTickTimer = 0;
  private static readonly POISON_TICK_INTERVAL = 2.0; // seconds between poison ticks

  /** Callbacks for label updates — registered by Loot/DungeonProps */
  private labelUpdateCallbacks: Array<(colorIndex: number, label: string, positive: boolean) => void> = [];

  constructor(baseSeed: number) {
    // Build shuffled mapping: 8 effects → 8 color indices
    const effects: PotionEffect[] = [
      'heal', 'poison', 'speed', 'slow', 'armor', 'fragile', 'shadow', 'frenzy', 'clarity', 'confusion',
    ];
    const rng = new SeededRandom(baseSeed ^ 0x504F5449); // 'POTI' xor for unique seed stream
    rng.shuffle(effects);
    this.colorMapping = effects;
  }

  /** Register a callback to be notified when a color is identified */
  onLabelUpdate(cb: (colorIndex: number, label: string, positive: boolean) => void): void {
    this.labelUpdateCallbacks.push(cb);
  }

  /** Remove a label update callback */
  offLabelUpdate(cb: (colorIndex: number, label: string, positive: boolean) => void): void {
    const idx = this.labelUpdateCallbacks.indexOf(cb);
    if (idx >= 0) this.labelUpdateCallbacks.splice(idx, 1);
  }

  /** Check if a given color index has been identified */
  isIdentified(colorIndex: number): boolean {
    return this.identified.has(colorIndex);
  }

  /** Get the effect label for a color index (or "?" if unidentified) */
  getLabel(colorIndex: number): string {
    if (!this.identified.has(colorIndex)) return '?';
    const effect = this.colorMapping[colorIndex];
    return EFFECT_META[effect].label;
  }

  /** Get whether the effect for a color is positive (for label coloring) */
  isPositive(colorIndex: number): boolean {
    const effect = this.colorMapping[colorIndex];
    return EFFECT_META[effect].positive;
  }

  /** Get whether the effect for a color is negative */
  isNegative(colorIndex: number): boolean {
    return !this.isPositive(colorIndex);
  }

  /** Check if a color is identified AND its effect is negative */
  isIdentifiedBad(colorIndex: number): boolean {
    return this.identified.has(colorIndex) && this.isNegative(colorIndex);
  }

  /** Drink a potion of the given color index */
  drink(colorIndex: number): DrinkResult {
    const effect = this.colorMapping[colorIndex];
    const meta = EFFECT_META[effect];
    const firstTime = !this.identified.has(colorIndex);

    // Identify this color
    this.identified.add(colorIndex);

    // Cancel opposite effect
    const opposite = meta.opposite;
    if (this.activeEffects.has(opposite)) {
      this.activeEffects.delete(opposite);
      // If cancelling armor, reset hits
      if (opposite === 'armor') this.armorHits = 0;
    }

    // Apply effect
    if (meta.duration > 0) {
      this.activeEffects.set(effect, { remaining: meta.duration, duration: meta.duration });
      // Special init for armor
      if (effect === 'armor') this.armorHits = ARMOR_HITS;
      // Reset poison tick timer when poison starts
      if (effect === 'poison') this.poisonTickTimer = PotionEffectSystem.POISON_TICK_INTERVAL;
    }

    // Notify label callbacks
    if (firstTime) {
      for (const cb of this.labelUpdateCallbacks) {
        cb(colorIndex, meta.label, meta.positive);
      }
    }

    return { effect, label: meta.label, positive: meta.positive, firstTime };
  }

  /** Tick all active effects. Returns events (ticks, expirations). */
  update(dt: number): TickEvent[] {
    const events: TickEvent[] = [];

    for (const [effect, state] of this.activeEffects) {
      state.remaining -= dt;

      // Poison DoT tick
      if (effect === 'poison') {
        this.poisonTickTimer -= dt;
        if (this.poisonTickTimer <= 0) {
          this.poisonTickTimer += PotionEffectSystem.POISON_TICK_INTERVAL;
          events.push({ effect: 'poison', type: 'tick' });
        }
      }

      if (state.remaining <= 0) {
        this.activeEffects.delete(effect);
        if (effect === 'armor') this.armorHits = 0;
        events.push({ effect, type: 'expired' });
      }
    }

    return events;
  }

  // ── Modifier getters ──

  /** Speed multiplier: 1.5 for speed, 0.5 for slow, 1 otherwise */
  get speedMultiplier(): number {
    if (this.activeEffects.has('speed')) return 1.5;
    if (this.activeEffects.has('slow')) return 0.5;
    return 1;
  }

  /** Damage taken multiplier: 2 for fragile, 1 otherwise */
  get damageTakenMultiplier(): number {
    if (this.activeEffects.has('fragile')) return 2;
    return 1;
  }

  /** Whether armor is active (has remaining hits) */
  get hasArmor(): boolean {
    return this.activeEffects.has('armor') && this.armorHits > 0;
  }

  /** Number of armor hits remaining */
  get armorHitsRemaining(): number {
    return this.armorHits;
  }

  /** Try to absorb a hit. Returns true if absorbed. */
  absorbHit(): boolean {
    if (!this.hasArmor) return false;
    this.armorHits--;
    if (this.armorHits <= 0) {
      this.activeEffects.delete('armor');
    }
    return true;
  }

  /** Whether shadow is active (enemies unaware) */
  get isShadow(): boolean {
    return this.activeEffects.has('shadow');
  }

  /** Break shadow effect (e.g. on hit without kill, touch enemy, destruct near enemy) */
  breakShadow(): void {
    this.activeEffects.delete('shadow');
  }

  /** Whether frenzy is active (enemies aggro in radius) */
  get isFrenzy(): boolean {
    return this.activeEffects.has('frenzy');
  }

  /** Whether clarity is active (crit bonus) */
  get isClarity(): boolean {
    return this.activeEffects.has('clarity');
  }

  /** Whether confusion is active (movement scramble) */
  get isConfusion(): boolean {
    return this.activeEffects.has('confusion');
  }

  /** Crit chance bonus from clarity (0.15 when active, 0 otherwise) */
  get critBonus(): number {
    return this.activeEffects.has('clarity') ? 0.15 : 0;
  }

  /** Check if any timed effect is active */
  hasActiveEffect(effect: PotionEffect): boolean {
    return this.activeEffects.has(effect);
  }

  /** Get remaining duration of an effect (0 if not active) */
  getRemaining(effect: PotionEffect): number {
    return this.activeEffects.get(effect)?.remaining ?? 0;
  }

  /** Get all active effects and their remaining times (for HUD display) */
  getActiveEffects(): Array<{ effect: PotionEffect; remaining: number; duration: number; positive: boolean }> {
    const result: Array<{ effect: PotionEffect; remaining: number; duration: number; positive: boolean }> = [];
    for (const [effect, state] of this.activeEffects) {
      result.push({
        effect,
        remaining: state.remaining,
        duration: state.duration,
        positive: EFFECT_META[effect].positive,
      });
    }
    return result;
  }

  /** Clear a single effect early (e.g. poison stops at 1 HP) */
  clearEffect(effect: PotionEffect): void {
    this.activeEffects.delete(effect);
    if (effect === 'armor') this.armorHits = 0;
  }

  /** Reset all effects (e.g. on death). Keeps identification. */
  clearEffects(): void {
    this.activeEffects.clear();
    this.armorHits = 0;
    this.poisonTickTimer = 0;
  }

  /** Full reset (new run) — clears identification too */
  reset(baseSeed: number): void {
    this.clearEffects();
    this.identified.clear();
    // Re-shuffle mapping
    const effects: PotionEffect[] = [
      'heal', 'poison', 'speed', 'slow', 'armor', 'fragile', 'shadow', 'frenzy', 'clarity', 'confusion',
    ];
    const rng = new SeededRandom(baseSeed ^ 0x504F5449);
    rng.shuffle(effects);
    (this.colorMapping as PotionEffect[]).length = 0;
    for (const e of effects) (this.colorMapping as PotionEffect[]).push(e);
  }

  dispose(): void {
    this.activeEffects.clear();
    this.identified.clear();
    this.labelUpdateCallbacks.length = 0;
  }
}
