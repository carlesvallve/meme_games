/**
 * TerrainNoise — Pure TypeScript noise + heightmap utilities.
 * No Three.js dependency. Generates vertex-based heightmaps from noise
 * algorithms and provides bilinear interpolation for height queries.
 */

import type { LadderDef } from '../dungeon';

export interface HeightmapResult {
  heights: Float32Array;
  ladders: LadderDef[];
  rampCells: Set<number>;
  seed: number;
}

// ── Seeded permutation table ────────────────────────────────────────

function buildPerm(seed: number): Uint8Array {
  const p = new Uint8Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed | 0;
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) | 0;
    const j = ((s >>> 0) % (i + 1));
    const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
  }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  return p;
}

// ── Seeded RNG ──────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Noise algorithms ────────────────────────────────────────────────

function smoothstep(t: number): number { return t * t * (3 - 2 * t); }

function valueNoise2D(x: number, z: number, perm: Uint8Array): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const tx = smoothstep(x - xi);
  const tz = smoothstep(z - zi);
  const ix = xi & 255;
  const iz = zi & 255;
  const v00 = perm[perm[ix] + iz] / 255;
  const v10 = perm[perm[(ix + 1) & 255] + iz] / 255;
  const v01 = perm[perm[ix] + ((iz + 1) & 255)] / 255;
  const v11 = perm[perm[(ix + 1) & 255] + ((iz + 1) & 255)] / 255;
  const a = v00 + tx * (v10 - v00);
  const b = v01 + tx * (v11 - v01);
  return a + tz * (b - a);
}

function fbm(
  x: number, z: number, perm: Uint8Array,
  octaves: number, lacunarity: number, persistence: number,
): number {
  let value = 0, amplitude = 1, frequency = 1, maxAmp = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise2D(x * frequency, z * frequency, perm) * amplitude;
    maxAmp += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / maxAmp;
}

// ── Diamond-square ──────────────────────────────────────────────────

function diamondSquare(size: number, roughness: number, seed: number): Float32Array {
  const n = size;
  const grid = new Float32Array(n * n);
  const rng = mulberry32(seed);
  const g = (x: number, z: number) => grid[z * n + x];
  const s = (x: number, z: number, v: number) => { grid[z * n + x] = v; };

  s(0, 0, rng()); s(n - 1, 0, rng()); s(0, n - 1, rng()); s(n - 1, n - 1, rng());

  let step = n - 1;
  let scale = roughness;

  while (step > 1) {
    const half = step >> 1;
    for (let z = 0; z < n - 1; z += step) {
      for (let x = 0; x < n - 1; x += step) {
        const avg = (g(x, z) + g(x + step, z) + g(x, z + step) + g(x + step, z + step)) / 4;
        s(x + half, z + half, avg + (rng() - 0.5) * scale);
      }
    }
    for (let z = 0; z < n; z += half) {
      for (let x = ((z / half) % 2 === 0 ? half : 0); x < n; x += step) {
        let sum = 0, count = 0;
        if (z >= half)     { sum += g(x, z - half); count++; }
        if (z + half < n)  { sum += g(x, z + half); count++; }
        if (x >= half)     { sum += g(x - half, z); count++; }
        if (x + half < n)  { sum += g(x + half, z); count++; }
        s(x, z, sum / count + (rng() - 0.5) * scale);
      }
    }
    step = half;
    scale *= 0.5;
  }

  // Normalise to [0,1]
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] < min) min = grid[i];
    if (grid[i] > max) max = grid[i];
  }
  const range = max - min || 1;
  for (let i = 0; i < grid.length; i++) grid[i] = (grid[i] - min) / range;

  return grid;
}

// ── Cellular automata (cave generation) ─────────────────────────────

/** Generate a cave layout using cellular automata.
 *  Returns a grid where 1 = wall, 0 = open space.
 *  Uses B5678/S45678 rule set for natural-looking connected caves. */
function cellularAutomata(
  width: number, height: number,
  fillChance: number, iterations: number, seed: number,
): Uint8Array {
  const rng = mulberry32(seed);
  const grid = new Uint8Array(width * height);

  // Random fill
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      // Force borders to be walls
      if (x === 0 || x === width - 1 || z === 0 || z === height - 1) {
        grid[z * width + x] = 1;
      } else {
        grid[z * width + x] = rng() < fillChance ? 1 : 0;
      }
    }
  }

  // Iterate cellular automata
  const next = new Uint8Array(width * height);
  for (let iter = 0; iter < iterations; iter++) {
    for (let z = 1; z < height - 1; z++) {
      for (let x = 1; x < width - 1; x++) {
        let neighbors = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            neighbors += grid[(z + dz) * width + (x + dx)];
          }
        }
        // Wall if >= 5 neighbors, OR currently wall with >= 4 neighbors
        next[z * width + x] = (neighbors >= 5 || (grid[z * width + x] === 1 && neighbors >= 4)) ? 1 : 0;
      }
    }
    // Keep borders as walls
    for (let x = 0; x < width; x++) {
      next[x] = 1;
      next[(height - 1) * width + x] = 1;
    }
    for (let z = 0; z < height; z++) {
      next[z * width] = 1;
      next[z * width + width - 1] = 1;
    }
    grid.set(next);
  }

  return grid;
}

// ── Heightmap style configs ─────────────────────────────────────────

export type HeightmapStyle = 'rolling' | 'terraces' | 'islands' | 'caves';

export interface HeightmapStyleConfig {
  resolution: number;
  maxHeight: number;
  octaves: number;
  lacunarity: number;
  persistence: number;
  mask: 'none' | 'circle' | 'donut';
  invert: boolean;
  algorithm: 'fbm' | 'diamond-square' | 'islands' | 'caves';
  /** If > 0, quantize heights to this step (creates terrace/plateau effect) */
  quantizeStep: number;
  /** If > 0, posterize noise into N levels before quantizing.
   *  This creates sharp cliff edges between plateaus instead of gradual 0.5m steps. */
  posterize: number;
}

