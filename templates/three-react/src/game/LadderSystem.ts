import * as THREE from 'three';
import type { NavGrid, AABBBox } from './pathfinding/NavGrid';
import {
  LADDER_COLOR,
  LADDER_RUNG_SPACING,
  LADDER_RAIL_WIDTH,
  LADDER_RAIL_THICKNESS,
  LADDER_RUNG_THICKNESS,
  LADDER_WALL_OFFSET,
  LADDER_COST,
} from './GameConstants';

export interface LadderDef {
  /** Ladder mesh midpoint */
  bottomX: number; bottomZ: number; bottomY: number;
  topY: number;
  /** Unit normal: cliff face toward low side */
  facingDX: number; facingDZ: number;
  /** World positions of low/high cells */
  lowWorldX: number; lowWorldZ: number;
  highWorldX: number; highWorldZ: number;
  /** Nav-grid cell coordinates */
  lowCellGX: number; lowCellGZ: number;
  highCellGX: number; highCellGZ: number;
}

export class LadderSystem {
  ladders: LadderDef[] = [];
  private meshes: THREE.Group[] = [];
  private mat: THREE.MeshStandardMaterial;

  constructor(private scene: THREE.Scene) {
    this.mat = new THREE.MeshStandardMaterial({
      color: LADDER_COLOR,
      roughness: 0.8,
      metalness: 0.1,
    });
  }

