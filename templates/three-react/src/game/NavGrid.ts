/**
 * NavGrid — rasterized navigation grid for A* pathfinding.
 * Pure TypeScript, no Three.js dependency.
 */

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

  constructor(worldWidth: number, worldDepth: number, cellSize = 0.5) {
    this.cellSize = cellSize;
    this.width = Math.ceil(worldWidth / cellSize);
    this.height = Math.ceil(worldDepth / cellSize);
    this.originX = -worldWidth / 2;
    this.originZ = -worldDepth / 2;
    this.cells = [];
  }

  build(boxes: ReadonlyArray<AABBBox>, stepHeight: number, capsuleRadius: number): void {
    this.stepHeight = stepHeight;
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

  /** World-space bounds: half-extent of the grid */
  getHalfSize(): number {
    return this.width * this.cellSize / 2;
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

        const idx = gz * width + gx;
        this.cells[idx] = {
          gx, gz,
          worldX, worldZ,
          surfaceHeight,
          blocked: false,
          passable: 0,
        };
      }
    }

    // 2. Precompute gradient magnitude per cell by sampling the heightmap directly
    //    at a fine scale (half a heightmap cell), matching the player movement check.
    // Use a conservative margin (0.75×) because resolveMovement samples with
    // getTerrainY(radius>0) which takes max-of-5-points and sees steeper slopes
    // near cliff edges than plain bilinear interpolation.
    const effectiveSlopeHeight = slopeHeight ?? stepHeight * 2;
    const maxSlope = (effectiveSlopeHeight / cellSize) * 0.75;
    const slopeMags = new Float32Array(totalCells);

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

    const eps = hmCellSize * 0.5; // fine-scale gradient sampling (half a HM cell)
    for (let gz = 0; gz < height; gz++) {
      for (let gx = 0; gx < width; gx++) {
        const cell = this.cells[gz * width + gx];
        const wx = cell.worldX;
        const wz = cell.worldZ;
        const hL = sampleHM(wx - eps, wz);
        const hR = sampleHM(wx + eps, wz);
        const hU = sampleHM(wx, wz - eps);
        const hD = sampleHM(wx, wz + eps);
        const gxVal = (hR - hL) / (2 * eps);
        const gzVal = (hD - hU) / (2 * eps);
        slopeMags[gz * width + gx] = Math.sqrt(gxVal * gxVal + gzVal * gzVal);
      }
    }

    // 3. Compute per-edge passability using both height-diff and gradient checks
    for (let gz = 0; gz < height; gz++) {
      for (let gx = 0; gx < width; gx++) {
        const cell = this.cells[gz * width + gx];
        const cellSlope = slopeMags[gz * width + gx];

        let mask = 0;
        for (let dir = 0; dir < 8; dir++) {
          const ngx = gx + DIR_DGX[dir];
          const ngz = gz + DIR_DGZ[dir];

          if (ngx < 0 || ngx >= width || ngz < 0 || ngz >= height) continue;
          const neighbor = this.cells[ngz * width + ngx];
          const neighborSlope = slopeMags[ngz * width + ngx];

          // Height-diff check (conservative: matches the 0.75× margin on maxSlope)
          if (Math.abs(cell.surfaceHeight - neighbor.surfaceHeight) > effectiveSlopeHeight * 0.75) continue;

          // Gradient check: if either cell is on a steep slope, block the edge.
          // Also sample the midpoint between cells for cliffs that fall between cell centers.
          if (cellSlope > maxSlope || neighborSlope > maxSlope) continue;
          const midX = (cell.worldX + neighbor.worldX) * 0.5;
          const midZ = (cell.worldZ + neighbor.worldZ) * 0.5;
          const mhL = sampleHM(midX - eps, midZ);
          const mhR = sampleHM(midX + eps, midZ);
          const mhU = sampleHM(midX, midZ - eps);
          const mhD = sampleHM(midX, midZ + eps);
          const mgx = (mhR - mhL) / (2 * eps);
          const mgz = (mhD - mhU) / (2 * eps);
          const midSlope = Math.sqrt(mgx * mgx + mgz * mgz);
          if (midSlope > maxSlope) continue;

          // Diagonal: both adjacent cardinals must also be passable
          if (dir % 2 === 1) {
            const [c1, c2] = DIAGONAL_CARDINALS[dir];
            const n1gx = gx + DIR_DGX[c1];
            const n1gz = gz + DIR_DGZ[c1];
            const n2gx = gx + DIR_DGX[c2];
            const n2gz = gz + DIR_DGZ[c2];

            if (n1gx < 0 || n1gx >= width || n1gz < 0 || n1gz >= height) continue;
            if (n2gx < 0 || n2gx >= width || n2gz < 0 || n2gz >= height) continue;

            if (slopeMags[n1gz * width + n1gx] > maxSlope) continue;
            if (slopeMags[n2gz * width + n2gx] > maxSlope) continue;
          }

          mask |= 1 << dir;
        }
        cell.passable = mask;
      }
    }
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
