// ── Room-Based Visibility System ────────────────────────────────────
// Cell-level flood-fill through open tiles. Stop at closed doors.
// Active rooms: fully lit. Visited: dimmed. Hidden: invisible.

import * as THREE from 'three';
import type { DoorDef } from './DungeonGenerator';
import type { DoorSystem } from './Door';

/** Max flood-fill radius from player in grid cells (~7.5m with cellSize=0.75) */
const MAX_FLOOD_DIST_SQ = 10 * 10;

export class RoomVisibility {
  private roomOwnership: number[];
  private openGrid: boolean[];
  private gridW: number;
  private gridD: number;
  private cellSize: number;
  private halfWorld: number;
  private cellHeights: Float32Array | null = null;
  private heightThreshold: number;
  private stairCells: Set<number>;

  // Ladder peek: when player is near top and facing toward it, reveal bottom area
  private ladderPeeks: { topIdx: number; bottomIdx: number; dirX: number; dirZ: number }[] = [];

  // Door cell lookup: cellIndex → door index in DoorSystem
  private doorCellMap = new Map<number, number>();

  // State
  readonly visitedRooms = new Set<number>();
  readonly activeRooms = new Set<number>();
  private prevActiveKey = '';

  // Mesh tracking: roomId → list of objects
  private roomObjects = new Map<number, THREE.Object3D[]>();

  // Active-only room registrations: these room IDs can promote an object to
  // 'active' but never to 'visited'. Used for stair peek tiles — visible when
  // the lower level is active, but dimmed once the upper level has been visited.
  private activeOnlyRoomObjects = new Map<number, THREE.Object3D[]>();

  // Material pairs: original → dim clone
  private dimClones = new Map<THREE.Material, THREE.Material>();

  // Track original material per mesh for swapping
  private originalMaterials = new Map<THREE.Object3D, THREE.Material>();

  // All registered objects (for hiding unprocessed ones)
  private allRegistered = new Set<THREE.Object3D>();

  // Cell count per visibility area (roomId → number of open cells)
  readonly cellsPerArea = new Map<number, number>();

  constructor(
    roomOwnership: number[],
    openGrid: boolean[],
    gridW: number,
    gridD: number,
    cellSize: number,
    groundSize: number,
    gridDoors: DoorDef[],
    cellHeights?: Float32Array,
    heightThreshold = 0.4,
    stairCells?: Set<number>,
  ) {
    this.roomOwnership = roomOwnership;
    this.openGrid = openGrid;
    this.gridW = gridW;
    this.gridD = gridD;
    this.cellSize = cellSize;
    this.halfWorld = groundSize / 2;
    this.cellHeights = cellHeights ?? null;
    this.heightThreshold = heightThreshold;
    this.stairCells = stairCells ?? new Set();

    // Build door cell map for flood-fill
    for (let di = 0; di < gridDoors.length; di++) {
      const door = gridDoors[di];
      const gx = Math.round(door.x);
      const gz = Math.round(door.z);
      this.doorCellMap.set(gz * gridW + gx, di);
    }

    // Count open cells per visibility area
    for (let i = 0; i < roomOwnership.length; i++) {
      const rid = roomOwnership[i];
      if (rid === -1 || !openGrid[i]) continue;
      this.cellsPerArea.set(rid, (this.cellsPerArea.get(rid) ?? 0) + 1);
    }
  }

  /** Register a ladder peek: when player is near top and facing toward it, reveal bottom area.
   *  dirX/dirZ: direction from top cell toward bottom cell (in grid space). */
  addLadderLink(topCellIdx: number, bottomCellIdx: number): void {
    const topGX = topCellIdx % this.gridW;
    const topGZ = (topCellIdx - topGX) / this.gridW;
    const botGX = bottomCellIdx % this.gridW;
    const botGZ = (bottomCellIdx - botGX) / this.gridW;
    const dx = botGX - topGX, dz = botGZ - topGZ;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    this.ladderPeeks.push({ topIdx: topCellIdx, bottomIdx: bottomCellIdx, dirX: dx / len, dirZ: dz / len });
    this.prevActiveKey = ''; // force re-apply
  }

  /** Register a mesh (or group) under one or more room IDs.
   *  @param activeOnlyIds Optional extra room IDs that can only promote to 'active',
   *  never to 'visited'. Used for stair peek tiles. */
  registerMesh(obj: THREE.Object3D, roomIds: number[], activeOnlyIds?: number[]): void {
    this.allRegistered.add(obj);
    this.prevActiveKey = ''; // force re-apply on next update
    for (const id of roomIds) {
      if (id === -1) continue;
      let list = this.roomObjects.get(id);
      if (!list) {
        list = [];
        this.roomObjects.set(id, list);
      }
      list.push(obj);
    }
    if (activeOnlyIds) {
      for (const id of activeOnlyIds) {
        if (id === -1) continue;
        let list = this.activeOnlyRoomObjects.get(id);
        if (!list) {
          list = [];
          this.activeOnlyRoomObjects.set(id, list);
        }
        list.push(obj);
      }
    }
    this.storeOriginalMaterials(obj);
  }

