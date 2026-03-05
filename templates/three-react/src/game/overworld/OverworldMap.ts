/**
 * OverworldMap — builds a 3x3 grid of mini heightmap tiles as a diorama overworld.
 *
 * Each tile is a small heightmap mesh with its own biome palette, vertex-colored
 * with a closed skirt (sides). Tiles are positioned in a grid with gaps.
 * A unified NavGrid spans all tiles with gap cells blocked and nav-links
 * bridging adjacent tile edges.
 */

import * as THREE from 'three';
import {
  generateHeightmap,
  sampleHeightmap,
  getHeightmapConfig,
} from '../terrain/TerrainNoise';
import { createTextLabel, updateTextLabel } from '../rendering/TextLabel';
import { TextScramble } from '../utils/TextScramble';
import type { HeightmapStyleConfig } from '../terrain/TerrainNoise';
import type { NatureGeneratorResult } from '../terrain/NatureGenerator';
import type { BiomeType } from '../terrain/ColorPalettes';
import { palettes, paletteBiome, randomPalette } from '../terrain/ColorPalettes';
import type { TerrainPalette } from '../terrain/ColorPalettes';
import { NavGrid } from '../pathfinding';
import {
  generateOverworldTiles,
  tileCenterWorld,
  OW_GRID,
  OW_TILE_SIZE,
  OW_GAP,
  OW_STRIDE,
  OW_TOTAL_SIZE,
  type OverworldTileDef,
} from './OverworldTiles';
import { buildMiniCastle, buildMiniDungeonMarker } from './OverworldPOIs';

// ── Per-tile data ───────────────────────────────────────────────────

interface TileData {
  def: OverworldTileDef;
  heights: Float32Array;
  resolution: number;
  groundSize: number;   // = OW_TILE_SIZE
  maxHeight: number;
  cx: number;           // world center X
  cz: number;           // world center Z
  mesh: THREE.Mesh;
  skirtMesh: THREE.Mesh;
  waterMesh: THREE.Mesh | null;
  waterY: number;
  palette: TerrainPalette;
  nature: NatureGeneratorResult | null;
}

// ── Mini heightmap config ───────────────────────────────────────────

const MINI_RESOLUTION = 16;

/** Full heightmaps are tuned for groundSize=46 (50-4 margin).
 *  We generate at full scale then post-scale heights, because the generation
 *  pipeline uses absolute values (quantize steps, rolling noise, ramps)
 *  that don't scale with maxHeight. */
const REF_GROUND = 46;
const HEIGHT_SCALE = 0.35; // 35; // post-scale factor to reduce vertical exaggeration

function getMiniConfig(style: string): HeightmapStyleConfig {
  const base = getHeightmapConfig(style as any);
  return {
    ...base,
    resolution: MINI_RESOLUTION,
    // Keep full maxHeight so generation works correctly; we post-scale after
    mask: 'none',
  };
}

/** Post-scale heightmap values to mini tile proportions.
 *  Uses a sqrt compression curve to squash peaks while preserving valley detail. */
function rescaleHeights(heights: Float32Array, groundSize: number): number {
  // Find actual height range
  let minH = Infinity, maxH = -Infinity;
  for (let i = 0; i < heights.length; i++) {
    if (heights[i] < minH) minH = heights[i];
    if (heights[i] > maxH) maxH = heights[i];
  }
  const range = maxH - minH;
  if (range < 0.001) return 0;

  // Target max height proportional to tile size
  const targetRange = groundSize * HEIGHT_SCALE;

  // Normalize to 0..1, apply sqrt compression (flattens peaks, keeps valleys),
  // then scale to target range
  for (let i = 0; i < heights.length; i++) {
    const t = (heights[i] - minH) / range; // 0..1
    heights[i] = Math.sqrt(t) * targetRange;
  }
  return targetRange;
}

/** Compute water Y from actual height data. Uses percentile-based approach
 *  per style — slightly higher than real heightmaps for aesthetic appeal:
 *  - islands: generous water (25th percentile)
 *  - terraces: moderate (15th percentile)
 *  - caves: minimal (5th percentile) */
function computeWaterY(heights: Float32Array, style: string): number {
  const sorted = Float32Array.from(heights).sort();
  const pct = style === 'islands' ? 0.25
            : style === 'caves'   ? 0.05
            :                       0.15;
  return sorted[Math.floor(sorted.length * pct)];
}

