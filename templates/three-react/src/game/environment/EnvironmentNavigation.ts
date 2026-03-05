import * as THREE from 'three';
import { NavGrid } from '../pathfinding';
import type { LadderDef } from '../dungeon';
import { EnvironmentContext } from './EnvironmentContext';
import type { EnvironmentPhysics } from './EnvironmentPhysics';

// ── Local helper (same as in Terrain.ts) ────────────────────────────
const HALF = 0.25;
/** Snap position so that box edges align to HALF boundaries given its half-size */
function snapPos(v: number, halfSize: number): number {
  const edge = Math.round((v - halfSize) / HALF) * HALF;
  return edge + halfSize;
}

/**
 * NavGrid construction and spatial queries.
 * Extracted from the monolithic Terrain class -- logic is identical,
 * field access goes through the shared EnvironmentContext.
 */
export class EnvironmentNavigation {
  constructor(
    private ctx: EnvironmentContext,
    private physics: EnvironmentPhysics,
    private createSingleLadderMesh: (li: number) => void,
  ) {}

  // ── Water Y (inlined from Terrain.getWaterY) ─────────────────────
  private getWaterY(): number {
    return this.ctx.preset === 'heightmap' && this.ctx.heightmapStyle === 'caves' ? -0.5 : -0.05;
  }

  // ── Public: build the navigation grid ─────────────────────────────

