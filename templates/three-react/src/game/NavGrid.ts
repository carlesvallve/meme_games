/**
 * NavGrid — rasterized navigation grid for A* pathfinding.
 * Pure TypeScript, no Three.js dependency.
 */

export interface AABBBox {
  readonly x: number;
  readonly z: number;
  readonly halfW: number;
  readonly halfD: number;
  readonly height: number;
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
            surfaceHeight = Math.max(surfaceHeight, box.height);
          }
        }

        // Blocked = any box taller than stepHeight above surface overlaps expanded cell
        let blocked = false;
        for (const box of boxes) {
          if (box.height - surfaceHeight <= stepHeight) continue;
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

  /** Check if a world-space position is on a walkable (non-blocked) cell */
  isWalkable(x: number, z: number): boolean {
    const { gx, gz } = this.worldToGrid(x, z);
    const cell = this.getCell(gx, gz);
    return cell !== null && !cell.blocked;
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

      // Check consecutive height difference — must be steppable
      if (Math.abs(cell.surfaceHeight - prevCell.surfaceHeight) > this.stepHeight) return false;

      prevCell = cell;
    }

    return true;
  }
}
