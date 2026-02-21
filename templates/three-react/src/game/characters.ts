import * as THREE from 'three';

// ── Palette ──

const P = {
  _: 0,
  Skin: 1,
  Hair: 2,
  Team: 3,
  TeamDark: 4,
  Boots: 5,
  Metal: 6,
  MetalDark: 7,
  Visor: 8,
  Eyes: 9,
  Black: 10,
  White: 11,
  Brown: 12,
  HairLight: 13,
  Grey: 14,
} as const;

export function buildPalette(teamColor: string): Record<number, THREE.Color> {
  const team = new THREE.Color(teamColor);
  const teamDark = team.clone().multiplyScalar(0.55);

  return {
    [P._]:         new THREE.Color('#000000'),
    [P.Skin]:      new THREE.Color('#e8b89a'),
    [P.Hair]:      new THREE.Color('#2a1f1a'),
    [P.Team]:      team,
    [P.TeamDark]:  teamDark,
    [P.Boots]:     new THREE.Color('#1a1a2e'),
    [P.Metal]:     new THREE.Color('#7a8a9a'),
    [P.MetalDark]: new THREE.Color('#4a5a6a'),
    [P.Visor]:     team,
    [P.Eyes]:      new THREE.Color('#111122'),
    [P.Black]:     new THREE.Color('#0e0e1a'),
    [P.White]:     new THREE.Color('#e0e0e8'),
    [P.Brown]:     new THREE.Color('#8B5E3C'),
    [P.HairLight]: new THREE.Color('#c49a5a'),
    [P.Grey]:      new THREE.Color('#6b6b7a'),
  };
}

// ── Model Definitions ──

type Slice = number[][];

interface VoxelModelDef {
  width: number;
  depth: number;
  slices: Slice[];
  modelScale?: number;
  headStart?: number;
}

const o = P._;
const S = P.Skin;
const H = P.Hair;
const T = P.Team;
const D = P.TeamDark;
const B = P.Boots;
const M = P.Metal;
const m = P.MetalDark;
const V = P.Visor;
const K = P.Black;
const W = P.White;
const R = P.Brown;
const L = P.HairLight;
const G = P.Grey;

