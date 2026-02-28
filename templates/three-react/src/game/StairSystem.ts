// ── StairSystem ─────────────────────────────────────────────────────
// Procedural stairs in dungeon corridors that create height variation.
// Each staircase occupies exactly ONE grid cell and contains 4 micro-steps.
// Stairs only appear on straight corridor segments (3+ cells).
// Height flows outward from the entrance room via BFS.

import * as THREE from 'three';
import { SeededRandom } from '../utils/SeededRandom';

/** Number of micro-steps within a single stair tile */
const STEPS_PER_TILE = 6;

export interface StairDef {
  /** Grid position of the stair cell */
  gx: number;
  gz: number;
  /** +1 = ascending along positive axis, -1 = descending */
  direction: 1 | -1;
  /** Axis of the corridor: 'x' = runs along X, 'z' = runs along Z */
  axis: 'x' | 'z';
  /** Visual height of the stair geometry (wall + floor tile height) */
  totalHeight: number;
  /** Height change propagated to the next level (wall height only, excludes floor tile) */
  levelHeight: number;
}

/**
 * Identify which corridors are "tree edges" vs "loop edges" in the room graph.
 * Only tree-edge corridors are safe for stairs — loop corridors must stay flat
 * to avoid height inconsistencies when the dungeon graph has cycles.
 */
function identifyTreeCorridors(
  corridors: { cells: { gx: number; gz: number }[] }[],
  roomOwnership: number[],
  gridW: number,
  gridD: number,
  entranceRoom: number,
  roomCount: number,
): Set<number> {
  // For each corridor, find which rooms it connects (adjacent to corridor endpoints)
  const corridorRooms: [number, number][] = [];
  for (const corridor of corridors) {
    const touchedRooms = new Set<number>();
    for (const { gx, gz } of corridor.cells) {
      // Check this cell and its neighbors for room ownership
      for (const [dx, dz] of [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = gx + dx, nz = gz + dz;
        if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
        const rid = roomOwnership[nz * gridW + nx];
        if (rid >= 0) touchedRooms.add(rid);
      }
    }
    const rooms = [...touchedRooms];
    if (rooms.length >= 2) {
      corridorRooms.push([rooms[0], rooms[1]]);
    } else {
      // Corridor doesn't connect two distinct rooms — treat as tree edge (safe)
      corridorRooms.push([-1, -1]);
    }
  }

  // BFS on room graph from entrance room to find spanning tree edges
  const treeCorridors = new Set<number>();
  const visitedRooms = new Set<number>();
  visitedRooms.add(entranceRoom);

  // Build adjacency: room → list of { otherRoom, corridorIndex }
  const adj = new Map<number, { room: number; ci: number }[]>();
  for (let ci = 0; ci < corridorRooms.length; ci++) {
    const [a, b] = corridorRooms[ci];
    if (a < 0 || b < 0) {
      treeCorridors.add(ci); // non-room corridors are safe
      continue;
    }
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push({ room: b, ci });
    adj.get(b)!.push({ room: a, ci });
  }

  const queue = [entranceRoom];
  let head = 0;
  while (head < queue.length) {
    const room = queue[head++];
    for (const edge of adj.get(room) ?? []) {
      if (visitedRooms.has(edge.room)) continue;
      visitedRooms.add(edge.room);
      treeCorridors.add(edge.ci);
      queue.push(edge.room);
    }
  }

  return treeCorridors;
}

/**
 * Find corridor cells eligible for stairs, then pick individual cells.
 * Each stair is exactly 1 cell with 4 steps inside it.
 * Only places stairs in tree-edge corridors (not loop corridors) to prevent
 * height inconsistencies when the dungeon graph has cycles.
 */
export function findStairCandidates(
  roomOwnership: number[],
  corridors: { cells: { gx: number; gz: number }[] }[],
  gridW: number,
  gridD: number,
  stepH: number,
  levelH: number,
  rng: SeededRandom,
  entranceRoom: number,
  roomCount: number,
): StairDef[] {
  // Identify which corridors are tree edges (safe for stairs)
  const treeCorridors = identifyTreeCorridors(
    corridors, roomOwnership, gridW, gridD, entranceRoom, roomCount,
  );

  const stairs: StairDef[] = [];
  const usedCells = new Set<number>();

  for (let corridorIdx = 0; corridorIdx < corridors.length; corridorIdx++) {
    // Skip loop corridors — stairs here would create height mismatches
    if (!treeCorridors.has(corridorIdx)) continue;

    const corridor = corridors[corridorIdx];
    const segments = extractStraightSegments(corridor.cells);

    for (const seg of segments) {
      if (seg.cells.length < 3) continue;

      // Pick cells for stairs from the interior of the segment (skip first/last for buffer)
      // Only pick cells that aren't adjacent to rooms (avoid blocking doorways)
      const candidates: number[] = [];
      for (let i = 1; i < seg.cells.length - 1; i++) {
        const c = seg.cells[i];
        if (usedCells.has(c.gz * gridW + c.gx)) continue;
        if (isAdjacentToRoom(c.gx, c.gz, roomOwnership, gridW, gridD)) continue;
        // Also ensure neighbors along the segment aren't used (min 2 flat cells between stairs)
        const prevIdx = seg.cells[i - 1].gz * gridW + seg.cells[i - 1].gx;
        const nextIdx = seg.cells[i + 1].gz * gridW + seg.cells[i + 1].gx;
        if (usedCells.has(prevIdx) || usedCells.has(nextIdx)) continue;
        candidates.push(i);
      }

      if (candidates.length === 0) continue;

      // ~40% chance per segment to get a staircase, pick 1 cell
      if (rng.next() > 0.4) continue;

      const ci = candidates[Math.floor(rng.next() * candidates.length)];
      const cell = seg.cells[ci];
      const direction: 1 | -1 = rng.next() < 0.5 ? 1 : -1;

      usedCells.add(cell.gz * gridW + cell.gx);

      stairs.push({
        gx: cell.gx,
        gz: cell.gz,
        direction,
        axis: seg.axis,
        totalHeight: stepH,
        levelHeight: levelH,
      });
    }
  }

  return stairs;
}

/** Check if a cell is cardinally adjacent to a room cell (roomOwnership >= 0) */
function isAdjacentToRoom(gx: number, gz: number, roomOwnership: number[], gridW: number, gridD: number): boolean {
  for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const nx = gx + dx, nz = gz + dz;
    if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
    if (roomOwnership[nz * gridW + nx] >= 0) return true;
  }
  return false;
}