  /** Build a NavGrid from current terrain for A* pathfinding */
  buildNavGrid(stepHeight: number, capsuleRadius: number, cellSize = 0.5, slopeHeight?: number): NavGrid {
    // Overworld: delegate to OverworldMap's own NavGrid builder
    if (this.ctx.overworldMap) {
      const grid = this.ctx.overworldMap.buildNavGrid(stepHeight, cellSize);
      this.ctx.navGrid = grid;
      return grid;
    }

    const navGroundSize = this.ctx.effectiveGroundSize || this.ctx.groundSize;
    const grid = new NavGrid(navGroundSize, navGroundSize, cellSize);
    if (this.ctx.heightmapData) {
      grid.buildFromHeightmap(this.ctx.heightmapData, this.ctx.heightmapRes, this.ctx.heightmapGroundSize, stepHeight, slopeHeight);
      // Block nav cells that overlap tall debris (trees, POIs)
      if (this.ctx.debris.length > 0) {
        grid.applyDebrisBlocking(this.ctx.debris);
      }
    } else if (this.ctx.walkMask) {
      // Dungeon with walkMask: the mask IS the truth. Build a flat grid (no debris),
      // then let walkMask define exactly which cells are open/blocked.
      grid.build([], stepHeight, 0);
      grid.applyWalkMask(this.ctx.walkMask.openGrid, this.ctx.walkMask.gridW, this.ctx.walkMask.gridD, this.ctx.walkMask.cellSize, navGroundSize);
      // Apply stair cell heights to nav grid surface heights
      if (this.ctx.cellHeights) {
        grid.applyCellHeights(
          this.ctx.cellHeights, this.ctx.dungeonGridW, this.ctx.dungeonGridD,
          this.ctx.dungeonCellSize, navGroundSize, this.ctx.baseFloorY,
          this.ctx.stairMap,
        );
      }
    } else {
      // Free-form terrain (scattered, terraced): use debris boxes for blocking
      grid.build(this.ctx.debris, stepHeight, capsuleRadius);
    }

    // Register ladder nav-links.
    // Offset nav-link cells ~1m INTO their respective terraces (away from cliff edge)
    // because cliff-edge cells have steep gradients -> passable=0, so A* can't reach them.
    const LADDER_COST = 8;
    const NAV_LINK_OFFSET = 0.25; // meters into the terrace
    for (let i = 0; i < this.ctx.ladderDefs.length; i++) {
      const ladder = this.ctx.ladderDefs[i];

      // facingDX/DZ points from high side toward low side
      // Bottom (low side): offset further into low terrace (+facing direction)
      // Top (high side): offset further into high terrace (-facing direction)
      const bottomWorldX = ladder.lowWorldX + ladder.facingDX * NAV_LINK_OFFSET;
      const bottomWorldZ = ladder.lowWorldZ + ladder.facingDZ * NAV_LINK_OFFSET;
      const topWorldX = ladder.highWorldX - ladder.facingDX * NAV_LINK_OFFSET;
      const topWorldZ = ladder.highWorldZ - ladder.facingDZ * NAV_LINK_OFFSET;

      const bottom = grid.worldToGrid(bottomWorldX, bottomWorldZ);
      const top = grid.worldToGrid(topWorldX, topWorldZ);

      // Verify cells are walkable; if not, try the exact position as fallback
      let bottomCell = grid.getCell(bottom.gx, bottom.gz);
      if (!bottomCell || bottomCell.passable === 0) {
        const exact = grid.worldToGrid(ladder.lowWorldX, ladder.lowWorldZ);
        const exactCell = grid.getCell(exact.gx, exact.gz);
        if (exactCell && exactCell.passable > 0) {
          bottom.gx = exact.gx;
          bottom.gz = exact.gz;
          bottomCell = exactCell;
        }
      }

      let topCell = grid.getCell(top.gx, top.gz);
      if (!topCell || topCell.passable === 0) {
        const exact = grid.worldToGrid(ladder.highWorldX, ladder.highWorldZ);
        const exactCell = grid.getCell(exact.gx, exact.gz);
        if (exactCell && exactCell.passable > 0) {
          top.gx = exact.gx;
          top.gz = exact.gz;
          topCell = exactCell;
        }
      }

      // Store computed cell coordinates back into the LadderDef
      ladder.bottomCellGX = bottom.gx;
      ladder.bottomCellGZ = bottom.gz;
      ladder.topCellGX = top.gx;
      ladder.topCellGZ = top.gz;

      grid.addNavLink(bottom.gx, bottom.gz, top.gx, top.gz, LADDER_COST, i);
    }

    // ── Dungeon ladder hints: vertical ladders at height boundaries > 1 level ──
    if (this.ctx.dungeonLadderHints.length > 0) {
      const halfWorld = (this.ctx.effectiveGroundSize || this.ctx.groundSize) / 2;
      const cs = this.ctx.dungeonCellSize;
      for (const hint of this.ctx.dungeonLadderHints) {
        // Bottom nav: corridor cell (low height). Top nav: room cell (high height).
        // Use original dungeon grid positions, convert to navgrid coords.
        const bottomWX = -halfWorld + (hint.lowGX + 0.5) * cs;
        const bottomWZ = -halfWorld + (hint.lowGZ + 0.5) * cs;
        const topWX = -halfWorld + (hint.highGX + 0.5) * cs;
        const topWZ = -halfWorld + (hint.highGZ + 0.5) * cs;

        const bottomNav = grid.worldToGrid(bottomWX, bottomWZ);
        const topNav = grid.worldToGrid(topWX, topWZ);

        // console.log(`[Ladder hint] low=(${hint.lowGX},${hint.lowGZ}) h=${hint.lowH.toFixed(2)} → high=(${hint.highGX},${hint.highGZ}) h=${hint.highH.toFixed(2)} | bottomNav=(${bottomNav.gx},${bottomNav.gz}) topNav=(${topNav.gx},${topNav.gz}) | worldBottom=(${bottomWX.toFixed(2)},${bottomWZ.toFixed(2)}) worldTop=(${topWX.toFixed(2)},${topWZ.toFixed(2)})`);

        const beforeCount = this.ctx.ladderDefs.length;
        this.placeLadder(grid, LADDER_COST, NAV_LINK_OFFSET, bottomNav.gx, bottomNav.gz, topNav.gx, topNav.gz);

        if (this.ctx.ladderDefs.length > beforeCount) {
          const ld = this.ctx.ladderDefs[this.ctx.ladderDefs.length - 1];
          ld.isVertical = true;
          const lowCellIdx = hint.lowGZ * this.ctx.dungeonGridW + hint.lowGX;
          const highCellIdx = hint.highGZ * this.ctx.dungeonGridW + hint.highGX;
          this.ctx.ladderCellSet.add(lowCellIdx);
          this.ctx.ladderCellSet.add(highCellIdx);

          // Register ladder link for flood-fill visibility (see both levels at ladder)
          if (this.ctx.roomVisibility) {
            this.ctx.roomVisibility.addLadderLink(highCellIdx, lowCellIdx);
          }

          // Perfectly vertical: both endpoints at corridor cell XZ,
          // nudged 1.5 navgrid cells (0.375m) toward the wall.
          const navCell = 0.25;
          const dx = hint.highGX - hint.lowGX;
          const dz = hint.highGZ - hint.lowGZ;
          const ladderX = bottomWX + dx * navCell * 1.5;
          const ladderZ = bottomWZ + dz * navCell * 1.5;
          ld.lowWorldX = ladderX;
          ld.lowWorldZ = ladderZ;
          ld.highWorldX = ladderX;
          ld.highWorldZ = ladderZ;
          ld.bottomX = ladderX;
          ld.bottomZ = ladderZ;

          // console.log(`[Ladder placed] #${this.ctx.ladderDefs.length - 1} isVertical=true pos=(${ladderX.toFixed(2)},${ladderZ.toFixed(2)}) bottomY=${ld.bottomY.toFixed(2)} topY=${ld.topY.toFixed(2)} facing=(${ld.facingDX.toFixed(2)},${ld.facingDZ.toFixed(2)})`);

          // Recreate the mesh with corrected positions
          const meshIdx = this.ctx.ladderDefs.length - 1;
          if (this.ctx.ladderMeshes[meshIdx]) {
            this.ctx.ladderMeshes[meshIdx].traverse((child) => {
              if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
            });
            this.ctx.group.remove(this.ctx.ladderMeshes[meshIdx]);
          }
          this.createSingleLadderMesh(meshIdx);
        } else {
          // console.log(`[Ladder hint SKIPPED] placeLadder rejected — cells may be impassable or height diff < 0.3`);
        }
      }
      // console.log(`[Terrain] Placed ${this.ctx.dungeonLadderHints.length} dungeon ladder hints`);
    }

    // ── Scan all adjacent open dungeon cells for height drops needing ladders ──
    if (this.ctx.walkMask && this.ctx.cellHeights) {
      const { openGrid, gridW, gridD, cellSize: dcs } = this.ctx.walkMask;
      const ch = this.ctx.cellHeights;
      const halfWorld = (this.ctx.effectiveGroundSize || this.ctx.groundSize) / 2;
      const heightThreshold = stepHeight; // same as navgrid step threshold
      const DIRS4: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

      // Collect all height-boundary edges as (lowIdx, highIdx, direction)
      type Edge = { lowGX: number; lowGZ: number; highGX: number; highGZ: number; ddx: number; ddz: number };
      const allEdges: Edge[] = [];
      const stairCells = new Set(this.ctx.stairMap.keys());
      const hintCells = new Set<number>();
      for (const hint of this.ctx.dungeonLadderHints) {
        hintCells.add(hint.lowGZ * gridW + hint.lowGX);
        hintCells.add(hint.highGZ * gridW + hint.highGX);
      }

      for (let gz = 0; gz < gridD; gz++) {
        for (let gx = 0; gx < gridW; gx++) {
          const idx = gz * gridW + gx;
          if (!openGrid[idx]) continue;
          const h = ch[idx];
          for (const [ddx, ddz] of DIRS4) {
            const nx = gx + ddx, nz = gz + ddz;
            if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
            const nidx = nz * gridW + nx;
            if (!openGrid[nidx]) continue;
            if (ch[nidx] <= h) continue; // only process low->high
            if (Math.abs(ch[nidx] - h) < heightThreshold) continue;
            if (stairCells.has(idx) || stairCells.has(nidx)) continue;
            if (hintCells.has(idx) || hintCells.has(nidx)) continue;
            allEdges.push({ lowGX: gx, lowGZ: gz, highGX: nx, highGZ: nz, ddx, ddz });
          }
        }
      }

      // Group connected boundary edges (same direction, adjacent along the perpendicular axis)
      // and pick one ladder per group (the middle edge).
      // Dedup: one ladder per height-level pair (same terrace transition).
      const usedEdges = new Set<number>();
      const heightDropPairs = new Set<string>();
      // Also skip height pairs already covered by StairSystem stairs/ladders
      // Round to nearest 10 (0.1 precision) to avoid floating-point mismatches
      const hRound = (v: number) => Math.round(v * 10);
      if (this.ctx.stairMap.size > 0 || this.ctx.dungeonLadderHints.length > 0) {
        for (const s of this.ctx.stairMap.values()) {
          const lowH = hRound(ch[s.gz * gridW + s.gx]);
          const highH = hRound(ch[s.gz * gridW + s.gx] + s.levelHeight);
          heightDropPairs.add(`${Math.min(lowH, highH)}:${Math.max(lowH, highH)}`);
        }
        for (const hint of this.ctx.dungeonLadderHints) {
          const lowH = hRound(hint.lowH);
          const highH = hRound(hint.highH);
          heightDropPairs.add(`${Math.min(lowH, highH)}:${Math.max(lowH, highH)}`);
        }
      }
      let heightDropLadders = 0;

      for (let ei = 0; ei < allEdges.length; ei++) {
        if (usedEdges.has(ei)) continue;
        const e = allEdges[ei];
        // Flood-fill along perpendicular to find connected boundary cells
        const group: number[] = [ei];
        usedEdges.add(ei);
        const perpX = e.ddz !== 0 ? 1 : 0; // perpendicular axis
        const perpZ = e.ddx !== 0 ? 1 : 0;
        // BFS along perp direction
        const queue = [ei];
        while (queue.length > 0) {
          const ci = queue.pop()!;
          const ce = allEdges[ci];
          for (let ej = 0; ej < allEdges.length; ej++) {
            if (usedEdges.has(ej)) continue;
            const ne = allEdges[ej];
            if (ne.ddx !== e.ddx || ne.ddz !== e.ddz) continue; // same direction
            const dlx = ne.lowGX - ce.lowGX, dlz = ne.lowGZ - ce.lowGZ;
            if (Math.abs(dlx * perpX + dlz * perpZ) === 1 &&
                Math.abs(dlx * (1 - perpX) + dlz * (1 - perpZ)) === 0) {
              usedEdges.add(ej);
              group.push(ej);
              queue.push(ej);
            }
          }
        }

        // Pick middle edge of the group
        const mid = allEdges[group[Math.floor(group.length / 2)]];

        // Dedup: skip if this height-level pair already has a stair/ladder
        const edgeLowH = hRound(ch[mid.lowGZ * gridW + mid.lowGX]);
        const edgeHighH = hRound(ch[mid.highGZ * gridW + mid.highGX]);
        const edgePairKey = `${Math.min(edgeLowH, edgeHighH)}:${Math.max(edgeLowH, edgeHighH)}`;
        if (heightDropPairs.has(edgePairKey)) continue;
        heightDropPairs.add(edgePairKey);

        const lowWX = -halfWorld + (mid.lowGX + 0.5) * dcs;
        const lowWZ = -halfWorld + (mid.lowGZ + 0.5) * dcs;
        const highWX = -halfWorld + (mid.highGX + 0.5) * dcs;
        const highWZ = -halfWorld + (mid.highGZ + 0.5) * dcs;

        const bottomNav = grid.worldToGrid(lowWX, lowWZ);
        const topNav = grid.worldToGrid(highWX, highWZ);

        const beforeCount = this.ctx.ladderDefs.length;
        this.placeLadder(grid, LADDER_COST, NAV_LINK_OFFSET, bottomNav.gx, bottomNav.gz, topNav.gx, topNav.gz);

        if (this.ctx.ladderDefs.length > beforeCount) {
          const ld = this.ctx.ladderDefs[this.ctx.ladderDefs.length - 1];
          ld.isVertical = true;
          const lowCI = mid.lowGZ * gridW + mid.lowGX;
          const highCI = mid.highGZ * gridW + mid.highGX;
          this.ctx.ladderCellSet.add(lowCI);
          this.ctx.ladderCellSet.add(highCI);

          // Register ladder link for flood-fill visibility
          if (this.ctx.roomVisibility) {
            this.ctx.roomVisibility.addLadderLink(highCI, lowCI);
          }

          const navCell = 0.25;
          const ladderX = lowWX + mid.ddx * navCell * 1.5;
          const ladderZ = lowWZ + mid.ddz * navCell * 1.5;
          ld.lowWorldX = ladderX;
          ld.lowWorldZ = ladderZ;
          ld.highWorldX = ladderX;
          ld.highWorldZ = ladderZ;
          ld.bottomX = ladderX;
          ld.bottomZ = ladderZ;

          const meshIdx = this.ctx.ladderDefs.length - 1;
          if (this.ctx.ladderMeshes[meshIdx]) {
            this.ctx.ladderMeshes[meshIdx].traverse((child) => {
              if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
            });
            this.ctx.group.remove(this.ctx.ladderMeshes[meshIdx]);
          }
          this.createSingleLadderMesh(meshIdx);
          heightDropLadders++;
        }
      }
      if (heightDropLadders > 0) {
        // console.log(`[Terrain] Placed ${heightDropLadders} height-drop ladders (from ${allEdges.length} boundary edges)`);
      }
    }

    // ── NavGrid-level connectivity check ──
    // The vertex-level analysis may miss disconnections because the NavGrid's
    // gradient checks are stricter than vertex-level height diffs.
    // BFS the actual NavGrid and add ladders for any remaining disconnected regions.
    if (this.ctx.heightmapData) {
      this.ensureNavGridConnectivity(grid, LADDER_COST, NAV_LINK_OFFSET);
    }

    // Bake spawn region labels so getRandomPosition can filter out unreachable areas
    grid.bakeSpawnRegion();
    this.ctx.navGrid = grid;

    // Register ladder meshes with room visibility so they get hidden/dimmed
    if (this.ctx.roomVisibility && this.ctx.visOwnership) {
      const dGridW = this.ctx.dungeonGridW;
      const halfW = (this.ctx.effectiveGroundSize || this.ctx.groundSize) / 2;
      for (let li = 0; li < this.ctx.ladderDefs.length; li++) {
        const mesh = this.ctx.ladderMeshes[li];
        if (!mesh) continue;
        const ld = this.ctx.ladderDefs[li];
        // Find visibility IDs from the ladder's dungeon grid cells
        const roomIds = new Set<number>();
        for (const [cgx, cgz] of [[ld.bottomCellGX, ld.bottomCellGZ], [ld.topCellGX, ld.topCellGZ]]) {
          if (cgx < 0 || cgz < 0) continue;
          const wpos = grid.gridToWorld(cgx, cgz);
          const dgx = Math.floor((wpos.x + halfW) / this.ctx.dungeonCellSize);
          const dgz = Math.floor((wpos.z + halfW) / this.ctx.dungeonCellSize);
          if (dgx >= 0 && dgx < dGridW && dgz >= 0 && dgz < this.ctx.dungeonGridD) {
            const rid = this.ctx.visOwnership[dgz * dGridW + dgx];
            if (rid !== -1) roomIds.add(rid); // include corridors (negative IDs)
          }
        }
        if (roomIds.size > 0) {
          this.ctx.roomVisibility.registerMesh(mesh, [...roomIds]);
        }
      }
    }

    return grid;
  }

