// ── VOX Dungeon Tile Loader ────────────────────────────────────────
// Loads and caches dungeon tile geometries using VoxModelLoader.

import * as THREE from 'three';
import { loadVoxModel, buildVoxMesh } from '../../utils/VoxModelLoader';
import { getAllThemePaths } from './VoxDungeonDB';
import type { DungeonTileEntry } from './VoxDungeonDB';

// VOX model dimensions (in voxels)
const VOX_TILE_XZ = 15;   // ground & wall tiles are 15×15 in XZ
const VOX_GROUND_Y = 1;   // ground tile height in voxels
const VOX_WALL_Y = 17;    // wall tile height in voxels

// These get set by setCellSize() before loading
let cellSize = 1.5;
let voxelScale = cellSize / VOX_TILE_XZ;
let groundTargetHeight = VOX_GROUND_Y * voxelScale;
let wallTargetHeight = VOX_WALL_Y * voxelScale;

/** Set the cell size used for scaling. Call before preloadTheme(). */
export function setCellSize(size: number): void {
  cellSize = size;
  voxelScale = cellSize / VOX_TILE_XZ;
  groundTargetHeight = VOX_GROUND_Y * voxelScale;
  wallTargetHeight = VOX_WALL_Y * voxelScale;
}

export function getCellSize(): number { return cellSize; }
export function getWallTargetHeight(): number { return wallTargetHeight; }
export function getGroundTargetHeight(): number { return groundTargetHeight; }

// ── Geometry cache ──

const geoCache = new Map<string, THREE.BufferGeometry>();
const loadingPromises = new Map<string, Promise<THREE.BufferGeometry | null>>();

/** Load a single tile geometry and cache it */
async function loadTile(voxPath: string, isWall: boolean): Promise<THREE.BufferGeometry | null> {
  if (geoCache.has(voxPath)) return geoCache.get(voxPath)!;

  if (loadingPromises.has(voxPath)) return loadingPromises.get(voxPath)!;

  const promise = (async () => {
    try {
      const { model, palette } = await loadVoxModel(voxPath);
      const targetHeight = isWall ? wallTargetHeight : groundTargetHeight;
      const geo = buildVoxMesh(model, palette, targetHeight);
      geoCache.set(voxPath, geo);
      return geo;
    } catch (err) {
      console.warn(`[VoxDungeonLoader] Failed to load tile: ${voxPath}`, err);
      return null;
    } finally {
      loadingPromises.delete(voxPath);
    }
  })();

  loadingPromises.set(voxPath, promise);
  return promise;
}

/** Preload all tiles for a theme — call at dungeon creation time */
export async function preloadTheme(theme = 'a_a'): Promise<void> {
  const paths = getAllThemePaths(theme);
  const tasks = paths.map(voxPath => {
    // Ground paths contain '/Ground/' in the URL
    const isWall = !voxPath.includes('/Ground/');
    return loadTile(voxPath, isWall);
  });
  await Promise.all(tasks);
  // console.log(`[VoxDungeonLoader] Preloaded ${paths.length} tiles (cellSize=${cellSize})`);
}

/** Get a cached geometry for a tile entry. Returns null if not loaded. */
export function getTileGeometry(entry: DungeonTileEntry): THREE.BufferGeometry | null {
  return geoCache.get(entry.voxPath) || null;
}

/** Load a single tile entry on demand (returns cached if available) */
export async function loadTileEntry(entry: DungeonTileEntry): Promise<THREE.BufferGeometry | null> {
  const isWall = entry.role !== 'ground';
  return loadTile(entry.voxPath, isWall);
}

/** Clear all cached geometries (call on scene regeneration) */
export function clearCache(): void {
  for (const geo of geoCache.values()) {
    geo.dispose();
  }
  geoCache.clear();
}
