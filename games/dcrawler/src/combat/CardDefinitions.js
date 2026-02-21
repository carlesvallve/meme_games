// Card definitions inspired by Void Tyrant
// Each card has: name, type, playType, timing, border, value, cost (EP), image, symbol, desc

// --- Play types (how the card resolves mechanically) ---
export const PLAY_TYPE = {
  MODIFIER: 'modifier',   // adds to gauge directly
  OFFENSIVE: 'offensive',  // stays active, adds attacks during resolution
  DEFENSIVE: 'defensive',  // stays active, blocks attacks during resolution
  INSTANT: 'instant',      // immediate effect (damage, heal, etc.)
};

// --- Visual card types (determines panel color) ---
export const CARD_TYPE = {
  MODIFIER: 'modifier',   // yellow border — affects gauge
  WEAPON: 'weapon',       // red border — offensive equipment
  SHIELD: 'shield',       // blue border — defensive equipment
  POTION: 'potion',       // black border — consumable, single use
  SPELL: 'spell',         // red border — instant damage
  ABILITY: 'ability',     // blue border — class abilities / self-buffs
};

// --- Activation timings (when the card effect triggers) ---
export const TIMING = {
  INSTANT: 'instant',             // triggers immediately on play
  VICTORY: 'victory',             // triggers if player wins the round
  CRITICAL_VICTORY: 'critical',   // triggers only on exact 12 (critical)
  DEFEAT: 'defeat',               // triggers if player loses the round
  BUST: 'bust',                   // triggers if player overcharges
};

// ============================================================
//  MODIFIERS — yellow border, affect gauge, all cost 5 EP
// ============================================================
export const MODIFIERS = {
  plus1: {
    name: '+1', type: CARD_TYPE.MODIFIER, playType: PLAY_TYPE.MODIFIER,
    timing: TIMING.INSTANT,
    value: { min: 1, max: 1 }, cost: 5,
    symbol: '\u2780',
    desc: 'Add 1 to your gauge',
  },
  plus2: {
    name: '+2', type: CARD_TYPE.MODIFIER, playType: PLAY_TYPE.MODIFIER,
    timing: TIMING.INSTANT,
    value: { min: 2, max: 2 }, cost: 5,
    symbol: '\u2781',
    desc: 'Add 2 to your gauge',
  },
  plus3: {
    name: '+3', type: CARD_TYPE.MODIFIER, playType: PLAY_TYPE.MODIFIER,
    timing: TIMING.INSTANT,
    value: { min: 3, max: 3 }, cost: 5,
    symbol: '\u2782',
    desc: 'Add 3 to your gauge',
  },
  plus6: {
    name: '+6', type: CARD_TYPE.MODIFIER, playType: PLAY_TYPE.MODIFIER,
    timing: TIMING.INSTANT,
    value: { min: 6, max: 6 }, cost: 5,
    symbol: '\u2785',
    desc: 'Add 6 to your gauge',
  },
  range1to2: {
    name: '1~2', type: CARD_TYPE.MODIFIER, playType: PLAY_TYPE.MODIFIER,
    timing: TIMING.INSTANT,
    value: { min: 1, max: 2, randomMode: 'BETWEEN' }, cost: 5,
    symbol: '\uD83C\uDFB2',
    desc: 'Add 1-2 to gauge (random)',
  },
  range1to3: {
    name: '1~3', type: CARD_TYPE.MODIFIER, playType: PLAY_TYPE.MODIFIER,
    timing: TIMING.INSTANT,
    value: { min: 1, max: 3, randomMode: 'BETWEEN' }, cost: 5,
    symbol: '\uD83C\uDFB2',
    desc: 'Add 1-3 to gauge (random)',
  },
  range1to5: {
    name: '1~5', type: CARD_TYPE.MODIFIER, playType: PLAY_TYPE.MODIFIER,
    timing: TIMING.INSTANT,
    value: { min: 1, max: 5, randomMode: 'BETWEEN' }, cost: 5,
    symbol: '\uD83C\uDFB2',
    desc: 'Add 1-5 to gauge (random)',
  },
  oneOrTen: {
    name: '1|10', type: CARD_TYPE.MODIFIER, playType: PLAY_TYPE.MODIFIER,
    timing: TIMING.INSTANT,
    value: { min: 1, max: 10, randomMode: 'OR' }, cost: 5,
    symbol: '\uD83C\uDFB0',
    desc: 'Add 1 or 10 (coin flip)',
  },
};

