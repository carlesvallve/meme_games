// ── Dungeon & Rooms Generator ──────────────────────────────────────
// Produces BoxDef arrays (floors + walls) for the Terrain system.
// Two modes: BSP-partitioned dungeon and adjacent-rooms grid.

import { SeededRandom } from '../../utils/SeededRandom';

/** Module-level seeded RNG — set at start of generateDungeon(), used by all internal helpers. */
let rng = new SeededRandom(0);

// ── Lightweight spatial noise for loop corridor modulation ──────────

function buildPerm256(seed: number): Uint8Array {
  const p = new Uint8Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed | 0;
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) | 0;
    const j = ((s >>> 0) % (i + 1));
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  return p;
}

/** Value noise 0–1 with smoothstep interpolation. */
function valNoise2D(x: number, z: number, perm: Uint8Array): number {
  const xi = Math.floor(x), zi = Math.floor(z);
  const tx = x - xi, tz = z - zi;
  const stx = tx * tx * (3 - 2 * tx), stz = tz * tz * (3 - 2 * tz);
  const ix = xi & 255, iz = zi & 255;
  const v00 = perm[perm[ix] + iz] / 255;
  const v10 = perm[perm[(ix + 1) & 255] + iz] / 255;
  const v01 = perm[perm[ix] + ((iz + 1) & 255)] / 255;
  const v11 = perm[perm[(ix + 1) & 255] + ((iz + 1) & 255)] / 255;
  return (v00 + stx * (v10 - v00)) + stz * ((v01 + stx * (v11 - v01)) - (v00 + stx * (v10 - v00)));
}

export interface BoxDef {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

/** Walk mask returned alongside boxes so NavGrid can block non-dungeon cells */
export interface WalkMask {
  openGrid: boolean[];
  gridW: number;
  gridD: number;
  cellSize: number;
}

export interface DoorDef {
  x: number;
  z: number;
  orientation: 'NS' | 'EW';
  /** Width of the opening in grid cells (1 = single door, 2+ = double doors) */
  gapWidth: number;
}

export interface DungeonOutput {
  boxes: BoxDef[];
  walkMask: WalkMask;
  roomCount: number;
  corridorCount: number;
  doors: DoorDef[];
  /** Doors in grid coordinates (before world-space conversion) */
  gridDoors: DoorDef[];
  /** Room rects in grid coordinates */
  rooms: { x: number; z: number; w: number; d: number }[];
  /** Per-cell room index (-1 = corridor, >= 0 = room index) */
  roomOwnership: number[];
  /** Corridor cell arrays — each corridor is a list of grid cells */
  corridors: { cells: { gx: number; gz: number }[] }[];
  /** Index into rooms[] for the entrance room (player spawn) */
  entranceRoom: number;
  /** Index into rooms[] for the exit room (next level trigger) */
  exitRoom: number;
  /** Seed used for this generation (for deterministic replay) */
  seed: number;
  /** Number of extra loop corridors carved for circular paths */
  loopCorridors: number;
}

/**
 * High-level entry point: generate a BSP dungeon layout.
 * Returns box definitions and a walk mask for NavGrid integration.
 */
export function generateDungeon(
  groundSize: number,
  cellSizeOverride?: number,
  roomSpacing?: number,
  doorChance = 1.0,
  seed?: number,
  loopChance = 0.35,
  roomSpacingMax?: number,
): DungeonOutput {
  // Initialize seeded RNG — use provided seed or generate a random one
  const actualSeed = seed ?? (Math.random() * 0xFFFFFFFF) >>> 0;
  rng = new SeededRandom(actualSeed);
  const cellSize = cellSizeOverride ?? 2;
  const gridW = Math.floor(groundSize / cellSize);
  const gridD = gridW;
  const wallHeight = 2.5;

  const result = generateBSPDungeon(gridW, gridD, 2, 6, roomSpacing ?? 2, doorChance, loopChance, roomSpacingMax);

  const boxes = convertToBoxDefs(result, cellSize, wallHeight, groundSize);

  // Convert grid-space door defs to world-space
  const halfWorld = groundSize / 2;
  const { gridW: gw, gridD: gd } = result;

  const doors: DoorDef[] = [];
  const shiftedGridDoors: DoorDef[] = [];
  const roomGrid = result.roomOwnership;
  for (const d of result.doors || []) {
    let wx = -halfWorld + (d.x + 0.5) * cellSize;
    let wz = -halfWorld + (d.z + 0.5) * cellSize;

    // For voxel dungeon: nudge door half a cell toward the nearest room
    if (roomGrid) {
      const dirs: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      for (const [sx, sz] of dirs) {
        const nx = d.x + sx, nz = d.z + sz;
        if (nx < 0 || nx >= gw || nz < 0 || nz >= gd) continue;
        if (roomGrid[nz * gw + nx] >= 0) {
          wx += sx * cellSize * 0.25;
          wz += sz * cellSize * 0.25;
          break;
        }
      }
    }

    doors.push({ x: wx, z: wz, orientation: d.orientation, gapWidth: d.gapWidth });
    shiftedGridDoors.push({ x: d.x, z: d.z, orientation: d.orientation, gapWidth: d.gapWidth });
  }
  // console.log(`[DOOR] final world-space doors: ${doors.length}`);

  // Find entrance/exit by longest path distance through the room graph
  const roomRects = result.rooms.map(r => r.rect);
  let entranceRoom = 0;
  let exitRoom = roomRects.length > 1 ? 1 : 0;

  if (roomRects.length > 1) {
    // Build room adjacency from corridors
    const roomAdj = new Map<number, Set<number>>();
    for (const corridor of result.corridors) {
      const touched = new Set<number>();
      for (const { gx, gz } of corridor.cells) {
        for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as [number, number][]) {
          const nx = gx + dx, nz = gz + dz;
          if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
          const rid = result.roomOwnership![nz * gridW + nx];
          if (rid >= 0) touched.add(rid);
        }
      }
      const arr = [...touched];
      for (let a = 0; a < arr.length; a++) {
        for (let b = a + 1; b < arr.length; b++) {
          if (!roomAdj.has(arr[a])) roomAdj.set(arr[a], new Set());
          if (!roomAdj.has(arr[b])) roomAdj.set(arr[b], new Set());
          roomAdj.get(arr[a])!.add(arr[b]);
          roomAdj.get(arr[b])!.add(arr[a]);
        }
      }
    }

    // BFS from each room to find path distances
    const bfsFrom = (start: number): number[] => {
      const dist = new Array(roomRects.length).fill(-1);
      dist[start] = 0;
      const q = [start];
      let head = 0;
      while (head < q.length) {
        const cur = q[head++];
        for (const nb of roomAdj.get(cur) ?? []) {
          if (dist[nb] === -1) {
            dist[nb] = dist[cur] + 1;
            q.push(nb);
          }
        }
      }
      return dist;
    };

    // Find max BFS path distance
    let bestPathDist = 0;
    const pairCandidates: { a: number; b: number; pathDist: number; linDistSq: number }[] = [];
    for (let i = 0; i < roomRects.length; i++) {
      const dists = bfsFrom(i);
      for (let j = i + 1; j < roomRects.length; j++) {
        if (dists[j] <= 0) continue;
        if (dists[j] > bestPathDist) bestPathDist = dists[j];
        const cx1 = roomRects[i].x + roomRects[i].w / 2;
        const cz1 = roomRects[i].z + roomRects[i].d / 2;
        const cx2 = roomRects[j].x + roomRects[j].w / 2;
        const cz2 = roomRects[j].z + roomRects[j].d / 2;
        const linDistSq = (cx2 - cx1) ** 2 + (cz2 - cz1) ** 2;
        pairCandidates.push({ a: i, b: j, pathDist: dists[j], linDistSq });
      }
    }

    // Require at least half the max BFS distance (filters trivially close rooms)
    const minPath = Math.max(2, Math.ceil(bestPathDist * 0.5));
    const qualified = pairCandidates.filter(p => p.pathDist >= minPath);

    // Among qualified, sort by linear distance (descending) and pick from top 3
    const pool = (qualified.length > 0 ? qualified : pairCandidates)
      .sort((a, b) => b.linDistSq - a.linDistSq);
    const topN = Math.min(3, pool.length);
    if (topN > 0) {
      const pick = pool[Math.floor(rng.next() * topN)];
      if (rng.next() < 0.5) {
        entranceRoom = pick.a;
        exitRoom = pick.b;
      } else {
        entranceRoom = pick.b;
        exitRoom = pick.a;
      }
    }
  }

