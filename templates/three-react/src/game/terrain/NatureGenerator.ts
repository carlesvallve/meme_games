import * as THREE from 'three';
import { sampleHeightmap } from './TerrainNoise';
import type { BiomeType, TerrainPalette } from './ColorPalettes';

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

// Smooth value noise with bilinear interpolation
function smoothNoise2D(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  // smoothstep for smoother blobs
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  // hash each grid corner to a deterministic [0,1] value
  const hash = (gx: number, gz: number) => {
    const h = Math.sin(gx * 127.1 + gz * 311.7 + seed * 53.3) * 43758.5453;
    return h - Math.floor(h);
  };
  const v00 = hash(ix, iz);
  const v10 = hash(ix + 1, iz);
  const v01 = hash(ix, iz + 1);
  const v11 = hash(ix + 1, iz + 1);
  return (
    v00 * (1 - sx) * (1 - sz) +
    v10 * sx * (1 - sz) +
    v01 * (1 - sx) * sz +
    v11 * sx * sz
  );
}

function fbmNoise(x: number, z: number, seed: number, octaves = 3): number {
  let value = 0;
  let amp = 1;
  let freq = 1;
  let max = 0;
  for (let i = 0; i < octaves; i++) {
    value += smoothNoise2D(x * freq, z * freq, seed + i * 1337) * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return value / max;
}

// ── Biome presets ───────────────────────────────────────────────────

interface BiomePreset {
  treeTypes: TreeType[];
  treeDensity: number; // 0-1, probability per sample point
  scatterTreeChance?: number; // sparse random trees outside patches (0-1)
  rockDensity: number;
  grassDensity: number;
  flowerDensity: number;
  trunkColor: number;
  leafColors: number[];
  rockColor: number;
  grassColors: number[];
  flowerColors: number[];
}

type TreeType =
  | 'deciduous'
  | 'pine'
  | 'palm'
  | 'simple_tall'
  | 'simple_cube'
  | 'cactus';

const BIOME_PRESETS: Record<BiomeType, BiomePreset> = {
  temperate: {
    treeTypes: ['deciduous', 'pine', 'simple_tall', 'simple_cube'],
    treeDensity: 0.18,
    rockDensity: 0.06,
    grassDensity: 0,
    flowerDensity: 0.15,
    trunkColor: 0x5a3a20,
    leafColors: [0x2a6a20, 0x358030, 0x407028, 0x4a8a30],
    rockColor: 0x707070,
    grassColors: [0x3a7a28, 0x4a8a30, 0x608828, 0x7a9a40],
    flowerColors: [0xe04040, 0xe0e040, 0x8040e0, 0xe080a0, 0x40a0e0],
  },
  autumn: {
    treeTypes: ['deciduous', 'deciduous', 'simple_tall', 'simple_cube'],
    treeDensity: 0.2,
    rockDensity: 0.06,
    grassDensity: 0,
    flowerDensity: 0.03,
    trunkColor: 0x4a3018,
    leafColors: [0xc06020, 0xd08030, 0xa04818, 0xe0a040],
    rockColor: 0x605040,
    grassColors: [0x907030, 0xa08038, 0x806020, 0xb09040],
    flowerColors: [0xd06020, 0xc08040],
  },
  tropical: {
    treeTypes: ['palm', 'deciduous', 'simple_tall', 'cactus'],
    treeDensity: 0.16,
    rockDensity: 0.04,
    grassDensity: 0,
    flowerDensity: 0.18,
    trunkColor: 0x8a7050,
    leafColors: [0x18a020, 0x20c028, 0x30b030, 0x28a838],
    rockColor: 0x908870,
    grassColors: [0x20a028, 0x30b830, 0x28c020],
    flowerColors: [0xff4080, 0xff8040, 0xffe040, 0x40e0ff, 0xff40ff],
  },
  winter: {
    treeTypes: ['pine', 'pine', 'simple_tall', 'simple_cube', 'deciduous'],
    treeDensity: 0.12,
    rockDensity: 0.08,
    grassDensity: 0,
    flowerDensity: 0,
    trunkColor: 0x403830,
    leafColors: [0x1a5030, 0x205838, 0x284830, 0x2a6040],
    rockColor: 0x8898a8,
    grassColors: [0x90a8b0, 0xa0b8c0],
    flowerColors: [],
  },
  desert: {
    treeTypes: ['cactus', 'cactus', 'simple_tall', 'simple_tall'],
    treeDensity: 0.06,
    scatterTreeChance: 0.04,
    rockDensity: 0.1,
    grassDensity: 0,
    flowerDensity: 0,
    trunkColor: 0x806848,
    leafColors: [0x4a7a30, 0x5a8838, 0x3a6828, 0x688a40],
    rockColor: 0xb89868,
    grassColors: [0xb0a060, 0xc8b870],
    flowerColors: [],
  },
  volcanic: {
    treeTypes: ['simple_tall', 'simple_cube', 'simple_tall', 'simple_cube'],
    treeDensity: 0.04,
    rockDensity: 0.14,
    grassDensity: 0,
    flowerDensity: 0,
    trunkColor: 0x282020,
    leafColors: [0x2a2020, 0x382018, 0x301818, 0x401810],
    rockColor: 0x282828,
    grassColors: [],
    flowerColors: [],
  },
  barren: {
    treeTypes: ['simple_tall', 'simple_cube', 'simple_tall'],
    treeDensity: 0.03,
    rockDensity: 0.12,
    grassDensity: 0,
    flowerDensity: 0,
    trunkColor: 0x604030,
    leafColors: [0x503828, 0x685040, 0x584030, 0x706050],
    rockColor: 0x6a3830,
    grassColors: [],
    flowerColors: [],
  },
  swamp: {
    treeTypes: ['deciduous', 'deciduous', 'simple_tall'],
    treeDensity: 0.14,
    rockDensity: 0.06,
    grassDensity: 0,
    flowerDensity: 0.05,
    trunkColor: 0x3a3020,
    leafColors: [0x3a5828, 0x4a6030, 0x485830],
    rockColor: 0x4a4838,
    grassColors: [0x4a5830, 0x586838, 0x506028],
    flowerColors: [0xc0a040, 0x80a060],
  },
  enchanted: {
    treeTypes: ['deciduous', 'pine', 'simple_cube', 'simple_tall'],
    treeDensity: 0.18,
    rockDensity: 0.06,
    grassDensity: 0,
    flowerDensity: 0.18,
    trunkColor: 0x3a2848,
    leafColors: [0x208848, 0x28a050, 0x309060, 0x1a7838],
    rockColor: 0x584070,
    grassColors: [0x208848, 0x309060, 0x28a050],
    flowerColors: [0xa060ff, 0x60a0ff, 0xff60c0, 0x60ffa0],
  },
};

// ── Voxel-style geometry builders ──────────────────────────────────
// All sizes relative to character height (~0.5 units).
// Base voxel unit V ≈ 0.03 matches character voxel resolution.

const V = 0.06;
const _tmpMatrix = new THREE.Matrix4();
const _tmpQuat = new THREE.Quaternion();
const _tmpScale = new THREE.Vector3();
const _tmpPos = new THREE.Vector3();

function voxBox(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  hex: number,
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(x, y + h / 2, z);
  colorGeometry(geo, hex);
  return geo;
}

function tintHex(hex: number, factor: number): number {
  const r = Math.min(
    255,
    Math.max(0, ((hex >> 16) & 0xff) + Math.round(factor * 255)),
  );
  const g = Math.min(
    255,
    Math.max(0, ((hex >> 8) & 0xff) + Math.round(factor * 255)),
  );
  const b = Math.min(255, Math.max(0, (hex & 0xff) + Math.round(factor * 255)));
  return (r << 16) | (g << 8) | b;
}

function hueShift(hex: number, rng: () => number, strength = 0.12): number {
  let r = ((hex >> 16) & 0xff) / 255;
  let g = ((hex >> 8) & 0xff) / 255;
  let b = (hex & 0xff) / 255;

  // Per-channel random shift for actual hue variation
  r = Math.min(1, Math.max(0, r + (rng() - 0.5) * strength * 2));
  g = Math.min(1, Math.max(0, g + (rng() - 0.5) * strength * 1.5));
  b = Math.min(1, Math.max(0, b + (rng() - 0.5) * strength * 1.8));

  // Slight brightness jitter
  const bright = 1 + (rng() - 0.5) * strength;
  r = Math.min(1, r * bright);
  g = Math.min(1, g * bright);
  b = Math.min(1, b * bright);

  return (
    (Math.round(r * 255) << 16) |
    (Math.round(g * 255) << 8) |
    Math.round(b * 255)
  );
}

function buildDeciduousTree(
  leafColor: number,
  trunkColor: number,
  rng: () => number,
): THREE.BufferGeometry {
  const trunkW = V * (1 + Math.floor(rng() * 2));
  const trunkH = V * (6 + Math.floor(rng() * 5));
  const parts: THREE.BufferGeometry[] = [];

  const lean = (rng() - 0.5) * V * 1;
  const trunk = voxBox(trunkW, trunkH, trunkW, 0, 0, 0, trunkColor);
  const tPos = trunk.getAttribute('position');
  for (let i = 0; i < tPos.count; i++) {
    const yFrac = tPos.getY(i) / trunkH;
    tPos.setX(i, tPos.getX(i) + lean * yFrac);
  }
  tPos.needsUpdate = true;
  parts.push(trunk);

  // 2-3 canopy blocks — simple and clean; foliage starts at trunk top. Each block sits on the previous so none float.
  const canopyBlocks = 2 + Math.floor(rng() * 2);
  let topY = trunkH;
  for (let i = 0; i < canopyBlocks; i++) {
    const bw = V * (3 + Math.floor(rng() * 3));
    const bh = V * (2 + Math.floor(rng() * 3));
    const bd = V * (3 + Math.floor(rng() * 3));
    const ox = lean * 0.6 + (rng() - 0.5) * V * 0.8;
    const oy = topY; // block bottom = top of previous (or trunk)
    const oz = (rng() - 0.5) * V * 0.8;
    parts.push(voxBox(bw, bh, bd, ox, oy, oz, hueShift(leafColor, rng)));
    topY = oy + bh;
  }

  return mergeGeometries(parts);
}

function buildPineTree(
  leafColor: number,
  trunkColor: number,
  rng: () => number,
): THREE.BufferGeometry {
  const trunkW = V * 1;
  const trunkH = V * (5 + Math.floor(rng() * 4));
  const parts: THREE.BufferGeometry[] = [];

  parts.push(voxBox(trunkW, trunkH, trunkW, 0, 0, 0, trunkColor));

  // 2-3 tapering layers; first layer sits on trunk top. Each layer sits on the previous so none float.
  const layerCount = 2 + Math.floor(rng() * 2);
  let topY = trunkH;
  for (let i = 0; i < layerCount; i++) {
    const t = i / layerCount;
    const layerW = V * (4 - Math.floor(t * 2.5));
    const layerH = V * (2 + Math.floor(rng() * 1.5));
    const oy = topY;
    parts.push(
      voxBox(layerW, layerH, layerW, 0, oy, 0, hueShift(leafColor, rng)),
    );
    topY = oy + layerH;
  }

  return mergeGeometries(parts);
}

function buildPalmTree(
  leafColor: number,
  trunkColor: number,
  rng: () => number,
): THREE.BufferGeometry {
  const segCount = 5 + Math.floor(rng() * 4);
  const segH = V * 2;
  const trunkW = V * 1;
  const parts: THREE.BufferGeometry[] = [];

  let cx = 0;
  for (let i = 0; i < segCount; i++) {
    const shade = tintHex(trunkColor, i % 2 === 0 ? 0.02 : -0.02);
    parts.push(voxBox(trunkW, segH, trunkW, cx, i * segH, 0, shade));
    cx += V * 0.3;
  }
  const topY = segCount * segH;

  const frondCount = 4 + Math.floor(rng() * 2);
  for (let i = 0; i < frondCount; i++) {
    const angle = (i / frondCount) * Math.PI * 2 + rng() * 0.4;
    const frondLen = V * (4 + Math.floor(rng() * 3));
    const frondW = V * 2;
    const frond = voxBox(
      frondLen,
      V,
      frondW,
      0,
      0,
      0,
      tintHex(leafColor, (rng() - 0.5) * 0.06),
    );
    frond.rotateY(angle);
    frond.rotateX(-0.35);
    frond.translate(
      cx + Math.cos(angle) * V * 2,
      topY,
      Math.sin(angle) * V * 2,
    );
    parts.push(frond);
  }

  return mergeGeometries(parts);
}

function buildSimpleTallTree(
  leafColor: number,
  trunkColor: number,
  rng: () => number,
): THREE.BufferGeometry {
  const trunkW = V * (0.8 + rng() * 0.5);
  const trunkH = V * (4 + Math.floor(rng() * 5));
  const parts: THREE.BufferGeometry[] = [];

  const lean = (rng() - 0.5) * V * 1;
  const trunk = voxBox(trunkW, trunkH, trunkW, 0, 0, 0, trunkColor);
  const tPos = trunk.getAttribute('position');
  for (let i = 0; i < tPos.count; i++) {
    const yFrac = tPos.getY(i) / trunkH;
    tPos.setX(i, tPos.getX(i) + lean * yFrac);
  }
  tPos.needsUpdate = true;
  parts.push(trunk);

  const canopyW = V * (1.5 + Math.floor(rng() * 2));
  const canopyH = V * (4 + Math.floor(rng() * 6));
  const canopyD = V * (1.5 + Math.floor(rng() * 2));
  const shade = hueShift(leafColor, rng);
  // Canopy sits on trunk top so trunk never sticks above foliage
  parts.push(voxBox(canopyW, canopyH, canopyD, lean * 0.7, trunkH, 0, shade));

  return mergeGeometries(parts);
}

function buildSimpleCubeTree(
  leafColor: number,
  trunkColor: number,
  rng: () => number,
): THREE.BufferGeometry {
  const trunkW = V * (0.8 + rng() * 0.5);
  const trunkH = V * (3 + Math.floor(rng() * 5));
  const parts: THREE.BufferGeometry[] = [];

  const lean = (rng() - 0.5) * V * 0.8;
  const trunk = voxBox(trunkW, trunkH, trunkW, 0, 0, 0, trunkColor);
  const tPos = trunk.getAttribute('position');
  for (let i = 0; i < tPos.count; i++) {
    const yFrac = tPos.getY(i) / trunkH;
    tPos.setX(i, tPos.getX(i) + lean * yFrac);
  }
  tPos.needsUpdate = true;
  parts.push(trunk);

  const cubeSize = V * (3 + Math.floor(rng() * 4));
  const shade = hueShift(leafColor, rng);
  // Cube sits on trunk top so trunk never sticks above foliage
  parts.push(
    voxBox(cubeSize, cubeSize, cubeSize, lean * 0.6, trunkH, 0, shade),
  );

  return mergeGeometries(parts);
}

function buildCactus(
  leafColor: number,
  _trunkColor: number,
  rng: () => number,
): THREE.BufferGeometry {
  const bodyW = V * (1.5 + rng() * 1);
  const bodyH = V * (5 + Math.floor(rng() * 6));
  const parts: THREE.BufferGeometry[] = [];

  const shade0 = hueShift(leafColor, rng, 0.06);
  parts.push(voxBox(bodyW, bodyH, bodyW, 0, 0, 0, shade0));

  // Arms (1-2)
  const armCount = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < armCount; i++) {
    const armH = V * (2 + Math.floor(rng() * 3));
    const armW = V * (1 + rng() * 0.5);
    const side = i === 0 ? 1 : -1;
    const yOff = bodyH * (0.3 + rng() * 0.35);

    const horizLen = V * (1.5 + rng() * 1.5);
    const shade1 = hueShift(leafColor, rng, 0.06);
    parts.push(
      voxBox(
        horizLen,
        armW,
        armW,
        side * (bodyW / 2 + horizLen / 2),
        yOff,
        0,
        shade1,
      ),
    );

    const shade2 = hueShift(leafColor, rng, 0.06);
    parts.push(
      voxBox(
        armW,
        armH,
        armW,
        side * (bodyW / 2 + horizLen - armW / 2),
        yOff + armW,
        0,
        shade2,
      ),
    );
  }

  const geo = mergeGeometries(parts);
  geo.scale(0.5, 0.5, 0.5); // cactuses ~half the size of trees
  return geo;
}