// ============================================================
//  WEAPONS — red border, add extra strikes during resolution
// ============================================================
export const WEAPONS = {
  simpleKnife: {
    name: 'Knife', type: CARD_TYPE.WEAPON, playType: PLAY_TYPE.OFFENSIVE,
    timing: TIMING.VICTORY,
    value: { min: 1 }, cost: 10,
    symbol: '\uD83D\uDD2A',
    desc: '+1 strike. Inflicts bleeding',
  },
  sword: {
    name: 'Sword', type: CARD_TYPE.WEAPON, playType: PLAY_TYPE.OFFENSIVE,
    timing: TIMING.VICTORY,
    value: { min: 2 }, cost: 10,
    symbol: '\u2694\uFE0F',
    desc: '+2 strikes on victory',
  },
  axe: {
    name: 'Axe', type: CARD_TYPE.WEAPON, playType: PLAY_TYPE.OFFENSIVE,
    timing: TIMING.VICTORY,
    value: { min: 2 }, cost: 10,
    symbol: '\uD83E\uDE93',
    desc: '+2 strikes on victory',
  },
  flail: {
    name: 'Flail', type: CARD_TYPE.WEAPON, playType: PLAY_TYPE.OFFENSIVE,
    timing: TIMING.VICTORY,
    value: { min: 3 }, cost: 15,
    symbol: '\u26D3\uFE0F',
    desc: '+3 strikes on victory',
  },
  hammer: {
    name: 'Hammer', type: CARD_TYPE.WEAPON, playType: PLAY_TYPE.OFFENSIVE,
    timing: TIMING.VICTORY,
    value: { min: 2 }, cost: 15,
    symbol: '\uD83D\uDD28',
    desc: '+2 strikes. Stuns enemy',
  },
};

// ============================================================
//  SHIELDS — blue border, block incoming strikes on defeat
// ============================================================
export const SHIELDS = {
  buckler: {
    name: 'Buckler', type: CARD_TYPE.SHIELD, playType: PLAY_TYPE.DEFENSIVE,
    timing: TIMING.DEFEAT,
    value: { min: 1 }, cost: 10,
    symbol: '\uD83D\uDEE1\uFE0F',
    desc: 'Block 1 strike on defeat',
  },
  shield: {
    name: 'Shield', type: CARD_TYPE.SHIELD, playType: PLAY_TYPE.DEFENSIVE,
    timing: TIMING.DEFEAT,
    value: { min: 2 }, cost: 10,
    symbol: '\uD83E\uDE96',
    desc: 'Block 2 strikes on defeat',
  },
  heavyShield: {
    name: 'Heavy Shield', type: CARD_TYPE.SHIELD, playType: PLAY_TYPE.DEFENSIVE,
    timing: TIMING.DEFEAT,
    value: { min: 3 }, cost: 15,
    symbol: '\uD83C\uDFF0',
    desc: 'Block 3 strikes on defeat',
  },
};

// ============================================================
//  POTIONS — black border, consumable (removed from deck after use)
// ============================================================
export const POTIONS = {
  healthPotion: {
    name: 'Health Potion', type: CARD_TYPE.POTION, playType: PLAY_TYPE.INSTANT,
    timing: TIMING.INSTANT, consumable: true,
    value: { min: 15, type: 'hp' }, cost: 0,
    symbol: '\u2764\uFE0F',
    desc: 'Restore 15 HP. Single use',
  },
  largePotion: {
    name: 'Large Potion', type: CARD_TYPE.POTION, playType: PLAY_TYPE.INSTANT,
    timing: TIMING.INSTANT, consumable: true,
    value: { min: 30, type: 'hp' }, cost: 0,
    symbol: '\uD83D\uDC96',
    desc: 'Restore 30 HP. Single use',
  },
  energyCrystal: {
    name: 'Energy Crystal', type: CARD_TYPE.POTION, playType: PLAY_TYPE.INSTANT,
    timing: TIMING.INSTANT, consumable: true,
    value: { min: 20, type: 'ep' }, cost: 0,
    symbol: '\uD83D\uDD35',
    desc: 'Restore 20 EP. Single use',
  },
  antidote: {
    name: 'Antidote', type: CARD_TYPE.POTION, playType: PLAY_TYPE.INSTANT,
    timing: TIMING.INSTANT, consumable: true,
    value: { min: 0, type: 'cleanse' }, cost: 0,
    symbol: '\uD83E\uDDEA',
    desc: 'Remove all debuffs. Single use',
  },
};

// ============================================================
//  SPELLS — red border, instant damage effects
// ============================================================
export const SPELLS = {
  fireball: {
    name: 'Fireball', type: CARD_TYPE.SPELL, playType: PLAY_TYPE.INSTANT,
    timing: TIMING.INSTANT,
    value: { min: 14 }, cost: 10,
    symbol: '\uD83D\uDD25',
    desc: 'Deal 14 fire damage',
  },
  icyMist: {
    name: 'Icy Mist', type: CARD_TYPE.SPELL, playType: PLAY_TYPE.INSTANT,
    timing: TIMING.INSTANT,
    value: { min: 10 }, cost: 10,
    symbol: '\u2744\uFE0F',
    desc: 'Deal 10 ice damage. Slows enemy',
  },
  lightning: {
    name: 'Lightning', type: CARD_TYPE.SPELL, playType: PLAY_TYPE.INSTANT,
    timing: TIMING.INSTANT,
    value: { min: 12 }, cost: 10,
    symbol: '\u26A1',
    desc: 'Deal 12 lightning damage',
  },
  poison: {
    name: 'Poison', type: CARD_TYPE.SPELL, playType: PLAY_TYPE.INSTANT,
    timing: TIMING.INSTANT,
    value: { min: 6, dot: 4, dotRounds: 3 }, cost: 10,
    symbol: '\u2620\uFE0F',
    desc: 'Deal 6 + 4/round for 3 rounds',
  },
};

