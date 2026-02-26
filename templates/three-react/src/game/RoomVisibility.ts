// ── Room-Based Visibility System ────────────────────────────────────
// Cell-level flood-fill through open tiles. Stop at closed doors.
// Active rooms: fully lit. Visited: dimmed. Hidden: invisible.

import * as THREE from 'three';
import type { DoorDef } from './DungeonGenerator';
import type { DoorSystem } from './Door';

export class RoomVisibility {
  private roomOwnership: number[];
  private openGrid: boolean[];
  private gridW: number;
  private gridD: number;
  private cellSize: number;
  private halfWorld: number;

  // Door cell lookup: cellIndex → door index in DoorSystem
  private doorCellMap = new Map<number, number>();


  // State
  readonly visitedRooms = new Set<number>();
  readonly activeRooms = new Set<number>();
  private prevActiveKey = '';

  // Mesh tracking: roomId → list of objects
  private roomObjects = new Map<number, THREE.Object3D[]>();

  // Material pairs: original → dim clone
  private dimClones = new Map<THREE.Material, THREE.Material>();

  // Track original material per mesh for swapping
  private originalMaterials = new Map<THREE.Object3D, THREE.Material>();

  // All registered objects (for hiding unprocessed ones)
  private allRegistered = new Set<THREE.Object3D>();

  constructor(
    roomOwnership: number[],
    openGrid: boolean[],
    gridW: number,
    gridD: number,
    cellSize: number,
    groundSize: number,
    gridDoors: DoorDef[],
  ) {
    this.roomOwnership = roomOwnership;
    this.openGrid = openGrid;
    this.gridW = gridW;
    this.gridD = gridD;
    this.cellSize = cellSize;
    this.halfWorld = groundSize / 2;

    // Build door cell map for flood-fill
    for (let di = 0; di < gridDoors.length; di++) {
      const door = gridDoors[di];
      const gx = Math.round(door.x);
      const gz = Math.round(door.z);
      this.doorCellMap.set(gz * gridW + gx, di);
    }
  }

  private getOwnership(gx: number, gz: number): number | undefined {
    if (gx < 0 || gx >= this.gridW || gz < 0 || gz >= this.gridD) return undefined;
    return this.roomOwnership[gz * this.gridW + gx];
  }

  /** Register a mesh (or group) under one or more room IDs */
  registerMesh(obj: THREE.Object3D, roomIds: number[]): void {
    this.allRegistered.add(obj);
    for (const id of roomIds) {
      if (id === -1) continue; // skip unowned
      let list = this.roomObjects.get(id);
      if (!list) {
        list = [];
        this.roomObjects.set(id, list);
      }
      list.push(obj);
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

  /** Main update — cell-level flood-fill, stop at closed doors */
  update(playerWX: number, playerWZ: number, doorSystem: DoorSystem | null): void {
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

        // Closed door blocks flood-fill
        const doorIdx = this.doorCellMap.get(nidx);
        if (doorIdx !== undefined && doorSystem && !doorSystem.isDoorOpen(doorIdx)) {
          continue;
        }

        reached.add(nidx);
        queue.push(nidx);
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
    // Objects in multiple rooms use the best state across all their rooms.
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

    for (const [obj, state] of objState) {
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
    // (e.g. doors whose connected rooms are all unowned/-1)
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
    this.allRegistered.clear();
    this.originalMaterials.clear();
    this.visitedRooms.clear();
    this.activeRooms.clear();
    this.prevActiveKey = '';
  }
}