/** Flatten mini heightmap around POI positions so structures sit on raised platforms. */
function flattenHeightmapForPOIs(
  heights: Float32Array,
  res: number,
  groundSize: number,
  pois: import('./OverworldTiles').POIDef[],
  waterY: number,
): void {
  if (!pois.length) return;
  const verts = res + 1;
  const cellSize = groundSize / res;
  const halfGround = groundSize / 2;
  const minPoiY = waterY + groundSize * 0.02; // ensure POIs sit above water

  for (const poi of pois) {
    const cx = poi.nx * groundSize;
    const cz = poi.nz * groundSize;

    // Flatten radius scaled to mini tile (village bigger, dungeon smaller)
    const flatRadius = poi.type === 'village'
      ? groundSize * 0.08   // ~0.32m on 4m tile
      : groundSize * 0.04;  // ~0.16m
    const blendWidth = groundSize * 0.04;
    const totalRadius = flatRadius + blendWidth;

    // Sample center height, clamp above water
    const centerGx = Math.round((cx + halfGround) / cellSize);
    const centerGz = Math.round((cz + halfGround) / cellSize);
    const clamped = (v: number) => Math.max(0, Math.min(verts - 1, v));
    const sampledY = heights[clamped(centerGz) * verts + clamped(centerGx)];
    const flatY = Math.max(sampledY, minPoiY);

    const minGx = Math.max(0, Math.floor((cx - totalRadius + halfGround) / cellSize) - 1);
    const maxGx = Math.min(verts - 1, Math.ceil((cx + totalRadius + halfGround) / cellSize) + 1);
    const minGz = Math.max(0, Math.floor((cz - totalRadius + halfGround) / cellSize) - 1);
    const maxGz = Math.min(verts - 1, Math.ceil((cz + totalRadius + halfGround) / cellSize) + 1);

    for (let gz = minGz; gz <= maxGz; gz++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        const wx = gx * cellSize - halfGround;
        const wz = gz * cellSize - halfGround;
        const dx = wx - cx;
        const dz = wz - cz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > totalRadius) continue;

        const idx = gz * verts + gx;
        const origH = heights[idx];

        if (dist <= flatRadius) {
          heights[idx] = flatY;
        } else {
          const t = (dist - flatRadius) / blendWidth;
          const smooth = t * t * (3 - 2 * t);
          heights[idx] = flatY + (origH - flatY) * smooth;
        }
      }
    }
  }
}

// ── Simple PRNG ───────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Biome representative props ───────────────────────────────────

type MiniPropKind = 'tree' | 'palm' | 'cactus' | 'pine' | 'rock' | 'flower';

interface BiomePropConfig {
  types: MiniPropKind[];
  minCount: number;
  maxCount: number;
}

const BIOME_PROPS: Record<BiomeType, BiomePropConfig> = {
  temperate:  { types: ['tree', 'tree', 'flower'],             minCount: 2, maxCount: 3 },
  autumn:     { types: ['tree', 'tree', 'tree'],               minCount: 2, maxCount: 3 },
  tropical:   { types: ['palm', 'palm', 'flower'],             minCount: 2, maxCount: 3 },
  winter:     { types: ['pine', 'pine', 'rock'],               minCount: 1, maxCount: 3 },
  desert:     { types: ['cactus', 'cactus', 'rock'],           minCount: 1, maxCount: 2 },
  volcanic:   { types: ['rock', 'rock', 'rock'],               minCount: 2, maxCount: 3 },
  barren:     { types: ['rock', 'rock'],                       minCount: 1, maxCount: 3 },
  swamp:      { types: ['tree', 'flower'],                     minCount: 1, maxCount: 2 },
  enchanted:  { types: ['tree', 'flower', 'flower', 'pine'],   minCount: 2, maxCount: 3 },
};

/** Build a tiny representative voxel prop for overworld tiles. */
function buildMiniProp(kind: MiniPropKind, rng: () => number, scale: number): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  const parts: THREE.BufferGeometry[] = [];

  const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number) => {
    const g = new THREE.BoxGeometry(w * scale, h * scale, d * scale);
    g.translate(x * scale, (y + h / 2) * scale, z * scale);
    const colors = new Float32Array(g.attributes.position.count * 3);
    const c = new THREE.Color(color);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(g);
  };

  switch (kind) {
    case 'tree': {
      const trunkH = 1.5 + rng() * 1.0;
      box(0.3, trunkH, 0.3, 0, 0, 0, 0x5a3a20); // trunk
      box(1.0 + rng() * 0.5, 1.0 + rng() * 0.5, 1.0 + rng() * 0.5, 0, trunkH, 0, 0x2a6a20 + Math.floor(rng() * 0x101010)); // crown
      break;
    }
    case 'palm': {
      const trunkH = 2.0 + rng() * 1.0;
      box(0.2, trunkH, 0.2, 0, 0, 0, 0x8a7050); // trunk
      // Fronds
      for (let f = 0; f < 3; f++) {
        const angle = (f / 3) * Math.PI * 2 + rng() * 0.5;
        const frondGeo = new THREE.BoxGeometry(1.2 * scale, 0.1 * scale, 0.4 * scale);
        frondGeo.translate(0.6 * scale, 0, 0);
        frondGeo.rotateY(angle);
        frondGeo.rotateX(-0.3);
        frondGeo.translate(0, (trunkH + 0.1) * scale, 0);
        const cols = new Float32Array(frondGeo.attributes.position.count * 3);
        const fc = new THREE.Color(0x20a028);
        for (let i = 0; i < cols.length; i += 3) { cols[i] = fc.r; cols[i + 1] = fc.g; cols[i + 2] = fc.b; }
        frondGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        parts.push(frondGeo);
      }
      break;
    }
    case 'pine': {
      const trunkH = 1.0 + rng() * 0.5;
      box(0.25, trunkH, 0.25, 0, 0, 0, 0x403830); // trunk
      // Tiered foliage
      for (let t = 0; t < 3; t++) {
        const sz = (1.2 - t * 0.3) * (0.8 + rng() * 0.4);
        box(sz, 0.5, sz, 0, trunkH + t * 0.4, 0, 0x1a5030 + Math.floor(rng() * 0x080808));
      }
      break;
    }
    case 'cactus': {
      const bodyH = 1.5 + rng() * 1.0;
      box(0.4, bodyH, 0.4, 0, 0, 0, 0x4a7a30); // body
      // Arm
      box(0.8, 0.3, 0.3, 0.5, bodyH * 0.5, 0, 0x5a8838);
      box(0.3, 0.6, 0.3, 0.8, bodyH * 0.5 + 0.3, 0, 0x5a8838);
      break;
    }
    case 'rock': {
      const sz = 0.5 + rng() * 0.8;
      box(sz, sz * 0.6, sz * 0.8, 0, 0, 0, 0x707070 + Math.floor(rng() * 0x202020));
      break;
    }
    case 'flower': {
      // Stem + colorful top
      box(0.1, 0.5, 0.1, 0, 0, 0, 0x3a7a28); // stem
      const flowerColors = [0xe04040, 0xe0e040, 0x8040e0, 0xe080a0, 0x40a0e0, 0xff60c0, 0xa060ff];
      box(0.35, 0.25, 0.35, 0, 0.5, 0, flowerColors[Math.floor(rng() * flowerColors.length)]);
      break;
    }
  }

  // Merge parts
  const merged = mergeBufferGeometries(parts);
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.85,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = true;
  return mesh;
}

