// ── VoxelDungeon ───────────────────────────────────────────────────
// Purpose-built blocky dungeon renderer using VOX tile assets.
//
// Architecture: the dungeon grid is a 2D boolean array (open = floor,
// closed = potential wall block). Every cell maps 1:1 to a tile-sized
// cube in world space.
//
//  • Open cells → ground tile (flat VOX piece, visual only)
//  • Closed cells adjacent to an open cell → wall block (full-cube VOX
//    piece + invisible collision box).
//  • Wall classification is per-closed-cell based on which cardinal
//    neighbors are open.
//  • Entrance tiles replace walls near door positions.

import * as THREE from 'three';
import { Entity, Layer } from './Entity';
import { getFirstTile, getRandomTile, getTileById } from './VoxDungeonDB';
import type { TileRole } from './VoxDungeonDB';
import { preloadTheme, getTileGeometry, setCellSize, getWallTargetHeight, clearCache } from './VoxDungeonLoader';
import type { DoorDef } from './DungeonGenerator';
import type { DebrisBox } from './Terrain';

// ── Rotation ──
// Default VOX wall segment faces north (-Z). The decorated brick face
// and top trim line point toward -Z at rotation 0.
// Rotation is CCW around Y: +90° turns north→west, +180° turns north→south.
// This offset flips all pieces so the code can think in "face toward open cell" terms.
const BASE_ROT = 180;

// ── Types ──

export interface VoxelDungeonConfig {
  openGrid: boolean[];
  gridW: number;
  gridD: number;
  cellSize: number;
  groundSize: number;     // total world size (e.g. 50)
  doors: DoorDef[];       // world-space doors
  gridDoors: DoorDef[];   // grid-space doors (for entrance tile placement)
  wallHeight?: number;
  theme?: string;         // defaults to 'a_a'
}

export interface VoxelDungeonResult {
  debris: DebrisBox[];
  entities: Entity[];
  wallHeight: number;
}

// ── Main builder ──

/**
 * Build a blocky VOX dungeon synchronously (collision) + asynchronously (visuals).
 */