const HEIGHTMAP_STYLES: Record<HeightmapStyle, HeightmapStyleConfig> = {
  rolling: {
    resolution: 72,
    maxHeight: 2.0,
    octaves: 5,
    lacunarity: 2.0,
    persistence: 0.5,
    mask: 'none',
    invert: false,
    algorithm: 'fbm',
    quantizeStep: 0,
    posterize: 0,
  },
  terraces: {
    resolution: 72,
    maxHeight: 6.0,
    octaves: 2,
    lacunarity: 2.0,
    persistence: 0.35,
    mask: 'none',
    invert: false,
    algorithm: 'fbm',
    quantizeStep: 0.25,
    posterize: 6,
  },
  islands: {
    resolution: 72,
    maxHeight: 7.0,
    octaves: 5,
    lacunarity: 2.0,
    persistence: 0.55,
    mask: 'none',
    invert: false,
    algorithm: 'islands',
    quantizeStep: 0.25,
    posterize: 10,
  },
  caves: {
    resolution: 72,
    maxHeight: 2.5,
    octaves: 3,
    lacunarity: 2.0,
    persistence: 0.45,
    mask: 'none',
    invert: false,
    algorithm: 'caves',
    quantizeStep: 0,
    posterize: 0,
  },
};

export function getHeightmapConfig(style: HeightmapStyle): HeightmapStyleConfig {
  return HEIGHTMAP_STYLES[style];
}

// ── Heightmap generation ────────────────────────────────────────────

/**
 * Generate a vertex-based heightmap: (resolution+1) × (resolution+1) Float32Array.
 * `resolution` = number of cells; vertices = resolution + 1 per axis.
 */
export function generateHeightmap(
  config: HeightmapStyleConfig,
  groundSize: number,
  seed?: number,
  resolutionScale = 1,
): HeightmapResult {
  const baseRes = config.resolution;
  const { maxHeight, algorithm, quantizeStep } = config;
  const actualSeed = seed ?? (Date.now() & 0xffff);

  // Always generate terrain at BASE resolution so the shape stays identical
  // regardless of scale. Then upsample to final resolution for mesh detail.
  const baseVerts = baseRes + 1;
  const baseGrid = new Float32Array(baseVerts * baseVerts);

  if (algorithm === 'islands') {
    generateIslands(baseGrid, baseVerts, baseRes, maxHeight, actualSeed);
  } else if (algorithm === 'caves') {
    generateCaves(baseGrid, baseVerts, baseRes, maxHeight, actualSeed, config);
  } else if (algorithm === 'diamond-square') {
    generateDiamondSquare(baseGrid, baseVerts, baseRes, actualSeed);
    applyMaskAndScale(baseGrid, baseVerts, baseRes, maxHeight, config);
  } else {
    generateFBM(baseGrid, baseVerts, baseRes, actualSeed, config);
    applyMaskAndScale(baseGrid, baseVerts, baseRes, maxHeight, config);
  }

  // Posterize: reduce to N discrete levels with random spacing.
  // Creates large flat plateaus with varied cliff heights (0.5m to 5m+).
  // Levels are randomly spaced so some jumps are small and others are sheer cliffs.
  // Done at base resolution so terrain shape is resolution-independent.
  if (config.posterize > 0) {
    const levels = config.posterize;
    let maxH = 0;
    for (let i = 0; i < baseGrid.length; i++) {
      if (baseGrid[i] > maxH) maxH = baseGrid[i];
    }
    if (maxH > 0) {
      // Generate random threshold values, sorted, snapped to quantizeStep
      const rng = mulberry32(actualSeed + 9999);
      const thresholds: number[] = [0];
      for (let i = 1; i < levels; i++) thresholds.push(rng());
      thresholds.push(1);
      thresholds.sort((a, b) => a - b);

      // Snap thresholds to quantizeStep grid
      const step = quantizeStep > 0 ? quantizeStep : 0.5;
      const snapLevels = thresholds.map(t => Math.round(t * maxH / step) * step);

      for (let i = 0; i < baseGrid.length; i++) {
        const normalized = baseGrid[i] / maxH;
        // Find which band this value falls into
        let level = 0;
        for (let j = 1; j < thresholds.length; j++) {
          if (normalized >= thresholds[j]) level = j; else break;
        }
        baseGrid[i] = snapLevels[level];
      }
    }
  }

  // Quantize heights to grid step (snaps posterized levels to 0.5m grid)
  if (quantizeStep > 0) {
    for (let i = 0; i < baseGrid.length; i++) {
      baseGrid[i] = Math.round(baseGrid[i] / quantizeStep) * quantizeStep;
    }
  }

  // Upsample to final resolution (bilinear interpolation)
  const resolution = Math.round(baseRes * resolutionScale);
  const verts = resolution + 1;
  let grid: Float32Array;

  if (resolutionScale === 1) {
    grid = baseGrid; // no upsampling needed
  } else {
    grid = new Float32Array(verts * verts);
    for (let z = 0; z < verts; z++) {
      for (let x = 0; x < verts; x++) {
        // Map final grid coords to base grid coords
        const bx = (x / resolution) * baseRes;
        const bz = (z / resolution) * baseRes;
        const ix = Math.min(Math.floor(bx), baseRes - 1);
        const iz = Math.min(Math.floor(bz), baseRes - 1);
        const fx = bx - ix;
        const fz = bz - iz;
        const h00 = baseGrid[iz * baseVerts + ix];
        const h10 = baseGrid[iz * baseVerts + ix + 1];
        const h01 = baseGrid[(iz + 1) * baseVerts + ix];
        const h11 = baseGrid[(iz + 1) * baseVerts + ix + 1];
        grid[z * verts + x] = h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) +
          h01 * (1 - fx) * fz + h11 * fx * fz;
      }
    }
  }

  // Rolling micro-variation: add subtle FBM undulation to flat posterized surfaces.
  // This makes terrace/island/cave floors feel organic instead of perfectly flat.
  // Amplitude must stay well below the terrace step height to avoid creating
  // slopes that confuse navgrid passability or break ramp connectivity.
  if (config.posterize > 0 || algorithm === 'caves') {
    const rollingPerm = buildPerm(actualSeed + 4444);
    const rollingScale = 5.0;
    const rollingRng = mulberry32(actualSeed + 5678);
    const rollingAmp = 0.4 + rollingRng() * 1.2;
    for (let z = 0; z < verts; z++) {
      for (let x = 0; x < verts; x++) {
        const noise = fbm(
          x / resolution * rollingScale, z / resolution * rollingScale,
          rollingPerm, 3, 2.0, 0.5,
        );
        grid[z * verts + x] += (noise - 0.5) * rollingAmp * 2;
      }
    }
  }

  // Carve connectivity ramps for posterized terrain and caves.
  // Use a generous slope threshold (1.5×) so rolling noise doesn't fragment terraces.
  // Ramp carving uses a gentler slope to produce gradual paths.
  let rampCells = new Set<number>();
  if (config.posterize > 0 || algorithm === 'caves') {
    const slopeH = config.maxHeight * SLOPE_HEIGHT_FRAC;
    rampCells = ensureConnectivity(grid, verts, resolution, slopeH * 1.5, quantizeStep || 0.5, config.maxHeight, actualSeed);
  }

  // Ladder detection is now handled at the NavGrid level (Terrain.buildNavGrid)
  // which uses actual walkability checks rather than vertex-level connectivity.
  const ladders: LadderDef[] = [];

  return { heights: grid, ladders, rampCells, seed: actualSeed };
}