  /** Scan for walkable cells adjacent to blocked elevated terraces.
   *  Group blocked cells into terraces (flood-fill), then place ONE ladder per terrace.
   *  Ladder mesh stands on the walkable ground cell, leaning against the wall face. */
  rebuild(navGrid: NavGrid, obstacles: ReadonlyArray<AABBBox>): void {
    this.clear();

    const stepUp = navGrid.stepUp;
    const cs = navGrid.cellSize;
    const w = navGrid.width;
    const h = navGrid.height;
    const totalCells = w * h;

    // ── Step 1: Label blocked elevated cells into terrace groups ──
    const terraceId = new Int32Array(totalCells).fill(-1);
    const terraceSize = new Map<number, number>(); // tid → cell count
    let nextTerraceId = 0;
    const EPS = 0.1;
    const MIN_TERRACE_CELLS = 4; // skip tiny terraces (1-3 cells on top)

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

    // ── Step 2: Collect ALL ladder candidates per terrace ──
    interface Candidate {
      gx: number; gz: number;       // walkable (low) cell — ladder stands here
      ngx: number; ngz: number;     // blocked (high) cell — top of ladder
      heightDiff: number;
      lowH: number; highH: number;
      terraceId: number;
      lowConnectivity: number;
    }
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
          if (heightDiff <= stepUp) continue;
          if (heightDiff < 0.3) continue;

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

    // ── Step 3: Pick ladders per terrace — more for bigger terraces ──
    // Max ladders per terrace: 1 for <10 cells, 2 for 10-29, 3 for 30+
    // Small terraces (<10 cells) have a probability-based chance of getting any ladder
    const MIN_LADDER_DIST = cs * 5;
    const MIN_LADDER_DIST_SQ = MIN_LADDER_DIST * MIN_LADDER_DIST;

    const placed: { x: number; z: number; highH: number }[] = [];

    for (const [tid, candidates] of candidatesPerTerrace) {
      const tSize = terraceSize.get(tid) ?? 0;

      // Small terraces: probability-based (1 cell→10%, 10+→100%)
      if (tSize < 10 && Math.random() > tSize * 0.1) continue;

      // How many ladders this terrace gets
      const maxLadders = tSize < 10 ? 1 : tSize < 30 ? 2 : 3;

      // Sort candidates: best connectivity first, then shortest height
      candidates.sort((a, b) =>
        b.lowConnectivity - a.lowConnectivity || a.heightDiff - b.heightDiff,
      );

      let placedForTerrace = 0;
      for (const c of candidates) {
        if (placedForTerrace >= maxLadders) break;

        const lowWorld = navGrid.gridToWorld(c.gx, c.gz);

        // Check distance to ALL already-placed ladders at similar height
        let tooClose = false;
        for (const p of placed) {
          if (Math.abs(p.highH - c.highH) > 1.0) continue;
          const dx = lowWorld.x - p.x;
          const dz = lowWorld.z - p.z;
          if (dx * dx + dz * dz < MIN_LADDER_DIST_SQ) {
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;

        // Mark the high cell for unblocking (recomputeReachability will flood-fill)
        const highCell = navGrid.getCell(c.ngx, c.ngz);
        if (highCell && highCell.blocked) {
          highCell.blocked = false;
        }

        const highWorld = navGrid.gridToWorld(c.ngx, c.ngz);
        const fdx = highWorld.x - lowWorld.x;
        const fdz = highWorld.z - lowWorld.z;
        const flen = Math.sqrt(fdx * fdx + fdz * fdz);
        const nfdx = flen > 0 ? fdx / flen : 0;
        const nfdz = flen > 0 ? fdz / flen : 0;

        const ladderDef: LadderDef = {
          bottomX: lowWorld.x,
          bottomZ: lowWorld.z,
          bottomY: c.lowH,
          topY: c.highH,
          facingDX: nfdx,
          facingDZ: nfdz,
          lowWorldX: lowWorld.x,
          lowWorldZ: lowWorld.z,
          highWorldX: highWorld.x,
          highWorldZ: highWorld.z,
          lowCellGX: c.gx,
          lowCellGZ: c.gz,
          highCellGX: c.ngx,
          highCellGZ: c.ngz,
        };

        const ladderIndex = this.ladders.length;
        this.ladders.push(ladderDef);
        navGrid.addNavLink(c.gx, c.gz, c.ngx, c.ngz, LADDER_COST, ladderIndex);
        this.createLadderMesh(ladderDef, cs);
        placed.push({ x: lowWorld.x, z: lowWorld.z, highH: c.highH });
        placedForTerrace++;
      }
    }

    // ── Step 4: Shortcut ladders on cliff edges of already-walkable terraces ──
    // Scan for walkable elevated cells next to lower walkable cells where the
    // height difference exceeds stepUp — these are cliff faces that could use a
    // ladder as an alternative access point (avoids long detours).
    const SHORTCUT_CHANCE = 0.08; // ~8% of eligible cliff edges get a ladder
    for (let gz = 0; gz < h; gz++) {
      for (let gx = 0; gx < w; gx++) {
        const cell = navGrid.getCell(gx, gz);
        if (!cell || cell.blocked) continue;

        for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
          const ngx = gx + dx, ngz = gz + dz;
          if (ngx < 0 || ngx >= w || ngz < 0 || ngz >= h) continue;
          const neighbor = navGrid.getCell(ngx, ngz);
          if (!neighbor || neighbor.blocked) continue;

          // We want low→high: cell is low, neighbor is high
          const heightDiff = neighbor.surfaceHeight - cell.surfaceHeight;
          if (heightDiff <= stepUp || heightDiff < 0.3) continue;

          if (Math.random() > SHORTCUT_CHANCE) continue;

          const lowWorld = navGrid.gridToWorld(gx, gz);

          // Enforce minimum spacing from all placed ladders
          let tooClose = false;
          for (const p of placed) {
            if (Math.abs(p.highH - neighbor.surfaceHeight) > 1.0) continue;
            const ddx = lowWorld.x - p.x;
            const ddz = lowWorld.z - p.z;
            if (ddx * ddx + ddz * ddz < MIN_LADDER_DIST_SQ) {
              tooClose = true;
              break;
            }
          }
          if (tooClose) continue;

          const highWorld = navGrid.gridToWorld(ngx, ngz);
          const fdx = highWorld.x - lowWorld.x;
          const fdz = highWorld.z - lowWorld.z;
          const flen = Math.sqrt(fdx * fdx + fdz * fdz);

          const ladderDef: LadderDef = {
            bottomX: lowWorld.x,
            bottomZ: lowWorld.z,
            bottomY: cell.surfaceHeight,
            topY: neighbor.surfaceHeight,
            facingDX: flen > 0 ? fdx / flen : 0,
            facingDZ: flen > 0 ? fdz / flen : 0,
            lowWorldX: lowWorld.x,
            lowWorldZ: lowWorld.z,
            highWorldX: highWorld.x,
            highWorldZ: highWorld.z,
            lowCellGX: gx,
            lowCellGZ: gz,
            highCellGX: ngx,
            highCellGZ: ngz,
          };

          const ladderIndex = this.ladders.length;
          this.ladders.push(ladderDef);
          navGrid.addNavLink(gx, gz, ngx, ngz, LADDER_COST, ladderIndex);
          this.createLadderMesh(ladderDef, cs);
          placed.push({ x: lowWorld.x, z: lowWorld.z, highH: neighbor.surfaceHeight });
        }
      }
    }

    // Re-run reachability flood-fill including nav-links: unblocks entire terraces
    // reachable via ladders + stepping, then recomputes passability edges.
    if (this.ladders.length > 0) {
      navGrid.recomputeReachability();
    }

    // Debug: verify nav-links were registered
    let linkCount = 0;
    for (const ladder of this.ladders) {
      const links = navGrid.getNavLinks(ladder.lowCellGX, ladder.lowCellGZ);
      if (links) linkCount += links.length;
    }
    console.log(`[LADDERS] Placed ${this.ladders.length} ladders, ${linkCount} nav-links verified`);
    if (this.ladders.length > 0) {
      const l = this.ladders[0];
      const lowCell = navGrid.getCell(l.lowCellGX, l.lowCellGZ);
      const highCell = navGrid.getCell(l.highCellGX, l.highCellGZ);
      console.log(`[LADDERS] Sample ladder#0: low(${l.lowCellGX},${l.lowCellGZ}) h=${lowCell?.surfaceHeight.toFixed(2)} blocked=${lowCell?.blocked} passable=${lowCell?.passable} → high(${l.highCellGX},${l.highCellGZ}) h=${highCell?.surfaceHeight.toFixed(2)} blocked=${highCell?.blocked} passable=${highCell?.passable}`);
      const lowLinks = navGrid.getNavLinks(l.lowCellGX, l.lowCellGZ);
      console.log(`[LADDERS] Low cell nav-links:`, lowLinks);
    }
  }

  private createLadderMesh(ladder: LadderDef, cellSize: number): void {
    const group = new THREE.Group();
    const dy = ladder.topY - ladder.bottomY;
    const ladderLength = dy;
    const rungCount = Math.max(1, Math.floor(ladderLength / LADDER_RUNG_SPACING));

    // Yaw: ladder faces INTO the wall (toward high cell)
    const yaw = Math.atan2(ladder.facingDX, ladder.facingDZ);

    // Perpendicular direction for rail offset
    const perpDX = -ladder.facingDZ;
    const perpDZ = ladder.facingDX;

    // Ladder stands on the LOW (walkable) cell, flush against the wall of the high cell.
    // From the low cell center, move toward the wall by half a cell minus a small offset.
    const halfCell = cellSize * 0.5;
    const baseX = ladder.lowWorldX + ladder.facingDX * (halfCell - LADDER_WALL_OFFSET);
    const baseZ = ladder.lowWorldZ + ladder.facingDZ * (halfCell - LADDER_WALL_OFFSET);
    const baseY = ladder.bottomY;

    // Rails
    const railGeo = new THREE.BoxGeometry(
      LADDER_RAIL_THICKNESS,
      ladderLength + 0.15,
      LADDER_RAIL_THICKNESS,
    );
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(railGeo, this.mat);
      rail.position.set(
        baseX + perpDX * (LADDER_RAIL_WIDTH * 0.5) * side,
        baseY + ladderLength / 2,
        baseZ + perpDZ * (LADDER_RAIL_WIDTH * 0.5) * side,
      );
      rail.rotation.y = yaw;
      rail.castShadow = true;
      group.add(rail);
    }

    // Rungs
    const rungGeo = new THREE.BoxGeometry(
      LADDER_RAIL_WIDTH,
      LADDER_RUNG_THICKNESS,
      LADDER_RUNG_THICKNESS,
    );
    for (let i = 0; i <= rungCount; i++) {
      const t = rungCount > 0 ? i / rungCount : 0;
      const rung = new THREE.Mesh(rungGeo, this.mat);
      rung.position.set(baseX, baseY + dy * t, baseZ);
      rung.rotation.y = yaw;
      rung.castShadow = true;
      group.add(rung);
    }

    this.scene.add(group);
    this.meshes.push(group);
  }

  clear(): void {
    for (const group of this.meshes) {
      this.scene.remove(group);
      group.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).geometry.dispose();
        }
      });
    }
    this.meshes = [];
    this.ladders = [];
  }

  dispose(): void {
    this.clear();
    this.mat.dispose();
  }
}