function buildRock(color: number, rng: () => number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const blockCount = 1 + Math.floor(rng() * 2);

  for (let i = 0; i < blockCount; i++) {
    const bw = V * (2 + Math.floor(rng() * 2));
    const bh = V * (1 + Math.floor(rng() * 2));
    const bd = V * (2 + Math.floor(rng() * 2));
    const ox = i > 0 ? (rng() - 0.5) * V * 2 : 0;
    const oz = i > 0 ? (rng() - 0.5) * V * 2 : 0;
    const shade = tintHex(color, (rng() - 0.5) * 0.06);
    const block = voxBox(bw, bh, bd, 0, 0, 0, shade);
    block.rotateY(rng() * Math.PI);
    block.translate(ox, bh * 0.2, oz);
    parts.push(block);
  }

  return mergeGeometries(parts);
}

function buildGrassTuft(
  color: number,
  rng: () => number,
): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const clumpCount = 4 + Math.floor(rng() * 6);

  for (let i = 0; i < clumpCount; i++) {
    const bh = V * (1 + rng() * 2);
    const bw = V * (0.4 + rng() * 0.4);
    const ox = (rng() - 0.5) * V * 3;
    const oz = (rng() - 0.5) * V * 3;
    const shade = hueShift(color, rng, 0.06);
    parts.push(voxBox(bw, bh, bw, ox, 0, oz, shade));
  }

  return mergeGeometries(parts);
}

