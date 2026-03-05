import type { HeightmapStyle } from '../terrain/TerrainNoise';
import { generateTownName, generateDungeonName, generateRegionName } from './LocationNames';

// ── POI definition ──────────────────────────────────────────────────

export type POIType = 'dungeon' | 'village';

export interface POIDef {
  type: POIType;
  /** Normalized position within tile (-0.5..0.5) */
  nx: number;
  nz: number;
  /** Deterministic sub-seed for visual variation */
  poiSeed: number;
  /** Procedurally generated name */
  name: string;
  /** Difficulty tier (1-3 skulls, only for dungeon POIs) */
  skulls?: number;
  /** Number of dungeon floors (1-4, only for dungeon POIs) */
  floorCount?: number;
}

// ── Tile definition ─────────────────────────────────────────────────

export interface OverworldTileDef {
  row: number;
  col: number;
  seed: number;
  paletteName: string;
  heightmapStyle: HeightmapStyle;
  label?: string;
  pois: POIDef[];
}

/** Info about a POI dungeon the player is currently inside. */
export interface PendingPoiDungeon {
  poiSeed: number;
  name: string;
  skulls: number;
  floorCount: number;
  /** Normalized POI position (0-1) — converted to world coords on return using ground size */
  returnNorm: { nx: number; nz: number };
  tileIndex: number;
}

export interface OverworldState {
  /** Index of the tile the player is currently zoomed into (null = on overworld) */
  activeTileIndex: number | null;
  /** Player position on overworld before zooming in */
  savedPlayerPos: { x: number; z: number; y: number } | null;
  /** Normalized position within tile when zooming in (-0.5..0.5 range) */
  zoomSpawnNorm: { nx: number; nz: number } | null;
  /** Character facing angle (radians) preserved across overworld → heightmap transition */
  zoomSpawnFacing: number | null;
  /** The 9 tile defs for this overworld */
  tiles: OverworldTileDef[];
  /** Base seed used to generate this overworld */
  baseSeed: number;
  /** Procedural world name */
  worldName: string;
  /** POI seeds of dungeons that have been cleared */
  clearedDungeons: number[];
  /** Active POI dungeon the player is inside (null = not in a POI dungeon) */
  pendingPoiDungeon: PendingPoiDungeon | null;
}

// ── Layout constants ────────────────────────────────────────────────

export const OW_GRID = 3;
export const OW_TILE_SIZE = 4;   // meters per tile
export const OW_GAP = 0;         // gap between tiles
export const OW_STRIDE = OW_TILE_SIZE + OW_GAP; // center-to-center
export const OW_TOTAL_SIZE = OW_GRID * OW_TILE_SIZE + (OW_GRID - 1) * OW_GAP;

/** Palette pool to pick from (ensures visual variety). */
const PALETTE_POOL = [
  'meadow', 'autumn', 'mars', 'obsidian', 'sands',
  'snowland', 'highlands', 'tropical', 'enchanted',
  'swamp', 'coral', 'ash',
];

const STYLE_POOL: HeightmapStyle[] = ['terraces', 'islands', 'caves'];

// ── Simple deterministic PRNG ───────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── POI generation ──────────────────────────────────────────────────

const POI_SALT = 0xA7C3;
const MIN_POI_DIST = 0.15; // normalized distance

function tooClose(pois: POIDef[], nx: number, nz: number): boolean {
  for (const p of pois) {
    const dx = p.nx - nx, dz = p.nz - nz;
    if (dx * dx + dz * dz < MIN_POI_DIST * MIN_POI_DIST) return true;
  }
  return false;
}