/** Extract runs of cells that share the same row (gz) or column (gx). */
function extractStraightSegments(
  cells: { gx: number; gz: number }[],
): { cells: { gx: number; gz: number }[]; axis: 'x' | 'z' }[] {
  if (cells.length < 2) return [];

  const segments: { cells: { gx: number; gz: number }[]; axis: 'x' | 'z' }[] = [];
  let currentRun: { gx: number; gz: number }[] = [cells[0]];
  let currentAxis: 'x' | 'z' | null = null;

  for (let i = 1; i < cells.length; i++) {
    const prev = cells[i - 1];
    const curr = cells[i];

    if (curr.gz === prev.gz && Math.abs(curr.gx - prev.gx) === 1) {
      if (currentAxis === 'x' || currentAxis === null) {
        currentAxis = 'x';
        currentRun.push(curr);
      } else {
        if (currentRun.length >= 3) segments.push({ cells: currentRun, axis: currentAxis });
        currentRun = [prev, curr];
        currentAxis = 'x';
      }
    } else if (curr.gx === prev.gx && Math.abs(curr.gz - prev.gz) === 1) {
      if (currentAxis === 'z' || currentAxis === null) {
        currentAxis = 'z';
        currentRun.push(curr);
      } else {
        if (currentRun.length >= 3) segments.push({ cells: currentRun, axis: currentAxis });
        currentRun = [prev, curr];
        currentAxis = 'z';
      }
    } else {
      if (currentRun.length >= 3 && currentAxis) segments.push({ cells: currentRun, axis: currentAxis });
      currentRun = [curr];
      currentAxis = null;
    }
  }

  if (currentRun.length >= 3 && currentAxis) segments.push({ cells: currentRun, axis: currentAxis });
  return segments;
}

/**
 * BFS from entrance room outward to compute per-cell heights.
 * Non-stair cells inherit parent height.
 * Stair cells: the cell itself sits at the LOW side height.
 * Cells beyond a stair (on the high side) are at lowHeight + totalHeight.
 * Room cells all share the height at which BFS first reaches them.
 */