// ── FBM generation ──────────────────────────────────────────────────

function generateFBM(
  grid: Float32Array, verts: number, resolution: number,
  seed: number, config: HeightmapStyleConfig,
): void {
  const perm = buildPerm(seed);
  const { octaves, lacunarity, persistence } = config;
  const noiseScale = 4.0;
  for (let z = 0; z < verts; z++) {
    for (let x = 0; x < verts; x++) {
      grid[z * verts + x] = fbm(
        x / resolution * noiseScale, z / resolution * noiseScale,
        perm, octaves, lacunarity, persistence,
      );
    }
  }
}

// ── Diamond-square generation ───────────────────────────────────────

function generateDiamondSquare(
  grid: Float32Array, verts: number, resolution: number, seed: number,
): void {
  // Find nearest 2^n+1 size for DS
  let dsSize = 3;
  while (dsSize < verts) dsSize = (dsSize - 1) * 2 + 1;
  const dsGrid = diamondSquare(dsSize, 1.0, seed);
  // Resample into verts grid
  for (let z = 0; z < verts; z++) {
    for (let x = 0; x < verts; x++) {
      const sx = (x / resolution) * (dsSize - 1);
      const sz = (z / resolution) * (dsSize - 1);
      const ix = Math.floor(sx);
      const iz = Math.floor(sz);
      const fx = sx - ix;
      const fz = sz - iz;
      const ix1 = Math.min(ix + 1, dsSize - 1);
      const iz1 = Math.min(iz + 1, dsSize - 1);
      const v00 = dsGrid[iz * dsSize + ix];
      const v10 = dsGrid[iz * dsSize + ix1];
      const v01 = dsGrid[iz1 * dsSize + ix];
      const v11 = dsGrid[iz1 * dsSize + ix1];
      grid[z * verts + x] = v00 * (1 - fx) * (1 - fz) + v10 * fx * (1 - fz) +
        v01 * (1 - fx) * fz + v11 * fx * fz;
    }
  }
}

// ── Apply mask, invert, scale ───────────────────────────────────────

function applyMaskAndScale(
  grid: Float32Array, verts: number, resolution: number,
  maxHeight: number, config: HeightmapStyleConfig,
): void {
  const { mask, invert } = config;
  const cx = resolution / 2;
  const cz = resolution / 2;
  const maxR = Math.min(cx, cz);

  if (mask === 'circle') {
    for (let z = 0; z < verts; z++) {
      for (let x = 0; x < verts; x++) {
        const dx = (x - cx) / maxR;
        const dz = (z - cz) / maxR;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const falloff = Math.max(0, 1 - dist * dist);
        grid[z * verts + x] *= falloff;
      }
    }
  } else if (mask === 'donut') {
    for (let z = 0; z < verts; z++) {
      for (let x = 0; x < verts; x++) {
        const dx = (x - cx) / maxR;
        const dz = (z - cz) / maxR;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const ring = Math.max(0, dist * 1.2 - 0.2);
        const edgeFalloff = Math.max(0, 1 - (dist * 0.9) * (dist * 0.9));
        grid[z * verts + x] *= Math.min(1, ring) * edgeFalloff;
      }
    }
  }

  if (invert) {
    for (let i = 0; i < grid.length; i++) grid[i] = 1 - grid[i];
  }

  for (let i = 0; i < grid.length; i++) {
    grid[i] = Math.max(0, grid[i] * maxHeight);
  }
}

// ── Islands generation ──────────────────────────────────────────────
// Diamond-square with high roughness, sea-level cutoff, power curve
// for dramatic multi-island terrain with tall mountains and flat beaches.