function buildFlower(
  petalColor: number,
  stemColor: number,
  rng: () => number,
): THREE.BufferGeometry {
  const stemH = V * (2 + Math.floor(rng() * 2));
  const stemW = V * 0.5;
  const parts: THREE.BufferGeometry[] = [];

  parts.push(voxBox(stemW, stemH, stemW, 0, 0, 0, stemColor));

  const headSize = V * (1 + rng() * 0.5);
  parts.push(voxBox(headSize, headSize, headSize, 0, stemH, 0, petalColor));

  if (rng() > 0.4) {
    const petalW = V * 0.8;
    const offsets = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    const picked = offsets.filter(() => rng() > 0.3);
    for (const [dx, dz] of picked) {
      const shade = tintHex(petalColor, (rng() - 0.5) * 0.1);
      parts.push(
        voxBox(
          petalW,
          petalW,
          petalW,
          dx * headSize * 0.7,
          stemH + headSize * 0.1,
          dz * headSize * 0.7,
          shade,
        ),
      );
    }
  }

  return mergeGeometries(parts);
}

// ── Organic geometry builders (rounded style, unused by default) ───

function displaceVertices(
  geo: THREE.BufferGeometry,
  amount: number,
  rng: () => number,
): void {
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const nx = pos.getX(i);
    const ny = pos.getY(i);
    const nz = pos.getZ(i);
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const d = (rng() - 0.5) * amount;
    pos.setXYZ(
      i,
      nx + (nx / len) * d,
      ny + (ny / len) * d,
      nz + (nz / len) * d,
    );
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

function buildOrganicDeciduousTree(
  leafColor: number,
  trunkColor: number,
  rng: () => number,
): THREE.BufferGeometry {
  const trunkH = 0.4 + rng() * 0.3;
  const trunkR = 0.03 + rng() * 0.02;
  const trunk = new THREE.CylinderGeometry(trunkR * 0.6, trunkR, trunkH, 5);
  trunk.translate(0, trunkH / 2, 0);
  colorGeometry(trunk, trunkColor);

  const canopyR = 0.2 + rng() * 0.15;
  const canopy = new THREE.IcosahedronGeometry(canopyR, 1);
  displaceVertices(canopy, canopyR * 0.3, rng);
  canopy.translate(0, trunkH + canopyR * 0.5, 0);
  colorGeometry(canopy, leafColor);

  return mergeGeometries([trunk, canopy]);
}

function buildOrganicPineTree(
  leafColor: number,
  trunkColor: number,
  rng: () => number,
): THREE.BufferGeometry {
  const trunkH = 0.3 + rng() * 0.2;
  const trunkR = 0.025 + rng() * 0.015;
  const trunk = new THREE.CylinderGeometry(trunkR * 0.5, trunkR, trunkH, 5);
  trunk.translate(0, trunkH / 2, 0);
  colorGeometry(trunk, trunkColor);

  const layers: THREE.BufferGeometry[] = [trunk];
  const coneCount = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < coneCount; i++) {
    const t = i / coneCount;
    const r = 0.22 - t * 0.06 + rng() * 0.04;
    const h = 0.18 + rng() * 0.06;
    const cone = new THREE.ConeGeometry(r, h, 6);
    cone.translate(0, trunkH + i * h * 0.55 + h * 0.4, 0);
    colorGeometry(cone, leafColor);
    layers.push(cone);
  }
  return mergeGeometries(layers);
}

