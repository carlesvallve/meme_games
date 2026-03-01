// ── StairSystem ─────────────────────────────────────────────────────
// Room-level height variation via BFS. Each room gets a height level.
// Stairs placed at room-corridor boundaries where heights differ by 1 level.
// Ladders hinted where heights differ by >1 level.
// Corridors are always flat at the lower of their connected rooms.

import * as THREE from 'three';
import { SeededRandom } from '../utils/SeededRandom';

const STEPS_PER_TILE = 6;

export interface StairDef {
  gx: number;
  gz: number;
  direction: 1 | -1;
  axis: 'x' | 'z';
  totalHeight: number;
  levelHeight: number;
}

export interface LadderHint {
  lowGX: number; lowGZ: number;
  highGX: number; highGZ: number;
  lowH: number; highH: number;
}

const DIRS: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

/**
 * Assign per-cell heights and place stairs/ladders.
 *
 * 1. BFS from entrance room — each hop has a chance to go up 1 level
 * 2. Room cells get their room's height
 * 3. Corridor cells get the min height of their connected rooms
 *    (skipping cells that belong to a room — corridors can include room edge cells)
 * 4. At room-corridor boundaries with a height diff:
 *    1 level  → stair on the corridor cell, ascending toward the room
 *    >1 level → ladder hint
 */
