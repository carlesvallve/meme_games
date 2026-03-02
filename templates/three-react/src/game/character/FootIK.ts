/**
 * Poor-man's Foot IK — deforms the bottom slice of voxel vertices to conform
 * to the terrain surface beneath each foot, giving a grounded look on slopes
 * without real IK bones.
 *
 * Usage:
 *   const footIK = new FootIK(terrain);
 *   footIK.build(voxCharacterData);           // once, after skin load
 *   footIK.apply(mesh, groundY);              // every frame, after animation
 */
import * as THREE from 'three';
import type { Environment } from '../environment';
import type { VoxCharacterData } from '../../utils/VoxModelLoader';

// ── Constants ────────────────────────────────────────────────────────

/** Height (in local space) below which vertices are treated as "foot" voxels */
const BLEND_HEIGHT = 0.12;
/** Max terrain-delta offset applied to foot vertices */
const MAX_DELTA = 0.1;
/** Per-vertex: max height jump between a vertex's terrain sample and a tiny
 *  nudge sample. Detects discontinuities (steps) but not slopes. */
const DISCONTINUITY = 0.06;
/** Nudge distance for discontinuity detection */
const NUDGE = 0.03;

// ── Types ────────────────────────────────────────────────────────────

interface VertexData {
  indices: Uint16Array; // vertex indices in position attribute
  originalX: Float32Array; // local X (for world-space rotation)
  originalY: Float32Array; // local Y (to restore before re-deforming)
  originalZ: Float32Array; // local Z (for world-space rotation)
  weights: Float32Array; // blend: 1.0 at Y=0, tapering to 0.0 at BLEND_HEIGHT
}

// ── FootIK class ─────────────────────────────────────────────────────

export class FootIK {
  private map: Map<THREE.BufferGeometry, VertexData> | null = null;
  private terrain: Environment;

  constructor(terrain: Environment) {
    this.terrain = terrain;
  }

  /** Build per-geometry foot vertex data from all geometries in a VOX character. */
  build(data: VoxCharacterData): void {
    const map = new Map<THREE.BufferGeometry, VertexData>();
    const geos = new Set<THREE.BufferGeometry>();
    geos.add(data.base);
    for (const frames of Object.values(data.frames)) {
      for (const geo of frames) {
        if (geo) geos.add(geo);
      }
    }
    for (const geo of geos) {
      const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
      if (!posAttr) continue;
      const count = posAttr.count;
      const tmpIndices: number[] = [];
      for (let i = 0; i < count; i++) {
        if (posAttr.getY(i) < BLEND_HEIGHT) tmpIndices.push(i);
      }
      if (tmpIndices.length === 0) continue;
      const n = tmpIndices.length;
      const indices = new Uint16Array(n);
      const originalX = new Float32Array(n);
      const originalY = new Float32Array(n);
      const originalZ = new Float32Array(n);
      const weights = new Float32Array(n);
      for (let j = 0; j < n; j++) {
        const idx = tmpIndices[j];
        indices[j] = idx;
        originalX[j] = posAttr.getX(idx);
        originalY[j] = posAttr.getY(idx);
        originalZ[j] = posAttr.getZ(idx);
        weights[j] = 1 - originalY[j] / BLEND_HEIGHT;
      }
      map.set(geo, { indices, originalX, originalY, originalZ, weights });
    }
    this.map = map.size > 0 ? map : null;
  }

  /** Clear foot IK data (e.g. when disposing or swapping skins). */
  clear(): void {
    this.map = null;
  }

  /** Returns true if foot IK data has been built. */
  get ready(): boolean {
    return this.map !== null;
  }

  /**
   * Apply foot IK deformation to the current mesh geometry.
   * Call once per frame, after animation frame swap.
   *
   * @param mesh      The character mesh (geometry + position + rotation)
   * @param groundY   The character's logical ground Y (center terrain height)
   */
  apply(mesh: THREE.Mesh, groundY: number): void {
    if (!this.map) return;
    const ikData = this.map.get(mesh.geometry as THREE.BufferGeometry);
    if (!ikData) return;

    const posAttr = mesh.geometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    const { indices, originalX, originalY, originalZ, weights } = ikData;

    // Mesh Y-rotation: rotate local vertex XZ to world space
    const angle = mesh.rotation.y;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const cx = mesh.position.x;
    const cz = mesh.position.z;
    const meshWorldY = mesh.position.y;
    const n = indices.length;

    // Always restore original Y first so geometries are never left deformed
    for (let j = 0; j < n; j++) {
      posAttr.setY(indices[j], originalY[j]);
    }
    posAttr.needsUpdate = true;

    // Sample terrain at every foot vertex; detect discontinuities via nudge.
    // A slope has smooth gradients; a step has a sudden height jump over a
    // tiny distance. If any vertex detects a step edge, skip IK entirely.
    const terrainSamples = new Float32Array(n);
    for (let j = 0; j < n; j++) {
      const lx = originalX[j];
      const lz = originalZ[j];
      const worldX = cx + lx * cos + lz * sin;
      const worldZ = cz - lx * sin + lz * cos;
      const tY = this.terrain.getTerrainY(worldX, worldZ);
      terrainSamples[j] = tY;

      // 4 tiny nudges around this vertex to detect discontinuity
      const t1 = this.terrain.getTerrainY(worldX + NUDGE, worldZ);
      const t2 = this.terrain.getTerrainY(worldX - NUDGE, worldZ);
      const t3 = this.terrain.getTerrainY(worldX, worldZ + NUDGE);
      const t4 = this.terrain.getTerrainY(worldX, worldZ - NUDGE);
      if (
        Math.abs(t1 - tY) > DISCONTINUITY ||
        Math.abs(t2 - tY) > DISCONTINUITY ||
        Math.abs(t3 - tY) > DISCONTINUITY ||
        Math.abs(t4 - tY) > DISCONTINUITY
      ) {
        return; // step detected — originals already restored
      }
    }

    // All clear — apply deformation
    for (let j = 0; j < n; j++) {
      let delta = terrainSamples[j] - meshWorldY;
      if (delta > MAX_DELTA) delta = MAX_DELTA;
      else if (delta < -MAX_DELTA) delta = -MAX_DELTA;
      posAttr.setY(indices[j], originalY[j] + delta * weights[j]);
    }
    posAttr.needsUpdate = true;
  }
}