function generateIslands(
  grid: Float32Array, verts: number, resolution: number,
  maxHeight: number, seed: number,
): void {
  // Generate at a valid DS size and resample
  let dsSize = 3;
  while (dsSize < verts) dsSize = (dsSize - 1) * 2 + 1;
  const dsGrid = diamondSquare(dsSize, 1.2, seed); // high roughness for jagged terrain

  // Resample into verts grid
  for (let z = 0; z < verts; z++) {
    for (let x = 0; x < verts; x++) {
      const sx = (x / resolution) * (dsSize - 1);
      const sz = (z / resolution) * (dsSize - 1);
      const ix = Math.floor(sx);
      const iz = Math.floor(sz);
      const fx = sx - ix;
      const fz = sz - iz;
      const ix1 = Math.min(ix + 1, dsSize - 1);
      const iz1 = Math.min(iz + 1, dsSize - 1);
      const v00 = dsGrid[iz * dsSize + ix];
      const v10 = dsGrid[iz * dsSize + ix1];
      const v01 = dsGrid[iz1 * dsSize + ix];
      const v11 = dsGrid[iz1 * dsSize + ix1];
      grid[z * verts + x] = v00 * (1 - fx) * (1 - fz) + v10 * fx * (1 - fz) +
        v01 * (1 - fx) * fz + v11 * fx * fz;
    }
  }

  // Sea level cutoff: everything below seaLevel becomes 0 (water).
  // Remaining terrain rescaled to [0, 1] above sea level.
  const seaLevel = 0.35;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (v < seaLevel) {
      grid[i] = 0;
    } else {
      grid[i] = (v - seaLevel) / (1 - seaLevel);
    }
  }

  // Power curve: exaggerate peaks (tall mountains) and flatten beaches
  const power = 1.8;
  for (let i = 0; i < grid.length; i++) {
    grid[i] = Math.pow(grid[i], power);
  }

  // Edge falloff: push terrain down near map borders to ensure islands don't clip edges
  const cx = resolution / 2;
  const cz = resolution / 2;
  const maxR = Math.min(cx, cz);
  for (let z = 0; z < verts; z++) {
    for (let x = 0; x < verts; x++) {
      const dx = (x - cx) / maxR;
      const dz = (z - cz) / maxR;
      const edgeDist = Math.max(Math.abs(dx), Math.abs(dz));
      // Fade to 0 in the outer 20% of the map
      if (edgeDist > 0.8) {
        const fade = 1 - (edgeDist - 0.8) / 0.2;
        grid[z * verts + x] *= Math.max(0, fade);
      }
    }
  }

  // Scale to maxHeight
  for (let i = 0; i < grid.length; i++) {
    grid[i] *= maxHeight;
  }
}

// ── Caves generation ────────────────────────────────────────────────
// 1. Pick a random base terrain style (rolling, terraces, or islands) for varied walls.
// 2. Carve cave corridors into it using cellular automata.
// Result: elevated terrain with irregular tunnels and chambers at floor level,
// walls that follow whichever base style was randomly chosen.

function generateCaves(
  grid: Float32Array, verts: number, resolution: number,
  maxHeight: number, seed: number, config: HeightmapStyleConfig,
): void {
  // Step 1: Pick a random base terrain style using the seed
  const rng = mulberry32(seed + 3333);
  const baseStyles: HeightmapStyle[] = ['rolling', 'terraces', 'islands'];
  const pick = baseStyles[Math.floor(rng() * baseStyles.length)];
  const baseConfig = { ...HEIGHTMAP_STYLES[pick] };

  // Generate base terrain at full resolution using the picked style's algorithm
  const baseGrid = new Float32Array(verts * verts);
  if (pick === 'islands') {
    generateIslands(baseGrid, verts, resolution, maxHeight, seed);
  } else {
    generateFBM(baseGrid, verts, resolution, seed, baseConfig);
    applyMaskAndScale(baseGrid, verts, resolution, maxHeight, baseConfig);
  }

  // Apply posterize if the base style has it
  if (baseConfig.posterize > 0) {
    const levels = baseConfig.posterize;
    let maxH = 0;
    for (let i = 0; i < baseGrid.length; i++) {
      if (baseGrid[i] > maxH) maxH = baseGrid[i];
    }
    if (maxH > 0) {
      const stepRng = mulberry32(seed + 9999);
      const thresholds: number[] = [0];
      for (let i = 1; i < levels; i++) thresholds.push(stepRng());
      thresholds.push(1);
      thresholds.sort((a, b) => a - b);
      const step = baseConfig.quantizeStep > 0 ? baseConfig.quantizeStep : 0.5;
      const snapLevels = thresholds.map(t => Math.round(t * maxH / step) * step);
      for (let i = 0; i < baseGrid.length; i++) {
        const normalized = baseGrid[i] / maxH;
        let level = 0;
        for (let j = 1; j < thresholds.length; j++) {
          if (normalized >= thresholds[j]) level = j; else break;
        }
        baseGrid[i] = snapLevels[level];
      }
    }
  }
  if (baseConfig.quantizeStep > 0) {
    for (let i = 0; i < baseGrid.length; i++) {
      baseGrid[i] = Math.round(baseGrid[i] / baseConfig.quantizeStep) * baseConfig.quantizeStep;
    }
  }

  // Ensure walls have a minimum height so caves feel enclosed
  const minWall = maxHeight * 0.5;
  for (let i = 0; i < baseGrid.length; i++) {
    grid[i] = Math.max(minWall, baseGrid[i]);
  }

  // Step 2: Generate cellular automata cave layout at coarser resolution
  const caSize = Math.ceil(verts / 2);
  const caGrid = cellularAutomata(caSize, caSize, 0.45, 5, seed + 7777);

  // Step 3: Generate floor noise — small elevation changes inside carved caves
  // Uses a different FBM with low octaves, quantized to 0.5m for terrace-like steps
  const floorPerm = buildPerm(seed + 5555);
  const floorMaxHeight = maxHeight * 0.15; // floor variation — keep floors low for deep caverns
  const floorNoiseScale = 5.0;

  // Step 4: Carve caves — blend between wall height and floor height based on CA
  for (let z = 0; z < verts; z++) {
    for (let x = 0; x < verts; x++) {
      // Sample CA grid with bilinear interpolation
      const cax = (x / resolution) * (caSize - 1);
      const caz = (z / resolution) * (caSize - 1);
      const ix = Math.floor(cax);
      const iz = Math.floor(caz);
      const fx = cax - ix;
      const fz = caz - iz;
      const ix1 = Math.min(ix + 1, caSize - 1);
      const iz1 = Math.min(iz + 1, caSize - 1);
      const v00 = caGrid[iz * caSize + ix];
      const v10 = caGrid[iz * caSize + ix1];
      const v01 = caGrid[iz1 * caSize + ix];
      const v11 = caGrid[iz1 * caSize + ix1];
      const wallBlend = v00 * (1 - fx) * (1 - fz) + v10 * fx * (1 - fz) +
        v01 * (1 - fx) * fz + v11 * fx * fz;

      // wallStrength: 1 = solid wall, 0 = open cave floor
      const wallStrength = smoothstep(Math.max(0, Math.min(1, (wallBlend - 0.25) / 0.5)));

      // Floor height: FBM noise quantized to 0.5m steps for small terraces
      const floorNoise = fbm(
        x / resolution * floorNoiseScale, z / resolution * floorNoiseScale,
        floorPerm, 2, 2.0, 0.4,
      );
      let floorHeight = floorNoise * floorMaxHeight;
      floorHeight = Math.round(floorHeight / 0.5) * 0.5; // snap to 0.5m grid
      floorHeight = Math.max(0, floorHeight);

      // Blend: open areas get floor height, walls keep full terrain height
      const wallHeight = grid[z * verts + x];
      grid[z * verts + x] = wallStrength * wallHeight + (1 - wallStrength) * floorHeight;
    }
  }

}

