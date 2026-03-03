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
import { Entity, Layer } from '../core/Entity';
import { getFirstTile, getRandomTile, getTileById, getDungeonTiles } from './VoxDungeonDB';
import type { TileRole } from './VoxDungeonDB';
import { preloadTheme, getTileGeometry, setCellSize, getWallTargetHeight, clearCache } from './VoxDungeonLoader';
import type { DoorDef } from './DungeonGenerator';
import type { DebrisBox } from '../terrain';
// ── Rotation ──
// Default VOX wall segment faces north (-Z). The decorated brick face
// and top trim line point toward -Z at rotation 0.
// Rotation is CCW around Y: +90° turns north→west, +180° turns north→south.
// This offset flips all pieces so the code can think in "face toward open cell" terms.
const BASE_ROT = 180;
const USE_STACKED_WALLS = false;

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
  /** Per-cell height offsets from StairSystem (Float32Array indexed by gz * gridW + gx) */
  cellHeights?: Float32Array;
  /** Set of cell indices that contain stairs — skip ground tile placement for these */
  stairCells?: Set<number>;
  /** Stair definitions for placing side walls */
  stairs?: { gx: number; gz: number; axis: 'x' | 'z'; direction: 1 | -1 }[];
  /** Floor vox tile height — used to lower wall placement on elevated levels */
  floorTileHeight?: number;
}

export interface VoxelDungeonResult {
  debris: DebrisBox[];
  entities: Entity[];
  wallHeight: number;
}

export interface VoxelDungeonVisualResult {
  groundMeshList: THREE.Mesh[];
  wallMeshList: THREE.Mesh[];
  groundMaterial: THREE.MeshStandardMaterial;
  wallMaterial: THREE.MeshStandardMaterial;
  /** Average vertex color sampled from ground tiles — use for door frames etc. */
  groundColor: THREE.Color;
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
  const { openGrid, gridW, gridD, cellSize, groundSize, cellHeights } = config;
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

  // Helper: get the max cell height among open neighbors of a closed cell
  const getWallBaseY = (gx: number, gz: number): number => {
    if (!cellHeights) return 0;
    let maxH = -Infinity;
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const nx = gx + dx, nz = gz + dz;
      if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
      if (!openGrid[nz * gridW + nx]) continue;
      maxH = Math.max(maxH, cellHeights[nz * gridW + nx]);
    }
    return maxH === -Infinity ? 0 : maxH;
  };

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

      // Wall collision extends from lowest neighbor down to wallHeight above highest neighbor
      const baseY = getWallBaseY(gx, gz);
      const minNeighborY = cellHeights ? getMinOpenNeighborY(gx, gz, gridW, gridD, openGrid, cellHeights) : 0;
      const totalHeight = wallHeight + (baseY - minNeighborY);

      const geo = new THREE.BoxGeometry(cellSize, totalHeight, cellSize);
      const mat = new THREE.MeshBasicMaterial({ visible: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(wx, minNeighborY + totalHeight / 2, wz);
      mesh.userData.collisionOnly = true;
      group.add(mesh);

      entities.push(new Entity(mesh, {
        layer: Layer.Architecture,
        radius: half,
        weight: Infinity,
      }));

      debris.push({ x: wx, z: wz, halfW: half, halfD: half, height: baseY + wallHeight });
    }
  }

  // Foundation collision: invisible boxes under elevated open cells.
  // Prevents player from walking inside the space below raised floors.
  if (cellHeights) {
    for (let gz = 0; gz < gridD; gz++) {
      for (let gx = 0; gx < gridW; gx++) {
        if (!openGrid[gz * gridW + gx]) continue;
        const h = cellHeights[gz * gridW + gx];
        if (h < 0.01) continue; // ground level, no foundation needed

        const wx = toWorldX(gx);
        const wz = toWorldZ(gz);

        // Box from Y=0 up to the cell's floor height
        const geo = new THREE.BoxGeometry(cellSize, h, cellSize);
        const mat = new THREE.MeshBasicMaterial({ visible: false });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(wx, h / 2, wz);
        mesh.userData.collisionOnly = true;
        group.add(mesh);

        entities.push(new Entity(mesh, {
          layer: Layer.Architecture,
          radius: half,
          weight: Infinity,
        }));

        debris.push({ x: wx, z: wz, halfW: half, halfD: half, height: h });
      }
    }
  }

  return { debris, entities, wallHeight };
}