export function computeCellHeights(
  roomOwnership: number[],
  openGrid: boolean[],
  entranceRoom: number,
  rooms: { x: number; z: number; w: number; d: number }[],
  gridW: number,
  gridD: number,
  corridors: { cells: { gx: number; gz: number }[] }[],
  stepH: number,
  levelH: number,
  rng: SeededRandom,
  heightChance = 0.4,
): { cellHeights: Float32Array; stairs: StairDef[]; ladderHints: LadderHint[] } {
  const cellHeights = new Float32Array(gridW * gridD);
  const stairs: StairDef[] = [];
  const ladderHints: LadderHint[] = [];

  if (levelH <= 0) return { cellHeights, stairs, ladderHints };

  // ── 1. Build corridor → rooms mapping ──
  type CorridorInfo = { rooms: number[]; cells: { gx: number; gz: number }[] };
  const corridorInfos: CorridorInfo[] = [];

  for (const corridor of corridors) {
    const touched = new Set<number>();
    for (const { gx, gz } of corridor.cells) {
      for (const [dx, dz] of DIRS) {
        const nx = gx + dx, nz = gz + dz;
        if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
        const rid = roomOwnership[nz * gridW + nx];
        if (rid >= 0) touched.add(rid);
      }
    }
    corridorInfos.push({ rooms: [...touched], cells: corridor.cells });
  }

  // ── 2. BFS room graph → assign room heights ──
  const roomAdj = new Map<number, number[]>();
  for (const ci of corridorInfos) {
    for (let a = 0; a < ci.rooms.length; a++) {
      for (let b = a + 1; b < ci.rooms.length; b++) {
        if (!roomAdj.has(ci.rooms[a])) roomAdj.set(ci.rooms[a], []);
        if (!roomAdj.has(ci.rooms[b])) roomAdj.set(ci.rooms[b], []);
        roomAdj.get(ci.rooms[a])!.push(ci.rooms[b]);
        roomAdj.get(ci.rooms[b])!.push(ci.rooms[a]);
      }
    }
  }

  const roomHeight = new Float32Array(rooms.length);
  const roomVisited = new Uint8Array(rooms.length);
  roomVisited[entranceRoom] = 1;

  const queue = [entranceRoom];
  let head = 0;
  while (head < queue.length) {
    const rid = queue[head++];
    for (const neighbor of roomAdj.get(rid) ?? []) {
      if (roomVisited[neighbor]) continue;
      roomVisited[neighbor] = 1;
      roomHeight[neighbor] = roomHeight[rid] + (rng.next() < heightChance ? levelH : 0);
      queue.push(neighbor);
    }
  }

  // ── 3. Set cell heights ──
  // Room cells
  for (let rid = 0; rid < rooms.length; rid++) {
    if (!roomVisited[rid]) continue;
    const r = rooms[rid];
    for (let gz = r.z; gz < r.z + r.d; gz++) {
      for (let gx = r.x; gx < r.x + r.w; gx++) {
        if (gx < 0 || gx >= gridW || gz < 0 || gz >= gridD) continue;
        cellHeights[gz * gridW + gx] = roomHeight[rid];
      }
    }
  }

  // Corridor cells — use min height, but skip cells owned by a room
  for (const ci of corridorInfos) {
    let minH = Infinity;
    for (const rid of ci.rooms) {
      if (roomVisited[rid] && roomHeight[rid] < minH) minH = roomHeight[rid];
    }
    if (minH === Infinity) minH = 0;
    for (const { gx, gz } of ci.cells) {
      const idx = gz * gridW + gx;
      if (roomOwnership[idx] >= 0) continue; // don't overwrite room cells
      cellHeights[idx] = minH;
    }
  }

  // ── 4. Place stairs and ladders ──
  // Simple two-pass approach:
  //   Pass 1: Scan ALL corridor-room boundaries. 1-level diff + floor top & bottom → stair. One per room pair.
  //   Pass 2: Any room pair with height diff that has NO stair → ONE ladder.

  const usedCells = new Set<number>();
  // Track which room pairs (min:max) already have a stair or ladder
  const connectedPairs = new Set<string>();
  const rpKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;

  // ── Pass 1: Place stairs at 1-level boundaries ──
  for (const ci of corridorInfos) {
    if (ci.rooms.length < 2) continue;

    const corridorCellSet = new Set<number>();
    for (const { gx: cx, gz: cz } of ci.cells) {
      const ci2 = cz * gridW + cx;
      if (roomOwnership[ci2] < 0) corridorCellSet.add(ci2);
    }

    for (const { gx, gz } of ci.cells) {
      const cellIdx = gz * gridW + gx;
      if (roomOwnership[cellIdx] >= 0) continue; // only corridor cells
      if (usedCells.has(cellIdx)) continue;

      for (const [dx, dz] of DIRS) {
        const nx = gx + dx, nz = gz + dz;
        if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
        const nIdx = nz * gridW + nx;
        const highRid = roomOwnership[nIdx];
        if (highRid < 0 || !roomVisited[highRid]) continue;
        if (!openGrid[nIdx]) continue; // top must be walkable floor

        // Find the low room on the opposite side of the corridor
        const corridorH = cellHeights[cellIdx];
        const roomH = roomHeight[highRid];
        const diff = roomH - corridorH;
        if (diff < levelH * 0.5 || diff > levelH * 1.1) continue; // not a 1-level diff

        // Find which low room this corridor belongs to
        let lowRid = -1;
        for (const rid of ci.rooms) {
          if (rid === highRid) continue;
          if (!roomVisited[rid]) continue;
          if (Math.abs(roomHeight[rid] - corridorH) < levelH * 0.3) { lowRid = rid; break; }
        }
        if (lowRid < 0) continue;

        const pk = rpKey(lowRid, highRid);
        if (connectedPairs.has(pk)) continue;

        // Check bottom cell is walkable, at correct (low) height,
        // and has at least one open neighbor (so the player can actually reach it)
        const feetX = gx - dx, feetZ = gz - dz;
        const feetInBounds = feetX >= 0 && feetX < gridW && feetZ >= 0 && feetZ < gridD;
        const feetIdx = feetInBounds ? feetZ * gridW + feetX : -1;
        let feetOpen = feetInBounds && openGrid[feetIdx]
          && Math.abs(cellHeights[feetIdx] - corridorH) < levelH * 0.3;
        if (feetOpen) {
          // Feet cell must connect to something — at least one open neighbor besides the stair
          let hasNeighbor = false;
          for (const [ndx, ndz] of DIRS) {
            if (ndx === dx && ndz === dz) continue; // skip direction back toward stair
            const nnx = feetX + ndx, nnz = feetZ + ndz;
            if (nnx >= 0 && nnx < gridW && nnz >= 0 && nnz < gridD && openGrid[nnz * gridW + nnx]) {
              hasNeighbor = true; break;
            }
          }
          if (!hasNeighbor) feetOpen = false;
        }

        // Try back-cell placement (stair on the cell behind, landing on gx,gz)
        let placed = false;
        if (feetOpen) {
          // Check for a corridor cell behind to use as stair cell
          let backGX = -1, backGZ = -1;
          for (const [bdx, bdz] of DIRS) {
            if (bdx === dx && bdz === dz) continue;
            const bx = gx + bdx, bz = gz + bdz;
            if (bx < 0 || bx >= gridW || bz < 0 || bz >= gridD) continue;
            const bIdx = bz * gridW + bx;
            if (corridorCellSet.has(bIdx) && !usedCells.has(bIdx)) {
              const stairDx = gx - bx, stairDz = gz - bz;
              if (stairDx === dx && stairDz === dz) { // straight line
                const fx = bx - stairDx, fz2 = bz - stairDz;
                if (fx >= 0 && fx < gridW && fz2 >= 0 && fz2 < gridD && openGrid[fz2 * gridW + fx]) {
                  backGX = bx; backGZ = bz;
                  break;
                }
              }
            }
          }

          if (backGX >= 0) {
            const stairDx = gx - backGX, stairDz = gz - backGZ;
            stairs.push({
              gx: backGX, gz: backGZ,
              axis: stairDx !== 0 ? 'x' : 'z',
              direction: (stairDx > 0 || stairDz > 0) ? 1 : -1,
              totalHeight: stepH, levelHeight: levelH,
            });
            usedCells.add(backGZ * gridW + backGX);
            usedCells.add(cellIdx);
            cellHeights[cellIdx] = roomHeight[highRid];
            connectedPairs.add(pk);
            placed = true;
          } else {
            // Direct placement: stair on this cell
            stairs.push({
              gx, gz,
              axis: dx !== 0 ? 'x' : 'z',
              direction: (dx > 0 || dz > 0) ? 1 : -1,
              totalHeight: stepH, levelHeight: levelH,
            });
            usedCells.add(cellIdx);
            connectedPairs.add(pk);
            placed = true;
          }
        }
        if (placed) break;
      }
    }
  }

  // ── Pass 2: ONE ladder for each unconnected room pair with height diff ──
  for (const ci of corridorInfos) {
    if (ci.rooms.length < 2) continue;
    for (let a = 0; a < ci.rooms.length; a++) {
      for (let b = a + 1; b < ci.rooms.length; b++) {
        const ra = ci.rooms[a], rb = ci.rooms[b];
        if (!roomVisited[ra] || !roomVisited[rb]) continue;
        const d = Math.abs(roomHeight[ra] - roomHeight[rb]);
        if (d < levelH * 0.5) continue;
        const pk = rpKey(ra, rb);
        if (connectedPairs.has(pk)) continue;

        const low = roomHeight[ra] <= roomHeight[rb] ? ra : rb;
        const high = low === ra ? rb : ra;

        // Find a corridor cell adjacent to the high room
        let found = false;
        for (const { gx, gz } of ci.cells) {
          if (roomOwnership[gz * gridW + gx] >= 0) continue;
          for (const [dx, dz] of DIRS) {
            const nx = gx + dx, nz = gz + dz;
            if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
            if (roomOwnership[nz * gridW + nx] !== high) continue;
            connectedPairs.add(pk);
            ladderHints.push({
              lowGX: gx, lowGZ: gz, highGX: nx, highGZ: nz,
              lowH: roomHeight[low], highH: roomHeight[high],
            });
            found = true; break;
          }
          if (found) break;
        }
      }
    }
  }

  // ── Pass 3: Global scan for any remaining unconnected room pairs ──
  // Catches pairs not sharing a corridor (connected through intermediate rooms)
  for (let gz = 0; gz < gridD; gz++) {
    for (let gx = 0; gx < gridW; gx++) {
      const idx = gz * gridW + gx;
      const ridA = roomOwnership[idx];
      if (ridA < 0 || !roomVisited[ridA]) continue;

      for (const [dx, dz] of DIRS) {
        const nx = gx + dx, nz = gz + dz;
        if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
        const nidx = nz * gridW + nx;
        const ridB = roomOwnership[nidx];
        if (ridB < 0 || ridB === ridA || !roomVisited[ridB]) continue;

        const d = Math.abs(roomHeight[ridA] - roomHeight[ridB]);
        if (d < levelH * 0.5) continue;
        const pk = rpKey(ridA, ridB);
        if (connectedPairs.has(pk)) continue;

        const low = roomHeight[ridA] <= roomHeight[ridB] ? ridA : ridB;
        const high = low === ridA ? ridB : ridA;
        const lowCell = roomHeight[ridA] <= roomHeight[ridB] ? { gx, gz } : { gx: nx, gz: nz };
        const highCell = roomHeight[ridA] <= roomHeight[ridB] ? { gx: nx, gz: nz } : { gx, gz };

        connectedPairs.add(pk);
        ladderHints.push({
          lowGX: lowCell.gx, lowGZ: lowCell.gz,
          highGX: highCell.gx, highGZ: highCell.gz,
          lowH: roomHeight[low], highH: roomHeight[high],
        });
      }
    }
  }

  console.log(`[StairSystem] ${corridorInfos.length} corridors — ${stairs.length} stairs, ${ladderHints.length} ladder hints`);
  return { cellHeights, stairs, ladderHints };
}