// ── Heightmap connectivity ramps ────────────────────────────────────
// Post-processing pass that carves small wedge ramps between disconnected
// elevation zones so player/NPCs can reach all non-ceiling regions.
// Ramps are compact (3×3 to 3×7 cells) — small triangular blocks at cliff edges.

// Reference maxHeight these fractions were tuned for (terraces preset at groundSize=50).
// All height-dependent constants are derived as fractions of maxHeight so they
// scale automatically when ground size (and thus maxHeight) changes.
const REF_MAX_HEIGHT = 4.0;
const SLOPE_HEIGHT_FRAC = 0.5 / REF_MAX_HEIGHT;      // ~12.5% — max rise per vertex step
const HEIGHT_CEILING_FRAC = 0.85;                      // regions above this fraction stay disconnected
const MAX_RAMP_ITER = 30;
const RAMP_HALF_WIDTH = 1;                             // 3 cells wide (center ± 1)
const RAMP_SLOPE_FRAC = 0.25 / REF_MAX_HEIGHT;         // ~6.25% — walkable slope (must stay ≤ stepHeight 0.4)
const MAX_RAMP_HEIGHT_FRAC = 1.5 / REF_MAX_HEIGHT;    // ~37.5% — only bridge 1-2 terrace steps; taller cliffs use ladders
const MIN_RAMP_HEIGHT_FRAC = 0.2 / REF_MAX_HEIGHT;    // ~5% — min cliff height to place a ramp
const ROLLING_AMP_FRAC = 0.15 / REF_MAX_HEIGHT;       // ~3.75% — subtle rolling noise on ramps

/** BFS flood-fill that labels connected regions.
 *  Two vertices connect if |h1-h2| <= slopeHeight and both are below ceiling.
 *  Returns labels array (-1 = ceiling/excluded). */
function labelRegions(
  grid: Float32Array, verts: number, slopeHeight: number, ceilingH: number,
): { labels: Int32Array; regionCount: number } {
  const n = verts * verts;
  const labels = new Int32Array(n).fill(-1);
  let regionId = 0;
  const queue: number[] = [];

  for (let i = 0; i < n; i++) {
    if (labels[i] !== -1 || grid[i] >= ceilingH) continue;
    labels[i] = regionId;
    queue.length = 0;
    queue.push(i);
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      const cx = cur % verts;
      const cz = (cur - cx) / verts;
      const h = grid[cur];
      const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dx, dz] of dirs) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nx >= verts || nz < 0 || nz >= verts) continue;
        const ni = nz * verts + nx;
        if (labels[ni] !== -1 || grid[ni] >= ceilingH) continue;
        if (Math.abs(grid[ni] - h) <= slopeHeight) {
          labels[ni] = regionId;
          queue.push(ni);
        }
      }
    }
    regionId++;
  }

  return { labels, regionCount: regionId };
}

/** Collect border vertices for each region (vertices adjacent to a different label).
 *  If interRegionOnly is true, map-edge vertices are NOT counted as borders —
 *  only vertices next to a different non-ceiling region qualify. */
function buildBoundaryIndex(
  labels: Int32Array, verts: number, regionCount: number,
  interRegionOnly = false,
): Map<number, number[]> {
  const borders = new Map<number, number[]>();
  for (let r = 0; r < regionCount; r++) borders.set(r, []);

  for (let z = 0; z < verts; z++) {
    for (let x = 0; x < verts; x++) {
      const i = z * verts + x;
      const lab = labels[i];
      if (lab < 0) continue;
      let isBorder = false;
      const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dx, dz] of dirs) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nx >= verts || nz < 0 || nz >= verts) {
          if (!interRegionOnly) isBorder = true;
          continue;
        }
        const nlab = labels[nz * verts + nx];
        if (nlab !== lab && nlab >= 0) { isBorder = true; break; }
      }
      if (isBorder) borders.get(lab)!.push(i);
    }
  }
  return borders;
}

/** Ensure non-ceiling elevation zones are reachable from the spawn region.
 *  Places small wedge ramps (3×3 to 3×7) at cliff edges between terraces.
 *  Returns set of all modified vertex indices (ramp cells). */