/** Get the minimum cell height among open neighbors of a cell */
function getMinOpenNeighborY(
  gx: number, gz: number,
  gridW: number, gridD: number,
  openGrid: boolean[],
  cellHeights: Float32Array,
): number {
  let minH = Infinity;
  for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const nx = gx + dx, nz = gz + dz;
    if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
    if (!openGrid[nz * gridW + nx]) continue;
    minH = Math.min(minH, cellHeights[nz * gridW + nx]);
  }
  return minH === Infinity ? 0 : minH;
}

/**
 * Load VOX meshes for every floor and wall cell. Call after collision is set up.
 */
export async function loadVoxelDungeonVisuals(
  config: VoxelDungeonConfig,
  group: THREE.Group,
): Promise<VoxelDungeonVisualResult | null> {
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
    return null;
  }

  const wallHeight = config.wallHeight ?? (17 * cellSize / 15);
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
  wallVisualGroup.name = 'wallVisuals';
  group.add(wallVisualGroup);
  new Entity(wallVisualGroup, { layer: Layer.Architecture, radius: groundSize, weight: 0 });

  let groundCount = 0;
  let wallCount = 0;
  const groundMeshList: THREE.Mesh[] = [];
  const wallMeshList: THREE.Mesh[] = [];

  // Ground tiles: randomized per-room/per-corridor, only normal (_a suffix) variants
  const { useGameStore } = await import('../../store');
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
  const convexCornerTile = getTileById(`${theme}:outer_wall_corner_c`) ?? getFirstTile('outer_wall_corner', theme);

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

      const mesh = placeVoxReturn(group, wx, wz, 'ground', 0, voxMat, tile, theme);
      if (mesh) {
        // Apply cell height offset
        if (config.cellHeights) {
          mesh.position.y = config.cellHeights[gz * gridW + gx];
        }
        groundMeshes.push(mesh);
        groundMeshList.push(mesh);
        // Tag with room ownership and cell index for visibility system
        mesh.userData.cellIndex = gz * gridW + gx;
        if (ownership) {
          mesh.userData.roomId = ownership[gz * gridW + gx];
        }
      }
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

      // Compute min/max adjacent cell height for this wall
      let minAdjacentH = Infinity;
      let maxAdjacentH = -Infinity;
      if (config.cellHeights) {
        for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const nx = gx + dx, nz = gz + dz;
          if (nx >= 0 && nx < gridW && nz >= 0 && nz < gridD && isOpen(nx, nz)) {
            const h = config.cellHeights[nz * gridW + nx];
            minAdjacentH = Math.min(minAdjacentH, h);
            maxAdjacentH = Math.max(maxAdjacentH, h);
          }
        }
      }
      if (minAdjacentH === Infinity) { minAdjacentH = 0; maxAdjacentH = 0; }

      // Compute adjacent room IDs for visibility, split by height level
      // so walls at height boundaries don't get registered under both levels
      const adjRoomsHigh = new Set<number>();
      const adjRoomsLow = new Set<number>();
      const adjRoomsAll = new Set<number>();
      const heightGap = maxAdjacentH - minAdjacentH;
      const heightMid = (maxAdjacentH + minAdjacentH) / 2;
      if (ownership) {
        for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const nx = gx + dx, nz = gz + dz;
          if (nx >= 0 && nx < gridW && nz >= 0 && nz < gridD) {
            const nid = ownership[nz * gridW + nx];
            if (nid !== undefined) {
              adjRoomsAll.add(nid);
              if (config.cellHeights && heightGap > wallHeight * 0.5) {
                const nH = config.cellHeights[nz * gridW + nx];
                if (nH >= heightMid) adjRoomsHigh.add(nid);
                else adjRoomsLow.add(nid);
              }
            }
          }
        }
      }

      // Place wall tile at maxAdjacentH
      const upperRoomIds = heightGap > wallHeight * 0.5 && adjRoomsHigh.size > 0 ? adjRoomsHigh : adjRoomsAll;
      const wallMesh = placeVoxReturn(wallVisualGroup, wx, wz, role, rot, wallMat, tileOverride, theme);
      if (wallMesh) {
        wallMesh.position.y = maxAdjacentH;
        wallMesh.userData.isWall = true;
        if (ownership && upperRoomIds.size > 0) {
          wallMesh.userData.roomIds = [...upperRoomIds];
          wallMeshList.push(wallMesh);
        }
      }

      // If adjacent open cells span a height gap, add a lower-tier copy of the
      // same wall to fill the visual gap. Only affects this closed cell — no
      // open cells, doors, or entrances are touched.
      if (heightGap > wallHeight * 0.5) {
        const lowerRoomIds = adjRoomsLow.size > 0 ? adjRoomsLow : adjRoomsAll;
        const lowerWall = placeVoxReturn(wallVisualGroup, wx, wz, role, rot, wallMat, tileOverride, theme);
        if (lowerWall) {
          lowerWall.position.y = minAdjacentH;
          lowerWall.userData.isWall = true;
          if (ownership && lowerRoomIds.size > 0) {
            lowerWall.userData.roomIds = [...lowerRoomIds];
            wallMeshList.push(lowerWall);
          }
        }
      }
      wallCount++;
    }
  }

  // ── Pass 2b: Stair side walls ──
  // Place outer_wall_segment tiles on each perpendicular side of stair cells.
  // Uses the same rotation as the corridor walls leading into the stair.
  if (config.stairs) {
    for (const stair of config.stairs) {
      const perpDirs: [number, number][] = stair.axis === 'x'
        ? [[0, -1], [0, 1]]   // stair along X → wall on north/south
        : [[-1, 0], [1, 0]];  // stair along Z → wall on east/west

      const stairIdx = stair.gz * gridW + stair.gx;
      const baseH = config.cellHeights ? config.cellHeights[stairIdx] : 0;

      for (const [dx, dz] of perpDirs) {
        const nx = stair.gx + dx, nz = stair.gz + dz;
        if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
        const nIdx = nz * gridW + nx;

        // Only place wall if that side cell is already closed (wall cell)
        // — we extend the existing corridor wall into the stair cell.
        // If the side is open, skip (don't block room space).
        if (isOpen(nx, nz)) continue;

        const wx = toWorldX(nx);
        const wz = toWorldZ(nz);

        // Rotation: wall faces toward the stair (open cell)
        // dx=-1 → wall faces east (+X) → rot = BASE_ROT + 90
        // dx=+1 → wall faces west (-X) → rot = BASE_ROT + 270
        // dz=-1 → wall faces south (+Z) → rot = BASE_ROT
        // dz=+1 → wall faces north (-Z) → rot = BASE_ROT + 180
        let rot = BASE_ROT;
        if (dx === -1)      rot = BASE_ROT + 90;
        else if (dx === 1)  rot = BASE_ROT + 270;
        else if (dz === -1) rot = BASE_ROT;
        else if (dz === 1)  rot = BASE_ROT + 180;

        const wallMesh = placeVoxReturn(wallVisualGroup, wx, wz, 'outer_wall_segment', rot, wallMat, null, theme);
        if (wallMesh) {
          wallMesh.position.y = baseH;
          wallMesh.userData.isWall = true;
          if (ownership) {
            const adjRooms = new Set<number>();
            for (const [adx, adz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
              const ax = nx + adx, az = nz + adz;
              if (ax >= 0 && ax < gridW && az >= 0 && az < gridD) {
                // Filter by height: only include neighbors at similar height
                if (config.cellHeights) {
                  const nH = config.cellHeights[az * gridW + ax];
                  if (Math.abs(nH - baseH) > wallHeight * 0.5) continue;
                }
                const rid = ownership[az * gridW + ax];
                if (rid !== undefined) adjRooms.add(rid);
              }
            }
            if (adjRooms.size > 0) {
              wallMesh.userData.roomIds = [...adjRooms];
              wallMeshList.push(wallMesh);
            }
          }
        }
      }
    }
  }

  // ── Pass 2d: Foundation walls under elevated floors ──
  // For every open cell above height 0, stack wall tiles downward to fill the
  // vertical gap. One column per exposed cardinal face (where neighbor is lower).
  // All stacks inherit the room ID of the floor cell above them so they always
  // match its visibility state (active/dimmed/hidden).
  if (config.cellHeights) {
    for (let gz = 0; gz < gridD; gz++) {
      for (let gx = 0; gx < gridW; gx++) {
        if (!isOpen(gx, gz)) continue;
        const idx = gz * gridW + gx;
        const h = config.cellHeights[idx];
        if (h < wallHeight * 0.5) continue; // skip ground-level cells

        const wx = toWorldX(gx);
        const wz = toWorldZ(gz);

        // Use the floor cell's own room ID so stacks match the tile above
        const cellRid = ownership ? ownership[idx] : undefined;

        for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as [number, number][]) {
          const nx = gx + dx, nz = gz + dz;
          // Neighbor height: out-of-bounds or closed cells count as 0
          let nh = 0;
          if (nx >= 0 && nx < gridW && nz >= 0 && nz < gridD) {
            nh = config.cellHeights[nz * gridW + nx];
          }
          if (nh >= h) continue; // neighbor is same or higher — not exposed

          // Wall faces toward the lower neighbor (exposed side)
          let rot = BASE_ROT;
          if (dz === 1)       rot = BASE_ROT;         // south neighbor lower → face south
          else if (dx === 1)  rot = BASE_ROT + 90;    // east neighbor lower  → face east
          else if (dz === -1) rot = BASE_ROT + 180;   // north neighbor lower → face north
          else if (dx === -1) rot = BASE_ROT + 270;   // west neighbor lower  → face west

          // Stack wall tiles from neighbor height up to (but not including) cell height
          const levels = Math.round((h - nh) / wallHeight);
          for (let lvl = 0; lvl < levels; lvl++) {
            const y = nh + lvl * wallHeight;
            const fMesh = placeVoxReturn(wallVisualGroup, wx, wz, 'outer_wall_segment', rot, wallMat, null, theme);
            if (fMesh) {
              fMesh.position.y = y;
              fMesh.userData.isWall = true;
              fMesh.userData.cellIndex = idx; // parent floor cell for stair landing lookup
              if (cellRid !== undefined && cellRid !== -1) {
                fMesh.userData.roomIds = [cellRid];
                wallMeshList.push(fMesh);
              }
            }
          }
        }
      }
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

  // console.log(`[VoxelDungeon] ${groundCount} ground + ${wallCount} wall tiles`);

  // Sample average vertex color from ground tiles for door frames etc.
  const groundColor = new THREE.Color(0xa8a0a0); // fallback
  if (groundMeshList.length > 0) {
    const colors = groundMeshList[0].geometry.getAttribute('color');
    if (colors) {
      let r = 0, g = 0, b = 0;
      const count = colors.count;
      for (let i = 0; i < count; i++) {
        r += colors.getX(i);
        g += colors.getY(i);
        b += colors.getZ(i);
      }
      groundColor.setRGB(r / count, g / count, b / count);
    }
  }

  return { groundMeshList, wallMeshList, groundMaterial: voxMat, wallMaterial: wallMat, groundColor };
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
  theme = 'a_a',
): THREE.Mesh | null {
  const entry = specificEntry ?? getFirstTile(role, theme);
  if (!entry) return null;

  const geo = getTileGeometry(entry);
  if (!geo) return null;

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = role;
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
  theme = 'a_a',
): void {
  placeVoxReturn(group, wx, wz, role, rotation, material, specificEntry, theme);
}
