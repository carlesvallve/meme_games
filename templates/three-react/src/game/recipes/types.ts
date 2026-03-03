// ── Progression Recipe Types ────────────────────────────────────────
// Pure data interfaces — no game logic, no imports from game code.
// A recipe is a complete description of dungeon progression that can
// be serialized to JSON and swapped at runtime.

/** One zone in the dungeon (a contiguous range of floors). */
export interface FloorZoneConfig {
  floors: [number, number];        // inclusive floor range [min, max]
  zoneName: string;                // display name: "Upper Cellars"
  pool: {
    low: string[];                 // archetype names for low tier
    mid: string[];                 // archetype names for mid tier
    high: string[];                // archetype names for high tier
    weights: [number, number, number]; // [low, mid, high] spawn weights
  };
  densityMult: number;             // enemy density multiplier (1.0 = baseline)
  hpMult: number;                  // HP scaling multiplier
  damageMult: number;              // damage scaling multiplier
  // ── Dungeon layout progression (optional — defaults used if omitted) ──
  /** Dungeon world size in meters (default 40). */
  dungeonSize?: number;
  /** Room grid spacing — lower = more/smaller rooms (default 3). */
  roomSpacing?: number;
  /** Probability of height change between rooms 0–1 (default 0.55). */
  heightChance?: number;
  /** Door spawn probability 0–1 (default 0.7). */
  doorChance?: number;
  /** Loop corridor budget as fraction of rooms 0–1 (default 0.35). */
  loopChance?: number;
}

/** A special encounter on a specific floor. */
export interface ThemedFloor {
  floor: number;
  title: string;                   // announcement title
  subtitle?: string;               // announcement subtitle
  bossArchetype: string;           // guaranteed boss archetype name
  bossCount: number;               // how many bosses to spawn
  exclusivePool?: string[];        // if set, only these archetypes spawn on this floor
}

/** A complete progression recipe — everything needed to drive floor scaling. */
export interface ProgressionRecipe {
  /** Unique recipe name for display & persistence. */
  name: string;
  /** Short description for tooltips / UI. */
  description: string;
  /** Ordered list of floor zones (must cover floor 1 at minimum). */
  zones: FloorZoneConfig[];
  /** Room template → archetypes that thematically fit. Rooms not listed use floor pool. */
  roomAffinity: Record<string, string[]>;
  /** Weight multiplier for matching room-affinity archetypes (default 3). */
  roomAffinityBoost: number;
  /** Special encounters keyed by floor number. */
  themedFloors: ThemedFloor[];
  /** How stats scale beyond the last defined zone. */
  overshootScaling: {
    hpPerFloor: number;
    damagePerFloor: number;
    /** Extra dungeon size per floor beyond last zone (default 2). */
    dungeonSizePerFloor?: number;
  };
}
