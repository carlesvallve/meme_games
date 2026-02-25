// ── Dungeon & Rooms Generator ──────────────────────────────────────
// Produces BoxDef arrays (floors + walls) for the Terrain system.
// Two modes: BSP-partitioned dungeon and adjacent-rooms grid.

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
}

/**
 * High-level entry point: generate a full dungeon or rooms layout.
 * Returns box definitions and a walk mask for NavGrid integration.
 */
export function generateDungeon(
  mode: 'dungeon' | 'rooms',
  groundSize: number,
  wallGap = 1,
  cellSizeOverride?: number,
  roomSpacing?: number,
  doorChance = 0.7,
): DungeonOutput {
  const cellSize = cellSizeOverride ?? 2;
  const gridW = Math.floor(groundSize / cellSize);
  const gridD = gridW;
  const wallHeight = 2.5;

  const result = mode === 'dungeon'
    ? generateBSPDungeon(gridW, gridD, 2, 6, roomSpacing ?? 2, doorChance)
    : generateAdjacentRooms(gridW, gridD, 4, 4, wallGap, doorChance);

  const boxes = convertToBoxDefs(result, cellSize, wallHeight, groundSize);

  // Convert grid-space door defs to world-space
  // For rooms preset: filter out doors without walls on both sides (prevents doors in open corridors)
  // For dungeon preset: skip filter — detectCorridorDoors already ensures corridor-room boundary placement
  const halfWorld = groundSize / 2;
  const { openGrid, gridW: gw, gridD: gd } = result;
  const isOpenCell = (gx: number, gz: number): boolean => {
    if (gx < 0 || gx >= gw || gz < 0 || gz >= gd) return false;
    return openGrid[gz * gw + gx];
  };

  const doors: DoorDef[] = [];
  const shiftedGridDoors: DoorDef[] = [];
  const isVoxelDungeon = cellSizeOverride !== undefined; // voxel dungeon uses cellSizeOverride
  console.log(`[DOOR] mode=${mode}, gridDoors=${(result.doors || []).length}, corridors=${result.corridors.length}, isVoxelDungeon=${isVoxelDungeon}`);
  const roomGrid = result.roomOwnership;
  for (const d of result.doors || []) {
    // Skip wall-flanking check for voxel dungeon (walls are full cells, not edges)
    // and when roomOwnership exists (wallGap=0 — walls are room-boundary based)
    if (!roomGrid && !isVoxelDungeon) {
      const gx = Math.round(d.x);
      const gz = Math.round(d.z);
      const hasWalls = d.orientation === 'NS'
        ? !isOpenCell(gx, gz - 1) && !isOpenCell(gx, gz + 1)
        : !isOpenCell(gx - 1, gz) && !isOpenCell(gx + 1, gz);
      if (!hasWalls) continue;
    }

    let wx = -halfWorld + (d.x + 0.5) * cellSize;
    let wz = -halfWorld + (d.z + 0.5) * cellSize;

    // For voxel dungeon: nudge door half a cell toward the nearest room
    if (isVoxelDungeon && roomGrid) {
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
  console.log(`[DOOR] final world-space doors: ${doors.length}`);

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
    rooms: result.rooms.map(r => r.rect),
    roomOwnership: result.roomOwnership ?? new Array(gridW * gridD).fill(-1),
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
  const splitH = rect.w > rect.d ? Math.random() < 0.7
               : rect.d > rect.w ? Math.random() < 0.3
               : Math.random() < 0.5;

  if (splitH) {
    // Split horizontally (along x)
    if (rect.w <= minSize * 2) return node;
    const split = minSize + Math.floor(Math.random() * (rect.w - minSize * 2 + 1));
    node.left = splitBSP({ x: rect.x, z: rect.z, w: split, d: rect.d }, minSize, depth + 1, maxDepth);
    node.right = splitBSP({ x: rect.x + split, z: rect.z, w: rect.w - split, d: rect.d }, minSize, depth + 1, maxDepth);
  } else {
    // Split vertically (along z)
    if (rect.d <= minSize * 2) return node;
    const split = minSize + Math.floor(Math.random() * (rect.d - minSize * 2 + 1));
    node.left = splitBSP({ x: rect.x, z: rect.z, w: rect.w, d: split }, minSize, depth + 1, maxDepth);
    node.right = splitBSP({ x: rect.x, z: rect.z + split, w: rect.w, d: rect.d - split }, minSize, depth + 1, maxDepth);
  }

  return node;
}

function placeRoomsInBSP(node: BSPNode, minRoomSize: number, padding: number, maxRoomSize: number): void {
  if (!node.left && !node.right) {
    // Leaf node — place room inset by padding, capped at maxRoomSize
    const availW = node.rect.w - padding * 2;
    const availD = node.rect.d - padding * 2;
    if (availW < minRoomSize || availD < minRoomSize) {
      return;
    }
    const capW = Math.min(availW, maxRoomSize);
    const capD = Math.min(availD, maxRoomSize);
    // Random size between minRoomSize and capped max
    const w = minRoomSize + Math.floor(Math.random() * (capW - minRoomSize + 1));
    const d = minRoomSize + Math.floor(Math.random() * (capD - minRoomSize + 1));
    // Center within padded area
    const x = node.rect.x + padding + Math.floor((availW - w) / 2);
    const z = node.rect.z + padding + Math.floor((availD - d) / 2);
    node.room = { x, z, w, d };
    return;
  }
  if (node.left) placeRoomsInBSP(node.left, minRoomSize, padding, maxRoomSize);
  if (node.right) placeRoomsInBSP(node.right, minRoomSize, padding, maxRoomSize);
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
function connectRoomsMST(
  rooms: DungeonRoom[],
  openGrid: boolean[],
  gridW: number,
  corridors: DungeonCorridor[],
): void {
  if (rooms.length < 2) return;

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

    connected.add(bestTo);
    remaining.delete(bestTo);
  }
}

/** Carve an L-shaped corridor between two grid points (1 cell wide) */
function carveLCorridor(
  x1: number, z1: number,
  x2: number, z2: number,
  openGrid: boolean[],
  gridW: number,
): DungeonCorridor {
  const cells: { gx: number; gz: number }[] = [];
  const carve = (gx: number, gz: number) => {
    if (gx >= 0 && gx < gridW && gz >= 0 && gz < gridW) {
      openGrid[gz * gridW + gx] = true;
      cells.push({ gx, gz });
    }
  };

  // Randomly choose: horizontal-first or vertical-first
  if (Math.random() < 0.5) {
    // Horizontal then vertical
    const dx = x2 > x1 ? 1 : -1;
    for (let x = x1; x !== x2; x += dx) carve(x, z1);
    const dz = z2 > z1 ? 1 : -1;
    for (let z = z1; z !== z2 + dz; z += dz) carve(x2, z);
  } else {
    // Vertical then horizontal
    const dz = z2 > z1 ? 1 : -1;
    for (let z = z1; z !== z2; z += dz) carve(x1, z);
    const dx = x2 > x1 ? 1 : -1;
    for (let x = x1; x !== x2 + dx; x += dx) carve(x, z2);
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
  doorChance = 0.7,
): DungeonResult {
  const border = 2;
  const roomSpacing = Math.max(1, roomSpacingOverride ?? 3);
  // padding = per-side inset. Gap between sibling rooms = 2*padding.
  // We want gap ≈ roomSpacing, so padding = ceil(roomSpacing/2), min 1.
  const padding = Math.max(1, Math.ceil(roomSpacing / 2));
  const usableRect: Rect = { x: border, z: border, w: gridW - border * 2, d: gridD - border * 2 };

  // minSize for BSP split must account for padding so every leaf can fit a room
  const minPartitionSize = minRoomSize + padding * 2;
  const maxRoomSize = 7; // cap room dimensions for balanced layouts
  const root = splitBSP(usableRect, minPartitionSize, 0, maxDepth);
  placeRoomsInBSP(root, minRoomSize, padding, maxRoomSize);

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
  connectRoomsMST(rooms, openGrid, gridW, corridors);

  // Eliminate 1-thick walls, re-bridge, repeat
  eliminateThinWalls(openGrid, roomGrid, gridW, gridD);
  ensureConnectivity(rooms, openGrid, gridW, gridD, corridors);
  eliminateThinWalls(openGrid, roomGrid, gridW, gridD);

  // Detect doors: where corridor cells meet room boundaries
  // Log corridor cell count for debugging
  let totalCorridorCells = 0;
  for (const c of corridors) totalCorridorCells += c.cells.length;
  console.log(`[DOOR] ${rooms.length} rooms, ${corridors.length} corridors (${totalCorridorCells} cells)`);

  const doors = detectCorridorDoors(corridors, roomGrid, openGrid, gridW, gridD, doorChance);
  console.log(`[DOOR] detectCorridorDoors found ${doors.length} doors`);

  // Stamp corridor cells with unique negative IDs (-2, -3, ...) so each corridor gets its own floor
  for (let ci = 0; ci < corridors.length; ci++) {
    for (const { gx, gz } of corridors[ci].cells) {
      if (roomGrid[gz * gridW + gx] === -1) {
        roomGrid[gz * gridW + gx] = -(ci + 2);
      }
    }
  }

  return { rooms, corridors, openGrid, gridW, gridD, doors, roomOwnership: Array.from(roomGrid) };
}

/**
 * Generate a grid of adjacent rooms separated by wall strips with door openings.
 * Grid slots are computed, each room is inset by wallGap cells to create wall strips,
 * then doors punch openings through the walls between neighbors.
 * @param wallGap - Inset per edge (0 = shared wall, 1 = 2-cell gap between rooms, etc.)
 */
export function generateAdjacentRooms(
  gridW: number,
  gridD: number,
  cols = 4,
  rows = 4,
  wallGap = 1,
  doorChance = 0.7,
): DungeonResult {
  const border = 1;
  const openGrid = new Array(gridW * gridD).fill(false);
  const rooms: DungeonRoom[] = [];
  const corridors: DungeonCorridor[] = [];
  const doors: DoorDef[] = [];

  const usableW = gridW - border * 2;
  const usableD = gridD - border * 2;

  // Distribute slot sizes across columns and rows
  const colWidths = distributeEvenly(usableW, cols);
  const rowHeights = distributeEvenly(usableD, rows);

  // Compute slot start positions
  const colStarts: number[] = [];
  let cx = border;
  for (let i = 0; i < cols; i++) { colStarts.push(cx); cx += colWidths[i]; }

  const rowStarts: number[] = [];
  let rz = border;
  for (let i = 0; i < rows; i++) { rowStarts.push(rz); rz += rowHeights[i]; }

  const inset = Math.max(1, wallGap - 1);

  // Place rooms
  const roomGrid: (DungeonRoom | null)[][] = [];
  for (let ry = 0; ry < rows; ry++) {
    roomGrid[ry] = [];
    for (let rx = 0; rx < cols; rx++) {
      // Randomly skip ~15% of rooms for irregular layouts (not when wallGap=0, rooms must tile)
      if (wallGap > 0 && Math.random() < 0.15 && rooms.length > 2) {
        roomGrid[ry][rx] = null;
        continue;
      }

      const slotX = colStarts[rx];
      const slotZ = rowStarts[ry];
      const slotW = colWidths[rx];
      const slotD = rowHeights[ry];

      let rect: Rect;

      if (wallGap === 0) {
        // wallGap=0: rooms fill entire slot, walls added between rooms after carving
        rect = {
          x: slotX,
          z: slotZ,
          w: slotW,
          d: slotD,
        };
      } else {
        // wallGap>0: inset rooms to create corridor gaps
        let roomW = Math.max(1, slotW - inset * 2);
        let roomD = Math.max(1, slotD - inset * 2);

        // Random size variation: shrink 0-2 cells per edge, biased toward square
        const maxShrink = 2;
        const shrinkW = Math.floor(Math.random() * Math.min(maxShrink + 1, Math.max(0, roomW - 2)));
        const shrinkD = Math.floor(Math.random() * Math.min(maxShrink + 1, Math.max(0, roomD - 2)));

        if (roomW - shrinkW > roomD - shrinkD + 2) {
          roomW = Math.max(2, roomW - shrinkW - 1);
        } else {
          roomW = Math.max(2, roomW - shrinkW);
        }
        if (roomD - shrinkD > roomW + 2) {
          roomD = Math.max(2, roomD - shrinkD - 1);
        } else {
          roomD = Math.max(2, roomD - shrinkD);
        }

        const maxOffX = slotW - inset * 2 - roomW;
        const maxOffZ = slotD - inset * 2 - roomD;
        const offX = maxOffX > 0 ? Math.floor(Math.random() * (maxOffX + 1)) : 0;
        const offZ = maxOffZ > 0 ? Math.floor(Math.random() * (maxOffZ + 1)) : 0;

        rect = {
          x: slotX + inset + offX,
          z: slotZ + inset + offZ,
          w: roomW,
          d: roomD,
        };
      }

      // Carve room interior
      for (let gz = rect.z; gz < rect.z + rect.d; gz++) {
        for (let gx = rect.x; gx < rect.x + rect.w; gx++) {
          if (gx >= 0 && gx < gridW && gz >= 0 && gz < gridD) {
            openGrid[gz * gridW + gx] = true;
          }
        }
      }

      const room: DungeonRoom = { rect };
      rooms.push(room);
      roomGrid[ry][rx] = room;
    }
  }

  if (wallGap === 0) {
    // wallGap=0: rooms fill their slots and touch directly.
    // Build roomOwnership grid so convertToBoxDefs can generate shared thin walls
    // between cells belonging to different rooms.
    const roomOwnership = new Array<number>(gridW * gridD).fill(-1);
    for (let ri = 0; ri < rooms.length; ri++) {
      const r = rooms[ri].rect;
      for (let gz = r.z; gz < r.z + r.d; gz++) {
        for (let gx = r.x; gx < r.x + r.w; gx++) {
          if (gx >= 0 && gx < gridW && gz >= 0 && gz < gridD) {
            roomOwnership[gz * gridW + gx] = ri;
          }
        }
      }
    }

    // Place doors between adjacent rooms (~70% chance per boundary)
    // Door cells get roomOwnership = -2 to suppress wall generation at that edge
    const doorCells = new Set<string>();
    for (let ry = 0; ry < rows; ry++) {
      for (let rx = 0; rx < cols; rx++) {
        const room = roomGrid[ry][rx];
        if (!room) continue;

        // East neighbor
        if (rx + 1 < cols && roomGrid[ry][rx + 1]) {
          const east = roomGrid[ry][rx + 1]!;
          const boundaryX = room.rect.x + room.rect.w - 1; // last col of this room
          const nextX = east.rect.x; // first col of east room
          const zMin = Math.max(room.rect.z, east.rect.z);
          const zMax = Math.min(room.rect.z + room.rect.d, east.rect.z + east.rect.d);

          if (Math.random() < doorChance && zMax - zMin >= 1) {
            const margin = zMax - zMin > 2 ? 1 : 0;
            const doorZ = zMin + margin + Math.floor(Math.random() * Math.max(1, zMax - zMin - margin * 2));
            const doorGridX = boundaryX + 0.5;
            doors.push({ x: doorGridX, z: doorZ, orientation: 'NS', gapWidth: 1 });
            doorCells.add(`${boundaryX},${doorZ}`);
            doorCells.add(`${nextX},${doorZ}`);
          }
        }

        // South neighbor
        if (ry + 1 < rows && roomGrid[ry + 1][rx]) {
          const south = roomGrid[ry + 1][rx]!;
          const boundaryZ = room.rect.z + room.rect.d - 1;
          const nextZ = south.rect.z;
          const xMin = Math.max(room.rect.x, south.rect.x);
          const xMax = Math.min(room.rect.x + room.rect.w, south.rect.x + south.rect.w);

          if (Math.random() < doorChance && xMax - xMin >= 1) {
            const margin = xMax - xMin > 2 ? 1 : 0;
            const doorX = xMin + margin + Math.floor(Math.random() * Math.max(1, xMax - xMin - margin * 2));
            const doorGridZ = boundaryZ + 0.5;
            doors.push({ x: doorX, z: doorGridZ, orientation: 'EW', gapWidth: 1 });
            doorCells.add(`${doorX},${boundaryZ}`);
            doorCells.add(`${doorX},${nextZ}`);
          }
        }
      }
    }

    // Mark door cells in roomOwnership as -2 (suppress wall generation there)
    for (const key of doorCells) {
      const [gxs, gzs] = key.split(',');
      const gx = parseInt(gxs), gz = parseInt(gzs);
      if (gx >= 0 && gx < gridW && gz >= 0 && gz < gridD) {
        roomOwnership[gz * gridW + gx] = -2;
      }
    }

    return { rooms, corridors, openGrid, gridW, gridD, doors, roomOwnership };
  }

  // wallGap>0: use punchDoor to carve through wall gaps
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < cols; rx++) {
      const room = roomGrid[ry][rx];
      if (!room) continue;

      if (rx + 1 < cols && roomGrid[ry][rx + 1]) {
        const east = roomGrid[ry][rx + 1]!;
        punchDoor(room.rect, east.rect, 'east', openGrid, gridW, gridD, corridors, doors);
      }
      if (ry + 1 < rows && roomGrid[ry + 1][rx]) {
        const south = roomGrid[ry + 1][rx]!;
        punchDoor(room.rect, south.rect, 'south', openGrid, gridW, gridD, corridors, doors);
      }
    }
  }

  ensureConnectivity(rooms, openGrid, gridW, gridD, corridors);

  // Apply minimum distance filter to room doors
  const MIN_DOOR_DIST_SQ = 5 * 5;
  const filteredDoors: DoorDef[] = [];
  for (const d of doors) {
    const tooClose = filteredDoors.some(fd => {
      const dx = d.x - fd.x;
      const dz = d.z - fd.z;
      return dx * dx + dz * dz < MIN_DOOR_DIST_SQ;
    });
    if (tooClose) continue;
    filteredDoors.push(d);
  }

  return { rooms, corridors, openGrid, gridW, gridD, doors: filteredDoors };
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
  doorChance = 0.7,
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

  for (const corridor of corridors) {
    for (const cell of corridor.cells) {
      const { gx, gz } = cell;
      if (roomGrid[gz * gridW + gx] >= 0) continue; // skip cells inside rooms

      const key = `${gx},${gz}`;
      if (seen.has(key)) continue;

      // Check if this corridor cell is adjacent to any room
      const hasRoomNeighbor =
        (gx + 1 < gridW && roomGrid[gz * gridW + gx + 1] >= 0) ||
        (gx - 1 >= 0 && roomGrid[gz * gridW + gx - 1] >= 0) ||
        (gz + 1 < gridD && roomGrid[(gz + 1) * gridW + gx] >= 0) ||
        (gz - 1 >= 0 && roomGrid[(gz - 1) * gridW + gx] >= 0);
      if (!hasRoomNeighbor) continue;

      // Determine orientation: check if perpendicular cells are also corridor
      // If no corridor to north/south → corridor is 1-cell wide in Z → runs EW → NS door
      // If no corridor to east/west → corridor is 1-cell wide in X → runs NS → EW door
      const corrN = isCorridor(gx, gz - 1);
      const corrS = isCorridor(gx, gz + 1);
      const corrE = isCorridor(gx + 1, gz);
      const corrW = isCorridor(gx - 1, gz);

      let orientation: 'NS' | 'EW';
      if (!corrN && !corrS) {
        orientation = 'NS'; // narrow in Z → door runs NS
      } else if (!corrE && !corrW) {
        orientation = 'EW'; // narrow in X → door runs EW
      } else {
        continue; // corridor is wide or intersection — skip
      }

      seen.add(key);

      candidates.push({ x: gx, z: gz, orientation, gapWidth: 1 });
    }
  }

  console.log(`[DOOR] candidates=${candidates.length}, corridorCells=${corridorSet.size}`);

  // Shuffle so selection isn't biased by scan order
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  // Filter: min distance between doors + doorChance
  const MIN_DIST_SQ = 3 * 3;
  const doors: DoorDef[] = [];

  for (const c of candidates) {
    if (Math.random() > doorChance) continue;
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

/** Distribute total into n roughly-equal segments */
function distributeEvenly(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const sizes = new Array(n).fill(base);
  let remainder = total - base * n;
  for (let i = 0; i < remainder; i++) sizes[i]++;
  return sizes;
}

/**
 * Punch a 1-cell door through the wall strip between two rooms.
 * Carves all cells in the gap between room A's edge and room B's edge.
 * Records a DoorDef at the midpoint of the gap for door mesh placement.
 */
function punchDoor(
  a: Rect, b: Rect,
  direction: 'east' | 'south',
  openGrid: boolean[],
  gridW: number,
  gridD: number,
  corridors: DungeonCorridor[],
  doors: DoorDef[],
): void {
  const cells: { gx: number; gz: number }[] = [];

  if (direction === 'east') {
    // Wall strip runs from a.x+a.w to b.x along Z overlap
    const gapStart = a.x + a.w;
    const gapEnd = b.x;
    const zMin = Math.max(a.z, b.z);
    const zMax = Math.min(a.z + a.d, b.z + b.d);
    if (zMax - zMin < 1) return;
    // Pick door Z position (avoid corners)
    const margin = zMax - zMin > 2 ? 1 : 0;
    const doorZ = zMin + margin + Math.floor(Math.random() * Math.max(1, zMax - zMin - margin * 2));
    if (doorZ >= gridD) return;
    for (let gx = gapStart; gx < gapEnd; gx++) {
      if (gx >= 0 && gx < gridW) {
        openGrid[doorZ * gridW + gx] = true;
        cells.push({ gx, gz: doorZ });
      }
    }
    // ~60% chance to place a door at midpoint of the gap
    if (Math.random() < 0.7) {
      const midGX = (gapStart + gapEnd - 1) / 2;
      doors.push({ x: midGX, z: doorZ, orientation: 'NS', gapWidth: 1 });
    }
  } else {
    // Wall strip runs from a.z+a.d to b.z along X overlap
    const gapStart = a.z + a.d;
    const gapEnd = b.z;
    const xMin = Math.max(a.x, b.x);
    const xMax = Math.min(a.x + a.w, b.x + b.w);
    if (xMax - xMin < 1) return;
    const margin = xMax - xMin > 2 ? 1 : 0;
    const doorX = xMin + margin + Math.floor(Math.random() * Math.max(1, xMax - xMin - margin * 2));
    if (doorX >= gridW) return;
    for (let gz = gapStart; gz < gapEnd; gz++) {
      if (gz >= 0 && gz < gridD) {
        openGrid[gz * gridW + doorX] = true;
        cells.push({ gx: doorX, gz });
      }
    }
    // ~60% chance to place a door at midpoint of the gap
    if (Math.random() < 0.7) {
      const midGZ = (gapStart + gapEnd - 1) / 2;
      doors.push({ x: doorX, z: midGZ, orientation: 'EW', gapWidth: 1 });
    }
  }

  if (cells.length > 0) {
    corridors.push({ cells });
  }
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
        if (isOpen(gx, gz - 1) && isOpen(gx, gz + 1)) {
          if (roomGrid[(gz - 1) * gridW + gx] < 0) {
            openGrid[(gz - 1) * gridW + gx] = false; changed = true;
          } else if (roomGrid[(gz + 1) * gridW + gx] < 0) {
            openGrid[(gz + 1) * gridW + gx] = false; changed = true;
          }
        }
        if (isOpen(gx - 1, gz) && isOpen(gx + 1, gz)) {
          if (roomGrid[gz * gridW + (gx - 1)] < 0) {
            openGrid[gz * gridW + (gx - 1)] = false; changed = true;
          } else if (roomGrid[gz * gridW + (gx + 1)] < 0) {
            openGrid[gz * gridW + (gx + 1)] = false; changed = true;
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
