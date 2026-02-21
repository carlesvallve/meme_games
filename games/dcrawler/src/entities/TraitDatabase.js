// Enemy traits inspired by Void Tyrant
// Each trait modifies enemy stats, behavior, or adds cards to their deck

export const TRAITS = {
  // --- Stat modifiers ---
  elite: {
    name: 'Elite',
    desc: 'Level +2, double XP',
    icon: '\u2B50',
    apply(enemy) {
      enemy.attack += 2;
      enemy.defense += 1;
      enemy.hp = Math.floor(enemy.hp * 1.3);
      enemy.maxHp = enemy.hp;
      enemy.xpReward *= 2;
    },
  },
  healthy: {
    name: 'Healthy',
    desc: '+50% HP',
    icon: '\u2764',
    apply(enemy) {
      enemy.hp = Math.floor(enemy.hp * 1.5);
      enemy.maxHp = enemy.hp;
    },
  },
  weak: {
    name: 'Weak',
    desc: 'Half HP (min 6)',
    icon: '\uD83D\uDCA7',
    apply(enemy) {
      enemy.hp = Math.max(6, Math.floor(enemy.hp / 2));
      enemy.maxHp = enemy.hp;
    },
  },
  hard: {
    name: 'Hard',
    desc: '+4 armor',
    icon: '\uD83D\uDEE1',
    apply(enemy) {
      enemy.defense += 4;
    },
  },
  rich: {
    name: 'Rich',
    desc: 'Extra gold reward',
    icon: '\uD83D\uDCB0',
    apply(enemy) {
      enemy.goldReward = Math.floor(enemy.goldReward * 2);
    },
  },

  // --- Behavior modifiers ---
  aggressive: {
    name: 'Aggressive',
    desc: 'Hits at gauge 9+',
    icon: '\uD83D\uDCA2',
    apply(enemy) {
      enemy.aggression = 2.0;
    },
  },
  cowardly: {
    name: 'Cowardly',
    desc: 'Stands at gauge 7+',
    icon: '\uD83D\uDC94',
    apply(enemy) {
      enemy.standThreshold = 7;
    },
  },
  spineless: {
    name: 'Spineless',
    desc: 'Stands at 7+, gauge max 10',
    icon: '\uD83D\uDC80',
    apply(enemy) {
      enemy.standThreshold = 7;
      enemy.maxSteps = Math.min(enemy.maxSteps, 10);
    },
  },

  // --- Status effect traits ---
  poisonous: {
    name: 'Poisonous',
    desc: '10% chance to poison per strike',
    icon: '\u2620',
    apply(enemy) {
      enemy.onStrike = enemy.onStrike || [];
      enemy.onStrike.push({ effect: 'poison', chance: 0.1, damage: 3, rounds: 3 });
    },
  },
  filthy: {
    name: 'Filthy',
    desc: '10% chance to infect per strike',
    icon: '\uD83E\uDDA0',
    apply(enemy) {
      enemy.onStrike = enemy.onStrike || [];
      enemy.onStrike.push({ effect: 'infection', chance: 0.1, damage: 2, rounds: 4 });
    },
  },
  regenerating: {
    name: 'Regenerating',
    desc: 'Heals 2 HP per round',
    icon: '\u2728',
    apply(enemy) {
      enemy.regenPerRound = (enemy.regenPerRound || 0) + 2;
    },
  },
  dying: {
    name: 'Dying',
    desc: 'Loses 3 HP per round',
    icon: '\uD83D\uDC80',
    apply(enemy) {
      enemy.dotPerRound = (enemy.dotPerRound || 0) + 3;
    },
  },
  energised: {
    name: 'Energised',
    desc: 'Starts at max EP',
    icon: '\u26A1',
    apply(enemy) {
      enemy.startsFullEP = true;
    },
  },

  // --- Card-granting traits ---
  expert: {
    name: 'Expert',
    desc: 'Has modifier cards',
    icon: '\uD83C\uDFAF',
    apply(enemy) {
      enemy.extraCards = enemy.extraCards || [];
      enemy.extraCards.push('plus1', 'plus1', 'plus2', 'plus3');
    },
  },
  fluxer: {
    name: 'Fluxer',
    desc: 'Has random modifier cards',
    icon: '\uD83C\uDFB2',
    apply(enemy) {
      enemy.extraCards = enemy.extraCards || [];
      enemy.extraCards.push('range1to3', 'range1to2', 'oneOrTen');
    },
  },
  pugilist: {
    name: 'Pugilist',
    desc: 'Has Kick and Sucker Punch',
    icon: '\u270A',
    apply(enemy) {
      enemy.extraCards = enemy.extraCards || [];
      enemy.extraCards.push('kick', 'suckerPunch');
    },
  },
  warrior: {
    name: 'Warrior',
    desc: 'Has War Cry and Battle Cry',
    icon: '\u2694',
    apply(enemy) {
      enemy.extraCards = enemy.extraCards || [];
      enemy.extraCards.push('battleCry');
    },
  },
  wizard: {
    name: 'Wizard',
    desc: 'Has random spell cards',
    icon: '\uD83D\uDD2E',
    apply(enemy) {
      enemy.extraCards = enemy.extraCards || [];
      const spells = ['fireball', 'icyMist', 'lightning', 'poison'];
      // Add 2 random spells
      for (let i = 0; i < 2; i++) {
        enemy.extraCards.push(spells[Math.floor(Math.random() * spells.length)]);
      }
    },
  },
  grenadier: {
    name: 'Grenadier',
    desc: 'Has grenade consumables',
    icon: '\uD83D\uDCA3',
    apply(enemy) {
      enemy.extraCards = enemy.extraCards || [];
      enemy.extraCards.push('fireball', 'fireball'); // placeholder until grenades exist
    },
  },
  scholar: {
    name: 'Scholar',
    desc: 'Has a scroll consumable',
    icon: '\uD83D\uDCDC',
    apply(enemy) {
      enemy.extraCards = enemy.extraCards || [];
      enemy.extraCards.push('lightning'); // placeholder until scrolls exist
    },
  },
};

