// ── Floor-Based Dungeon Progression — Engine ────────────────────────
// Pure engine: reads the active ProgressionRecipe, provides lookup helpers.
// All data lives in recipe files under ./recipes/.

import { VOX_ENEMIES, getArchetype, getMonsterStats } from '../character/VoxCharacterDB';
import type { ProgressionRecipe, FloorZoneConfig, ThemedFloor } from '../recipes/types';
import { RECIPES, DEFAULT_RECIPE } from '../recipes';

// ── Active recipe (module-level singleton) ──────────────────────────

let activeRecipe: ProgressionRecipe = RECIPES[DEFAULT_RECIPE];

/** Get the currently active progression recipe. */
export function getActiveRecipe(): ProgressionRecipe { return activeRecipe; }

/** Get all registered recipe names. */
export function getRecipeNames(): string[] { return Object.keys(RECIPES); }

/** Look up a recipe by name (without activating it). Returns undefined if not found. */
export function getRecipe(name: string): ProgressionRecipe | undefined {
  return RECIPES[name];
}

/** Switch the active progression recipe by name. Returns false if name not found. */
export function setActiveRecipe(name: string): boolean {
  const recipe = RECIPES[name];
  if (!recipe) return false;
  activeRecipe = recipe;
  return true;
}

/** Register a custom recipe at runtime (e.g. from JSON or a test harness). */
export function registerRecipe(name: string, recipe: ProgressionRecipe): void {
  RECIPES[name] = recipe;
}

// ── Re-export types so consumers don't need to know about recipes/ ──

export type { ProgressionRecipe, FloorZoneConfig, ThemedFloor };

// ── Floor Zone Lookup ───────────────────────────────────────────────

/** Get zone config for a given floor using the active recipe. */
export function getFloorConfig(floor: number): FloorZoneConfig {
  const { zones, overshootScaling } = activeRecipe;
  for (const zone of zones) {
    if (floor >= zone.floors[0] && floor <= zone.floors[1]) return zone;
  }
  // Beyond last zone — scale infinitely using overshoot params
  const last = zones[zones.length - 1];
  const overshoot = floor - last.floors[1];
  return {
    ...last,
    hpMult: last.hpMult + overshoot * overshootScaling.hpPerFloor,
    damageMult: last.damageMult + overshoot * overshootScaling.damagePerFloor,
    dungeonSize: (last.dungeonSize ?? 40) + overshoot * (overshootScaling.dungeonSizePerFloor ?? 2),
  };
}

// ── Archetype → VoxCharEntry ID Resolution ──────────────────────────

/** Pre-built map: archetype → VoxCharEntry IDs (e.g. 'blob' → ['blob_a_green', 'blob_b_blue', ...]) */
const archetypeToIds = new Map<string, string[]>();
for (const entry of VOX_ENEMIES) {
  const arch = getArchetype(entry.name);
  let list = archetypeToIds.get(arch);
  if (!list) { list = []; archetypeToIds.set(arch, list); }
  list.push(entry.id);
}

/** Get all VoxCharEntry IDs for a given archetype name. */
export function getEnemyIdsByArchetype(archetype: string): string[] {
  return archetypeToIds.get(archetype) ?? [];
}

// ── Build Weighted Enemy Pool ───────────────────────────────────────

/** Tier labels used in variant-aware monster stats. */
type MonsterTier = 'low' | 'mid' | 'high';

/** Get IDs for an archetype, filtered to only variants matching the given tier.
 *  For monsters without variant stats, all IDs are included. */
function getIdsByArchetypeAndTier(archetype: string, tier: MonsterTier): string[] {
  const allIds = getEnemyIdsByArchetype(archetype);
  // Find the entry name for each ID so we can check variant stats
  const filtered: string[] = [];
  for (const id of allIds) {
    const entry = VOX_ENEMIES.find(e => e.id === id);
    if (!entry) continue;
    const stats = getMonsterStats(entry.name);
    // If stats have a tier field and it doesn't match, skip
    if (stats.tier && stats.tier !== tier) continue;
    filtered.push(id);
  }
  // If filtering removed everything (archetype has no variants with this tier), include all
  return filtered.length > 0 ? filtered : allIds;
}

/** Build a flat list of VoxCharEntry IDs, weighted by tier, for a given floor. */
export function buildFloorEnemyPool(floor: number): string[] {
  const cfg = getFloorConfig(floor);
  const { pool } = cfg;
  const [wLow, wMid, wHigh] = pool.weights;
  const ids: string[] = [];

  function addTier(archetypes: string[], weight: number, tier: MonsterTier) {
    if (weight <= 0 || archetypes.length === 0) return;
    for (const arch of archetypes) {
      const archIds = getIdsByArchetypeAndTier(arch, tier);
      for (const id of archIds) {
        for (let i = 0; i < weight; i++) ids.push(id);
      }
    }
  }

  addTier(pool.low, wLow, 'low');
  addTier(pool.mid, wMid, 'mid');
  addTier(pool.high, wHigh, 'high');

  // Mimics only spawn from chests, never via normal enemy spawning
  return ids.filter(id => !id.startsWith('mimic'));
}

// ── Heightmap Overworld Pool ────────────────────────────────────────

/** Curated early-game pool for heightmap tiles: mostly low-tier with rare mid-tier. */
const HEIGHTMAP_POOL = {
  low:     ['rat', 'bat', 'spider', 'blob', 'goblin'],
  mid:     ['wolf', 'skeleton'],
  weights: [8, 2] as [number, number],
};

export function getHeightmapEnemyPool(): string[] {
  const ids: string[] = [];
  const [wLow, wMid] = HEIGHTMAP_POOL.weights;
  for (const arch of HEIGHTMAP_POOL.low) {
    for (const id of getEnemyIdsByArchetype(arch)) {
      for (let i = 0; i < wLow; i++) ids.push(id);
    }
  }
  for (const arch of HEIGHTMAP_POOL.mid) {
    for (const id of getEnemyIdsByArchetype(arch)) {
      for (let i = 0; i < wMid; i++) ids.push(id);
    }
  }
  return ids;
}

// ── Room-Monster Affinity ───────────────────────────────────────────

/**
 * Build a weighted pool of VoxCharEntry IDs for a specific room on a specific floor.
 * If the room template has affinity matches in the active recipe, those archetypes are boosted.
 */
export function buildRoomEnemyPool(floor: number, roomTemplate: string | undefined): string[] {
  const basePool = buildFloorEnemyPool(floor);
  if (!roomTemplate) return basePool;

  const affinity = activeRecipe.roomAffinity[roomTemplate];
  if (!affinity || affinity.length === 0) return basePool;

  const boost = activeRecipe.roomAffinityBoost;

  // Build set of IDs that match affinity archetypes
  const affinityIds = new Set<string>();
  for (const arch of affinity) {
    for (const id of getEnemyIdsByArchetype(arch)) {
      affinityIds.add(id);
    }
  }

  // Boost matching entries
  const boosted = [...basePool];
  for (const id of basePool) {
    if (affinityIds.has(id)) {
      for (let i = 0; i < boost; i++) boosted.push(id);
    }
  }
  return boosted;
}

// ── Themed Floor Lookup ─────────────────────────────────────────────

/** Get themed floor data from the active recipe, or undefined if this floor has no theme. */
export function getThemedFloor(floor: number): ThemedFloor | undefined {
  return activeRecipe.themedFloors.find(t => t.floor === floor);
}