  return {
    boxes,
    walkMask: {
      openGrid: result.openGrid,
      gridW,
      gridD,
      cellSize,
    },
    roomCount: result.rooms.length,
    corridorCount: result.corridors.length,
    doors,
    gridDoors: shiftedGridDoors,
    rooms: roomRects,
    roomOwnership: result.roomOwnership ?? new Array(gridW * gridD).fill(-1),
    corridors: result.corridors,
    entranceRoom,
    exitRoom,
    seed: actualSeed,
    loopCorridors: result.loopCorridors ?? 0,
  };
}

interface Rect {
  x: number;
  z: number;
  w: number;
  d: number;
}

interface DungeonRoom {
  rect: Rect;
}

interface DungeonCorridor {
  cells: { gx: number; gz: number }[];
}

export interface DungeonResult {
  rooms: DungeonRoom[];
  corridors: DungeonCorridor[];
  /** 2D boolean grid — true = open/walkable */
  openGrid: boolean[];
  gridW: number;
  gridD: number;
  /** Door definitions in grid coordinates */
  doors?: DoorDef[];
  /** Per-cell room index (-1 = not in a room). Used to generate shared walls between rooms. */
  roomOwnership?: number[];
  /** Number of extra loop corridors carved */
  loopCorridors?: number;
}

// ── BSP Tree ───────────────────────────────────────────────────────

interface BSPNode {
  rect: Rect;
  left: BSPNode | null;
  right: BSPNode | null;
  room: Rect | null;
}

function splitBSP(rect: Rect, minSize: number, depth: number, maxDepth: number): BSPNode {
  const node: BSPNode = { rect, left: null, right: null, room: null };
  if (depth >= maxDepth || (rect.w <= minSize * 2 && rect.d <= minSize * 2)) {
    return node;
  }

  // Prefer splitting along longer axis
  const splitH = rect.w > rect.d ? rng.next() < 0.7
               : rect.d > rect.w ? rng.next() < 0.3
               : rng.next() < 0.5;

  if (splitH) {
    // Split horizontally (along x)
    if (rect.w <= minSize * 2) return node;
    const split = minSize + Math.floor(rng.next() * (rect.w - minSize * 2 + 1));
    node.left = splitBSP({ x: rect.x, z: rect.z, w: split, d: rect.d }, minSize, depth + 1, maxDepth);
    node.right = splitBSP({ x: rect.x + split, z: rect.z, w: rect.w - split, d: rect.d }, minSize, depth + 1, maxDepth);
  } else {
    // Split vertically (along z)
    if (rect.d <= minSize * 2) return node;
    const split = minSize + Math.floor(rng.next() * (rect.d - minSize * 2 + 1));
    node.left = splitBSP({ x: rect.x, z: rect.z, w: rect.w, d: split }, minSize, depth + 1, maxDepth);
    node.right = splitBSP({ x: rect.x, z: rect.z + split, w: rect.w, d: rect.d - split }, minSize, depth + 1, maxDepth);
  }

  return node;
}

