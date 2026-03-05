/**
 * NavGrid — rasterized navigation grid for A* pathfinding.
 * Pure TypeScript, no Three.js dependency.
 */

import type { NavLink } from '../dungeon';
import type { StairDef } from '../dungeon';

/** Slope direction: which edge of the box is the HIGH side.
 *  0 = +Z, 1 = +X, 2 = -Z, 3 = -X */
export type SlopeDir = 0 | 1 | 2 | 3;

export interface AABBBox {
  readonly x: number;
  readonly z: number;
  readonly halfW: number;
  readonly halfD: number;
  readonly height: number;
  /** If set, this box is a ramp/slope. Height interpolates from 0 to `height`. */
  readonly slopeDir?: SlopeDir;
}

/** Get the effective height of a box at a world-space point.
 *  For slopes, interpolates linearly from 0 (low edge) to height (high edge).
 *  For regular boxes, always returns box.height. */
export function getBoxHeightAt(box: AABBBox, px: number, pz: number): number {
  if (box.slopeDir === undefined) return box.height;
  let t: number;
  switch (box.slopeDir) {
    case 0: t = (pz - (box.z - box.halfD)) / (2 * box.halfD); break;
    case 1: t = (px - (box.x - box.halfW)) / (2 * box.halfW); break;
    case 2: t = ((box.z + box.halfD) - pz) / (2 * box.halfD); break;
    case 3: t = ((box.x + box.halfW) - px) / (2 * box.halfW); break;
  }
  return Math.max(0, Math.min(1, t)) * box.height;
}

export interface NavCell {
  gx: number;
  gz: number;
  worldX: number;
  worldZ: number;
  surfaceHeight: number;
  blocked: boolean;
  /** Passability bitmask for 8 directions: bit i set = can pass in direction i */
  passable: number;
}

// Direction indices: 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW
// N is -Z, S is +Z in world coords
const DIR_DGX = [0, 1, 1, 1, 0, -1, -1, -1];
const DIR_DGZ = [-1, -1, 0, 1, 1, 1, 0, -1];

// For diagonal dir i, the two adjacent cardinal directions
// NE(1) -> N(0), E(2); SE(3) -> E(2), S(4); SW(5) -> S(4), W(6); NW(7) -> W(6), N(0)
const DIAGONAL_CARDINALS: Record<number, [number, number]> = {
  1: [0, 2],
  3: [2, 4],
  5: [4, 6],
  7: [6, 0],
};

export class NavGrid {
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  private originX: number;
  private originZ: number;
  private cells: NavCell[];
  private stepHeight = 0.5;
  private slopeHeight = 1.0;
  private navLinks: Map<number, NavLink[]> = new Map();
  private spawnRegionLabel = -1;
  private regionLabels: Int32Array | null = null;

  constructor(worldWidth: number, worldDepth: number, cellSize = 0.5) {
    this.cellSize = cellSize;
    this.width = Math.ceil(worldWidth / cellSize);
    this.height = Math.ceil(worldDepth / cellSize);
    this.originX = -worldWidth / 2;
    this.originZ = -worldDepth / 2;
    this.cells = [];
  }

  /** Initialize all cells with default values (blocked, height=0).
   *  Use this when populating cells manually instead of calling build(). */
  initCells(): void {
    const { width, height, cellSize, originX, originZ } = this;
    const totalCells = width * height;
    this.cells = new Array(totalCells);
    for (let gz = 0; gz < height; gz++) {
      for (let gx = 0; gx < width; gx++) {
        const idx = gz * width + gx;
        this.cells[idx] = {
          gx, gz,
          worldX: originX + (gx + 0.5) * cellSize,
          worldZ: originZ + (gz + 0.5) * cellSize,
          surfaceHeight: 0,
          blocked: true,
          passable: 0,
        };
      }
    }
  }