export function computeCellHeights(
  stairs: StairDef[],
  roomOwnership: number[],
  openGrid: boolean[],
  entranceRoom: number,
  rooms: { x: number; z: number; w: number; d: number }[],
  gridW: number,
  gridD: number,
  corridors: { cells: { gx: number; gz: number }[] }[],
): Float32Array {
  const totalCells = gridW * gridD;
  const cellHeights = new Float32Array(totalCells);
  const visited = new Uint8Array(totalCells);

  // Build stair lookup: cell index → StairDef
  const stairMap = new Map<number, StairDef>();
  for (const stair of stairs) {
    stairMap.set(stair.gz * gridW + stair.gx, stair);
  }

  // Room height tracking
  const roomHeight = new Float32Array(rooms.length);
  const roomVisited = new Uint8Array(rooms.length);

  // Seed BFS with entrance room cells at height 0
  const queue: number[] = [];
  const eRoom = rooms[entranceRoom];
  if (eRoom) {
    roomVisited[entranceRoom] = 1;
    for (let gz = eRoom.z; gz < eRoom.z + eRoom.d; gz++) {
      for (let gx = eRoom.x; gx < eRoom.x + eRoom.w; gx++) {
        if (gx < 0 || gx >= gridW || gz < 0 || gz >= gridD) continue;
        const idx = gz * gridW + gx;
        if (!openGrid[idx]) continue;
        visited[idx] = 1;
        queue.push(idx);
      }
    }
  }

  let head = 0;

  while (head < queue.length) {
    const idx = queue[head++];
    const gx = idx % gridW;
    const gz = (idx - gx) / gridW;
    const myHeight = cellHeights[idx];

    // Check if current cell is a stair — if so, neighbors on the "high side" get boosted
    const myStair = stairMap.get(idx);

    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const nx = gx + dx, nz = gz + dz;
      if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
      const nIdx = nz * gridW + nx;
      if (visited[nIdx] || !openGrid[nIdx]) continue;

      let neighborHeight = myHeight;

      // If we're leaving a stair cell on its high side, height changes
      if (myStair) {
        const isHighSide = isOnHighSide(myStair, gx, gz, nx, nz);
        if (isHighSide) {
          neighborHeight = myHeight + myStair.levelHeight;
        }
      }

      // If we're entering a stair cell from its high side, the stair base is lower
      const neighborStair = stairMap.get(nIdx);
      if (neighborStair) {
        const enteringFromHigh = isOnHighSide(neighborStair, nx, nz, gx, gz);
        if (enteringFromHigh) {
          // We're coming from the high side — stair base = our height - totalHeight
          neighborHeight = myHeight - neighborStair.levelHeight;
        }
        // Entering from low side: stair base = myHeight (no change)
      }

      // Room batch-fill
      const rid = roomOwnership[nIdx];
      if (rid >= 0) {
        if (!roomVisited[rid]) {
          roomVisited[rid] = 1;
          roomHeight[rid] = neighborHeight;

          const r = rooms[rid];
          for (let rz = r.z; rz < r.z + r.d; rz++) {
            for (let rx = r.x; rx < r.x + r.w; rx++) {
              if (rx < 0 || rx >= gridW || rz < 0 || rz >= gridD) continue;
              const rIdx = rz * gridW + rx;
              if (!openGrid[rIdx] || visited[rIdx]) continue;
              visited[rIdx] = 1;
              cellHeights[rIdx] = neighborHeight;
              queue.push(rIdx);
            }
          }
          continue;
        } else {
          neighborHeight = roomHeight[rid];
        }
      }

      visited[nIdx] = 1;
      cellHeights[nIdx] = neighborHeight;
      queue.push(nIdx);
    }
  }

  // ── Post-BFS: fix loop corridors that bridge rooms at different heights ──
  // For each corridor without stairs, if endpoint rooms differ in height,
  // linearly interpolate corridor cell heights to create a smooth ramp.
  const stairCellSet = new Set<number>();
  for (const s of stairs) stairCellSet.add(s.gz * gridW + s.gx);

  for (const corridor of corridors) {
    // Check if corridor has any stair cells — if so, BFS already handled it
    let hasStairs = false;
    for (const { gx, gz } of corridor.cells) {
      if (stairCellSet.has(gz * gridW + gx)) { hasStairs = true; break; }
    }
    if (hasStairs) continue;

    // Find the two endpoint rooms (distinct room IDs touching the corridor)
    let startRoomId = -1, endRoomId = -1;
    let startCellIdx = 0, endCellIdx = corridor.cells.length - 1;

    // Walk from start to find first room-adjacent cell
    for (let i = 0; i < corridor.cells.length; i++) {
      const { gx, gz } = corridor.cells[i];
      for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = gx + dx, nz = gz + dz;
        if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
        const rid = roomOwnership[nz * gridW + nx];
        if (rid >= 0) { startRoomId = rid; startCellIdx = i; break; }
      }
      if (startRoomId >= 0) break;
    }

    // Walk from end to find last room-adjacent cell (different room)
    for (let i = corridor.cells.length - 1; i >= 0; i--) {
      const { gx, gz } = corridor.cells[i];
      for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const nx = gx + dx, nz = gz + dz;
        if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
        const rid = roomOwnership[nz * gridW + nx];
        if (rid >= 0 && rid !== startRoomId) { endRoomId = rid; endCellIdx = i; break; }
      }
      if (endRoomId >= 0) break;
    }

    if (startRoomId < 0 || endRoomId < 0 || !roomVisited[startRoomId] || !roomVisited[endRoomId]) continue;

    const startH = roomHeight[startRoomId];
    const endH = roomHeight[endRoomId];
    if (Math.abs(startH - endH) < 0.001) continue; // same height, no ramp needed

    // Linearly interpolate corridor cell heights between the two room heights
    const span = Math.max(1, endCellIdx - startCellIdx);
    for (let i = startCellIdx; i <= endCellIdx; i++) {
      const t = (i - startCellIdx) / span;
      const { gx, gz } = corridor.cells[i];
      const idx = gz * gridW + gx;
      cellHeights[idx] = startH + t * (endH - startH);
    }
  }

  return cellHeights;
}