function placeRoomsInBSP(node: BSPNode, minRoomSize: number, minPadding: number, maxPadding: number, maxRoomSize: number): void {
  if (!node.left && !node.right) {
    // Leaf node — randomize padding within [minPadding, maxPadding],
    // capped so the room still fits.
    const maxFitPad = Math.floor((Math.min(node.rect.w, node.rect.d) - minRoomSize) / 2);
    const padding = minPadding + Math.floor(rng.next() * (Math.min(maxPadding, maxFitPad) - minPadding + 1));
    const availW = node.rect.w - padding * 2;
    const availD = node.rect.d - padding * 2;
    if (availW < minRoomSize || availD < minRoomSize) {
      return;
    }
    const capW = Math.min(availW, maxRoomSize);
    const capD = Math.min(availD, maxRoomSize);
    // Random size between minRoomSize and capped max
    const w = minRoomSize + Math.floor(rng.next() * (capW - minRoomSize + 1));
    const d = minRoomSize + Math.floor(rng.next() * (capD - minRoomSize + 1));
    // Center within padded area
    const x = node.rect.x + padding + Math.floor((availW - w) / 2);
    const z = node.rect.z + padding + Math.floor((availD - d) / 2);
    node.room = { x, z, w, d };
    return;
  }
  if (node.left) placeRoomsInBSP(node.left, minRoomSize, minPadding, maxPadding, maxRoomSize);
  if (node.right) placeRoomsInBSP(node.right, minRoomSize, minPadding, maxPadding, maxRoomSize);
}

function collectRooms(node: BSPNode): Rect[] {
  if (node.room) return [node.room];
  const rooms: Rect[] = [];
  if (node.left) rooms.push(...collectRooms(node.left));
  if (node.right) rooms.push(...collectRooms(node.right));
  return rooms;
}

/** Get the center point of a room rect */
function roomCenter(r: Rect): { gx: number; gz: number } {
  return { gx: Math.floor(r.x + r.w / 2), gz: Math.floor(r.z + r.d / 2) };
}

/** Get a point on room's edge closest to target, clamped to room interior */
function roomEdgeToward(r: Rect, target: { gx: number; gz: number }): { gx: number; gz: number } {
  const cx = Math.floor(r.x + r.w / 2);
  const cz = Math.floor(r.z + r.d / 2);
  const dx = target.gx - cx;
  const dz = target.gz - cz;

  // Move from center toward target, stopping at room edge
  if (Math.abs(dx) > Math.abs(dz)) {
    // Primarily horizontal — exit through east or west edge
    const edgeX = dx > 0 ? r.x + r.w - 1 : r.x;
    return { gx: edgeX, gz: Math.max(r.z, Math.min(r.z + r.d - 1, target.gz)) };
  } else {
    // Primarily vertical — exit through north or south edge
    const edgeZ = dz > 0 ? r.z + r.d - 1 : r.z;
    return { gx: Math.max(r.x, Math.min(r.x + r.w - 1, target.gx)), gz: edgeZ };
  }
}

/** Connect two BSP sibling subtrees with an L-shaped corridor */
function connectBSPSiblings(
  node: BSPNode,
  openGrid: boolean[],
  gridW: number,
  corridors: DungeonCorridor[],
): void {
  if (!node.left || !node.right) return;

  // Recurse first
  connectBSPSiblings(node.left, openGrid, gridW, corridors);
  connectBSPSiblings(node.right, openGrid, gridW, corridors);

  // Connect: pick the closest pair of rooms from each subtree
  const leftRooms = collectRooms(node.left);
  const rightRooms = collectRooms(node.right);
  if (leftRooms.length === 0 || rightRooms.length === 0) return;

  // Find the pair with shortest center-to-center distance
  let bestDist = Infinity;
  let bestL = leftRooms[0], bestR = rightRooms[0];
  for (const lr of leftRooms) {
    for (const rr of rightRooms) {
      const ac = roomCenter(lr), bc = roomCenter(rr);
      const d = Math.abs(ac.gx - bc.gx) + Math.abs(ac.gz - bc.gz);
      if (d < bestDist) { bestDist = d; bestL = lr; bestR = rr; }
    }
  }

  // Connect from nearest edges instead of centers
  const a = roomEdgeToward(bestL, roomCenter(bestR));
  const b = roomEdgeToward(bestR, roomCenter(bestL));

  corridors.push(carveLCorridor(a.gx, a.gz, b.gx, b.gz, openGrid, gridW));
}

/** Connect rooms using Prim's MST — always picks the nearest unconnected room */
/** Returns MST adjacency list so addLoopCorridors can detect cross-branch pairs */
function connectRoomsMST(
  rooms: DungeonRoom[],
  openGrid: boolean[],
  gridW: number,
  corridors: DungeonCorridor[],
): Map<number, number[]> {
  const adj = new Map<number, number[]>();
  if (rooms.length < 2) return adj;

  const connected = new Set<number>([0]);
  const remaining = new Set<number>();
  for (let i = 1; i < rooms.length; i++) remaining.add(i);

  while (remaining.size > 0) {
    let bestDist = Infinity;
    let bestFrom = 0, bestTo = 0;

    for (const ci of connected) {
      const ac = roomCenter(rooms[ci].rect);
      for (const ri of remaining) {
        const bc = roomCenter(rooms[ri].rect);
        const d = Math.abs(ac.gx - bc.gx) + Math.abs(ac.gz - bc.gz);
        if (d < bestDist) { bestDist = d; bestFrom = ci; bestTo = ri; }
      }
    }

    // Connect from nearest edges
    const a = roomEdgeToward(rooms[bestFrom].rect, roomCenter(rooms[bestTo].rect));
    const b = roomEdgeToward(rooms[bestTo].rect, roomCenter(rooms[bestFrom].rect));
    corridors.push(carveLCorridor(a.gx, a.gz, b.gx, b.gz, openGrid, gridW));

    if (!adj.has(bestFrom)) adj.set(bestFrom, []);
    if (!adj.has(bestTo)) adj.set(bestTo, []);
    adj.get(bestFrom)!.push(bestTo);
    adj.get(bestTo)!.push(bestFrom);

    connected.add(bestTo);
    remaining.delete(bestTo);
  }
  return adj;
}

