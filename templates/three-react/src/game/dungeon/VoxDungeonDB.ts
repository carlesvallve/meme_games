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
  | 'door'
  | 'gate';

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

const DUNGEON_ROOT = '/models/Square%20Dungeon%20Asset%20Pack/Dungeons';
const P = '/models/Square%20Dungeon%20Asset%20Pack/Props';

// ── All 8 dungeon variants: {major}_{minor} ──

export const DUNGEON_VARIANTS = [
  'a_a', 'a_b', 'b_a', 'b_b', 'c_a', 'c_b', 'd_a', 'd_b',
] as const;

export type DungeonVariant = typeof DUNGEON_VARIANTS[number];

/** Return the full list of variant keys */
export function getDungeonVariants(): readonly string[] {
  return DUNGEON_VARIANTS;
}

/** Build the URL-encoded base path for a theme, e.g. 'b_a' → '.../Dungeon B/Dungeon B-A Pieces' */
function buildBasePath(theme: string): string {
  const [major, minor] = theme.split('_');
  const M = major.toUpperCase();
  const m = minor.toUpperCase();
  return `${DUNGEON_ROOT}/Dungeon%20${M}/Dungeon%20${M}-${m}%20Pieces`;
}

/** Generate all tile entries for a single theme variant */
function buildThemeTiles(theme: string): DungeonTileEntry[] {
  const BASE = buildBasePath(theme);
  const prefix = theme; // e.g. 'a_a', used in file names like dungeon_a_a_ground_a_a.vox
  const tiles: DungeonTileEntry[] = [];

  // Ground tiles (4 decoration variants × 2 sub-variants each)
  for (const deco of ['a', 'b', 'c', 'd']) {
    for (const sub of ['a', 'b']) {
      tiles.push({ id: `${theme}:ground_${deco}_${sub}`, role: 'ground', theme, voxPath: `${BASE}/Ground/VOX/dungeon_${prefix}_ground_${deco}_${sub}.vox` });
    }
  }

  // Outer wall segments (4 decoration variants × normal + flipped)
  for (const deco of ['a', 'b', 'c', 'd']) {
    tiles.push({ id: `${theme}:outer_wall_segment_${deco}`, role: 'outer_wall_segment', theme, voxPath: `${BASE}/Wall/VOX/dungeon_${prefix}_outer_wall_segment_${deco}.vox` });
    tiles.push({ id: `${theme}:outer_wall_segment_${deco}_flip`, role: 'outer_wall_segment', theme, voxPath: `${BASE}/Wall/VOX/dungeon_${prefix}_outer_wall_segment_${deco}_flipped.vox`, flipped: true });
  }

  // Outer wall corners (4 decoration variants)
  for (const deco of ['a', 'b', 'c', 'd']) {
    tiles.push({ id: `${theme}:outer_wall_corner_${deco}`, role: 'outer_wall_corner', theme, voxPath: `${BASE}/Wall/VOX/dungeon_${prefix}_outer_wall_corner_${deco}.vox` });
  }

  // Outer wall fill (solid block)
  tiles.push({ id: `${theme}:outer_wall_fill`, role: 'outer_wall_fill', theme, voxPath: `${BASE}/Wall/VOX/dungeon_${prefix}_outer_wall_fill.vox` });

  // Inner wall segments (2 variants + flipped)
  tiles.push({ id: `${theme}:inner_wall_segment_a`, role: 'inner_wall_segment', theme, voxPath: `${BASE}/Wall/VOX/dungeon_${prefix}_inner_wall_segment_a.vox` });
  tiles.push({ id: `${theme}:inner_wall_segment_b`, role: 'inner_wall_segment', theme, voxPath: `${BASE}/Wall/VOX/dungeon_${prefix}_inner_wall_segment_b.vox` });
  tiles.push({ id: `${theme}:inner_wall_segment_b_flip`, role: 'inner_wall_segment', theme, voxPath: `${BASE}/Wall/VOX/dungeon_${prefix}_inner_wall_segment_b_flipped.vox`, flipped: true });

  // Inner wall corners (2 variants)
  tiles.push({ id: `${theme}:inner_wall_corner_a`, role: 'inner_wall_corner', theme, voxPath: `${BASE}/Wall/VOX/dungeon_${prefix}_inner_wall_corner_a.vox` });
  tiles.push({ id: `${theme}:inner_wall_corner_b`, role: 'inner_wall_corner', theme, voxPath: `${BASE}/Wall/VOX/dungeon_${prefix}_inner_wall_corner_b.vox` });

  // Inner wall crossing (T or + junction)
  tiles.push({ id: `${theme}:inner_wall_crossing`, role: 'inner_wall_crossing', theme, voxPath: `${BASE}/Wall/VOX/dungeon_${prefix}_inner_wall_crossing.vox` });

  // Inner wall endings (dead-end cap + flipped)
  tiles.push({ id: `${theme}:inner_wall_ending`, role: 'inner_wall_ending', theme, voxPath: `${BASE}/Wall/VOX/dungeon_${prefix}_inner_wall_ending.vox` });
  tiles.push({ id: `${theme}:inner_wall_ending_flip`, role: 'inner_wall_ending', theme, voxPath: `${BASE}/Wall/VOX/dungeon_${prefix}_inner_wall_ending_flipped.vox`, flipped: true });

  // Inner wall solo (single isolated wall post)
  tiles.push({ id: `${theme}:inner_wall_solo`, role: 'inner_wall_solo', theme, voxPath: `${BASE}/Wall/VOX/dungeon_${prefix}_inner_wall_solo.vox` });

  // Entrance pieces
  tiles.push({ id: `${theme}:entrance_a`, role: 'entrance', theme, voxPath: `${BASE}/Entrance/VOX/dungeon_${prefix}_entrance_a.vox` });
  tiles.push({ id: `${theme}:entrance_b`, role: 'entrance', theme, voxPath: `${BASE}/Entrance/VOX/dungeon_${prefix}_entrance_b.vox` });
  tiles.push({ id: `${theme}:entrance_b_flip`, role: 'entrance', theme, voxPath: `${BASE}/Entrance/VOX/dungeon_${prefix}_entrance_b_flipped.vox`, flipped: true });
  tiles.push({ id: `${theme}:entrance_c`, role: 'entrance', theme, voxPath: `${BASE}/Entrance/VOX/dungeon_${prefix}_entrance_c.vox` });

  // Door props (shared across themes)
  // Door A (Wood)
  tiles.push({ id: `${theme}:door_a_a`, role: 'door', theme, voxPath: `${P}/Door/Door%20A%20(Wood)/VOX/door_a_a.vox` });
  tiles.push({ id: `${theme}:door_a_b`, role: 'door', theme, voxPath: `${P}/Door/Door%20A%20(Wood)/VOX/door_a_b.vox` });
  tiles.push({ id: `${theme}:door_a_c`, role: 'door', theme, voxPath: `${P}/Door/Door%20A%20(Wood)/VOX/door_a_c.vox` });
  // Door B (Dark Wood)
  tiles.push({ id: `${theme}:door_b_a`, role: 'door', theme, voxPath: `${P}/Door/Door%20B%20(Dark%20Wood)/VOX/door_b_a.vox` });
  tiles.push({ id: `${theme}:door_b_b`, role: 'door', theme, voxPath: `${P}/Door/Door%20B%20(Dark%20Wood)/VOX/door_b_b.vox` });
  tiles.push({ id: `${theme}:door_b_c`, role: 'door', theme, voxPath: `${P}/Door/Door%20B%20(Dark%20Wood)/VOX/door_b_c.vox` });
  // Door C (Darkest Wood)
  tiles.push({ id: `${theme}:door_c_a`, role: 'door', theme, voxPath: `${P}/Door/Door%20C%20(Darkest%20Wood)/VOX/door_c_a.vox` });
  tiles.push({ id: `${theme}:door_c_b`, role: 'door', theme, voxPath: `${P}/Door/Door%20C%20(Darkest%20Wood)/VOX/door_c_b.vox` });
  tiles.push({ id: `${theme}:door_c_c`, role: 'door', theme, voxPath: `${P}/Door/Door%20C%20(Darkest%20Wood)/VOX/door_c_c.vox` });
  // Gate A (Metal)
  tiles.push({ id: `${theme}:gate_a`, role: 'gate', theme, voxPath: `${P}/Gate/Gate%20A%20(Metal)/VOX/gate_a.vox` });
  // Gate B (Dark Metal)
  tiles.push({ id: `${theme}:gate_b`, role: 'gate', theme, voxPath: `${P}/Gate/Gate%20B%20(Dark%20Metal)/VOX/gate_b.vox` });

  return tiles;
}

// ── Build all tiles for every variant ──

const ALL_TILES: DungeonTileEntry[] = DUNGEON_VARIANTS.flatMap(v => buildThemeTiles(v));

// ── Dungeon prop entries ──

