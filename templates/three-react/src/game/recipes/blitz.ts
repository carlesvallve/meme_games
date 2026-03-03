// ── Blitz Progression ───────────────────────────────────────────────
// Fast-paced 6-floor run: steep scaling, every type available early,
// boss on floor 3 and 6. Good for short play sessions.

import type { ProgressionRecipe } from './types';

export const BLITZ: ProgressionRecipe = {
  name: 'Blitz',
  description: '6-floor speed run — steep scaling, bosses on floors 3 and 6.',

  zones: [
    {
      floors: [1, 2],
      zoneName: 'The Gauntlet',
      pool: {
        low:     ['rat', 'bat', 'goblin', 'spider', 'imp', 'blob'],
        mid:     ['skeleton', 'zombie', 'hobgoblin', 'wolf'],
        high:    [],
        weights: [5, 5, 0],
      },
      densityMult: 1.2,
      hpMult: 1.0,
      damageMult: 1.0,
      dungeonSize: 30,
      roomSpacing: 3,
      heightChance: 0.25,
      doorChance: 0.5,
      loopChance: 0.15,
    },
    {
      floors: [3, 4],
      zoneName: 'The Crucible',
      pool: {
        low:     ['goblin', 'imp'],
        mid:     ['ghost', 'werewolf', 'bugbear', 'gargoyle'],
        high:    ['vampire', 'mimic', 'devil'],
        weights: [2, 4, 4],
      },
      densityMult: 1.3,
      hpMult: 1.6,
      damageMult: 1.4,
      dungeonSize: 38,
      roomSpacing: 3,
      heightChance: 0.45,
      doorChance: 0.7,
      loopChance: 0.35,
    },
    {
      floors: [5, 6],
      zoneName: 'The Abyss',
      pool: {
        low:     [],
        mid:     ['gargoyle', 'werewolf'],
        high:    ['devil', 'beholder', 'minotaur', 'golem', 'hydra', 'dragon'],
        weights: [0, 2, 8],
      },
      densityMult: 1.5,
      hpMult: 2.5,
      damageMult: 2.0,
      dungeonSize: 46,
      roomSpacing: 2,
      heightChance: 0.6,
      doorChance: 0.8,
      loopChance: 0.5,
    },
  ],

  roomAffinity: {
    crypt:     ['skeleton', 'zombie', 'ghost'],
    tomb_vault: ['skeleton', 'ghost', 'vampire'],
    library:   ['ghost', 'imp'],
    barracks:  ['hobgoblin', 'goblin'],
    jail:      ['skeleton', 'zombie', 'rat'],
    treasure:  ['mimic', 'goblin'],
    trap:      ['spider', 'mimic'],
  },
  roomAffinityBoost: 4,

  themedFloors: [
    {
      floor: 3,
      title: 'The Blood Arena',
      subtitle: 'Fight or die.',
      bossArchetype: 'minotaur',
      bossCount: 2,
    },
    {
      floor: 6,
      title: 'The Final Gate',
      subtitle: 'Only the worthy survive.',
      bossArchetype: 'dragon',
      bossCount: 2,
    },
  ],

  overshootScaling: {
    hpPerFloor: 0.5,
    damagePerFloor: 0.3,
    dungeonSizePerFloor: 3,
  },
};