export function buildVoxelDungeonCollision(
  config: VoxelDungeonConfig,
  group: THREE.Group,
): VoxelDungeonResult {
  const { openGrid, gridW, gridD, cellSize, groundSize, gridDoors } = config;
  const halfWorld = groundSize / 2;
  const wallHeight = config.wallHeight ?? (17 * cellSize / 15);
  const half = cellSize / 2;

  const debris: DebrisBox[] = [];
  const entities: Entity[] = [];

  const isOpen = (gx: number, gz: number): boolean => {
    if (gx < 0 || gx >= gridW || gz < 0 || gz >= gridD) return false;
    return openGrid[gz * gridW + gx];
  };

  const toWorldX = (gx: number) => -halfWorld + (gx + 0.5) * cellSize;
  const toWorldZ = (gz: number) => -halfWorld + (gz + 0.5) * cellSize;

  // Place invisible full-block collision for every closed cell adjacent to an open cell
  // (cardinal OR diagonal — diagonal catches room outer corners)
  for (let gz = 0; gz < gridD; gz++) {
    for (let gx = 0; gx < gridW; gx++) {
      if (openGrid[gz * gridW + gx]) continue;

      const hasOpenNeighbor =
        isOpen(gx, gz - 1) || isOpen(gx, gz + 1) ||
        isOpen(gx - 1, gz) || isOpen(gx + 1, gz) ||
        isOpen(gx - 1, gz - 1) || isOpen(gx + 1, gz - 1) ||
        isOpen(gx - 1, gz + 1) || isOpen(gx + 1, gz + 1);
      if (!hasOpenNeighbor) continue;

      const wx = toWorldX(gx);
      const wz = toWorldZ(gz);

      const geo = new THREE.BoxGeometry(cellSize, wallHeight, cellSize);
      const mat = new THREE.MeshBasicMaterial({ visible: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(wx, wallHeight / 2, wz);
      group.add(mesh);

      entities.push(new Entity(mesh, {
        layer: Layer.Architecture,
        radius: half,
        weight: Infinity,
      }));

      debris.push({ x: wx, z: wz, halfW: half, halfD: half, height: wallHeight });
    }
  }

  return { debris, entities, wallHeight };
}

/**
 * Load VOX meshes for every floor and wall cell. Call after collision is set up.
 */
export async function loadVoxelDungeonVisuals(
  config: VoxelDungeonConfig,
  group: THREE.Group,
): Promise<void> {
  const { openGrid, gridW, gridD, cellSize, groundSize, gridDoors } = config;
  const theme = config.theme ?? 'a_a';
  const halfWorld = groundSize / 2;

  // Clear cached geometries (may have stale scale from previous generation)
  clearCache();

  // Match mesh scale to grid cell size (no gap between tiles)
  setCellSize(cellSize);

  try {
    await preloadTheme(theme);
  } catch (err) {
    console.warn('[VoxelDungeon] Failed to preload theme, no visuals', err);
    return;
  }

  const toWorldX = (gx: number) => -halfWorld + (gx + 0.5) * cellSize;
  const toWorldZ = (gz: number) => -halfWorld + (gz + 0.5) * cellSize;

  const isOpen = (gx: number, gz: number): boolean => {
    if (gx < 0 || gx >= gridW || gz < 0 || gz >= gridD) return false;
    return openGrid[gz * gridW + gx];
  };

  const voxMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.1,
  });

  let groundCount = 0;
  let wallCount = 0;

  // Use the bordered ground tile (square line pattern)
  const groundTile = getTileById('ground_c_a') ?? getFirstTile('ground', theme);
  // Use corner variant c for convex room corners
  const convexCornerTile = getTileById('outer_wall_corner_c') ?? getFirstTile('outer_wall_corner', theme);

  // ── Pass 1: Ground tiles (open cells) ──
  for (let gz = 0; gz < gridD; gz++) {
    for (let gx = 0; gx < gridW; gx++) {
      if (!openGrid[gz * gridW + gx]) continue;

      const wx = toWorldX(gx);
      const wz = toWorldZ(gz);
      placeVox(group, wx, wz, 'ground', 0, voxMat, groundTile);
      groundCount++;

    }
  }

  // ── Pass 2: Wall tiles (closed cells adjacent to open) ──
  for (let gz = 0; gz < gridD; gz++) {
    for (let gx = 0; gx < gridW; gx++) {
      if (openGrid[gz * gridW + gx]) continue;

      const oN = isOpen(gx, gz - 1);
      const oS = isOpen(gx, gz + 1);
      const oW = isOpen(gx - 1, gz);
      const oE = isOpen(gx + 1, gz);
      const openCount = (oN ? 1 : 0) + (oS ? 1 : 0) + (oW ? 1 : 0) + (oE ? 1 : 0);

      const hasOpenDiag =
        isOpen(gx - 1, gz - 1) || isOpen(gx + 1, gz - 1) ||
        isOpen(gx - 1, gz + 1) || isOpen(gx + 1, gz + 1);

      if (openCount === 0 && !hasOpenDiag) continue;

      const wx = toWorldX(gx);
      const wz = toWorldZ(gz);
      let role: TileRole;
      let rot = 0;
      let tileOverride: import('./VoxDungeonDB').DungeonTileEntry | null | undefined;

      if (openCount === 0) {
        // Diagonal-only — convex room corner
        const dSE = isOpen(gx + 1, gz + 1);
        const dNE = isOpen(gx + 1, gz - 1);
        const dNW = isOpen(gx - 1, gz - 1);
        role = 'outer_wall_corner';
        tileOverride = convexCornerTile;
        if (dSE)           rot = BASE_ROT + 90;
        else if (dNE)      rot = BASE_ROT + 180;
        else if (dNW)      rot = BASE_ROT + 270;
        else               rot = BASE_ROT;          // dSW
      } else if (openCount === 1) {
        role = 'outer_wall_segment';
        if (oS)      rot = BASE_ROT;
        else if (oE) rot = BASE_ROT + 90;
        else if (oN) rot = BASE_ROT + 180;
        else         rot = BASE_ROT + 270;
      } else if (openCount === 2 && !(oN && oS) && !(oW && oE)) {
        role = 'outer_wall_corner';
        if (oS && oE)      rot = BASE_ROT;
        else if (oE && oN) rot = BASE_ROT + 90;
        else if (oN && oW) rot = BASE_ROT + 180;
        else                rot = BASE_ROT + 270;
      } else {
        role = 'outer_wall_segment';
        if (oS)      rot = BASE_ROT;
        else if (oE) rot = BASE_ROT + 90;
        else if (oN) rot = BASE_ROT + 180;
        else         rot = BASE_ROT + 270;
      }

      placeVox(group, wx, wz, role, rot, voxMat, tileOverride);
      wallCount++;
    }
  }

  // ── Pass 3: Nav-cell grid overlay ──
  // Full-coverage GridHelper matching nav cell size, sitting on the floor surface.
  {
    const gridY = cellSize / 15 + 0.01;
    const navCellSize = 0.25;
    const divisions = Math.round(groundSize / navCellSize);

    const grid = new THREE.GridHelper(groundSize, divisions, 0x000000, 0x000000);
    grid.position.y = gridY;
    const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const mat of mats) {
      mat.transparent = true;
      mat.opacity = 0.9;
      mat.depthWrite = false;
    }
    group.add(grid);
  }

  console.log(`[VoxelDungeon] ${groundCount} ground + ${wallCount} wall tiles`);
}

// ── Helpers ──

function placeVox(
  group: THREE.Group,
  wx: number,
  wz: number,
  role: TileRole,
  rotation: number,
  material: THREE.Material,
  specificEntry?: import('./VoxDungeonDB').DungeonTileEntry | null,
): void {
  const entry = specificEntry ?? getFirstTile(role);
  if (!entry) return;

  const geo = getTileGeometry(entry);
  if (!geo) return;

  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(wx, 0, wz);
  const normRot = ((rotation % 360) + 360) % 360;
  if (normRot !== 0) {
    mesh.rotation.y = (normRot * Math.PI) / 180;
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}