function buildOrganicPalmTree(
  leafColor: number,
  trunkColor: number,
  rng: () => number,
): THREE.BufferGeometry {
  const trunkH = 0.6 + rng() * 0.4;
  const trunkR = 0.025 + rng() * 0.015;
  const trunk = new THREE.CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 5);
  trunk.translate(0, trunkH / 2, 0);
  const tPos = trunk.getAttribute('position');
  for (let i = 0; i < tPos.count; i++) {
    const y = tPos.getY(i);
    const bend = (y / trunkH) * (y / trunkH) * 0.15;
    tPos.setX(i, tPos.getX(i) + bend);
  }
  tPos.needsUpdate = true;
  colorGeometry(trunk, trunkColor);

  const fronds: THREE.BufferGeometry[] = [trunk];
  const frondCount = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < frondCount; i++) {
    const angle = (i / frondCount) * Math.PI * 2 + rng() * 0.3;
    const frondLen = 0.3 + rng() * 0.15;
    const frond = new THREE.PlaneGeometry(0.06, frondLen);
    frond.rotateX(-Math.PI * 0.35);
    frond.rotateY(angle);
    frond.translate(
      Math.cos(angle) * 0.05,
      trunkH - 0.02,
      Math.sin(angle) * 0.05,
    );
    colorGeometry(frond, leafColor);
    fronds.push(frond);
  }
  return mergeGeometries(fronds);
}