// ============================================================
//  ABILITIES — blue border, class abilities / self-buffs
// ============================================================
export const ABILITIES = {
  battleCry: {
    name: 'Battle Cry', type: CARD_TYPE.ABILITY, playType: PLAY_TYPE.INSTANT,
    timing: TIMING.INSTANT,
    value: { min: 3, type: 'damageBonus' }, cost: 20,
    symbol: '\uD83D\uDCA2', image: null,
    desc: '+3 damage bonus for this battle',
  },
  shoveBack: {
    name: 'Shove Back', type: CARD_TYPE.ABILITY, playType: PLAY_TYPE.INSTANT,
    timing: TIMING.INSTANT,
    value: { min: 0, type: 'resetEnemyGauge' }, cost: 20,
    symbol: '\uD83D\uDCA5', image: null,
    desc: 'Reset enemy gauge to 0',
  },
  suckerPunch: {
    name: 'Sucker Punch', type: CARD_TYPE.ABILITY, playType: PLAY_TYPE.INSTANT,
    timing: TIMING.INSTANT,
    value: { min: 8 }, cost: 10,
    symbol: '\u270A', image: null,
    desc: 'Deal 8 damage. Dazes enemy',
  },
  kick: {
    name: 'Kick', type: CARD_TYPE.ABILITY, playType: PLAY_TYPE.INSTANT,
    timing: TIMING.INSTANT,
    value: { min: 10 }, cost: 10,
    symbol: '\uD83E\uDD7E', image: null,
    desc: 'Deal 10 damage',
  },
  bandage: {
    name: 'Bandage', type: CARD_TYPE.ABILITY, playType: PLAY_TYPE.INSTANT,
    timing: TIMING.VICTORY,
    value: { min: 12, type: 'hp' }, cost: 10,
    symbol: '\uD83E\uDE79', image: null,
    desc: 'Heal 12 HP on victory',
  },
  focusedStance: {
    name: 'Focus', type: CARD_TYPE.ABILITY, playType: PLAY_TYPE.INSTANT,
    timing: TIMING.INSTANT,
    value: { min: 0, type: 'reveal' }, cost: 5,
    symbol: '\uD83D\uDC41', image: null,
    desc: 'Reveal next 3 dealer cards',
  },
};

// ============================================================
//  ALL CARDS
// ============================================================
export const ALL_CARDS = {
  ...MODIFIERS, ...WEAPONS, ...SHIELDS, ...POTIONS, ...SPELLS, ...ABILITIES,
};

// Resolve a card's random value
export function resolveCardValue(card) {
  const { min, max, randomMode } = card.value;
  if (!randomMode) return min;
  if (randomMode === 'BETWEEN') {
    return min + Math.floor(Math.random() * (max - min + 1));
  }
  if (randomMode === 'OR') {
    return Math.random() < 0.5 ? min : max;
  }
  return min;
}

// ============================================================
//  STARTING DECK — ~18 cards (VT style: deckbuilder starting deck)
//  Hand size 5, cards stay in hand until played, draw to fill.
//  VT starts with class cards + basic equipment + a few modifiers.
// ============================================================
export function createHandDeck() {
  const deck = [];
  let id = 0;
  const add = (card, count = 1) => {
    for (let i = 0; i < count; i++) {
      deck.push({ ...card, id: `deck_${id++}_${card.name}` });
    }
  };

  // Equipment (6 cards)
  add(WEAPONS.sword);
  add(WEAPONS.simpleKnife);
  add(SHIELDS.buckler, 2);
  add(SHIELDS.shield);
  add(WEAPONS.axe);

  // Spells & abilities (6 cards)
  add(SPELLS.fireball);
  add(ABILITIES.kick, 2);
  add(ABILITIES.bandage, 2);
  add(ABILITIES.battleCry);

  // Potions (3 cards)
  add(POTIONS.healthPotion, 2);
  add(POTIONS.energyCrystal);

  // Modifiers (3 cards — ~17% of deck, so ~1 per hand on average)
  add(MODIFIERS.plus2);
  add(MODIFIERS.plus3);
  add(MODIFIERS.range1to3);

  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

// Get a random reward card (for loot drops after combat)
export function getRandomRewardCard() {
  const pools = [
    { cards: WEAPONS, weight: 3 },
    { cards: SHIELDS, weight: 2 },
    { cards: SPELLS, weight: 2 },
    { cards: ABILITIES, weight: 2 },
    { cards: POTIONS, weight: 2 },
    { cards: MODIFIERS, weight: 1 },
  ];

  // Weighted random pick
  const totalWeight = pools.reduce((sum, p) => sum + p.weight, 0);
  let roll = Math.random() * totalWeight;
  let chosen = pools[0];
  for (const pool of pools) {
    roll -= pool.weight;
    if (roll <= 0) { chosen = pool; break; }
  }

  const keys = Object.keys(chosen.cards);
  const key = keys[Math.floor(Math.random() * keys.length)];
  const card = chosen.cards[key];
  return { ...card, id: `loot_${key}_${Date.now()}` };
}