function ensureConnectivity(
  grid: Float32Array, verts: number, resolution: number,
  slopeHeight: number, _quantizeStep: number, maxHeight: number, seed: number,
): Set<number> {
  const ceilingH = maxHeight * HEIGHT_CEILING_FRAC;
  const RAMP_SLOPE = maxHeight * RAMP_SLOPE_FRAC;
  const MAX_RAMP_HEIGHT = maxHeight * MAX_RAMP_HEIGHT_FRAC;
  const MIN_RAMP_HEIGHT = maxHeight * MIN_RAMP_HEIGHT_FRAC;
  // Same rolling noise as the main terrain pass — used to re-apply undulation to ramp cells
  const rollingPerm = buildPerm(seed + 4444);
  const rollingScale = 5.0;
  const rollingAmp = maxHeight * ROLLING_AMP_FRAC;
  const spawnVertex = Math.floor(verts / 2);
  const allRampCells = new Set<number>();
  const EDGE_MARGIN = 3;
  const dirs4: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  for (let iter = 0; iter < MAX_RAMP_ITER; iter++) {
    const { labels, regionCount } = labelRegions(grid, verts, slopeHeight, ceilingH);
    const spawnLabel = labels[spawnVertex * verts + spawnVertex];
    if (spawnLabel < 0) break;

    // Count region sizes and find disconnected regions
    const regionSizes = new Map<number, number>();
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] >= 0 && labels[i] !== spawnLabel) {
        regionSizes.set(labels[i], (regionSizes.get(labels[i]) || 0) + 1);
      }
    }
    if (regionSizes.size === 0) break; // all connected

    // Scan for the best cliff-edge crossing to place a small wedge ramp.
    // We look for adjacent vertex pairs where one is spawn-connected and the other isn't.
    let bestScore = Infinity;
    let bestLowX = 0, bestLowZ = 0;
    let bestDirX = 0, bestDirZ = 0;
    let bestLowH = 0, bestHighH = 0;

    for (let z = EDGE_MARGIN; z < verts - EDGE_MARGIN; z++) {
      for (let x = EDGE_MARGIN; x < verts - EDGE_MARGIN; x++) {
        const idx = z * verts + x;
        const lab = labels[idx];
        if (lab < 0) continue;

        for (const [dx, dz] of dirs4) {
          const nx = x + dx, nz = z + dz;
          if (nx < EDGE_MARGIN || nx >= verts - EDGE_MARGIN ||
              nz < EDGE_MARGIN || nz >= verts - EDGE_MARGIN) continue;
          const nIdx = nz * verts + nx;
          const nLab = labels[nIdx];
          if (nLab < 0 || nLab === lab) continue;

          // One must be spawn-connected, other must be disconnected
          const isSpawnSide = lab === spawnLabel;
          const isNeighborSpawn = nLab === spawnLabel;
          if (!isSpawnSide && !isNeighborSpawn) continue;

          const targetLab = isSpawnSide ? nLab : lab;
          if ((regionSizes.get(targetLab) || 0) < 4) continue; // skip tiny regions

          const hA = grid[idx];
          const hB = grid[nIdx];
          const heightDiff = Math.abs(hA - hB);
          if (heightDiff > MAX_RAMP_HEIGHT || heightDiff < MIN_RAMP_HEIGHT) continue;

          // Determine low/high side and ramp direction (from low toward high)
          const lowH = Math.min(hA, hB);
          const highH = Math.max(hA, hB);
          const lowIsA = hA <= hB;
          const lowX = lowIsA ? x : nx;
          const lowZ = lowIsA ? z : nz;
          // Direction from low toward high (cardinal: exactly ±1 in one axis)
          const rdx = lowIsA ? dx : -dx;
          const rdz = lowIsA ? dz : -dz;

          // Check room: ramp extends backward from cliff into low terrace
          const estSlopeLen = Math.max(4, Math.ceil(heightDiff / RAMP_SLOPE) + 3);
          const backX = lowX - rdx * (estSlopeLen + 1);
          const backZ = lowZ - rdz * (estSlopeLen + 1);
          const fwdX = lowX + rdx * 1;
          const fwdZ = lowZ + rdz * 1;
          if (backX < 1 || backX >= verts - 1 || backZ < 1 || backZ >= verts - 1 ||
              fwdX < 1 || fwdX >= verts - 1 || fwdZ < 1 || fwdZ >= verts - 1) continue;

          // Score: prefer flat surroundings and smaller height differences
          let flatness = 0;
          for (const [ddx, ddz] of dirs4) {
            const fx = lowX + ddx, fz = lowZ + ddz;
            if (fx >= 0 && fx < verts && fz >= 0 && fz < verts) {
              flatness += Math.abs(grid[fz * verts + fx] - lowH);
            }
            const hfx = lowX + rdx + ddx, hfz = lowZ + rdz + ddz;
            if (hfx >= 0 && hfx < verts && hfz >= 0 && hfz < verts) {
              flatness += Math.abs(grid[hfz * verts + hfx] - highH);
            }
          }

          const score = flatness * 2 + heightDiff;
          if (score < bestScore) {
            bestScore = score;
            bestLowX = lowX; bestLowZ = lowZ;
            bestDirX = rdx; bestDirZ = rdz;
            bestLowH = lowH; bestHighH = highH;
          }
        }
      }
    }

    if (bestScore === Infinity) break; // no valid crossing found

    const heightDiff = bestHighH - bestLowH;
    const perpX = -bestDirZ;
    const perpZ = bestDirX;

    const slopeLen = Math.max(2, Math.ceil(heightDiff / RAMP_SLOPE));

    const startX = bestLowX - bestDirX * slopeLen;
    const startZ = bestLowZ - bestDirZ * slopeLen;
    const endX = bestLowX;
    const endZ = bestLowZ;

    const inBounds = (bx: number, bz: number) =>
      bx >= 0 && bx < verts && bz >= 0 && bz < verts;
    if (!inBounds(startX, startZ) || !inBounds(endX, endZ)) break;

    const actualLowH = grid[startZ * verts + startX];
    const rampLowH = Math.min(bestLowH, actualLowH);

    const rampNoisePerm = buildPerm(seed + 7777 + iter * 31);

    const terraceStep = maxHeight / Math.max(1, _quantizeStep > 0 ? Math.round(maxHeight / _quantizeStep) : 6);
    const numStairSteps = Math.max(2, Math.ceil(heightDiff / Math.min(0.25, terraceStep * 0.5)));
    const useStairs = valueNoise2D(bestLowX * 0.3, bestLowZ * 0.3, rampNoisePerm) > 0.5;

    for (let i = 0; i <= slopeLen; i++) {
      const t = (i + 1) / (slopeLen + 1);
      let h: number;
      if (useStairs) {
        const stepIndex = Math.min(
          numStairSteps,
          Math.round(t * numStairSteps),
        );
        h = rampLowH + (stepIndex / numStairSteps) * (bestHighH - rampLowH);
      } else {
        h = rampLowH + (bestHighH - rampLowH) * t;
      }
      const rx = startX + bestDirX * i;
      const rz = startZ + bestDirZ * i;

      // Vary width per row slightly: occasionally ±1 cell wider (ramps only)
      const widthNoise = valueNoise2D(i * 0.5, iter * 3.3, rampNoisePerm);
      const rowHalfWidth = useStairs
        ? RAMP_HALF_WIDTH  // stairs: consistent width for clean blocky look
        : RAMP_HALF_WIDTH + (widthNoise > 0.7 ? 1 : 0);

      // Rolling noise: ramps get organic undulation, but don't flatten the start
      let rowH = h;
      if (!useStairs) {
        const rollingNoise = fbm(
          rx / resolution * rollingScale, rz / resolution * rollingScale,
          rollingPerm, 3, 2.0, 0.5,
        );
        const damp = i === 0 ? 0 : (i === 1 ? 0.5 : 1);
        rowH = h + (rollingNoise - 0.5) * rollingAmp * 2 * damp;
      }

      for (let w = -rowHalfWidth; w <= rowHalfWidth; w++) {
        const nx = rx + perpX * w;
        const nz = rz + perpZ * w;
        if (nx < 0 || nx >= verts || nz < 0 || nz >= verts) continue;
        const cellIdx = nz * verts + nx;
        grid[cellIdx] = rowH;
        allRampCells.add(cellIdx);
      }
    }

    const APRON = 1;
    const SIDE_BLEND = 1;

    // Exit apron only: blend ramp into high terrace (no flat entry apron)
    for (let a = 1; a <= APRON; a++) {
      const apronW = RAMP_HALF_WIDTH + a;
      const blend = a / (APRON + 1);
      for (let w = -apronW; w <= apronW; w++) {
        const tx = endX + bestDirX * a + perpX * w;
        const tz = endZ + bestDirZ * a + perpZ * w;
        if (tx >= 0 && tx < verts && tz >= 0 && tz < verts) {
          const ci = tz * verts + tx;
          grid[ci] = grid[ci] * blend + bestHighH * (1 - blend);
          allRampCells.add(ci);
        }
      }
    }

    for (let i = 0; i <= slopeLen; i++) {
      const t = (i + 1) / (slopeLen + 1);
      const rampH = rampLowH + (bestHighH - rampLowH) * t;
      const rx2 = startX + bestDirX * i;
      const rz2 = startZ + bestDirZ * i;
      for (let s = 1; s <= SIDE_BLEND; s++) {
        const blend = s / (SIDE_BLEND + 1);
        for (const sign of [-1, 1]) {
          const sx = rx2 + perpX * sign * (RAMP_HALF_WIDTH + s);
          const sz = rz2 + perpZ * sign * (RAMP_HALF_WIDTH + s);
          if (sx >= 0 && sx < verts && sz >= 0 && sz < verts) {
            const ci = sz * verts + sx;
            grid[ci] = grid[ci] * blend + rampH * (1 - blend);
            allRampCells.add(ci);
          }
        }
      }
    }

    // console.log(`[Ramp ${iter + 1}] ${heightDiff.toFixed(1)}m, ${slopeLen} slope cells at (${bestLowX},${bestLowZ}) dir=(${bestDirX},${bestDirZ})`);
  }

  return allRampCells;
}