  private storeOriginalMaterials(obj: THREE.Object3D): void {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      if (!this.originalMaterials.has(mesh)) {
        this.originalMaterials.set(mesh, mesh.material as THREE.Material);
      }
    }
    for (const child of obj.children) {
      this.storeOriginalMaterials(child);
    }
  }

  /** Get or create a dimmed clone of a material */
  private getDimMaterial(mat: THREE.Material): THREE.Material {
    let dim = this.dimClones.get(mat);
    if (!dim) {
      dim = mat.clone();
      if ((dim as THREE.MeshStandardMaterial).color) {
        (dim as THREE.MeshStandardMaterial).color.multiplyScalar(0.3);
      }
      if ((dim as THREE.MeshStandardMaterial).emissive) {
        (dim as THREE.MeshStandardMaterial).emissive.set(0x000000);
      }
      this.dimClones.set(mat, dim);
    }
    return dim;
  }

  /** Convert world position to room ID */
  getRoomAtWorld(wx: number, wz: number): number {
    const gx = Math.floor((wx + this.halfWorld) / this.cellSize);
    const gz = Math.floor((wz + this.halfWorld) / this.cellSize);
    if (gx < 0 || gx >= this.gridW || gz < 0 || gz >= this.gridD) return -1;
    return this.roomOwnership[gz * this.gridW + gx];
  }

  /** Check if a world position is in an active (fully visible) room */
  isPositionActive(wx: number, wz: number): boolean {
    const rid = this.getRoomAtWorld(wx, wz);
    return rid !== -1 && this.activeRooms.has(rid);
  }

  /** Check if a world position is in a visible (active or visited) room */
  isPositionVisible(wx: number, wz: number): boolean {
    const rid = this.getRoomAtWorld(wx, wz);
    return rid !== -1 && (this.activeRooms.has(rid) || this.visitedRooms.has(rid));
  }

  /** Main update — cell-level flood-fill, stop at closed doors.
   *  playerFacing: angle in radians (0 = -Z, like Three.js Y rotation). */
  update(playerWX: number, playerWZ: number, doorSystem: DoorSystem | null, playerFacing = 0): void {
    const { roomOwnership, openGrid, gridW, gridD, cellSize, halfWorld } = this;

    // Player grid position
    const pgx = Math.floor((playerWX + halfWorld) / cellSize);
    const pgz = Math.floor((playerWZ + halfWorld) / cellSize);
    if (pgx < 0 || pgx >= gridW || pgz < 0 || pgz >= gridD) return;

    const startIdx = pgz * gridW + pgx;
    if (!openGrid[startIdx]) return;

    // Cell-level flood-fill from player
    const reached = new Set<number>();
    const queue: number[] = [startIdx];
    reached.add(startIdx);

    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];

    while (queue.length > 0) {
      const idx = queue.pop()!;
      const gx = idx % gridW;
      const gz = (idx - gx) / gridW;

      for (const [dx, dz] of dirs) {
        const nx = gx + dx, nz = gz + dz;
        if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
        const nidx = nz * gridW + nx;
        if (reached.has(nidx)) continue;
        if (!openGrid[nidx]) continue;

        // // Max distance from player (in grid cells) — disabled, height-based blocking handles visibility
        // const distSq = (nx - pgx) * (nx - pgx) + (nz - pgz) * (nz - pgz);
        // if (distSq > MAX_FLOOD_DIST_SQ) continue;
        //

        // Door cell: blocks expansion if closed, but still mark as reached
        // so the door's floor tile and mesh stay visible to the player.
        const doorIdx = this.doorCellMap.get(nidx);
        if (doorIdx !== undefined) {
          if (!doorSystem || !doorSystem.isDoorOpen(doorIdx)) {
            reached.add(nidx); // show door + floor, but don't expand through
            continue;
          }
        }

        // Height boundary: blocks flood-fill at large height differences
        if (this.cellHeights) {
          const hDiff = Math.abs(this.cellHeights[nidx] - this.cellHeights[idx]);
          if (hDiff > this.heightThreshold) continue;
        }

        reached.add(nidx);
        queue.push(nidx);
      }

    }

    // Ladder peek: if player is adjacent to a ladder top and facing toward it,
    // do a limited flood-fill from the bottom to reveal the area below
    if (this.ladderPeeks.length > 0) {
      const faceDirX = -Math.sin(playerFacing);
      const faceDirZ = -Math.cos(playerFacing);
      const PEEK_RADIUS_SQ = 6 * 6; // max cells from ladder bottom to reveal

      for (const peek of this.ladderPeeks) {
        const topGX = peek.topIdx % gridW;
        const topGZ = (peek.topIdx - topGX) / gridW;

        // Player must be within 1 cell of ladder top
        const dpx = pgx - topGX, dpz = pgz - topGZ;
        if (dpx * dpx + dpz * dpz > 2) continue; // > ~1.4 cells away

        // Player must be facing toward the ladder (dot product with top→bottom direction)
        const dot = faceDirX * peek.dirX + faceDirZ * peek.dirZ;
        if (dot < 0.5) continue; // not facing toward ladder

        // Mini flood-fill from ladder bottom, limited radius
        const botGX = peek.bottomIdx % gridW;
        const botGZ = (peek.bottomIdx - botGX) / gridW;
        if (!openGrid[peek.bottomIdx]) continue;

        const miniQueue: number[] = [peek.bottomIdx];
        if (!reached.has(peek.bottomIdx)) reached.add(peek.bottomIdx);

        while (miniQueue.length > 0) {
          const idx = miniQueue.pop()!;
          const gx = idx % gridW;
          const gz = (idx - gx) / gridW;

          for (const [dx, dz] of dirs) {
            const nx = gx + dx, nz = gz + dz;
            if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridD) continue;
            const nidx = nz * gridW + nx;
            if (reached.has(nidx)) continue;
            if (!openGrid[nidx]) continue;

            // Limit radius from ladder bottom
            const distSq = (nx - botGX) * (nx - botGX) + (nz - botGZ) * (nz - botGZ);
            if (distSq > PEEK_RADIUS_SQ) continue;

            // Door check
            const doorIdx = this.doorCellMap.get(nidx);
            if (doorIdx !== undefined) {
              if (!doorSystem || !doorSystem.isDoorOpen(doorIdx)) {
                reached.add(nidx);
                continue;
              }
            }

            // Height check (stay at bottom level)
            if (this.cellHeights) {
              const hDiff = Math.abs(this.cellHeights[nidx] - this.cellHeights[idx]);
              if (hDiff > this.heightThreshold) continue;
            }

            reached.add(nidx);
            miniQueue.push(nidx);
          }
        }
      }
    }

    // Extract active rooms from reached cells
    const newActive = new Set<number>();
    for (const idx of reached) {
      const rid = roomOwnership[idx];
      if (rid !== -1) newActive.add(rid);
    }

    // Build key to check if anything changed
    const sorted = [...newActive].sort((a, b) => a - b);
    const key = sorted.join(',');
    if (key === this.prevActiveKey) return;
    this.prevActiveKey = key;

    this.activeRooms.clear();
    for (const r of newActive) this.activeRooms.add(r);

    // Mark all active rooms as visited
    for (const r of newActive) this.visitedRooms.add(r);

    // Compute best visibility state per object (active > visited > hidden).
    const objState = new Map<THREE.Object3D, 'active' | 'visited' | 'hidden'>();

    for (const [roomId, objects] of this.roomObjects) {
      const isActive = this.activeRooms.has(roomId);
      const isVisited = this.visitedRooms.has(roomId);
      const state = isActive ? 'active' : isVisited ? 'visited' : 'hidden';

      for (const obj of objects) {
        const prev = objState.get(obj);
        if (!prev || state === 'active' || (state === 'visited' && prev === 'hidden')) {
          objState.set(obj, state);
        }
      }
    }

    // Active-only rooms: can only promote hidden→active, never hidden→visited.
    // Used for stair peek tiles — visible from below only when actively there.
    for (const [roomId, objects] of this.activeOnlyRoomObjects) {
      if (!this.activeRooms.has(roomId)) continue; // only contributes when active
      for (const obj of objects) {
        const prev = objState.get(obj);
        if (!prev || prev === 'hidden') {
          objState.set(obj, 'active');
        }
      }
    }

    for (const [obj, state] of objState) {
      // Respect per-object disable flags (e.g. room labels toggled off in settings)
      if (obj.userData.labelsDisabled) { obj.visible = false; continue; }
      if (state === 'active') {
        obj.visible = true;
        this.setMeshMaterial(obj, false);
      } else if (state === 'visited') {
        obj.visible = true;
        this.setMeshMaterial(obj, true);
      } else {
        obj.visible = false;
      }
    }

    // Hide any registered object not processed by objState
    for (const obj of this.allRegistered) {
      if (!objState.has(obj)) {
        obj.visible = false;
      }
    }
  }

  private setMeshMaterial(obj: THREE.Object3D, dim: boolean): void {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      const origMat = this.originalMaterials.get(mesh);
      if (origMat) {
        mesh.material = dim ? this.getDimMaterial(origMat) : origMat;
      }
    }
    // Disable lights in visited (dimmed) rooms and tag them
    if ((obj as THREE.Light).isLight) {
      obj.visible = !dim;
      obj.userData.roomDimmed = dim;
    }
    for (const child of obj.children) {
      this.setMeshMaterial(child, dim);
    }
  }

  dispose(): void {
    for (const mat of this.dimClones.values()) {
      mat.dispose();
    }
    this.dimClones.clear();
    this.roomObjects.clear();
    this.activeOnlyRoomObjects.clear();
    this.allRegistered.clear();
    this.originalMaterials.clear();
    this.visitedRooms.clear();
    this.activeRooms.clear();
    this.prevActiveKey = '';
  }
}
