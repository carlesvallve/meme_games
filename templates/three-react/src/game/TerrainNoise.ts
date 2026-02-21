/**
 * TerrainNoise — Pure TypeScript noise + heightmap utilities.
 * No Three.js dependency. Generates vertex-based heightmaps from noise
 * algorithms and provides bilinear interpolation for height queries.
 */

import type { LadderDef } from './Ladder';

export interface HeightmapResult {
  heights: Float32Array;
  ladders: LadderDef[];
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
    maxHeight: 4.0,
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
    maxHeight: 8.0,
    octaves: 2,
    lacunarity: 2.0,
    persistence: 0.35,
    mask: 'none',
    invert: false,
    algorithm: 'fbm',
    quantizeStep: 0.5,
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
    quantizeStep: 0.5,
    posterize: 10,
  },
  caves: {
    resolution: 72,
    maxHeight: 5.0,
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
): HeightmapResult {
  const { resolution, maxHeight, algorithm, quantizeStep } = config;
  const actualSeed = seed ?? (Date.now() & 0xffff);
  const verts = resolution + 1;
  const grid = new Float32Array(verts * verts);

  if (algorithm === 'islands') {
    generateIslands(grid, verts, resolution, maxHeight, actualSeed);
  } else if (algorithm === 'caves') {
    generateCaves(grid, verts, resolution, maxHeight, actualSeed, config);
  } else if (algorithm === 'diamond-square') {
    generateDiamondSquare(grid, verts, resolution, actualSeed);
    applyMaskAndScale(grid, verts, resolution, maxHeight, config);
  } else {
    // FBM
    generateFBM(grid, verts, resolution, actualSeed, config);
    applyMaskAndScale(grid, verts, resolution, maxHeight, config);
  }

  // Posterize: reduce to N discrete levels with random spacing.
  // Creates large flat plateaus with varied cliff heights (0.5m to 5m+).
  // Levels are randomly spaced so some jumps are small and others are sheer cliffs.
  if (config.posterize > 0) {
    const levels = config.posterize;
    let maxH = 0;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] > maxH) maxH = grid[i];
    }
    if (maxH > 0) {
      // Generate random threshold values, sorted, snapped to quantizeStep
      const rng = mulberry32(actualSeed + 9999);
      const thresholds: number[] = [0];
      for (let i = 1; i < levels; i++) {
        thresholds.push(rng());
      }
      thresholds.push(1);
      thresholds.sort((a, b) => a - b);

      // Snap thresholds to quantizeStep grid
      const step = quantizeStep > 0 ? quantizeStep : 0.5;
      const snapLevels = thresholds.map(t => Math.round(t * maxH / step) * step);

      for (let i = 0; i < grid.length; i++) {
        const normalized = grid[i] / maxH;
        // Find which band this value falls into
        let level = 0;
        for (let j = 1; j < thresholds.length; j++) {
          if (normalized >= thresholds[j]) {
            level = j;
          } else {
            break;
          }
        }
        grid[i] = snapLevels[level];
      }
    }
  }

  // Quantize heights to grid step (snaps posterized levels to 0.5m grid)
  if (quantizeStep > 0) {
    for (let i = 0; i < grid.length; i++) {
      grid[i] = Math.round(grid[i] / quantizeStep) * quantizeStep;
    }
  }

  // Carve connectivity ramps for posterized terrain (terraces, islands, caves)
  // Use a conservative slope threshold (0.75×) matching the NavGrid margin
  if (config.posterize > 0) {
    ensureConnectivity(grid, verts, SLOPE_HEIGHT * 0.75, quantizeStep, config.maxHeight);
  }

  // Ladder detection is now handled at the NavGrid level (Terrain.buildNavGrid)
  // which uses actual walkability checks rather than vertex-level connectivity.
  const ladders: LadderDef[] = [];

  return { heights: grid, ladders };
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
  const minWall = maxHeight * 0.35;
  for (let i = 0; i < baseGrid.length; i++) {
    grid[i] = Math.max(minWall, baseGrid[i]);
  }

  // Step 2: Generate cellular automata cave layout at coarser resolution
  const caSize = Math.ceil(verts / 2);
  const caGrid = cellularAutomata(caSize, caSize, 0.45, 5, seed + 7777);

  // Step 3: Generate floor noise — small elevation changes inside carved caves
  // Uses a different FBM with low octaves, quantized to 0.5m for terrace-like steps
  const floorPerm = buildPerm(seed + 5555);
  const floorMaxHeight = maxHeight * 0.25; // floor variation up to 25% of wall height
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
// Post-processing pass that carves gradual ramps between disconnected
// elevation zones so player/NPCs can reach all non-ceiling regions.