  build(boxes: ReadonlyArray<AABBBox>, stepHeight: number, capsuleRadius: number): void {
    this.stepHeight = stepHeight;
    this.navLinks.clear();
    const { width, height, cellSize, originX, originZ } = this;
    const totalCells = width * height;
    this.cells = new Array(totalCells);

    // 1. Compute surface height and blocked status for each cell
    for (let gz = 0; gz < height; gz++) {
      for (let gx = 0; gx < width; gx++) {
        const worldX = originX + (gx + 0.5) * cellSize;
        const worldZ = originZ + (gz + 0.5) * cellSize;

        // Surface height = max height of overlapping boxes at cell center
        let surfaceHeight = 0;
        for (const box of boxes) {
          if (
            Math.abs(worldX - box.x) < box.halfW &&
            Math.abs(worldZ - box.z) < box.halfD
          ) {
            const h = getBoxHeightAt(box, worldX, worldZ);
            surfaceHeight = Math.max(surfaceHeight, h);
          }
        }

        // Blocked = any box taller than stepHeight above surface overlaps expanded cell
        let blocked = false;
        for (const box of boxes) {
          const effectiveH = getBoxHeightAt(box, worldX, worldZ);
          if (effectiveH - surfaceHeight <= stepHeight) continue;
          if (
            Math.abs(worldX - box.x) < box.halfW + capsuleRadius &&
            Math.abs(worldZ - box.z) < box.halfD + capsuleRadius
          ) {
            blocked = true;
            break;
          }
        }

        const idx = gz * width + gx;
        this.cells[idx] = {
          gx, gz,
          worldX, worldZ,
          surfaceHeight,
          blocked,
          passable: 0,
        };
      }
    }

    // 2. Compute per-edge passability
    for (let gz = 0; gz < height; gz++) {
      for (let gx = 0; gx < width; gx++) {
        const cell = this.cells[gz * width + gx];
        if (cell.blocked) continue;

        let mask = 0;
        for (let dir = 0; dir < 8; dir++) {
          const ngx = gx + DIR_DGX[dir];
          const ngz = gz + DIR_DGZ[dir];

          if (ngx < 0 || ngx >= width || ngz < 0 || ngz >= height) continue;
          const neighbor = this.cells[ngz * width + ngx];
          if (neighbor.blocked) continue;

          // Height check
          if (Math.abs(cell.surfaceHeight - neighbor.surfaceHeight) > stepHeight) continue;

          // Diagonal: both adjacent cardinals must also be passable
          if (dir % 2 === 1) {
            const [c1, c2] = DIAGONAL_CARDINALS[dir];
            const n1gx = gx + DIR_DGX[c1];
            const n1gz = gz + DIR_DGZ[c1];
            const n2gx = gx + DIR_DGX[c2];
            const n2gz = gz + DIR_DGZ[c2];

            if (n1gx < 0 || n1gx >= width || n1gz < 0 || n1gz >= height) continue;
            if (n2gx < 0 || n2gx >= width || n2gz < 0 || n2gz >= height) continue;

            const adj1 = this.cells[n1gz * width + n1gx];
            const adj2 = this.cells[n2gz * width + n2gx];
            if (adj1.blocked || adj2.blocked) continue;
            if (Math.abs(cell.surfaceHeight - adj1.surfaceHeight) > stepHeight) continue;
            if (Math.abs(cell.surfaceHeight - adj2.surfaceHeight) > stepHeight) continue;
          }

          mask |= 1 << dir;
        }
        cell.passable = mask;
      }
    }
  }

  getCell(gx: number, gz: number): NavCell | null {
    if (gx < 0 || gx >= this.width || gz < 0 || gz >= this.height) return null;
    return this.cells[gz * this.width + gx];
  }

  worldToGrid(x: number, z: number): { gx: number; gz: number } {
    const gx = Math.floor((x - this.originX) / this.cellSize);
    const gz = Math.floor((z - this.originZ) / this.cellSize);
    return {
      gx: Math.max(0, Math.min(this.width - 1, gx)),
      gz: Math.max(0, Math.min(this.height - 1, gz)),
    };
  }

  gridToWorld(gx: number, gz: number): { x: number; z: number } {
    return {
      x: this.originX + (gx + 0.5) * this.cellSize,
      z: this.originZ + (gz + 0.5) * this.cellSize,
    };
  }

  /** Count walkable cells (not blocked, has at least one passable edge) */
  getWalkableCellCount(): number {
    let count = 0;
    for (const cell of this.cells) {
      if (!cell.blocked && cell.passable !== 0) count++;
    }
    return count;
  }

  /** Check if a world-space position is on a walkable cell (not blocked and has passable edges) */
  isWalkable(x: number, z: number): boolean {
    const { gx, gz } = this.worldToGrid(x, z);
    const cell = this.getCell(gx, gz);
    return cell !== null && !cell.blocked && cell.passable !== 0;
  }