/** Merge multiple BufferGeometries into one (with vertex colors). */
function mergeBufferGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIdx = 0;
  for (const g of geos) {
    totalVerts += g.attributes.position.count;
    totalIdx += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(totalVerts * 3);
  const col = new Float32Array(totalVerts * 3);
  const idx = new Uint32Array(totalIdx);
  let vOff = 0, iOff = 0, vBase = 0;
  for (const g of geos) {
    const p = g.attributes.position;
    const c = g.attributes.color;
    for (let i = 0; i < p.count * 3; i++) {
      pos[vOff * 3 + i] = (p.array as Float32Array)[i];
      col[vOff * 3 + i] = c ? (c.array as Float32Array)[i] : 0.5;
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) {
        idx[iOff + i] = g.index.array[i] + vBase;
      }
      iOff += g.index.count;
    } else {
      for (let i = 0; i < p.count; i++) idx[iOff + i] = vBase + i;
      iOff += p.count;
    }
    vBase += p.count;
    vOff += p.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  merged.setIndex(new THREE.BufferAttribute(idx, 1));
  merged.computeVertexNormals();
  return merged;
}

// ── OverworldMap class ──────────────────────────────────────────────

export class OverworldMap {
  readonly group = new THREE.Group();
  private tiles: TileData[] = [];
  private tileDefs: OverworldTileDef[] = [];
  private poiMeshes: THREE.Object3D[] = [];
  private scramblers: TextScramble[] = [];
  private disposed = false;
  /** Updated externally each frame for proximity-based label toggling. */
  playerPos: { x: number; z: number } | null = null;

  constructor(private baseSeed: number) {}

  // ── Build all 9 tiles ─────────────────────────────────────────────

  build(): OverworldTileDef[] {
    this.tileDefs = generateOverworldTiles(this.baseSeed);

    // First: generate all heightmaps at full scale, then post-scale to mini size
    const heightResults: { heights: Float32Array; config: HeightmapStyleConfig; palette: TerrainPalette; cx: number; cz: number; waterY: number; actualMaxH: number }[] = [];
    for (const def of this.tileDefs) {
      const { cx, cz } = tileCenterWorld(def.row, def.col);
      const palette = palettes[def.paletteName] ?? randomPalette(def.seed).palette;
      const config = getMiniConfig(def.heightmapStyle);
      const result = generateHeightmap(config, OW_TILE_SIZE, def.seed);
      // Post-scale heights to mini tile proportions
      const actualMaxH = rescaleHeights(result.heights, OW_TILE_SIZE);
      // Compute water level from rescaled height data
      const waterY = computeWaterY(result.heights, def.heightmapStyle);
      heightResults.push({ heights: result.heights, config, palette, cx, cz, waterY, actualMaxH });
    }

    // Anchor each tile at its bottom (shift so min height = 0)
    // Store per-tile Y offset so stitching can work in world space
    const tileYOffset: number[] = [];
    for (const hr of heightResults) {
      let minH = Infinity;
      for (let i = 0; i < hr.heights.length; i++) {
        if (hr.heights[i] < minH) minH = hr.heights[i];
      }
      tileYOffset.push(-minH);
      for (let i = 0; i < hr.heights.length; i++) hr.heights[i] -= minH;
      hr.waterY -= minH;
    }

    // Flatten terrain around POIs
    for (let i = 0; i < this.tileDefs.length; i++) {
      const def = this.tileDefs[i];
      const { heights, waterY } = heightResults[i];
      flattenHeightmapForPOIs(heights, MINI_RESOLUTION, OW_TILE_SIZE, def.pois, waterY);
    }

    // Stitch adjacent tile edges — average in world space (local + offset), write back as local
    this.stitchTileEdgesWithOffsets(
      heightResults.map(h => h.heights), MINI_RESOLUTION, tileYOffset,
    );

    // Now build meshes from stitched + flattened heightmaps
    for (let i = 0; i < this.tileDefs.length; i++) {
      const def = this.tileDefs[i];
      const { heights, config, palette, cx, cz, waterY, actualMaxH } = heightResults[i];
      const res = config.resolution;

      const { mesh, colors, positions } = this.buildTileMesh(
        heights, res, OW_TILE_SIZE, actualMaxH, palette, cx, cz, waterY,
      );

      const skirtMesh = this.buildSkirt(
        heights, positions, colors, res, OW_TILE_SIZE, actualMaxH, palette, cx, cz,
      );

      // Mini water plane per tile at tile-specific water level
      const waterMesh = this.buildMiniWater(heights, res, palette, cx, cz, waterY);

      this.group.add(mesh);
      this.group.add(skirtMesh);
      if (waterMesh) this.group.add(waterMesh);

      this.tiles.push({
        def,
        heights,
        resolution: res,
        groundSize: OW_TILE_SIZE,
        maxHeight: actualMaxH,
        cx, cz,
        mesh,
        skirtMesh,
        waterMesh,
        waterY,
        palette,
        nature: null,
      });
    }

    return this.tileDefs;
  }

