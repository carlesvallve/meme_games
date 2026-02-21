/**
 * Status Effects Database — tracks buffs/debuffs on player and enemy.
 * Each effect has: id, name, icon, color, duration (rounds), stackable,
 * and per-round / on-hit / stat-modifier behaviors.
 */

export const STATUS = {
  // --- Damage over time ---
  poison: {
    id: 'poison',
    name: 'Poison',
    icon: '\u2620\uFE0F',
    color: '#6a2',
    type: 'dot',
    damagePerRound: 4,
    duration: 3,
    stackable: false,
    desc: 'Takes damage each round',
  },
  bleeding: {
    id: 'bleeding',
    name: 'Bleeding',
    icon: '\uD83E\uDE78',
    color: '#c44',
    type: 'dot',
    damagePerRound: 2,
    duration: 3,
    stackable: true,
    desc: 'Loses HP each round',
  },
  burning: {
    id: 'burning',
    name: 'Burning',
    icon: '\uD83D\uDD25',
    color: '#e82',
    type: 'dot',
    damagePerRound: 3,
    duration: 2,
    stackable: false,
    desc: 'Burns for damage each round',
  },
  infection: {
    id: 'infection',
    name: 'Infection',
    icon: '\uD83E\uDDA0',
    color: '#8a4',
    type: 'dot',
    damagePerRound: 2,
    duration: 4,
    stackable: false,
    desc: 'Infected, takes damage each round',
  },

  // --- Debuffs ---
  stun: {
    id: 'stun',
    name: 'Stunned',
    icon: '\uD83D\uDCAB',
    color: '#ee4',
    type: 'debuff',
    duration: 1,
    stackable: false,
    desc: 'Skips next turn',
  },
  slow: {
    id: 'slow',
    name: 'Slowed',
    icon: '\uD83D\uDC22',
    color: '#4ae',
    type: 'debuff',
    duration: 2,
    stackable: false,
    desc: 'Max gauge reduced by 2',
    statMod: { maxSteps: -2 },
  },
  daze: {
    id: 'daze',
    name: 'Dazed',
    icon: '\uD83D\uDE35',
    color: '#a8e',
    type: 'debuff',
    duration: 1,
    stackable: false,
    desc: 'Attack reduced by 2',
    statMod: { attack: -2 },
  },
  weakness: {
    id: 'weakness',
    name: 'Weakness',
    icon: '\uD83D\uDCA7',
    color: '#88a',
    type: 'debuff',
    duration: 2,
    stackable: false,
    desc: 'Attack reduced by 3',
    statMod: { attack: -3 },
  },
  armorBreak: {
    id: 'armorBreak',
    name: 'Armor Break',
    icon: '\uD83D\uDD27',
    color: '#a86',
    type: 'debuff',
    duration: 2,
    stackable: false,
    desc: 'Defense reduced by 3',
    statMod: { defense: -3 },
  },

  // --- Buffs ---
  regen: {
    id: 'regen',
    name: 'Regen',
    icon: '\u2728',
    color: '#4c4',
    type: 'buff',
    healPerRound: 2,
    duration: 3,
    stackable: false,
    desc: 'Heals HP each round',
  },
  damageBonus: {
    id: 'damageBonus',
    name: 'Damage Up',
    icon: '\uD83D\uDCA2',
    color: '#e44',
    type: 'buff',
    duration: 99, // lasts entire battle
    stackable: true,
    desc: 'Increased attack damage',
    statMod: { attack: 3 },
  },
  shield: {
    id: 'shield',
    name: 'Shield',
    icon: '\uD83D\uDEE1\uFE0F',
    color: '#48c',
    type: 'buff',
    duration: 2,
    stackable: false,
    desc: 'Defense increased',
    statMod: { defense: 3 },
  },
};

/**
 * Manages active status effects on a combatant.
 */
export class StatusTracker {
  constructor() {
    this.effects = []; // [{ id, name, icon, color, remaining, stacks, ...def }]
  }

  /** Apply a status effect. Returns true if newly applied. */
  apply(statusId, overrides = {}) {
    const def = STATUS[statusId];
    if (!def) return false;

    const existing = this.effects.find(e => e.id === statusId);
    if (existing) {
      if (def.stackable) {
        existing.stacks = (existing.stacks || 1) + 1;
        existing.remaining = Math.max(existing.remaining, overrides.duration || def.duration);
      } else {
        // Refresh duration
        existing.remaining = Math.max(existing.remaining, overrides.duration || def.duration);
      }
      // Apply overrides
      if (overrides.damagePerRound) existing.damagePerRound = overrides.damagePerRound;
      if (overrides.healPerRound) existing.healPerRound = overrides.healPerRound;
      return false;
    }

    this.effects.push({
      ...def,
      ...overrides,
      remaining: overrides.duration || def.duration,
      stacks: 1,
    });
    return true;
  }

  /** Remove a status effect by id. */
  remove(statusId) {
    this.effects = this.effects.filter(e => e.id !== statusId);
  }

  /** Remove all debuffs (cleanse). */
  cleanse() {
    this.effects = this.effects.filter(e => e.type === 'buff');
  }

  /** Clear all effects. */
  clear() {
    this.effects = [];
  }

  /** Has a specific effect? */
  has(statusId) {
    return this.effects.some(e => e.id === statusId);
  }

  /** Get effect by id. */
  get(statusId) {
    return this.effects.find(e => e.id === statusId);
  }

  /**
   * Process start-of-round effects.
   * Returns { damage, healing, skipTurn } totals.
   */
  processRound() {
    let damage = 0;
    let healing = 0;
    let skipTurn = false;

    for (const effect of this.effects) {
      // DoT damage
      if (effect.damagePerRound) {
        damage += effect.damagePerRound * (effect.stacks || 1);
      }
      // Healing
      if (effect.healPerRound) {
        healing += effect.healPerRound * (effect.stacks || 1);
      }
      // Stun = skip turn
      if (effect.id === 'stun') {
        skipTurn = true;
      }
    }

    // Decrement durations
    for (const effect of this.effects) {
      effect.remaining--;
    }

    // Remove expired
    this.effects = this.effects.filter(e => e.remaining > 0);

    return { damage, healing, skipTurn };
  }

  /**
   * Get total stat modifiers from all active effects.
   * Returns { attack: N, defense: N, maxSteps: N }
   */
  getStatMods() {
    const mods = { attack: 0, defense: 0, maxSteps: 0 };
    for (const effect of this.effects) {
      if (effect.statMod) {
        for (const [key, val] of Object.entries(effect.statMod)) {
          mods[key] = (mods[key] || 0) + val * (effect.stacks || 1);
        }
      }
    }
    return mods;
  }

  /** Get display-ready list of active effects. */
  getDisplay() {
    return this.effects.map(e => ({
      id: e.id,
      name: e.name,
      icon: e.icon,
      color: e.color,
      remaining: e.remaining,
      stacks: e.stacks || 1,
    }));
  }
}