const SLOPE_HEIGHT = 1.0;   // max rise per vertex step (matches playerParams)
const HEIGHT_CEILING_FRAC = 0.85; // regions above this fraction of maxH stay disconnected
const RAMP_WIDTH = 2;       // ramp half-width in vertices (5 verts total = 2.5m)
const MAX_RAMP_ITER = 20;

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
    // BFS from vertex i
    labels[i] = regionId;
    queue.length = 0;
    queue.push(i);
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      const cx = cur % verts;
      const cz = (cur - cx) / verts;
      const h = grid[cur];
      // 4-connected neighbors
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
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
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
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

/** Find the closest pair of border vertices between spawnRegion and any other region.
 *  Returns { srcIdx, dstIdx, targetRegion } or null if all regions connected. */
function findClosestBorderPair(
  borders: Map<number, number[]>, spawnRegion: number, labels: Int32Array, verts: number,
): { srcIdx: number; dstIdx: number; targetRegion: number } | null {
  const spawnBorder = borders.get(spawnRegion);
  if (!spawnBorder || spawnBorder.length === 0) return null;

  let bestDist = Infinity;
  let bestSrc = -1;
  let bestDst = -1;
  let bestRegion = -1;

  for (const [region, rBorder] of borders) {
    if (region === spawnRegion || rBorder.length === 0) continue;
    // Check that this region isn't already the spawn region (labels may have merged)
    if (labels[rBorder[0]] === spawnRegion) continue;

    for (const si of spawnBorder) {
      const sx = si % verts;
      const sz = (si - sx) / verts;
      for (const di of rBorder) {
        const dx = di % verts;
        const dz = (di - dx) / verts;
        const dist = (sx - dx) * (sx - dx) + (sz - dz) * (sz - dz);
        if (dist < bestDist) {
          bestDist = dist;
          bestSrc = si;
          bestDst = di;
          bestRegion = region;
        }
      }
    }
  }

  return bestRegion >= 0 ? { srcIdx: bestSrc, dstIdx: bestDst, targetRegion: bestRegion } : null;
}

/** Bresenham line from (x0,z0) to (x1,z1). Returns array of [x,z] pairs. */
function bresenhamLine(x0: number, z0: number, x1: number, z1: number): [number, number][] {
  const points: [number, number][] = [];
  let dx = Math.abs(x1 - x0);
  let dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1;
  const sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;
  let x = x0, z = z0;

  while (true) {
    points.push([x, z]);
    if (x === x1 && z === z1) break;
    const e2 = 2 * err;
    if (e2 > -dz) { err -= dz; x += sx; }
    if (e2 < dx) { err += dx; z += sz; }
  }
  return points;
}

/** Carve a ramp along the given path with linear height interpolation and width expansion.
 *  Uses smooth blending at edges to avoid steep gradients at ramp borders. */