  // ── Public: random spawn position ─────────────────────────────────

  getRandomPosition(margin = 3, clearance = 0.6, excludePos?: { x: number; z: number }, excludeRadius = 0): THREE.Vector3 {
    const half = this.ctx.groundSize / 2 - margin;

    // Overworld: pick from NavGrid spawn region
    if (this.ctx.overworldMap && this.ctx.navGrid) {
      for (let attempt = 0; attempt < 50; attempt++) {
        const cell = this.ctx.navGrid.getRandomSpawnCell();
        if (!cell) break;
        if (excludePos && excludeRadius > 0) {
          const edx = cell.x - excludePos.x, edz = cell.z - excludePos.z;
          if (edx * edx + edz * edz < excludeRadius * excludeRadius) continue;
        }
        const y = this.ctx.overworldMap.getTerrainY(cell.x, cell.z);
        return new THREE.Vector3(cell.x, y, cell.z);
      }
      return new THREE.Vector3(0, this.ctx.overworldMap.getTerrainY(0, 0), 0);
    }

    // Heightmap: sample random point, verify it's in the spawn region
    if (this.ctx.heightmapData) {
      for (let attempt = 0; attempt < 50; attempt++) {
        const x = (Math.random() - 0.5) * half * 2;
        const z = (Math.random() - 0.5) * half * 2;
        if (this.ctx.navGrid && !this.ctx.navGrid.isInSpawnRegion(x, z)) continue;
        if (excludePos && excludeRadius > 0) {
          const edx = x - excludePos.x, edz = z - excludePos.z;
          if (edx * edx + edz * edz < excludeRadius * excludeRadius) continue;
        }
        const y = this.physics.getTerrainY(x, z);
        return new THREE.Vector3(x, y, z);
      }
      // Fallback: spawn at origin
      return new THREE.Vector3(0, this.physics.getTerrainY(0, 0), 0);
    }

    // Dungeon/rooms/voxelDungeon: pick directly from NavGrid spawn-region cells
    if (this.ctx.preset === 'voxelDungeon' && this.ctx.navGrid) {
      for (let attempt = 0; attempt < 50; attempt++) {
        const cell = this.ctx.navGrid.getRandomSpawnCell();
        if (!cell) break;
        if (excludePos && excludeRadius > 0) {
          const edx = cell.x - excludePos.x, edz = cell.z - excludePos.z;
          if (edx * edx + edz * edz < excludeRadius * excludeRadius) continue;
        }
        return new THREE.Vector3(cell.x, cell.surfaceHeight, cell.z);
      }
      // Fallback: center of first floor tile
      if (this.ctx.debris.length > 0) {
        const floor = this.ctx.debris[0];
        return new THREE.Vector3(floor.x, floor.height, floor.z);
      }
      return new THREE.Vector3(0, 0, 0);
    }

    for (let attempt = 0; attempt < 50; attempt++) {
      const x = snapPos((Math.random() - 0.5) * half * 2, 0);
      const z = snapPos((Math.random() - 0.5) * half * 2, 0);
      const y = this.physics.getTerrainY(x, z);
      if ((y === 0 || this.physics.isOnBoxSurface(x, z)) && this.physics.hasClearance(x, z, y, clearance)) {
        if (this.ctx.navGrid && !this.ctx.navGrid.isInSpawnRegion(x, z)) continue;
        if (excludePos && excludeRadius > 0) {
          const edx = x - excludePos.x, edz = z - excludePos.z;
          if (edx * edx + edz * edz < excludeRadius * excludeRadius) continue;
        }
        return new THREE.Vector3(x, y, z);
      }
    }
    return new THREE.Vector3(0, 0, 0);
  }

