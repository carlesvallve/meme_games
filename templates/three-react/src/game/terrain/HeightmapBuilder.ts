/**
 * HeightmapBuilder — noise-based heightmap terrain mesh and related visuals.
 *
 * Only used by the `heightmap` preset. Handles all continuous terrain features
 * including slope-based ramps and cliff ladders (as opposed to BoxPlacer which
 * handles the boxy `scattered`/`terraced` presets).
 *
 * Responsibilities:
 *  - createHeightmapMesh()    Generate the vertex-colored terrain surface from
 *                             TerrainNoise, including the perimeter skirt and
 *                             a 0.25m grid line overlay on steep faces.
 *  - applyPalette()           Recolor an existing heightmap mesh with a new
 *                             palette (slope-based, beach, cave tinting)
 *                             without regenerating geometry.
 *  - generateNatureElements() Spawn trees, rocks, grass via NatureGenerator
 *                             and register tree trunks as collision debris.
 *  - createLadderMeshes()     Build procedural ladder geometry at cliff edges
 *                             (vertical or leaning against the wall slope).
 *  - remesh()                 Rebuild the mesh at a different resolution scale,
 *                             keeping the same seed for identical terrain shape.
 *  - debugHeightmapCanvas()   Render a 32x32 grayscale thumbnail for the UI.
 *
 * Receives a WaterSystem reference to query water Y for beach coloring
 * and a getTerrainY callback for ladder cliff-face sampling.
 *
 * Used by TerrainBuilder facade; not called directly by consumers.
 */

import * as THREE from 'three';
import { generateHeightmap, sampleHeightmap, getHeightmapConfig } from './TerrainNoise';
import { generateNature, type NatureGeneratorResult } from './NatureGenerator';
import { paletteBiome } from './ColorPalettes';
import { useGameStore } from '../../store';
import { EnvironmentContext } from '../environment/EnvironmentContext';
import { OW_GRID } from '../overworld/OverworldTiles';
import { HALF } from './TerrainBuilder';
import type { WaterSystem } from './WaterSystem';

const DEBUG_RAMPS = false;

export class HeightmapBuilder {
  private ctx: EnvironmentContext;
  private getTerrainY: (x: number, z: number, radius?: number) => number;
  private water: WaterSystem;

  constructor(ctx: EnvironmentContext, getTerrainY: (x: number, z: number, radius?: number) => number, water: WaterSystem) {
    this.ctx = ctx;
    this.getTerrainY = getTerrainY;
    this.water = water;
  }

  /** Swap palette and recolor existing terrain mesh + water without regenerating */
  applyPalette(pal: typeof this.ctx.palette, name: string): void {
    this.ctx.palette = pal;
    this.ctx.paletteName = name;

    // Update water colors
    if (this.ctx.waterMaterial) {
      this.ctx.waterMaterial.uniforms.uShallowColor.value.set(pal.waterShallow);
      this.ctx.waterMaterial.uniforms.uDeepColor.value.set(pal.waterDeep);
    }

    // Update basic floor plane color
    if (this.ctx.preset === 'basic' && this.ctx.waterMesh) {
      const mat = this.ctx.waterMesh.material as THREE.MeshStandardMaterial;
      if (mat.color) mat.color.set(pal.flat);
    }

    // Recolor heightmap mesh vertices
    if (!this.ctx.heightmapMesh || !this.ctx.heightmapData) return;
    const geo = this.ctx.heightmapMesh.geometry;
    const colorAttr = geo.getAttribute('color') as THREE.BufferAttribute;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    if (!colorAttr || !posAttr) return;

    const heights = this.ctx.heightmapData;
    const res = this.ctx.heightmapRes;
    const groundSize = this.ctx.heightmapGroundSize;
    const maxHeight = this.ctx.heightmapMaxHeight;
    const hmCellSize = groundSize / res;
    const eps = hmCellSize * 0.5;
    const maxPassableSlope = (0.75 / hmCellSize) * 0.4;
    const waterY = this.water.getWaterY();
    const verts = res + 1;

    const colorFlat = new THREE.Color(pal.flat);
    const colorGentleSlope = new THREE.Color(pal.gentleSlope);
    const colorSteepSlope = new THREE.Color(pal.steepSlope);
    const colorCliff = new THREE.Color(pal.cliff);
    const colorSand = new THREE.Color(pal.sand);
    const colorWetSand = new THREE.Color(pal.wetSand);
    const tmpColor = new THREE.Color();

    const isCaves = this.ctx.preset === 'heightmap' && this.ctx.heightmapStyle === 'caves';
    const colorCaveFloor = (() => {
      const c = new THREE.Color(pal.flat);
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      hsl.l *= 0.28;       // darker
      hsl.s *= 0.9;
      hsl.h = (hsl.h + 0.08) % 1;  // shift toward brown/orange
      c.setHSL(hsl.h, hsl.s, hsl.l);
      return c;
    })();
    const caveFloorMaxY = maxHeight * 0.65; // most of cave volume + lower walls get tint

    for (let z = 0; z < verts; z++) {
      for (let x = 0; x < verts; x++) {
        const idx = z * verts + x;
        const hC = heights[idx];
        const wx = posAttr.getX(idx);
        const wz = posAttr.getZ(idx);

        const hL = sampleHeightmap(heights, res, groundSize, wx - eps, wz);
        const hR = sampleHeightmap(heights, res, groundSize, wx + eps, wz);
        const hU = sampleHeightmap(heights, res, groundSize, wx, wz - eps);
        const hD = sampleHeightmap(heights, res, groundSize, wx, wz + eps);

        const gx = (hR - hL) / (2 * eps);
        const gz = (hD - hU) / (2 * eps);
        const slopeMag = Math.sqrt(gx * gx + gz * gz);
        const slopeRatio = slopeMag / maxPassableSlope;

        if (slopeRatio < 0.4) {
          tmpColor.copy(colorFlat);
        } else if (slopeRatio < 0.9) {
          const t = (slopeRatio - 0.4) / 0.5;
          tmpColor.copy(colorFlat).lerp(colorGentleSlope, t);
        } else if (slopeRatio < 1.0) {
          const t = (slopeRatio - 0.9) / 0.1;
          tmpColor.copy(colorGentleSlope).lerp(colorSteepSlope, t);
        } else {
          const t = Math.min(1, (slopeRatio - 1.0) / 0.3);
          tmpColor.copy(colorSteepSlope).lerp(colorCliff, t);
        }

        const maxNeighborH = Math.max(hL, hR, hU, hD);
        const minNeighborH = Math.min(hL, hR, hU, hD);
        if (slopeRatio < 0.9) {
          const cliffAbove = maxNeighborH - hC;
          if (cliffAbove > 0.3) {
            const baseBlend = Math.min(1, (cliffAbove - 0.3) / 0.5);
            tmpColor.lerp(colorFlat, baseBlend * 0.85);
          }
        } else {
          const dropBelow = hC - minNeighborH;
          if (dropBelow < 0.4) {
            const t = 1.0 - dropBelow / 0.4;
            tmpColor.lerp(colorFlat, t * 0.9);
          }
        }

        // Per-terrace color variation
        if (slopeRatio < 0.9) {
          const terraceStep = maxHeight / Math.max(this.ctx.heightmapPosterize, 2);
          const level = Math.round(hC / Math.max(terraceStep, 0.5));
          const hsl = { h: 0, s: 0, l: 0 };
          tmpColor.getHSL(hsl);
          const hueShift = ((level % 3) - 1) * 0.025;
          const satShift = ((level % 2) === 0 ? 0.04 : -0.04);
          const lumShift = ((level % 3) - 1) * 0.03;
          hsl.h = (hsl.h + hueShift + 1) % 1;
          hsl.s = Math.max(0, Math.min(1, hsl.s + satShift));
          hsl.l = Math.max(0, Math.min(1, hsl.l + lumShift));
          tmpColor.setHSL(hsl.h, hsl.s, hsl.l);
        }

        const heightVar = 0.94 + 0.12 * (hC / Math.max(maxHeight, 1));
        tmpColor.multiplyScalar(heightVar);

        if (slopeRatio < 1.0) {
          const beachTop = waterY + 0.2;
          const beachMid = waterY + 0.04;
          const beachBot = waterY - 0.04;
          if (hC < beachTop && hC > beachBot - 0.5) {
            if (hC < beachBot) {
              const t = 1.0 - Math.min(1, (beachBot - hC) / 0.5);
              tmpColor.lerp(colorWetSand, t * 0.7);
            } else if (hC < beachMid) {
              const t = (hC - beachBot) / (beachMid - beachBot);
              const sandTarget = colorWetSand.clone().lerp(colorSand, t);
              tmpColor.lerp(sandTarget, 0.8);
            } else {
              const t = (hC - beachMid) / (beachTop - beachMid);
              tmpColor.lerp(colorSand, (1.0 - t) * 0.8);
            }
          }
        }

        // Caves: carved floor (low mesh) = brown; non-carved terraces (high) = keep palette (e.g. green)
        if (isCaves) {
          if (hC < caveFloorMaxY) {
            const t = 1 - hC / caveFloorMaxY; // 1 at floor, 0 at threshold
            tmpColor.lerp(colorCaveFloor, Math.max(0, Math.min(1, t)) * 0.95);
          }
        }

        colorAttr.setXYZ(idx, tmpColor.r, tmpColor.g, tmpColor.b);
      }
    }
    colorAttr.needsUpdate = true;
  }