function carveRampPath(
  grid: Float32Array, verts: number, path: [number, number][],
  slopeHeight: number, rampWidth: number, quantizeStep: number,
): void {
  if (path.length < 2) return;

  const startH = grid[path[0][1] * verts + path[0][0]];
  const endH = grid[path[path.length - 1][1] * verts + path[path.length - 1][0]];

  // Track all modified vertices for re-quantization
  const modified = new Set<number>();

  for (let i = 0; i < path.length; i++) {
    const t = path.length > 1 ? i / (path.length - 1) : 0;
    const targetH = startH + (endH - startH) * t;
    const [px, pz] = path[i];

    // Determine perpendicular direction for width expansion
    let perpX = 0, perpZ = 1; // default: expand along Z
    if (i < path.length - 1) {
      const [nextX, nextZ] = path[i + 1];
      const dirX = nextX - px;
      const dirZ = nextZ - pz;
      if (dirX !== 0 && dirZ !== 0) {
        // Diagonal: expand in both axes (X and Z offsets)
        perpX = 1; perpZ = 0;
      } else {
        // Cardinal: perpendicular
        perpX = dirZ === 0 ? 0 : -Math.sign(dirZ);
        perpZ = dirX === 0 ? 0 : Math.sign(dirX);
      }
    }

    // Carve center + width expansion
    for (let dw = -rampWidth; dw <= rampWidth; dw++) {
      const nx = px + dw * perpX;
      const nz = pz + dw * perpZ;
      if (nx < 0 || nx >= verts || nz < 0 || nz >= verts) continue;

      const idx = nz * verts + nx;
      const absDw = Math.abs(dw);
      if (absDw === 0) {
        // Center: set to interpolated height
        grid[idx] = targetH;
      } else {
        // Graduated blending: inner edges blend more, outer edges blend less
        // dw=1 → 75% ramp, dw=2 → 40% ramp
        const blend = absDw === 1 ? 0.75 : 0.4;
        grid[idx] = grid[idx] * (1 - blend) + targetH * blend;
      }
      modified.add(idx);

      // Also expand diagonally for diagonal paths to ensure full coverage
      if (perpX !== 0 || perpZ !== 0) {
        const nx2 = px + dw * (perpX === 0 ? 1 : 0);
        const nz2 = pz + dw * (perpZ === 0 ? 1 : 0);
        if (nx2 >= 0 && nx2 < verts && nz2 >= 0 && nz2 < verts) {
          const idx2 = nz2 * verts + nx2;
          if (absDw === 0) {
            grid[idx2] = targetH;
          } else {
            const blend = absDw === 1 ? 0.75 : 0.4;
            grid[idx2] = grid[idx2] * (1 - blend) + targetH * blend;
          }
          modified.add(idx2);
        }
      }
    }
  }

  // Enforce max slope along the ramp center after interpolation
  // Forward pass
  for (let i = 1; i < path.length; i++) {
    const prevIdx = path[i - 1][1] * verts + path[i - 1][0];
    const curIdx = path[i][1] * verts + path[i][0];
    if (grid[curIdx] - grid[prevIdx] > slopeHeight) {
      grid[curIdx] = grid[prevIdx] + slopeHeight;
    }
    if (grid[prevIdx] - grid[curIdx] > slopeHeight) {
      grid[curIdx] = grid[prevIdx] - slopeHeight;
    }
  }
  // Backward pass
  for (let i = path.length - 2; i >= 0; i--) {
    const nextIdx = path[i + 1][1] * verts + path[i + 1][0];
    const curIdx = path[i][1] * verts + path[i][0];
    if (grid[curIdx] - grid[nextIdx] > slopeHeight) {
      grid[curIdx] = grid[nextIdx] + slopeHeight;
    }
    if (grid[nextIdx] - grid[curIdx] > slopeHeight) {
      grid[curIdx] = grid[nextIdx] - slopeHeight;
    }
  }

  // Re-quantize all modified cells
  if (quantizeStep > 0) {
    for (const idx of modified) {
      grid[idx] = Math.round(grid[idx] / quantizeStep) * quantizeStep;
    }
  }
}