  /** Stitch shared edges between adjacent tiles by averaging border heights.
   *  Works in world space (local height + per-tile Y offset), writes back as local. */
  private stitchTileEdgesWithOffsets(
    allHeights: Float32Array[], resolution: number, offsets: number[],
  ): void {
    const verts = resolution + 1;

    for (let row = 0; row < OW_GRID; row++) {
      for (let col = 0; col < OW_GRID; col++) {
        const idxA = row * OW_GRID + col;
        const hA = allHeights[idxA];
        const oA = offsets[idxA];

        // Stitch right edge of A with left edge of B (horizontal neighbor)
        if (col < OW_GRID - 1) {
          const idxB = idxA + 1;
          const hB = allHeights[idxB];
          const oB = offsets[idxB];
          for (let iz = 0; iz < verts; iz++) {
            const ai = iz * verts + resolution;
            const bi = iz * verts + 0;
            const worldAvg = ((hA[ai] + oA) + (hB[bi] + oB)) * 0.5;
            hA[ai] = worldAvg - oA;
            hB[bi] = worldAvg - oB;
          }
        }

        // Stitch bottom edge of A with top edge of B (vertical neighbor)
        if (row < OW_GRID - 1) {
          const idxB = idxA + OW_GRID;
          const hB = allHeights[idxB];
          const oB = offsets[idxB];
          for (let ix = 0; ix < verts; ix++) {
            const ai = resolution * verts + ix;
            const bi = 0 * verts + ix;
            const worldAvg = ((hA[ai] + oA) + (hB[bi] + oB)) * 0.5;
            hA[ai] = worldAvg - oA;
            hB[bi] = worldAvg - oB;
          }
        }
      }
    }
  }

  // ── Nature props per tile ─────────────────────────────────────────

  /** Place a few representative biome props on each tile (1-3 tiny meshes). */
  generateNatureForTiles(): void {
    for (const tile of this.tiles) {
      const biome = paletteBiome[tile.def.paletteName] ?? 'temperate';
      const group = new THREE.Group();
      group.name = 'miniNature';

      const rng = mulberry32(tile.def.seed + 7777);
      const S = 0.12; // base scale for mini props on 4m tiles

      // Biome-specific props
      const props = BIOME_PROPS[biome] ?? BIOME_PROPS.temperate;
      const count = props.minCount + Math.floor(rng() * (props.maxCount - props.minCount + 1));

      // POI exclusion zones (don't place nature on castles/dungeons)
      const poiExcl = tile.def.pois.map(p => ({ nx: p.nx, nz: p.nz, r: 0.2 }));

      for (let i = 0; i < count; i++) {
        // Find a valid position (not too steep, above water, not on POI)
        let lx = 0, lz = 0, h = 0;
        let valid = false;
        for (let attempt = 0; attempt < 20; attempt++) {
          lx = (rng() - 0.5) * tile.groundSize * 0.7;
          lz = (rng() - 0.5) * tile.groundSize * 0.7;
          h = sampleHeightmap(tile.heights, tile.resolution, tile.groundSize, lx, lz);
          if (h < tile.waterY + 0.03) continue; // underwater
          // Check POI exclusion
          const nx = lx / tile.groundSize;
          const nz = lz / tile.groundSize;
          let blocked = false;
          for (const p of poiExcl) {
            const dx = nx - p.nx, dz = nz - p.nz;
            if (dx * dx + dz * dz < p.r * p.r) { blocked = true; break; }
          }
          if (blocked) continue;
          valid = true;
          break;
        }
        if (!valid) continue;

        const kind = props.types[Math.floor(rng() * props.types.length)];
        const mesh = buildMiniProp(kind, rng, S);
        mesh.position.set(tile.cx + lx, h, tile.cz + lz);
        mesh.rotation.y = rng() * Math.PI * 2;
        group.add(mesh);
      }

      this.group.add(group);
      // Store as nature for disposal
      tile.nature = {
        group,
        treePositions: [],
        rockPositions: [],
        patchThreshold: 0,
        treePatch: () => 0,
        rockPatch: () => 0,
        flowerPatch: () => 0,
        hasTrees: false,
        hasRocks: false,
        hasFlowers: false,
        dispose: () => {
          group.traverse(c => {
            if (c instanceof THREE.Mesh) {
              c.geometry.dispose();
              (c.material as THREE.Material).dispose();
            }
          });
        },
      };
    }
  }