/**
 * Get a point one cell OUTSIDE a room's edge, toward the target.
 * This is the first wall cell in the direction of the target — carving from here
 * ensures the wall between room and corridor is properly opened.
 */
function roomExitToward(r: Rect, target: { gx: number; gz: number }): { gx: number; gz: number } {
  const cx = Math.floor(r.x + r.w / 2);
  const cz = Math.floor(r.z + r.d / 2);
  const dx = target.gx - cx;
  const dz = target.gz - cz;

  if (Math.abs(dx) > Math.abs(dz)) {
    // Exit east or west
    const exitX = dx > 0 ? r.x + r.w : r.x - 1;
    const exitZ = Math.max(r.z, Math.min(r.z + r.d - 1, target.gz));
    return { gx: exitX, gz: exitZ };
  } else {
    // Exit north or south
    const exitZ = dz > 0 ? r.z + r.d : r.z - 1;
    const exitX = Math.max(r.x, Math.min(r.x + r.w - 1, target.gx));
    return { gx: exitX, gz: exitZ };
  }
}

/**
 * Add extra corridors between nearby rooms to create loops (cycles) in the dungeon.
 * This gives players multiple paths between rooms and enables the stair/ladder system
 * for loop corridors connecting rooms at different heights.
 * ~30% of eligible nearby pairs get a loop corridor.
 */
function addLoopCorridors(
  rooms: DungeonRoom[],
  openGrid: boolean[],
  gridW: number,
  corridors: DungeonCorridor[],
  mstAdj: Map<number, number[]>,
  loopChance = 0.35,
): { protectedCells: Set<number>; count: number } {
  const protectedCells = new Set<number>();
  if (rooms.length < 3) return { protectedCells, count: 0 };

  // BFS hop distance between all room pairs through MST
  const mstHops = (from: number, to: number): number => {
    const visited = new Set<number>([from]);
    const queue: [number, number][] = [[from, 0]];
    while (queue.length > 0) {
      const [cur, hops] = queue.shift()!;
      if (cur === to) return hops;
      for (const nb of mstAdj.get(cur) ?? []) {
        if (!visited.has(nb)) { visited.add(nb); queue.push([nb, hops + 1]); }
      }
    }
    return Infinity;
  };

  // Collect all room-pair distances + MST hop distance
  type Pair = { a: number; b: number; dist: number; hops: number };
  const pairs: Pair[] = [];
  for (let i = 0; i < rooms.length; i++) {
    const ci = roomCenter(rooms[i].rect);
    for (let j = i + 1; j < rooms.length; j++) {
      const cj = roomCenter(rooms[j].rect);
      const d = Math.abs(ci.gx - cj.gx) + Math.abs(ci.gz - cj.gz);
      const h = mstHops(i, j);
      pairs.push({ a: i, b: j, dist: d, hops: h });
    }
  }

  // Filter out pairs that are too far apart physically — prevents very long corridors.
  // Max manhattan distance scales with grid size but stays reasonable.
  const maxCorridorDist = Math.max(12, Math.floor(gridW * 0.4));
  const eligible = pairs.filter(p => p.dist <= maxCorridorDist);

  // Score: prioritise cross-branch connections (high hops, low physical dist).
  // score = hops / dist — higher is better (far in tree, close physically).
  eligible.sort((a, b) => (b.hops / b.dist) - (a.hops / a.dist));

  const extraConnections = new Map<number, number>();
  const maxExtraPerRoom = loopChance > 0.5 ? 2 : 1;
  let added = 0;
  const maxLoops = loopChance <= 0 ? 0 : Math.max(1, Math.floor(rooms.length * loopChance));

  const carveLoop = (pair: Pair): boolean => {
    const { a, b } = pair;
    if ((extraConnections.get(a) ?? 0) >= maxExtraPerRoom) return false;
    if ((extraConnections.get(b) ?? 0) >= maxExtraPerRoom) return false;

    const exitA = roomExitToward(rooms[a].rect, roomCenter(rooms[b].rect));
    const exitB = roomExitToward(rooms[b].rect, roomCenter(rooms[a].rect));
    const edgeA = roomEdgeToward(rooms[a].rect, roomCenter(rooms[b].rect));
    const edgeB = roomEdgeToward(rooms[b].rect, roomCenter(rooms[a].rect));

    const corridor = carveLCorridor(exitA.gx, exitA.gz, exitB.gx, exitB.gz, openGrid, gridW);

    const ensureOpen = (gx: number, gz: number) => {
      if (gx >= 0 && gx < gridW && gz >= 0 && gz < gridW) {
        openGrid[gz * gridW + gx] = true;
      }
    };
    ensureOpen(edgeA.gx, edgeA.gz);
    ensureOpen(exitA.gx, exitA.gz);
    ensureOpen(edgeB.gx, edgeB.gz);
    ensureOpen(exitB.gx, exitB.gz);

    corridors.push(corridor);
    for (const c of corridor.cells) protectedCells.add(c.gz * gridW + c.gx);
    extraConnections.set(a, (extraConnections.get(a) ?? 0) + 1);
    extraConnections.set(b, (extraConnections.get(b) ?? 0) + 1);
    added++;
    const tag = pair.hops >= 4 ? 'CROSS' : 'loop';
    // console.log(`[Dungeon] ${tag} corridor room ${a}↔${b} dist=${pair.dist} hops=${pair.hops} cells=${corridor.cells.length}`);
    return true;
  };

  // Spatial noise: modulates per-pair acceptance based on midpoint position.
  // High-noise areas get denser loop connectivity, low-noise areas stay linear.
  const loopPerm = buildPerm256(rng.int(0, 0x7FFFFFFF));
  const loopNoiseScale = 0.12; // blob size relative to grid

  const spatialAccept = (pair: Pair): boolean => {
    const ca = roomCenter(rooms[pair.a].rect);
    const cb = roomCenter(rooms[pair.b].rect);
    const mx = (ca.gx + cb.gx) / 2;
    const mz = (ca.gz + cb.gz) / 2;
    // Noise 0–1 at midpoint, biased by loopChance
    const n = valNoise2D(mx * loopNoiseScale, mz * loopNoiseScale, loopPerm);
    // Threshold: low loopChance → only high-noise spots get loops
    // high loopChance → most spots get loops
    const threshold = 1.0 - loopChance;
    return n > threshold && rng.next() < 0.8;
  };

  // Phase 1: Cross-branch connections (hops >= 4, sorted by score)
  for (const pair of eligible) {
    if (added >= maxLoops) break;
    if (pair.hops < 4) continue;
    if (!spatialAccept(pair)) continue;
    carveLoop(pair);
  }

  // Phase 2: Fill remaining budget with shorter loops
  for (const pair of eligible) {
    if (added >= maxLoops) break;
    if (pair.hops >= 4) continue; // already handled
    if (!spatialAccept(pair)) continue;
    carveLoop(pair);
  }

  return { protectedCells, count: added };
}