const ALL_PROPS: DungeonPropEntry[] = [
  // ── Light sources ──

  // Ground torches
  { id: 'ground_torch_a_a_lit', category: 'torch_ground', voxPath: `${P}/Torch/Ground%20Torch%20A%20(Dungeon%20A)/VOX/ground_torch_a_a_lit.vox`, baseHeight: 0.45, radius: 0.1, placement: 'corner', lightSource: true },
  { id: 'ground_torch_a_b_lit', category: 'torch_ground', voxPath: `${P}/Torch/Ground%20Torch%20A%20(Dungeon%20A)/VOX/ground_torch_a_b_lit.vox`, baseHeight: 0.45, radius: 0.1, placement: 'corner', lightSource: true },
  { id: 'ground_torch_b_a_lit', category: 'torch_ground', voxPath: `${P}/Torch/Ground%20Torch%20B%20(Dungeon%20B)/VOX/ground_torch_b_a_lit.vox`, baseHeight: 0.45, radius: 0.1, placement: 'corner', lightSource: true },
  { id: 'ground_torch_b_b_lit', category: 'torch_ground', voxPath: `${P}/Torch/Ground%20Torch%20B%20(Dungeon%20B)/VOX/ground_torch_b_b_lit.vox`, baseHeight: 0.45, radius: 0.1, placement: 'corner', lightSource: true },
  { id: 'ground_torch_c_a_lit', category: 'torch_ground', voxPath: `${P}/Torch/Ground%20Torch%20C%20(Dungeon%20C)/VOX/ground_torch_c_a_lit.vox`, baseHeight: 0.45, radius: 0.1, placement: 'corner', lightSource: true },
  { id: 'ground_torch_c_b_lit', category: 'torch_ground', voxPath: `${P}/Torch/Ground%20Torch%20C%20(Dungeon%20C)/VOX/ground_torch_c_b_lit.vox`, baseHeight: 0.45, radius: 0.1, placement: 'corner', lightSource: true },
  { id: 'ground_torch_d_a_lit', category: 'torch_ground', voxPath: `${P}/Torch/Ground%20Torch%20D%20(Dungeon%20D)/VOX/ground_torch_d_a_lit.vox`, baseHeight: 0.45, radius: 0.1, placement: 'corner', lightSource: true },
  { id: 'ground_torch_d_b_lit', category: 'torch_ground', voxPath: `${P}/Torch/Ground%20Torch%20D%20(Dungeon%20D)/VOX/ground_torch_d_b_lit.vox`, baseHeight: 0.45, radius: 0.1, placement: 'corner', lightSource: true },

  // Wall torches
  { id: 'wall_torch_a_a', category: 'torch_wall', voxPath: `${P}/Torch/Wall%20Torch%20A%20(Wood)/VOX/wall_torch_a_a.vox`,             baseHeight: 0.4, radius: 0.1, placement: 'wall_mount', mountHeight: 0.495, lightSource: true, scalesWithDungeon: true, wallAligned: true },
  { id: 'wall_torch_a_b', category: 'torch_wall', voxPath: `${P}/Torch/Wall%20Torch%20A%20(Wood)/VOX/wall_torch_a_b.vox`,             baseHeight: 0.4, radius: 0.1, placement: 'wall_mount', mountHeight: 0.495, lightSource: true, scalesWithDungeon: true, wallAligned: true },
  { id: 'wall_torch_a_c', category: 'torch_wall', voxPath: `${P}/Torch/Wall%20Torch%20A%20(Wood)/VOX/wall_torch_a_c.vox`,             baseHeight: 0.4, radius: 0.1, placement: 'wall_mount', mountHeight: 0.495, lightSource: true, scalesWithDungeon: true, wallAligned: true },
  { id: 'wall_torch_a_d', category: 'torch_wall', voxPath: `${P}/Torch/Wall%20Torch%20A%20(Wood)/VOX/wall_torch_a_d.vox`,             baseHeight: 0.4, radius: 0.1, placement: 'wall_mount', mountHeight: 0.495, lightSource: true, scalesWithDungeon: true, wallAligned: true },
  { id: 'wall_torch_b_a', category: 'torch_wall', voxPath: `${P}/Torch/Wall%20Torch%20B%20(Dark%20Wood)/VOX/wall_torch_b_a.vox`,      baseHeight: 0.4, radius: 0.1, placement: 'wall_mount', mountHeight: 0.495, lightSource: true, scalesWithDungeon: true, wallAligned: true },
  { id: 'wall_torch_b_b', category: 'torch_wall', voxPath: `${P}/Torch/Wall%20Torch%20B%20(Dark%20Wood)/VOX/wall_torch_b_b.vox`,      baseHeight: 0.4, radius: 0.1, placement: 'wall_mount', mountHeight: 0.495, lightSource: true, scalesWithDungeon: true, wallAligned: true },
  { id: 'wall_torch_b_c', category: 'torch_wall', voxPath: `${P}/Torch/Wall%20Torch%20B%20(Dark%20Wood)/VOX/wall_torch_b_c.vox`,      baseHeight: 0.4, radius: 0.1, placement: 'wall_mount', mountHeight: 0.495, lightSource: true, scalesWithDungeon: true, wallAligned: true },
  { id: 'wall_torch_b_d', category: 'torch_wall', voxPath: `${P}/Torch/Wall%20Torch%20B%20(Dark%20Wood)/VOX/wall_torch_b_d.vox`,      baseHeight: 0.4, radius: 0.1, placement: 'wall_mount', mountHeight: 0.495, lightSource: true, scalesWithDungeon: true, wallAligned: true },
  { id: 'wall_torch_c_a', category: 'torch_wall', voxPath: `${P}/Torch/Wall%20Torch%20C%20(Darkest%20Wood)/VOX/wall_torch_c_a.vox`,   baseHeight: 0.4, radius: 0.1, placement: 'wall_mount', mountHeight: 0.495, lightSource: true, scalesWithDungeon: true, wallAligned: true },
  { id: 'wall_torch_c_b', category: 'torch_wall', voxPath: `${P}/Torch/Wall%20Torch%20C%20(Darkest%20Wood)/VOX/wall_torch_c_b.vox`,   baseHeight: 0.4, radius: 0.1, placement: 'wall_mount', mountHeight: 0.495, lightSource: true, scalesWithDungeon: true, wallAligned: true },
  { id: 'wall_torch_c_c', category: 'torch_wall', voxPath: `${P}/Torch/Wall%20Torch%20C%20(Darkest%20Wood)/VOX/wall_torch_c_c.vox`,   baseHeight: 0.4, radius: 0.1, placement: 'wall_mount', mountHeight: 0.495, lightSource: true, scalesWithDungeon: true, wallAligned: true },
  { id: 'wall_torch_c_d', category: 'torch_wall', voxPath: `${P}/Torch/Wall%20Torch%20C%20(Darkest%20Wood)/VOX/wall_torch_c_d.vox`,   baseHeight: 0.4, radius: 0.1, placement: 'wall_mount', mountHeight: 0.495, lightSource: true, scalesWithDungeon: true, wallAligned: true },

  // Large candelabrum
  { id: 'candelabrum_large_a', category: 'candelabrum', voxPath: `${P}/Candelabrum/Large%20Candelabrum%20A%20(Metal)/VOX/large_candelabrum_a.vox`,      baseHeight: 0.55, radius: 0.1, placement: 'corner', lightSource: true },
  { id: 'candelabrum_large_b', category: 'candelabrum', voxPath: `${P}/Candelabrum/Large%20Candelabrum%20B%20(Dark%20Metal)/VOX/large_candelabrum_b.vox`, baseHeight: 0.55, radius: 0.1, placement: 'corner', lightSource: true },
  { id: 'candelabrum_large_c', category: 'candelabrum', voxPath: `${P}/Candelabrum/Large%20Candelabrum%20C%20(Gold)/VOX/large_candelabrum_c.vox`,        baseHeight: 0.55, radius: 0.1, placement: 'corner', lightSource: true },

  // Small candelabrum
  { id: 'candelabrum_small_a', category: 'candelabrum_small', voxPath: `${P}/Candelabrum/Small%20Candelabrum%20A%20(Metal)/VOX/small_candelabrum_a.vox`,      baseHeight: 0.25, radius: 0.08, placement: 'center', lightSource: true },
  { id: 'candelabrum_small_b', category: 'candelabrum_small', voxPath: `${P}/Candelabrum/Small%20Candelabrum%20B%20(Dark%20Metal)/VOX/small_candelabrum_b.vox`, baseHeight: 0.25, radius: 0.08, placement: 'center', lightSource: true },
  { id: 'candelabrum_small_c', category: 'candelabrum_small', voxPath: `${P}/Candelabrum/Small%20Candelabrum%20C%20(Gold)/VOX/small_candelabrum_c.vox`,        baseHeight: 0.25, radius: 0.08, placement: 'center', lightSource: true },

  // ── Destroyable ──

  // Barrels
  { id: 'barrel_a',   category: 'barrel', voxPath: `${P}/Barrel/Barrel%20A%20(Wood)/VOX/barrel_a_closed.vox`,             baseHeight: 0.22, radius: 0.16, placement: 'wall', destroyable: true},
  { id: 'barrel_b',   category: 'barrel', voxPath: `${P}/Barrel/Barrel%20B%20(Dark%20Wood)/VOX/barrel_b_closed.vox`,       baseHeight: 0.22, radius: 0.16, placement: 'wall', destroyable: true},
  { id: 'barrel_c',   category: 'barrel', voxPath: `${P}/Barrel/Barrel%20C%20(Darkest%20Wood)/VOX/barrel_c_closed.vox`,   baseHeight: 0.22, radius: 0.16, placement: 'wall', destroyable: true},
  { id: 'barrel_tnt', category: 'barrel', voxPath: `${P}/Barrel/TNT%20Barrel/VOX/tnt_barrel.vox`,                          baseHeight: 0.22, radius: 0.16, placement: 'wall', destroyable: true},
  { id: 'beer_barrel_a', category: 'barrel', voxPath: `${P}/Barrel/Beer%20Barrel%20A%20(Wood)/VOX/beer_barrel_a.vox`,          baseHeight: 0.22, radius: 0.16, placement: 'wall', destroyable: true},
  { id: 'beer_barrel_b', category: 'barrel', voxPath: `${P}/Barrel/Beer%20Barrel%20B%20(Dark%20Wood)/VOX/beer_barrel_b.vox`,    baseHeight: 0.22, radius: 0.16, placement: 'wall', destroyable: true},
  { id: 'beer_barrel_c', category: 'barrel', voxPath: `${P}/Barrel/Beer%20Barrel%20C%20(Darkest%20Wood)/VOX/beer_barrel_c.vox`, baseHeight: 0.22, radius: 0.16, placement: 'wall', destroyable: true},

  // Boxes / crates
  { id: 'box_a_a', category: 'box', voxPath: `${P}/Box/Box%20A%20(Wood)/VOX/box_a_a.vox`,             baseHeight: 0.18, radius: 0.14, placement: 'wall', destroyable: true},
  { id: 'box_a_b', category: 'box', voxPath: `${P}/Box/Box%20A%20(Wood)/VOX/box_a_b.vox`,             baseHeight: 0.18, radius: 0.14, placement: 'wall', destroyable: true},
  { id: 'box_b_a', category: 'box', voxPath: `${P}/Box/Box%20B%20(Dark%20Wood)/VOX/box_b_a.vox`,       baseHeight: 0.18, radius: 0.14, placement: 'wall', destroyable: true},
  { id: 'box_b_b', category: 'box', voxPath: `${P}/Box/Box%20B%20(Dark%20Wood)/VOX/box_b_b.vox`,       baseHeight: 0.18, radius: 0.14, placement: 'wall', destroyable: true},
  { id: 'box_c_a', category: 'box', voxPath: `${P}/Box/Box%20C%20(Darkest%20Wood)/VOX/box_c_a.vox`,   baseHeight: 0.18, radius: 0.14, placement: 'wall', destroyable: true},
  { id: 'box_c_b', category: 'box', voxPath: `${P}/Box/Box%20C%20(Darkest%20Wood)/VOX/box_c_b.vox`,   baseHeight: 0.18, radius: 0.14, placement: 'wall', destroyable: true},

  // Pots
  { id: 'pot_a', category: 'pot', voxPath: `${P}/Pot/Pot%20A%20(Clay)/VOX/pot_a.vox`,             baseHeight: 0.16, radius: 0.12, placement: 'wall', destroyable: true},
  { id: 'pot_b', category: 'pot', voxPath: `${P}/Pot/Pot%20B%20(Dark%20Clay)/VOX/pot_b.vox`,       baseHeight: 0.16, radius: 0.12, placement: 'wall', destroyable: true},
  { id: 'pot_c', category: 'pot', voxPath: `${P}/Pot/Pot%20C%20(Darkest%20Clay)/VOX/pot_c.vox`,   baseHeight: 0.16, radius: 0.12, placement: 'wall', destroyable: true},
  { id: 'pot_d', category: 'pot', voxPath: `${P}/Pot/Pot%20D%20(Metal)/VOX/pot_d.vox`,             baseHeight: 0.16, radius: 0.12, placement: 'wall', destroyable: true},

  // ── Scales with dungeon (architectural) ──

  // Altars
  { id: 'altar_a_a', category: 'altar', voxPath: `${P}/Altar/Altar%20A%20(Dungeon%20A)/VOX/altar_a_a.vox`, baseHeight: 0.6, radius: 0.3, placement: 'center', scalesWithDungeon: true, interactive: true },
  { id: 'altar_a_b', category: 'altar', voxPath: `${P}/Altar/Altar%20A%20(Dungeon%20A)/VOX/altar_a_b.vox`, baseHeight: 0.6, radius: 0.3, placement: 'center', scalesWithDungeon: true, interactive: true },
  { id: 'altar_b_a', category: 'altar', voxPath: `${P}/Altar/Altar%20B%20(Dungeon%20B)/VOX/altar_b_a.vox`, baseHeight: 0.6, radius: 0.3, placement: 'center', scalesWithDungeon: true, interactive: true },
  { id: 'altar_b_b', category: 'altar', voxPath: `${P}/Altar/Altar%20B%20(Dungeon%20B)/VOX/altar_b_b.vox`, baseHeight: 0.6, radius: 0.3, placement: 'center', scalesWithDungeon: true, interactive: true },
  { id: 'altar_c_a', category: 'altar', voxPath: `${P}/Altar/Altar%20C%20(Dungeon%20C)/VOX/altar_c_a.vox`, baseHeight: 0.6, radius: 0.3, placement: 'center', scalesWithDungeon: true, interactive: true },
  { id: 'altar_c_b', category: 'altar', voxPath: `${P}/Altar/Altar%20C%20(Dungeon%20C)/VOX/altar_c_b.vox`, baseHeight: 0.6, radius: 0.3, placement: 'center', scalesWithDungeon: true, interactive: true },
  { id: 'altar_d_a', category: 'altar', voxPath: `${P}/Altar/Altar%20D%20(Dungeon%20D)/VOX/altar_d_a.vox`, baseHeight: 0.6, radius: 0.3, placement: 'center', scalesWithDungeon: true, interactive: true },
  { id: 'altar_d_b', category: 'altar', voxPath: `${P}/Altar/Altar%20D%20(Dungeon%20D)/VOX/altar_d_b.vox`, baseHeight: 0.6, radius: 0.3, placement: 'center', scalesWithDungeon: true, interactive: true },

  // Banners — A (U-Shaped)
  { id: 'banner_a_red',    category: 'banner', voxPath: `${P}/Banner/Banner%20A%20(U-Shaped)/VOX/banner_a_red.vox`,    baseHeight: 0.8, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },
  { id: 'banner_a_blue',   category: 'banner', voxPath: `${P}/Banner/Banner%20A%20(U-Shaped)/VOX/banner_a_blue.vox`,   baseHeight: 0.8, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },
  { id: 'banner_a_green',  category: 'banner', voxPath: `${P}/Banner/Banner%20A%20(U-Shaped)/VOX/banner_a_green.vox`,  baseHeight: 0.8, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },
  { id: 'banner_a_yellow', category: 'banner', voxPath: `${P}/Banner/Banner%20A%20(U-Shaped)/VOX/banner_a_yellow.vox`, baseHeight: 0.8, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },
  // Banners — B (V-Shaped)
  { id: 'banner_b_red',    category: 'banner', voxPath: `${P}/Banner/Banner%20B%20(V-Shaped)/VOX/banner_b_red.vox`,    baseHeight: 0.8, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },
  { id: 'banner_b_blue',   category: 'banner', voxPath: `${P}/Banner/Banner%20B%20(V-Shaped)/VOX/banner_b_blue.vox`,   baseHeight: 0.8, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },
  { id: 'banner_b_green',  category: 'banner', voxPath: `${P}/Banner/Banner%20B%20(V-Shaped)/VOX/banner_b_green.vox`,  baseHeight: 0.8, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },
  { id: 'banner_b_yellow', category: 'banner', voxPath: `${P}/Banner/Banner%20B%20(V-Shaped)/VOX/banner_b_yellow.vox`, baseHeight: 0.8, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },
  // Banners — C (W-Shaped)
  { id: 'banner_c_red',    category: 'banner', voxPath: `${P}/Banner/Banner%20C%20(W-Shaped)/VOX/banner_c_red.vox`,    baseHeight: 0.8, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },
  { id: 'banner_c_blue',   category: 'banner', voxPath: `${P}/Banner/Banner%20C%20(W-Shaped)/VOX/banner_c_blue.vox`,   baseHeight: 0.8, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },
  { id: 'banner_c_green',  category: 'banner', voxPath: `${P}/Banner/Banner%20C%20(W-Shaped)/VOX/banner_c_green.vox`,  baseHeight: 0.8, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },
  { id: 'banner_c_yellow', category: 'banner', voxPath: `${P}/Banner/Banner%20C%20(W-Shaped)/VOX/banner_c_yellow.vox`, baseHeight: 0.8, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },

  // Large bookcases (empty + with colored books)
  { id: 'bookcase_large_a',        category: 'bookcase_large', voxPath: `${P}/Bookcase/Large%20Bookcase%20A%20(Wood)/VOX/large_bookcase_a.vox`,              baseHeight: 0.9, radius: 0.3, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_large_a_blue',   category: 'bookcase_large', voxPath: `${P}/Bookcase/Large%20Bookcase%20A%20(Wood)/VOX/large_bookcase_a_blue.vox`,         baseHeight: 0.9, radius: 0.3, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_large_a_green',  category: 'bookcase_large', voxPath: `${P}/Bookcase/Large%20Bookcase%20A%20(Wood)/VOX/large_bookcase_a_green.vox`,        baseHeight: 0.9, radius: 0.3, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_large_a_red',    category: 'bookcase_large', voxPath: `${P}/Bookcase/Large%20Bookcase%20A%20(Wood)/VOX/large_bookcase_a_red.vox`,          baseHeight: 0.9, radius: 0.3, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_large_a_yellow', category: 'bookcase_large', voxPath: `${P}/Bookcase/Large%20Bookcase%20A%20(Wood)/VOX/large_bookcase_a_yellow.vox`,       baseHeight: 0.9, radius: 0.3, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_large_b',        category: 'bookcase_large', voxPath: `${P}/Bookcase/Large%20Bookcase%20B%20(Dark%20Wood)/VOX/large_bookcase_b.vox`,       baseHeight: 0.9, radius: 0.3, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_large_b_blue',   category: 'bookcase_large', voxPath: `${P}/Bookcase/Large%20Bookcase%20B%20(Dark%20Wood)/VOX/large_bookcase_b_blue.vox`,  baseHeight: 0.9, radius: 0.3, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_large_b_green',  category: 'bookcase_large', voxPath: `${P}/Bookcase/Large%20Bookcase%20B%20(Dark%20Wood)/VOX/large_bookcase_b_green.vox`, baseHeight: 0.9, radius: 0.3, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_large_b_red',    category: 'bookcase_large', voxPath: `${P}/Bookcase/Large%20Bookcase%20B%20(Dark%20Wood)/VOX/large_bookcase_b_red.vox`,   baseHeight: 0.9, radius: 0.3, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_large_b_yellow', category: 'bookcase_large', voxPath: `${P}/Bookcase/Large%20Bookcase%20B%20(Dark%20Wood)/VOX/large_bookcase_b_yellow.vox`, baseHeight: 0.9, radius: 0.3, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_large_c',        category: 'bookcase_large', voxPath: `${P}/Bookcase/Large%20Bookcase%20C%20(Darkest%20Wood)/VOX/large_bookcase_c.vox`,        baseHeight: 0.9, radius: 0.3, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_large_c_blue',   category: 'bookcase_large', voxPath: `${P}/Bookcase/Large%20Bookcase%20C%20(Darkest%20Wood)/VOX/large_bookcase_c_blue.vox`,   baseHeight: 0.9, radius: 0.3, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_large_c_green',  category: 'bookcase_large', voxPath: `${P}/Bookcase/Large%20Bookcase%20C%20(Darkest%20Wood)/VOX/large_bookcase_c_green.vox`,  baseHeight: 0.9, radius: 0.3, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_large_c_red',    category: 'bookcase_large', voxPath: `${P}/Bookcase/Large%20Bookcase%20C%20(Darkest%20Wood)/VOX/large_bookcase_c_red.vox`,    baseHeight: 0.9, radius: 0.3, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_large_c_yellow', category: 'bookcase_large', voxPath: `${P}/Bookcase/Large%20Bookcase%20C%20(Darkest%20Wood)/VOX/large_bookcase_c_yellow.vox`, baseHeight: 0.9, radius: 0.3, placement: 'wall', scalesWithDungeon: true, wallAligned: true },

  // Small bookcases (empty + with colored books)
  { id: 'bookcase_small_a',        category: 'bookcase_small', voxPath: `${P}/Bookcase/Small%20Bookcase%20A%20(Wood)/VOX/small_bookcase_a.vox`,              baseHeight: 0.6, radius: 0.25, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_small_a_blue',   category: 'bookcase_small', voxPath: `${P}/Bookcase/Small%20Bookcase%20A%20(Wood)/VOX/small_bookcase_a_blue.vox`,         baseHeight: 0.6, radius: 0.25, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_small_a_green',  category: 'bookcase_small', voxPath: `${P}/Bookcase/Small%20Bookcase%20A%20(Wood)/VOX/small_bookcase_a_green.vox`,        baseHeight: 0.6, radius: 0.25, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_small_a_red',    category: 'bookcase_small', voxPath: `${P}/Bookcase/Small%20Bookcase%20A%20(Wood)/VOX/small_bookcase_a_red.vox`,          baseHeight: 0.6, radius: 0.25, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_small_a_yellow', category: 'bookcase_small', voxPath: `${P}/Bookcase/Small%20Bookcase%20A%20(Wood)/VOX/small_bookcase_a_yellow.vox`,       baseHeight: 0.6, radius: 0.25, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_small_b',        category: 'bookcase_small', voxPath: `${P}/Bookcase/Small%20Bookcase%20B%20(Dark%20Wood)/VOX/small_bookcase_b.vox`,       baseHeight: 0.6, radius: 0.25, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_small_b_blue',   category: 'bookcase_small', voxPath: `${P}/Bookcase/Small%20Bookcase%20B%20(Dark%20Wood)/VOX/small_bookcase_b_blue.vox`,  baseHeight: 0.6, radius: 0.25, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_small_b_green',  category: 'bookcase_small', voxPath: `${P}/Bookcase/Small%20Bookcase%20B%20(Dark%20Wood)/VOX/small_bookcase_b_green.vox`, baseHeight: 0.6, radius: 0.25, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_small_b_red',    category: 'bookcase_small', voxPath: `${P}/Bookcase/Small%20Bookcase%20B%20(Dark%20Wood)/VOX/small_bookcase_b_red.vox`,   baseHeight: 0.6, radius: 0.25, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_small_b_yellow', category: 'bookcase_small', voxPath: `${P}/Bookcase/Small%20Bookcase%20B%20(Dark%20Wood)/VOX/small_bookcase_b_yellow.vox`, baseHeight: 0.6, radius: 0.25, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_small_c',        category: 'bookcase_small', voxPath: `${P}/Bookcase/Small%20Bookcase%20C%20(Darkest%20Wood)/VOX/small_bookcase_c.vox`,        baseHeight: 0.6, radius: 0.25, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_small_c_blue',   category: 'bookcase_small', voxPath: `${P}/Bookcase/Small%20Bookcase%20C%20(Darkest%20Wood)/VOX/small_bookcase_c_blue.vox`,   baseHeight: 0.6, radius: 0.25, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_small_c_green',  category: 'bookcase_small', voxPath: `${P}/Bookcase/Small%20Bookcase%20C%20(Darkest%20Wood)/VOX/small_bookcase_c_green.vox`,  baseHeight: 0.6, radius: 0.25, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_small_c_red',    category: 'bookcase_small', voxPath: `${P}/Bookcase/Small%20Bookcase%20C%20(Darkest%20Wood)/VOX/small_bookcase_c_red.vox`,    baseHeight: 0.6, radius: 0.25, placement: 'wall', scalesWithDungeon: true, wallAligned: true },
  { id: 'bookcase_small_c_yellow', category: 'bookcase_small', voxPath: `${P}/Bookcase/Small%20Bookcase%20C%20(Darkest%20Wood)/VOX/small_bookcase_c_yellow.vox`, baseHeight: 0.6, radius: 0.25, placement: 'wall', scalesWithDungeon: true, wallAligned: true },

  // Tombs
  { id: 'tomb_a_a', category: 'tomb', voxPath: `${P}/Tomb/Tomb%20A%20(Dungeon%20A)/VOX/tomb_a_a.vox`, baseHeight: 0.3, radius: 0.2, placement: 'center', scalesWithDungeon: true },
  { id: 'tomb_a_b', category: 'tomb', voxPath: `${P}/Tomb/Tomb%20A%20(Dungeon%20A)/VOX/tomb_a_b.vox`, baseHeight: 0.3, radius: 0.2, placement: 'center', scalesWithDungeon: true },
  { id: 'tomb_b_a', category: 'tomb', voxPath: `${P}/Tomb/Tomb%20B%20(Dungeon%20B)/VOX/tomb_b_a.vox`, baseHeight: 0.3, radius: 0.2, placement: 'center', scalesWithDungeon: true },
  { id: 'tomb_b_b', category: 'tomb', voxPath: `${P}/Tomb/Tomb%20B%20(Dungeon%20B)/VOX/tomb_b_b.vox`, baseHeight: 0.3, radius: 0.2, placement: 'center', scalesWithDungeon: true },
  { id: 'tomb_c_a', category: 'tomb', voxPath: `${P}/Tomb/Tomb%20C%20(Dungeon%20C)/VOX/tomb_c_a.vox`, baseHeight: 0.3, radius: 0.2, placement: 'center', scalesWithDungeon: true },
  { id: 'tomb_c_b', category: 'tomb', voxPath: `${P}/Tomb/Tomb%20C%20(Dungeon%20C)/VOX/tomb_c_b.vox`, baseHeight: 0.3, radius: 0.2, placement: 'center', scalesWithDungeon: true },
  { id: 'tomb_d_a', category: 'tomb', voxPath: `${P}/Tomb/Tomb%20D%20(Dungeon%20D)/VOX/tomb_d_a.vox`, baseHeight: 0.3, radius: 0.2, placement: 'center', scalesWithDungeon: true },
  { id: 'tomb_d_b', category: 'tomb', voxPath: `${P}/Tomb/Tomb%20D%20(Dungeon%20D)/VOX/tomb_d_b.vox`, baseHeight: 0.3, radius: 0.2, placement: 'center', scalesWithDungeon: true },

  // Gates
  { id: 'gate_a', category: 'gate', voxPath: `${P}/Gate/Gate%20A%20(Metal)/VOX/gate_a.vox`,           baseHeight: 1.0, radius: 0.3, placement: 'wall', scalesWithDungeon: true, interactive: true },
  { id: 'gate_b', category: 'gate', voxPath: `${P}/Gate/Gate%20B%20(Dark%20Metal)/VOX/gate_b.vox`,   baseHeight: 1.0, radius: 0.3, placement: 'wall', scalesWithDungeon: true, interactive: true },

  // Traps — spike
  { id: 'spike_a_a', category: 'trap_spike', voxPath: `${P}/Trap/Spike/Spike%20A%20(Metal)/VOX/spike_a_a.vox`,           baseHeight: 0.15, radius: 0.3, placement: 'center', scalesWithDungeon: true, interactive: true },
  { id: 'spike_a_b', category: 'trap_spike', voxPath: `${P}/Trap/Spike/Spike%20A%20(Metal)/VOX/spike_a_b.vox`,           baseHeight: 0.15, radius: 0.3, placement: 'center', scalesWithDungeon: true, interactive: true },
  { id: 'spike_b_a', category: 'trap_spike', voxPath: `${P}/Trap/Spike/Spike%20B%20(Dark%20Metal)/VOX/spike_b_a.vox`,   baseHeight: 0.15, radius: 0.3, placement: 'center', scalesWithDungeon: true, interactive: true },
  { id: 'spike_b_b', category: 'trap_spike', voxPath: `${P}/Trap/Spike/Spike%20B%20(Dark%20Metal)/VOX/spike_b_b.vox`,   baseHeight: 0.15, radius: 0.3, placement: 'center', scalesWithDungeon: true, interactive: true },

  // Wall grates (plain + leaking variants)
  { id: 'wall_grate_a',                category: 'wall_grate', voxPath: `${P}/Wall%20Grate/Wall%20Grate%20A%20(Metal)/VOX/wall_grate_a.vox`,                  baseHeight: 0.6, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },
  { id: 'wall_grate_a_leaking_sewer',  category: 'wall_grate', voxPath: `${P}/Wall%20Grate/Wall%20Grate%20A%20(Metal)/VOX/wall_grate_a_leaking_sewer.vox`,    baseHeight: 0.6, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },
  { id: 'wall_grate_a_leaking_water',  category: 'wall_grate', voxPath: `${P}/Wall%20Grate/Wall%20Grate%20A%20(Metal)/VOX/wall_grate_a_leaking_water.vox`,    baseHeight: 0.6, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },
  { id: 'wall_grate_b',                category: 'wall_grate', voxPath: `${P}/Wall%20Grate/Wall%20Grate%20B%20(Dark%20Metal)/VOX/wall_grate_b.vox`,           baseHeight: 0.6, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },
  { id: 'wall_grate_b_leaking_sewer',  category: 'wall_grate', voxPath: `${P}/Wall%20Grate/Wall%20Grate%20B%20(Dark%20Metal)/VOX/wall_grate_b_leaking_sewer.vox`, baseHeight: 0.6, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },
  { id: 'wall_grate_b_leaking_water',  category: 'wall_grate', voxPath: `${P}/Wall%20Grate/Wall%20Grate%20B%20(Dark%20Metal)/VOX/wall_grate_b_leaking_water.vox`, baseHeight: 0.6, radius: 0.1, placement: 'wall_mount', mountHeight: 0.395, scalesWithDungeon: true, wallAligned: true },

  // ── Regular furniture (fixed scale) ──

  // Small tables (plain + with colored cloth)
  { id: 'table_small_a',        category: 'table_small', voxPath: `${P}/Table/Small%20Table%20A%20(Wood)/VOX/small_table_a.vox`,              baseHeight: 0.2, radius: 0.15, placement: 'center' },
  { id: 'table_small_a_blue',   category: 'table_small', voxPath: `${P}/Table/Small%20Table%20A%20(Wood)/VOX/small_table_a_blue.vox`,         baseHeight: 0.2, radius: 0.15, placement: 'center' },
  { id: 'table_small_a_green',  category: 'table_small', voxPath: `${P}/Table/Small%20Table%20A%20(Wood)/VOX/small_table_a_green.vox`,        baseHeight: 0.2, radius: 0.15, placement: 'center' },
  { id: 'table_small_a_red',    category: 'table_small', voxPath: `${P}/Table/Small%20Table%20A%20(Wood)/VOX/small_table_a_red.vox`,          baseHeight: 0.2, radius: 0.15, placement: 'center' },
  { id: 'table_small_a_yellow', category: 'table_small', voxPath: `${P}/Table/Small%20Table%20A%20(Wood)/VOX/small_table_a_yellow.vox`,       baseHeight: 0.2, radius: 0.15, placement: 'center' },
  { id: 'table_small_b',        category: 'table_small', voxPath: `${P}/Table/Small%20Table%20B%20(Dark%20Wood)/VOX/small_table_b.vox`,       baseHeight: 0.2, radius: 0.15, placement: 'center' },
  { id: 'table_small_b_blue',   category: 'table_small', voxPath: `${P}/Table/Small%20Table%20B%20(Dark%20Wood)/VOX/small_table_b_blue.vox`,  baseHeight: 0.2, radius: 0.15, placement: 'center' },
  { id: 'table_small_b_green',  category: 'table_small', voxPath: `${P}/Table/Small%20Table%20B%20(Dark%20Wood)/VOX/small_table_b_green.vox`, baseHeight: 0.2, radius: 0.15, placement: 'center' },
  { id: 'table_small_b_red',    category: 'table_small', voxPath: `${P}/Table/Small%20Table%20B%20(Dark%20Wood)/VOX/small_table_b_red.vox`,   baseHeight: 0.2, radius: 0.15, placement: 'center' },
  { id: 'table_small_b_yellow', category: 'table_small', voxPath: `${P}/Table/Small%20Table%20B%20(Dark%20Wood)/VOX/small_table_b_yellow.vox`, baseHeight: 0.2, radius: 0.15, placement: 'center' },
  { id: 'table_small_c',        category: 'table_small', voxPath: `${P}/Table/Small%20Table%20C%20(Darkest%20Wood)/VOX/small_table_c.vox`,        baseHeight: 0.2, radius: 0.15, placement: 'center' },
  { id: 'table_small_c_blue',   category: 'table_small', voxPath: `${P}/Table/Small%20Table%20C%20(Darkest%20Wood)/VOX/small_table_c_blue.vox`,   baseHeight: 0.2, radius: 0.15, placement: 'center' },
  { id: 'table_small_c_green',  category: 'table_small', voxPath: `${P}/Table/Small%20Table%20C%20(Darkest%20Wood)/VOX/small_table_c_green.vox`,  baseHeight: 0.2, radius: 0.15, placement: 'center' },
  { id: 'table_small_c_red',    category: 'table_small', voxPath: `${P}/Table/Small%20Table%20C%20(Darkest%20Wood)/VOX/small_table_c_red.vox`,    baseHeight: 0.2, radius: 0.15, placement: 'center' },
  { id: 'table_small_c_yellow', category: 'table_small', voxPath: `${P}/Table/Small%20Table%20C%20(Darkest%20Wood)/VOX/small_table_c_yellow.vox`, baseHeight: 0.2, radius: 0.15, placement: 'center' },

  // Large tables (plain + with colored cloth)
  { id: 'table_large_a',        category: 'table_large', voxPath: `${P}/Table/Large%20Table%20A%20(Wood)/VOX/large_table_a.vox`,              baseHeight: 0.22, radius: 0.2, placement: 'center' },
  { id: 'table_large_a_blue',   category: 'table_large', voxPath: `${P}/Table/Large%20Table%20A%20(Wood)/VOX/large_table_a_blue.vox`,         baseHeight: 0.22, radius: 0.2, placement: 'center' },
  { id: 'table_large_a_green',  category: 'table_large', voxPath: `${P}/Table/Large%20Table%20A%20(Wood)/VOX/large_table_a_green.vox`,        baseHeight: 0.22, radius: 0.2, placement: 'center' },
  { id: 'table_large_a_red',    category: 'table_large', voxPath: `${P}/Table/Large%20Table%20A%20(Wood)/VOX/large_table_a_red.vox`,          baseHeight: 0.22, radius: 0.2, placement: 'center' },
  { id: 'table_large_a_yellow', category: 'table_large', voxPath: `${P}/Table/Large%20Table%20A%20(Wood)/VOX/large_table_a_yellow.vox`,       baseHeight: 0.22, radius: 0.2, placement: 'center' },
  { id: 'table_large_b',        category: 'table_large', voxPath: `${P}/Table/Large%20Table%20B%20(Dark%20Wood)/VOX/large_table_b.vox`,       baseHeight: 0.22, radius: 0.2, placement: 'center' },
  { id: 'table_large_b_blue',   category: 'table_large', voxPath: `${P}/Table/Large%20Table%20B%20(Dark%20Wood)/VOX/large_table_b_blue.vox`,  baseHeight: 0.22, radius: 0.2, placement: 'center' },
  { id: 'table_large_b_green',  category: 'table_large', voxPath: `${P}/Table/Large%20Table%20B%20(Dark%20Wood)/VOX/large_table_b_green.vox`, baseHeight: 0.22, radius: 0.2, placement: 'center' },
  { id: 'table_large_b_red',    category: 'table_large', voxPath: `${P}/Table/Large%20Table%20B%20(Dark%20Wood)/VOX/large_table_b_red.vox`,   baseHeight: 0.22, radius: 0.2, placement: 'center' },
  { id: 'table_large_b_yellow', category: 'table_large', voxPath: `${P}/Table/Large%20Table%20B%20(Dark%20Wood)/VOX/large_table_b_yellow.vox`, baseHeight: 0.22, radius: 0.2, placement: 'center' },
  { id: 'table_large_c',        category: 'table_large', voxPath: `${P}/Table/Large%20Table%20C%20(Darkest%20Wood)/VOX/large_table_c.vox`,        baseHeight: 0.22, radius: 0.2, placement: 'center' },
  { id: 'table_large_c_blue',   category: 'table_large', voxPath: `${P}/Table/Large%20Table%20C%20(Darkest%20Wood)/VOX/large_table_c_blue.vox`,   baseHeight: 0.22, radius: 0.2, placement: 'center' },
  { id: 'table_large_c_green',  category: 'table_large', voxPath: `${P}/Table/Large%20Table%20C%20(Darkest%20Wood)/VOX/large_table_c_green.vox`,  baseHeight: 0.22, radius: 0.2, placement: 'center' },
  { id: 'table_large_c_red',    category: 'table_large', voxPath: `${P}/Table/Large%20Table%20C%20(Darkest%20Wood)/VOX/large_table_c_red.vox`,    baseHeight: 0.22, radius: 0.2, placement: 'center' },
  { id: 'table_large_c_yellow', category: 'table_large', voxPath: `${P}/Table/Large%20Table%20C%20(Darkest%20Wood)/VOX/large_table_c_yellow.vox`, baseHeight: 0.22, radius: 0.2, placement: 'center' },

  // Chairs (plain + with colored cushion)
  { id: 'chair_a',        category: 'chair', voxPath: `${P}/Chair/Chair%20A%20(Wood)/VOX/chair_a.vox`,              baseHeight: 0.2, radius: 0.08, placement: 'center' },
  { id: 'chair_a_blue',   category: 'chair', voxPath: `${P}/Chair/Chair%20A%20(Wood)/VOX/chair_a_blue.vox`,         baseHeight: 0.2, radius: 0.08, placement: 'center' },
  { id: 'chair_a_green',  category: 'chair', voxPath: `${P}/Chair/Chair%20A%20(Wood)/VOX/chair_a_green.vox`,        baseHeight: 0.2, radius: 0.08, placement: 'center' },
  { id: 'chair_a_red',    category: 'chair', voxPath: `${P}/Chair/Chair%20A%20(Wood)/VOX/chair_a_red.vox`,          baseHeight: 0.2, radius: 0.08, placement: 'center' },
  { id: 'chair_a_yellow', category: 'chair', voxPath: `${P}/Chair/Chair%20A%20(Wood)/VOX/chair_a_yellow.vox`,       baseHeight: 0.2, radius: 0.08, placement: 'center' },
  { id: 'chair_b',        category: 'chair', voxPath: `${P}/Chair/Chair%20B%20(Dark%20Wood)/VOX/chair_b.vox`,       baseHeight: 0.2, radius: 0.08, placement: 'center' },
  { id: 'chair_b_blue',   category: 'chair', voxPath: `${P}/Chair/Chair%20B%20(Dark%20Wood)/VOX/chair_b_blue.vox`,  baseHeight: 0.2, radius: 0.08, placement: 'center' },
  { id: 'chair_b_green',  category: 'chair', voxPath: `${P}/Chair/Chair%20B%20(Dark%20Wood)/VOX/chair_b_green.vox`, baseHeight: 0.2, radius: 0.08, placement: 'center' },
  { id: 'chair_b_red',    category: 'chair', voxPath: `${P}/Chair/Chair%20B%20(Dark%20Wood)/VOX/chair_b_red.vox`,   baseHeight: 0.2, radius: 0.08, placement: 'center' },
  { id: 'chair_b_yellow', category: 'chair', voxPath: `${P}/Chair/Chair%20B%20(Dark%20Wood)/VOX/chair_b_yellow.vox`, baseHeight: 0.2, radius: 0.08, placement: 'center' },
  { id: 'chair_c',        category: 'chair', voxPath: `${P}/Chair/Chair%20C%20(Darkest%20Wood)/VOX/chair_c.vox`,        baseHeight: 0.2, radius: 0.08, placement: 'center' },
  { id: 'chair_c_blue',   category: 'chair', voxPath: `${P}/Chair/Chair%20C%20(Darkest%20Wood)/VOX/chair_c_blue.vox`,   baseHeight: 0.2, radius: 0.08, placement: 'center' },
  { id: 'chair_c_green',  category: 'chair', voxPath: `${P}/Chair/Chair%20C%20(Darkest%20Wood)/VOX/chair_c_green.vox`,  baseHeight: 0.2, radius: 0.08, placement: 'center' },
  { id: 'chair_c_red',    category: 'chair', voxPath: `${P}/Chair/Chair%20C%20(Darkest%20Wood)/VOX/chair_c_red.vox`,    baseHeight: 0.2, radius: 0.08, placement: 'center' },
  { id: 'chair_c_yellow', category: 'chair', voxPath: `${P}/Chair/Chair%20C%20(Darkest%20Wood)/VOX/chair_c_yellow.vox`, baseHeight: 0.2, radius: 0.08, placement: 'center' },

  // Small benches (plain + with colored fabric)
  { id: 'bench_small_a',        category: 'bench', voxPath: `${P}/Bench/Small%20Bench%20A%20(Wood)/VOX/small_bench_a.vox`,              baseHeight: 0.16, radius: 0.1, placement: 'wall' },
  { id: 'bench_small_a_blue',   category: 'bench', voxPath: `${P}/Bench/Small%20Bench%20A%20(Wood)/VOX/small_bench_a_blue.vox`,         baseHeight: 0.16, radius: 0.1, placement: 'wall' },
  { id: 'bench_small_a_green',  category: 'bench', voxPath: `${P}/Bench/Small%20Bench%20A%20(Wood)/VOX/small_bench_a_green.vox`,        baseHeight: 0.16, radius: 0.1, placement: 'wall' },
  { id: 'bench_small_a_red',    category: 'bench', voxPath: `${P}/Bench/Small%20Bench%20A%20(Wood)/VOX/small_bench_a_red.vox`,          baseHeight: 0.16, radius: 0.1, placement: 'wall' },
  { id: 'bench_small_a_yellow', category: 'bench', voxPath: `${P}/Bench/Small%20Bench%20A%20(Wood)/VOX/small_bench_a_yellow.vox`,       baseHeight: 0.16, radius: 0.1, placement: 'wall' },
  { id: 'bench_small_b',        category: 'bench', voxPath: `${P}/Bench/Small%20Bench%20B%20(Dark%20Wood)/VOX/small_bench_b.vox`,       baseHeight: 0.16, radius: 0.1, placement: 'wall' },
  { id: 'bench_small_b_blue',   category: 'bench', voxPath: `${P}/Bench/Small%20Bench%20B%20(Dark%20Wood)/VOX/small_bench_b_blue.vox`,  baseHeight: 0.16, radius: 0.1, placement: 'wall' },
  { id: 'bench_small_b_green',  category: 'bench', voxPath: `${P}/Bench/Small%20Bench%20B%20(Dark%20Wood)/VOX/small_bench_b_green.vox`, baseHeight: 0.16, radius: 0.1, placement: 'wall' },
  { id: 'bench_small_b_red',    category: 'bench', voxPath: `${P}/Bench/Small%20Bench%20B%20(Dark%20Wood)/VOX/small_bench_b_red.vox`,   baseHeight: 0.16, radius: 0.1, placement: 'wall' },
  { id: 'bench_small_b_yellow', category: 'bench', voxPath: `${P}/Bench/Small%20Bench%20B%20(Dark%20Wood)/VOX/small_bench_b_yellow.vox`, baseHeight: 0.16, radius: 0.1, placement: 'wall' },
  { id: 'bench_small_c',        category: 'bench', voxPath: `${P}/Bench/Small%20Bench%20C%20(Darkest%20Wood)/VOX/small_bench_c.vox`,        baseHeight: 0.16, radius: 0.1, placement: 'wall' },
  { id: 'bench_small_c_blue',   category: 'bench', voxPath: `${P}/Bench/Small%20Bench%20C%20(Darkest%20Wood)/VOX/small_bench_c_blue.vox`,   baseHeight: 0.16, radius: 0.1, placement: 'wall' },
  { id: 'bench_small_c_green',  category: 'bench', voxPath: `${P}/Bench/Small%20Bench%20C%20(Darkest%20Wood)/VOX/small_bench_c_green.vox`,  baseHeight: 0.16, radius: 0.1, placement: 'wall' },
  { id: 'bench_small_c_red',    category: 'bench', voxPath: `${P}/Bench/Small%20Bench%20C%20(Darkest%20Wood)/VOX/small_bench_c_red.vox`,    baseHeight: 0.16, radius: 0.1, placement: 'wall' },
  { id: 'bench_small_c_yellow', category: 'bench', voxPath: `${P}/Bench/Small%20Bench%20C%20(Darkest%20Wood)/VOX/small_bench_c_yellow.vox`, baseHeight: 0.16, radius: 0.1, placement: 'wall' },

  // Large benches (plain + with colored fabric)
  { id: 'bench_large_a',        category: 'bench_large', voxPath: `${P}/Bench/Large%20Bench%20A%20(Wood)/VOX/large_bench_a.vox`,              baseHeight: 0.16, radius: 0.15, placement: 'wall' },
  { id: 'bench_large_a_blue',   category: 'bench_large', voxPath: `${P}/Bench/Large%20Bench%20A%20(Wood)/VOX/large_bench_a_blue.vox`,         baseHeight: 0.16, radius: 0.15, placement: 'wall' },
  { id: 'bench_large_a_green',  category: 'bench_large', voxPath: `${P}/Bench/Large%20Bench%20A%20(Wood)/VOX/large_bench_a_green.vox`,        baseHeight: 0.16, radius: 0.15, placement: 'wall' },
  { id: 'bench_large_a_red',    category: 'bench_large', voxPath: `${P}/Bench/Large%20Bench%20A%20(Wood)/VOX/large_bench_a_red.vox`,          baseHeight: 0.16, radius: 0.15, placement: 'wall' },
  { id: 'bench_large_a_yellow', category: 'bench_large', voxPath: `${P}/Bench/Large%20Bench%20A%20(Wood)/VOX/large_bench_a_yellow.vox`,       baseHeight: 0.16, radius: 0.15, placement: 'wall' },
  { id: 'bench_large_b',        category: 'bench_large', voxPath: `${P}/Bench/Large%20Bench%20B%20(Dark%20Wood)/VOX/large_bench_b.vox`,       baseHeight: 0.16, radius: 0.15, placement: 'wall' },
  { id: 'bench_large_b_blue',   category: 'bench_large', voxPath: `${P}/Bench/Large%20Bench%20B%20(Dark%20Wood)/VOX/large_bench_b_blue.vox`,  baseHeight: 0.16, radius: 0.15, placement: 'wall' },
  { id: 'bench_large_b_green',  category: 'bench_large', voxPath: `${P}/Bench/Large%20Bench%20B%20(Dark%20Wood)/VOX/large_bench_b_green.vox`, baseHeight: 0.16, radius: 0.15, placement: 'wall' },
  { id: 'bench_large_b_red',    category: 'bench_large', voxPath: `${P}/Bench/Large%20Bench%20B%20(Dark%20Wood)/VOX/large_bench_b_red.vox`,   baseHeight: 0.16, radius: 0.15, placement: 'wall' },
  { id: 'bench_large_b_yellow', category: 'bench_large', voxPath: `${P}/Bench/Large%20Bench%20B%20(Dark%20Wood)/VOX/large_bench_b_yellow.vox`, baseHeight: 0.16, radius: 0.15, placement: 'wall' },
  { id: 'bench_large_c',        category: 'bench_large', voxPath: `${P}/Bench/Large%20Bench%20C%20(Darkest%20Wood)/VOX/large_bench_c.vox`,        baseHeight: 0.16, radius: 0.15, placement: 'wall' },
  { id: 'bench_large_c_blue',   category: 'bench_large', voxPath: `${P}/Bench/Large%20Bench%20C%20(Darkest%20Wood)/VOX/large_bench_c_blue.vox`,   baseHeight: 0.16, radius: 0.15, placement: 'wall' },
  { id: 'bench_large_c_green',  category: 'bench_large', voxPath: `${P}/Bench/Large%20Bench%20C%20(Darkest%20Wood)/VOX/large_bench_c_green.vox`,  baseHeight: 0.16, radius: 0.15, placement: 'wall' },
  { id: 'bench_large_c_red',    category: 'bench_large', voxPath: `${P}/Bench/Large%20Bench%20C%20(Darkest%20Wood)/VOX/large_bench_c_red.vox`,    baseHeight: 0.16, radius: 0.15, placement: 'wall' },
  { id: 'bench_large_c_yellow', category: 'bench_large', voxPath: `${P}/Bench/Large%20Bench%20C%20(Darkest%20Wood)/VOX/large_bench_c_yellow.vox`, baseHeight: 0.16, radius: 0.15, placement: 'wall' },

  // Treasure chests
  { id: 'chest_a', category: 'chest', voxPath: `${P}/Treasure%20Chests/Treasure%20Chest%20A%20(Wood)/VOX/treasure_chest_a_unlocked.vox`,           voxPathClosed: `${P}/Treasure%20Chests/Treasure%20Chest%20A%20(Wood)/VOX/treasure_chest_a_locked.vox`,           baseHeight: 0.3, radius: 0.18, placement: 'wall', wallAligned: true, interactive: true },
  { id: 'chest_b', category: 'chest', voxPath: `${P}/Treasure%20Chests/Treasure%20Chest%20B%20(Darkest%20Wood)/VOX/treasure_chest_b_unlocked.vox`, voxPathClosed: `${P}/Treasure%20Chests/Treasure%20Chest%20B%20(Darkest%20Wood)/VOX/treasure_chest_b_locked.vox`, baseHeight: 0.3, radius: 0.18, placement: 'wall', wallAligned: true, interactive: true },
  { id: 'chest_c', category: 'chest', voxPath: `${P}/Treasure%20Chests/Treasure%20Chest%20C%20(Metal)/VOX/treasure_chest_c_unlocked.vox`,           voxPathClosed: `${P}/Treasure%20Chests/Treasure%20Chest%20C%20(Metal)/VOX/treasure_chest_c_locked.vox`,           baseHeight: 0.3, radius: 0.18, placement: 'wall', wallAligned: true, interactive: true },
  { id: 'chest_d', category: 'chest', voxPath: `${P}/Treasure%20Chests/Treasure%20Chest%20D%20(Gold)/VOX/treasure_chest_d_unlocked.vox`,             voxPathClosed: `${P}/Treasure%20Chests/Treasure%20Chest%20D%20(Gold)/VOX/treasure_chest_d_locked.vox`,             baseHeight: 0.3, radius: 0.18, placement: 'wall', wallAligned: true, interactive: true },
  { id: 'chest_e', category: 'chest', voxPath: `${P}/Treasure%20Chests/Treasure%20Chest%20E%20(Purple)/VOX/treasure_chest_e_unlocked.vox`,           voxPathClosed: `${P}/Treasure%20Chests/Treasure%20Chest%20E%20(Purple)/VOX/treasure_chest_e_locked.vox`,           baseHeight: 0.3, radius: 0.18, placement: 'wall', wallAligned: true, interactive: true },
  { id: 'chest_f', category: 'chest', voxPath: `${P}/Treasure%20Chests/Treasure%20Chest%20F%20(Red)/VOX/treasure_chest_f_unlocked.vox`,               voxPathClosed: `${P}/Treasure%20Chests/Treasure%20Chest%20F%20(Red)/VOX/treasure_chest_f_locked.vox`,               baseHeight: 0.3, radius: 0.18, placement: 'wall', wallAligned: true, interactive: true },
  { id: 'chest_g', category: 'chest', voxPath: `${P}/Treasure%20Chests/Treasure%20Chest%20G%20(Blue)/VOX/treasure_chest_g_unlocked.vox`,             voxPathClosed: `${P}/Treasure%20Chests/Treasure%20Chest%20G%20(Blue)/VOX/treasure_chest_g_locked.vox`,             baseHeight: 0.3, radius: 0.18, placement: 'wall', wallAligned: true, interactive: true },
  { id: 'chest_h', category: 'chest', voxPath: `${P}/Treasure%20Chests/Treasure%20Chest%20H%20(1%20Bit)/VOX/treasure_chest_h_unlocked.vox`,         voxPathClosed: `${P}/Treasure%20Chests/Treasure%20Chest%20H%20(1%20Bit)/VOX/treasure_chest_h_locked.vox`,         baseHeight: 0.3, radius: 0.18, placement: 'wall', wallAligned: true, interactive: true },

  // Books
  { id: 'book_a', category: 'book', voxPath: `${P}/Book/Book%20A%20(Red)/VOX/book_a.vox`,       baseHeight: 0.1, radius: 0.05, placement: 'anywhere' },
  { id: 'book_b', category: 'book', voxPath: `${P}/Book/Book%20B%20(Green)/VOX/book_b.vox`,     baseHeight: 0.1, radius: 0.05, placement: 'anywhere' },
  { id: 'book_c', category: 'book', voxPath: `${P}/Book/Book%20C%20(Blue)/VOX/book_c.vox`,      baseHeight: 0.1, radius: 0.05, placement: 'anywhere' },
  { id: 'book_d', category: 'book', voxPath: `${P}/Book/Book%20D%20(Yellow)/VOX/book_d.vox`,    baseHeight: 0.1, radius: 0.05, placement: 'anywhere' },

  // Mugs
  { id: 'mug_a', category: 'mug', voxPath: `${P}/Mug/Mug%20A%20(Wood)/VOX/mug_a.vox`,             baseHeight: 0.08, radius: 0.04, placement: 'anywhere' },
  { id: 'mug_b', category: 'mug', voxPath: `${P}/Mug/Mug%20B%20(Dark%20Wood)/VOX/mug_b.vox`,       baseHeight: 0.08, radius: 0.04, placement: 'anywhere' },
  { id: 'mug_c', category: 'mug', voxPath: `${P}/Mug/Mug%20C%20(Darkest%20Wood)/VOX/mug_c.vox`,   baseHeight: 0.08, radius: 0.04, placement: 'anywhere' },
  { id: 'mug_d', category: 'mug', voxPath: `${P}/Mug/Mug%20D%20(Metal)/VOX/mug_d.vox`,             baseHeight: 0.08, radius: 0.04, placement: 'anywhere' },

  // Bottles
  { id: 'bottle_a', category: 'bottle', voxPath: `${P}/Bottle/Bottle%20A%20(Red)/VOX/bottle_a.vox`,       baseHeight: 0.15, radius: 0.04, placement: 'anywhere' },
  { id: 'bottle_b', category: 'bottle', voxPath: `${P}/Bottle/Bottle%20B%20(Green)/VOX/bottle_b.vox`,     baseHeight: 0.15, radius: 0.04, placement: 'anywhere' },
  { id: 'bottle_c', category: 'bottle', voxPath: `${P}/Bottle/Bottle%20C%20(Blue)/VOX/bottle_c.vox`,      baseHeight: 0.15, radius: 0.04, placement: 'anywhere' },
  { id: 'bottle_d', category: 'bottle', voxPath: `${P}/Bottle/Bottle%20D%20(Yellow)/VOX/bottle_d.vox`,    baseHeight: 0.15, radius: 0.04, placement: 'anywhere' },

  // Potions
  { id: 'potion_a', category: 'potion', voxPath: `${P}/Potion/Potion%20A%20(Red)/VOX/potion_a.vox`,       baseHeight: 0.125, radius: 0.04, placement: 'anywhere' },
  { id: 'potion_b', category: 'potion', voxPath: `${P}/Potion/Potion%20B%20(Green)/VOX/potion_b.vox`,     baseHeight: 0.125, radius: 0.04, placement: 'anywhere' },
  { id: 'potion_c', category: 'potion', voxPath: `${P}/Potion/Potion%20C%20(Blue)/VOX/potion_c.vox`,      baseHeight: 0.125, radius: 0.04, placement: 'anywhere' },
  { id: 'potion_d', category: 'potion', voxPath: `${P}/Potion/Potion%20D%20(Yellow)/VOX/potion_d.vox`,    baseHeight: 0.125, radius: 0.04, placement: 'anywhere' },

  // Signposts
  { id: 'signpost_a', category: 'signpost', voxPath: `${P}/Signpost/Signpost%20A%20(Wood)/VOX/signpost_a.vox`,             baseHeight: 0.4, radius: 0.08, placement: 'anywhere' },
  { id: 'signpost_b', category: 'signpost', voxPath: `${P}/Signpost/Signpost%20B%20(Dark%20Wood)/VOX/signpost_b.vox`,       baseHeight: 0.4, radius: 0.08, placement: 'anywhere' },
  { id: 'signpost_c', category: 'signpost', voxPath: `${P}/Signpost/Signpost%20C%20(Darkest%20Wood)/VOX/signpost_c.vox`,   baseHeight: 0.4, radius: 0.08, placement: 'anywhere' },
];

// ── Tile grouped registry ──

const TILE_MAP = new Map<string, DungeonTileEntry[]>();
for (const entry of ALL_TILES) {
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
  return ALL_TILES.filter(e => e.theme === theme).map(e => e.voxPath);
}

/** Pick a random tile entry for a role */
export function getRandomTile(role: TileRole, theme = 'a_a', rand?: () => number): DungeonTileEntry | null {
  const tiles = getDungeonTiles(role, theme);
  if (tiles.length === 0) return null;
  const r = rand ?? Math.random;
  return tiles[Math.floor(r() * tiles.length)];
}

/** Get a specific tile by id */
export function getTileById(id: string): DungeonTileEntry | null {
  return ALL_TILES.find(e => e.id === id) ?? null;
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

/** Chest tier derived from variant letter: a–c = common, d–f = rare, g–h = epic */
export type ChestTier = 'common' | 'rare' | 'epic';

export function getChestTier(id: string): ChestTier {
  const letter = id.replace('chest_', '');
  if (letter >= 'a' && letter <= 'c') return 'common';
  if (letter >= 'd' && letter <= 'f') return 'rare';
  return 'epic';
}

/** Floor-weighted tier probabilities */
function getChestTierWeights(floor: number): { common: number; rare: number; epic: number } {
  if (floor <= 3) return { common: 0.70, rare: 0.25, epic: 0.05 };
  if (floor <= 6) return { common: 0.40, rare: 0.45, epic: 0.15 };
  return { common: 0.20, rare: 0.40, epic: 0.40 };
}

/** Pick a random chest using floor-weighted tier selection */
function pickWeightedChest(props: DungeonPropEntry[], floor: number, r: () => number): DungeonPropEntry {
  const weights = getChestTierWeights(floor);
  const roll = r();
  let targetTier: ChestTier;
  if (roll < weights.common) targetTier = 'common';
  else if (roll < weights.common + weights.rare) targetTier = 'rare';
  else targetTier = 'epic';

  const tierProps = props.filter(p => getChestTier(p.id) === targetTier);
  const pool = tierProps.length > 0 ? tierProps : props;
  return pool[Math.floor(r() * pool.length)];
}

/** Get a random prop from a category. For 'chest' category, pass floor for weighted tier selection. */
export function getRandomProp(category: string, rand?: () => number, floor?: number): DungeonPropEntry | null {
  const props = getPropsForCategory(category);
  if (props.length === 0) return null;
  const r = rand ?? Math.random;
  if (category === 'chest' && floor != null) {
    return pickWeightedChest(props, floor, r);
  }
  return props[Math.floor(r() * props.length)];
}

/** Extract the wood/material style letter (a/b/c/d) from a prop id.
 *  E.g. 'table_small_b_red' → 'b', 'chair_a' → 'a', 'barrel_tnt' → null */
export function extractPropStyle(id: string): string | null {
  // Match the last single letter before an optional _color suffix
  // Pattern: category_prefix_LETTER or category_prefix_LETTER_color
  const m = id.match(/_([a-d])(?:_(?:blue|green|red|yellow))?$/);
  return m ? m[1] : null;
}

/** Get a random prop from a category, filtered to a specific wood style (a/b/c/d).
 *  Falls back to any prop in the category if no matches for the style. */
export function getRandomPropStyled(category: string, style: string, rand?: () => number): DungeonPropEntry | null {
  const all = getPropsForCategory(category);
  if (all.length === 0) return null;
  const r = rand ?? Math.random;
  const matching = all.filter(p => extractPropStyle(p.id) === style);
  const pool = matching.length > 0 ? matching : all;
  return pool[Math.floor(r() * pool.length)];
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