const BOY_MODEL: VoxelModelDef = {
  width: 7, depth: 5, headStart: 8,
  slices: [
    [[o,B,B,o,B,B,o],[o,B,B,o,B,B,o],[o,B,B,o,B,B,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[o,B,B,o,B,B,o],[o,B,B,o,B,B,o],[o,B,B,o,B,B,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[o,K,K,o,K,K,o],[o,K,K,o,K,K,o],[o,K,K,o,K,K,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[o,D,D,D,D,D,o],[S,D,K,K,K,D,S],[o,D,D,D,D,D,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[o,T,T,T,T,T,o],[T,T,T,T,T,T,T],[o,T,T,T,T,T,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[o,T,T,T,T,T,o],[T,T,T,T,T,T,T],[o,T,T,T,T,T,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[D,T,T,T,T,T,D],[D,T,T,T,T,T,D],[D,T,T,T,T,T,D],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[o,o,o,o,o,o,o],[o,o,o,S,o,o,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[o,S,S,S,S,S,o],[o,S,S,S,S,S,o],[o,S,S,S,S,S,o],[o,H,H,H,H,H,o],[o,o,o,o,o,o,o]],
    [[o,S,K,S,K,S,o],[o,S,S,S,S,S,o],[o,S,S,S,S,S,o],[o,H,H,H,H,H,o],[o,o,o,o,o,o,o]],
    [[H,S,S,S,S,S,H],[H,S,S,S,S,S,H],[H,S,S,S,S,S,H],[H,H,H,H,H,H,H],[o,o,o,o,o,o,o]],
    [[H,H,H,H,H,H,H],[H,H,H,H,H,H,H],[H,H,H,H,H,H,H],[H,H,H,H,H,H,H],[o,o,o,o,o,o,o]],
    [[H,H,H,H,H,H,H],[H,H,H,H,H,H,H],[H,H,H,H,H,H,H],[H,H,H,H,H,H,H],[H,o,o,o,o,o,H]],
  ],
};

const GIRL_MODEL: VoxelModelDef = {
  width: 7, depth: 5, headStart: 8,
  slices: [
    [[o,o,o,o,o,o,o],[o,R,R,o,R,R,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[o,o,o,o,o,o,o],[o,S,S,o,S,S,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[o,T,T,T,T,T,o],[o,T,T,T,T,T,o],[o,T,T,T,T,T,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[o,D,D,D,D,D,o],[S,D,W,W,W,D,S],[o,D,D,D,D,D,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[o,T,T,T,T,T,o],[T,T,T,T,T,T,T],[o,T,T,T,T,T,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[o,T,T,T,T,T,o],[T,T,T,T,T,T,T],[o,T,T,T,T,T,o],[o,L,L,L,L,L,o],[o,o,o,o,o,o,o]],
    [[o,T,T,T,T,T,o],[T,T,T,T,T,T,T],[o,T,T,T,T,T,o],[o,L,L,L,L,L,o],[o,o,o,o,o,o,o]],
    [[o,o,o,o,o,o,o],[o,o,o,S,o,o,o],[o,o,o,o,o,o,o],[o,L,L,L,L,L,o],[o,o,o,o,o,o,o]],
    [[L,S,S,S,S,S,L],[o,S,S,S,S,S,o],[o,S,S,S,S,S,o],[o,L,L,L,L,L,o],[o,o,o,o,o,o,o]],
    [[L,S,K,S,K,S,L],[o,S,S,S,S,S,o],[o,S,S,S,S,S,o],[o,L,L,L,L,L,o],[o,o,o,o,o,o,o]],
    [[L,S,S,S,S,S,L],[L,S,S,S,S,S,L],[L,S,S,S,S,S,L],[L,L,L,L,L,L,L],[o,o,o,o,o,o,o]],
    [[L,L,L,L,L,L,L],[L,L,L,L,L,L,L],[L,L,L,L,L,L,L],[L,L,L,L,L,L,L],[o,o,o,o,o,o,o]],
    [[L,L,L,L,L,L,L],[L,L,L,L,L,L,L],[L,L,L,L,L,L,L],[L,L,L,L,L,L,L],[L,o,o,o,o,o,L]],
  ],
};

const ROBOT_MODEL: VoxelModelDef = {
  width: 7, depth: 5, headStart: 8,
  slices: [
    [[o,m,m,o,m,m,o],[o,m,m,o,m,m,o],[o,m,m,o,m,m,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[o,M,M,o,M,M,o],[o,M,M,o,M,M,o],[o,M,M,o,M,M,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[o,M,M,o,M,M,o],[o,M,M,o,M,M,o],[o,M,M,o,M,M,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[o,m,m,m,m,m,o],[o,m,m,m,m,m,o],[o,m,m,m,m,m,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[o,M,M,M,M,M,o],[m,M,T,T,T,M,m],[o,M,M,M,M,M,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[o,M,M,M,M,M,o],[M,M,T,T,T,M,M],[o,M,M,M,M,M,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[M,M,M,M,M,M,M],[M,M,T,T,T,M,M],[M,M,M,M,M,M,M],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[o,o,o,m,o,o,o],[o,o,o,m,o,o,o],[o,o,o,m,o,o,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
    [[o,m,m,m,m,m,o],[o,m,m,m,m,m,o],[o,m,m,m,m,m,o],[o,m,m,m,m,m,o],[o,o,o,o,o,o,o]],
    [[o,M,M,M,M,M,o],[o,M,M,M,M,M,o],[o,M,M,M,M,M,o],[o,M,M,M,M,M,o],[o,o,o,o,o,o,o]],
    [[o,M,V,V,V,M,o],[T,M,M,M,M,M,T],[o,M,M,M,M,M,o],[o,M,M,M,M,M,o],[o,o,o,o,o,o,o]],
    [[o,M,M,M,M,M,o],[o,M,M,M,M,M,o],[o,M,M,M,M,M,o],[o,M,M,M,M,M,o],[o,o,o,o,o,o,o]],
    [[o,o,m,m,m,o,o],[o,o,m,m,m,o,o],[o,o,m,m,m,o,o],[o,o,m,m,m,o,o],[o,o,o,o,o,o,o]],
    [[o,o,o,o,o,o,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o],[o,o,o,o,o,o,o]],
  ],
};

const DOG_MODEL: VoxelModelDef = {
  width: 5, depth: 8, modelScale: 0.52, headStart: 4,
  slices: [
    [[o,o,o,o,o],[o,W,W,W,o],[o,o,o,o,o],[o,o,o,o,o],[o,o,o,o,o],[o,o,o,o,o],[o,W,W,W,o],[o,o,o,o,o]],
    [[o,o,o,o,o],[o,G,G,G,o],[o,G,G,G,o],[o,o,o,o,o],[o,o,o,o,o],[o,o,o,o,o],[o,G,G,G,o],[o,o,o,o,o]],
    [[o,o,o,o,o],[o,o,o,o,o],[o,T,D,T,o],[o,T,D,T,o],[o,T,T,T,o],[o,T,T,T,o],[o,T,T,T,o],[o,o,G,o,o]],
    [[o,o,o,o,o],[o,o,o,o,o],[o,T,D,T,o],[o,T,D,T,o],[o,T,T,T,o],[o,T,T,T,o],[o,T,T,T,o],[o,o,G,o,o]],
    [[o,G,K,G,o],[o,G,K,G,o],[o,W,W,W,o],[o,o,W,o,o],[o,o,o,o,o],[o,o,o,o,o],[o,o,o,o,o],[o,o,o,o,o]],
    [[o,o,o,o,o],[o,G,K,G,o],[G,G,G,G,G],[o,o,G,o,o],[o,o,o,o,o],[o,o,o,o,o],[o,o,o,o,o],[o,o,o,o,o]],
  ],
};

// ── Geometry Builder ──

const TOKEN_HEIGHT = 0.5;

function isSolid(slices: Slice[], w: number, d: number, x: number, y: number, z: number): boolean {
  if (y < 0 || y >= slices.length) return false;
  if (z < 0 || z >= d) return false;
  if (x < 0 || x >= w) return false;
  return slices[y][z][x] !== P._;
}

const FACES: Array<{ dir: [number, number, number]; verts: [number, number, number][] }> = [
  { dir: [0,1,0],  verts: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]] },
  { dir: [0,-1,0], verts: [[0,0,1],[0,0,0],[1,0,0],[1,0,1]] },
  { dir: [1,0,0],  verts: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] },
  { dir: [-1,0,0], verts: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]] },
  { dir: [0,0,1],  verts: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]] },
  { dir: [0,0,-1], verts: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]] },
];

function buildCharacterGeo(model: VoxelModelDef, palette: Record<number, THREE.Color>): THREE.BufferGeometry {
  const { width: w, depth: d, slices, modelScale: ms = 1 } = model;
  const h = slices.length;
  const scale = (TOKEN_HEIGHT / h) * ms;
  const ox = w / 2;
  const oz = d / 2;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];

  for (let y = 0; y < h; y++) {
    for (let z = 0; z < d; z++) {
      for (let x = 0; x < w; x++) {
        const p = slices[y][z][x];
        if (p === P._) continue;
        const color = palette[p];

        for (const face of FACES) {
          const [nx, ny, nz] = face.dir;
          if (isSolid(slices, w, d, x + nx, y + ny, z + nz)) continue;

          const v = face.verts;
          for (const idx of [0, 1, 2, 0, 2, 3]) {
            positions.push((v[idx][0] + x - ox) * scale, (v[idx][1] + y) * scale, (v[idx][2] + z - oz) * scale);
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

// ── Cache & Public API ──

export type CharacterType = 'boy' | 'girl' | 'robot' | 'dog';

export const CHARACTER_TEAM_COLORS: Record<CharacterType, string> = {
  boy: '#e94560',
  girl: '#4a9eff',
  robot: '#44cc66',
  dog: '#ffaa22',
};

export const CHARACTER_NAMES: Record<CharacterType, string> = {
  boy: 'Kai',
  girl: 'Nova',
  robot: 'Unit-7',
  dog: 'Byte',
};

const MODELS: Record<CharacterType, VoxelModelDef> = {
  boy: BOY_MODEL,
  girl: GIRL_MODEL,
  robot: ROBOT_MODEL,
  dog: DOG_MODEL,
};

/** Mesh scale applied in createCharacterMesh */
const CHAR_MESH_SCALE = 1.6;

/** World-space height of each character type (slices × voxelScale × meshScale) */
export const CHARACTER_HEIGHTS: Record<CharacterType, number> = Object.fromEntries(
  (Object.entries(MODELS) as [CharacterType, VoxelModelDef][]).map(([type, model]) => {
    const h = model.slices.length;
    const ms = model.modelScale ?? 1;
    const voxelScale = (TOKEN_HEIGHT / h) * ms;
    return [type, h * voxelScale * CHAR_MESH_SCALE];
  }),
) as Record<CharacterType, number>;

const geoCache = new Map<string, THREE.BufferGeometry>();

export function getCharacterGeometry(type: CharacterType, teamColor: string): THREE.BufferGeometry {
  const key = `${type}-${teamColor}`;
  let geo = geoCache.get(key);
  if (!geo) {
    const palette = buildPalette(teamColor);
    geo = buildCharacterGeo(MODELS[type], palette);
    geoCache.set(key, geo);
  }
  return geo;
}

export function createCharacterMesh(type: CharacterType): THREE.Mesh {
  const teamColor = CHARACTER_TEAM_COLORS[type];
  const geo = getCharacterGeometry(type, teamColor);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Scale character to ~0.8 units tall (fits well in 0.5m grid cells)
  mesh.scale.setScalar(1.6);
  return mesh;
}
