// ── VOX Dungeon Tile & Prop Database ──────────────────────────────────
// Registry of dungeon tile pieces (for autotiling) and props (for room decoration).

// ── Tile roles (autotiling) ──

export type TileRole =
  | 'ground'
  | 'outer_wall_segment'
  | 'outer_wall_corner'
  | 'outer_wall_fill'
  | 'inner_wall_segment'
  | 'inner_wall_corner'
  | 'inner_wall_crossing'
  | 'inner_wall_ending'
  | 'inner_wall_solo'
  | 'entrance'
  | 'door';

export interface DungeonTileEntry {
  id: string;
  role: TileRole;
  theme: string;       // 'a_a', 'a_b', etc.
  voxPath: string;     // URL-encoded path to .vox file
  flipped?: boolean;   // whether this is a flipped variant
}

// ── Prop types ──

export type PropPlacement = 'corner' | 'wall' | 'center' | 'anywhere' | 'wall_mount';

export interface DungeonPropEntry {
  id: string;
  category: string;        // e.g. 'barrel', 'torch_ground', 'bookcase', 'pot'
  voxPath: string;
  /** Target height in meters (at tileSize=1). */
  baseHeight: number;
  /** Collision radius (at tileSize=1). */
  radius: number;
  /** Where in the room this prop prefers to go.
   *  'wall_mount' = embedded in wall surface (banners, wall torches), doesn't occupy floor cell. */
  placement: PropPlacement;
  /** For wall_mount props: Y offset from floor (fraction of wall height, e.g. 0.5 = midway up wall) */
  mountHeight?: number;
  /** Scales with dungeon tileSize (architectural feel) */
  scalesWithDungeon?: boolean;
  /** Can be destroyed by the player */
  destroyable?: boolean;
  /** Emits light */
  lightSource?: boolean;
  /** Can be interacted with */
  interactive?: boolean;
  /** Snaps flush against wall, facing same direction as wall normal */
  wallAligned?: boolean;
  /** For chests: path to closed/locked VOX; placement uses this, open uses voxPath */
  voxPathClosed?: string;
}

// ── Paths ──

const BASE = '/models/Square%20Dungeon%20Asset%20Pack/Dungeons/Dungeon%20A/Dungeon%20A-A%20Pieces';
const P = '/models/Square%20Dungeon%20Asset%20Pack/Props';

// ── Dungeon A-A tile entries ──

const THEME = 'a_a';

