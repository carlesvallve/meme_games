import * as THREE from 'three';
import { Entity, Layer, entityRegistry } from '../core/Entity';
import {
  generateDungeon,
  DoorSystem,
  buildVoxelDungeonCollision,
  loadVoxelDungeonVisuals,
  computeCellHeights,
  buildStairMeshes,
  getStairCellSet,
  DUNGEON_VARIANTS,
  RoomVisibility,
  DungeonPropSystem,
  clearPropCache,
} from '../dungeon';
import type { StairDef, LadderHint, WalkMask } from '../dungeon';
import { useGameStore } from '../../store';
import { SeededRandom } from '../../utils/SeededRandom';
import { EnvironmentContext, type DebrisBox } from '../environment/EnvironmentContext';

// ── TerrainLike adapter ─────────────────────────────────────────────

/** Minimal interface that DoorSystem expects from the terrain. */
export interface TerrainLike {
  addStaticDebris(box: DebrisBox): void;
  addDynamicDebris(box: DebrisBox): void;
  removeDynamicDebris(box: DebrisBox): void;
  registerVisibility(obj: THREE.Object3D, roomIds: number[], wx?: number, wz?: number): void;
}

// ── DungeonBuilder ──────────────────────────────────────────────────

export class DungeonBuilder {
  constructor(
    private ctx: EnvironmentContext,
    private placeBoxFn: (x: number, z: number, w: number, d: number, h: number, skipZFight?: boolean) => boolean,
    private terrainLike: TerrainLike,
  ) {}

  // ── Visibility registration ─────────────────────────────────────

  /** Register a mesh with room visibility, automatically applying dual-level
   *  active-only IDs if the world position falls on a stair/ladder boundary cell. */
  registerVisibility(obj: THREE.Object3D, roomIds: number[], wx?: number, wz?: number): void {
    if (!this.ctx.roomVisibility) return;
    if (roomIds.length === 0) return;
    let activeOnly: number[] | undefined;
    if (wx !== undefined && wz !== undefined && this.ctx.dualLevelCells.size > 0) {
      const halfW = (this.ctx.effectiveGroundSize || this.ctx.groundSize) / 2;
      const gx = Math.floor((wx + halfW) / this.ctx.dungeonCellSize);
      const gz = Math.floor((wz + halfW) / this.ctx.dungeonCellSize);
      if (gx >= 0 && gx < this.ctx.dungeonGridW && gz >= 0 && gz < this.ctx.dungeonGridD) {
        const extraRid = this.ctx.dualLevelCells.get(gz * this.ctx.dungeonGridW + gx);
        if (extraRid !== undefined && !roomIds.includes(extraRid)) {
          activeOnly = [extraRid];
        }
      }
    }
    this.ctx.roomVisibility.registerMesh(obj, roomIds, activeOnly);
  }

  // ── Voxel dungeon ──────────────────────────────────────────────

