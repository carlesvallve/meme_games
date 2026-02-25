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
import { getFirstTile, getRandomTile, getTileById, getDungeonTiles } from './VoxDungeonDB';
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
  /** Per-cell room index (-1 = corridor, >= 0 = room index) */
  roomOwnership?: number[];
}

export interface VoxelDungeonResult {
  debris: DebrisBox[];
  entities: Entity[];
  wallHeight: number;
}

// ── Ground mesh tracking (for live floor swaps) ──
let groundMeshes: THREE.Mesh[] = [];
let cachedGroundTheme = 'a_a';

/** Swap all ground tile geometries at once (called when testFloor dropdown changes) */
export function swapGroundTiles(tileId: string): void {
  const groundTiles = getDungeonTiles('ground', cachedGroundTheme);
  if (groundTiles.length === 0) return;

  const forced = tileId ? getTileById(tileId) : null;
  // When randomizing, only use normal (_a) variants
  const normalTiles = groundTiles.filter(t => t.id.endsWith('_a'));

  for (const mesh of groundMeshes) {
    const tile = forced ?? normalTiles[Math.floor(Math.random() * normalTiles.length)];
    const geo = getTileGeometry(tile);
    if (geo) mesh.geometry = geo;
  }
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

  const wallMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.1,
  });

  // All visual wall meshes go into this group, which is registered as
  // an Architecture entity so the reveal shader auto-patches its materials.
  const wallVisualGroup = new THREE.Group();
  group.add(wallVisualGroup);
  new Entity(wallVisualGroup, { layer: Layer.Architecture, radius: groundSize, weight: 0 });

  let groundCount = 0;
  let wallCount = 0;

  // Ground tiles: randomized per-room/per-corridor, only normal (_a suffix) variants
  const { useGameStore } = await import('../store');
  const testFloor = useGameStore.getState().testFloor;
  const groundTiles = getDungeonTiles('ground', theme);
  const normalGroundTiles = groundTiles.filter(t => t.id.endsWith('_a'));
  const forcedGroundTile = testFloor ? getTileById(testFloor) : null;

  // Pre-assign a random normal floor tile per room and per corridor
  const ownership = config.roomOwnership;
  const roomCount = ownership ? Math.max(0, ...ownership) + 1 : 0;
  const roomFloorTiles = normalGroundTiles.length > 0
    ? Array.from({ length: roomCount }, () => normalGroundTiles[Math.floor(Math.random() * normalGroundTiles.length)])
    : [];
  // Corridors use negative IDs: -2, -3, ... → index as (-id - 2)
  // For each corridor, find an adjacent room and inherit its floor tile.
  // Fallback to random if no adjacent room found.
  const minOwnership = ownership ? Math.min(0, ...ownership) : 0;
  const corridorCount = minOwnership <= -2 ? (-minOwnership - 2) + 1 : 0;
  const corridorFloorTiles: (typeof normalGroundTiles[0] | null)[] = new Array(corridorCount).fill(null);
  if (ownership && corridorCount > 0 && normalGroundTiles.length > 0) {
    // For each corridor, scan its cells for an adjacent room
    const corridorAdjacentRoom = new Int16Array(corridorCount).fill(-1);
    for (let gz = 0; gz < gridD; gz++) {
      for (let gx = 0; gx < gridW; gx++) {
        const oid = ownership[gz * gridW + gx];
        if (oid > -2) continue; // not a corridor cell
        const ci = -oid - 2;
        if (corridorAdjacentRoom[ci] >= 0) continue; // already found
        // Check 4 neighbors for a room cell
        const neighbors = [
          gx > 0 ? ownership[gz * gridW + gx - 1] : -1,
          gx < gridW - 1 ? ownership[gz * gridW + gx + 1] : -1,
          gz > 0 ? ownership[(gz - 1) * gridW + gx] : -1,
          gz < gridD - 1 ? ownership[(gz + 1) * gridW + gx] : -1,
        ];
        for (const n of neighbors) {
          if (n >= 0) { corridorAdjacentRoom[ci] = n; break; }
        }
      }
    }
    for (let ci = 0; ci < corridorCount; ci++) {
      const ri = corridorAdjacentRoom[ci];
      corridorFloorTiles[ci] = ri >= 0 && roomFloorTiles[ri]
        ? roomFloorTiles[ri]
        : normalGroundTiles[Math.floor(Math.random() * normalGroundTiles.length)];
    }
  }

  // Reset ground mesh tracking
  groundMeshes = [];
  cachedGroundTheme = theme;

  // Use corner variant c for convex room corners
  const convexCornerTile = getTileById('outer_wall_corner_c') ?? getFirstTile('outer_wall_corner', theme);

  // ── Pass 1: Ground tiles (open cells) ──
  for (let gz = 0; gz < gridD; gz++) {
    for (let gx = 0; gx < gridW; gx++) {
      if (!openGrid[gz * gridW + gx]) continue;

      const wx = toWorldX(gx);
      const wz = toWorldZ(gz);

      let tile = forcedGroundTile;
      if (!tile && ownership) {
        const ownerId = ownership[gz * gridW + gx];
        if (ownerId >= 0) {
          tile = roomFloorTiles[ownerId] ?? null;
        } else if (ownerId <= -2) {
          tile = corridorFloorTiles[-ownerId - 2] ?? null;
        }
      }
      if (!tile) tile = normalGroundTiles[Math.floor(Math.random() * normalGroundTiles.length)] ?? null;

      const mesh = placeVoxReturn(group, wx, wz, 'ground', 0, voxMat, tile);
      if (mesh) groundMeshes.push(mesh);
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

      placeVox(wallVisualGroup, wx, wz, role, rot, wallMat, tileOverride);
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
      mat.opacity = useGameStore.getState().gridOpacity;
      mat.depthWrite = false;
    }
    group.add(grid);
  }

  console.log(`[VoxelDungeon] ${groundCount} ground + ${wallCount} wall tiles`);
}

// ── Helpers ──

function placeVoxReturn(
  group: THREE.Group,
  wx: number,
  wz: number,
  role: TileRole,
  rotation: number,
  material: THREE.Material,
  specificEntry?: import('./VoxDungeonDB').DungeonTileEntry | null,
): THREE.Mesh | null {
  const entry = specificEntry ?? getFirstTile(role);
  if (!entry) return null;

  const geo = getTileGeometry(entry);
  if (!geo) return null;

  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(wx, 0, wz);
  const normRot = ((rotation % 360) + 360) % 360;
  if (normRot !== 0) {
    mesh.rotation.y = (normRot * Math.PI) / 180;
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function placeVox(
  group: THREE.Group,
  wx: number,
  wz: number,
  role: TileRole,
  rotation: number,
  material: THREE.Material,
  specificEntry?: import('./VoxDungeonDB').DungeonTileEntry | null,
): void {
  placeVoxReturn(group, wx, wz, role, rotation, material, specificEntry);
}