function buildOrganicRock(
  color: number,
  rng: () => number,
): THREE.BufferGeometry {
  const size = 0.08 + rng() * 0.15;
  const geo = new THREE.DodecahedronGeometry(size, 0);
  displaceVertices(geo, size * 0.35, rng);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, pos.getY(i) * (0.5 + rng() * 0.3));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.translate(0, size * 0.2, 0);
  colorGeometry(geo, color);
  return geo;
}

function buildOrganicGrassTuft(
  color: number,
  rng: () => number,
): THREE.BufferGeometry {
  const h = 0.06 + rng() * 0.08;
  const w = 0.04 + rng() * 0.03;
  const p1 = new THREE.PlaneGeometry(w, h);
  p1.translate(0, h / 2, 0);
  const p2 = new THREE.PlaneGeometry(w, h);
  p2.rotateY(Math.PI / 2);
  p2.translate(0, h / 2, 0);
  colorGeometry(p1, color);
  colorGeometry(p2, color);
  return mergeGeometries([p1, p2]);
}

function buildOrganicFlower(
  petalColor: number,
  stemColor: number,
  rng: () => number,
): THREE.BufferGeometry {
  const stemH = 0.05 + rng() * 0.06;
  const stem = new THREE.CylinderGeometry(0.004, 0.004, stemH, 3);
  stem.translate(0, stemH / 2, 0);
  colorGeometry(stem, stemColor);

  const head = new THREE.SphereGeometry(0.015 + rng() * 0.01, 4, 3);
  head.translate(0, stemH + 0.01, 0);
  colorGeometry(head, petalColor);

  return mergeGeometries([stem, head]);
}

// Suppress unused warnings — these are kept for potential style switching
void buildOrganicDeciduousTree;
void buildOrganicPineTree;
void buildOrganicPalmTree;
void buildOrganicRock;
void buildOrganicGrassTuft;
void buildOrganicFlower;

// ── Geometry helpers ────────────────────────────────────────────────

function colorGeometry(geo: THREE.BufferGeometry, hex: number): void {
  const color = new THREE.Color(hex);
  const count = geo.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIdx = 0;
  for (const g of geos) {
    totalVerts += g.getAttribute('position').count;
    totalIdx += g.index ? g.index.count : g.getAttribute('position').count;
  }

  const positions = new Float32Array(totalVerts * 3);
  const colors = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIdx);

  let vertOffset = 0;
  let idxOffset = 0;

  for (const g of geos) {
    const pos = g.getAttribute('position');
    const col = g.getAttribute('color');
    const nor = g.getAttribute('normal');
    const count = pos.count;

    for (let i = 0; i < count; i++) {
      positions[(vertOffset + i) * 3] = pos.getX(i);
      positions[(vertOffset + i) * 3 + 1] = pos.getY(i);
      positions[(vertOffset + i) * 3 + 2] = pos.getZ(i);
      if (col) {
        colors[(vertOffset + i) * 3] = col.getX(i);
        colors[(vertOffset + i) * 3 + 1] = col.getY(i);
        colors[(vertOffset + i) * 3 + 2] = col.getZ(i);
      }
      if (nor) {
        normals[(vertOffset + i) * 3] = nor.getX(i);
        normals[(vertOffset + i) * 3 + 1] = nor.getY(i);
        normals[(vertOffset + i) * 3 + 2] = nor.getZ(i);
      }
    }

    if (g.index) {
      for (let i = 0; i < g.index.count; i++) {
        indices[idxOffset + i] = g.index.getX(i) + vertOffset;
      }
      idxOffset += g.index.count;
    } else {
      for (let i = 0; i < count; i++) {
        indices[idxOffset + i] = vertOffset + i;
      }
      idxOffset += count;
    }
    vertOffset += count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setIndex(new THREE.BufferAttribute(indices.slice(0, idxOffset), 1));
  return merged;
}

// ── Instanced batch ─────────────────────────────────────────────────

interface InstancedBatch {
  mesh: THREE.InstancedMesh;
  count: number;
  maxCount: number;
}

function createBatch(
  geo: THREE.BufferGeometry,
  maxCount: number,
  castShadow = false,
): InstancedBatch {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    metalness: 0.05,
    flatShading: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, maxCount);
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.count = 0;
  mesh.frustumCulled = false;
  return { mesh, count: 0, maxCount };
}

const _upVec = new THREE.Vector3(0, 1, 0);

function addInstance(
  batch: InstancedBatch,
  x: number,
  y: number,
  z: number,
  rotY: number,
  scale: number,
  tiltX = 0,
  tiltZ = 0,
): void {
  if (batch.count >= batch.maxCount) return;
  _tmpPos.set(x, y, z);
  const euler = new THREE.Euler(tiltX, rotY, tiltZ, 'YXZ');
  _tmpQuat.setFromEuler(euler);
  _tmpScale.setScalar(scale);
  _tmpMatrix.compose(_tmpPos, _tmpQuat, _tmpScale);
  batch.mesh.setMatrixAt(batch.count, _tmpMatrix);
  batch.count++;
  batch.mesh.count = batch.count;
}

function addInstanceOnNormal(
  batch: InstancedBatch,
  x: number,
  y: number,
  z: number,
  normal: THREE.Vector3,
  rotY: number,
  scale: number,
): void {
  if (batch.count >= batch.maxCount) return;
  _tmpPos.set(x, y, z);
  _tmpQuat.setFromUnitVectors(_upVec, normal);
  const yRot = new THREE.Quaternion().setFromAxisAngle(_upVec, rotY);
  _tmpQuat.multiply(yRot);
  _tmpScale.setScalar(scale);
  _tmpMatrix.compose(_tmpPos, _tmpQuat, _tmpScale);
  batch.mesh.setMatrixAt(batch.count, _tmpMatrix);
  batch.count++;
  batch.mesh.count = batch.count;
}