// ── Ladder detection ────────────────────────────────────────────────
// Single-pass: label regions, then for EACH non-spawn region find the
// closest cliff-edge pair and place a ladder. No iteration needed.

function detectLadderSites(
  grid: Float32Array, verts: number,
  slopeHeight: number, maxHeight: number, groundSize: number,
): LadderDef[] {
  const ceilingH = maxHeight * HEIGHT_CEILING_FRAC;
  const spawnVertex = Math.floor(verts / 2);
  const cellSize = groundSize / (verts - 1);
  const halfGround = groundSize / 2;
  const navCellSize = 0.5;
  const navHalf = groundSize / 2;
  const ladders: LadderDef[] = [];

  const { labels, regionCount } = labelRegions(grid, verts, slopeHeight, ceilingH);
  const spawnLabel = labels[spawnVertex * verts + spawnVertex];
  if (spawnLabel < 0) return ladders;

  // Collect all unique non-spawn, non-ceiling region IDs
  const otherRegions = new Set<number>();
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] >= 0 && labels[i] !== spawnLabel) {
      otherRegions.add(labels[i]);
    }
  }
  if (otherRegions.size === 0) return ladders;

  // console.log(`[detectLadderSites] spawnLabel=${spawnLabel}, ${otherRegions.size} disconnected region(s), ${regionCount} total regions`);

  // Build borders for all regions (interRegionOnly = true to avoid map-edge vertices)
  const borders = buildBoundaryIndex(labels, verts, regionCount, true);
  const spawnBorder = borders.get(spawnLabel);

  // Use a union-find to track which regions are transitively connected via ladders
  // Start: spawn region is in one group, each other region is its own group
  const parent = new Map<number, number>();
  const find = (r: number): number => {
    while (parent.has(r) && parent.get(r) !== r) {
      const p = parent.get(r)!;
      parent.set(r, parent.get(p) ?? p); // path compression
      r = p;
    }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  // Initialize: every region is its own root
  parent.set(spawnLabel, spawnLabel);
  for (const r of otherRegions) parent.set(r, r);

  // For each disconnected region, find closest border pair to ANY already-connected region
  // and place a ladder. Repeat until all regions are connected.
  const MAX_ITER = otherRegions.size + 5;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    // Find the first region not yet connected to spawn
    let targetRegion = -1;
    for (const r of otherRegions) {
      if (find(r) !== find(spawnLabel)) {
        targetRegion = r;
        break;
      }
    }
    if (targetRegion < 0) break; // all connected

    // Find closest border pair between ANY spawn-connected region and this target
    const targetBorder = borders.get(targetRegion);
    if (!targetBorder || targetBorder.length === 0) {
      // Tiny region with no border — just mark it connected
      union(spawnLabel, targetRegion);
      continue;
    }

    let bestDist = Infinity;
    let bestSrc = -1, bestDst = -1;

    // Check spawn border → target border
    if (spawnBorder) {
      for (const si of spawnBorder) {
        const sx = si % verts, sz = (si - sx) / verts;
        for (const di of targetBorder) {
          const dx = di % verts, dz = (di - dx) / verts;
          const dist = (sx - dx) * (sx - dx) + (sz - dz) * (sz - dz);
          if (dist < bestDist) {
            bestDist = dist; bestSrc = si; bestDst = di;
          }
        }
      }
    }

    // Also check other connected regions' borders → target border
    for (const r of otherRegions) {
      if (r === targetRegion) continue;
      if (find(r) !== find(spawnLabel)) continue; // not connected yet
      const rBorder = borders.get(r);
      if (!rBorder) continue;
      for (const si of rBorder) {
        const sx = si % verts, sz = (si - sx) / verts;
        for (const di of targetBorder) {
          const dx = di % verts, dz = (di - dx) / verts;
          const dist = (sx - dx) * (sx - dx) + (sz - dz) * (sz - dz);
          if (dist < bestDist) {
            bestDist = dist; bestSrc = si; bestDst = di;
          }
        }
      }
    }

    if (bestSrc < 0) {
      union(spawnLabel, targetRegion);
      continue;
    }

    const hSrc = grid[bestSrc];
    const hDst = grid[bestDst];

    // Determine low/high sides
    const lowIdx = hSrc <= hDst ? bestSrc : bestDst;
    const highIdx = hSrc <= hDst ? bestDst : bestSrc;
    const lowX = lowIdx % verts;
    const lowZ = (lowIdx - lowX) / verts;
    const highX = highIdx % verts;
    const highZ = (highIdx - highX) / verts;
    const lowH = grid[lowIdx];
    const highH = grid[highIdx];

    // Facing direction: from high side toward low side (cliff face normal)
    let fdx = lowX - highX;
    let fdz = lowZ - highZ;
    const fLen = Math.sqrt(fdx * fdx + fdz * fdz);
    if (fLen > 0) { fdx /= fLen; fdz /= fLen; }

    // Convert vertex coordinates to world coordinates
    const worldLowX = lowX * cellSize - halfGround;
    const worldLowZ = lowZ * cellSize - halfGround;
    const worldHighX = highX * cellSize - halfGround;
    const worldHighZ = highZ * cellSize - halfGround;

    // Place ladder at the midpoint of the cliff edge
    const ladderX = (worldLowX + worldHighX) / 2;
    const ladderZ = (worldLowZ + worldHighZ) / 2;

    // Cell coords are placeholders — Terrain.ts will recompute with NavGrid.worldToGrid()
    ladders.push({
      bottomX: ladderX,
      bottomZ: ladderZ,
      bottomY: lowH,
      topY: highH,
      facingDX: fdx,
      facingDZ: fdz,
      lowWorldX: worldLowX,
      lowWorldZ: worldLowZ,
      highWorldX: worldHighX,
      highWorldZ: worldHighZ,
      bottomCellGX: 0,
      bottomCellGZ: 0,
      topCellGX: 0,
      topCellGZ: 0,
    });

    // console.log(`[Ladder ${ladders.length}] h=${(highH - lowH).toFixed(1)}m at (${ladderX.toFixed(1)}, ${ladderZ.toFixed(1)}) low=(${worldLowX.toFixed(1)},${worldLowZ.toFixed(1)}) high=(${worldHighX.toFixed(1)},${worldHighZ.toFixed(1)})`);

    // Mark this region as connected
    union(spawnLabel, targetRegion);
  }

  // console.log(`[detectLadderSites] Created ${ladders.length} ladder(s) for ${otherRegions.size} disconnected regions`);
  return ladders;
}

