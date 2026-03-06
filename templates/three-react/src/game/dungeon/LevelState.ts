// ── Level State Persistence ──────────────────────────────────────────
// Types for serializing/restoring dungeon level state across floor transitions.

export interface SavedEnemy {
  type: string;         // VOX_ENEMIES key (characterType)
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  facing: number;
}

export interface SavedChest {
  x: number;
  z: number;
  opened: boolean;
}

export interface SavedCollectible {
  x: number;
  z: number;
  collected: boolean;
}

export interface SavedLoot {
  x: number;
  z: number;
  type: 'coin' | 'potion' | 'food' | 'gem';
  value: number;
  /** Potion color index (0-7) for effect mapping */
  colorIndex?: number;
  /** Hunger restore value for food items */
  hungerValue?: number;
}

export interface SavedDestroyedProp {
  x: number;
  z: number;
}

export interface LevelSnapshot {
  seed: number;
  floor: number;
  theme: string;
  enemies: SavedEnemy[];
  chests: SavedChest[];
  collectibles: SavedCollectible[];
  loot: SavedLoot[];
  destroyedProps: SavedDestroyedProp[];
}

/** Keyed by floor number */
export type LevelCache = Map<number, LevelSnapshot>;
