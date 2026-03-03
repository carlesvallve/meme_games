// ── Nightmare Progression ───────────────────────────────────────────
// Hard mode: high-tier enemies from floor 1, extreme scaling, frequent bosses.
// No easy warm-up — every floor is dangerous.

import type { ProgressionRecipe } from './types';

export const NIGHTMARE: ProgressionRecipe = {
  name: 'Nightmare',
  description: 'Hard mode — high-tier enemies from floor 1, extreme scaling, frequent bosses.',

  zones: [
    {
      floors: [1, 3],
      zoneName: 'Killing Fields',
      pool: {
        low:     ['goblin', 'spider', 'imp'],
        mid:     ['skeleton', 'zombie', 'ghost', 'wolf', 'hobgoblin'],
        high:    ['mimic', 'vampire'],
        weights: [3, 4, 3],
      },
      densityMult: 1.3,
      hpMult: 1.4,
      damageMult: 1.3,
      dungeonSize: 34,
      roomSpacing: 3,
      heightChance: 0.35,
      doorChance: 0.6,
      loopChance: 0.2,
    },
    {
      floors: [4, 6],
      zoneName: 'The Slaughterhouse',
      pool: {
        low:     ['spider'],
        mid:     ['werewolf', 'bugbear', 'gargoyle', 'hobgoblin'],
        high:    ['vampire', 'devil', 'beholder', 'mimic'],
        weights: [1, 3, 6],
      },
      densityMult: 1.5,
      hpMult: 2.0,
      damageMult: 1.8,
      dungeonSize: 42,
      roomSpacing: 2,
      heightChance: 0.5,
      doorChance: 0.7,
      loopChance: 0.4,
    },
    {
      floors: [7, 9],
      zoneName: 'Hell\'s Maw',
      pool: {
        low:     [],
        mid:     ['gargoyle', 'werewolf'],
        high:    ['devil', 'beholder', 'minotaur', 'golem', 'hydra', 'dragon'],
        weights: [0, 2, 8],
      },
      densityMult: 1.6,
      hpMult: 3.0,
      damageMult: 2.5,
      dungeonSize: 50,
      roomSpacing: 2,
      heightChance: 0.65,
      doorChance: 0.8,
      loopChance: 0.6,
    },
  ],

  roomAffinity: {
    crypt:     ['skeleton', 'zombie', 'ghost', 'vampire'],
    tomb_vault: ['vampire', 'ghost'],
    chapel:    ['ghost', 'gargoyle', 'devil'],
    treasure:  ['mimic', 'mimic', 'mimic'],
    trap:      ['spider', 'mimic', 'devil'],
    barracks:  ['hobgoblin', 'bugbear', 'werewolf'],
  },
  roomAffinityBoost: 5,

  themedFloors: [
    {
      floor: 3,
      title: 'The Pit of Bones',
      subtitle: 'They never stop coming.',
      bossArchetype: 'vampire',
      bossCount: 2,
      exclusivePool: ['skeleton', 'zombie', 'ghost', 'vampire'],
    },
    {
      floor: 6,
      title: 'Demon Lord\'s Court',
      subtitle: 'Bow before your end.',
      bossArchetype: 'devil',
      bossCount: 3,
    },
    {
      floor: 9,
      title: 'The Dragon Nest',
      subtitle: 'The ancient ones feast.',
      bossArchetype: 'dragon',
      bossCount: 3,
    },
  ],

  overshootScaling: {
    hpPerFloor: 0.5,
    damagePerFloor: 0.3,
    dungeonSizePerFloor: 2,
  },
};