  // ── POI markers on tiles ─────────────────────────────────────────

  /** Place small POI markers on overworld tiles. Call after build(). */
  generatePOIMarkers(): void {
    const MINI_SCALE = 0.05; // base scale for mini markers on 4m tiles

    for (const tile of this.tiles) {
      for (const poi of tile.def.pois) {
        // Convert normalized pos → world pos on mini tile
        const wx = tile.cx + poi.nx * OW_TILE_SIZE;
        const wz = tile.cz + poi.nz * OW_TILE_SIZE;
        // Sample tile heightmap for Y
        const lx = poi.nx * OW_TILE_SIZE;
        const lz = poi.nz * OW_TILE_SIZE;
        const y = sampleHeightmap(
          tile.heights, tile.resolution, tile.groundSize, lx, lz,
        );

        let marker: THREE.Group;
        if (poi.type === 'village') {
          marker = buildMiniCastle(poi.poiSeed, MINI_SCALE);
        } else {
          marker = buildMiniDungeonMarker(poi.poiSeed, MINI_SCALE);
        }

        marker.position.set(wx, y, wz);
        // Random Y rotation
        marker.rotation.y = ((poi.poiSeed & 0xFF) / 255) * Math.PI * 2;
        this.group.add(marker);
        this.poiMeshes.push(marker);

        // Floating label — single sprite, scrambles between short/full text on proximity
        {
          const isDungeon = poi.type === 'dungeon';
          const skullStr = isDungeon && poi.skulls
            ? '\u2620'.repeat(Math.min(poi.skulls, 3))
            : '';
          const labelColor = isDungeon ? '#dd9966' : '#ffe8a0';
          const labelH = 0.18;
          const labelY = y + (isDungeon ? 0.3 : 0.35);
          const labelOffset = 0.3;

          const shortText = isDungeon ? skullStr : poi.name;
          const fullText = isDungeon && skullStr ? `${skullStr} ${poi.name}` : poi.name;

          const label = createTextLabel(shortText, {
            color: labelColor, height: labelH, depthTest: false, renderOrder: 900,
          });
          label.position.set(wx, labelY, wz);

          // Set up scrambler for dungeons
          let scrambler: TextScramble | null = null;
          if (isDungeon && skullStr) {
            scrambler = new TextScramble(shortText, 250);
            scrambler.onChange = (text) => updateTextLabel(label, text);
            this.scramblers.push(scrambler);
          }

          const proximityRadius = 1; // world units
          let wasNear = false;
          label.onBeforeRender = (_r: any, _s: any, camera: THREE.Camera) => {
            // Push toward camera
            const dx = camera.position.x - wx;
            const dz = camera.position.z - wz;
            const len = Math.sqrt(dx * dx + dz * dz);
            if (len > 0.01) {
              const ox = (dx / len) * labelOffset;
              const oz = (dz / len) * labelOffset;
              label.position.x = wx + ox;
              label.position.z = wz + oz;
            }
            // Scramble between short/full based on player proximity
            if (scrambler && this.playerPos) {
              const pdx = this.playerPos.x - wx;
              const pdz = this.playerPos.z - wz;
              const near = pdx * pdx + pdz * pdz < proximityRadius * proximityRadius;
              if (near !== wasNear) {
                wasNear = near;
                scrambler.scrambleTo(near ? fullText : shortText);
              }
            }
          };
          this.group.add(label);
          this.poiMeshes.push(label);
        }
      }
    }
  }


  // ── Height query ──────────────────────────────────────────────────

  /** Get terrain Y at world position. Returns 0 if in a gap. */
  getTerrainY(wx: number, wz: number): number {
    for (const tile of this.tiles) {
      const half = OW_TILE_SIZE / 2;
      const lx = wx - tile.cx;
      const lz = wz - tile.cz;
      if (Math.abs(lx) <= half && Math.abs(lz) <= half) {
        return sampleHeightmap(
          tile.heights, tile.resolution, tile.groundSize, lx, lz,
        );
      }
    }
    return 0; // gap area
  }

  // ── NavGrid ───────────────────────────────────────────────────────