const A_A_TILES: DungeonTileEntry[] = [
  // Ground tiles (4 decoration variants × 2 sub-variants each)
  { id: 'ground_a_a', role: 'ground', theme: THEME, voxPath: `${BASE}/Ground/VOX/dungeon_a_a_ground_a_a.vox` },
  { id: 'ground_a_b', role: 'ground', theme: THEME, voxPath: `${BASE}/Ground/VOX/dungeon_a_a_ground_a_b.vox` },
  { id: 'ground_b_a', role: 'ground', theme: THEME, voxPath: `${BASE}/Ground/VOX/dungeon_a_a_ground_b_a.vox` },
  { id: 'ground_b_b', role: 'ground', theme: THEME, voxPath: `${BASE}/Ground/VOX/dungeon_a_a_ground_b_b.vox` },
  { id: 'ground_c_a', role: 'ground', theme: THEME, voxPath: `${BASE}/Ground/VOX/dungeon_a_a_ground_c_a.vox` },
  { id: 'ground_c_b', role: 'ground', theme: THEME, voxPath: `${BASE}/Ground/VOX/dungeon_a_a_ground_c_b.vox` },
  { id: 'ground_d_a', role: 'ground', theme: THEME, voxPath: `${BASE}/Ground/VOX/dungeon_a_a_ground_d_a.vox` },
  { id: 'ground_d_b', role: 'ground', theme: THEME, voxPath: `${BASE}/Ground/VOX/dungeon_a_a_ground_d_b.vox` },

  // Outer wall segments (4 decoration variants × normal + flipped)
  { id: 'outer_wall_segment_a', role: 'outer_wall_segment', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_outer_wall_segment_a.vox` },
  { id: 'outer_wall_segment_a_flip', role: 'outer_wall_segment', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_outer_wall_segment_a_flipped.vox`, flipped: true },
  { id: 'outer_wall_segment_b', role: 'outer_wall_segment', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_outer_wall_segment_b.vox` },
  { id: 'outer_wall_segment_b_flip', role: 'outer_wall_segment', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_outer_wall_segment_b_flipped.vox`, flipped: true },
  { id: 'outer_wall_segment_c', role: 'outer_wall_segment', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_outer_wall_segment_c.vox` },
  { id: 'outer_wall_segment_c_flip', role: 'outer_wall_segment', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_outer_wall_segment_c_flipped.vox`, flipped: true },
  { id: 'outer_wall_segment_d', role: 'outer_wall_segment', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_outer_wall_segment_d.vox` },
  { id: 'outer_wall_segment_d_flip', role: 'outer_wall_segment', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_outer_wall_segment_d_flipped.vox`, flipped: true },

  // Outer wall corners (4 decoration variants)
  { id: 'outer_wall_corner_a', role: 'outer_wall_corner', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_outer_wall_corner_a.vox` },
  { id: 'outer_wall_corner_b', role: 'outer_wall_corner', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_outer_wall_corner_b.vox` },
  { id: 'outer_wall_corner_c', role: 'outer_wall_corner', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_outer_wall_corner_c.vox` },
  { id: 'outer_wall_corner_d', role: 'outer_wall_corner', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_outer_wall_corner_d.vox` },

  // Outer wall fill (solid block — all 4 sides are walls)
  { id: 'outer_wall_fill', role: 'outer_wall_fill', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_outer_wall_fill.vox` },

  // Inner wall segments (2 variants + flipped)
  { id: 'inner_wall_segment_a', role: 'inner_wall_segment', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_inner_wall_segment_a.vox` },
  { id: 'inner_wall_segment_b', role: 'inner_wall_segment', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_inner_wall_segment_b.vox` },
  { id: 'inner_wall_segment_b_flip', role: 'inner_wall_segment', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_inner_wall_segment_b_flipped.vox`, flipped: true },

  // Inner wall corners (2 variants)
  { id: 'inner_wall_corner_a', role: 'inner_wall_corner', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_inner_wall_corner_a.vox` },
  { id: 'inner_wall_corner_b', role: 'inner_wall_corner', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_inner_wall_corner_b.vox` },

  // Inner wall crossing (T or + junction)
  { id: 'inner_wall_crossing', role: 'inner_wall_crossing', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_inner_wall_crossing.vox` },

  // Inner wall endings (dead-end cap + flipped)
  { id: 'inner_wall_ending', role: 'inner_wall_ending', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_inner_wall_ending.vox` },
  { id: 'inner_wall_ending_flip', role: 'inner_wall_ending', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_inner_wall_ending_flipped.vox`, flipped: true },

  // Inner wall solo (single isolated wall post)
  { id: 'inner_wall_solo', role: 'inner_wall_solo', theme: THEME, voxPath: `${BASE}/Wall/VOX/dungeon_a_a_inner_wall_solo.vox` },

  // Entrance pieces (wall frame with opening — used at door positions)
  { id: 'entrance_a', role: 'entrance', theme: THEME, voxPath: `${BASE}/Entrance/VOX/dungeon_a_a_entrance_a.vox` },
  { id: 'entrance_b', role: 'entrance', theme: THEME, voxPath: `${BASE}/Entrance/VOX/dungeon_a_a_entrance_b.vox` },
  { id: 'entrance_b_flip', role: 'entrance', theme: THEME, voxPath: `${BASE}/Entrance/VOX/dungeon_a_a_entrance_b_flipped.vox`, flipped: true },
  { id: 'entrance_c', role: 'entrance', theme: THEME, voxPath: `${BASE}/Entrance/VOX/dungeon_a_a_entrance_c.vox` },

  // Door props (wooden door panels — placed inside entrance frames)
  { id: 'door_a_a', role: 'door', theme: THEME, voxPath: `${P}/Door/Door%20A%20(Wood)/VOX/door_a_a.vox` },
  { id: 'door_a_b', role: 'door', theme: THEME, voxPath: `${P}/Door/Door%20A%20(Wood)/VOX/door_a_b.vox` },
  { id: 'door_a_c', role: 'door', theme: THEME, voxPath: `${P}/Door/Door%20A%20(Wood)/VOX/door_a_c.vox` },
];

// ── Dungeon prop entries ──

const ALL_PROPS: DungeonPropEntry[] = [
  // ── Light sources ──

  // Ground torches (Dungeon A)
  { id: 'ground_torch_a_lit',  category: 'torch_ground', voxPath: `${P}/Torch/Ground%20Torch%20A%20(Dungeon%20A)/VOX/ground_torch_a_a_lit.vox`,  baseHeight: 0.45, radius: 0.1, placement: 'corner', lightSource: true },
  { id: 'ground_torch_b_lit',  category: 'torch_ground', voxPath: `${P}/Torch/Ground%20Torch%20A%20(Dungeon%20A)/VOX/ground_torch_a_b_lit.vox`,  baseHeight: 0.45, radius: 0.1, placement: 'corner', lightSource: true },

  // Wall torches — mounted on wall surface
  { id: 'wall_torch_a', category: 'torch_wall', voxPath: `${P}/Torch/Wall%20Torch%20A%20(Wood)/VOX/wall_torch_a_a.vox`, baseHeight: 0.4, radius: 0.1, placement: 'wall_mount', mountHeight: 0.495, lightSource: true, scalesWithDungeon: true, wallAligned: true },
  { id: 'wall_torch_b', category: 'torch_wall', voxPath: `${P}/Torch/Wall%20Torch%20A%20(Wood)/VOX/wall_torch_a_b.vox`, baseHeight: 0.4, radius: 0.1, placement: 'wall_mount', mountHeight: 0.495, lightSource: true, scalesWithDungeon: true, wallAligned: true },

  // Large candelabrum
  { id: 'candelabrum_large_a', category: 'candelabrum', voxPath: `${P}/Candelabrum/Large%20Candelabrum%20A%20(Metal)/VOX/large_candelabrum_a.vox`, baseHeight: 0.55, radius: 0.1, placement: 'corner', lightSource: true },
  { id: 'candelabrum_large_b', category: 'candelabrum', voxPath: `${P}/Candelabrum/Large%20Candelabrum%20C%20(Gold)/VOX/large_candelabrum_c.vox`,  baseHeight: 0.55, radius: 0.1, placement: 'corner', lightSource: true },

  // Small candelabrum (table-top)
  { id: 'candelabrum_small_a', category: 'candelabrum_small', voxPath: `${P}/Candelabrum/Small%20Candelabrum%20A%20(Metal)/VOX/small_candelabrum_a.vox`, baseHeight: 0.25, radius: 0.08, placement: 'center', lightSource: true },

  // ── Destroyable ──

  // Barrels
  { id: 'barrel_a', category: 'barrel', voxPath: `${P}/Barrel/Barrel%20A%20(Wood)/VOX/barrel_a_closed.vox`,     baseHeight: 0.22, radius: 0.1, placement: 'wall', destroyable: true },
  { id: 'barrel_b', category: 'barrel', voxPath: `${P}/Barrel/Barrel%20B%20(Dark%20Wood)/VOX/barrel_b_closed.vox`, baseHeight: 0.22, radius: 0.1, placement: 'wall', destroyable: true },
  { id: 'barrel_tnt', category: 'barrel', voxPath: `${P}/Barrel/TNT%20Barrel/VOX/tnt_barrel_closed.vox`,        baseHeight: 0.22, radius: 0.1, placement: 'wall', destroyable: true },

  // Boxes / crates
  { id: 'box_a', category: 'box', voxPath: `${P}/Box/Box%20A%20(Wood)/VOX/box_a_a.vox`,           baseHeight: 0.18, radius: 0.1, placement: 'wall', destroyable: true },
  { id: 'box_b', category: 'box', voxPath: `${P}/Box/Box%20B%20(Dark%20Wood)/VOX/box_b_a.vox`,     baseHeight: 0.18, radius: 0.1, placement: 'wall', destroyable: true },
  { id: 'box_c', category: 'box', voxPath: `${P}/Box/Box%20C%20(Darkest%20Wood)/VOX/box_c_a.vox`, baseHeight: 0.18, radius: 0.1, placement: 'wall', destroyable: true },

  // Pots
  { id: 'pot_a', category: 'pot', voxPath: `${P}/Pot/Pot%20A%20(Clay)/VOX/pot_a.vox`,       baseHeight: 0.16, radius: 0.06, placement: 'wall', destroyable: true },
  { id: 'pot_b', category: 'pot', voxPath: `${P}/Pot/Pot%20B%20(Dark%20Clay)/VOX/pot_b.vox`, baseHeight: 0.16, radius: 0.06, placement: 'wall', destroyable: true },
  { id: 'pot_d', category: 'pot', voxPath: `${P}/Pot/Pot%20D%20(Metal)/VOX/pot_d.vox`,       baseHeight: 0.16, radius: 0.06, placement: 'wall', destroyable: true },

  // ── Scales with dungeon (architectural) ──

  // Altars
  { id: 'altar_a', category: 'altar', voxPath: `${P}/Altar/Altar%20A%20(Dungeon%20A)/VOX/altar_a_a.vox`, baseHeight: 0.6, radius: 0.3, placement: 'center', scalesWithDungeon: true, interactive: true },
  { id: 'altar_b', category: 'altar', voxPath: `${P}/Altar/Altar%20A%20(Dungeon%20A)/VOX/altar_a_b.vox`, baseHeight: 0.6, radius: 0.3, placement: 'center', scalesWithDungeon: true, interactive: true },

  // Banners
  { id: 'banner_red',    category: 'banner', voxPath: `${P}/Banner/Banner%20A%20(U-Shaped)/VOX/banner_a_red.vox`,    baseHeight: 0.8, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },
  { id: 'banner_blue',   category: 'banner', voxPath: `${P}/Banner/Banner%20A%20(U-Shaped)/VOX/banner_a_blue.vox`,   baseHeight: 0.8, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },
  { id: 'banner_green',  category: 'banner', voxPath: `${P}/Banner/Banner%20A%20(U-Shaped)/VOX/banner_a_green.vox`,  baseHeight: 0.8, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },
  { id: 'banner_yellow', category: 'banner', voxPath: `${P}/Banner/Banner%20A%20(U-Shaped)/VOX/banner_a_yellow.vox`, baseHeight: 0.8, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },

  // Large bookcases
  { id: 'bookcase_large_a', category: 'bookcase_large', voxPath: `${P}/Bookcase/Large%20Bookcase%20A%20(Wood)/VOX/large_bookcase_a.vox`, baseHeight: 0.9, radius: 0.3, placement: 'wall', scalesWithDungeon: true, wallAligned: true },

  // Small bookcases
  { id: 'bookcase_small_a', category: 'bookcase_small', voxPath: `${P}/Bookcase/Small%20Bookcase%20A%20(Wood)/VOX/small_bookcase_a.vox`, baseHeight: 0.6, radius: 0.25, placement: 'wall', scalesWithDungeon: true, wallAligned: true },

  // Tombs
  { id: 'tomb_a', category: 'tomb', voxPath: `${P}/Tomb/Tomb%20A%20(Dungeon%20A)/VOX/tomb_a_a.vox`, baseHeight: 0.3, radius: 0.2, placement: 'center', scalesWithDungeon: true },
  { id: 'tomb_b', category: 'tomb', voxPath: `${P}/Tomb/Tomb%20A%20(Dungeon%20A)/VOX/tomb_a_b.vox`, baseHeight: 0.3, radius: 0.2, placement: 'center', scalesWithDungeon: true },

  // Gates
  { id: 'gate_a', category: 'gate', voxPath: `${P}/Gate/Gate%20A%20(Metal)/VOX/gate_a.vox`, baseHeight: 1.0, radius: 0.3, placement: 'wall', scalesWithDungeon: true, interactive: true },

  // Traps — spike
  { id: 'spike_a', category: 'trap_spike', voxPath: `${P}/Trap/Spike/Spike%20A%20(Metal)/VOX/spike_a_a.vox`, baseHeight: 0.15, radius: 0.3, placement: 'center', scalesWithDungeon: true, interactive: true },
  { id: 'spike_b', category: 'trap_spike', voxPath: `${P}/Trap/Spike/Spike%20A%20(Metal)/VOX/spike_a_b.vox`, baseHeight: 0.15, radius: 0.3, placement: 'center', scalesWithDungeon: true, interactive: true },

  // Wall grates
  { id: 'wall_grate_a', category: 'wall_grate', voxPath: `${P}/Wall%20Grate/Wall%20Grate%20A%20(Metal)/VOX/wall_grate_a.vox`, baseHeight: 0.6, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },

  // ── Regular furniture (fixed scale) ──

  // Small tables
  { id: 'table_small_a', category: 'table_small', voxPath: `${P}/Table/Small%20Table%20A%20(Wood)/VOX/small_table_a.vox`, baseHeight: 0.2, radius: 0.15, placement: 'center' },

  // Large tables
  { id: 'table_large_a', category: 'table_large', voxPath: `${P}/Table/Large%20Table%20A%20(Wood)/VOX/large_table_a.vox`, baseHeight: 0.22, radius: 0.2, placement: 'center' },

  // Chairs
  { id: 'chair_a', category: 'chair', voxPath: `${P}/Chair/Chair%20A%20(Wood)/VOX/chair_a.vox`, baseHeight: 0.2, radius: 0.08, placement: 'center' },

  // Small benches
  { id: 'bench_small_a', category: 'bench', voxPath: `${P}/Bench/Small%20Bench%20A%20(Wood)/VOX/small_bench_a.vox`, baseHeight: 0.16, radius: 0.1, placement: 'wall' },

  // Treasure chests: closed for placement, open (voxPath) when interacted; fixed scale, face into room
  { id: 'chest_a', category: 'chest', voxPath: `${P}/Treasure%20Chests/Treasure%20Chest%20A%20(Wood)/VOX/treasure_chest_a_unlocked.vox`, voxPathClosed: `${P}/Treasure%20Chests/Treasure%20Chest%20A%20(Wood)/VOX/treasure_chest_a_locked.vox`, baseHeight: 0.3, radius: 0.18, placement: 'wall', wallAligned: true, interactive: true },
  { id: 'chest_d', category: 'chest', voxPath: `${P}/Treasure%20Chests/Treasure%20Chest%20D%20(Gold)/VOX/treasure_chest_d_unlocked.vox`, voxPathClosed: `${P}/Treasure%20Chests/Treasure%20Chest%20D%20(Gold)/VOX/treasure_chest_d_locked.vox`, baseHeight: 0.3, radius: 0.18, placement: 'wall', wallAligned: true, interactive: true },

  // Books (tiny, table-top decoration)
  { id: 'book_a', category: 'book', voxPath: `${P}/Book/Book%20A%20(Red)/VOX/book_a.vox`,     baseHeight: 0.1, radius: 0.05, placement: 'anywhere' },
  { id: 'book_b', category: 'book', voxPath: `${P}/Book/Book%20B%20(Green)/VOX/book_b.vox`,   baseHeight: 0.1, radius: 0.05, placement: 'anywhere' },
  { id: 'book_c', category: 'book', voxPath: `${P}/Book/Book%20C%20(Blue)/VOX/book_c.vox`,    baseHeight: 0.1, radius: 0.05, placement: 'anywhere' },

  // Mugs (tiny)
  { id: 'mug_a', category: 'mug', voxPath: `${P}/Mug/Mug%20A%20(Wood)/VOX/mug_a.vox`, baseHeight: 0.08, radius: 0.04, placement: 'anywhere' },

  // Bottles
  { id: 'bottle_a', category: 'bottle', voxPath: `${P}/Bottle/Bottle%20A%20(Red)/VOX/bottle_a.vox`,     baseHeight: 0.12, radius: 0.04, placement: 'anywhere' },
  { id: 'bottle_b', category: 'bottle', voxPath: `${P}/Bottle/Bottle%20B%20(Green)/VOX/bottle_b.vox`,   baseHeight: 0.12, radius: 0.04, placement: 'anywhere' },

  // Potions
  { id: 'potion_a', category: 'potion', voxPath: `${P}/Potion/Potion%20A%20(Red)/VOX/potion_a.vox`,     baseHeight: 0.1, radius: 0.04, placement: 'anywhere' },
  { id: 'potion_b', category: 'potion', voxPath: `${P}/Potion/Potion%20B%20(Green)/VOX/potion_b.vox`,   baseHeight: 0.1, radius: 0.04, placement: 'anywhere' },
  { id: 'potion_c', category: 'potion', voxPath: `${P}/Potion/Potion%20C%20(Blue)/VOX/potion_c.vox`,    baseHeight: 0.1, radius: 0.04, placement: 'anywhere' },

  // Signpost
  { id: 'signpost_a', category: 'signpost', voxPath: `${P}/Signpost/Signpost%20A%20(Wood)/VOX/signpost_a.vox`, baseHeight: 0.4, radius: 0.08, placement: 'anywhere' },
];

// ── Tile grouped registry ──

const TILE_MAP = new Map<string, DungeonTileEntry[]>();
for (const entry of A_A_TILES) {
  const key = `${entry.theme}:${entry.role}`;
  if (!TILE_MAP.has(key)) TILE_MAP.set(key, []);
  TILE_MAP.get(key)!.push(entry);
}

// ── Prop grouped registry ──

const PROP_BY_CATEGORY = new Map<string, DungeonPropEntry[]>();
for (const entry of ALL_PROPS) {
  if (!PROP_BY_CATEGORY.has(entry.category)) PROP_BY_CATEGORY.set(entry.category, []);
  PROP_BY_CATEGORY.get(entry.category)!.push(entry);
}

// ── Tile queries ──

/** Get all tile entries for a given role in a theme */
export function getDungeonTiles(role: TileRole, theme = 'a_a'): DungeonTileEntry[] {
  return TILE_MAP.get(`${theme}:${role}`) || [];
}

/** Get all unique vox paths for a theme (for preloading) */
export function getAllThemePaths(theme = 'a_a'): string[] {
  return A_A_TILES.filter(e => e.theme === theme).map(e => e.voxPath);
}

/** Pick a random tile entry for a role */
export function getRandomTile(role: TileRole, theme = 'a_a'): DungeonTileEntry | null {
  const tiles = getDungeonTiles(role, theme);
  if (tiles.length === 0) return null;
  return tiles[Math.floor(Math.random() * tiles.length)];
}

/** Get a specific tile by id */
export function getTileById(id: string): DungeonTileEntry | null {
  return A_A_TILES.find(e => e.id === id) ?? null;
}

/** Get the first tile for a role (use as the "default" / plain variant) */
export function getFirstTile(role: TileRole, theme = 'a_a'): DungeonTileEntry | null {
  const tiles = getDungeonTiles(role, theme);
  return tiles.length > 0 ? tiles[0] : null;
}

// ── Prop queries ──

/** Get all prop entries for a category */
export function getPropsForCategory(category: string): DungeonPropEntry[] {
  return PROP_BY_CATEGORY.get(category) || [];
}

/** Get a random prop from a category */
export function getRandomProp(category: string): DungeonPropEntry | null {
  const props = getPropsForCategory(category);
  if (props.length === 0) return null;
  return props[Math.floor(Math.random() * props.length)];
}

/** Get a specific prop by id */
export function getPropById(id: string): DungeonPropEntry | null {
  return ALL_PROPS.find(e => e.id === id) ?? null;
}

/** Get all unique prop vox paths (for preloading) */
export function getAllPropPaths(): string[] {
  return ALL_PROPS.map(e => e.voxPath);
}

/** Get all prop categories */
/** Get all ground tile IDs for a theme */
export function getGroundTileIds(theme = 'a_a'): string[] {
  return getDungeonTiles('ground', theme).map(t => t.id);
}

export function getPropCategories(): string[] {
  return [...PROP_BY_CATEGORY.keys()];
}

/** Get all props matching a filter */
export function getPropsWhere(filter: {
  destroyable?: boolean;
  lightSource?: boolean;
  scalesWithDungeon?: boolean;
  interactive?: boolean;
  placement?: PropPlacement;
}): DungeonPropEntry[] {
  return ALL_PROPS.filter(p => {
    if (filter.destroyable !== undefined && !!p.destroyable !== filter.destroyable) return false;
    if (filter.lightSource !== undefined && !!p.lightSource !== filter.lightSource) return false;
    if (filter.scalesWithDungeon !== undefined && !!p.scalesWithDungeon !== filter.scalesWithDungeon) return false;
    if (filter.interactive !== undefined && !!p.interactive !== filter.interactive) return false;
    if (filter.placement !== undefined && p.placement !== filter.placement) return false;
    return true;
  });
}