// ── Bilinear height sampling ────────────────────────────────────────

/**
 * Sample the heightmap at any world XZ point using bilinear interpolation.
 * `heights` is a (resolution+1)² vertex array, `resolution` = number of cells.
 * World origin is centered: vertex (0,0) maps to world (-groundSize/2, -groundSize/2).
 */
export function sampleHeightmap(
  heights: Float32Array,
  resolution: number,
  groundSize: number,
  wx: number,
  wz: number,
): number {
  const verts = resolution + 1;
  const cellSize = groundSize / resolution;
  const halfGround = groundSize / 2;

  const gx = (wx + halfGround) / cellSize;
  const gz = (wz + halfGround) / cellSize;

  const cx = Math.max(0, Math.min(resolution - 1e-6, gx));
  const cz = Math.max(0, Math.min(resolution - 1e-6, gz));

  const ix = Math.floor(cx);
  const iz = Math.floor(cz);
  const fx = cx - ix;
  const fz = cz - iz;

  const h00 = heights[iz * verts + ix];
  const h10 = heights[iz * verts + ix + 1];
  const h01 = heights[(iz + 1) * verts + ix];
  const h11 = heights[(iz + 1) * verts + ix + 1];

  return h00 * (1 - fx) * (1 - fz) +
    h10 * fx * (1 - fz) +
    h01 * (1 - fx) * fz +
    h11 * fx * fz;
}
