import * as THREE from 'three';
import { importVox } from './voxelIO';
import type { VoxelModel } from '../types';

// ── Types ──

export interface VoxAnimFrames {
  idle: THREE.BufferGeometry[];
  walk: THREE.BufferGeometry[];
  action: THREE.BufferGeometry[];
}

export interface VoxCharacterData {
  base: THREE.BufferGeometry;
  frames: VoxAnimFrames;
  palette: Record<number, { r: number; g: number; b: number }>;
}

// ── Face definitions for greedy builder (same as characters.ts) ──

const FACES: Array<{ dir: [number, number, number]; verts: [number, number, number][] }> = [
  { dir: [0, 1, 0], verts: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { dir: [0, -1, 0], verts: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },
  { dir: [1, 0, 0], verts: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { dir: [-1, 0, 0], verts: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { dir: [0, 0, 1], verts: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { dir: [0, 0, -1], verts: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

// ── Core loader ──

/** Fetch a .vox file and parse it into VoxelModel + palette */
export async function loadVoxModel(url: string): Promise<{ model: VoxelModel; palette: Record<number, { r: number; g: number; b: number }> }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch VOX file: ${url} (${response.status})`);
  const buffer = await response.arrayBuffer();
  return importVox(buffer);
}

/**
 * Build an optimized Three.js geometry from a VoxelModel with greedy face culling.
 *
 * MagicaVoxel uses Z-up (x-right, z-up, y-depth).
 * Three.js uses Y-up (x-right, y-up, z-depth).
 * We swap: VOX(x,y,z) → Three.js(x, z, y)
 *
 * The model is centered on X/Z and sits on Y=0.
 */
export function buildVoxMesh(
  model: VoxelModel,
  palette: Record<number, { r: number; g: number; b: number }>,
  targetHeight = 0.5,
): THREE.BufferGeometry {
  // Convert VoxelModel (sparse map) into a 3D grid for neighbor lookups
  // After coordinate swap: sizeX stays, sizeY = vox.z (height), sizeZ = vox.y (depth)
  const sizeX = model.size.x;
  const sizeY = model.size.z; // VOX Z becomes Three.js Y (height)
  const sizeZ = model.size.y; // VOX Y becomes Three.js Z (depth)

  // Build a lookup grid: grid[y][z][x] = colorIndex (0 = empty)
  const grid: number[][][] = [];
  for (let y = 0; y < sizeY; y++) {
    grid[y] = [];
    for (let z = 0; z < sizeZ; z++) {
      grid[y][z] = new Array(sizeX).fill(0);
    }
  }

  for (const [key, colorIdx] of model.voxels) {
    const [vx, vy, vz] = key.split(',').map(Number);
    // VOX (vx, vy, vz) → Three.js grid (vx, vz, vy)
    const gx = vx;
    const gy = vz;  // VOX Z → height
    const gz = vy;  // VOX Y → depth
    if (gy >= 0 && gy < sizeY && gz >= 0 && gz < sizeZ && gx >= 0 && gx < sizeX) {
      grid[gy][gz][gx] = colorIdx;
    }
  }

  // Scale to match target height
  const scale = targetHeight / sizeY;
  const ox = sizeX / 2;
  const oz = sizeZ / 2;

  // Convert palette from 0-255 to THREE.Color (0-1)
  const colorCache = new Map<number, THREE.Color>();
  function getColor(idx: number): THREE.Color {
    let c = colorCache.get(idx);
    if (!c) {
      const p = palette[idx];
      c = p ? new THREE.Color(p.r / 255, p.g / 255, p.b / 255) : new THREE.Color(1, 1, 1);
      colorCache.set(idx, c);
    }
    return c;
  }

  function isSolid(x: number, y: number, z: number): boolean {
    if (y < 0 || y >= sizeY) return false;
    if (z < 0 || z >= sizeZ) return false;
    if (x < 0 || x >= sizeX) return false;
    return grid[y][z][x] !== 0;
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];

  for (let y = 0; y < sizeY; y++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let x = 0; x < sizeX; x++) {
        const ci = grid[y][z][x];
        if (ci === 0) continue;
        const color = getColor(ci);

        for (const face of FACES) {
          const [nx, ny, nz] = face.dir;
          if (isSolid(x + nx, y + ny, z + nz)) continue;

          const v = face.verts;
          for (const idx of [0, 1, 2, 0, 2, 3]) {
            positions.push(
              (v[idx][0] + x - ox) * scale,
              (v[idx][1] + y) * scale,
              (v[idx][2] + z - oz) * scale,
            );
            normals.push(nx, ny, nz);
            colors.push(color.r, color.g, color.b);
          }
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeBoundingSphere();
  return geo;
}

// ── Geometry tinting ──

/**
 * Clone a geometry and shift the hue of all vertex colors.
 * Returns a new geometry — the original is untouched for reuse.
 *
 * @param geo Source geometry with a 'color' attribute (RGB, float 0-1)
 * @param hueShift Amount to shift hue by (0-1 wraps around)
 * @param satBoost Optional saturation multiplier (default 1.0)
 */
export function tintGeometry(
  geo: THREE.BufferGeometry,
  hueShift: number,
  satBoost = 1.0,
): THREE.BufferGeometry {
  const cloned = geo.clone();
  const colorAttr = cloned.getAttribute('color');
  if (!colorAttr) return cloned;

  const arr = (colorAttr as THREE.BufferAttribute).array as Float32Array;
  const tmpColor = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };

  for (let i = 0; i < arr.length; i += 3) {
    tmpColor.setRGB(arr[i], arr[i + 1], arr[i + 2]);
    tmpColor.getHSL(hsl);
    hsl.h = (hsl.h + hueShift) % 1;
    if (hsl.h < 0) hsl.h += 1;
    hsl.s = Math.min(1, hsl.s * satBoost);
    tmpColor.setHSL(hsl.h, hsl.s, hsl.l);
    arr[i] = tmpColor.r;
    arr[i + 1] = tmpColor.g;
    arr[i + 2] = tmpColor.b;
  }

  colorAttr.needsUpdate = true;
  return cloned;
}

// ── Character loader ──

const FRAME_PATTERNS = {
  idle: ['_idle_0', '_idle_1'],
  walk: ['_walk_0', '_walk_1', '_walk_2', '_walk_3'],
  action: ['_action_0', '_action_1'],
} as const;

/**
 * Load all animation frames for a VOX character.
 *
 * Accepts either:
 *  - (folderPath, prefix) — e.g. ("/models/.../VOX", "knight")
 *  - (name, basePath) — legacy: builds `basePath/name/name.vox`
 */
export async function loadVoxCharacter(
  folderPathOrName: string,
  prefixOrBasePath: string,
  targetHeight = 0.5,
): Promise<VoxCharacterData> {
  // Detect new-style call: folderPath ends with /VOX
  let dir: string;
  let prefix: string;
  if (folderPathOrName.endsWith('/VOX')) {
    dir = folderPathOrName;
    prefix = prefixOrBasePath;
  } else {
    // Legacy: name + basePath
    dir = `${prefixOrBasePath}/${folderPathOrName}`;
    prefix = folderPathOrName;
  }

  // Load base pose
  const { model: baseModel, palette } = await loadVoxModel(`${dir}/${prefix}.vox`);
  const base = buildVoxMesh(baseModel, palette, targetHeight);

  // Load animation frames in parallel
  const frames: VoxAnimFrames = { idle: [], walk: [], action: [] };

  const loadTasks: Promise<void>[] = [];

  for (const [animName, suffixes] of Object.entries(FRAME_PATTERNS)) {
    for (let i = 0; i < suffixes.length; i++) {
      const suffix = suffixes[i];
      const url = `${dir}/${prefix}${suffix}.vox`;
      const anim = animName as keyof VoxAnimFrames;
      const frameIdx = i;

      loadTasks.push(
        loadVoxModel(url)
          .then(({ model }) => {
            frames[anim][frameIdx] = buildVoxMesh(model, palette, targetHeight);
          })
          .catch((err) => {
            console.warn(`[VoxModelLoader] Failed to load frame ${url}:`, err);
            // Use base geometry as fallback
            frames[anim][frameIdx] = base;
          }),
      );
    }
  }

  await Promise.all(loadTasks);

  return { base, frames, palette };
}