  /** Generate a real heightmap mesh — single continuous grid with smooth slopes */
  createHeightmapMesh(): void {
    const config = { ...getHeightmapConfig(this.ctx.heightmapStyle) };
    const groundSize = this.ctx.groundSize - 4; // usable area (2m margin each side)
    // Scale max height proportionally to ground size so slopes stay the same steepness.
    // Configs were tuned for groundSize=46 (50 - 4 margin).
    const REF_GROUND = 46;
    config.maxHeight *= groundSize / REF_GROUND;
    const { resolutionScale } = useGameStore.getState();
    const res = Math.round(config.resolution * resolutionScale);
    const verts = res + 1;
    const cellSize = groundSize / res;
    const halfGround = groundSize / 2;

    // Generate vertex-based heightmap
    const result = generateHeightmap(config, groundSize, this.ctx.heightmapSeed, resolutionScale);
    this.ctx.heightmapSeed = result.seed;
    const heights = result.heights;
    const rampCells = result.rampCells;
    this.ctx.rampCells = rampCells;
    this.ctx.heightmapData = heights;
    // During remesh, keep original ladder defs (world positions don't change)
    if (!this.ctx.isRemeshing) {
      this.ctx.ladderDefs = result.ladders;
    }
    this.ctx.heightmapRes = res;
    this.ctx.heightmapGroundSize = groundSize;
    this.ctx.heightmapMaxHeight = config.maxHeight;
    this.ctx.heightmapPosterize = config.posterize || 4;

    // Stitch edges with neighbor tiles (if coming from overworld)
    this.stitchWithNeighbors(heights, res, groundSize, resolutionScale);

    // Debug: render heightmap as grayscale canvas overlay
    this.debugHeightmapCanvas(heights, verts, config.maxHeight);

    // ── Compute data-driven water level from heightmap ──
    // Use same percentile approach as mini overworld tiles so water matches
    if (this.ctx.heightmapStyle !== 'caves') {
      const sorted = Float32Array.from(heights).sort();
      const pct = this.ctx.heightmapStyle === 'islands' ? 0.25 : 0.15;
      this.ctx.computedWaterY = sorted[Math.floor(sorted.length * pct)];
    }

    // ── Build mesh geometry ──
    const positions = new Float32Array(verts * verts * 3);
    const colors = new Float32Array(verts * verts * 3);
    const indices: number[] = [];

    // Slope-based color palette
    const pal = this.ctx.palette;
    const colorFlat = new THREE.Color(pal.flat);
    const colorGentleSlope = new THREE.Color(pal.gentleSlope);
    const colorSteepSlope = new THREE.Color(pal.steepSlope);
    const colorCliff = new THREE.Color(pal.cliff);
    const colorSand = new THREE.Color(pal.sand);
    const colorWetSand = new THREE.Color(pal.wetSand);
    const tmpColor = new THREE.Color();
    const waterY = this.water.getWaterY();

    const isCaves = this.ctx.preset === 'heightmap' && this.ctx.heightmapStyle === 'caves';
    const colorCaveFloor = (() => {
      const c = new THREE.Color(pal.flat);
      const hsl = { h: 0, s: 0, l: 0 };
      c.getHSL(hsl);
      hsl.l *= 0.28;       // darker
      hsl.s *= 0.9;
      hsl.h = (hsl.h + 0.08) % 1;  // shift toward brown/orange
      c.setHSL(hsl.h, hsl.s, hsl.l);
      return c;
    })();
    const caveFloorMaxY = config.maxHeight * 0.65;

    // Slope threshold matching NavGrid passability exactly.
    const hmCellSize = groundSize / res;
    const eps = hmCellSize * 0.5;
    const maxPassableSlope = (0.75 / hmCellSize) * 0.4;

    // First pass: compute positions
    for (let z = 0; z < verts; z++) {
      for (let x = 0; x < verts; x++) {
        const idx = z * verts + x;
        const h = heights[idx];
        const wx = x * cellSize - halfGround;
        const wz = z * cellSize - halfGround;
        positions[idx * 3] = wx;
        positions[idx * 3 + 1] = h;
        positions[idx * 3 + 2] = wz;
      }
    }

    // Second pass: compute slope at each vertex using same method as NavGrid
    // (bilinear heightmap sampling at eps offset) and assign colors
    for (let z = 0; z < verts; z++) {
      for (let x = 0; x < verts; x++) {
        const idx = z * verts + x;
        const hC = heights[idx];
        const wx = positions[idx * 3];
        const wz = positions[idx * 3 + 2];

        // Sample heightmap with bilinear interpolation at ±eps (matches NavGrid exactly)
        const hL = sampleHeightmap(heights, res, groundSize, wx - eps, wz);
        const hR = sampleHeightmap(heights, res, groundSize, wx + eps, wz);
        const hU = sampleHeightmap(heights, res, groundSize, wx, wz - eps);
        const hD = sampleHeightmap(heights, res, groundSize, wx, wz + eps);

        const gx = (hR - hL) / (2 * eps);
        const gz = (hD - hU) / (2 * eps);
        const slopeMag = Math.sqrt(gx * gx + gz * gz);

        // Sharp transition: passable = green, unpassable = rock
        const slopeRatio = slopeMag / maxPassableSlope;

        if (slopeRatio < 0.4) {
          // Flat ground — base color
          tmpColor.copy(colorFlat);
        } else if (slopeRatio < 0.9) {
          // Gentle slope — blend flat → gentleSlope
          const t = (slopeRatio - 0.4) / 0.5;
          tmpColor.copy(colorFlat).lerp(colorGentleSlope, t);
        } else if (slopeRatio < 1.0) {
          // Steep transition — gentleSlope → steepSlope
          const t = (slopeRatio - 0.9) / 0.1;
          tmpColor.copy(colorGentleSlope).lerp(colorSteepSlope, t);
        } else {
          // Cliff face — full rock
          const t = Math.min(1, (slopeRatio - 1.0) / 0.3);
          tmpColor.copy(colorSteepSlope).lerp(colorCliff, t);
        }

        // Cliff-base fix: prevent rock bleeding onto flat ground.
        const maxNeighborH = Math.max(hL, hR, hU, hD);
        const minNeighborH = Math.min(hL, hR, hU, hD);
        if (slopeRatio < 0.9) {
          // Flat vertex near cliff: stay green
          const cliffAbove = maxNeighborH - hC;
          if (cliffAbove > 0.3) {
            const baseBlend = Math.min(1, (cliffAbove - 0.3) / 0.5);
            tmpColor.lerp(colorFlat, baseBlend * 0.85);
          }
        } else {
          // Cliff vertex: if it's at the bottom (close to a lower neighbor), blend to green
          const dropBelow = hC - minNeighborH;
          if (dropBelow < 0.4) {
            // Near the bottom of the cliff — blend to green to avoid floor bleeding
            const t = 1.0 - dropBelow / 0.4;
            tmpColor.lerp(colorFlat, t * 0.9);
          }
        }

        // Per-terrace color variation: quantize height into levels and
        // shift hue/brightness so each flat area looks distinct
        if (slopeRatio < 0.9) {
          const terraceStep = config.maxHeight / Math.max(config.posterize || 4, 2);
          const level = Math.round(hC / Math.max(terraceStep, 0.5));
          // Alternate warm/cool shift per level
          const hsl = { h: 0, s: 0, l: 0 };
          tmpColor.getHSL(hsl);
          const hueShift = ((level % 3) - 1) * 0.025;  // ±2.5% hue
          const satShift = ((level % 2) === 0 ? 0.04 : -0.04);
          const lumShift = ((level % 3) - 1) * 0.03;    // ±3% lightness
          hsl.h = (hsl.h + hueShift + 1) % 1;
          hsl.s = Math.max(0, Math.min(1, hsl.s + satShift));
          hsl.l = Math.max(0, Math.min(1, hsl.l + lumShift));
          tmpColor.setHSL(hsl.h, hsl.s, hsl.l);
        }

        // Subtle height-based brightness variation
        const heightVar = 0.94 + 0.12 * (hC / Math.max(config.maxHeight, 1));
        tmpColor.multiplyScalar(heightVar);

        // Beach: blend to sand near water level (only on flat/gentle slopes)
        if (slopeRatio < 1.0) {
          const beachTop = waterY + 0.2;   // sand starts here
          const beachMid = waterY + 0.04; // full sand
          const beachBot = waterY - 0.04; // wet sand underwater
          if (hC < beachTop && hC > beachBot - 0.5) {
            if (hC < beachBot) {
              // Underwater — wet sand fading out
              const t = 1.0 - Math.min(1, (beachBot - hC) / 0.5);
              tmpColor.lerp(colorWetSand, t * 0.7);
            } else if (hC < beachMid) {
              // Wet sand zone right at water line
              const t = (hC - beachBot) / (beachMid - beachBot);
              const sandTarget = colorWetSand.clone().lerp(colorSand, t);
              tmpColor.lerp(sandTarget, 0.8);
            } else {
              // Dry sand → grass transition
              const t = (hC - beachMid) / (beachTop - beachMid);
              tmpColor.lerp(colorSand, (1.0 - t) * 0.8);
            }
          }
        }

        // Caves: carved floor (low mesh) = brown; non-carved terraces (high) = keep palette (e.g. green)
        if (isCaves) {
          if (hC < caveFloorMaxY) {
            const t = 1 - hC / caveFloorMaxY;
            tmpColor.lerp(colorCaveFloor, Math.max(0, Math.min(1, t)) * 0.95);
          }
        }

        if (DEBUG_RAMPS && rampCells.has(idx)) {
          tmpColor.setRGB(0.9, 0.15, 0.1);
        }

        colors[idx * 3] = tmpColor.r;
        colors[idx * 3 + 1] = tmpColor.g;
        colors[idx * 3 + 2] = tmpColor.b;
      }
    }

    // Indices: 2 triangles per cell (surface only — no skirt here so projectiles/camera don't hit perimeter)
    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const tl = z * verts + x;
        const tr = tl + 1;
        const bl = (z + 1) * verts + x;
        const br = bl + 1;
        indices.push(tl, bl, tr);
        indices.push(tr, bl, br);
      }
    }

    const surfaceGeo = new THREE.BufferGeometry();
    surfaceGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    surfaceGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    surfaceGeo.setIndex(indices);
    surfaceGeo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
      side: THREE.DoubleSide,
    });

    const surfaceMesh = new THREE.Mesh(surfaceGeo, mat);
    surfaceMesh.castShadow = true;
    surfaceMesh.receiveShadow = true;
    this.ctx.group.add(surfaceMesh);
    this.ctx.heightmapMesh = surfaceMesh;

    // Perimeter skirt: separate mesh (visual only) so projectiles and camera don't raycast it
    let baseY = heights[0];
    for (let i = 1; i < heights.length; i++) {
      if (heights[i] < baseY) baseY = heights[i];
    }
    const skirtColor = new THREE.Color(pal.cliff);
    const skirtPositions: number[] = [];
    const skirtColors: number[] = [];
    const skirtIndices: number[] = [];
    let skirtIdx = 0;

    const pushQuad = (
      ax: number, ay: number, az: number, ar: number, ag: number, ab: number,
      bx: number, by: number, bz: number, br: number, bg: number, bb: number,
      cx: number, cy: number, cz: number, cr: number, cg: number, cb: number,
      dx: number, dy: number, dz: number, dr: number, dg: number, db: number,
    ) => {
      skirtPositions.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
      skirtColors.push(ar, ag, ab, br, bg, bb, cr, cg, cb, dr, dg, db);
      skirtIndices.push(skirtIdx, skirtIdx + 1, skirtIdx + 2, skirtIdx, skirtIdx + 2, skirtIdx + 3);
      skirtIdx += 4;
    };

    for (let z = 0; z < res; z++) {
      const tl = z * verts;
      const tr = (z + 1) * verts;
      const blX = -halfGround;
      const brX = -halfGround;
      const bZ0 = z * cellSize - halfGround;
      const bZ1 = (z + 1) * cellSize - halfGround;
      pushQuad(
        blX, baseY, bZ0, skirtColor.r, skirtColor.g, skirtColor.b,
        brX, baseY, bZ1, skirtColor.r, skirtColor.g, skirtColor.b,
        positions[tr * 3 + 0], positions[tr * 3 + 1], positions[tr * 3 + 2],
        colors[tr * 3], colors[tr * 3 + 1], colors[tr * 3 + 2],
        positions[tl * 3 + 0], positions[tl * 3 + 1], positions[tl * 3 + 2],
        colors[tl * 3], colors[tl * 3 + 1], colors[tl * 3 + 2],
      );
    }
    for (let z = 0; z < res; z++) {
      const tl = z * verts + res;
      const tr = (z + 1) * verts + res;
      const blX = halfGround;
      const brX = halfGround;
      const bZ0 = z * cellSize - halfGround;
      const bZ1 = (z + 1) * cellSize - halfGround;
      pushQuad(
        brX, baseY, bZ1, skirtColor.r, skirtColor.g, skirtColor.b,
        blX, baseY, bZ0, skirtColor.r, skirtColor.g, skirtColor.b,
        positions[tl * 3 + 0], positions[tl * 3 + 1], positions[tl * 3 + 2],
        colors[tl * 3], colors[tl * 3 + 1], colors[tl * 3 + 2],
        positions[tr * 3 + 0], positions[tr * 3 + 1], positions[tr * 3 + 2],
        colors[tr * 3], colors[tr * 3 + 1], colors[tr * 3 + 2],
      );
    }
    for (let x = 0; x < res; x++) {
      const tl = x;
      const tr = x + 1;
      const bX0 = x * cellSize - halfGround;
      const bX1 = (x + 1) * cellSize - halfGround;
      const bZ = -halfGround;
      pushQuad(
        bX0, baseY, bZ, skirtColor.r, skirtColor.g, skirtColor.b,
        bX1, baseY, bZ, skirtColor.r, skirtColor.g, skirtColor.b,
        positions[tr * 3 + 0], positions[tr * 3 + 1], positions[tr * 3 + 2],
        colors[tr * 3], colors[tr * 3 + 1], colors[tr * 3 + 2],
        positions[tl * 3 + 0], positions[tl * 3 + 1], positions[tl * 3 + 2],
        colors[tl * 3], colors[tl * 3 + 1], colors[tl * 3 + 2],
      );
    }
    for (let x = 0; x < res; x++) {
      const tl = res * verts + x;
      const tr = res * verts + x + 1;
      const bX0 = x * cellSize - halfGround;
      const bX1 = (x + 1) * cellSize - halfGround;
      const bZ = halfGround;
      pushQuad(
        bX0, baseY, bZ, skirtColor.r, skirtColor.g, skirtColor.b,
        bX1, baseY, bZ, skirtColor.r, skirtColor.g, skirtColor.b,
        positions[tr * 3 + 0], positions[tr * 3 + 1], positions[tr * 3 + 2],
        colors[tr * 3], colors[tr * 3 + 1], colors[tr * 3 + 2],
        positions[tl * 3 + 0], positions[tl * 3 + 1], positions[tl * 3 + 2],
        colors[tl * 3], colors[tl * 3 + 1], colors[tl * 3 + 2],
      );
    }

    const skirtGeo = new THREE.BufferGeometry();
    skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtPositions, 3));
    skirtGeo.setAttribute('color', new THREE.Float32BufferAttribute(skirtColors, 3));
    skirtGeo.setIndex(skirtIndices);
    skirtGeo.computeVertexNormals();

    const skirtMesh = new THREE.Mesh(skirtGeo, mat.clone());
    skirtMesh.castShadow = true;
    skirtMesh.receiveShadow = true;
    this.ctx.group.add(skirtMesh);
    this.ctx.heightmapSkirtMesh = skirtMesh;

    // ── Build grid line overlay ──
    const linePoints: number[] = [];
    const lineColors: number[] = [];
    const bias = 0.02; // slight offset to prevent z-fighting
    const geo = surfaceMesh.geometry;
    const normals = geo.getAttribute('normal') as THREE.BufferAttribute;

    /** Get biased position for vertex index (offset along normal) */
    const bxFn = (i: number) => positions[i * 3] + normals.getX(i) * bias;
    const byFn = (i: number) => positions[i * 3 + 1] + normals.getY(i) * bias;
    const bzFn = (i: number) => positions[i * 3 + 2] + normals.getZ(i) * bias;

    /** Line color from vertex luminance */
    const contrastForVertex = (vi: number): number => {
      const r = colors[vi * 3], g = colors[vi * 3 + 1], b = colors[vi * 3 + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      return lum > 0.18 ? 0 : 0.7;
    };

    const gridWaterY = waterY;

    const pushLine = (x1: number, y1: number, z1: number, vi1: number,
                      x2: number, y2: number, z2: number, vi2: number) => {
      if (y1 < gridWaterY && y2 < gridWaterY) return;
      linePoints.push(x1, y1, z1, x2, y2, z2);
      const c1 = contrastForVertex(vi1);
      const c2 = contrastForVertex(vi2);
      lineColors.push(c1, c1, c1, c2, c2, c2);
    };

    const pushLineWorld = (x1: number, y1: number, z1: number,
                           x2: number, y2: number, z2: number,
                           nearestVi: number) => {
      if (y1 < gridWaterY && y2 < gridWaterY) return;
      linePoints.push(x1, y1, z1, x2, y2, z2);
      const c = contrastForVertex(nearestVi);
      lineColors.push(c, c, c, c, c, c);
    };

    // Draw grid at fixed 0.25m NavGrid intervals, independent of mesh resolution.
    const navCellSize = 0.25;
    const baseRes = Math.round(groundSize / navCellSize);

    for (let gz = 0; gz <= baseRes; gz++) {
      for (let gx = 0; gx <= baseRes; gx++) {
        const wx = gx * navCellSize - halfGround;
        const wz = gz * navCellSize - halfGround;
        const y0 = sampleHeightmap(heights, res, groundSize, wx, wz);
        // Find nearest mesh vertex for color
        const mx = Math.min(Math.round((wx + halfGround) / cellSize), res);
        const mz = Math.min(Math.round((wz + halfGround) / cellSize), res);
        const nearIdx = mz * verts + mx;

        // Horizontal edge (along X)
        if (gx < baseRes) {
          const wx1 = (gx + 1) * navCellSize - halfGround;
          const y1 = sampleHeightmap(heights, res, groundSize, wx1, wz);
          pushLineWorld(wx, y0, wz, wx1, y1, wz, nearIdx);
        }
        // Vertical edge (along Z)
        if (gz < baseRes) {
          const wz1 = (gz + 1) * navCellSize - halfGround;
          const y1 = sampleHeightmap(heights, res, groundSize, wx, wz1);
          pushLineWorld(wx, y0, wz, wx, y1, wz1, nearIdx);
        }
      }
    }

    // Add horizontal rungs on steep cell faces.
    const gridStep = HALF;

    const edgeIntersect = (
      ax: number, ay: number, az: number,
      ebx: number, eby: number, ebz: number,
      y: number,
    ): [number, number, number] | null => {
      if ((ay - y) * (eby - y) > 0) return null;
      const dy = eby - ay;
      if (Math.abs(dy) < 0.001) return null;
      const t = (y - ay) / dy;
      if (t < -0.01 || t > 1.01) return null;
      return [ax + t * (ebx - ax), y, az + t * (ebz - az)];
    };

    for (let cz = 0; cz < res; cz++) {
      for (let cx = 0; cx < res; cx++) {
        const iTL = cz * verts + cx;
        const iTR = iTL + 1;
        const iBL = iTL + verts;
        const iBR = iBL + 1;

        const hTL = positions[iTL * 3 + 1];
        const hTR = positions[iTR * 3 + 1];
        const hBL = positions[iBL * 3 + 1];
        const hBR = positions[iBR * 3 + 1];

        const minH = Math.min(hTL, hTR, hBL, hBR);
        const cellMaxH = Math.max(hTL, hTR, hBL, hBR);
        if (cellMaxH - minH < gridStep * 0.8) continue;

        const tlx = bxFn(iTL), tly = byFn(iTL), tlz = bzFn(iTL);
        const trx = bxFn(iTR), try_ = byFn(iTR), trz = bzFn(iTR);
        const blx = bxFn(iBL), bly = byFn(iBL), blz = bzFn(iBL);
        const brx = bxFn(iBR), bry = byFn(iBR), brz = bzFn(iBR);

        const startY = Math.ceil((minH + 0.01) / gridStep) * gridStep;
        const endY = Math.floor((cellMaxH - 0.01) / gridStep) * gridStep;

        for (let y = startY; y <= endY; y += gridStep) {
          const hits: [number, number, number][] = [];
          const e1 = edgeIntersect(tlx, tly, tlz, trx, try_, trz, y);
          const e2 = edgeIntersect(trx, try_, trz, brx, bry, brz, y);
          const e3 = edgeIntersect(blx, bly, blz, brx, bry, brz, y);
          const e4 = edgeIntersect(tlx, tly, tlz, blx, bly, blz, y);
          if (e1) hits.push(e1);
          if (e2) hits.push(e2);
          if (e3) hits.push(e3);
          if (e4) hits.push(e4);

          if (hits.length >= 2) {
            pushLineWorld(hits[0][0], hits[0][1], hits[0][2],
              hits[1][0], hits[1][1], hits[1][2], iTL);
          }
        }
      }
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePoints, 3));
    lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const gridLines = new THREE.LineSegments(lineGeo, lineMat);
    this.ctx.group.add(gridLines);
    this.ctx.heightmapGrid = gridLines;

    // Create ladder meshes at detected cliff edges
    this.createLadderMeshes();

    // Nature is generated separately after POI terrain flattening
    // (called from Environment.ts after placeHeightmapPOIs)
  }

  generateNatureElements(extraExclusions?: { x: number; z: number; r: number }[]): void {
    if (!this.ctx.heightmapData) return;
    // Dispose previous nature
    if (this.ctx.natureResult) {
      this.ctx.group.remove(this.ctx.natureResult.group);
      this.ctx.natureResult.dispose();
      this.ctx.natureResult = null;
    }

    // Build exclusion zones from ramps and ladders
    const exclusions: { x: number; z: number; r: number }[] = [];
    const gs = this.ctx.heightmapGroundSize;
    const res = this.ctx.heightmapRes;
    const cellSize = gs / res;
    const halfG = gs / 2;
    for (const idx of this.ctx.rampCells) {
      const gz = Math.floor(idx / (res + 1));
      const gx = idx - gz * (res + 1);
      exclusions.push({ x: gx * cellSize - halfG, z: gz * cellSize - halfG, r: cellSize * 1.2 });
    }
    for (const ld of this.ctx.ladderDefs) {
      exclusions.push({ x: ld.bottomX, z: ld.bottomZ, r: 1.5 });
      exclusions.push({ x: ld.highWorldX ?? ld.bottomX, z: ld.highWorldZ ?? ld.bottomZ, r: 1.5 });
      exclusions.push({ x: ld.lowWorldX, z: ld.lowWorldZ, r: 1.5 });
    }
    if (extraExclusions) exclusions.push(...extraExclusions);

    const biome = paletteBiome[this.ctx.paletteName] ?? 'temperate';
    const result = generateNature(
      this.ctx.heightmapData,
      this.ctx.heightmapRes,
      this.ctx.heightmapGroundSize,
      this.water.getWaterY(),
      biome,
      this.ctx.palette,
      this.ctx.heightmapSeed ?? 0,
      exclusions,
      useGameStore.getState().useBiomes,
    );
    this.ctx.natureResult = result;
    this.ctx.group.add(result.group);

    if (useGameStore.getState().debugBiomes && useGameStore.getState().useBiomes) {
      this.tintTerrainByPatches(result);
    }

    // Register tree trunks — movement collision + invisible proxy for projectile raycasts
    // (InstancedMesh can't raycast, so proxy boxes let arrows stick to tree trunks)
    for (const t of result.treePositions) {
      const h = sampleHeightmap(this.ctx.heightmapData, this.ctx.heightmapRes, this.ctx.heightmapGroundSize, t.x, t.z);
      const cos = Math.cos(t.rotY);
      const sin = Math.sin(t.rotY);
      const ox = t.offsetX * cos;
      const oz = -t.offsetX * sin;
      this.ctx.addCollider({
        x: t.x + ox, z: t.z + oz,
        halfW: t.halfW, halfD: t.halfD,
        height: h + t.height,
        rotation: t.rotY,
      }); // auto-creates proxy mesh for projectile raycasts
    }

    // Register rocks — movement collision only (too small for projectile cover)
    for (const r of result.rockPositions) {
      const h = sampleHeightmap(this.ctx.heightmapData, this.ctx.heightmapRes, this.ctx.heightmapGroundSize, r.x, r.z);
      this.ctx.addCollider({
        x: r.x, z: r.z,
        halfW: r.halfW, halfD: r.halfD,
        height: h + r.height,
      }, { projectile: false });
    }
  }

  /** Create procedural ladder meshes at each detected ladder site. */
  createLadderMeshes(): void {
    for (let li = 0; li < this.ctx.ladderDefs.length; li++) {
      this.createSingleLadderMesh(li);
    }
  }

  /** Create a single ladder mesh at the given index in ladderDefs.
   *  Samples the actual terrain surface to find the cliff face geometry
   *  so the ladder lean angle matches the real wall slope. */
  createSingleLadderMesh(li: number): void {
    const ladder = this.ctx.ladderDefs[li];
    const ladderGroup = new THREE.Group();
    const dy = ladder.topY - ladder.bottomY;
    if (dy <= 0) return;

    const rungSpacing = 0.2;
    const railWidth = 0.25;
    const railThickness = 0.04;
    const rungThickness = 0.03;

    const mat = new THREE.MeshStandardMaterial({
      color: 0x8B6914,
      roughness: 0.8,
      metalness: 0.1,
      emissive: 0x332200,
      emissiveIntensity: 0.3,
    });

    const offsetFromWall = 0.06;
    const yaw = Math.atan2(-ladder.facingDX, -ladder.facingDZ);
    const perpDX = -ladder.facingDZ;
    const perpDZ = ladder.facingDX;

    if (ladder.isVertical) {
      // ── Vertical ladder: straight up, no lean ──
      const ladderLength = dy;
      const rungCount = Math.max(1, Math.floor(ladderLength / rungSpacing));
      const baseX = ladder.bottomX + ladder.facingDX * offsetFromWall;
      const baseZ = ladder.bottomZ + ladder.facingDZ * offsetFromWall;
      const baseY = ladder.bottomY;

      ladder.leanAngle = 0;
      ladder.cliffLowX = ladder.bottomX; ladder.cliffLowZ = ladder.bottomZ; ladder.cliffLowY = ladder.bottomY;
      ladder.cliffHighX = ladder.bottomX; ladder.cliffHighZ = ladder.bottomZ; ladder.cliffHighY = ladder.topY;

      const railGeo = new THREE.BoxGeometry(railThickness, ladderLength + 0.15, railThickness);
      const rungGeo = new THREE.BoxGeometry(railWidth, rungThickness, rungThickness);

      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(railGeo, mat);
        rail.position.set(
          baseX + perpDX * (railWidth * 0.5) * side,
          baseY + ladderLength / 2,
          baseZ + perpDZ * (railWidth * 0.5) * side,
        );
        rail.rotation.y = yaw;
        rail.castShadow = true;
        ladderGroup.add(rail);
      }

      for (let i = 0; i <= rungCount; i++) {
        const t = rungCount > 0 ? i / rungCount : 0;
        const rung = new THREE.Mesh(rungGeo, mat);
        rung.position.set(baseX, baseY + dy * t, baseZ);
        rung.rotation.y = yaw;
        rung.castShadow = true;
        ladderGroup.add(rung);
      }
    } else {
      // ── Terrain ladder: lean against cliff face ──
      const cliffMidX = (ladder.lowWorldX + ladder.highWorldX) / 2;
      const cliffMidZ = (ladder.lowWorldZ + ladder.highWorldZ) / 2;
      const sampleStep = 0.15;
      const lowThresh = ladder.bottomY + (dy * 0.15);
      const highThresh = ladder.topY - (dy * 0.15);

      let cliffLowX = cliffMidX, cliffLowZ = cliffMidZ, cliffLowY = ladder.bottomY;
      let cliffHighX = cliffMidX, cliffHighZ = cliffMidZ, cliffHighY = ladder.topY;

      for (let d = sampleStep; d < 4; d += sampleStep) {
        const sx = cliffMidX + ladder.facingDX * d;
        const sz = cliffMidZ + ladder.facingDZ * d;
        const h = this.getTerrainY(sx, sz);
        if (h <= lowThresh) {
          cliffLowX = sx; cliffLowZ = sz; cliffLowY = h;
          break;
        }
      }
      for (let d = sampleStep; d < 4; d += sampleStep) {
        const sx = cliffMidX - ladder.facingDX * d;
        const sz = cliffMidZ - ladder.facingDZ * d;
        const h = this.getTerrainY(sx, sz);
        if (h >= highThresh) {
          cliffHighX = sx; cliffHighZ = sz; cliffHighY = h;
          break;
        }
      }

      const cliffDX = cliffHighX - cliffLowX;
      const cliffDZ = cliffHighZ - cliffLowZ;
      const actualHorizDist = Math.sqrt(cliffDX * cliffDX + cliffDZ * cliffDZ);
      const actualDY = cliffHighY - cliffLowY;
      const ladderLength = Math.sqrt(actualHorizDist * actualHorizDist + actualDY * actualDY);
      const rungCount = Math.max(1, Math.floor(ladderLength / rungSpacing));

      const railGeo = new THREE.BoxGeometry(railThickness, ladderLength + 0.15, railThickness);
      const rungGeo = new THREE.BoxGeometry(railWidth, rungThickness, rungThickness);

      const midX = (cliffLowX + cliffHighX) / 2 + ladder.facingDX * offsetFromWall;
      const midZ = (cliffLowZ + cliffHighZ) / 2 + ladder.facingDZ * offsetFromWall;
      const midY = (cliffLowY + cliffHighY) / 2;

      const leanAngle = Math.atan2(actualHorizDist, actualDY);
      ladder.leanAngle = leanAngle;
      ladder.cliffLowX = cliffLowX; ladder.cliffLowZ = cliffLowZ; ladder.cliffLowY = cliffLowY;
      ladder.cliffHighX = cliffHighX; ladder.cliffHighZ = cliffHighZ; ladder.cliffHighY = cliffHighY;

      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(railGeo, mat);
        rail.position.set(
          midX + perpDX * (railWidth * 0.5) * side,
          midY,
          midZ + perpDZ * (railWidth * 0.5) * side,
        );
        rail.rotation.order = 'YXZ';
        rail.rotation.y = yaw;
        rail.rotation.x = leanAngle;
        rail.castShadow = true;
        ladderGroup.add(rail);
      }

      for (let i = 0; i <= rungCount; i++) {
        const t = rungCount > 0 ? i / rungCount : 0;
        const rx = cliffLowX + (cliffHighX - cliffLowX) * t + ladder.facingDX * offsetFromWall;
        const rz = cliffLowZ + (cliffHighZ - cliffLowZ) * t + ladder.facingDZ * offsetFromWall;
        const ry = cliffLowY + actualDY * t;
        const rung = new THREE.Mesh(rungGeo, mat);
        rung.position.set(rx, ry, rz);
        rung.rotation.y = yaw;
        rung.castShadow = true;
        ladderGroup.add(rung);
      }
    }

    this.ctx.group.add(ladderGroup);
    // Replace at index if recreating, otherwise push
    if (li < this.ctx.ladderMeshes.length) {
      this.ctx.ladderMeshes[li] = ladderGroup;
    } else {
      this.ctx.ladderMeshes.push(ladderGroup);
    }
  }

  /** Rebuild only the heightmap mesh + grid + ladders at a new resolution scale,
   *  keeping the same seed so the terrain shape is identical. Entities are unaffected. */
  remesh(): void {
    if (this.ctx.preset !== 'heightmap') return;

    // Dispose old mesh, grid, and ladder visuals
    if (this.ctx.heightmapMesh) {
      this.ctx.group.remove(this.ctx.heightmapMesh);
      this.ctx.heightmapMesh.geometry.dispose();
      (this.ctx.heightmapMesh.material as THREE.Material).dispose();
      this.ctx.heightmapMesh = null;
    }
    if (this.ctx.heightmapSkirtMesh) {
      this.ctx.group.remove(this.ctx.heightmapSkirtMesh);
      this.ctx.heightmapSkirtMesh.geometry.dispose();
      (this.ctx.heightmapSkirtMesh.material as THREE.Material).dispose();
      this.ctx.heightmapSkirtMesh = null;
    }
    if (this.ctx.heightmapGrid) {
      this.ctx.group.remove(this.ctx.heightmapGrid);
      this.ctx.heightmapGrid.geometry.dispose();
      (this.ctx.heightmapGrid.material as THREE.Material).dispose();
      this.ctx.heightmapGrid = null;
    }
    for (const ladderGroup of this.ctx.ladderMeshes) {
      ladderGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      this.ctx.group.remove(ladderGroup);
    }
    this.ctx.ladderMeshes = [];
    if (this.ctx.natureResult) {
      this.ctx.group.remove(this.ctx.natureResult.group);
      this.ctx.natureResult.dispose();
      this.ctx.natureResult = null;
    }

    // Rebuild with same seed (stored from previous generation)
    this.ctx.isRemeshing = true;
    this.createHeightmapMesh();
    this.ctx.isRemeshing = false;
  }

  // ── Private methods ────────────────────────────────────────────────

  private tintTerrainByPatches(nature: NatureGeneratorResult): void {
    if (!this.ctx.heightmapMesh || !this.ctx.heightmapData) return;
    const geo = this.ctx.heightmapMesh.geometry;
    const colorAttr = geo.getAttribute('color') as THREE.BufferAttribute;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    if (!colorAttr || !posAttr) return;

    const th = nature.patchThreshold;
    const tintStrength = 0.7;
    const treeColor = new THREE.Color(0.0, 0.9, 0.0);
    const rockColor = new THREE.Color(1.0, 0.5, 0.0);
    const flowerColor = new THREE.Color(1.0, 0.0, 1.0);
    const cliffColor = new THREE.Color(this.ctx.palette.cliff);

    const heights = this.ctx.heightmapData;
    const res = this.ctx.heightmapRes;
    const gs = this.ctx.heightmapGroundSize;
    const eps = (gs / res) * 0.5;

    const tmpBase = new THREE.Color();
    const tmpTint = new THREE.Color();
    let tinted = 0;

    for (let i = 0; i < posAttr.count; i++) {
      const wx = posAttr.getX(i);
      const wz = posAttr.getZ(i);

      // Compute slope at this vertex
      const hL = sampleHeightmap(heights, res, gs, wx - eps, wz);
      const hR = sampleHeightmap(heights, res, gs, wx + eps, wz);
      const hU = sampleHeightmap(heights, res, gs, wx, wz - eps);
      const hD = sampleHeightmap(heights, res, gs, wx, wz + eps);
      const gx = (hR - hL) / (2 * eps);
      const gz = (hD - hU) / (2 * eps);
      const slope = Math.sqrt(gx * gx + gz * gz);

      // Skip cliff faces -- keep their original cliff coloring
      if (slope > 0.8) continue;

      const tp = nature.hasTrees ? nature.treePatch(wx, wz) : 0;
      const rp = nature.hasRocks ? nature.rockPatch(wx, wz) : 0;
      const fp = nature.hasFlowers ? nature.flowerPatch(wx, wz) : 0;

      let best = 0;
      let bestVal = 0;
      if (tp > th && tp - th > bestVal) { bestVal = tp - th; best = 1; }
      if (rp > th && rp - th > bestVal) { bestVal = rp - th; best = 2; }
      if (fp > th && fp - th > bestVal) { bestVal = fp - th; best = 3; }

      if (best === 0) continue;

      tinted++;
      // Fade tint out as slope approaches cliff threshold
      const slopeFade = slope > 0.5 ? 1 - (slope - 0.5) / 0.3 : 1;
      const intensity = (0.4 + 0.6 * Math.min(bestVal / (1 - th), 1)) * tintStrength * slopeFade;
      tmpBase.setRGB(colorAttr.getX(i), colorAttr.getY(i), colorAttr.getZ(i));

      if (best === 1) tmpTint.copy(treeColor);
      else if (best === 2) tmpTint.copy(rockColor);
      else tmpTint.copy(flowerColor);

      tmpBase.lerp(tmpTint, intensity);
      colorAttr.setXYZ(i, tmpBase.r, tmpBase.g, tmpBase.b);
    }

    colorAttr.needsUpdate = true;
  }

  /**
   * Stitch this heightmap's border vertices with neighboring overworld tiles.
   * Generates neighbor heightmaps at the same resolution, averages shared edges,
   * then blends a few rows inward for a smooth transition.
   */
  private stitchWithNeighbors(
    heights: Float32Array,
    res: number,
    groundSize: number,
    resolutionScale: number,
  ): void {
    const owState = useGameStore.getState().overworldState;
    if (!owState || owState.activeTileIndex === null) return;

    const activeIdx = owState.activeTileIndex;
    const activeDef = owState.tiles[activeIdx];
    const row = activeDef.row;
    const col = activeDef.col;
    const verts = res + 1;
    const REF_GROUND = 46;
    const BLEND_ROWS = 3; // rows to blend inward from edge

    // Neighbor directions: [dRow, dCol, edgeName]
    const neighbors: [number, number, 'top' | 'bottom' | 'left' | 'right'][] = [
      [-1, 0, 'top'],
      [1, 0, 'bottom'],
      [0, -1, 'left'],
      [0, 1, 'right'],
    ];

    for (const [dr, dc, edge] of neighbors) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr < 0 || nr >= OW_GRID || nc < 0 || nc >= OW_GRID) continue;

      const nIdx = nr * OW_GRID + nc;
      const nDef = owState.tiles[nIdx];

      // Generate neighbor's heightmap at LOW resolution — we only need edge values
      const nConfig = { ...getHeightmapConfig(nDef.heightmapStyle) };
      nConfig.maxHeight *= groundSize / REF_GROUND;
      const nResult = generateHeightmap(nConfig, groundSize, nDef.seed, 1);
      // Resample neighbor edge to match our resolution if needed
      const nRes = nConfig.resolution;
      const nVerts = nRes + 1;
      const nHeights = nResult.heights;

      // Helper: sample neighbor edge with linear interpolation from low-res grid
      const sampleNeighborEdge = (i: number): number => {
        // Map our vertex index (0..res) to neighbor's vertex space (0..nRes)
        const nPos = (i / res) * nRes;
        const nI = Math.min(Math.floor(nPos), nRes - 1);
        const frac = nPos - nI;

        let idxA: number, idxB: number;
        switch (edge) {
          case 'top':    idxA = nRes * nVerts + nI; idxB = nRes * nVerts + nI + 1; break;
          case 'bottom': idxA = 0 * nVerts + nI;    idxB = 0 * nVerts + nI + 1; break;
          case 'left':   idxA = nI * nVerts + nRes;  idxB = (nI + 1) * nVerts + nRes; break;
          case 'right':  idxA = nI * nVerts + 0;     idxB = (nI + 1) * nVerts + 0; break;
        }
        return nHeights[idxA] * (1 - frac) + nHeights[idxB] * frac;
      };

      // Average the shared edge and blend inward
      for (let i = 0; i < verts; i++) {
        let myEdgeIdx: number;

        switch (edge) {
          case 'top':    myEdgeIdx = 0 * verts + i; break;
          case 'bottom': myEdgeIdx = res * verts + i; break;
          case 'left':   myEdgeIdx = i * verts + 0; break;
          case 'right':  myEdgeIdx = i * verts + res; break;
        }

        const avg = (heights[myEdgeIdx] + sampleNeighborEdge(i)) * 0.5;

        // Set edge vertex to average
        heights[myEdgeIdx] = avg;

        // Blend a few rows inward so the transition isn't abrupt
        for (let b = 1; b <= BLEND_ROWS; b++) {
          const t = b / (BLEND_ROWS + 1); // 0 at edge, approaching 1 inward
          let blendIdx: number;
          switch (edge) {
            case 'top':    blendIdx = b * verts + i; break;
            case 'bottom': blendIdx = (res - b) * verts + i; break;
            case 'left':   blendIdx = i * verts + b; break;
            case 'right':  blendIdx = i * verts + (res - b); break;
          }
          heights[blendIdx] = avg + (heights[blendIdx] - avg) * t;
        }
      }
    }
  }

  /** Generate a 32x32 heightmap thumbnail data URL and store it in the Zustand store. */
  private debugHeightmapCanvas(heights: Float32Array, verts: number, maxHeight: number): void {
    const thumbSize = 32;
    const canvas = document.createElement('canvas');
    canvas.width = thumbSize;
    canvas.height = thumbSize;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(thumbSize, thumbSize);
    const invMax = maxHeight > 0 ? 255 / maxHeight : 255;

    for (let tz = 0; tz < thumbSize; tz++) {
      for (let tx = 0; tx < thumbSize; tx++) {
        // Sample from the full-res heightmap with nearest-neighbor
        const sx = Math.floor(tx / (thumbSize - 1) * (verts - 1));
        const sz = Math.floor(tz / (thumbSize - 1) * (verts - 1));
        const h = heights[sz * verts + sx];
        const v = Math.min(255, Math.round(h * invMax));
        const idx = (tz * thumbSize + tx) * 4;
        img.data[idx] = v;
        img.data[idx + 1] = v;
        img.data[idx + 2] = v;
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    const { setHeightmapThumb } = useGameStore.getState();
    setHeightmapThumb(canvas.toDataURL());
  }
}
