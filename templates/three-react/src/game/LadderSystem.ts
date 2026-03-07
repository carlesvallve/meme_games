import * as THREE from 'three';
import type { NavGrid } from './pathfinding/NavGrid';
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

/**
 * LadderSystem — runtime ladder management.
 * Owns ladder definitions, meshes, and nav-link registration.
 * Use placeLadder() to add individual ladders (called by LadderGenerator or any other source).
 */
export class LadderSystem {
  ladders: LadderDef[] = [];
  private meshes: THREE.Group[] = [];
  private mat: THREE.MeshStandardMaterial;
  private cellSize = 0.5;

  constructor(private scene: THREE.Scene) {
    this.mat = new THREE.MeshStandardMaterial({
      color: LADDER_COLOR,
      roughness: 0.8,
      metalness: 0.1,
    });
  }

  /** Place a ladder between a low cell and a high cell.
   *  Creates the mesh, registers a bidirectional nav-link, and stores the LadderDef. */
  placeLadder(
    navGrid: NavGrid,
    lowGX: number, lowGZ: number, lowWorldX: number, lowWorldZ: number, lowH: number,
    highGX: number, highGZ: number, highWorldX: number, highWorldZ: number, highH: number,
  ): LadderDef {
    this.cellSize = navGrid.cellSize;

    const fdx = highWorldX - lowWorldX;
    const fdz = highWorldZ - lowWorldZ;
    const flen = Math.sqrt(fdx * fdx + fdz * fdz);
    const nfdx = flen > 0 ? fdx / flen : 0;
    const nfdz = flen > 0 ? fdz / flen : 0;

    const ladderDef: LadderDef = {
      bottomX: lowWorldX,
      bottomZ: lowWorldZ,
      bottomY: lowH,
      topY: highH,
      facingDX: nfdx,
      facingDZ: nfdz,
      lowWorldX, lowWorldZ,
      highWorldX, highWorldZ,
      lowCellGX: lowGX, lowCellGZ: lowGZ,
      highCellGX: highGX, highCellGZ: highGZ,
    };

    const ladderIndex = this.ladders.length;
    this.ladders.push(ladderDef);
    // Cost scales with height: vertical cells * slight penalty + 1 for entry.
    // Slightly more expensive per cell than stairs so A* prefers stairs when both exist.
    const verticalCells = Math.abs(highH - lowH) / navGrid.cellSize;
    const cost = verticalCells * LADDER_COST + 1;
    navGrid.addNavLink(lowGX, lowGZ, highGX, highGZ, cost, ladderIndex);
    this.createLadderMesh(ladderDef);
    return ladderDef;
  }

  private createLadderMesh(ladder: LadderDef): void {
    const group = new THREE.Group();
    const dy = ladder.topY - ladder.bottomY;
    const ladderLength = dy;
    const rungCount = Math.max(1, Math.floor(ladderLength / LADDER_RUNG_SPACING)) * 2;
    const cellSize = this.cellSize;

    // Yaw: ladder faces INTO the wall (toward high cell)
    const yaw = Math.atan2(ladder.facingDX, ladder.facingDZ);

    // Perpendicular direction for rail offset
    const perpDX = -ladder.facingDZ;
    const perpDZ = ladder.facingDX;

    // Ladder stands on the LOW (walkable) cell, flush against the wall of the high cell.
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