/** Build stair step meshes for each stair cell. */
export function buildStairMeshes(
  stairs: StairDef[],
  cellHeights: Float32Array,
  cellSize: number,
  gridW: number,
  groundSize: number,
  groundColor: THREE.Color,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'stairMeshes';

  const halfWorld = groundSize / 2;
  const toWorldX = (gx: number) => -halfWorld + (gx + 0.5) * cellSize;
  const toWorldZ = (gz: number) => -halfWorld + (gz + 0.5) * cellSize;

  const stairMat = new THREE.MeshStandardMaterial({
    color: groundColor,
    roughness: 0.85,
    metalness: 0.1,
  });

  const halfCell = cellSize / 2;
  const stepDepth = cellSize / STEPS_PER_TILE;

  for (const stair of stairs) {
    const idx = stair.gz * gridW + stair.gx;
    const baseY = cellHeights[idx];
    const wx = toWorldX(stair.gx);
    const wz = toWorldZ(stair.gz);
    const microStepH = stair.totalHeight / STEPS_PER_TILE;

    const stairGroup = new THREE.Group();
    stairGroup.position.set(wx, baseY, wz);

    for (let s = 0; s < STEPS_PER_TILE; s++) {
      const stepY = (s + 1) * microStepH;
      const stepW = stair.axis === 'x' ? stepDepth : cellSize;
      const stepD = stair.axis === 'z' ? stepDepth : cellSize;

      const stepOffset = stair.direction > 0
        ? -halfCell + (s + 0.5) * stepDepth
        : halfCell - (s + 0.5) * stepDepth;

      const stepX = stair.axis === 'x' ? stepOffset : 0;
      const stepZ = stair.axis === 'z' ? stepOffset : 0;

      const geo = new THREE.BoxGeometry(stepW, stepY, stepD);
      const mesh = new THREE.Mesh(geo, stairMat);
      mesh.position.set(stepX, stepY / 2, stepZ);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      stairGroup.add(mesh);
    }

    group.add(stairGroup);
  }

  return group;
}

/** Set of cell indices that are stair cells */
export function getStairCellSet(stairs: StairDef[], gridW: number): Set<number> {
  const set = new Set<number>();
  for (const stair of stairs) set.add(stair.gz * gridW + stair.gx);
  return set;
}