/** Max height difference that ramps will bridge. Taller cliffs are left for ladders. */
const MAX_RAMP_HEIGHT = 2.0;

/** Ensure non-ceiling elevation zones are reachable from the spawn region.
 *  Carves ramps for small height differences only. Tall cliffs are left for ladders. */
function ensureConnectivity(
  grid: Float32Array, verts: number,
  slopeHeight: number, quantizeStep: number, maxHeight: number,
): void {
  const ceilingH = maxHeight * HEIGHT_CEILING_FRAC;
  const spawnVertex = Math.floor(verts / 2);

  // Track region pairs we've skipped (too tall for ramps)
  const skippedRegionPairs = new Set<string>();

  for (let iter = 0; iter < MAX_RAMP_ITER; iter++) {
    const { labels, regionCount } = labelRegions(grid, verts, slopeHeight, ceilingH);

    const spawnLabel = labels[spawnVertex * verts + spawnVertex];
    if (spawnLabel < 0) break;

    // Collect all non-spawn regions
    const otherRegions = new Set<number>();
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] >= 0 && labels[i] !== spawnLabel) {
        otherRegions.add(labels[i]);
      }
    }
    if (otherRegions.size === 0) break;

    const borders = buildBoundaryIndex(labels, verts, regionCount);
    const spawnBorder = borders.get(spawnLabel);
    if (!spawnBorder || spawnBorder.length === 0) break;

    // Find closest border pair that hasn't been skipped
    let bestDist = Infinity;
    let bestSrc = -1, bestDst = -1, bestRegion = -1;

    for (const region of otherRegions) {
      const pairKey = `${Math.min(spawnLabel, region)},${Math.max(spawnLabel, region)}`;
      if (skippedRegionPairs.has(pairKey)) continue;

      const rBorder = borders.get(region);
      if (!rBorder || rBorder.length === 0) continue;

      for (const si of spawnBorder) {
        const sx = si % verts, sz = (si - sx) / verts;
        for (const di of rBorder) {
          const dx = di % verts, dz = (di - dx) / verts;
          const dist = (sx - dx) * (sx - dx) + (sz - dz) * (sz - dz);
          if (dist < bestDist) {
            bestDist = dist; bestSrc = si; bestDst = di; bestRegion = region;
          }
        }
      }
    }

    if (bestRegion < 0) break; // all remaining regions are skipped (too tall)

    const hSrc = grid[bestSrc];
    const hDst = grid[bestDst];
    const heightDiff = Math.abs(hSrc - hDst);

    if (heightDiff > MAX_RAMP_HEIGHT) {
      // Too tall for a ramp — skip and leave for ladders
      const pairKey = `${Math.min(spawnLabel, bestRegion)},${Math.max(spawnLabel, bestRegion)}`;
      skippedRegionPairs.add(pairKey);
      continue;
    }

    // Carve ramp
    const srcX = bestSrc % verts, srcZ = (bestSrc - srcX) / verts;
    const dstX = bestDst % verts, dstZ = (bestDst - dstX) / verts;
    const path = bresenhamLine(srcX, srcZ, dstX, dstZ);
    carveRampPath(grid, verts, path, slopeHeight, RAMP_WIDTH, quantizeStep);
  }
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

  console.log(`[detectLadderSites] spawnLabel=${spawnLabel}, ${otherRegions.size} disconnected region(s), ${regionCount} total regions`);

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

    console.log(`[Ladder ${ladders.length}] h=${(highH - lowH).toFixed(1)}m at (${ladderX.toFixed(1)}, ${ladderZ.toFixed(1)}) low=(${worldLowX.toFixed(1)},${worldLowZ.toFixed(1)}) high=(${worldHighX.toFixed(1)},${worldHighZ.toFixed(1)})`);

    // Mark this region as connected
    union(spawnLabel, targetRegion);
  }

  console.log(`[detectLadderSites] Created ${ladders.length} ladder(s) for ${otherRegions.size} disconnected regions`);
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