  // ── Private: cliff flatness scoring ───────────────────────────────

  /** Score how flat a cliff face is at a candidate ladder pair.
   *  Lower = flatter = better placement. Checks cells perpendicular to the cliff normal. */
  private scoreCliffFlatness(grid: NavGrid, gx1: number, gz1: number, gx2: number, gz2: number): number {
    const dx = gx2 - gx1;
    const dz = gz2 - gz1;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.001) return 100;

    // Perpendicular direction (rotated 90deg)
    const px = Math.round(-dz / len);
    const pz = Math.round(dx / len);
    if (px === 0 && pz === 0) return 100;

    const cell1 = grid.getCell(gx1, gz1);
    const cell2 = grid.getCell(gx2, gz2);
    if (!cell1 || !cell2) return 100;

    let penalty = 0;
    // Check 2 cells in each perpendicular direction on both sides of the cliff
    for (const offset of [-2, -1, 1, 2]) {
      const weight = Math.abs(offset) === 1 ? 2 : 1; // closer cells matter more
      const n1 = grid.getCell(gx1 + px * offset, gz1 + pz * offset);
      if (n1) {
        penalty += Math.abs(n1.surfaceHeight - cell1.surfaceHeight) * weight;
      } else {
        penalty += 3 * weight; // edge of map
      }
      const n2 = grid.getCell(gx2 + px * offset, gz2 + pz * offset);
      if (n2) {
        penalty += Math.abs(n2.surfaceHeight - cell2.surfaceHeight) * weight;
      } else {
        penalty += 3 * weight;
      }
    }

