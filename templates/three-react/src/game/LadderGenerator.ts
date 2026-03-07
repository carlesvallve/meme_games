/**
 * LadderGenerator — procedural ladder placement for the obstacle-based world.
 * Scans the NavGrid for cliff edges (blocked terraces + walkable shortcuts)
 * and calls LadderSystem.placeLadder() to create each one.
 */

import type { NavGrid } from './pathfinding/NavGrid';
import type { LadderSystem } from './LadderSystem';
import { useGameStore } from '../store';

interface Candidate {
  gx: number; gz: number;       // walkable (low) cell
  ngx: number; ngz: number;     // high cell (blocked or walkable cliff)
  heightDiff: number;
  lowH: number; highH: number;
  terraceId: number;
  lowConnectivity: number;
}

export class LadderGenerator {

  /**
   * Scan the navGrid for cliff edges and place ladders via ladderSystem.
   * Handles both blocked terraces (need ladders to become reachable)
   * and already-walkable cliff edges (shortcut ladders).
   */
  generate(navGrid: NavGrid, ladderSystem: LadderSystem): void {
    ladderSystem.clear();

    const stepUp = navGrid.stepUp;
    const cs = navGrid.cellSize;
    const w = navGrid.width;
    const h = navGrid.height;
    const totalCells = w * h;

    // Density slider: 0→sparse (large spacing), 1→dense (small spacing)
    const density = useGameStore.getState().ladderDensity;
    const MIN_LADDER_DIST = cs * (8 - density * 5); // range: cs*8 (density=0) to cs*3 (density=1)
    const MIN_LADDER_DIST_SQ = MIN_LADDER_DIST * MIN_LADDER_DIST;
    const placed: { x: number; z: number; highH: number }[] = [];

    // ── Helper: check spacing against already-placed ladders ──
    const isTooClose = (wx: number, wz: number, highH: number): boolean => {
      for (const p of placed) {
        if (Math.abs(p.highH - highH) > 1.0) continue;
        const dx = wx - p.x;
        const dz = wz - p.z;
        if (dx * dx + dz * dz < MIN_LADDER_DIST_SQ) return true;
      }
      return false;
    };

    // ── Helper: place a single ladder and record it ──
    const place = (
      lowGX: number, lowGZ: number,
      highGX: number, highGZ: number,
      navGrid: NavGrid, ladderSystem: LadderSystem,
    ): void => {
      const lowWorld = navGrid.gridToWorld(lowGX, lowGZ);
      const highWorld = navGrid.gridToWorld(highGX, highGZ);
      const lowCell = navGrid.getCell(lowGX, lowGZ)!;
      const highCell = navGrid.getCell(highGX, highGZ)!;

      // Unblock the high cell so recomputeReachability can flood through it
      if (highCell.blocked) highCell.blocked = false;

      ladderSystem.placeLadder(
        navGrid,
        lowGX, lowGZ, lowWorld.x, lowWorld.z, lowCell.surfaceHeight,
        highGX, highGZ, highWorld.x, highWorld.z, highCell.surfaceHeight,
      );
      placed.push({ x: lowWorld.x, z: lowWorld.z, highH: highCell.surfaceHeight });
    };

    // ── Phase 1: Blocked terraces — flood-fill into groups, pick ladders per group ──
    const terraceId = new Int32Array(totalCells).fill(-1);
    const terraceSize = new Map<number, number>();
    let nextTerraceId = 0;
    const EPS = 0.1;

    for (let i = 0; i < totalCells; i++) {
      if (terraceId[i] >= 0) continue;
      const cell = navGrid.getCell(i % w, Math.floor(i / w));
      if (!cell || !cell.blocked || cell.surfaceHeight <= 0) continue;

      const tid = nextTerraceId++;
      let size = 0;
      const queue = [i];
      terraceId[i] = tid;
      while (queue.length > 0) {
        const idx = queue.pop()!;
        size++;
        const cx = idx % w;
        const cz = Math.floor(idx / w);
        const ch = navGrid.getCell(cx, cz)!.surfaceHeight;
        for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nx >= w || nz < 0 || nz >= h) continue;
          const nIdx = nz * w + nx;
          if (terraceId[nIdx] >= 0) continue;
          const nc = navGrid.getCell(nx, nz);
          if (!nc || !nc.blocked || nc.surfaceHeight <= 0) continue;
          if (Math.abs(nc.surfaceHeight - ch) > EPS) continue;
          terraceId[nIdx] = tid;
          queue.push(nIdx);
        }
      }
      terraceSize.set(tid, size);
    }

    // Collect candidates per terrace
    const candidatesPerTerrace = new Map<number, Candidate[]>();

    for (let gz = 0; gz < h; gz++) {
      for (let gx = 0; gx < w; gx++) {
        const cell = navGrid.getCell(gx, gz);
        if (!cell || cell.blocked) continue;

        let connectivity = 0;
        for (let dir = 0; dir < 8; dir++) {
          if (cell.passable & (1 << dir)) connectivity++;
        }

        for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const ngx = gx + dx, ngz = gz + dz;
          if (ngx < 0 || ngx >= w || ngz < 0 || ngz >= h) continue;
          const nIdx = ngz * w + ngx;
          const tid = terraceId[nIdx];
          if (tid < 0) continue;

          const neighbor = navGrid.getCell(ngx, ngz)!;
          const heightDiff = neighbor.surfaceHeight - cell.surfaceHeight;
          if (heightDiff <= stepUp || heightDiff < 0.3) continue;

          if (!candidatesPerTerrace.has(tid)) candidatesPerTerrace.set(tid, []);
          candidatesPerTerrace.get(tid)!.push({
            gx, gz, ngx, ngz,
            heightDiff,
            lowH: cell.surfaceHeight,
            highH: neighbor.surfaceHeight,
            terraceId: tid,
            lowConnectivity: connectivity,
          });
        }
      }
    }

    // Pick ladders per terrace, scaling count with terrace size
    for (const [tid, candidates] of candidatesPerTerrace) {
      const tSize = terraceSize.get(tid) ?? 0;

      // Small terraces: probability-based (1 cell→10%, 10+→100%)
      if (tSize < 10 && Math.random() > tSize * 0.1) continue;

      const maxLadders = tSize < 10 ? 1 : tSize < 30 ? 2 : 3;

      candidates.sort((a, b) =>
        b.lowConnectivity - a.lowConnectivity || a.heightDiff - b.heightDiff,
      );

      let placedForTerrace = 0;
      for (const c of candidates) {
        if (placedForTerrace >= maxLadders) break;

        const lowWorld = navGrid.gridToWorld(c.gx, c.gz);
        if (isTooClose(lowWorld.x, lowWorld.z, c.highH)) continue;

        place(c.gx, c.gz, c.ngx, c.ngz, navGrid, ladderSystem);
        placedForTerrace++;
      }
    }

    // ── Phase 2: Shortcut ladders on already-walkable cliff edges ──
    const SHORTCUT_CHANCE = 0.02 + density * 0.1; // 2% (density=0) to 12% (density=1)
    for (let gz = 0; gz < h; gz++) {
      for (let gx = 0; gx < w; gx++) {
        const cell = navGrid.getCell(gx, gz);
        if (!cell || cell.blocked) continue;

        for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const ngx = gx + dx, ngz = gz + dz;
          if (ngx < 0 || ngx >= w || ngz < 0 || ngz >= h) continue;
          const neighbor = navGrid.getCell(ngx, ngz);
          if (!neighbor || neighbor.blocked) continue;

          const heightDiff = neighbor.surfaceHeight - cell.surfaceHeight;
          if (heightDiff <= stepUp || heightDiff < 0.3) continue;
          if (Math.random() > SHORTCUT_CHANCE) continue;

          const lowWorld = navGrid.gridToWorld(gx, gz);
          if (isTooClose(lowWorld.x, lowWorld.z, neighbor.surfaceHeight)) continue;

          place(gx, gz, ngx, ngz, navGrid, ladderSystem);
        }
      }
    }

    console.warn(`[LadderGenerator] Placed ${ladderSystem.ladders.length} ladders`);

    // Unblock terraces reachable via newly-placed ladders
    if (ladderSystem.ladders.length > 0) {
      navGrid.recomputeReachability();
    }

  }
}