  /** Build a single NavGrid spanning all tiles. Gap cells are blocked,
   *  bridge nav-links connect adjacent tile edges. */
  buildNavGrid(stepHeight: number, cellSize = 0.25): NavGrid {
    const grid = new NavGrid(OW_TOTAL_SIZE, OW_TOTAL_SIZE, cellSize);
    grid.initCells();

    // First pass: set surface heights for tile cells, unblock them
    for (let gz = 0; gz < grid.height; gz++) {
      for (let gx = 0; gx < grid.width; gx++) {
        const cell = grid.getCell(gx, gz);
        if (!cell) continue;
        const wx = cell.worldX;
        const wz = cell.worldZ;

        for (const tile of this.tiles) {
          const half = OW_TILE_SIZE / 2;
          const lx = wx - tile.cx;
          const lz = wz - tile.cz;
          if (Math.abs(lx) <= half && Math.abs(lz) <= half) {
            const h = sampleHeightmap(
              tile.heights, tile.resolution, tile.groundSize, lx, lz,
            );
            cell.surfaceHeight = h;
            cell.blocked = false;
            break;
          }
        }
      }
    }

    // Second pass: compute passability based on slope (same as heightmap NavGrid)
    const hmCellSize = OW_TILE_SIZE / MINI_RESOLUTION;
    const eps = hmCellSize * 0.5;
    const effectiveSlopeHeight = stepHeight * 2;
    const maxSlope = (effectiveSlopeHeight / hmCellSize) * 0.45;
    const DIR_DGX = [0, 1, 1, 1, 0, -1, -1, -1];
    const DIR_DGZ = [-1, -1, 0, 1, 1, 1, 0, -1];

    for (let gz = 0; gz < grid.height; gz++) {
      for (let gx = 0; gx < grid.width; gx++) {
        const cell = grid.getCell(gx, gz);
        if (!cell || cell.blocked) continue;

        let passable = 0;
        for (let dir = 0; dir < 8; dir++) {
          const ngx = gx + DIR_DGX[dir];
          const ngz = gz + DIR_DGZ[dir];
          const neighbor = grid.getCell(ngx, ngz);
          if (!neighbor || neighbor.blocked) continue;

          const heightDiff = Math.abs(neighbor.surfaceHeight - cell.surfaceHeight);
          if (heightDiff <= stepHeight) {
            passable |= (1 << dir);
          }
        }
        cell.passable = passable;
      }
    }

    // Third pass: bridge nav-links at tile borders
    const BRIDGE_COST = 2;
    for (const tile of this.tiles) {
      const { row, col } = tile.def;

      // Check right neighbor
      if (col < OW_GRID - 1) {
        this.addBridgeLinks(grid, tile, this.tiles[(row * OW_GRID) + col + 1], 'horizontal', BRIDGE_COST);
      }
      // Check bottom neighbor
      if (row < OW_GRID - 1) {
        this.addBridgeLinks(grid, tile, this.tiles[((row + 1) * OW_GRID) + col], 'vertical', BRIDGE_COST);
      }
    }

    grid.bakeSpawnRegion();
    return grid;
  }

  /** Add nav-link bridges between two adjacent tiles. */
  private addBridgeLinks(
    grid: NavGrid,
    tileA: TileData,
    tileB: TileData,
    direction: 'horizontal' | 'vertical',
    cost: number,
  ): void {
    const halfTile = OW_TILE_SIZE / 2;
    const bridgeCount = 5; // number of bridge points along the shared edge

    for (let i = 0; i < bridgeCount; i++) {
      const t = ((i + 0.5) / bridgeCount - 0.5) * OW_TILE_SIZE;

      let ax: number, az: number, bx: number, bz: number;
      if (direction === 'horizontal') {
        // A is left, B is right
        ax = tileA.cx + halfTile - 0.1;
        az = tileA.cz + t;
        bx = tileB.cx - halfTile + 0.1;
        bz = tileB.cz + t;
      } else {
        // A is top, B is bottom
        ax = tileA.cx + t;
        az = tileA.cz + halfTile - 0.1;
        bx = tileB.cx + t;
        bz = tileB.cz - halfTile + 0.1;
      }

      const cellA = grid.worldToGrid(ax, az);
      const cellB = grid.worldToGrid(bx, bz);
      const cA = grid.getCell(cellA.gx, cellA.gz);
      const cB = grid.getCell(cellB.gx, cellB.gz);
      if (cA && !cA.blocked && cB && !cB.blocked) {
        grid.addNavLink(cellA.gx, cellA.gz, cellB.gx, cellB.gz, cost, -1);
      }
    }
  }

  // ── Tile defs accessor ────────────────────────────────────────────

  getTileDefs(): OverworldTileDef[] {
    return this.tileDefs;
  }

  getTileCount(): number {
    return this.tiles.length;
  }

  getTileData(index: number): TileData | undefined {
    return this.tiles[index];
  }

  // ── Mesh building ─────────────────────────────────────────────────