    return penalty;
  }

  // ── Private: place a single ladder ────────────────────────────────

  /** Place a single ladder between two grid cells and register the nav-link. */
  private placeLadder(
    grid: NavGrid, ladderCost: number, navLinkOffset: number,
    agx: number, agz: number, bgx: number, bgz: number,
  ): boolean {
    const cellA = grid.getCell(agx, agz)!;
    const cellB = grid.getCell(bgx, bgz)!;
    const aWorld = grid.gridToWorld(agx, agz);
    const bWorld = grid.gridToWorld(bgx, bgz);

    const aIsLow = cellA.surfaceHeight <= cellB.surfaceHeight;
    const lowCell = aIsLow ? cellA : cellB;
    const highCell = aIsLow ? cellB : cellA;
    const lowWorld = aIsLow ? aWorld : bWorld;
    const highWorld = aIsLow ? bWorld : aWorld;
    const lowGX = aIsLow ? agx : bgx;
    const lowGZ = aIsLow ? agz : bgz;
    const highGX = aIsLow ? bgx : agx;
    const highGZ = aIsLow ? bgz : agz;

    const heightDiff = highCell.surfaceHeight - lowCell.surfaceHeight;
    if (heightDiff < 0.3) return false;

    // Skip ladders where bottom is underwater
    const waterY = this.getWaterY();
    if (lowCell.surfaceHeight < waterY + 0.1) return false;

    let fdx = lowWorld.x - highWorld.x;
    let fdz = lowWorld.z - highWorld.z;
    const fLen = Math.sqrt(fdx * fdx + fdz * fdz);
    if (fLen > 0) { fdx /= fLen; fdz /= fLen; }

    const ladderDef: LadderDef = {
      bottomX: (lowWorld.x + highWorld.x) / 2,
      bottomZ: (lowWorld.z + highWorld.z) / 2,
      bottomY: lowCell.surfaceHeight,
      topY: highCell.surfaceHeight,
      facingDX: fdx,
      facingDZ: fdz,
      lowWorldX: lowWorld.x,
      lowWorldZ: lowWorld.z,
      highWorldX: highWorld.x,
      highWorldZ: highWorld.z,
      bottomCellGX: lowGX,
      bottomCellGZ: lowGZ,
      topCellGX: highGX,
      topCellGZ: highGZ,
    };

    const ladderIndex = this.ctx.ladderDefs.length;
    this.ctx.ladderDefs.push(ladderDef);

    // console.log(`[placeLadder] #${ladderIndex} nav=(${agx},${agz})->(${bgx},${bgz}) lowH=${lowCell.surfaceHeight.toFixed(2)} highH=${highCell.surfaceHeight.toFixed(2)} diff=${heightDiff.toFixed(2)} facing=(${fdx.toFixed(2)},${fdz.toFixed(2)}) world=(${lowWorld.x.toFixed(2)},${lowWorld.z.toFixed(2)})->(${highWorld.x.toFixed(2)},${highWorld.z.toFixed(2)})`);

    const bottomNavX = lowWorld.x + fdx * navLinkOffset;
    const bottomNavZ = lowWorld.z + fdz * navLinkOffset;
    const topNavX = highWorld.x - fdx * navLinkOffset;
    const topNavZ = highWorld.z - fdz * navLinkOffset;

    let bottom = grid.worldToGrid(bottomNavX, bottomNavZ);
    let top = grid.worldToGrid(topNavX, topNavZ);

    const bottomCellNav = grid.getCell(bottom.gx, bottom.gz);
    if (!bottomCellNav || bottomCellNav.passable === 0) {
      bottom = { gx: lowGX, gz: lowGZ };
    }
    const topCellNav = grid.getCell(top.gx, top.gz);
    if (!topCellNav || topCellNav.passable === 0) {
      top = { gx: highGX, gz: highGZ };
    }

    ladderDef.bottomCellGX = bottom.gx;
    ladderDef.bottomCellGZ = bottom.gz;
    ladderDef.topCellGX = top.gx;
    ladderDef.topCellGZ = top.gz;

    grid.addNavLink(bottom.gx, bottom.gz, top.gx, top.gz, ladderCost, ladderIndex);
    this.createSingleLadderMesh(ladderIndex);

    return true;
  }

  // ── Private: ensure full NavGrid connectivity ─────────────────────

  /** BFS the NavGrid to find disconnected walkable regions and bridge them with ladders. */
  private ensureNavGridConnectivity(grid: NavGrid, ladderCost: number, navLinkOffset: number): void {
    const MAX_ITER = 60;
    const EDGE_MARGIN = Math.ceil(2.5 / grid.cellSize);
    const MAX_WALK = Math.ceil(10 / grid.cellSize);  // ~10m walk through cliff in cells
    const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // cardinals only -> clean ladder angles

    for (let iter = 0; iter < MAX_ITER; iter++) {
      const { labels, regionCount } = grid.labelConnectedRegions();
      if (regionCount <= 1) break;

      // Always use largest region as connected seed
      const regionSizes = new Map<number, number>();
      for (let i = 0; i < labels.length; i++) {
        if (labels[i] < 0) continue;
        regionSizes.set(labels[i], (regionSizes.get(labels[i]) ?? 0) + 1);
      }
      let spawnLabel = -1;
      let spawnSize = 0;
      for (const [r, size] of regionSizes) {
        if (size > spawnSize) { spawnLabel = r; spawnSize = size; }
      }
      if (spawnLabel < 0) break;

      const connectedSet = new Set<number>();
      connectedSet.add(spawnLabel);

      if (iter === 0) {
        const disconnected = [...regionSizes.entries()].filter(([r, s]) => r !== spawnLabel && s >= 2);
        // console.log(`[NavGrid] ${regionCount} regions, spawn=${spawnLabel} (${spawnSize} cells), ${disconnected.length} disconnected`);
      }

      // Try ALL disconnected regions -- find globally best candidate via cliff-walk
      type Candidate = { agx: number; agz: number; bgx: number; bgz: number; score: number };
      let bestCandidate: Candidate | null = null;
      let bestScore = Infinity;
      let failedRegions = 0;

      for (const [region, size] of regionSizes) {
        if (connectedSet.has(region)) continue;
        if (size < 2) continue;

        let regionHasCandidate = false;

        // Scan border cells of this region
        for (let gz = EDGE_MARGIN; gz < grid.height - EDGE_MARGIN; gz++) {
          for (let gx = EDGE_MARGIN; gx < grid.width - EDGE_MARGIN; gx++) {
            const idx = gz * grid.width + gx;
            if (labels[idx] !== region) continue;
            const cell = grid.getCell(gx, gz);
            if (!cell || cell.passable === 0) continue;

            // Quick border check -- only process cells on region edge
            let isBorder = cell.passable !== 0xFF;
            if (!isBorder) {
              for (const [ddx, ddz] of DIRS) {
                const nIdx = (gz + ddz) * grid.width + (gx + ddx);
                if (nIdx >= 0 && nIdx < labels.length && labels[nIdx] !== region) { isBorder = true; break; }
              }
            }
            if (!isBorder) continue;

            // Walk each cardinal direction through cliff to find connected-set cell
            for (const [ddx, ddz] of DIRS) {
              // First step must leave the region (walk outward, not inward)
              const firstGX = gx + ddx;
              const firstGZ = gz + ddz;
              if (firstGX < EDGE_MARGIN || firstGX >= grid.width - EDGE_MARGIN) continue;
              if (firstGZ < EDGE_MARGIN || firstGZ >= grid.height - EDGE_MARGIN) continue;
              const firstIdx = firstGZ * grid.width + firstGX;
              if (labels[firstIdx] === region) continue; // walking inward -- skip

              let cx = firstGX;
              let cz = firstGZ;
              for (let step = 0; step < MAX_WALK; step++) {
                if (cx < EDGE_MARGIN || cx >= grid.width - EDGE_MARGIN) break;
                if (cz < EDGE_MARGIN || cz >= grid.height - EDGE_MARGIN) break;

                const nIdx = cz * grid.width + cx;
                const nLab = labels[nIdx];

                if (nLab >= 0 && connectedSet.has(nLab)) {
                  // Found a connected-set cell on the other side of the cliff
                  const nCell = grid.getCell(cx, cz);
                  if (nCell && nCell.passable !== 0) {
                    const heightDiff = Math.abs(cell.surfaceHeight - nCell.surfaceHeight);
                    if (heightDiff >= 0.3) {
                      const dist = step + 1;
                      const flatness = this.scoreCliffFlatness(grid, gx, gz, cx, cz);
                      // Penalize sloped surfaces at ladder endpoints
                      // Check height variation among neighbors of each endpoint
                      let slopePenalty = 0;
                      for (const [sdx, sdz] of DIRS) {
                        const na = grid.getCell(gx + sdx, gz + sdz);
                        if (na) slopePenalty += Math.abs(na.surfaceHeight - cell.surfaceHeight);
                        const nb = grid.getCell(cx + sdx, cz + sdz);
                        if (nb && nCell) slopePenalty += Math.abs(nb.surfaceHeight - nCell.surfaceHeight);
                      }
                      const score = heightDiff * 2 + flatness * 3 + slopePenalty * 4 + dist * 0.3;
                      if (score < bestScore) {
                        bestScore = score;
                        bestCandidate = { agx: gx, agz: gz, bgx: cx, bgz: cz, score };
                      }
                      regionHasCandidate = true;
                    }
                  }
                  break; // stop walking this direction
                }

                // Skip over walkable cells of other disconnected regions (slope ledges).
                // Don't stop -- the connected set may be on the far side.

                // Otherwise it's blocked (nLab === -1) -- continue through cliff
                cx += ddx;
                cz += ddz;
              }
            }
          }
        }

        if (!regionHasCandidate) failedRegions++;
      }

      if (!bestCandidate) {
        if (failedRegions > 0) {
          console.warn(`[NavGrid] ${failedRegions} regions unreachable via cliff-walk`);
        }
        break;
      }

      if (!this.placeLadder(grid, ladderCost, navLinkOffset, bestCandidate.agx, bestCandidate.agz, bestCandidate.bgx, bestCandidate.bgz)) {
        // placeLadder can fail if height diff too small after grid-to-world rounding
        // Skip this pair by poisoning the cell -- mark as visited. Re-label next iter.
        break;
      }
    }

    // console.log(`[Terrain] NavGrid connectivity: ${this.ctx.ladderDefs.length} total ladders`);
  }
}
