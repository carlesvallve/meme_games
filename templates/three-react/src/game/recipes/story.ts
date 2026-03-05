// ── Story Recipe — Dynamic Mini-Dungeon Progression ─────────────────
// Creates a ProgressionRecipe on-the-fly for POI dungeons on heightmaps.
// Each dungeon gets themed enemies based on its name and a boss on the last floor.

import type { ProgressionRecipe, FloorZoneConfig, ThemedFloor } from './types';
import { registerRecipe } from '../dungeon/FloorConfig';
import { generateDungeonFloorSubtitle } from '../overworld/LocationNames';

// ── Theme detection ─────────────────────────────────────────────────

interface EnemyTheme {
  low: string[];
  mid: string[];
  high: string[];
  boss: string;
}

const THEMES: { keywords: RegExp; theme: EnemyTheme }[] = [
  {
    keywords: /crypt|tomb|bone|dead|sepulch|barrow|ossuary|necro|grave|mauso/i,
    theme: {
      low: ['rat', 'bat', 'spider'],
      mid: ['skeleton', 'zombie', 'ghost'],
      high: ['vampire', 'ghost'],
      boss: 'vampire',
    },
  },
  {
    keywords: /spider|web|nest|hive|cocoon|burrow|warren|crawl/i,
    theme: {
      low: ['spider', 'rat', 'bat'],
      mid: ['spider', 'imp', 'blob', 'mimic'],
      high: ['gargoyle'],
      boss: 'gargoyle',
    },
  },
  {
    keywords: /dragon|wyrm|fire|flame|burn|smolder|forge|scorch|ember|pyre/i,
    theme: {
      low: ['imp', 'bat'],
      mid: ['imp', 'devil', 'gargoyle'],
      high: ['dragon', 'devil'],
      boss: 'dragon',
    },
  },
  {
    keywords: /demon|devil|hell|abyss|void|infern|profane|unholy|damned/i,
    theme: {
      low: ['imp', 'bat'],
      mid: ['devil', 'gargoyle', 'ghost'],
      high: ['devil', 'beholder'],
      boss: 'devil',
    },
  },
  {
    keywords: /blood|gore|flay|sever|teeth|maw|gullet|worm/i,
    theme: {
      low: ['rat', 'blob', 'spider'],
      mid: ['zombie', 'werewolf', 'wolf'],
      high: ['minotaur', 'hydra'],
      boss: 'minotaur',
    },
  },
  {
    keywords: /haunt|ghost|spirit|pale|shadow|whisper|echo|weep|wail/i,
    theme: {
      low: ['bat', 'rat'],
      mid: ['ghost', 'skeleton', 'imp'],
      high: ['vampire', 'ghost'],
      boss: 'vampire',
    },
  },
];

const DEFAULT_THEME: EnemyTheme = {
  low: ['rat', 'bat', 'spider', 'imp', 'goblin'],
  mid: ['skeleton', 'zombie', 'hobgoblin', 'wolf', 'mimic'],
  high: ['gargoyle', 'werewolf'],
  boss: 'werewolf',
};

function detectTheme(dungeonName: string): EnemyTheme {
  for (const { keywords, theme } of THEMES) {
    if (keywords.test(dungeonName)) return theme;
  }
  return DEFAULT_THEME;
}

// ── Recipe builder ──────────────────────────────────────────────────

/** Build a recipe key for a POI dungeon. */
export function storyRecipeKey(poiSeed: number): string {
  return `Story:${poiSeed}`;
}

/** Build and register a story recipe for a POI mini-dungeon. Returns the recipe name. */
export function buildStoryRecipe(
  poiSeed: number,
  floorCount: number,
  dungeonName: string,
  skulls = 1,
): string {
  const theme = detectTheme(dungeonName);
  const recipeName = storyRecipeKey(poiSeed);

  // Dungeon size: random range, skulls push toward larger
  //   1-skull: 18-24m,  2-skull: 22-28m,  3-skull: 26-34m
  const sizeRng = ((poiSeed * 9301 + 49297) % 233280) / 233280; // 0-1
  const sizeMin = 16 + skulls * 2;  // 18, 20, 22
  const sizeMax = 22 + skulls * 4;  // 26, 30, 34
  const baseDungeonSize = Math.round(sizeMin + sizeRng * (sizeMax - sizeMin));

  // Enemy weights: skulls drive toughness
  //   1-skull: mostly low,  2-skull: balanced,  3-skull: mostly high
  const weights: [number, number, number] =
    skulls === 1 ? [7, 3, 0] :
    skulls === 2 ? [4, 5, 1] :
                   [2, 4, 4];

  // Layout complexity scales with skulls
  const heightChance = 0.1 + skulls * 0.05;  // 0.15, 0.2, 0.25
  const loopChance = skulls * 0.05;           // 0.05, 0.1, 0.15
  const roomSpacing = skulls >= 3 ? 3 : 4;   // tighter rooms for hard dungeons

  const zone: FloorZoneConfig = {
    floors: [1, floorCount],
    zoneName: dungeonName,
    pool: {
      low: theme.low,
      mid: theme.mid,
      high: theme.high,
      weights,
    },
    densityMult: 0.5 + skulls * 0.2,         // 0.7, 0.9, 1.1
    hpMult: 0.7 + skulls * 0.3,              // 1.0, 1.3, 1.6
    damageMult: 0.7 + skulls * 0.3,           // 1.0, 1.3, 1.6
    dungeonSize: baseDungeonSize,
    roomSpacing,
    heightChance,
    doorChance: 0.8,
    loopChance,
  };

  // Boss on last floor
  const themedFloors: ThemedFloor[] = [
    {
      floor: floorCount,
      title: dungeonName,
      subtitle: generateDungeonFloorSubtitle(poiSeed, floorCount, floorCount),
      bossArchetype: theme.boss,
      bossCount: 1,
    },
  ];

  const recipe: ProgressionRecipe = {
    name: recipeName,
    description: `Mini-dungeon: ${dungeonName} (${'☠'.repeat(skulls)}, ${floorCount}F)`,
    zones: [zone],
    roomAffinity: {
      crypt:      ['skeleton', 'zombie', 'ghost'],
      tomb_vault: ['skeleton', 'zombie', 'ghost', 'vampire'],
      library:    ['ghost', 'imp', 'spider'],
      study:      ['ghost', 'imp', 'spider'],
      chapel:     ['ghost', 'gargoyle'],
      shrine:     ['ghost', 'gargoyle'],
      barracks:   ['hobgoblin', 'goblin', 'skeleton'],
      guard:      ['hobgoblin', 'goblin', 'skeleton'],
      jail:       ['skeleton', 'zombie', 'rat'],
      cell:       ['skeleton', 'zombie', 'rat'],
      kitchen:    ['rat', 'goblin', 'blob'],
      pantry:     ['rat', 'goblin', 'blob'],
      cellar:     ['rat', 'spider', 'blob'],
      storage:    ['rat', 'spider', 'blob'],
      treasure:   ['mimic', 'goblin'],
      trophy:     ['mimic', 'goblin'],
      trap:       ['spider', 'mimic', 'imp'],
      alchemy:    ['imp', 'ghost', 'spider'],
    },
    roomAffinityBoost: 3,
    themedFloors,
    overshootScaling: {
      hpPerFloor: 0.15,
      damagePerFloor: 0.1,
      dungeonSizePerFloor: 1,
    },
  };

  registerRecipe(recipeName, recipe);
  return recipeName;
}
