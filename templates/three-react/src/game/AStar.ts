/**
 * A* pathfinder with binary heap and string-pulling smoothing.
 * Pure TypeScript, depends only on NavGrid types.
 */

import type { NavGrid } from './NavGrid';

export interface PathResult {
  found: boolean;
  path: { x: number; z: number }[];
}

// Direction offsets matching NavGrid: 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW
const DIR_DGX = [0, 1, 1, 1, 0, -1, -1, -1];
const DIR_DGZ = [-1, -1, 0, 1, 1, 1, 0, -1];
const SQRT2 = Math.SQRT2;

/** Binary min-heap keyed by f-score */
class BinaryHeap {
  private data: number[] = []; // node indices
  private fScores: Float32Array;

  constructor(fScores: Float32Array) {
    this.fScores = fScores;
  }

  get size(): number { return this.data.length; }

  push(node: number): void {
    this.data.push(node);
    this.siftUp(this.data.length - 1);
  }

  pop(): number {
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(i: number): void {
    const { data, fScores } = this;
    const node = data[i];
    const f = fScores[node];
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (fScores[data[parent]] <= f) break;
      data[i] = data[parent];
      i = parent;
    }
    data[i] = node;
  }

  private siftDown(i: number): void {
    const { data, fScores } = this;
    const len = data.length;
    const node = data[i];
    const f = fScores[node];
    while (true) {
      let smallest = i;
      let smallestF = f;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < len && fScores[data[left]] < smallestF) {
        smallest = left;
        smallestF = fScores[data[left]];
      }
      if (right < len && fScores[data[right]] < smallestF) {
        smallest = right;
      }
      if (smallest === i) break;
      data[i] = data[smallest];
      data[smallest] = node;
      i = smallest;
    }
  }
}

/** Chebyshev distance heuristic — admissible for 8-dir with cardinal=1, diagonal=√2 */
function heuristic(ax: number, az: number, bx: number, bz: number): number {
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  // Chebyshev: max(dx,dz) + (√2-1)*min(dx,dz) — octile distance
  return dx > dz
    ? dz * SQRT2 + (dx - dz)
    : dx * SQRT2 + (dz - dx);
}

/** Cost multiplier for each unit of height change on an edge. Makes NPCs prefer flat routes. */
const ELEVATION_PENALTY = 3;

export function findPath(
  grid: NavGrid,
  startX: number,
  startZ: number,
  goalX: number,
  goalZ: number,
  maxIterations = 10000,
): PathResult {
  const start = grid.worldToGrid(startX, startZ);
  const goal = grid.worldToGrid(goalX, goalZ);

  // Quick bail: start or goal blocked
  const startCell = grid.getCell(start.gx, start.gz);
  const goalCell = grid.getCell(goal.gx, goal.gz);
  if (!startCell || startCell.blocked || !goalCell || goalCell.blocked) {
    return { found: false, path: [] };
  }

  // Already there
  if (start.gx === goal.gx && start.gz === goal.gz) {
    const w = grid.gridToWorld(goal.gx, goal.gz);
    return { found: true, path: [{ x: goalX, z: goalZ }] };
  }

  const w = grid.width;
  const totalCells = w * grid.height;

  const gScore = new Float32Array(totalCells).fill(Infinity);
  const fScore = new Float32Array(totalCells).fill(Infinity);
  const cameFrom = new Int32Array(totalCells).fill(-1);
  const closed = new Uint8Array(totalCells);

  const startIdx = start.gz * w + start.gx;
  const goalIdx = goal.gz * w + goal.gx;

  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(start.gx, start.gz, goal.gx, goal.gz);

  const open = new BinaryHeap(fScore);
  open.push(startIdx);

  let iterations = 0;

  while (open.size > 0 && iterations < maxIterations) {
    iterations++;
    const currentIdx = open.pop();

    // Lazy deletion: skip if already closed
    if (closed[currentIdx]) continue;
    closed[currentIdx] = 1;

    if (currentIdx === goalIdx) {
      // Reconstruct path
      const gridPath = reconstructPath(cameFrom, currentIdx, w);
      const worldPath = gridPathToWorld(grid, gridPath, startX, startZ, goalX, goalZ);
      const smoothed = stringPull(grid, worldPath);
      return { found: true, path: smoothed };
    }

    const cgx = currentIdx % w;
    const cgz = (currentIdx - cgx) / w;
    const currentG = gScore[currentIdx];

    for (let dir = 0; dir < 8; dir++) {
      if (!grid.canPass(cgx, cgz, dir)) continue;

      const ngx = cgx + DIR_DGX[dir];
      const ngz = cgz + DIR_DGZ[dir];
      const nIdx = ngz * w + ngx;

      if (closed[nIdx]) continue;

      const baseCost = dir % 2 === 0 ? 1 : SQRT2;
      // Penalize height changes so NPCs prefer flat routes over climbing
      const currentCell = grid.getCell(cgx, cgz)!;
      const neighborCell = grid.getCell(ngx, ngz)!;
      const heightDelta = Math.abs(currentCell.surfaceHeight - neighborCell.surfaceHeight);
      const cost = baseCost + heightDelta * ELEVATION_PENALTY;
      const tentativeG = currentG + cost;

      if (tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = currentIdx;
        gScore[nIdx] = tentativeG;
        fScore[nIdx] = tentativeG + heuristic(ngx, ngz, goal.gx, goal.gz);
        open.push(nIdx); // May add duplicates; lazy deletion handles it
      }
    }
  }

  return { found: false, path: [] };
}

function reconstructPath(cameFrom: Int32Array, endIdx: number, width: number): { gx: number; gz: number }[] {
  const path: { gx: number; gz: number }[] = [];
  let idx = endIdx;
  while (idx !== -1) {
    const gx = idx % width;
    const gz = (idx - gx) / width;
    path.push({ gx, gz });
    idx = cameFrom[idx];
  }
  path.reverse();
  return path;
}

function gridPathToWorld(
  grid: NavGrid,
  gridPath: { gx: number; gz: number }[],
  startX: number,
  startZ: number,
  goalX: number,
  goalZ: number,
): { x: number; z: number }[] {
  if (gridPath.length === 0) return [];

  const worldPath: { x: number; z: number }[] = [];

  // First waypoint: actual start position
  worldPath.push({ x: startX, z: startZ });

  // Middle waypoints: grid cell centers (skip first and last)
  for (let i = 1; i < gridPath.length - 1; i++) {
    const w = grid.gridToWorld(gridPath[i].gx, gridPath[i].gz);
    worldPath.push(w);
  }

  // Last waypoint: actual goal position
  if (gridPath.length > 1) {
    worldPath.push({ x: goalX, z: goalZ });
  }

  return worldPath;
}

/** String-pulling: skip to farthest visible waypoint to smooth grid staircase */
function stringPull(grid: NavGrid, path: { x: number; z: number }[]): { x: number; z: number }[] {
  if (path.length <= 2) return path;

  const result: { x: number; z: number }[] = [path[0]];
  let current = 0;

  while (current < path.length - 1) {
    let farthest = current + 1;

    // Try to skip ahead to the farthest visible waypoint
    for (let i = current + 2; i < path.length; i++) {
      const fromG = grid.worldToGrid(path[current].x, path[current].z);
      const toG = grid.worldToGrid(path[i].x, path[i].z);
      if (grid.hasLineOfSight(fromG.gx, fromG.gz, toG.gx, toG.gz)) {
        farthest = i;
      }
    }

    result.push(path[farthest]);
    current = farthest;
  }

  return result;
}
