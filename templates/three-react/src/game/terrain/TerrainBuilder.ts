/**
 * TerrainBuilder — thin facade that delegates to feature-specific sub-modules.
 *
 * Sub-modules (each exclusive to certain preset groups):
 *  - WaterSystem       shared — water/floor plane across all non-dungeon presets
 *  - HeightmapBuilder  `heightmap` only — noise mesh, slopes, ladders, nature
 *  - BoxPlacer         `scattered`/`terraced` only — boxy debris and wedge ramps
 *
 * All sub-modules share mutable state through EnvironmentContext.
 * Consumer code (Environment, Game) only interacts with TerrainBuilder;
 * the internal split is transparent.
 *
 * Also exports grid-snap helpers used across terrain modules:
 *  - HALF, snapHalf(), snapPos()
 */

import * as THREE from 'three';
import { useGameStore } from '../../store';
import { EnvironmentContext } from '../environment/EnvironmentContext';
import { WaterSystem } from './WaterSystem';
import { HeightmapBuilder } from './HeightmapBuilder';
import { BoxPlacer } from './BoxPlacer';

// ── Exported helpers ─────────────────────────────────────────────────

export const HALF = 0.25;
export function snapHalf(v: number): number { return Math.max(HALF, Math.round(v / HALF) * HALF); }
/** Snap position so that box edges align to HALF boundaries given its half-size */
export function snapPos(v: number, halfSize: number): number {
  const edge = Math.round((v - halfSize) / HALF) * HALF;
  return edge + halfSize;
}

// ── TerrainBuilder (facade) ──────────────────────────────────────────

export class TerrainBuilder {
  private ctx: EnvironmentContext;
  private water: WaterSystem;
  private heightmap: HeightmapBuilder;
  private boxPlacer: BoxPlacer;

  constructor(ctx: EnvironmentContext, getTerrainY: (x: number, z: number, radius?: number) => number) {
    this.ctx = ctx;
    this.water = new WaterSystem(ctx);
    this.heightmap = new HeightmapBuilder(ctx, getTerrainY, this.water);
    this.boxPlacer = new BoxPlacer(ctx, getTerrainY);
  }

  // ── Water forwarding ──────────────────────────────────────────────

  getWaterY(): number { return this.water.getWaterY(); }
  createGround(): void { this.water.createGround(); }
  createHeightmapWater(): void { this.water.createHeightmapWater(); }
  updateWater(dt: number, renderer?: THREE.WebGLRenderer, scene?: THREE.Scene, camera?: THREE.Camera): void {
    this.water.updateWater(dt, renderer, scene, camera);
  }

  // ── Heightmap forwarding ──────────────────────────────────────────

  applyPalette(pal: typeof this.ctx.palette, name: string): void { this.heightmap.applyPalette(pal, name); }
  createHeightmapMesh(): void { this.heightmap.createHeightmapMesh(); }
  generateNatureElements(extraExclusions?: { x: number; z: number; r: number }[]): void { this.heightmap.generateNatureElements(extraExclusions); }
  createLadderMeshes(): void { this.heightmap.createLadderMeshes(); }
  createSingleLadderMesh(li: number): void { this.heightmap.createSingleLadderMesh(li); }
  remesh(): void {
    this.heightmap.remesh();
    this.setGridOpacity(useGameStore.getState().gridOpacity);
  }

  // ── Box placement forwarding ──────────────────────────────────────

  createScatteredDebris(): void { this.boxPlacer.createScatteredDebris(); }
  placeBox(x: number, z: number, w: number, d: number, h: number, skipZFight = false): boolean {
    return this.boxPlacer.placeBox(x, z, w, d, h, skipZFight);
  }

  // ── Grid (small enough to keep here) ──────────────────────────────

  setGridOpacity(opacity: number): void {
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

  createGridLines(): void {
    const gridOpacity = useGameStore.getState().gridOpacity;
    const grid = new THREE.GridHelper(this.ctx.groundSize, this.ctx.groundSize / HALF, 0x444466, 0x333355);
    grid.position.y = 0.01;
    const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const mat of mats) {
      mat.transparent = true;
      mat.opacity = gridOpacity;
      mat.depthWrite = false;
    }
    this.ctx.group.add(grid);
  }
}