/**
 * Check if moving from (gx,gz) to (nx,nz) goes to the "high side" of the stair.
 * For axis='x', direction=+1: high side is +X. direction=-1: high side is -X.
 * For axis='z', direction=+1: high side is +Z. direction=-1: high side is -Z.
 */
function isOnHighSide(stair: StairDef, fromGX: number, fromGZ: number, toGX: number, toGZ: number): boolean {
  if (stair.axis === 'x') {
    return (toGX - fromGX) * stair.direction > 0;
  } else {
    return (toGZ - fromGZ) * stair.direction > 0;
  }
}

/**
 * Build 4-step stair meshes for each stair cell.
 * Each stair is a set of 4 box steps within a single grid cell.
 * The stair goes from cellHeight (low side) to cellHeight + totalHeight (high side).
 */
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
  const stepDepth = cellSize / STEPS_PER_TILE; // each step's depth along the stair axis

  for (const stair of stairs) {
    const idx = stair.gz * gridW + stair.gx;
    const baseY = cellHeights[idx]; // low side height
    const wx = toWorldX(stair.gx);
    const wz = toWorldZ(stair.gz);
    const microStepH = stair.totalHeight / STEPS_PER_TILE;

    const stairGroup = new THREE.Group();
    stairGroup.position.set(wx, baseY, wz);

    for (let s = 0; s < STEPS_PER_TILE; s++) {
      // Each step: a box that extends from the low edge up to its step height
      // Step s has height: (s + 1) * microStepH
      // Step s spans: from s * stepDepth to (s + 1) * stepDepth along the axis
      const stepY = (s + 1) * microStepH;
      const stepW = stair.axis === 'x' ? stepDepth : cellSize;
      const stepD = stair.axis === 'z' ? stepDepth : cellSize;

      // Position along the stair axis: steps go from -halfCell to +halfCell
      // direction=+1: step 0 at -halfCell (low), step 3 at +halfCell (high)
      // direction=-1: step 0 at +halfCell (low), step 3 at -halfCell (high)
      let stepOffset: number;
      if (stair.direction > 0) {
        stepOffset = -halfCell + (s + 0.5) * stepDepth;
      } else {
        stepOffset = halfCell - (s + 0.5) * stepDepth;
      }

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

/** Returns a Set of cell indices that are stair cells (for skipping ground tile placement) */
export function getStairCellSet(stairs: StairDef[], gridW: number): Set<number> {
  const set = new Set<number>();
  for (const stair of stairs) {
    set.add(stair.gz * gridW + stair.gx);
  }
  return set;
}