/** Carve an L-shaped corridor between two grid points.
 *  @param width — corridor width in cells (1 = single, 2 = double). Extra cells
 *  are carved perpendicular to the carving direction so the corridor survives
 *  eliminateThinWalls. */
function carveLCorridor(
  x1: number, z1: number,
  x2: number, z2: number,
  openGrid: boolean[],
  gridW: number,
  width = 1,
): DungeonCorridor {
  const gridD = openGrid.length / gridW;
  const cells: { gx: number; gz: number }[] = [];
  const carved = new Set<number>();
  const carve = (gx: number, gz: number) => {
    if (gx >= 0 && gx < gridW && gz >= 0 && gz < gridD) {
      const idx = gz * gridW + gx;
      if (!carved.has(idx)) {
        openGrid[idx] = true;
        cells.push({ gx, gz });
        carved.add(idx);
      }
    }
  };

  // Carve with optional width expansion perpendicular to direction
  const carveWide = (gx: number, gz: number, axis: 'x' | 'z') => {
    carve(gx, gz);
    for (let w = 1; w < width; w++) {
      if (axis === 'x') carve(gx, gz + w);  // expand in z when moving along x
      else carve(gx + w, gz);                // expand in x when moving along z
    }
  };

  // Randomly choose: horizontal-first or vertical-first
  if (rng.next() < 0.5) {
    // Horizontal then vertical
    const dx = x2 > x1 ? 1 : -1;
    for (let x = x1; x !== x2; x += dx) carveWide(x, z1, 'x');
    const dz = z2 > z1 ? 1 : -1;
    for (let z = z1; z !== z2 + dz; z += dz) carveWide(x2, z, 'z');
  } else {
    // Vertical then horizontal
    const dz = z2 > z1 ? 1 : -1;
    for (let z = z1; z !== z2; z += dz) carveWide(x1, z, 'z');
    const dx = x2 > x1 ? 1 : -1;
    for (let x = x1; x !== x2 + dx; x += dx) carveWide(x, z2, 'x');
  }

  return { cells };
}

// ── Public generators ──────────────────────────────────────────────

export function generateBSPDungeon(
  gridW: number,
  gridD: number,
  minRoomSize = 3,
  maxDepth = 6,
  roomSpacingOverride?: number,
  doorChance = 1.0,
  loopChance = 0.35,
  roomSpacingMaxOverride?: number,
): DungeonResult {
  const border = 2;
  const roomSpacingMin = Math.max(1, roomSpacingOverride ?? 3);
  const roomSpacingMax = Math.max(roomSpacingMin, roomSpacingMaxOverride ?? roomSpacingMin);
  // padding = per-side inset. Gap between sibling rooms = 2*padding.
  // Use min padding for BSP partitioning so all leaves can fit rooms,
  // then randomize padding per leaf during room placement for variation.
  const minPadding = Math.max(1, Math.ceil(roomSpacingMin / 2));
  const maxPadding = Math.max(minPadding, Math.ceil(roomSpacingMax / 2));
  const usableRect: Rect = { x: border, z: border, w: gridW - border * 2, d: gridD - border * 2 };

  // minSize for BSP split must account for padding so every leaf can fit a room
  const minPartitionSize = minRoomSize + minPadding * 2;
  const maxRoomSize = 7; // cap room dimensions for balanced layouts
  const root = splitBSP(usableRect, minPartitionSize, 0, maxDepth);
  placeRoomsInBSP(root, minRoomSize, minPadding, maxPadding, maxRoomSize);

  const openGrid = new Array(gridW * gridD).fill(false);

  // Carve rooms — also build a roomGrid lookup for door detection
  const roomRects = collectRooms(root);
  const roomGrid = new Int8Array(gridW * gridD).fill(-1); // -1 = not in any room
  const rooms: DungeonRoom[] = roomRects.map((rect, ri) => {
    for (let gz = rect.z; gz < rect.z + rect.d; gz++) {
      for (let gx = rect.x; gx < rect.x + rect.w; gx++) {
        if (gx >= 0 && gx < gridW && gz >= 0 && gz < gridD) {
          openGrid[gz * gridW + gx] = true;
          roomGrid[gz * gridW + gx] = ri;
        }
      }
    }
    return { rect };
  });

  // Connect rooms via minimum spanning tree (shortest corridors)
  const corridors: DungeonCorridor[] = [];
  const mstAdj = connectRoomsMST(rooms, openGrid, gridW, corridors);

  // Add extra loop corridors — prioritise cross-branch connections
  const loopResult = addLoopCorridors(rooms, openGrid, gridW, corridors, mstAdj, loopChance);

  // Eliminate 1-thick walls, re-bridge, repeat
  // Loop corridor cells are protected from being closed.
  eliminateThinWalls(openGrid, roomGrid, gridW, gridD, loopResult.protectedCells);
  ensureConnectivity(rooms, openGrid, gridW, gridD, corridors);
  eliminateThinWalls(openGrid, roomGrid, gridW, gridD, loopResult.protectedCells);

  // Detect doors: where corridor cells meet room boundaries
  // Log corridor cell count for debugging
  let totalCorridorCells = 0;
  for (const c of corridors) totalCorridorCells += c.cells.length;
  // console.log(`[DOOR] ${rooms.length} rooms, ${corridors.length} corridors (${totalCorridorCells} cells)`);

  const doors = detectCorridorDoors(corridors, roomGrid, openGrid, gridW, gridD, doorChance);

  // Stamp corridor cells with unique negative IDs (-2, -3, ...) so each corridor gets its own floor
  for (let ci = 0; ci < corridors.length; ci++) {
    for (const { gx, gz } of corridors[ci].cells) {
      if (roomGrid[gz * gridW + gx] === -1) {
        roomGrid[gz * gridW + gx] = -(ci + 2);
      }
    }
  }

  return { rooms, corridors, openGrid, gridW, gridD, doors, roomOwnership: Array.from(roomGrid), loopCorridors: loopResult.count };
}