  createVoxelDungeonDebris(): void {
    const { roomSpacing, roomSpacingMax, tileSize, doorChance, heightChance, loopChance, dungeonVariant } = useGameStore.getState();
    const output = generateDungeon(this.ctx.groundSize, tileSize, roomSpacing, doorChance, this.ctx.dungeonSeed, loopChance, roomSpacingMax);
    this.ctx.walkMask = output.walkMask;
    this.ctx.effectiveGroundSize = this.ctx.groundSize;
    const cellSize = output.walkMask.cellSize;

    this.ctx._roomCount = output.roomCount;

    // Compute entrance/exit room centers for character spawn/exit detection
    const halfWorld = this.ctx.groundSize / 2;
    // NOTE: cellHeightsArr not computed yet here -- room Y updated after stair computation below
    if (output.rooms.length > 0) {
      const computeRoomCenter = (roomIdx: number): THREE.Vector3 => {
        const r = output.rooms[roomIdx];
        const cx = -halfWorld + (r.x + r.w / 2) * cellSize;
        const cz = -halfWorld + (r.z + r.d / 2) * cellSize;
        return new THREE.Vector3(cx, 0, cz);
      };
      this.ctx.entranceRoomCenter = computeRoomCenter(output.entranceRoom);
      this.ctx.exitRoomCenter = computeRoomCenter(output.exitRoom);
    }

    // Snapshot openGrid for visual tile placement BEFORE door-flanking mutation
    const { openGrid, gridW, gridD } = output.walkMask;
    const visualOpenGrid = openGrid.slice();

    // Mark door-flanking cells (pillar cells) as unwalkable so only the central cell is passable
    // This only affects walkMask/collision -- visuals use the pre-mutation snapshot
    this.ctx.doorCenters = [];
    const halfW = this.ctx.groundSize / 2;
    for (const d of output.gridDoors) {
      const gx = Math.round(d.x);
      const gz = Math.round(d.z);
      // Store door center world position for corner correction
      this.ctx.doorCenters.push({
        x: -halfW + (gx + 0.5) * cellSize,
        z: -halfW + (gz + 0.5) * cellSize,
        orientation: d.orientation,
      });
      if (d.orientation === 'NS') {
        // Corridor runs along X -- pillars above and below
        if (gz - 1 >= 0) openGrid[(gz - 1) * gridW + gx] = false;
        if (gz + 1 < gridD) openGrid[(gz + 1) * gridW + gx] = false;
      } else {
        // Corridor runs along Z -- pillars left and right
        if (gx - 1 >= 0) openGrid[gz * gridW + (gx - 1)] = false;
        if (gx + 1 < gridW) openGrid[gz * gridW + (gx + 1)] = false;
      }
    }

    // Resolve dungeon theme variant -- use currentTheme from store (set by snapshot restore)
    // or derive deterministically from seed, or use the settings panel choice
    const storedTheme = useGameStore.getState().currentTheme;
    let theme: string;
    if (storedTheme) {
      theme = storedTheme;
      // Clear it so next generation doesn't reuse stale value
      useGameStore.getState().setCurrentTheme('');
    } else if (dungeonVariant === 'random') {
      // Deterministic theme selection -- mix seed with a theme-specific salt
      // to avoid correlation with dungeon layout RNG using the same seed
      const themeRng = new SeededRandom((this.ctx.dungeonSeed ?? 0) ^ 0x7E3A91F5);
      theme = DUNGEON_VARIANTS[themeRng.int(0, DUNGEON_VARIANTS.length)];
    } else {
      theme = dungeonVariant;
    }
    // Store the resolved theme so it can be saved in level snapshots
    useGameStore.getState().setCurrentTheme(theme);

    // ── Stair system: compute height variation ──
    const voxScale = cellSize / 15;
    const wallVoxH = 17 * voxScale;   // wall vox model height
    const floorVoxH = 1 * voxScale;   // floor tile thickness
    const stepH = wallVoxH + floorVoxH; // total stair rise -- top step flush with next floor surface
    const stairRng = new SeededRandom(this.ctx.dungeonSeed ?? 0);
    const { cellHeights: cellHeightsArr, stairs, ladderHints } = computeCellHeights(
      output.roomOwnership, visualOpenGrid,
      output.entranceRoom, output.rooms, gridW, gridD,
      output.corridors, stepH, wallVoxH, stairRng, heightChance,
    );
    this.ctx.cellHeights = cellHeightsArr;
    this.ctx.dungeonCellSize = cellSize;
    this.ctx.dungeonGridW = gridW;
    this.ctx.dungeonGridD = gridD;
    this.ctx.dungeonRoomOwnership = output.roomOwnership;
    this.ctx.stairMap.clear();
    for (const s of stairs) this.ctx.stairMap.set(s.gz * gridW + s.gx, s);
    this.ctx.dungeonLadderHints = ladderHints;

    // Remove doors that overlap with stairs -- stairs already serve as the room transition.
    // Filter both parallel arrays (gridDoors and doors) together.
    for (let i = output.gridDoors.length - 1; i >= 0; i--) {
      const gx = Math.round(output.gridDoors[i].x);
      const gz = Math.round(output.gridDoors[i].z);
      if (gx < 0 || gx >= gridW || gz < 0 || gz >= gridD) continue;
      if (this.ctx.stairMap.has(gz * gridW + gx)) {
        output.gridDoors.splice(i, 1);
        output.doors.splice(i, 1);
      }
    }

    // Remove doors at cells with large height differences -- the height-based
    // flood-fill blocking handles visibility, and doors look wrong at cliff edges.
    // But keep doors adjacent to stairs (the stair handles the height transition).
    for (let i = output.gridDoors.length - 1; i >= 0; i--) {
      const gx = Math.round(output.gridDoors[i].x);
      const gz = Math.round(output.gridDoors[i].z);
      if (gx < 0 || gx >= gridW || gz < 0 || gz >= gridD) continue;
      // Skip removal if this cell is adjacent to a stair
      let adjStair = false;
      for (const [ddx, ddz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as [number, number][]) {
        const nx = gx + ddx, nz = gz + ddz;
        if (nx >= 0 && nx < gridW && nz >= 0 && nz < gridD && this.ctx.stairMap.has(nz * gridW + nx)) {
          adjStair = true; break;
        }
      }
      if (adjStair) continue;
      const dh = cellHeightsArr[gz * gridW + gx];
      let maxNeighborDiff = 0;
      for (const [ddx, ddz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as [number, number][]) {
        const nx = gx + ddx, nz = gz + ddz;
        if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
        if (!visualOpenGrid[nz * gridW + nx]) continue;
        maxNeighborDiff = Math.max(maxNeighborDiff, Math.abs(cellHeightsArr[nz * gridW + nx] - dh));
      }
      if (maxNeighborDiff > wallVoxH * 0.5) {
        output.gridDoors.splice(i, 1);
        output.doors.splice(i, 1);
      }
    }

    // ── Break up oversized visibility regions ──
    // Flood-fill like RoomVisibility (stop at doors + height diffs) to find connected
    // regions. If any region is too large, bump corridor heights to split it.
    let regionSplitBumps = 0;
    {
      const heightThreshold = 0.15; // matches RoomVisibility constructor
      const MAX_REGION_CELLS = 120;
      const doorCells = new Set<number>();
      for (const gd of output.gridDoors) {
        doorCells.add(Math.round(gd.z) * gridW + Math.round(gd.x));
      }
      const visited = new Uint8Array(gridW * gridD);
      const dirs4: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

      for (let startIdx = 0; startIdx < gridW * gridD; startIdx++) {
        if (visited[startIdx]) continue;
        if (!visualOpenGrid[startIdx]) continue;

        // Flood-fill this region
        const region: number[] = [];
        const queue: number[] = [startIdx];
        visited[startIdx] = 1;
        while (queue.length > 0) {
          const idx = queue.pop()!;
          region.push(idx);
          const gx = idx % gridW;
          const gz = (idx - gx) / gridW;
          for (const [dx, dz] of dirs4) {
            const nx = gx + dx, nz = gz + dz;
            if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
            const nidx = nz * gridW + nx;
            if (visited[nidx]) continue;
            if (!visualOpenGrid[nidx]) continue;
            if (doorCells.has(nidx)) continue;
            const hDiff = Math.abs(cellHeightsArr[nidx] - cellHeightsArr[idx]);
            if (hDiff > heightThreshold) continue;
            visited[nidx] = 1;
            queue.push(nidx);
          }
        }

        if (region.length <= MAX_REGION_CELLS) continue;

        // Region too large — find corridor cells that connect different rooms
        // and bump their height to split the region.
        // Strategy: find corridor cells adjacent to two different rooms, pick
        // the ones farthest from entrance to bump up by 1 level.
        const entranceGx = output.rooms[output.entranceRoom].x +
          Math.floor(output.rooms[output.entranceRoom].w / 2);
        const entranceGz = output.rooms[output.entranceRoom].z +
          Math.floor(output.rooms[output.entranceRoom].d / 2);

        // Collect candidate corridor cells that border a room
        type SplitCandidate = { idx: number; gx: number; gz: number; distSq: number };
        const candidates: SplitCandidate[] = [];
        for (const idx of region) {
          if (output.roomOwnership[idx] >= 0) continue; // skip room cells
          const gx = idx % gridW;
          const gz = (idx - gx) / gridW;
          // Must be adjacent to at least one room cell
          let touchesRoom = false;
          for (const [dx, dz] of dirs4) {
            const nx = gx + dx, nz = gz + dz;
            if (nx >= 0 && nx < gridW && nz >= 0 && nz < gridD) {
              if (output.roomOwnership[nz * gridW + nx] >= 0) { touchesRoom = true; break; }
            }
          }
          if (!touchesRoom) continue;
          // Skip cells adjacent to stairs (don't break stair transitions)
          let adjStair = false;
          for (const [dx, dz] of dirs4) {
            const nx = gx + dx, nz = gz + dz;
            if (nx >= 0 && nx < gridW && nz >= 0 && nz < gridD) {
              if (this.ctx.stairMap.has(nz * gridW + nx)) { adjStair = true; break; }
            }
          }
          if (adjStair) continue;
          if (this.ctx.stairMap.has(idx)) continue;
          const ddx = gx - entranceGx, ddz = gz - entranceGz;
          candidates.push({ idx, gx, gz, distSq: ddx * ddx + ddz * ddz });
        }

        // Sort by distance from entrance (bump cells farthest away first)
        candidates.sort((a, b) => b.distSq - a.distSq);

        // Bump a fraction of corridor cells to split the region
        const bumpCount = Math.max(1, Math.floor(candidates.length * 0.3));
        for (let bi = 0; bi < Math.min(bumpCount, candidates.length); bi++) {
          const c = candidates[bi];
          cellHeightsArr[c.idx] += stepH;
          regionSplitBumps++;
        }
      }
    }

    // Update entrance/exit room center Y with cell heights
    if (this.ctx.entranceRoomCenter && output.rooms.length > 0) {
      const er = output.rooms[output.entranceRoom];
      const egx = Math.floor(er.x + er.w / 2);
      const egz = Math.floor(er.z + er.d / 2);
      this.ctx.entranceRoomCenter.y = cellHeightsArr[egz * gridW + egx];
    }
    if (this.ctx.exitRoomCenter && output.rooms.length > 0) {
      const xr = output.rooms[output.exitRoom];
      const xgx = Math.floor(xr.x + xr.w / 2);
      const xgz = Math.floor(xr.z + xr.d / 2);
      this.ctx.exitRoomCenter.y = cellHeightsArr[xgz * gridW + xgx];
    }

    // Compute height stats for summary
    let maxLevel = 0;
    const levelSet = new Set<number>();
    for (let i = 0; i < cellHeightsArr.length; i++) {
      if (cellHeightsArr[i] > 0) {
        const lvl = Math.round(cellHeightsArr[i] / wallVoxH);
        levelSet.add(lvl);
        if (lvl > maxLevel) maxLevel = lvl;
      }
    }

    // ── Single dungeon generation summary ──
    const floor = useGameStore.getState().floor;
    console.log(`[Dungeon F${floor}]`, {
      seed: this.ctx.dungeonSeed,
      theme,
      grid: `${gridW}x${gridD}`,
      groundSize: this.ctx.groundSize,
      rooms: output.rooms.length,
      corridors: output.corridors.length,
      loopCorridors: output.loopCorridors,
      doors: output.doors.length,
      stairs: stairs.length,
      ladders: ladderHints.length,
      heightLevels: levelSet.size,
      maxLevel,
      regionSplitBumps,
      params: { roomGap: `${roomSpacing}-${roomSpacingMax}`, doorChance, heightChance, loopChance, tileSize },
    });

    // Split corridor IDs by height level so corridor cells at different heights
    // get different visibility IDs. Without this, a stair landing (raised to upper
    // level) shares a corridor ID with lower-level cells, lighting them all up.
    const visOwnership = output.roomOwnership.slice();
    this.ctx.visOwnership = visOwnership;
    let nextSyntheticId = -1000; // synthetic IDs well below normal corridor IDs
    const corridorHeightMap = new Map<string, number>(); // "corridorId:heightBucket" -> syntheticId
    for (let i = 0; i < visOwnership.length; i++) {
      const rid = visOwnership[i];
      if (rid >= 0) continue; // rooms keep their ID
      if (rid === -1) continue; // unowned
      const hBucket = Math.round((cellHeightsArr[i] ?? 0) * 10); // 0.1 precision
      const key = `${rid}:${hBucket}`;
      let synId = corridorHeightMap.get(key);
      if (synId === undefined) {
        synId = nextSyntheticId--;
        corridorHeightMap.set(key, synId);
      }
      visOwnership[i] = synId;
    }

    // Split corridor visibility IDs at door cells.
    // Without this, cells on both sides of a mid-corridor door share the same
    // synthetic ID — the flood-fill correctly stops at the door, but all objects
    // registered under the shared ID still light up on both sides.
    // Fix: flood-fill each corridor segment, treating doors as barriers, and
    // assign a fresh synthetic ID to each disconnected segment.
    {
      const doorCellSet = new Set<number>();
      for (const gd of output.gridDoors) {
        doorCellSet.add(Math.round(gd.z) * gridW + Math.round(gd.x));
      }
      const dirs4: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
      const visited = new Uint8Array(gridW * gridD);
      for (let startIdx = 0; startIdx < gridW * gridD; startIdx++) {
        if (visited[startIdx]) continue;
        const rid = visOwnership[startIdx];
        if (rid >= 0 || rid === -1) continue; // only process corridor cells
        if (doorCellSet.has(startIdx)) continue; // door cells get their own ID below

        // Flood-fill this corridor segment, stopping at doors
        const segmentId = nextSyntheticId--;
        const queue: number[] = [startIdx];
        visited[startIdx] = 1;
        visOwnership[startIdx] = segmentId;
        while (queue.length > 0) {
          const idx = queue.pop()!;
          const gx = idx % gridW;
          const gz = (idx - gx) / gridW;
          for (const [dx, dz] of dirs4) {
            const nx = gx + dx, nz = gz + dz;
            if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
            const nidx = nz * gridW + nx;
            if (visited[nidx]) continue;
            const nrid = visOwnership[nidx];
            if (nrid >= 0 || nrid === -1) continue; // not a corridor cell
            if (doorCellSet.has(nidx)) continue; // stop at door cells
            // Also stop at height differences (same as RoomVisibility)
            const hDiff = Math.abs(cellHeightsArr[nidx] - cellHeightsArr[idx]);
            if (hDiff > 0.15) continue;
            visited[nidx] = 1;
            visOwnership[nidx] = segmentId;
            queue.push(nidx);
          }
        }
      }
      // Door cells themselves: assign unique IDs so they don't bridge segments
      for (const doorIdx of doorCellSet) {
        const rid = visOwnership[doorIdx];
        if (rid >= 0 || rid === -1) continue;
        visOwnership[doorIdx] = nextSyntheticId--;
      }
    }

    const voxConfig = {
      openGrid: visualOpenGrid,
      gridW: output.walkMask.gridW,
      gridD: output.walkMask.gridD,
      cellSize,
      groundSize: this.ctx.groundSize,
      doors: output.doors,
      gridDoors: output.gridDoors,
      roomOwnership: visOwnership,
      theme,
      cellHeights: cellHeightsArr,
      stairCells: getStairCellSet(stairs, gridW),
      stairs,
    };

    const vdResult = buildVoxelDungeonCollision(voxConfig, this.ctx.boxGroup);
    this.ctx.debris.push(...vdResult.debris);
    this.ctx.debrisEntities.push(...vdResult.entities);

    // VOX ground tiles are ~0.1m tall -- characters should stand on top
    this.ctx.baseFloorY = 1 * (cellSize / 15); // VOX_GROUND_Y * voxelScale

    // Create room visibility system
    this.ctx.roomVisibility = new RoomVisibility(
      visOwnership,
      visualOpenGrid,
      gridW, gridD, cellSize,
      this.ctx.groundSize,
      output.gridDoors,
      cellHeightsArr,
      0.15, // tight threshold -- only allow terrain unevenness, not level transitions
      getStairCellSet(stairs, gridW),
    );

    // Hide terrain group until onDungeonReady -- prevents flash of unhidden rooms
    this.ctx.group.visible = false;

    // Load visuals async, then create doors + props (need tile geometry to be loaded first)
    loadVoxelDungeonVisuals(voxConfig, this.ctx.group).then(async (visualResult) => {
      if (this.ctx._disposed) return; // terrain was regenerated while loading -- bail out
      if (output.doors.length > 0) {
        // Create a flat material matching the ground tile color for door frames
        const frameMat = visualResult
          ? new THREE.MeshStandardMaterial({
              color: visualResult.groundColor,
              roughness: 0.85,
              metalness: 0.1,
            })
          : undefined;
        this.ctx.doorSystem = new DoorSystem(
          this.ctx.group,
          this.terrainLike,
          output.doors,
          cellSize,
          true, // useVoxDoors
          frameMat,
          cellHeightsArr,
          gridW,
          gridD,
          this.ctx.groundSize,
        );
      }

      // ── Build dual-level visibility map ──
      // Stair/ladder top & bottom cells + their same-height neighbors get an
      // active-only cross-level rid so objects there are visible from both levels.
      const visHeightThreshold = wallVoxH * 0.5;
      const stairDualLevel = new Map<number, number>(); // cellIdx -> extra rid

      // Stairs: stair cell + top landing + bottom foot tile.
      // Scan all 4 cardinal neighbors to find highest (landing) and lowest (foot)
      // by actual cell height -- robust regardless of stair placement variant.
      for (const stair of stairs) {
        const stairIdx = stair.gz * gridW + stair.gx;
        const stairH = cellHeightsArr[stairIdx];
        let highIdx = -1, lowIdx = -1;
        let bestHighH = stairH, bestLowH = Infinity;
        for (const [ddx, ddz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const nx = stair.gx + ddx, nz = stair.gz + ddz;
          if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
          const nIdx = nz * gridW + nx;
          const nH = cellHeightsArr[nIdx];
          if (nH > bestHighH) { bestHighH = nH; highIdx = nIdx; }
          if (nH < bestLowH && visOwnership[nIdx] !== -1) { bestLowH = nH; lowIdx = nIdx; }
        }
        // Find a valid lower rid: prefer lowest neighbor, then walk further down the stair axis
        let lowerRid = -1;
        if (lowIdx >= 0 && visOwnership[lowIdx] !== -1) lowerRid = visOwnership[lowIdx];
        if (lowerRid === -1) {
          // Walk 2-3 cells in the "down" direction (opposite stair direction)
          // to find a cell at the lower height level
          const downDx = stair.axis === 'x' ? -stair.direction : 0;
          const downDz = stair.axis === 'z' ? -stair.direction : 0;
          for (let step = 1; step <= 3; step++) {
            const nx = stair.gx + downDx * step, nz = stair.gz + downDz * step;
            if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) break;
            const nIdx = nz * gridW + nx;
            const nRid = visOwnership[nIdx];
            if (nRid !== -1 && cellHeightsArr[nIdx] < stairH) {
              lowerRid = nRid;
              if (lowIdx < 0) lowIdx = nIdx;
              break;
            }
          }
        }
        if (lowerRid === -1) {
          // Fallback: any neighbor with valid rid that isn't the high cell
          for (const [ddx, ddz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const nx = stair.gx + ddx, nz = stair.gz + ddz;
            if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
            const nIdx = nz * gridW + nx;
            if (nIdx === highIdx) continue;
            const nRid = visOwnership[nIdx];
            if (nRid !== -1) { lowerRid = nRid; break; }
          }
        }
        const upperRid = highIdx >= 0 ? visOwnership[highIdx] : -1;
        if (highIdx >= 0 && lowerRid !== -1) stairDualLevel.set(highIdx, lowerRid);
        if (upperRid !== -1) stairDualLevel.set(stairIdx, upperRid);
        if (lowIdx >= 0 && upperRid !== -1) stairDualLevel.set(lowIdx, upperRid);
      }

      // Ladders: top tile + bottom tile
      for (const lh of ladderHints) {
        const idx1 = lh.lowGZ * gridW + lh.lowGX;
        const idx2 = lh.highGZ * gridW + lh.highGX;
        const h1 = cellHeightsArr[idx1];
        const h2 = cellHeightsArr[idx2];
        const highIdx = h2 >= h1 ? idx2 : idx1;
        const lowIdx = h2 >= h1 ? idx1 : idx2;
        const lowerRid = visOwnership[lowIdx];
        const upperRid = visOwnership[highIdx];
        if (lowerRid !== -1) stairDualLevel.set(highIdx, lowerRid);
        if (upperRid !== -1) stairDualLevel.set(lowIdx, upperRid);
      }

      this.ctx.dualLevelCells = stairDualLevel;

      // Register door groups with room visibility -- use adjacent cell room IDs
      // filtered by height similarity to avoid cross-level registration
      if (this.ctx.doorSystem && this.ctx.roomVisibility && output.gridDoors) {
        const doorGroups = this.ctx.doorSystem.getDoorGroups();
        for (let i = 0; i < doorGroups.length && i < output.gridDoors.length; i++) {
          const d = output.gridDoors[i];
          const gx = Math.round(d.x);
          const gz = Math.round(d.z);
          const cellH = cellHeightsArr[gz * gridW + gx];
          const adjRooms = new Set<number>();
          for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const nx = gx + dx, nz = gz + dz;
            if (nx >= 0 && nx < gridW && nz >= 0 && nz < gridD) {
              const nH = cellHeightsArr[nz * gridW + nx];
              if (Math.abs(nH - cellH) > visHeightThreshold) continue;
              const rid = visOwnership[nz * gridW + nx];
              if (rid !== -1) adjRooms.add(rid);
            }
          }
          if (adjRooms.size > 0) {
            const doorWX = -halfWorld + (gx + 0.5) * cellSize;
            const doorWZ = -halfWorld + (gz + 0.5) * cellSize;
            this.registerVisibility(doorGroups[i], [...adjRooms], doorWX, doorWZ);
          }
        }
      }

      // Register visual meshes with room visibility system
      if (visualResult && this.ctx.roomVisibility) {
        for (const mesh of visualResult.groundMeshList) {
          const rid = mesh.userData.roomId;
          if (rid === undefined) continue;
          const cellIdx = mesh.userData.cellIndex as number | undefined;
          const extraRid = cellIdx !== undefined ? stairDualLevel.get(cellIdx) : undefined;
          // Extra rid is active-only: can show tile as active from the other level,
          // but won't promote to visited/dimmed (dimming follows the primary level)
          const activeOnly = (extraRid !== undefined && extraRid !== rid) ? [extraRid] : undefined;
          this.ctx.roomVisibility.registerMesh(mesh, [rid], activeOnly);
        }
        for (const mesh of visualResult.wallMeshList) {
          const rids = mesh.userData.roomIds as number[] | undefined;
          if (!rids || rids.length === 0) continue;
          const cellIdx = mesh.userData.cellIndex as number | undefined;
          const extraRid = cellIdx !== undefined ? stairDualLevel.get(cellIdx) : undefined;
          const activeOnly = (extraRid !== undefined && !rids.includes(extraRid)) ? [extraRid] : undefined;
          this.ctx.roomVisibility.registerMesh(mesh, rids, activeOnly);
        }
      }

      // Build stair riser meshes and register with room visibility
      if (stairs.length > 0 && visualResult) {
        const stairGroup = buildStairMeshes(
          stairs, cellHeightsArr,
          cellSize, gridW, this.ctx.groundSize,
          visualResult.groundColor,
        );
        this.ctx.group.add(stairGroup);

        // Register stair meshes with the room visibility system
        // Each stairGroup child is a Group (per stair cell) containing step Meshes
        if (this.ctx.roomVisibility) {
          for (const stairCell of stairGroup.children) {
            if (!(stairCell instanceof THREE.Group)) continue;
            const wx = stairCell.position.x;
            const wz = stairCell.position.z;
            const mgx = Math.floor((wx + halfW) / cellSize);
            const mgz = Math.floor((wz + halfW) / cellSize);
            if (mgx >= 0 && mgx < gridW && mgz >= 0 && mgz < gridD) {
              const rid = visOwnership[mgz * gridW + mgx];
              const stairH = cellHeightsArr[mgz * gridW + mgx];
              const adjRooms = new Set<number>();
              if (rid !== -1) adjRooms.add(rid);
              for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
                const nx = mgx + dx, nz = mgz + dz;
                if (nx >= 0 && nx < gridW && nz >= 0 && nz < gridD) {
                  const nH = cellHeightsArr[nz * gridW + nx];
                  if (Math.abs(nH - stairH) > visHeightThreshold) continue; // skip cross-level
                  const nrid = visOwnership[nz * gridW + nx];
                  if (nrid !== -1) adjRooms.add(nrid);
                }
              }
              // Stairs span both levels -- register under both as normal (not active-only)
              const stairCellIdx = mgz * gridW + mgx;
              const extraRid = stairDualLevel.get(stairCellIdx);
              if (extraRid !== undefined) adjRooms.add(extraRid);
              const roomIds = adjRooms.size > 0 ? [...adjRooms] : undefined;
              for (const stepMesh of stairCell.children) {
                if (stepMesh instanceof THREE.Mesh && roomIds) {
                  this.ctx.roomVisibility.registerMesh(stepMesh, roomIds);
                }
              }
            }
          }
        }
      }

      // Debug: grid coordinate labels on each open tile
      {
        const labelGroup = new THREE.Group();
        labelGroup.name = 'debugGridLabels';
        for (let gz = 0; gz < gridD; gz++) {
          for (let gx = 0; gx < gridW; gx++) {
            if (!visualOpenGrid[gz * gridW + gx]) continue;
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 32;
            const canvasCtx = canvas.getContext('2d')!;
            canvasCtx.fillStyle = 'white';
            canvasCtx.font = 'bold 22px monospace';
            canvasCtx.textAlign = 'center';
            canvasCtx.textBaseline = 'middle';
            canvasCtx.fillText(`${gx}_${gz}`, 32, 16);
            const tex = new THREE.CanvasTexture(canvas);
            tex.minFilter = THREE.LinearFilter;
            const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, opacity: 0.6 });
            const sprite = new THREE.Sprite(mat);
            const wx = -halfW + (gx + 0.5) * cellSize;
            const wz = -halfW + (gz + 0.5) * cellSize;
            const cy = cellHeightsArr[gz * gridW + gx] + 0.15;
            sprite.position.set(wx, cy, wz);
            sprite.scale.set(cellSize * 0.45, cellSize * 0.22, 1);
            labelGroup.add(sprite);
          }
        }
        labelGroup.visible = useGameStore.getState().roomLabels;
        this.ctx.group.add(labelGroup);
      }

      // Place all props (room props, portals, corridor props) -- meshes start hidden
      clearPropCache();
      this.ctx.propSystem = new DungeonPropSystem(this.ctx.group);
      await this.ctx.propSystem.populate(
        output.rooms,
        cellSize,
        this.ctx.groundSize,
        output.walkMask.openGrid,
        output.walkMask.gridW,
        output.gridDoors,
        undefined, // wallHeight default
        useGameStore.getState().roomLabels,
        output.entranceRoom,
        output.exitRoom,
        theme,
        this.ctx.dungeonSeed,
        cellHeightsArr,
        output.roomOwnership,
      );

      // Register prop meshes + labels with room visibility
      // Use grid cell (not world position) so wall-mounted props map to their room, not the wall
      if (this.ctx.roomVisibility && this.ctx.propSystem) {
        const rv = this.ctx.roomVisibility;
        const propHalfW = this.ctx.groundSize / 2;
        for (const { mesh, gx, gz } of this.ctx.propSystem.getAllPropMeshesWithCells()) {
          const wx = -propHalfW + (gx + 0.5) * cellSize;
          const wz = -propHalfW + (gz + 0.5) * cellSize;
          const propWX = (gx > 0 || gz > 0) ? wx : mesh.position.x;
          const propWZ = (gx > 0 || gz > 0) ? wz : mesh.position.z;
          const rid = rv.getRoomAtWorld(propWX, propWZ);
          if (rid !== -1) this.registerVisibility(mesh, [rid], propWX, propWZ);
        }
        for (const label of this.ctx.propSystem.getAllLabels()) {
          const rid = rv.getRoomAtWorld(label.position.x, label.position.z);
          if (rid !== -1) this.registerVisibility(label, [rid], label.position.x, label.position.z);
        }
      }

      // Register prop debris boxes for physical collision (keyboard movement)
      const propDebris = this.ctx.propSystem!.getDebrisBoxes();
      for (const d of propDebris) d.isProp = true;
      this.ctx.debris.push(...propDebris);

      // Block the nav cell at each prop's actual world position (accounts for wall push offset).
      if (this.ctx.navGrid && this.ctx.propSystem) {
        const propPositions = this.ctx.propSystem.getPropWorldPositions();
        const blocked: { gx: number; gz: number }[] = [];
        for (const { x, z } of propPositions) {
          blocked.push(this.ctx.navGrid.worldToGrid(x, z));
        }
        this.ctx.navGrid.applyBlockedCells(blocked);
      }

      // Register interactive prop chests with ChestSystem (voxel dungeon)
      if (this.ctx.propChestRegistrar && this.ctx.propSystem) {
        const chests = this.ctx.propSystem.getInteractiveChests();
        if (chests.length > 0) this.ctx.propChestRegistrar(chests);
      }

      // Apply grid opacity to async-loaded grid overlay
      this.setGridOpacity(useGameStore.getState().gridOpacity);

      // All placements done -- notify Game (floor transition) or just show terrain (initial load)
      if (this.ctx.onDungeonReadyCb) {
        this.ctx.onDungeonReadyCb();
        this.ctx.onDungeonReadyCb = null;
      } else {
        this.ctx.group.visible = true;
      }
    });
  }

  // ── Grid opacity helper (for async callback) ───────────────────

  private setGridOpacity(opacity: number): void {
    this.ctx.group.traverse((obj) => {
      if (obj instanceof THREE.LineSegments || obj instanceof THREE.Line) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of mats) {
          if (mat instanceof THREE.LineBasicMaterial) {
            mat.transparent = true;
            mat.opacity = opacity;
            mat.visible = opacity > 0.01;
          }
        }
      }
    });
  }

  // ── Dungeon lifecycle callbacks ─────────────────────────────────

  /** Register a callback that fires once all dungeon placements are done (layout + props + portals). */
  setOnDungeonReady(cb: (() => void) | null): void {
    this.ctx.onDungeonReadyCb = cb;
  }

  /** Set callback to run when voxel dungeon prop chests are placed (so Game can register them with ChestSystem). */
  setPropChestRegistrar(cb: ((list: { position: THREE.Vector3; mesh: THREE.Mesh; entity: Entity; openGeo?: THREE.BufferGeometry; variantId: string }[]) => void) | null): void {
    this.ctx.propChestRegistrar = cb;
  }

  /** Re-fire the prop chest registrar with existing prop chests (for HMR reuse). */
  reregisterPropChests(): void {
    if (this.ctx.propChestRegistrar && this.ctx.propSystem) {
      const chests = this.ctx.propSystem.getInteractiveChests();
      if (chests.length > 0) this.ctx.propChestRegistrar(chests);
    }
  }

  /** Show or hide voxel dungeon room name labels (e.g. from settings toggle). */
  setRoomLabelsVisible(visible: boolean): void {
    this.ctx.propSystem?.setRoomLabelsVisible(visible);
    // Toggle debug grid coordinate labels
    const labelGroup = this.ctx.group.getObjectByName('debugGridLabels');
    if (labelGroup) labelGroup.visible = visible;
  }

  // ── Accessor / forwarding methods ───────────────────────────────

  /** Get the door system (for update calls from Game.ts) */
  getDoorSystem(): DoorSystem | null {
    return this.ctx.doorSystem;
  }

  /** Number of rooms in the dungeon (0 for non-dungeon presets). */
  getRoomCount(): number {
    return this.ctx._roomCount;
  }

  getRoomVisibility(): RoomVisibility | null {
    return this.ctx.roomVisibility;
  }

  /** Door center world positions + orientation (for frenzy spawn positioning) */
  getDoorCenters(): { x: number; z: number; orientation: 'NS' | 'EW' }[] {
    return this.ctx.doorCenters;
  }

  /** World position where the player should spawn (cell center, in front of portal). */
  getEntrancePosition(): THREE.Vector3 | null {
    return this.ctx.propSystem?.getEntrancePosition() ?? this.ctx.entranceRoomCenter;
  }

  /** World position of the entrance portal wall (trigger point). */
  getEntrancePortalPosition(): THREE.Vector3 | null {
    return this.ctx.propSystem?.getEntrancePortalPosition() ?? null;
  }

  /** Y rotation the entrance faces (into the room). */
  getEntranceFacing(): number {
    return this.ctx.propSystem?.getEntranceFacing() ?? 0;
  }

  /** World position where the player should spawn (cell center, in front of exit). */
  getExitPosition(): THREE.Vector3 | null {
    return this.ctx.propSystem?.getExitPosition() ?? this.ctx.exitRoomCenter;
  }

  /** World position of the exit portal wall (trigger point). */
  getExitPortalPosition(): THREE.Vector3 | null {
    return this.ctx.propSystem?.getExitPortalPosition() ?? null;
  }

  /** Unit vector [dx, dz] pointing toward the exit wall. */
  getExitWallDir(): [number, number] {
    return this.ctx.propSystem?.getExitWallDir() ?? [0, 0];
  }

  /** Get nearest door center if character is within range and moving toward it.
   *  Returns the door center world position and perpendicular correction axis, or null. */
  getNearbyDoor(x: number, z: number, moveX: number, moveZ: number, range: number): { cx: number; cz: number; corrAxis: 'x' | 'z' } | null {
    let bestDist = range * range;
    let best: typeof this.ctx.doorCenters[0] | null = null;
    for (const d of this.ctx.doorCenters) {
      const ddx = x - d.x;
      const ddz = z - d.z;
      const distSq = ddx * ddx + ddz * ddz;
      if (distSq < bestDist) {
        bestDist = distSq;
        best = d;
      }
    }
    if (!best) return null;
    // Only steer if moving roughly toward the door (dot > 0)
    const toDoorX = best.x - x;
    const toDoorZ = best.z - z;
    const dot = toDoorX * moveX + toDoorZ * moveZ;
    if (dot < 0.01) return null;
    // NS door = corridor runs N-S, passage is along X -> correct Z toward center
    // EW door = corridor runs E-W, passage is along Z -> correct X toward center
    return { cx: best.x, cz: best.z, corrAxis: best.orientation === 'NS' ? 'z' : 'x' };
  }

  /** Objects to exclude from projectile raycasts (e.g. open doors). */
  getOpenDoorObjects(): THREE.Object3D[] {
    return this.ctx.doorSystem?.getOpenDoorObjects() ?? [];
  }

  /** Update prop animations (torch flickering etc.) -- call once per frame. */
  updateProps(dt: number, playerPos?: THREE.Vector3): void {
    this.ctx.propSystem?.update(dt, playerPos);
  }

  /** Get the dungeon prop system (if any) -- used by PropDestructionSystem */
  getPropSystem(): DungeonPropSystem | null {
    return this.ctx.propSystem;
  }

  /** Unblock nav cell at a world position (e.g. after destroying a prop) and remove its debris box. */
  unblockPropAt(wx: number, wz: number): void {
    if (this.ctx.navGrid) {
      const cell = this.ctx.navGrid.worldToGrid(wx, wz);
      this.ctx.navGrid.unblockCells([cell]);
    }
    // Remove matching prop debris box
    for (let i = this.ctx.debris.length - 1; i >= 0; i--) {
      const d = this.ctx.debris[i];
      if (d.isProp && Math.abs(d.x - wx) < 0.3 && Math.abs(d.z - wz) < 0.3) {
        this.ctx.debris.splice(i, 1);
        break;
      }
    }
  }

  /** Check if a world position is on an open dungeon cell (structural walls only, ignores props). */
  isOpenCell(wx: number, wz: number): boolean {
    if (!this.ctx.walkMask) return true; // no dungeon -- everything is open
    const { openGrid, gridW, gridD, cellSize } = this.ctx.walkMask;
    const halfW = this.ctx.effectiveGroundSize / 2;
    const gx = Math.floor((wx + halfW) / cellSize);
    const gz = Math.floor((wz + halfW) / cellSize);
    if (gx < 0 || gx >= gridW || gz < 0 || gz >= gridD) return false;
    return openGrid[gz * gridW + gx];
  }

  /** Get world positions of all level transitions (stairs + ladders) for spawn exclusion zones */
  getLevelTransitionPositions(): { x: number; z: number }[] {
    const positions: { x: number; z: number }[] = [];
    const halfW = this.ctx.effectiveGroundSize > 0 ? this.ctx.effectiveGroundSize / 2 : this.ctx.groundSize / 2;
    const cs = this.ctx.dungeonCellSize;
    // Stair positions (grid -> world)
    if (cs > 0) {
      for (const s of this.ctx.stairMap.values()) {
        positions.push({ x: s.gx * cs - halfW + cs / 2, z: s.gz * cs - halfW + cs / 2 });
      }
    }
    // Ladder positions (already in world coords)
    for (const ld of this.ctx.ladderDefs) {
      positions.push({ x: ld.bottomX, z: ld.bottomZ });
      positions.push({ x: ld.highWorldX, z: ld.highWorldZ });
    }
    return positions;
  }
}