  private buildTileMesh(
    heights: Float32Array,
    res: number,
    groundSize: number,
    maxHeight: number,
    palette: TerrainPalette,
    offsetX: number,
    offsetZ: number,
    waterY: number = -0.05,
  ): { mesh: THREE.Mesh; colors: Float32Array; positions: Float32Array } {
    const verts = res + 1;
    const cellSize = groundSize / res;
    const halfGround = groundSize / 2;

    const positions = new Float32Array(verts * verts * 3);
    const colors = new Float32Array(verts * verts * 3);
    const indices: number[] = [];

    const colorFlat = new THREE.Color(palette.flat);
    const colorGentleSlope = new THREE.Color(palette.gentleSlope);
    const colorSteepSlope = new THREE.Color(palette.steepSlope);
    const colorCliff = new THREE.Color(palette.cliff);
    const colorSand = new THREE.Color(palette.sand);
    const colorWetSand = new THREE.Color(palette.wetSand);
    const tmpColor = new THREE.Color();
    const beachTop = waterY + maxHeight * 0.12;   // sand zone above water
    const beachBot = waterY - maxHeight * 0.03;   // wet sand zone below water

    const hmCellSize = groundSize / res;
    const eps = hmCellSize * 0.5;
    const maxPassableSlope = (0.75 / hmCellSize) * 0.4;

    // Positions
    for (let z = 0; z < verts; z++) {
      for (let x = 0; x < verts; x++) {
        const idx = z * verts + x;
        const h = heights[idx];
        const wx = x * cellSize - halfGround + offsetX;
        const wz = z * cellSize - halfGround + offsetZ;
        positions[idx * 3] = wx;
        positions[idx * 3 + 1] = h;
        positions[idx * 3 + 2] = wz;
      }
    }

    // Colors (slope-based)
    for (let z = 0; z < verts; z++) {
      for (let x = 0; x < verts; x++) {
        const idx = z * verts + x;
        const hC = heights[idx];
        const lx = x * cellSize - halfGround;
        const lz = z * cellSize - halfGround;

        const hL = sampleHeightmap(heights, res, groundSize, lx - eps, lz);
        const hR = sampleHeightmap(heights, res, groundSize, lx + eps, lz);
        const hU = sampleHeightmap(heights, res, groundSize, lx, lz - eps);
        const hD = sampleHeightmap(heights, res, groundSize, lx, lz + eps);

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

        // Per-terrace color variation
        if (slopeRatio < 0.9) {
          const terraceStep = maxHeight / 4;
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

        // Beach coloring near water level
        if (hC < beachTop && slopeRatio < 1.0) {
          if (hC < beachBot) {
            tmpColor.copy(colorWetSand);
          } else if (hC < waterY) {
            const t = (hC - beachBot) / (waterY - beachBot);
            tmpColor.copy(colorWetSand).lerp(colorSand, t);
          } else {
            const t = (hC - waterY) / (beachTop - waterY);
            tmpColor.copy(colorSand).lerp(colorFlat, t);
          }
        }

        const heightVar = 0.94 + 0.12 * (hC / Math.max(maxHeight, 1));
        tmpColor.multiplyScalar(heightVar);

        colors[idx * 3] = tmpColor.r;
        colors[idx * 3 + 1] = tmpColor.g;
        colors[idx * 3 + 2] = tmpColor.b;
      }
    }

    // Indices
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

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    return { mesh, colors, positions };
  }

  /** Water mesh that matches tile resolution. Flat at waterY in the interior,
   *  but conforms to terrain at tile edges so adjacent tiles with different
   *  water levels don't show floating water. */
  private buildMiniWater(
    heights: Float32Array,
    res: number,
    palette: TerrainPalette,
    cx: number,
    cz: number,
    waterY: number = -0.05,
  ): THREE.Mesh {
    const verts = res + 1;
    const cellSize = OW_TILE_SIZE / res;
    const halfGround = OW_TILE_SIZE / 2;
    const BLEND = 2; // rows to blend from edge inward

    const positions = new Float32Array(verts * verts * 3);
    const indices: number[] = [];

    for (let z = 0; z < verts; z++) {
      for (let x = 0; x < verts; x++) {
        const idx = z * verts + x;
        const wx = x * cellSize - halfGround + cx;
        const wz = z * cellSize - halfGround + cz;
        const terrainH = heights[idx];

        // Distance to nearest edge (in grid cells)
        const edgeDist = Math.min(x, z, res - x, res - z);

        let y: number;
        if (edgeDist >= BLEND) {
          // Interior: flat water level
          y = waterY;
        } else {
          // Edge blend: lerp from terrain height to waterY
          const t = edgeDist / BLEND; // 0 at edge, 1 at blend boundary
          y = terrainH + (waterY - terrainH) * (t * t); // ease-in
        }

        positions[idx * 3] = wx;
        positions[idx * 3 + 1] = y;
        positions[idx * 3 + 2] = wz;
      }
    }

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

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const shallowColor = new THREE.Color(palette.waterShallow);
    const deepColor = new THREE.Color(palette.waterDeep);
    const waterColor = shallowColor.clone().lerp(deepColor, 0.3);

    const mat = new THREE.MeshStandardMaterial({
      color: waterColor,
      transparent: true,
      opacity: 0.7,
      roughness: 0.2,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildSkirt(
    heights: Float32Array,
    positions: Float32Array,
    colors: Float32Array,
    res: number,
    groundSize: number,
    _maxHeight: number,
    palette: TerrainPalette,
    offsetX: number,
    offsetZ: number,
  ): THREE.Mesh {
    const verts = res + 1;
    const cellSize = groundSize / res;
    const halfGround = groundSize / 2;

    // All tiles are bottom-anchored (min height = 0), so use a fixed skirt base
    const baseY = -0.3;

    const skirtColor = new THREE.Color(palette.cliff);
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

    const sc = skirtColor;

    // Left edge (x = -halfGround)
    for (let z = 0; z < res; z++) {
      const tl = z * verts;
      const bl = (z + 1) * verts;
      const z0 = z * cellSize - halfGround + offsetZ;
      const z1 = (z + 1) * cellSize - halfGround + offsetZ;
      const x = -halfGround + offsetX;
      pushQuad(
        x, baseY, z0, sc.r, sc.g, sc.b,
        x, baseY, z1, sc.r, sc.g, sc.b,
        positions[bl * 3], positions[bl * 3 + 1], positions[bl * 3 + 2],
        colors[bl * 3], colors[bl * 3 + 1], colors[bl * 3 + 2],
        positions[tl * 3], positions[tl * 3 + 1], positions[tl * 3 + 2],
        colors[tl * 3], colors[tl * 3 + 1], colors[tl * 3 + 2],
      );
    }

    // Right edge (x = +halfGround)
    for (let z = 0; z < res; z++) {
      const tl = z * verts + res;
      const bl = (z + 1) * verts + res;
      const z0 = z * cellSize - halfGround + offsetZ;
      const z1 = (z + 1) * cellSize - halfGround + offsetZ;
      const x = halfGround + offsetX;
      pushQuad(
        x, baseY, z1, sc.r, sc.g, sc.b,
        x, baseY, z0, sc.r, sc.g, sc.b,
        positions[tl * 3], positions[tl * 3 + 1], positions[tl * 3 + 2],
        colors[tl * 3], colors[tl * 3 + 1], colors[tl * 3 + 2],
        positions[bl * 3], positions[bl * 3 + 1], positions[bl * 3 + 2],
        colors[bl * 3], colors[bl * 3 + 1], colors[bl * 3 + 2],
      );
    }

    // Top edge (z = -halfGround)
    for (let x = 0; x < res; x++) {
      const tl = x;
      const tr = x + 1;
      const x0 = x * cellSize - halfGround + offsetX;
      const x1 = (x + 1) * cellSize - halfGround + offsetX;
      const z = -halfGround + offsetZ;
      pushQuad(
        x0, baseY, z, sc.r, sc.g, sc.b,
        x1, baseY, z, sc.r, sc.g, sc.b,
        positions[tr * 3], positions[tr * 3 + 1], positions[tr * 3 + 2],
        colors[tr * 3], colors[tr * 3 + 1], colors[tr * 3 + 2],
        positions[tl * 3], positions[tl * 3 + 1], positions[tl * 3 + 2],
        colors[tl * 3], colors[tl * 3 + 1], colors[tl * 3 + 2],
      );
    }

    // Bottom edge (z = +halfGround)
    for (let x = 0; x < res; x++) {
      const tl = res * verts + x;
      const tr = res * verts + x + 1;
      const x0 = x * cellSize - halfGround + offsetX;
      const x1 = (x + 1) * cellSize - halfGround + offsetX;
      const z = halfGround + offsetZ;
      pushQuad(
        x1, baseY, z, sc.r, sc.g, sc.b,
        x0, baseY, z, sc.r, sc.g, sc.b,
        positions[tl * 3], positions[tl * 3 + 1], positions[tl * 3 + 2],
        colors[tl * 3], colors[tl * 3 + 1], colors[tl * 3 + 2],
        positions[tr * 3], positions[tr * 3 + 1], positions[tr * 3 + 2],
        colors[tr * 3], colors[tr * 3 + 1], colors[tr * 3 + 2],
      );
    }

    // Bottom face (close the bottom)
    {
      const minX = -halfGround + offsetX;
      const maxX = halfGround + offsetX;
      const minZ = -halfGround + offsetZ;
      const maxZ = halfGround + offsetZ;
      pushQuad(
        minX, baseY, minZ, sc.r, sc.g, sc.b,
        maxX, baseY, minZ, sc.r, sc.g, sc.b,
        maxX, baseY, maxZ, sc.r, sc.g, sc.b,
        minX, baseY, maxZ, sc.r, sc.g, sc.b,
      );
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(skirtPositions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(skirtColors, 3));
    geo.setIndex(skirtIndices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  // ── Cleanup ───────────────────────────────────────────────────────

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const tile of this.tiles) {
      tile.mesh.geometry.dispose();
      (tile.mesh.material as THREE.Material).dispose();
      tile.skirtMesh.geometry.dispose();
      (tile.skirtMesh.material as THREE.Material).dispose();
      if (tile.waterMesh) {
        tile.waterMesh.geometry.dispose();
        (tile.waterMesh.material as THREE.Material).dispose();
      }
      if (tile.nature) {
        tile.nature.dispose();
      }
    }

    // Dispose POI markers
    for (const obj of this.poiMeshes) {
      obj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
        }
      });
    }
    this.poiMeshes = [];

    // Dispose text scramblers
    for (const s of this.scramblers) s.dispose();
    this.scramblers = [];

    // Remove all children from group
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }

    this.tiles = [];
  }
}