/**
 * Detect door positions where corridors enter rooms in a BSP dungeon.
 * Collects candidates, then filters by minimum spacing and 60% random chance
 * so short corridors don't get cluttered with back-to-back doors.
 */
function detectCorridorDoors(
  corridors: DungeonCorridor[],
  roomGrid: Int8Array,
  openGrid: boolean[],
  gridW: number,
  gridD: number,
  doorChance = 1.0,
): DoorDef[] {
  // Collect candidate positions: corridor cells adjacent to a room cell
  // Determine orientation from corridor shape — check if perpendicular neighbors are corridor cells
  const candidates: DoorDef[] = [];
  const seen = new Set<string>();

  // Build a set of all corridor cells for quick lookup
  const corridorSet = new Set<string>();
  for (const corridor of corridors) {
    for (const cell of corridor.cells) {
      corridorSet.add(`${cell.gx},${cell.gz}`);
    }
  }

  const isCorridor = (gx: number, gz: number): boolean => corridorSet.has(`${gx},${gz}`);

  // Helper: is a cell actually open (walkable) in the grid?
  const isOpen = (gx: number, gz: number): boolean => {
    if (gx < 0 || gx >= gridW || gz < 0 || gz >= gridD) return false;
    return openGrid[gz * gridW + gx];
  };

  // Two rounds: first collect room-adjacent candidates (priority), then mid-corridor ones
  for (let round = 0; round < 2; round++) {
    for (const corridor of corridors) {
      for (const cell of corridor.cells) {
        const { gx, gz } = cell;
        if (roomGrid[gz * gridW + gx] >= 0) continue; // skip cells inside rooms
        if (!isOpen(gx, gz)) continue; // door cell must be walkable

        const key = `${gx},${gz}`;
        if (seen.has(key)) continue;

        // Check if this corridor cell is adjacent to any room
        const hasRoomNeighbor =
          (gx + 1 < gridW && roomGrid[gz * gridW + gx + 1] >= 0) ||
          (gx - 1 >= 0 && roomGrid[gz * gridW + gx - 1] >= 0) ||
          (gz + 1 < gridD && roomGrid[(gz + 1) * gridW + gx] >= 0) ||
          (gz - 1 >= 0 && roomGrid[(gz - 1) * gridW + gx] >= 0);

        // Round 0: room-adjacent only. Round 1: mid-corridor cells too.
        if (round === 0 && !hasRoomNeighbor) continue;
        if (round === 1 && hasRoomNeighbor) continue; // already processed

        // Chokepoint check: perpendicular cells must be closed (walls),
        // AND passage cells on both sides must be open (walkable).
        // Use openGrid directly — more reliable than corridor/room checks
        // since eliminateThinWalls may have closed some cells.
        const openN = isOpen(gx, gz - 1);
        const openS = isOpen(gx, gz + 1);
        const openE = isOpen(gx + 1, gz);
        const openW = isOpen(gx - 1, gz);

        let orientation: 'NS' | 'EW';
        if (!openN && !openS && openE && openW) {
          orientation = 'NS'; // walls N+S, passage E-W
        } else if (!openE && !openW && openN && openS) {
          orientation = 'EW'; // walls E+W, passage N-S
        } else {
          continue; // not a clean chokepoint — skip
        }

        seen.add(key);
        candidates.push({ x: gx, z: gz, orientation, gapWidth: 1 });
      }
    }
  }

  // console.log(`[DOOR] candidates=${candidates.length}, corridorCells=${corridorSet.size}`);

  // Partition: room-adjacent candidates first, then mid-corridor
  const roomAdj: DoorDef[] = [];
  const midCorr: DoorDef[] = [];
  for (const c of candidates) {
    const adj =
      (c.x + 1 < gridW && roomGrid[c.z * gridW + c.x + 1] >= 0) ||
      (c.x - 1 >= 0 && roomGrid[c.z * gridW + c.x - 1] >= 0) ||
      (c.z + 1 < gridD && roomGrid[(c.z + 1) * gridW + c.x] >= 0) ||
      (c.z - 1 >= 0 && roomGrid[(c.z - 1) * gridW + c.x] >= 0);
    (adj ? roomAdj : midCorr).push(c);
  }

  // Shuffle each group independently
  for (const arr of [roomAdj, midCorr]) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // Process room-adjacent first (priority), then mid-corridor
  const ordered = [...roomAdj, ...midCorr];
  const MIN_DIST_SQ = 3 * 3;
  const doors: DoorDef[] = [];

  for (const c of ordered) {
    if (rng.next() > doorChance) continue;
    const tooClose = doors.some(d => {
      const dx = c.x - d.x;
      const dz = c.z - d.z;
      return dx * dx + dz * dz < MIN_DIST_SQ;
    });
    if (tooClose) continue;
    doors.push(c);
  }

  return doors;
}