/** Generate POIs for a single tile. Deterministic per tileSeed. */
export function generatePOIsForTile(tileSeed: number): POIDef[] {
  const rng = mulberry32(tileSeed + POI_SALT);
  const pois: POIDef[] = [];

  // Hash helper: mix tile seed with POI index for truly unique seeds
  const poiHash = (idx: number, salt: number) =>
    (Math.imul(tileSeed ^ salt, 2654435761) + Math.imul(idx, 668265263)) >>> 0;

  // Village: 50% chance, max 1
  if (rng() < 0.5) {
    const poiSeed = poiHash(0, 0xB1C3);
    pois.push({
      type: 'village',
      nx: (rng() - 0.5) * 0.6,
      nz: (rng() - 0.5) * 0.6,
      poiSeed,
      name: generateTownName(poiSeed),
    });
  }

  // Dungeons: 1-3
  const count = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i++) {
    let nx = 0, nz = 0;
    let attempts = 0;
    do {
      nx = (rng() - 0.5) * 0.7;
      nz = (rng() - 0.5) * 0.7;
      attempts++;
    } while (attempts < 20 && tooClose(pois, nx, nz));

    const poiSeed = poiHash(i + 1, 0xD14E);
    // Use poiSeed-derived RNG for skulls/floors so position retries don't shift distribution
    const poiRng = mulberry32(poiSeed);
    // Difficulty tier: ~65% 1-skull, ~25% 2-skull, ~10% 3-skull
    const sr = poiRng();
    const skulls = sr < 0.65 ? 1 : sr < 0.9 ? 2 : 3;
    // Floor count: random, but higher skulls = higher chance of more floors
    //   1-skull: 60% 1F, 30% 2F, 10% 3F
    //   2-skull: 30% 1F, 40% 2F, 25% 3F, 5% 4F
    //   3-skull: 15% 1F, 30% 2F, 35% 3F, 20% 4F
    const fr = poiRng();
    const floorCount =
      skulls === 1 ? (fr < 0.6 ? 1 : fr < 0.9 ? 2 : 3) :
      skulls === 2 ? (fr < 0.3 ? 1 : fr < 0.7 ? 2 : fr < 0.95 ? 3 : 4) :
                     (fr < 0.15 ? 1 : fr < 0.45 ? 2 : fr < 0.8 ? 3 : 4);
    pois.push({
      type: 'dungeon',
      nx, nz,
      poiSeed,
      name: generateDungeonName(poiSeed),
      skulls,
      floorCount,
    });
  }

  return pois;
}

// ── Public API ──────────────────────────────────────────────────────

/** Generate 9 tile definitions for the overworld grid. Deterministic for a given baseSeed. */
export function generateOverworldTiles(baseSeed: number): OverworldTileDef[] {
  const rng = mulberry32(baseSeed);
  const tiles: OverworldTileDef[] = [];

  // Shuffle palette pool to avoid duplicates
  const shuffled = [...PALETTE_POOL];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  for (let row = 0; row < OW_GRID; row++) {
    for (let col = 0; col < OW_GRID; col++) {
      const idx = row * OW_GRID + col;
      const seed = (baseSeed + idx * 7919) >>> 0; // unique per tile
      const paletteName = shuffled[idx % shuffled.length];
      const heightmapStyle = STYLE_POOL[Math.floor(rng() * STYLE_POOL.length)];
      tiles.push({
        row,
        col,
        seed,
        paletteName,
        heightmapStyle,
        label: generateRegionName(seed, paletteName, heightmapStyle),
        pois: generatePOIsForTile(seed),
      });
    }
  }

  return tiles;
}

/** Get world-space center X,Z for a tile at (row, col). Origin is center of the 3x3 grid. */
export function tileCenterWorld(row: number, col: number): { cx: number; cz: number } {
  return {
    cx: (col - 1) * OW_STRIDE,
    cz: (row - 1) * OW_STRIDE,
  };
}

/** Given a world position, return the tile index (0-8) or null if in a gap. */
export function getTileAtWorldPos(wx: number, wz: number): number | null {
  for (let row = 0; row < OW_GRID; row++) {
    for (let col = 0; col < OW_GRID; col++) {
      const { cx, cz } = tileCenterWorld(row, col);
      const half = OW_TILE_SIZE / 2;
      if (Math.abs(wx - cx) <= half && Math.abs(wz - cz) <= half) {
        return row * OW_GRID + col;
      }
    }
  }
  return null;
}