// ── Main generator ──────────────────────────────────────────────────

export type PatchSampler = (x: number, z: number) => number;

export interface NatureGeneratorResult {
  group: THREE.Group;
  treePositions: { x: number; z: number; halfW: number; halfD: number; height: number; rotY: number; offsetX: number }[];
  rockPositions: { x: number; z: number; halfW: number; halfD: number; height: number }[];
  patchThreshold: number;
  treePatch: PatchSampler;
  rockPatch: PatchSampler;
  flowerPatch: PatchSampler;
  hasTrees: boolean;
  hasRocks: boolean;
  hasFlowers: boolean;
  dispose: () => void;
}

export function generateNature(
  heights: Float32Array,
  resolution: number,
  groundSize: number,
  waterY: number,
  biome: BiomeType,
  _palette: TerrainPalette,
  seed: number,
  exclusions: { x: number; z: number; r: number }[] = [],
  useBiomes = true,
): NatureGeneratorResult {
  const preset = BIOME_PRESETS[biome];
  const rng = mulberry32(seed + 8888);
  const group = new THREE.Group();

  const isExcluded = (wx: number, wz: number): boolean => {
    for (const e of exclusions) {
      const dx = wx - e.x;
      const dz = wz - e.z;
      if (dx * dx + dz * dz < e.r * e.r) return true;
    }
    return false;
  };
  group.name = 'nature';
  const treePositions: { x: number; z: number; halfW: number; halfD: number; height: number; rotY: number; offsetX: number }[] = [];
  const rockPositions: { x: number; z: number; halfW: number; halfD: number; height: number }[] = [];

  const halfGround = groundSize / 2;
  const hmCellSize = groundSize / resolution;

  // Slope sampling helper
  const _gradientAt = (wx: number, wz: number): [number, number] => {
    const eps = hmCellSize * 0.5;
    const hL = sampleHeightmap(heights, resolution, groundSize, wx - eps, wz);
    const hR = sampleHeightmap(heights, resolution, groundSize, wx + eps, wz);
    const hU = sampleHeightmap(heights, resolution, groundSize, wx, wz - eps);
    const hD = sampleHeightmap(heights, resolution, groundSize, wx, wz + eps);
    return [(hR - hL) / (2 * eps), (hD - hU) / (2 * eps)];
  };
  const slopeAt = (wx: number, wz: number): number => {
    const [gx, gz] = _gradientAt(wx, wz);
    return Math.sqrt(gx * gx + gz * gz);
  };
  const terrainNormalAt = (wx: number, wz: number): THREE.Vector3 => {
    const [gx, gz] = _gradientAt(wx, wz);
    return new THREE.Vector3(-gx, 1, -gz).normalize();
  };

  // Build multiple geometry variants per type for visual diversity
  const TREE_VARIANTS = 8;
  const ROCK_VARIANTS = 5;
  const GRASS_VARIANTS = 4;
  const FLOWER_VARIANTS = 5;

  // Generate unique hue-shifted leaf colors for each tree variant
  const variantLeafColors: number[] = [];
  const leafRng = mulberry32(seed + 9876);
  for (let v = 0; v < TREE_VARIANTS; v++) {
    const base = preset.leafColors[v % preset.leafColors.length];
    variantLeafColors.push(hueShift(base, leafRng, 0.15));
  }

  const treeGeos: THREE.BufferGeometry[] = [];
  const treeTypes: string[] = [];
  for (let v = 0; v < TREE_VARIANTS; v++) {
    const ttype = preset.treeTypes[v % preset.treeTypes.length];
    const leafColor = variantLeafColors[v];
    const treeRng = mulberry32(seed + 1111 + v * 777);
    let geo: THREE.BufferGeometry;
    switch (ttype) {
      case 'deciduous':
        geo = buildDeciduousTree(leafColor, preset.trunkColor, treeRng);
        break;
      case 'pine':
        geo = buildPineTree(leafColor, preset.trunkColor, treeRng);
        break;
      case 'palm':
        geo = buildPalmTree(leafColor, preset.trunkColor, treeRng);
        break;
      case 'simple_tall':
        geo = buildSimpleTallTree(leafColor, preset.trunkColor, treeRng);
        break;
      case 'simple_cube':
        geo = buildSimpleCubeTree(leafColor, preset.trunkColor, treeRng);
        break;
      case 'cactus':
        geo = buildCactus(leafColor, preset.trunkColor, treeRng);
        break;
    }
    treeGeos.push(geo);
    treeTypes.push(ttype);
  }

  const rockGeos: THREE.BufferGeometry[] = [];
  for (let v = 0; v < ROCK_VARIANTS; v++) {
    rockGeos.push(
      buildRock(preset.rockColor, mulberry32(seed + 2222 + v * 333)),
    );
  }

  const grassGeos: THREE.BufferGeometry[] = [];
  for (let v = 0; v < GRASS_VARIANTS; v++) {
    const gc =
      preset.grassColors.length > 0
        ? preset.grassColors[v % preset.grassColors.length]
        : 0x448844;
    grassGeos.push(
      buildGrassTuft(
        hueShift(gc, mulberry32(seed + 7777 + v), 0.08),
        mulberry32(seed + 3333 + v * 444),
      ),
    );
  }

  const flowerGeos: THREE.BufferGeometry[] = [];
  if (preset.flowerColors.length > 0) {
    for (let v = 0; v < FLOWER_VARIANTS; v++) {
      const fc = preset.flowerColors[v % preset.flowerColors.length];
      flowerGeos.push(
        buildFlower(
          hueShift(fc, mulberry32(seed + 8888 + v), 0.12),
          0x2a6a20,
          mulberry32(seed + 4444 + v * 555),
        ),
      );
    }
  }

  // Compute collision bounding box per tree geo — type-specific trunk sizing
  // Trunk dimensions are hardcoded per type since merged geo includes leaves
  const TRUNK_HALF = V * 0.6; // default thin trunk half-width
  const treeBBoxes: { hw: number; hd: number; maxY: number; offsetX: number }[] = treeGeos.map((g, i) => {
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const ttype = treeTypes[i];
    switch (ttype) {
      case 'palm': {
        // Palm: thin trunk that leans in +X. Offset collider to follow trunk midpoint.
        // Trunk lean: cx += V*0.3 per segment, ~7 segments avg → total lean ~0.126
        // Midpoint offset is half the total lean
        const avgLean = V * 0.3 * 6 * 0.5; // approximate midpoint of trunk lean
        return { hw: TRUNK_HALF, hd: TRUNK_HALF, maxY: bb.max.y, offsetX: avgLean };
      }
      case 'cactus':
        // Cactus: asymmetric (arms on X axis), use full bbox scaled down
        return {
          hw: Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)) * 0.7,
          hd: Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z)) * 0.7,
          maxY: bb.max.y,
          offsetX: 0,
        };
      default: {
        // Other trees: trunk-width footprint (~35% of full bbox)
        const trunkFrac = 0.35;
        return {
          hw: Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)) * trunkFrac,
          hd: Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z)) * trunkFrac,
          maxY: bb.max.y,
          offsetX: 0,
        };
      }
    }
  });

  // Compute bounding box per rock geo for collision sizing
  const rockBBoxes: { hw: number; hd: number; maxY: number }[] = rockGeos.map((g) => {
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    return { hw: Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)), hd: Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z)), maxY: bb.max.y };
  });

  // Create batches with generous limits
  const treeBatches: InstancedBatch[] = treeGeos.map((g) =>
    createBatch(g, 200, true),
  );
  const rockBatches: InstancedBatch[] = rockGeos.map((g) =>
    createBatch(g, 150),
  );
  const grassBatches: InstancedBatch[] = grassGeos.map((g) =>
    createBatch(g, 500),
  );
  const flowerBatches: InstancedBatch[] = flowerGeos.map((g) =>
    createBatch(g, 200),
  );

  // ── Patch-based placement ─────────────────────────────────────────
  // Each element type has its own noise blob layer. Elements ONLY spawn
  // where their blob noise exceeds a high threshold, creating isolated
  // patches with empty terrain between them. Different seeds ensure
  // tree groves, rock outcrops, and flower fields don't overlap.

  const patchFreq = 0.15;
  const PATCH_THRESHOLD = 0.7;

  const treePatch = (x: number, z: number) =>
    fbmNoise(x * patchFreq, z * patchFreq, seed + 7001, 2);
  const rockPatch = (x: number, z: number) =>
    fbmNoise(x * patchFreq * 0.85, z * patchFreq * 0.85, seed + 7002, 2);
  const flowerPatchNoise = (x: number, z: number) =>
    fbmNoise(x * patchFreq * 1.1, z * patchFreq * 1.1, seed + 7003, 2);

  const sampleStep = 0.5;
  const margin = 2;
  const maxSlopeForTrees = 0.4;
  const maxSlopeForFlowers = 0.5;

  for (
    let wx = -halfGround + margin;
    wx < halfGround - margin;
    wx += sampleStep
  ) {
    for (
      let wz = -halfGround + margin;
      wz < halfGround - margin;
      wz += sampleStep
    ) {
      const jx = wx + (rng() - 0.5) * sampleStep * 0.9;
      const jz = wz + (rng() - 0.5) * sampleStep * 0.9;
      const h = sampleHeightmap(heights, resolution, groundSize, jx, jz);

      if (h < waterY + 0.05) continue;
      if (isExcluded(jx, jz)) continue;

      const slope = slopeAt(jx, jz);
      const rotY = rng() * Math.PI * 2;

      // ── Tree groves
      const tp = treePatch(jx, jz);
      const treeInPatch = useBiomes ? tp > PATCH_THRESHOLD : true;
      const treeFill = useBiomes
        ? 0.12 + 0.2 * ((tp - PATCH_THRESHOLD) / (1 - PATCH_THRESHOLD))
        : preset.treeDensity * 0.3;
      if (
        treeInPatch &&
        slope < maxSlopeForTrees &&
        preset.treeDensity > 0 &&
        treeBatches.length > 0
      ) {
        if (rng() < treeFill) {
          const batchIdx = Math.floor(rng() * treeBatches.length);
          const scale = (0.6 + rng() * 0.8) * 2.0;
          const tiltX = (rng() - 0.5) * 0.08;
          const tiltZ = (rng() - 0.5) * 0.08;
          addInstance(
            treeBatches[batchIdx],
            jx,
            h,
            jz,
            rotY,
            scale,
            tiltX,
            tiltZ,
          );
          const tbb = treeBBoxes[batchIdx];
          treePositions.push({ x: jx, z: jz, halfW: tbb.hw * scale, halfD: tbb.hd * scale, height: tbb.maxY * scale, rotY, offsetX: tbb.offsetX * scale });
        }
      }

      // ── Rock outcrops
      const rp = rockPatch(jx, jz);
      const rockInPatch = useBiomes ? rp > PATCH_THRESHOLD : true;
      const rockFill = useBiomes
        ? 0.15 + 0.25 * ((rp - PATCH_THRESHOLD) / (1 - PATCH_THRESHOLD))
        : preset.rockDensity * 0.3;
      if (rockInPatch && preset.rockDensity > 0 && rockBatches.length > 0) {
        if (rng() < rockFill) {
          const batchIdx = Math.floor(rng() * rockBatches.length);
          const scale = 0.5 + rng() * 1.2;
          const sink = V * scale * 0.3;
          if (rng() < 0.7) {
            const normal = terrainNormalAt(jx, jz);
            addInstanceOnNormal(
              rockBatches[batchIdx],
              jx,
              h - sink,
              jz,
              normal,
              rotY,
              scale,
            );
          } else {
            const tiltX = (rng() - 0.5) * 0.6;
            const tiltZ = (rng() - 0.5) * 0.6;
            addInstance(
              rockBatches[batchIdx],
              jx,
              h - sink * 1.5,
              jz,
              rotY,
              scale,
              tiltX,
              tiltZ,
            );
          }
          const rbb = rockBBoxes[batchIdx];
          rockPositions.push({ x: jx, z: jz, halfW: rbb.hw * scale, halfD: rbb.hd * scale, height: rbb.maxY * scale });
        }
      }

      // ── Flower fields
      const fp = flowerPatchNoise(jx, jz);
      const flowerInPatch = useBiomes ? fp > PATCH_THRESHOLD : true;
      const flowerFill = useBiomes
        ? 0.15 + 0.25 * ((fp - PATCH_THRESHOLD) / (1 - PATCH_THRESHOLD))
        : preset.flowerDensity * 0.3;
      if (
        flowerInPatch &&
        slope < maxSlopeForFlowers &&
        preset.flowerDensity > 0 &&
        flowerBatches.length > 0
      ) {
        if (rng() < flowerFill) {
          const subCount = 1 + Math.floor(rng() * 3);
          for (let s = 0; s < subCount; s++) {
            const sx = jx + (rng() - 0.5) * 0.3;
            const sz = jz + (rng() - 0.5) * 0.3;
            const sh = sampleHeightmap(heights, resolution, groundSize, sx, sz);
            if (sh < waterY + 0.05) continue;
            const batchIdx = Math.floor(rng() * flowerBatches.length);
            addInstance(
              flowerBatches[batchIdx],
              sx,
              sh,
              sz,
              rng() * Math.PI * 2,
              (0.6 + rng() * 0.6) * 0.7,
            );
          }
        }
      }

      // ── Scattered lone trees outside patches (e.g. desert cacti)
      if (
        useBiomes &&
        preset.scatterTreeChance &&
        tp <= PATCH_THRESHOLD &&
        slope < maxSlopeForTrees &&
        treeBatches.length > 0
      ) {
        if (rng() < preset.scatterTreeChance) {
          const batchIdx = Math.floor(rng() * treeBatches.length);
          const scale = (0.5 + rng() * 0.7) * 2.0;
          const tiltX = (rng() - 0.5) * 0.06;
          const tiltZ = (rng() - 0.5) * 0.06;
          addInstance(
            treeBatches[batchIdx],
            jx,
            h,
            jz,
            rotY,
            scale,
            tiltX,
            tiltZ,
          );
          const tbb = treeBBoxes[batchIdx];
          treePositions.push({ x: jx, z: jz, halfW: tbb.hw * scale, halfD: tbb.hd * scale, height: tbb.maxY * scale, rotY, offsetX: tbb.offsetX * scale });
        }
      }

      // ── Scattered lone rocks outside patches (everywhere)
      if (
        useBiomes &&
        rp <= PATCH_THRESHOLD &&
        rockBatches.length > 0 &&
        rng() < 0.015
      ) {
        const batchIdx = Math.floor(rng() * rockBatches.length);
        const scale = 0.4 + rng() * 0.8;
        const sink = V * scale * 0.4;
        const tiltX = (rng() - 0.5) * 0.4;
        const tiltZ = (rng() - 0.5) * 0.4;
        addInstance(
          rockBatches[batchIdx],
          jx,
          h - sink,
          jz,
          rotY,
          scale,
          tiltX,
          tiltZ,
        );
      }
    }
  }

  // Finalize instanced meshes
  const allBatches = [
    ...treeBatches,
    ...rockBatches,
    ...grassBatches,
    ...flowerBatches,
  ];

  for (const batch of allBatches) {
    if (batch.count > 0) {
      batch.mesh.instanceMatrix.needsUpdate = true;
      group.add(batch.mesh);
    }
  }

  const totalTrees = treeBatches.reduce((s, b) => s + b.count, 0);
  const totalRocks = rockBatches.reduce((s, b) => s + b.count, 0);
  const totalGrass = grassBatches.reduce((s, b) => s + b.count, 0);
  const totalFlowers = flowerBatches.reduce((s, b) => s + b.count, 0);

  // console.log(
  //   `[Nature] biome=${biome}, trees=${totalTrees}, rocks=${totalRocks}, ` +
  //   `grass=${totalGrass}, flowers=${totalFlowers}`,
  // );

  return {
    group,
    treePositions,
    rockPositions,
    patchThreshold: PATCH_THRESHOLD,
    treePatch,
    rockPatch,
    flowerPatch: flowerPatchNoise,
    hasTrees: preset.treeDensity > 0 && preset.leafColors.length > 0,
    hasRocks: preset.rockDensity > 0,
    hasFlowers: preset.flowerDensity > 0 && preset.flowerColors.length > 0,
    dispose: () => {
      for (const batch of allBatches) {
        batch.mesh.geometry.dispose();
        (batch.mesh.material as THREE.Material).dispose();
      }
    },
  };
}