/**
 * Eliminate 1-thick walls: any closed cell that has open cells on opposite
 * cardinal sides is a shared wall. Fix by closing corridor-side open cells.
 * Also catches near-diagonal thin spots (open cell whose neighbor is 1 cell
 * from another open area).
 */
function eliminateThinWalls(
  openGrid: boolean[],
  roomGrid: Int8Array,
  gridW: number,
  gridD: number,
  protectedCells?: Set<number>,
): void {
  const isOpen = (gx: number, gz: number): boolean => {
    if (gx < 0 || gx >= gridW || gz < 0 || gz >= gridD) return false;
    return openGrid[gz * gridW + gx];
  };

  for (let pass = 0; pass < 10; pass++) {
    let changed = false;
    for (let gz = 1; gz < gridD - 1; gz++) {
      for (let gx = 1; gx < gridW - 1; gx++) {
        if (openGrid[gz * gridW + gx]) continue; // only check closed cells

        // Cardinal thin walls: open on opposite sides
        // Never close protected cells (loop corridor cells)
        if (isOpen(gx, gz - 1) && isOpen(gx, gz + 1)) {
          const idxN = (gz - 1) * gridW + gx;
          const idxS = (gz + 1) * gridW + gx;
          if (roomGrid[idxN] < 0 && !protectedCells?.has(idxN)) {
            openGrid[idxN] = false; changed = true;
          } else if (roomGrid[idxS] < 0 && !protectedCells?.has(idxS)) {
            openGrid[idxS] = false; changed = true;
          }
        }
        if (isOpen(gx - 1, gz) && isOpen(gx + 1, gz)) {
          const idxW = gz * gridW + (gx - 1);
          const idxE = gz * gridW + (gx + 1);
          if (roomGrid[idxW] < 0 && !protectedCells?.has(idxW)) {
            openGrid[idxW] = false; changed = true;
          } else if (roomGrid[idxE] < 0 && !protectedCells?.has(idxE)) {
            openGrid[idxE] = false; changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }
}

/** BFS flood fill to ensure all rooms are connected; bridge isolated components */
function ensureConnectivity(
  rooms: DungeonRoom[],
  openGrid: boolean[],
  gridW: number,
  gridD: number,
  corridors: DungeonCorridor[],
): void {
  if (rooms.length < 2) return;

  const visited = new Array(gridW * gridD).fill(-1);
  let componentId = 0;

  for (let gz = 0; gz < gridD; gz++) {
    for (let gx = 0; gx < gridW; gx++) {
      const idx = gz * gridW + gx;
      if (!openGrid[idx] || visited[idx] >= 0) continue;
      const queue = [idx];
      visited[idx] = componentId;
      let head = 0;
      while (head < queue.length) {
        const ci = queue[head++];
        const cxx = ci % gridW;
        const czz = Math.floor(ci / gridW);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cxx + dx, nz = czz + dz;
          if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
          const ni = nz * gridW + nx;
          if (!openGrid[ni] || visited[ni] >= 0) continue;
          visited[ni] = componentId;
          queue.push(ni);
        }
      }
      componentId++;
    }
  }

  if (componentId <= 1) return;

  // Connect each isolated component to component 0 using nearest room edges
  const componentRooms = new Map<number, DungeonRoom>();
  for (const room of rooms) {
    const c = roomCenter(room.rect);
    const idx = c.gz * gridW + c.gx;
    const comp = visited[idx];
    if (comp >= 0 && !componentRooms.has(comp)) {
      componentRooms.set(comp, room);
    }
  }

  const targetRoom = componentRooms.get(0);
  if (!targetRoom) return;

  for (let c = 1; c < componentId; c++) {
    const srcRoom = componentRooms.get(c);
    if (!srcRoom) continue;
    const a = roomEdgeToward(srcRoom.rect, roomCenter(targetRoom.rect));
    const b = roomEdgeToward(targetRoom.rect, roomCenter(srcRoom.rect));
    corridors.push(carveLCorridor(a.gx, a.gz, b.gx, b.gz, openGrid, gridW));
  }
}

// ── Box conversion ─────────────────────────────────────────────────

interface WallSegment {
  x: number;
  z: number;
  w: number;
  d: number;
}

/**
 * Convert a DungeonResult into BoxDef arrays for floors and walls.
 * @param result - The dungeon generation result
 * @param cellSize - Size of each room-grid cell in world units (e.g. 2m)
 * @param wallHeight - Height of wall boxes
 * @param worldSize - Total world size (e.g. 40m)
 */
export function convertToBoxDefs(
  result: DungeonResult,
  cellSize: number,
  wallHeight: number,
  worldSize: number,
): BoxDef[] {
  const { openGrid, gridW, gridD } = result;
  const boxes: BoxDef[] = [];
  const halfWorld = worldSize / 2;
  const floorH = 0.05;

  // Convert grid coords to world coords (centered on world origin)
  const toWorldX = (gx: number) => -halfWorld + (gx + 0.5) * cellSize;
  const toWorldZ = (gz: number) => -halfWorld + (gz + 0.5) * cellSize;

  // ── Floor boxes ──
  for (let gz = 0; gz < gridD; gz++) {
    for (let gx = 0; gx < gridW; gx++) {
      if (!openGrid[gz * gridW + gx]) continue;
      boxes.push({
        x: toWorldX(gx),
        z: toWorldZ(gz),
        w: cellSize,
        d: cellSize,
        h: floorH,
      });
    }
  }

  // ── Wall boxes ──
  // For each open cell, check 4 edges. If neighbor is closed/OOB, place wall.
  // Collect wall segments then merge collinear ones.
  const wallSegments: WallSegment[] = [];
  const wallThick = 0.1;

  const isOpen = (gx: number, gz: number): boolean => {
    if (gx < 0 || gx >= gridW || gz < 0 || gz >= gridD) return false;
    return openGrid[gz * gridW + gx];
  };

  const ownership = result.roomOwnership;
  const halfThick = wallThick / 2;

  for (let gz = 0; gz < gridD; gz++) {
    for (let gx = 0; gx < gridW; gx++) {
      if (!openGrid[gz * gridW + gx]) continue;

      const wx = toWorldX(gx);
      const wz = toWorldZ(gz);
      const half = cellSize / 2;

      // Standard walls: open cell next to closed/OOB
      if (!isOpen(gx, gz - 1)) wallSegments.push({ x: wx, z: wz - half, w: cellSize, d: wallThick });
      if (!isOpen(gx, gz + 1)) wallSegments.push({ x: wx, z: wz + half, w: cellSize, d: wallThick });
      if (!isOpen(gx - 1, gz)) wallSegments.push({ x: wx - half, z: wz, w: wallThick, d: cellSize });
      if (!isOpen(gx + 1, gz)) wallSegments.push({ x: wx + half, z: wz, w: wallThick, d: cellSize });
    }
  }

  // Merge standard wall segments
  const mergedWalls = mergeWalls(wallSegments, wallThick, cellSize);

  for (const wall of mergedWalls) {
    boxes.push({
      x: wall.x,
      z: wall.z,
      w: wall.w,
      d: wall.d,
      h: wallHeight,
    });
  }

  // Room-boundary walls: offset inward toward each room
  if (ownership) {
    for (let gz = 0; gz < gridD; gz++) {
      for (let gx = 0; gx < gridW; gx++) {
        if (!openGrid[gz * gridW + gx]) continue;
        const myRoom = ownership[gz * gridW + gx];
        if (myRoom < 0) continue; // skip non-room and door cells (-2)

        const wx = toWorldX(gx);
        const wz = toWorldZ(gz);
        const half = cellSize / 2;

        const checkNeighbor = (nx: number, nz: number): boolean => {
          if (!isOpen(nx, nz)) return false; // standard wall handles this
          const nRoom = ownership[nz * gridW + nx];
          return nRoom >= 0 && nRoom !== myRoom;
        };

        // North: different room → half-thick wall offset inward
        if (gz > 0 && checkNeighbor(gx, gz - 1)) {
          boxes.push({ x: wx, z: wz - half + halfThick / 2, w: cellSize, d: halfThick, h: wallHeight });
        }
        // South
        if (gz + 1 < gridD && checkNeighbor(gx, gz + 1)) {
          boxes.push({ x: wx, z: wz + half - halfThick / 2, w: cellSize, d: halfThick, h: wallHeight });
        }
        // West
        if (gx > 0 && checkNeighbor(gx - 1, gz)) {
          boxes.push({ x: wx - half + halfThick / 2, z: wz, w: halfThick, d: cellSize, h: wallHeight });
        }
        // East
        if (gx + 1 < gridW && checkNeighbor(gx + 1, gz)) {
          boxes.push({ x: wx + half - halfThick / 2, z: wz, w: halfThick, d: cellSize, h: wallHeight });
        }
      }
    }
  }

  return boxes;
}

/**
 * Merge adjacent collinear wall segments to reduce box count.
 * Groups walls by position on their thin axis, then merges consecutive segments.
 */
function mergeWalls(
  segments: WallSegment[],
  wallThick: number,
  cellSize: number,
): WallSegment[] {
  const merged: WallSegment[] = [];
  const eps = 0.01;

  // Separate into horizontal walls (thin in d) and vertical walls (thin in w)
  const hWalls = segments.filter(s => Math.abs(s.d - wallThick) < eps);
  const vWalls = segments.filter(s => Math.abs(s.w - wallThick) < eps);

  // Merge horizontal walls: group by z, sort by x, merge consecutive
  const hGroups = new Map<number, WallSegment[]>();
  for (const w of hWalls) {
    const key = Math.round(w.z * 100);
    if (!hGroups.has(key)) hGroups.set(key, []);
    hGroups.get(key)!.push(w);
  }

  for (const group of hGroups.values()) {
    group.sort((a, b) => a.x - b.x);
    let current = { ...group[0] };
    for (let i = 1; i < group.length; i++) {
      const next = group[i];
      const currentRight = current.x + current.w / 2;
      const nextLeft = next.x - next.w / 2;
      if (Math.abs(currentRight - nextLeft) < eps) {
        // Merge: extend current to include next
        const newLeft = current.x - current.w / 2;
        const newRight = next.x + next.w / 2;
        current.w = newRight - newLeft;
        current.x = (newLeft + newRight) / 2;
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);
  }

  // Merge vertical walls: group by x, sort by z, merge consecutive
  const vGroups = new Map<number, WallSegment[]>();
  for (const w of vWalls) {
    const key = Math.round(w.x * 100);
    if (!vGroups.has(key)) vGroups.set(key, []);
    vGroups.get(key)!.push(w);
  }

  for (const group of vGroups.values()) {
    group.sort((a, b) => a.z - b.z);
    let current = { ...group[0] };
    for (let i = 1; i < group.length; i++) {
      const next = group[i];
      const currentBottom = current.z + current.d / 2;
      const nextTop = next.z - next.d / 2;
      if (Math.abs(currentBottom - nextTop) < eps) {
        const newTop = current.z - current.d / 2;
        const newBottom = next.z + next.d / 2;
        current.d = newBottom - newTop;
        current.z = (newTop + newBottom) / 2;
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);
  }

  return merged;
}