  /** Snap a world position to the center of its nav cell */
  snapToGrid(x: number, z: number): { x: number; z: number } {
    const { gx, gz } = this.worldToGrid(x, z);
    return this.gridToWorld(gx, gz);
  }

  /** Bake connected-region labels and identify the spawn region (largest region).
   *  Call once after all nav-links are registered. */
  bakeSpawnRegion(): void {
    const { labels } = this.labelConnectedRegions();
    this.regionLabels = labels;
    // Use the largest region as spawn — not (0,0) which may be a tiny terrace
    const regionSizes = new Map<number, number>();
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] < 0) continue;
      regionSizes.set(labels[i], (regionSizes.get(labels[i]) ?? 0) + 1);
    }
    let largestLabel = -1;
    let largestSize = 0;
    for (const [r, size] of regionSizes) {
      if (size > largestSize) { largestLabel = r; largestSize = size; }
    }
    this.spawnRegionLabel = largestLabel;
  }

  /** Check if a world-space position is in the main spawn region AND on a well-connected cell.
   *  Requires at least 4 passable directions to avoid spawning on cliff edges/slopes. */
  isInSpawnRegion(x: number, z: number): boolean {
    if (!this.regionLabels || this.spawnRegionLabel < 0) return true; // not baked yet, allow
    const { gx, gz } = this.worldToGrid(x, z);
    const idx = gz * this.width + gx;
    if (this.regionLabels[idx] !== this.spawnRegionLabel) return false;
    const cell = this.cells[idx];
    if (!cell || cell.blocked) return false;
    // Count passable directions — need at least 4 to be on solid ground
    let dirs = cell.passable;
    let count = 0;
    while (dirs) { count += dirs & 1; dirs >>= 1; }
    return count >= 4;
  }

  /**
   * Apply a walkability mask from a coarser grid (e.g. dungeon room grid).
   * Nav cells whose center falls on a non-open room-grid cell are blocked.
   * Recomputes passability after blocking.
   */
  applyWalkMask(openGrid: boolean[], maskGridW: number, maskGridD: number, maskCellSize: number, worldSize: number): void {
    const halfWorld = worldSize / 2;

    // Block nav cells outside the open mask
    for (const cell of this.cells) {
      const mgx = Math.floor((cell.worldX + halfWorld) / maskCellSize);
      const mgz = Math.floor((cell.worldZ + halfWorld) / maskCellSize);
      if (mgx < 0 || mgx >= maskGridW || mgz < 0 || mgz >= maskGridD ||
          !openGrid[mgz * maskGridW + mgx]) {
        cell.blocked = true;
        cell.passable = 0;
      }
    }

    this.recomputePassability();
  }

  /**
   * Apply dungeon cell heights to nav cells.
   * Maps each nav cell to its dungeon grid cell and sets surfaceHeight accordingly.
   * Then recomputes passability based on the new heights.
   */
  applyCellHeights(
    cellHeights: Float32Array,
    dungeonGridW: number,
    dungeonGridD: number,
    dungeonCellSize: number,
    worldSize: number,
    baseFloorY: number,
    stairMap?: Map<number, StairDef>,
  ): void {
    const halfWorld = worldSize / 2;
    const STEPS = 6;

    for (const cell of this.cells) {
      if (cell.blocked) continue;
      const mgx = Math.floor((cell.worldX + halfWorld) / dungeonCellSize);
      const mgz = Math.floor((cell.worldZ + halfWorld) / dungeonCellSize);
      if (mgx < 0 || mgx >= dungeonGridW || mgz < 0 || mgz >= dungeonGridD) continue;
      const idx = mgz * dungeonGridW + mgx;
      const ch = cellHeights[idx];

      // Sub-cell stair height: match Terrain.getCellHeightAt logic
      const stair = stairMap?.get(idx);
      if (stair) {
        const cellCenterX = -halfWorld + (mgx + 0.5) * dungeonCellSize;
        const cellCenterZ = -halfWorld + (mgz + 0.5) * dungeonCellSize;
        const halfCell = dungeonCellSize / 2;
        let localT: number;
        if (stair.axis === 'x') {
          const localX = cell.worldX - cellCenterX;
          localT = stair.direction > 0 ? (localX + halfCell) / dungeonCellSize : (halfCell - localX) / dungeonCellSize;
        } else {
          const localZ = cell.worldZ - cellCenterZ;
          localT = stair.direction > 0 ? (localZ + halfCell) / dungeonCellSize : (halfCell - localZ) / dungeonCellSize;
        }
        localT = Math.max(0, Math.min(1, localT));
        const step = Math.min(STEPS - 1, Math.floor(localT * STEPS));
        cell.surfaceHeight = baseFloorY + ch + (step + 1) * (stair.totalHeight / STEPS);
      } else {
        cell.surfaceHeight = baseFloorY + ch;
      }
    }

    this.recomputePassability();
  }

  /** Recompute per-edge passability for all non-blocked cells. */
  private recomputePassability(): void {
    const { width, height } = this;
    for (let gz = 0; gz < height; gz++) {
      for (let gx = 0; gx < width; gx++) {
        const cell = this.cells[gz * width + gx];
        if (cell.blocked) continue;
        let mask = 0;
        for (let dir = 0; dir < 8; dir++) {
          const ngx = gx + DIR_DGX[dir];
          const ngz = gz + DIR_DGZ[dir];
          if (ngx < 0 || ngx >= width || ngz < 0 || ngz >= height) continue;
          const neighbor = this.cells[ngz * width + ngx];
          if (neighbor.blocked) continue;
          if (Math.abs(cell.surfaceHeight - neighbor.surfaceHeight) > this.stepHeight) continue;
          if (dir % 2 === 1) {
            const [c1, c2] = DIAGONAL_CARDINALS[dir];
            const n1gx = gx + DIR_DGX[c1], n1gz = gz + DIR_DGZ[c1];
            const n2gx = gx + DIR_DGX[c2], n2gz = gz + DIR_DGZ[c2];
            if (n1gx < 0 || n1gx >= width || n1gz < 0 || n1gz >= height) continue;
            if (n2gx < 0 || n2gx >= width || n2gz < 0 || n2gz >= height) continue;
            const adj1 = this.cells[n1gz * width + n1gx];
            const adj2 = this.cells[n2gz * width + n2gx];
            if (adj1.blocked || adj2.blocked) continue;
            if (Math.abs(cell.surfaceHeight - adj1.surfaceHeight) > this.stepHeight) continue;
            if (Math.abs(cell.surfaceHeight - adj2.surfaceHeight) > this.stepHeight) continue;
          }
          mask |= 1 << dir;
        }
        cell.passable = mask;
      }
    }
  }

  /**
   * Block specific nav cells (e.g. cells containing voxel props).
   * Recomputes passability and spawn region.
   */
  applyBlockedCells(cells: ReadonlyArray<{ gx: number; gz: number }>): void {
    const { width, height } = this;
    for (const { gx, gz } of cells) {
      if (gx < 0 || gx >= width || gz < 0 || gz >= height) continue;
      const cell = this.cells[gz * width + gx];
      if (cell) {
        cell.blocked = true;
        cell.passable = 0;
      }
    }

    this.recomputePassability();
    this.bakeSpawnRegion();
  }

  /**
   * Unblock specific nav cells (e.g. after destroying a prop).
   * Recomputes passability and spawn region.
   */
  unblockCells(cells: ReadonlyArray<{ gx: number; gz: number }>): void {
    const { width, height } = this;
    for (const { gx, gz } of cells) {
      if (gx < 0 || gx >= width || gz < 0 || gz >= height) continue;
      const cell = this.cells[gz * width + gx];
      if (cell) {
        cell.blocked = false;
      }
    }

    this.recomputePassability();
    this.bakeSpawnRegion();
  }

  /** Return the world position of a random cell in the spawn region, or null if none. */
  getRandomSpawnCell(): { x: number; z: number; surfaceHeight: number } | null {
    if (!this.regionLabels || this.spawnRegionLabel < 0) return null;
    // Collect valid spawn indices
    const candidates: number[] = [];
    for (let i = 0; i < this.cells.length; i++) {
      if (this.regionLabels[i] !== this.spawnRegionLabel) continue;
      const cell = this.cells[i];
      if (!cell || cell.blocked) continue;
      let dirs = cell.passable, count = 0;
      while (dirs) { count += dirs & 1; dirs >>= 1; }
      if (count >= 4) candidates.push(i);
    }
    if (candidates.length === 0) return null;
    const idx = candidates[Math.floor(Math.random() * candidates.length)];
    const cell = this.cells[idx];
    return { x: cell.worldX, z: cell.worldZ, surfaceHeight: cell.surfaceHeight };
  }

  /** World-space bounds: half-extent of the grid */
  getHalfSize(): number {
    return this.width * this.cellSize / 2;
  }

  /** Check if any cardinal neighbor of a cell is blocked or out of bounds. */
  hasBlockedNeighbor(gx: number, gz: number): boolean {
    for (let dir = 0; dir < 8; dir += 2) { // cardinals only: 0(N), 2(E), 4(S), 6(W)
      const ngx = gx + DIR_DGX[dir];
      const ngz = gz + DIR_DGZ[dir];
      if (ngx < 0 || ngx >= this.width || ngz < 0 || ngz >= this.height) return true;
      const neighbor = this.cells[ngz * this.width + ngx];
      if (neighbor.blocked) return true;
    }
    return false;
  }

  canPass(gx: number, gz: number, dir: number): boolean {
    const cell = this.getCell(gx, gz);
    if (!cell) return false;
    return (cell.passable & (1 << dir)) !== 0;
  }

  /** Build nav grid directly from a vertex-based heightmap.
   *  heights: (hmResolution+1)² Float32Array, hmResolution = number of heightmap cells.
   *  Each nav cell's surfaceHeight = average of its 4 corner vertices.
   *  No cells are blocked (no walls), passability depends on height difference. */
  buildFromHeightmap(
    heights: Float32Array,
    hmResolution: number,
    groundSize: number,
    stepHeight: number,
    slopeHeight?: number,
  ): void {
    this.stepHeight = stepHeight;
    this.slopeHeight = slopeHeight ?? stepHeight;
    this.navLinks.clear();
    const { width, height, cellSize, originX, originZ } = this;
    const totalCells = width * height;
    this.cells = new Array(totalCells);
    const hmVerts = hmResolution + 1;
    const hmCellSize = groundSize / hmResolution;
    const halfGround = groundSize / 2;

    // 1. Compute surface height for each nav cell by sampling the heightmap
    for (let gz = 0; gz < height; gz++) {
      for (let gx = 0; gx < width; gx++) {
        const worldX = originX + (gx + 0.5) * cellSize;
        const worldZ = originZ + (gz + 0.5) * cellSize;

        // Sample heightmap via bilinear interpolation
        const hgx = (worldX + halfGround) / hmCellSize;
        const hgz = (worldZ + halfGround) / hmCellSize;
        const cix = Math.max(0, Math.min(hmResolution - 1e-6, hgx));
        const ciz = Math.max(0, Math.min(hmResolution - 1e-6, hgz));
        const ix = Math.floor(cix);
        const iz = Math.floor(ciz);
        const fx = cix - ix;
        const fz = ciz - iz;

        const h00 = heights[iz * hmVerts + ix];
        const h10 = heights[iz * hmVerts + ix + 1];
        const h01 = heights[(iz + 1) * hmVerts + ix];
        const h11 = heights[(iz + 1) * hmVerts + ix + 1];
        const surfaceHeight = h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) +
          h01 * (1 - fx) * fz + h11 * fx * fz;

        // Block cells near world edge to prevent pathfinding outside visible mesh.
        // NavGrid is wider than the heightmap mesh by 2m on each side.
        // Compute margin in cells based on actual cell size.
        const EDGE_MARGIN = Math.ceil(2.5 / cellSize);
        const nearEdge = gx < EDGE_MARGIN || gx >= width - EDGE_MARGIN ||
                         gz < EDGE_MARGIN || gz >= height - EDGE_MARGIN;

        const idx = gz * width + gx;
        this.cells[idx] = {
          gx, gz,
          worldX, worldZ,
          surfaceHeight,
          blocked: nearEdge,
          passable: 0,
        };
      }
    }

    // Helper: sample heightmap at world XZ via bilinear interpolation
    const sampleHM = (wx: number, wz: number): number => {
      const sgx = Math.max(0, Math.min(hmResolution - 1e-6, (wx + halfGround) / hmCellSize));
      const sgz = Math.max(0, Math.min(hmResolution - 1e-6, (wz + halfGround) / hmCellSize));
      const six = Math.floor(sgx); const sfx = sgx - six;
      const siz = Math.floor(sgz); const sfz = sgz - siz;
      return heights[siz * hmVerts + six] * (1 - sfx) * (1 - sfz) +
        heights[siz * hmVerts + six + 1] * sfx * (1 - sfz) +
        heights[(siz + 1) * hmVerts + six] * (1 - sfx) * sfz +
        heights[(siz + 1) * hmVerts + six + 1] * sfx * sfz;
    };

    const halfCell = cellSize * 0.5;

    // Match resolveMovement's gradient check exactly:
    // It samples gradient at (pos + moveDir * eps) using getTerrainY with radius.
    const charRadius = 0.25;
    const sampleR = charRadius * 0.5;
    const effectiveSlopeHeight = slopeHeight ?? stepHeight * 2;
    const maxSlope = (effectiveSlopeHeight / hmCellSize) * 0.4;
    const eps = hmCellSize * 0.5;

    // Sample max height at a point + 4 cardinal offsets (matches getTerrainY with radius)
    const sampleHMRadius = (wx: number, wz: number, r: number): number => {
      if (r <= 0) return sampleHM(wx, wz);
      return Math.max(
        sampleHM(wx, wz),
        sampleHM(wx - r, wz),
        sampleHM(wx + r, wz),
        sampleHM(wx, wz - r),
        sampleHM(wx, wz + r),
      );
    };

    // Compute gradient magnitude at a point.
    // Uses plain sampleHM (no radius expansion) to avoid cliff-edge contamination.
    // The corner-based cell blocking (step 2) already catches actual cliff faces.
    // Using sampleHMRadius here would inflate gradients on flat cells near cliffs,
    // creating impassable rings that fragment terraces into tiny regions.
    const gradMagAt = (px: number, pz: number): number => {
      const hL = sampleHM(px - eps, pz);
      const hR = sampleHM(px + eps, pz);
      const hU = sampleHM(px, pz - eps);
      const hD = sampleHM(px, pz + eps);
      const gxV = (hR - hL) / (2 * eps);
      const gzV = (hD - hU) / (2 * eps);
      return Math.sqrt(gxV * gxV + gzV * gzV);
    };

    // 2. Block cells based on corner heights.
    // Sample the 4 corners of each cell. If the height range exceeds the threshold,
    // the cell is on a cliff face and is unwalkable.
    // Use a minimum sampling radius so that very small cells still detect nearby cliffs.
    const sampleHalf = Math.max(halfCell, hmCellSize * 0.5);
    for (let gz = 0; gz < height; gz++) {
      for (let gx = 0; gx < width; gx++) {
        const cell = this.cells[gz * width + gx];
        if (cell.blocked) continue;
        const wx = cell.worldX;
        const wz = cell.worldZ;
        const h00 = sampleHM(wx - sampleHalf, wz - sampleHalf);
        const h10 = sampleHM(wx + sampleHalf, wz - sampleHalf);
        const h01 = sampleHM(wx - sampleHalf, wz + sampleHalf);
        const h11 = sampleHM(wx + sampleHalf, wz + sampleHalf);
        const hMax = Math.max(h00, h10, h01, h11);
        const hMin = Math.min(h00, h10, h01, h11);

        if (hMax - hMin > stepHeight) {
          cell.blocked = true;
        }
      }
    }

    // 3. Compute per-edge passability.
    // For each edge A→B, simulate what resolveMovement does:
    // check the gradient "ahead" — at the neighbor cell center — in the movement direction.
    // If it exceeds maxSlope, the character would be blocked trying to walk there.
    for (let gz = 0; gz < height; gz++) {
      for (let gx = 0; gx < width; gx++) {
        const cell = this.cells[gz * width + gx];
        if (cell.blocked) continue; // blocked cells get passable=0

        let mask = 0;
        for (let dir = 0; dir < 8; dir++) {
          const ngx = gx + DIR_DGX[dir];
          const ngz = gz + DIR_DGZ[dir];

          if (ngx < 0 || ngx >= width || ngz < 0 || ngz >= height) continue;
          const neighbor = this.cells[ngz * width + ngx];
          if (neighbor.blocked) continue;

          // Height difference between cell centers
          if (Math.abs(cell.surfaceHeight - neighbor.surfaceHeight) > stepHeight) continue;

          // Ahead-gradient check: mirrors resolveMovement.
          // resolveMovement checks gradient ahead of the move direction.
          // We check at the midpoint and destination — slightly more permissive
          // than checking the source cell (which runtime doesn't do), so paths
          // exist wherever the character can actually walk.
          const midX = (cell.worldX + neighbor.worldX) * 0.5;
          const midZ = (cell.worldZ + neighbor.worldZ) * 0.5;
          const midGrad = gradMagAt(midX, midZ);
          if (midGrad > maxSlope) continue;

          const aheadGrad = gradMagAt(neighbor.worldX, neighbor.worldZ);
          if (aheadGrad > maxSlope) continue;

          // Diagonal: both adjacent cardinals must also be non-blocked and reachable
          if (dir % 2 === 1) {
            const [c1, c2] = DIAGONAL_CARDINALS[dir];
            const n1gx = gx + DIR_DGX[c1];
            const n1gz = gz + DIR_DGZ[c1];
            const n2gx = gx + DIR_DGX[c2];
            const n2gz = gz + DIR_DGZ[c2];

            if (n1gx < 0 || n1gx >= width || n1gz < 0 || n1gz >= height) continue;
            if (n2gx < 0 || n2gx >= width || n2gz < 0 || n2gz >= height) continue;

            const adj1 = this.cells[n1gz * width + n1gx];
            const adj2 = this.cells[n2gz * width + n2gx];
            if (adj1.blocked || adj2.blocked) continue;
            if (Math.abs(cell.surfaceHeight - adj1.surfaceHeight) > stepHeight) continue;
            if (Math.abs(cell.surfaceHeight - adj2.surfaceHeight) > stepHeight) continue;
          }

          mask |= 1 << dir;
        }
        cell.passable = mask;
      }
    }
  }

  /** Block nav cells that overlap with tall debris boxes (height > stepHeight above surface). */
  applyDebrisBlocking(debris: ReadonlyArray<{ x: number; z: number; halfW: number; halfD: number; height: number; rotation?: number }>): void {
    const { width, height, cellSize, originX, originZ } = this;
    const stepH = this.stepHeight;
    for (const box of debris) {
      // Compute AABB that encloses the possibly-rotated box (for broad-phase cell scan)
      let scanHW = box.halfW, scanHD = box.halfD;
      if (box.rotation) {
        const cos = Math.cos(box.rotation);
        const sin = Math.sin(box.rotation);
        scanHW = Math.abs(box.halfW * cos) + Math.abs(box.halfD * sin);
        scanHD = Math.abs(box.halfW * sin) + Math.abs(box.halfD * cos);
      }
      const minGX = Math.max(0, Math.floor((box.x - scanHW - originX) / cellSize - 0.5));
      const maxGX = Math.min(width - 1, Math.ceil((box.x + scanHW - originX) / cellSize + 0.5));
      const minGZ = Math.max(0, Math.floor((box.z - scanHD - originZ) / cellSize - 0.5));
      const maxGZ = Math.min(height - 1, Math.ceil((box.z + scanHD - originZ) / cellSize + 0.5));

      // Precompute inverse rotation for OBB test
      const hasRot = !!box.rotation;
      const cosInv = hasRot ? Math.cos(-box.rotation!) : 1;
      const sinInv = hasRot ? Math.sin(-box.rotation!) : 0;

      for (let gz = minGZ; gz <= maxGZ; gz++) {
        for (let gx = minGX; gx <= maxGX; gx++) {
          const cell = this.cells[gz * width + gx];
          if (cell.blocked) continue;
          // Transform cell center into box-local space
          let dx = cell.worldX - box.x;
          let dz = cell.worldZ - box.z;
          if (hasRot) {
            const lx = dx * cosInv + dz * sinInv;
            const lz = -dx * sinInv + dz * cosInv;
            dx = lx; dz = lz;
          }
          if (Math.abs(dx) < box.halfW + cellSize * 0.3 &&
              Math.abs(dz) < box.halfD + cellSize * 0.3) {
            if (box.height - cell.surfaceHeight > stepH) {
              cell.blocked = true;
              cell.passable = 0;
            }
          }
        }
      }
    }

    // Recompute passability for neighbors of newly blocked cells
    for (let gz = 0; gz < height; gz++) {
      for (let gx = 0; gx < width; gx++) {
        const cell = this.cells[gz * width + gx];
        if (cell.blocked) continue;
        let mask = cell.passable;
        for (let dir = 0; dir < 8; dir++) {
          if (!(mask & (1 << dir))) continue;
          const ngx = gx + DIR_DGX[dir];
          const ngz = gz + DIR_DGZ[dir];
          if (ngx < 0 || ngx >= width || ngz < 0 || ngz >= height) continue;
          if (this.cells[ngz * width + ngx].blocked) {
            mask &= ~(1 << dir);
          }
        }
        cell.passable = mask;
      }
    }
  }

  /** Add a bidirectional nav-link between two cells (e.g. for ladders). */
  addNavLink(fromGX: number, fromGZ: number, toGX: number, toGZ: number, cost: number, ladderIndex: number): void {
    const w = this.width;
    const fromKey = fromGZ * w + fromGX;
    const toKey = toGZ * w + toGX;

    if (!this.navLinks.has(fromKey)) this.navLinks.set(fromKey, []);
    this.navLinks.get(fromKey)!.push({ toGX, toGZ, cost, ladderIndex });

    if (!this.navLinks.has(toKey)) this.navLinks.set(toKey, []);
    this.navLinks.get(toKey)!.push({ toGX: fromGX, toGZ: fromGZ, cost, ladderIndex });
  }

  /** Get nav-links from a cell, if any. */
  getNavLinks(gx: number, gz: number): NavLink[] | undefined {
    return this.navLinks.get(gz * this.width + gx);
  }

  /** BFS through passable edges and nav-links to find connected components.
   *  Returns labels (-1 = unreachable/blocked) and region count. */
  labelConnectedRegions(): { labels: Int32Array; regionCount: number } {
    const total = this.width * this.height;
    const labels = new Int32Array(total).fill(-1);
    let regionId = 0;
    const queue: number[] = [];

    for (let i = 0; i < total; i++) {
      const cell = this.cells[i];
      // Skip cells with no outgoing edges and no nav-links
      if (cell.passable === 0 && !this.navLinks.has(i)) continue;
      if (labels[i] !== -1) continue;

      labels[i] = regionId;
      queue.length = 0;
      queue.push(i);
      let head = 0;
      while (head < queue.length) {
        const cur = queue[head++];
        const curCell = this.cells[cur];
        const cgx = cur % this.width;
        const cgz = (cur - cgx) / this.width;

        // Traverse passable edges
        for (let dir = 0; dir < 8; dir++) {
          if (!(curCell.passable & (1 << dir))) continue;
          const ngx = cgx + DIR_DGX[dir];
          const ngz = cgz + DIR_DGZ[dir];
          if (ngx < 0 || ngx >= this.width || ngz < 0 || ngz >= this.height) continue;
          const nIdx = ngz * this.width + ngx;
          if (labels[nIdx] !== -1) continue;
          labels[nIdx] = regionId;
          queue.push(nIdx);
        }

        // Traverse nav-links (ladders)
        const links = this.navLinks.get(cur);
        if (links) {
          for (const link of links) {
            const nIdx = link.toGZ * this.width + link.toGX;
            if (nIdx < 0 || nIdx >= total || labels[nIdx] !== -1) continue;
            labels[nIdx] = regionId;
            queue.push(nIdx);
          }
        }
      }
      regionId++;
    }

    return { labels, regionCount: regionId };
  }

  /** Bresenham-style grid line-of-sight check.
   *  Checks consecutive cell height differences against stepHeight,
   *  so paths that climb gradually (0→0.5→1.0) are valid but
   *  direct jumps (0→1.0) are not. */
  hasLineOfSight(gx1: number, gz1: number, gx2: number, gz2: number): boolean {
    let x0 = gx1, z0 = gz1;
    const x1 = gx2, z1 = gz2;
    const dx = Math.abs(x1 - x0);
    const dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;

    let prevCell = this.getCell(x0, z0);
    if (!prevCell || prevCell.blocked) return false;

    while (true) {
      if (x0 === x1 && z0 === z1) break;

      const e2 = 2 * err;
      const willMoveX = e2 > -dz;
      const willMoveZ = e2 < dx;

      if (willMoveX && willMoveZ) {
        // Diagonal step — check both adjacent cells (corner-cutting prevention)
        const adjX = this.getCell(x0 + sx, z0);
        const adjZ = this.getCell(x0, z0 + sz);
        if (!adjX || adjX.blocked || !adjZ || adjZ.blocked) return false;
      }

      if (willMoveX) { err -= dz; x0 += sx; }
      if (willMoveZ) { err += dx; z0 += sz; }

      const cell = this.getCell(x0, z0);
      if (!cell || cell.blocked) return false;

      // Check consecutive height difference — must be within slope tolerance
      if (Math.abs(cell.surfaceHeight - prevCell.surfaceHeight) > this.slopeHeight) return false;

      prevCell = cell;
    }

    return true;
  }
}