// Trait pools by difficulty tier
const COMMON_TRAITS = ['aggressive', 'cowardly', 'healthy', 'weak', 'rich', 'dying'];
const UNCOMMON_TRAITS = ['poisonous', 'filthy', 'regenerating', 'expert', 'fluxer', 'energised'];
const RARE_TRAITS = ['elite', 'hard', 'pugilist', 'warrior', 'wizard', 'spineless'];

/**
 * Roll random traits for an enemy based on floor difficulty.
 * Returns an array of trait keys.
 */
export function rollTraits(floor) {
  const traits = [];
  const maxTraits = floor >= 5 ? 3 : floor >= 3 ? 2 : 1;

  // Higher floors have higher chance of getting traits
  const traitChance = Math.min(0.3 + floor * 0.1, 0.8);

  for (let i = 0; i < maxTraits; i++) {
    if (Math.random() > traitChance) continue;

    let pool;
    const roll = Math.random();
    if (roll < 0.5) pool = COMMON_TRAITS;
    else if (roll < 0.85) pool = UNCOMMON_TRAITS;
    else pool = RARE_TRAITS;

    const trait = pool[Math.floor(Math.random() * pool.length)];
    if (!traits.includes(trait)) traits.push(trait);
  }

  return traits;
}

/**
 * Apply trait effects to an enemy instance.
 */
export function applyTraits(enemy, traitKeys) {
  enemy.traits = [];
  for (const key of traitKeys) {
    const trait = TRAITS[key];
    if (!trait) continue;
    trait.apply(enemy);
    enemy.traits.push({ key, name: trait.name, icon: trait.icon, desc: trait.desc });
  }
}
