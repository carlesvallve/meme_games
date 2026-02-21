import * as THREE from 'three';
import { Entity, Layer } from './Entity';
import { NavGrid, getBoxHeightAt } from './NavGrid';
import type { SlopeDir } from './NavGrid';
import { generateHeightmap, sampleHeightmap, getHeightmapConfig } from './TerrainNoise';
import type { LadderDef } from './Ladder';
import type { HeightmapStyle } from './TerrainNoise';
export type { HeightmapStyle } from './TerrainNoise';
import { useGameStore } from '../store';

const HALF = 0.5;
function snapHalf(v: number): number { return Math.max(HALF, Math.round(v / HALF) * HALF); }
/** Snap position so that box edges align to HALF boundaries given its half-size */
function snapPos(v: number, halfSize: number): number {
  const edge = Math.round((v - halfSize) / HALF) * HALF;
  return edge + halfSize;
}

interface DebrisBox {
  x: number;
  z: number;
  halfW: number;
  halfD: number;
  height: number;
  slopeDir?: SlopeDir;
}

// ── Terrain presets ─────────────────────────────────────────────────

export type TerrainPreset = 'scattered' | 'terraced' | 'heightmap';

interface TerrainPresetConfig {
  count: number;
  /** Generate width, depth, height for a single box. Receives index and total count. */
  generateBox(i: number, count: number): { w: number; d: number; h: number };
  /** Generate position. Receives box dims and half-ground extent. Return null to skip. */
  generatePos(w: number, d: number, h: number, halfGround: number, i: number, count: number): { x: number; z: number } | null;
  /** Spawn-area clear radius (boxes inside this radius from origin are skipped) */
  spawnClear: number;
}

const PRESET_CONFIGS: Record<TerrainPreset, TerrainPresetConfig> = {
  /** Original scattered debris — mostly low rubble with 20% tall walls */
  scattered: {
    count: 150,
    spawnClear: 3,
    generateBox() {
      const w = snapHalf(0.4 + Math.random() * 1.8);
      const d = snapHalf(0.4 + Math.random() * 1.8);
      const isTall = Math.random() < 0.2;
      const h = snapHalf(isTall ? 2 + Math.random() * 3.5 : 0.3 + Math.random() * 0.8);
      return { w, d, h };
    },
    generatePos(w, _d, _h, halfGround) {
      const x = snapPos((Math.random() - 0.5) * halfGround * 2, w / 2);
      const z = snapPos((Math.random() - 0.5) * halfGround * 2, w / 2);
      return { x, z };
    },
  },

  /** Progressive terraced elevations — deliberate staircase clusters */
  terraced: {
    count: 0,
    spawnClear: 4,
    generateBox() { return { w: 1, d: 1, h: 0.5 }; },
    generatePos() { return null; },
  },

  /** Noise-based heightmap terrain — real mesh via TerrainNoise */
  heightmap: {
    count: 0,
    spawnClear: 4,
    generateBox() { return { w: 1, d: 1, h: 0.5 }; },
    generatePos() { return null; },
  },
};

// ── Terrain class ───────────────────────────────────────────────────

export class Terrain {
  readonly group = new THREE.Group();
  private debris: DebrisBox[] = [];
  private debrisEntities: Entity[] = [];
  private readonly groundSize = 40;
  readonly preset: TerrainPreset;
  private readonly heightmapStyle: HeightmapStyle;

  // Heightmap mesh data (only for 'heightmap' preset)
  private heightmapData: Float32Array | null = null;
  private heightmapRes = 0;
  private heightmapGroundSize = 0;
  private heightmapMesh: THREE.Mesh | null = null;
  private heightmapGrid: THREE.LineSegments | null = null;

  // Ladder data
  private ladderDefs: LadderDef[] = [];
  private ladderMeshes: THREE.Group[] = [];

  // NavGrid reference (set after buildNavGrid, used by getRandomPosition)
  private navGrid: NavGrid | null = null;

  constructor(scene: THREE.Scene, preset: TerrainPreset = 'scattered', heightmapStyle: HeightmapStyle = 'rolling') {
    this.preset = preset;
    this.heightmapStyle = heightmapStyle;
    this.createGround();
    if (preset !== 'heightmap') {
      this.createGridLines();
    }
    this.createDebris();
    scene.add(this.group);
  }

  private createGround(): void {
    const geo = new THREE.PlaneGeometry(this.groundSize, this.groundSize);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a2a1a,
      roughness: 0.95,
      metalness: 0.05,
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  private createGridLines(): void {
    const grid = new THREE.GridHelper(this.groundSize, this.groundSize / HALF, 0x444466, 0x333355);
    grid.position.y = 0.01;
    const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const mat of mats) {
      mat.transparent = true;
      mat.opacity = 0.9;
      mat.depthWrite = false;
    }
    this.group.add(grid);
  }

  /** Create 0.5m grid lines on box faces */
  private createBoxGrid(w: number, h: number, d: number, baseColor: THREE.Color): THREE.LineSegments {
    const points: number[] = [];
    const hw = w / 2, hh = h / 2, hd = d / 2;

    // Horizontal lines on +X and -X faces (YZ plane)
    for (let y = -hh; y <= hh + 0.001; y += HALF) {
      for (const fx of [-hw, hw]) {
        points.push(fx, y, -hd, fx, y, hd);
      }
    }
    for (let z = -hd; z <= hd + 0.001; z += HALF) {
      for (const fx of [-hw, hw]) {
        points.push(fx, -hh, z, fx, hh, z);
      }
    }

    // Horizontal lines on +Z and -Z faces (XY plane)
    for (let y = -hh; y <= hh + 0.001; y += HALF) {
      for (const fz of [-hd, hd]) {
        points.push(-hw, y, fz, hw, y, fz);
      }
    }
    for (let x = -hw; x <= hw + 0.001; x += HALF) {
      for (const fz of [-hd, hd]) {
        points.push(x, -hh, fz, x, hh, fz);
      }
    }

    // Grid on top face (+Y, XZ plane)
    for (let x = -hw; x <= hw + 0.001; x += HALF) {
      points.push(x, hh, -hd, x, hh, hd);
    }
    for (let z = -hd; z <= hd + 0.001; z += HALF) {
      points.push(-hw, hh, z, hw, hh, z);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const mat = new THREE.LineBasicMaterial({
      color: baseColor.clone().multiplyScalar(1.4),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    return new THREE.LineSegments(geo, mat);
  }

  /** Create a wedge (ramp) geometry. slopeDir controls which edge is high. */
  private createWedgeGeometry(w: number, h: number, d: number, slopeDir: SlopeDir): THREE.BufferGeometry {
    const gw = (slopeDir === 1 || slopeDir === 3) ? d : w;
    const gd = (slopeDir === 1 || slopeDir === 3) ? w : d;
    const hw = gw / 2, hd = gd / 2;

    const positions = new Float32Array([
      -hw, 0, -hd,
       hw, 0, -hd,
       hw, 0,  hd,
      -hw, 0,  hd,
      -hw, h,  hd,
       hw, h,  hd,
    ]);

    const indices = [
      0, 2, 1,  0, 3, 2,
      0, 4, 5,  0, 5, 1,
      3, 2, 5,  3, 5, 4,
      0, 3, 4,
      1, 5, 2,
    ];

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);

    if (slopeDir !== 0) {
      const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
      geo.applyMatrix4(new THREE.Matrix4().makeRotationY(angles[slopeDir]));
    }

    geo.computeVertexNormals();
    return geo;
  }

  /** Create grid lines for a slope/ramp surface */
  private createSlopeGrid(w: number, h: number, d: number, slopeDir: SlopeDir, baseColor: THREE.Color): THREE.LineSegments {
    const gw = (slopeDir === 1 || slopeDir === 3) ? d : w;
    const gd = (slopeDir === 1 || slopeDir === 3) ? w : d;
    const hw = gw / 2, hd = gd / 2;
    const points: number[] = [];

    for (let z = -hd; z <= hd + 0.001; z += HALF) {
      const t = (z + hd) / (2 * hd);
      const y = t * h;
      points.push(-hw, y, z, hw, y, z);
    }
    for (let x = -hw; x <= hw + 0.001; x += HALF) {
      points.push(x, 0, -hd, x, h, hd);
    }
    for (let y = 0; y <= h + 0.001; y += HALF) {
      points.push(-hw, y, hd, hw, y, hd);
    }
    for (let x = -hw; x <= hw + 0.001; x += HALF) {
      points.push(x, 0, hd, x, h, hd);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));

    if (slopeDir !== 0) {
      const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
      geo.applyMatrix4(new THREE.Matrix4().makeRotationY(angles[slopeDir]));
    }

    const mat = new THREE.LineBasicMaterial({
      color: baseColor.clone().multiplyScalar(1.4),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    return new THREE.LineSegments(geo, mat);
  }

  private createDebris(): void {
    if (this.preset === 'heightmap') {
      this.createHeightmapMesh();
    } else if (this.preset === 'terraced') {
      this.createTerracedDebris();
    } else {
      this.createScatteredDebris();
    }
  }

  private createScatteredDebris(): void {
    const config = PRESET_CONFIGS[this.preset];
    const { count, spawnClear } = config;
    const halfGround = this.groundSize / 2 - 2;

    for (let i = 0; i < count; i++) {
      const { w, d, h } = config.generateBox(i, count);
      const pos = config.generatePos(w, d, h, halfGround, i, count);
      if (!pos) continue;
      if (Math.abs(pos.x) < spawnClear && Math.abs(pos.z) < spawnClear) continue;
      this.placeBox(pos.x, pos.z, w, d, h);
    }

    this.placeSmartRamps(halfGround, spawnClear);
  }

  /** Generate a real heightmap mesh — single continuous grid with smooth slopes */
  private createHeightmapMesh(): void {
    const config = getHeightmapConfig(this.heightmapStyle);
    const groundSize = this.groundSize - 4; // usable area (2m margin each side)
    const res = config.resolution;
    const verts = res + 1;
    const cellSize = groundSize / res;
    const halfGround = groundSize / 2;

    // Generate vertex-based heightmap
    const result = generateHeightmap(config, groundSize);
    const heights = result.heights;
    this.heightmapData = heights;
    this.ladderDefs = result.ladders;
    console.log(`[Terrain] Heightmap style=${this.heightmapStyle}, ladders=${this.ladderDefs.length}`);
    this.heightmapRes = res;
    this.heightmapGroundSize = groundSize;

    // Debug: render heightmap as grayscale canvas overlay
    this.debugHeightmapCanvas(heights, verts, config.maxHeight);

    // ── Build mesh geometry ──
    const positions = new Float32Array(verts * verts * 3);
    const colors = new Float32Array(verts * verts * 3);
    const indices: number[] = [];

    // Slope-based color palette
    const colorFlat = new THREE.Color(0x2a3a1e);     // dark grass green
    const colorGentleSlope = new THREE.Color(0x3a4a28); // earthy green
    const colorSteepSlope = new THREE.Color(0x7a7580);  // light rocky gray
    const colorCliff = new THREE.Color(0x908a95);       // whitish rock
    const tmpColor = new THREE.Color();

    // Slope threshold matching NavGrid passability exactly.
    // NavGrid: eps = hmCellSize * 0.5, maxSlope = (slopeHeight / navCellSize) * 0.5
    // We use the same eps and sampleHeightmap for identical gradient computation.
    const hmCellSize = groundSize / res;
    const eps = hmCellSize * 0.5;
    const maxPassableSlope = 1.0; // (1.0 / 0.5) * 0.5

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

        if (slopeRatio < 0.7) {
          // Clearly passable — grass
          tmpColor.copy(colorFlat);
        } else if (slopeRatio < 0.95) {
          // Approaching threshold — grass to earthy
          const t = (slopeRatio - 0.7) / 0.25;
          tmpColor.copy(colorFlat).lerp(colorGentleSlope, t);
        } else if (slopeRatio < 1.05) {
          // Threshold crossing — sharp earthy to rock
          const t = (slopeRatio - 0.95) / 0.1;
          tmpColor.copy(colorGentleSlope).lerp(colorSteepSlope, t);
        } else {
          // Unpassable — rock
          const t = Math.min(1, (slopeRatio - 1.05) / 0.5);
          tmpColor.copy(colorSteepSlope).lerp(colorCliff, t);
        }

        // Cliff-base fix: if a neighbor sample is much higher than this vertex,
        // we're at the foot of a cliff — blend back toward ground color to prevent
        // gray rock bleeding onto flat ground cells.
        const maxNeighborH = Math.max(hL, hR, hU, hD);
        const cliffAbove = maxNeighborH - hC;
        if (cliffAbove > 0.3) {
          const baseBlend = Math.min(1, (cliffAbove - 0.3) / 0.5);
          tmpColor.lerp(colorFlat, baseBlend * 0.85);
        }

        // Subtle height variation to avoid flat-looking large terraces
        const heightVar = 0.92 + 0.16 * (hC / Math.max(config.maxHeight, 1));
        tmpColor.multiplyScalar(heightVar);

        colors[idx * 3] = tmpColor.r;
        colors[idx * 3 + 1] = tmpColor.g;
        colors[idx * 3 + 2] = tmpColor.b;
      }
    }

    // Indices: 2 triangles per cell
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
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.heightmapMesh = mesh;

    // ── Build grid line overlay ──
    // 1. Wireframe edges connecting adjacent vertices on the surface
    // 2. Horizontal "rungs" at HALF intervals on steep cell faces (contour lines on walls)
    // Lines use per-vertex colors: black on bright terrain, white on dark terrain.
    const linePoints: number[] = [];
    const lineColors: number[] = [];
    const bias = 0.02; // slight offset to prevent z-fighting
    const normals = geo.getAttribute('normal') as THREE.BufferAttribute;

    /** Get biased position for vertex index (offset along normal) */
    const bx = (i: number) => positions[i * 3] + normals.getX(i) * bias;
    const by = (i: number) => positions[i * 3 + 1] + normals.getY(i) * bias;
    const bz = (i: number) => positions[i * 3 + 2] + normals.getZ(i) * bias;

    /** Compute luminance of terrain vertex color and return contrasting line color (0=black, 1=white) */
    const contrastForVertex = (vi: number): number => {
      const r = colors[vi * 3], g = colors[vi * 3 + 1], b = colors[vi * 3 + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      return lum > 0.18 ? 0 : 0.3; // black on bright, white 30% on dark
    };

    /** Push a line segment with per-vertex contrast colors based on terrain brightness */
    const pushLine = (x1: number, y1: number, z1: number, vi1: number,
                      x2: number, y2: number, z2: number, vi2: number) => {
      linePoints.push(x1, y1, z1, x2, y2, z2);
      const c1 = contrastForVertex(vi1);
      const c2 = contrastForVertex(vi2);
      lineColors.push(c1, c1, c1, c2, c2, c2);
    };

    /** Push a line segment at arbitrary world positions (for contour rungs).
     *  Finds the nearest vertex index for color lookup. */
    const pushLineWorld = (x1: number, y1: number, z1: number,
                           x2: number, y2: number, z2: number,
                           nearestVi: number) => {
      linePoints.push(x1, y1, z1, x2, y2, z2);
      const c = contrastForVertex(nearestVi);
      lineColors.push(c, c, c, c, c, c);
    };

    // Draw all wireframe edges
    for (let z = 0; z < verts; z++) {
      for (let x = 0; x < verts; x++) {
        const idx = z * verts + x;
        if (x < res) {
          const n = idx + 1;
          pushLine(bx(idx), by(idx), bz(idx), idx, bx(n), by(n), bz(n), n);
        }
        if (z < res) {
          const n = idx + verts;
          pushLine(bx(idx), by(idx), bz(idx), idx, bx(n), by(n), bz(n), n);
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

        const tlx = bx(iTL), tly = by(iTL), tlz = bz(iTL);
        const trx = bx(iTR), try_ = by(iTR), trz = bz(iTR);
        const blx = bx(iBL), bly = by(iBL), blz = bz(iBL);
        const brx = bx(iBR), bry = by(iBR), brz = bz(iBR);

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
    this.group.add(gridLines);
    this.heightmapGrid = gridLines;

    // Create ladder meshes at detected cliff edges
    this.createLadderMeshes();
  }

  /** Create procedural ladder meshes at each detected ladder site. */
  private createLadderMeshes(): void {
    console.log(`[Terrain] Creating ${this.ladderDefs.length} ladder meshes`);
    for (let li = 0; li < this.ladderDefs.length; li++) {
      this.createSingleLadderMesh(li);
    }
  }

  /** Create a single ladder mesh at the given index in ladderDefs.
   *  Samples the actual terrain surface to find the cliff face geometry
   *  so the ladder lean angle matches the real wall slope. */
  private createSingleLadderMesh(li: number): void {
    const ladder = this.ladderDefs[li];
    const ladderGroup = new THREE.Group();
    const dy = ladder.topY - ladder.bottomY;
    if (dy <= 0) return;

    // ── Find actual cliff face geometry by sampling terrain ──
    // Walk along the facing direction (from high side toward low side) to find
    // where terrain transitions from topY to bottomY. This gives us the real
    // cliff width, not the cell-to-cell distance which over-estimates it.
    const cliffMidX = (ladder.lowWorldX + ladder.highWorldX) / 2;
    const cliffMidZ = (ladder.lowWorldZ + ladder.highWorldZ) / 2;
    const sampleStep = 0.15;
    const lowThresh = ladder.bottomY + (dy * 0.15);
    const highThresh = ladder.topY - (dy * 0.15);

    // Find where cliff starts (low side) and ends (high side)
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

    // Compute lean from ACTUAL cliff geometry (not cell positions)
    const cliffDX = cliffHighX - cliffLowX;
    const cliffDZ = cliffHighZ - cliffLowZ;
    const actualHorizDist = Math.sqrt(cliffDX * cliffDX + cliffDZ * cliffDZ);
    const actualDY = cliffHighY - cliffLowY;
    const ladderLength = Math.sqrt(actualHorizDist * actualHorizDist + actualDY * actualDY);

    const rungSpacing = 0.4;
    const rungCount = Math.max(1, Math.floor(ladderLength / rungSpacing));
    const railWidth = 0.5;
    const railThickness = 0.08;
    const rungThickness = 0.06;

    const mat = new THREE.MeshStandardMaterial({
      color: 0x8B6914,
      roughness: 0.8,
      metalness: 0.1,
      emissive: 0x332200,
      emissiveIntensity: 0.3,
    });

    const railGeo = new THREE.BoxGeometry(railThickness, ladderLength + 0.3, railThickness);
    const rungGeo = new THREE.BoxGeometry(railWidth, rungThickness, rungThickness);

    // Place ladder at the cliff face (offset slightly outward)
    const offsetFromWall = 0.12;
    const midX = (cliffLowX + cliffHighX) / 2 + ladder.facingDX * offsetFromWall;
    const midZ = (cliffLowZ + cliffHighZ) / 2 + ladder.facingDZ * offsetFromWall;
    const midY = (cliffLowY + cliffHighY) / 2;

    const leanAngle = Math.atan2(actualHorizDist, actualDY);
    // Store on the LadderDef so Character.ts uses the same angle
    ladder.leanAngle = leanAngle;
    // Store actual cliff geometry positions for accurate climb path
    ladder.cliffLowX = cliffLowX; ladder.cliffLowZ = cliffLowZ; ladder.cliffLowY = cliffLowY;
    ladder.cliffHighX = cliffHighX; ladder.cliffHighZ = cliffHighZ; ladder.cliffHighY = cliffHighY;
    const yaw = Math.atan2(-ladder.facingDX, -ladder.facingDZ);

    const perpDX = -ladder.facingDZ;
    const perpDZ = ladder.facingDX;

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

    this.group.add(ladderGroup);
    this.ladderMeshes.push(ladderGroup);
  }

  /** Generate deliberate staircase clusters + scattered filler */
  private createTerracedDebris(): void {
    const halfGround = this.groundSize / 2 - 2;
    const spawnClear = 4;

    const clusterCount = 5 + Math.floor(Math.random() * 4);
    const anchors: { x: number; z: number }[] = [];

    for (let c = 0; c < clusterCount; c++) {
      let ax = 0, az = 0;
      for (let attempt = 0; attempt < 20; attempt++) {
        ax = (Math.random() - 0.5) * halfGround * 1.6;
        az = (Math.random() - 0.5) * halfGround * 1.6;
        if (Math.abs(ax) < spawnClear + 2 && Math.abs(az) < spawnClear + 2) continue;
        const tooClose = anchors.some(a =>
          Math.abs(ax - a.x) < 6 && Math.abs(az - a.z) < 6
        );
        if (!tooClose) break;
      }
      anchors.push({ x: ax, z: az });

      const maxSteps = 3 + Math.floor(Math.random() * 4);
      const baseAngle = Math.random() * Math.PI * 2;
      const spread = 0.4 + Math.random() * 0.6;

      for (let step = 0; step < maxSteps; step++) {
        const h = snapHalf((step + 1) * 0.5);
        const ringBoxes = Math.max(1, Math.floor((maxSteps - step) * (2 + Math.random())));

        for (let b = 0; b < ringBoxes; b++) {
          const w = snapHalf(1 + Math.random() * 2);
          const d = snapHalf(1 + Math.random() * 2);

          const ringRadius = (maxSteps - step) * 1.2 + Math.random() * 1.5;
          const angle = baseAngle + (b / ringBoxes) * Math.PI * 2 * spread +
            (Math.random() - 0.5) * 0.5;
          const bx = snapPos(ax + Math.cos(angle) * ringRadius, w / 2);
          const bz = snapPos(az + Math.sin(angle) * ringRadius, d / 2);

          if (Math.abs(bx) > halfGround || Math.abs(bz) > halfGround) continue;
          if (Math.abs(bx) < spawnClear && Math.abs(bz) < spawnClear) continue;

          this.placeBox(bx, bz, w, d, h);
        }
      }

      const peakW = snapHalf(1 + Math.random() * 1.5);
      const peakD = snapHalf(1 + Math.random() * 1.5);
      const peakH = snapHalf((maxSteps + 1) * 0.5);
      const px = snapPos(ax, peakW / 2);
      const pz = snapPos(az, peakD / 2);
      if (Math.abs(px) < halfGround && Math.abs(pz) < halfGround) {
        this.placeBox(px, pz, peakW, peakD, peakH);
      }
    }

    const fillerCount = 60;
    for (let i = 0; i < fillerCount; i++) {
      const w = snapHalf(0.5 + Math.random() * 1.5);
      const d = snapHalf(0.5 + Math.random() * 1.5);
      const isTall = Math.random() < 0.15;
      const h = snapHalf(isTall ? 2 + Math.random() * 2.5 : 0.3 + Math.random() * 0.5);
      const x = snapPos((Math.random() - 0.5) * halfGround * 2, w / 2);
      const z = snapPos((Math.random() - 0.5) * halfGround * 2, d / 2);
      if (Math.abs(x) < spawnClear && Math.abs(z) < spawnClear) continue;
      this.placeBox(x, z, w, d, h);
    }

    this.placeSmartRamps(halfGround, spawnClear);
  }

  /** Scan all boxes for edges with elevation drops and place ramps to bridge them. */
  private placeSmartRamps(halfGround: number, spawnClear: number): void {
    const probes: { dx: number; dz: number; slopeDir: SlopeDir }[] = [
      { dx:  1, dz:  0, slopeDir: 3 },
      { dx: -1, dz:  0, slopeDir: 1 },
      { dx:  0, dz:  1, slopeDir: 2 },
      { dx:  0, dz: -1, slopeDir: 0 },
    ];

    const boxes = [...this.debris];
    let rampsPlaced = 0;
    const MAX_RAMPS = 30;

    for (const box of boxes) {
      if (rampsPlaced >= MAX_RAMPS) break;
      if (box.height < 0.5 || box.height > 2.0) continue;
      if (box.slopeDir !== undefined) continue;

      for (const probe of probes) {
        if (rampsPlaced >= MAX_RAMPS) break;
        if (Math.random() > 0.4) continue;

        const rampLen = snapHalf(1.5 + Math.random() * 1.5);
        const rampW = snapHalf(Math.min(
          probe.dx !== 0 ? box.halfD * 2 : box.halfW * 2,
          1 + Math.random() * 1.5,
        ));

        let rx: number, rz: number;
        let sizeAlongProbe: number, sizePerpProbe: number;
        if (probe.dx !== 0) {
          rx = box.x + probe.dx * (box.halfW + rampLen / 2);
          rz = box.z;
          sizeAlongProbe = rampLen;
          sizePerpProbe = rampW;
        } else {
          rx = box.x;
          rz = box.z + probe.dz * (box.halfD + rampLen / 2);
          sizeAlongProbe = rampLen;
          sizePerpProbe = rampW;
        }

        rx = snapPos(rx, (probe.dx !== 0 ? sizeAlongProbe : sizePerpProbe) / 2);
        rz = snapPos(rz, (probe.dz !== 0 ? sizeAlongProbe : sizePerpProbe) / 2);

        if (Math.abs(rx) > halfGround || Math.abs(rz) > halfGround) continue;
        if (Math.abs(rx) < spawnClear && Math.abs(rz) < spawnClear) continue;

        const lowEndX = rx + probe.dx * (probe.dx !== 0 ? sizeAlongProbe / 2 : 0);
        const lowEndZ = rz + probe.dz * (probe.dz !== 0 ? sizeAlongProbe / 2 : 0);
        const lowTerrainY = this.getTerrainY(lowEndX, lowEndZ, 0.1);

        const drop = box.height - lowTerrainY;
        if (drop < 0.3 || drop > 2.5) continue;

        const rampHalfW = (probe.dx !== 0 ? sizeAlongProbe : sizePerpProbe) / 2;
        const rampHalfD = (probe.dz !== 0 ? sizeAlongProbe : sizePerpProbe) / 2;
        let obstructed = false;
        for (const other of boxes) {
          if (other === box) continue;
          if (other.height <= lowTerrainY + 0.1) continue;
          if (
            Math.abs(rx - other.x) < rampHalfW + other.halfW + 0.1 &&
            Math.abs(rz - other.z) < rampHalfD + other.halfD + 0.1
          ) {
            obstructed = true;
            break;
          }
        }
        if (obstructed) continue;

        const w = probe.dx !== 0 ? sizeAlongProbe : sizePerpProbe;
        const d = probe.dz !== 0 ? sizeAlongProbe : sizePerpProbe;
        const rh = snapHalf(drop);
        if (rh < 0.5) continue;

        if (this.placeSlopeBox(rx, rz, w, d, rh, probe.slopeDir)) {
          rampsPlaced++;
        }
      }
    }
  }

  /** Place a single box into the world. Skips z-fighting overlaps. */
  private placeBox(x: number, z: number, w: number, d: number, h: number): boolean {
    const colors = [0x2a2a3e, 0x33334a, 0x252538, 0x1e1e30, 0x3a3a50];
    const hw = w / 2, hd = d / 2;

    const zFight = this.debris.some(b =>
      Math.abs(h - b.height) < 0.01 &&
      Math.abs(x - b.x) < hw + b.halfW &&
      Math.abs(z - b.z) < hd + b.halfD
    );
    if (zFight) return false;

    const geo = new THREE.BoxGeometry(w, h, d);
    const color = colors[Math.floor(Math.random() * colors.length)];
    const variation = 0.85 + Math.random() * 0.3;
    const baseColor = new THREE.Color(color).multiplyScalar(variation);
    const mat = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.85,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    const entity = new Entity(mesh, {
      layer: Layer.Architecture,
      radius: Math.max(hw, hd),
      weight: Infinity,
    });
    this.debrisEntities.push(entity);

    const gridLines = this.createBoxGrid(w, h, d, baseColor);
    gridLines.position.copy(mesh.position);
    this.group.add(gridLines);

    this.debris.push({ x, z, halfW: hw, halfD: hd, height: h });
    return true;
  }

  /** Place a slope/ramp into the world. slopeDir: which edge is the HIGH side. */
  private placeSlopeBox(x: number, z: number, w: number, d: number, h: number, slopeDir: SlopeDir): boolean {
    const colors = [0x2a2a3e, 0x33334a, 0x252538, 0x1e1e30, 0x3a3a50];
    const hw = w / 2, hd = d / 2;

    const zFight = this.debris.some(b =>
      Math.abs(h - b.height) < 0.01 &&
      Math.abs(x - b.x) < hw + b.halfW &&
      Math.abs(z - b.z) < hd + b.halfD
    );
    if (zFight) return false;

    const geo = this.createWedgeGeometry(w, h, d, slopeDir);
    const color = colors[Math.floor(Math.random() * colors.length)];
    const variation = 0.85 + Math.random() * 0.3;
    const baseColor = new THREE.Color(color).multiplyScalar(variation);
    const mat = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.85,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    const entity = new Entity(mesh, {
      layer: Layer.Architecture,
      radius: Math.max(hw, hd),
      weight: Infinity,
    });
    this.debrisEntities.push(entity);

    const gridLines = this.createSlopeGrid(w, h, d, slopeDir, baseColor);
    gridLines.position.copy(mesh.position);
    this.group.add(gridLines);

    this.debris.push({ x, z, halfW: hw, halfD: hd, height: h, slopeDir });
    return true;
  }

  /** Build a NavGrid from current terrain for A* pathfinding */
  buildNavGrid(stepHeight: number, capsuleRadius: number, cellSize = 0.5, slopeHeight?: number): NavGrid {
    const grid = new NavGrid(this.groundSize, this.groundSize, cellSize);
    if (this.heightmapData) {
      grid.buildFromHeightmap(this.heightmapData, this.heightmapRes, this.heightmapGroundSize, stepHeight, slopeHeight);
    } else {
      grid.build(this.debris, stepHeight, capsuleRadius);
    }

    // Register ladder nav-links.
    // Offset nav-link cells ~1m INTO their respective terraces (away from cliff edge)
    // because cliff-edge cells have steep gradients → passable=0, so A* can't reach them.
    const LADDER_COST = 8;
    const NAV_LINK_OFFSET = 0.25; // meters into the terrace
    for (let i = 0; i < this.ladderDefs.length; i++) {
      const ladder = this.ladderDefs[i];

      // facingDX/DZ points from high side toward low side
      // Bottom (low side): offset further into low terrace (+facing direction)
      // Top (high side): offset further into high terrace (-facing direction)
      const bottomWorldX = ladder.lowWorldX + ladder.facingDX * NAV_LINK_OFFSET;
      const bottomWorldZ = ladder.lowWorldZ + ladder.facingDZ * NAV_LINK_OFFSET;
      const topWorldX = ladder.highWorldX - ladder.facingDX * NAV_LINK_OFFSET;
      const topWorldZ = ladder.highWorldZ - ladder.facingDZ * NAV_LINK_OFFSET;

      const bottom = grid.worldToGrid(bottomWorldX, bottomWorldZ);
      const top = grid.worldToGrid(topWorldX, topWorldZ);

      // Verify cells are walkable; if not, try the exact position as fallback
      let bottomCell = grid.getCell(bottom.gx, bottom.gz);
      if (!bottomCell || bottomCell.passable === 0) {
        const exact = grid.worldToGrid(ladder.lowWorldX, ladder.lowWorldZ);
        const exactCell = grid.getCell(exact.gx, exact.gz);
        if (exactCell && exactCell.passable > 0) {
          bottom.gx = exact.gx;
          bottom.gz = exact.gz;
          bottomCell = exactCell;
        }
      }

      let topCell = grid.getCell(top.gx, top.gz);
      if (!topCell || topCell.passable === 0) {
        const exact = grid.worldToGrid(ladder.highWorldX, ladder.highWorldZ);
        const exactCell = grid.getCell(exact.gx, exact.gz);
        if (exactCell && exactCell.passable > 0) {
          top.gx = exact.gx;
          top.gz = exact.gz;
          topCell = exactCell;
        }
      }

      // Store computed cell coordinates back into the LadderDef
      ladder.bottomCellGX = bottom.gx;
      ladder.bottomCellGZ = bottom.gz;
      ladder.topCellGX = top.gx;
      ladder.topCellGZ = top.gz;

      grid.addNavLink(bottom.gx, bottom.gz, top.gx, top.gz, LADDER_COST, i);
    }

    // ── NavGrid-level connectivity check ──
    // The vertex-level analysis may miss disconnections because the NavGrid's
    // gradient checks are stricter than vertex-level height diffs.
    // BFS the actual NavGrid and add ladders for any remaining disconnected regions.
    if (this.heightmapData) {
      this.ensureNavGridConnectivity(grid, LADDER_COST, NAV_LINK_OFFSET);
    }

    // Bake spawn region labels so getRandomPosition can filter out unreachable areas
    grid.bakeSpawnRegion();
    this.navGrid = grid;

    return grid;
  }

  /** Score how flat a cliff face is at a candidate ladder pair.
   *  Lower = flatter = better placement. Checks cells perpendicular to the cliff normal. */
  private scoreCliffFlatness(grid: NavGrid, gx1: number, gz1: number, gx2: number, gz2: number): number {
    const dx = gx2 - gx1;
    const dz = gz2 - gz1;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.001) return 100;

    // Perpendicular direction (rotated 90°)
    const px = Math.round(-dz / len);
    const pz = Math.round(dx / len);
    if (px === 0 && pz === 0) return 100;

    const cell1 = grid.getCell(gx1, gz1);
    const cell2 = grid.getCell(gx2, gz2);
    if (!cell1 || !cell2) return 100;

    let penalty = 0;
    // Check 2 cells in each perpendicular direction on both sides of the cliff
    for (const offset of [-2, -1, 1, 2]) {
      const weight = Math.abs(offset) === 1 ? 2 : 1; // closer cells matter more
      const n1 = grid.getCell(gx1 + px * offset, gz1 + pz * offset);
      if (n1) {
        penalty += Math.abs(n1.surfaceHeight - cell1.surfaceHeight) * weight;
      } else {
        penalty += 3 * weight; // edge of map
      }
      const n2 = grid.getCell(gx2 + px * offset, gz2 + pz * offset);
      if (n2) {
        penalty += Math.abs(n2.surfaceHeight - cell2.surfaceHeight) * weight;
      } else {
        penalty += 3 * weight;
      }
    }

    return penalty;
  }

  /** BFS the NavGrid to find disconnected walkable regions and bridge them with ladders. */
  /** Place a single ladder between two grid cells and register the nav-link. */
  private placeLadder(
    grid: NavGrid, ladderCost: number, navLinkOffset: number,
    agx: number, agz: number, bgx: number, bgz: number,
  ): boolean {
    const cellA = grid.getCell(agx, agz)!;
    const cellB = grid.getCell(bgx, bgz)!;
    const aWorld = grid.gridToWorld(agx, agz);
    const bWorld = grid.gridToWorld(bgx, bgz);

    const aIsLow = cellA.surfaceHeight <= cellB.surfaceHeight;
    const lowCell = aIsLow ? cellA : cellB;
    const highCell = aIsLow ? cellB : cellA;
    const lowWorld = aIsLow ? aWorld : bWorld;
    const highWorld = aIsLow ? bWorld : aWorld;
    const lowGX = aIsLow ? agx : bgx;
    const lowGZ = aIsLow ? agz : bgz;
    const highGX = aIsLow ? bgx : agx;
    const highGZ = aIsLow ? bgz : agz;

    const heightDiff = highCell.surfaceHeight - lowCell.surfaceHeight;
    if (heightDiff < 0.3) return false;

    let fdx = lowWorld.x - highWorld.x;
    let fdz = lowWorld.z - highWorld.z;
    const fLen = Math.sqrt(fdx * fdx + fdz * fdz);
    if (fLen > 0) { fdx /= fLen; fdz /= fLen; }

    const ladderDef: LadderDef = {
      bottomX: (lowWorld.x + highWorld.x) / 2,
      bottomZ: (lowWorld.z + highWorld.z) / 2,
      bottomY: lowCell.surfaceHeight,
      topY: highCell.surfaceHeight,
      facingDX: fdx,
      facingDZ: fdz,
      lowWorldX: lowWorld.x,
      lowWorldZ: lowWorld.z,
      highWorldX: highWorld.x,
      highWorldZ: highWorld.z,
      bottomCellGX: lowGX,
      bottomCellGZ: lowGZ,
      topCellGX: highGX,
      topCellGZ: highGZ,
    };

    const ladderIndex = this.ladderDefs.length;
    this.ladderDefs.push(ladderDef);

    const bottomNavX = lowWorld.x + fdx * navLinkOffset;
    const bottomNavZ = lowWorld.z + fdz * navLinkOffset;
    const topNavX = highWorld.x - fdx * navLinkOffset;
    const topNavZ = highWorld.z - fdz * navLinkOffset;

    let bottom = grid.worldToGrid(bottomNavX, bottomNavZ);
    let top = grid.worldToGrid(topNavX, topNavZ);

    const bottomCellNav = grid.getCell(bottom.gx, bottom.gz);
    if (!bottomCellNav || bottomCellNav.passable === 0) {
      bottom = { gx: lowGX, gz: lowGZ };
    }
    const topCellNav = grid.getCell(top.gx, top.gz);
    if (!topCellNav || topCellNav.passable === 0) {
      top = { gx: highGX, gz: highGZ };
    }

    ladderDef.bottomCellGX = bottom.gx;
    ladderDef.bottomCellGZ = bottom.gz;
    ladderDef.topCellGX = top.gx;
    ladderDef.topCellGZ = top.gz;

    grid.addNavLink(bottom.gx, bottom.gz, top.gx, top.gz, ladderCost, ladderIndex);
    this.createSingleLadderMesh(ladderIndex);

    return true;
  }

  private ensureNavGridConnectivity(grid: NavGrid, ladderCost: number, navLinkOffset: number): void {
    const MAX_ITER = 60;
    const EDGE_MARGIN = 3;
    const MAX_WALK = 20;  // max cells to walk through a cliff in one direction
    const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // cardinals only → clean ladder angles

    for (let iter = 0; iter < MAX_ITER; iter++) {
      const { labels, regionCount } = grid.labelConnectedRegions();
      if (regionCount <= 1) break;

      // Always use largest region as connected seed
      const regionSizes = new Map<number, number>();
      for (let i = 0; i < labels.length; i++) {
        if (labels[i] < 0) continue;
        regionSizes.set(labels[i], (regionSizes.get(labels[i]) ?? 0) + 1);
      }
      let spawnLabel = -1;
      let spawnSize = 0;
      for (const [r, size] of regionSizes) {
        if (size > spawnSize) { spawnLabel = r; spawnSize = size; }
      }
      if (spawnLabel < 0) break;

      const connectedSet = new Set<number>();
      connectedSet.add(spawnLabel);

      if (iter === 0) {
        const disconnected = [...regionSizes.entries()].filter(([r, s]) => r !== spawnLabel && s >= 2);
        console.log(`[NavGrid] ${regionCount} regions, spawn=${spawnLabel} (${spawnSize} cells), ${disconnected.length} disconnected`);
      }

      // Try ALL disconnected regions — find globally best candidate via cliff-walk
      type Candidate = { agx: number; agz: number; bgx: number; bgz: number; score: number };
      let bestCandidate: Candidate | null = null;
      let bestScore = Infinity;
      let failedRegions = 0;

      for (const [region, size] of regionSizes) {
        if (connectedSet.has(region)) continue;
        if (size < 2) continue;

        let regionHasCandidate = false;

        // Scan border cells of this region
        for (let gz = EDGE_MARGIN; gz < grid.height - EDGE_MARGIN; gz++) {
          for (let gx = EDGE_MARGIN; gx < grid.width - EDGE_MARGIN; gx++) {
            const idx = gz * grid.width + gx;
            if (labels[idx] !== region) continue;
            const cell = grid.getCell(gx, gz);
            if (!cell || cell.passable === 0) continue;

            // Quick border check — only process cells on region edge
            let isBorder = cell.passable !== 0xFF;
            if (!isBorder) {
              for (const [ddx, ddz] of DIRS) {
                const nIdx = (gz + ddz) * grid.width + (gx + ddx);
                if (nIdx >= 0 && nIdx < labels.length && labels[nIdx] !== region) { isBorder = true; break; }
              }
            }
            if (!isBorder) continue;

            // Walk each cardinal direction through cliff to find connected-set cell
            for (const [ddx, ddz] of DIRS) {
              // First step must leave the region (walk outward, not inward)
              const firstGX = gx + ddx;
              const firstGZ = gz + ddz;
              if (firstGX < EDGE_MARGIN || firstGX >= grid.width - EDGE_MARGIN) continue;
              if (firstGZ < EDGE_MARGIN || firstGZ >= grid.height - EDGE_MARGIN) continue;
              const firstIdx = firstGZ * grid.width + firstGX;
              if (labels[firstIdx] === region) continue; // walking inward — skip

              let cx = firstGX;
              let cz = firstGZ;
              for (let step = 0; step < MAX_WALK; step++) {
                if (cx < EDGE_MARGIN || cx >= grid.width - EDGE_MARGIN) break;
                if (cz < EDGE_MARGIN || cz >= grid.height - EDGE_MARGIN) break;

                const nIdx = cz * grid.width + cx;
                const nLab = labels[nIdx];

                if (nLab >= 0 && connectedSet.has(nLab)) {
                  // Found a connected-set cell on the other side of the cliff
                  const nCell = grid.getCell(cx, cz);
                  if (nCell && nCell.passable !== 0) {
                    const heightDiff = Math.abs(cell.surfaceHeight - nCell.surfaceHeight);
                    if (heightDiff >= 0.3) {
                      const dist = step + 1;
                      const flatness = this.scoreCliffFlatness(grid, gx, gz, cx, cz);
                      const score = heightDiff * 2 + flatness * 2 + dist * 0.3;
                      if (score < bestScore) {
                        bestScore = score;
                        bestCandidate = { agx: gx, agz: gz, bgx: cx, bgz: cz, score };
                      }
                      regionHasCandidate = true;
                    }
                  }
                  break; // stop walking this direction
                }

                // Skip over walkable cells of other disconnected regions (slope ledges).
                // Don't stop — the connected set may be on the far side.

                // Otherwise it's blocked (nLab === -1) — continue through cliff
                cx += ddx;
                cz += ddz;
              }
            }
          }
        }

        if (!regionHasCandidate) failedRegions++;
      }

      if (!bestCandidate) {
        if (failedRegions > 0) {
          console.warn(`[NavGrid] ${failedRegions} regions unreachable via cliff-walk`);
        }
        break;
      }

      if (!this.placeLadder(grid, ladderCost, navLinkOffset, bestCandidate.agx, bestCandidate.agz, bestCandidate.bgx, bestCandidate.bgz)) {
        // placeLadder can fail if height diff too small after grid-to-world rounding
        // Skip this pair by poisoning the cell — mark as visited. Re-label next iter.
        break;
      }
    }

    console.log(`[Terrain] NavGrid connectivity: ${this.ladderDefs.length} total ladders`);
  }

  /** Get the ladder definitions for this terrain */
  getLadderDefs(): ReadonlyArray<LadderDef> {
    return this.ladderDefs;
  }

  /** Expose debris AABBs for camera collision */
  getDebris(): ReadonlyArray<Readonly<DebrisBox>> {
    return this.debris;
  }

  /** The raycastable terrain surface mesh (heightmap or ground plane). */
  getTerrainMesh(): THREE.Mesh | null {
    return this.heightmapMesh;
  }

  /** Get the ground/debris height at a point, optionally expanded by a radius */
  getTerrainY(x: number, z: number, radius = 0): number {
    // Heightmap: O(1) bilinear interpolation
    if (this.heightmapData) {
      if (radius <= 0) {
        return sampleHeightmap(this.heightmapData, this.heightmapRes, this.heightmapGroundSize, x, z);
      }
      // With radius: sample center + 4 offsets and take max
      let maxY = sampleHeightmap(this.heightmapData, this.heightmapRes, this.heightmapGroundSize, x, z);
      const r = radius * 0.7;
      maxY = Math.max(maxY, sampleHeightmap(this.heightmapData, this.heightmapRes, this.heightmapGroundSize, x + r, z));
      maxY = Math.max(maxY, sampleHeightmap(this.heightmapData, this.heightmapRes, this.heightmapGroundSize, x - r, z));
      maxY = Math.max(maxY, sampleHeightmap(this.heightmapData, this.heightmapRes, this.heightmapGroundSize, x, z + r));
      maxY = Math.max(maxY, sampleHeightmap(this.heightmapData, this.heightmapRes, this.heightmapGroundSize, x, z - r));
      return maxY;
    }

    // Box-based: O(n) iteration
    let maxY = 0;
    for (const box of this.debris) {
      if (
        Math.abs(x - box.x) < box.halfW + radius &&
        Math.abs(z - box.z) < box.halfD + radius
      ) {
        const h = getBoxHeightAt(box, x, z);
        maxY = Math.max(maxY, h);
      }
    }
    return maxY;
  }

  /**
   * Circle-vs-AABB collision resolve (capsule collider projected to XZ).
   * For heightmap terrain: just clamp to bounds and sample height (no walls).
   * For box terrain: pushes player out of blocking obstacles.
   */
  resolveMovement(
    newX: number,
    newZ: number,
    currentY: number,
    stepHeight: number,
    radius: number,
    oldX?: number,
    oldZ?: number,
    slopeHeight?: number,
  ): { x: number; z: number; y: number } {
    let rx = newX;
    let rz = newZ;

    // Clamp to world bounds
    const halfBound = this.groundSize / 2 - radius;
    rx = Math.max(-halfBound, Math.min(halfBound, rx));
    rz = Math.max(-halfBound, Math.min(halfBound, rz));

    // Heightmap terrain: steep slopes act as walls.
    // Gradient = wall normal. Movement into steep uphill slopes gets projected
    // along the contour, same as sliding along a vertical wall.
    if (this.heightmapData) {
      const sampleR = radius * 0.5;
      const hmCellSize = this.heightmapGroundSize / this.heightmapRes;
      const effectiveSlopeHeight = slopeHeight ?? stepHeight * 2;
      const maxSlope = (effectiveSlopeHeight / hmCellSize) * 0.5;
      const eps = hmCellSize * 0.5;

      /** Compute gradient at a position */
      const gradientAt = (px: number, pz: number): { gx: number; gz: number; mag: number } => {
        const hL = this.getTerrainY(px - eps, pz, sampleR);
        const hR = this.getTerrainY(px + eps, pz, sampleR);
        const hU = this.getTerrainY(px, pz - eps, sampleR);
        const hD = this.getTerrainY(px, pz + eps, sampleR);
        const gx = (hR - hL) / (2 * eps);
        const gz = (hD - hU) / (2 * eps);
        return { gx, gz, mag: Math.sqrt(gx * gx + gz * gz) };
      };

      const terrainY = this.getTerrainY(rx, rz, sampleR);

      if (oldX !== undefined && oldZ !== undefined) {
        const mx = rx - oldX;
        const mz = rz - oldZ;
        const moveLen = Math.sqrt(mx * mx + mz * mz);

        if (moveLen > 0.0001) {
          // Sample gradient ahead of movement direction (at the "wall face")
          // to detect steep slopes before we step onto them
          const aheadX = rx + (mx / moveLen) * eps;
          const aheadZ = rz + (mz / moveLen) * eps;
          const grad = gradientAt(aheadX, aheadZ);

          // Slope is gentle enough → allow
          if (grad.mag <= maxSlope) {
            return { x: rx, z: rz, y: terrainY };
          }

          // Steep slope: block movement both uphill AND downhill (treat as wall).
          // Only allow movement perpendicular to the gradient (along the contour).
          const nx = grad.gx / grad.mag;
          const nz = grad.gz / grad.mag;
          const dot = (mx / moveLen) * nx + (mz / moveLen) * nz;
          const absDot = Math.abs(dot);

          if (absDot <= 0.05) {
            // Moving purely along the contour → allow
            return { x: rx, z: rz, y: terrainY };
          }

          // Moving into steep slope (up or down) — slide along contour
          const slideX = Math.max(-halfBound, Math.min(halfBound, oldX + mx - dot * moveLen * nx));
          const slideZ = Math.max(-halfBound, Math.min(halfBound, oldZ + mz - dot * moveLen * nz));
          const slideY = this.getTerrainY(slideX, slideZ, sampleR);
          const slideGrad = gradientAt(slideX, slideZ);

          if (slideGrad.mag <= maxSlope) {
            return { x: slideX, z: slideZ, y: slideY };
          }

          // Check if sliding direction also pushes into a slope (up or down)
          const smx = slideX - oldX;
          const smz = slideZ - oldZ;
          const smLen = Math.sqrt(smx * smx + smz * smz);
          if (smLen > 0.0001) {
            const sdot = (smx / smLen) * (slideGrad.gx / slideGrad.mag) +
                         (smz / smLen) * (slideGrad.gz / slideGrad.mag);
            if (Math.abs(sdot) <= 0.05) {
              return { x: slideX, z: slideZ, y: slideY };
            }
          }

          // Fully blocked (e.g. concave corner) — stay put
          return { x: oldX, z: oldZ, y: currentY };
        }
      }

      // No old position or no movement — just allow
      return { x: rx, z: rz, y: terrainY };
    }

    // Box-based: iterative push-out
    for (let pass = 0; pass < 4; pass++) {
      for (const box of this.debris) {
        const effectiveH = getBoxHeightAt(box, rx, rz);
        if (effectiveH - currentY <= stepHeight) continue;

        const expandedHalfW = box.halfW + radius;
        const expandedHalfD = box.halfD + radius;
        const relX = rx - box.x;
        const relZ = rz - box.z;
        if (Math.abs(relX) >= expandedHalfW || Math.abs(relZ) >= expandedHalfD) continue;

        const insideBox =
          Math.abs(relX) < box.halfW &&
          Math.abs(relZ) < box.halfD;

        if (insideBox) {
          const overlapX = box.halfW + radius - Math.abs(relX);
          const overlapZ = box.halfD + radius - Math.abs(relZ);
          if (overlapX < overlapZ) {
            rx += (relX >= 0 ? 1 : -1) * overlapX;
          } else {
            rz += (relZ >= 0 ? 1 : -1) * overlapZ;
          }
          continue;
        }

        const closestX = Math.max(box.x - box.halfW, Math.min(rx, box.x + box.halfW));
        const closestZ = Math.max(box.z - box.halfD, Math.min(rz, box.z + box.halfD));

        const dx = rx - closestX;
        const dz = rz - closestZ;
        const distSq = dx * dx + dz * dz;

        if (distSq < radius * radius) {
          if (distSq > 0.0001) {
            const dist = Math.sqrt(distSq);
            const overlap = radius - dist;
            rx += (dx / dist) * overlap;
            rz += (dz / dist) * overlap;
          } else {
            const awayX = rx - box.x;
            const awayZ = rz - box.z;
            const awayLen = Math.sqrt(awayX * awayX + awayZ * awayZ);
            if (awayLen > 0.0001) {
              rx += (awayX / awayLen) * radius;
              rz += (awayZ / awayLen) * radius;
            } else {
              rx += radius;
            }
          }
        }
      }
    }

    const terrainY = this.getTerrainY(rx, rz, radius * 0.5);
    const y = terrainY - currentY <= stepHeight ? terrainY : currentY;

    return { x: rx, z: rz, y };
  }

  /** Check if point is fully on top of a box surface (not on an edge) */
  private isOnBoxSurface(x: number, z: number): boolean {
    if (this.heightmapData) return true; // entire heightmap is walkable surface
    for (const box of this.debris) {
      if (
        Math.abs(x - box.x) < box.halfW - 0.01 &&
        Math.abs(z - box.z) < box.halfD - 0.01
      ) {
        return true;
      }
    }
    return false;
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

  dispose(): void {
    for (const entity of this.debrisEntities) {
      entity.destroy();
    }
    this.debrisEntities.length = 0;

    // Clear heightmap thumbnail
    useGameStore.getState().setHeightmapThumb(null);

    // Dispose heightmap mesh resources
    if (this.heightmapMesh) {
      this.heightmapMesh.geometry.dispose();
      (this.heightmapMesh.material as THREE.Material).dispose();
      this.heightmapMesh = null;
    }
    if (this.heightmapGrid) {
      this.heightmapGrid.geometry.dispose();
      (this.heightmapGrid.material as THREE.Material).dispose();
      this.heightmapGrid = null;
    }
    this.heightmapData = null;
    this.navGrid = null;

    // Dispose ladder meshes
    for (const ladderGroup of this.ladderMeshes) {
      ladderGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      this.group.remove(ladderGroup);
    }
    this.ladderMeshes = [];
    this.ladderDefs = [];
  }

  /** Check if any taller debris box overlaps within `clearance` of (x, z) at surfaceY */
  private hasClearance(x: number, z: number, surfaceY: number, clearance: number): boolean {
    if (this.heightmapData) return true; // no walls on heightmap terrain
    for (const box of this.debris) {
      if (box.height <= surfaceY + 0.01) continue;
      if (
        Math.abs(x - box.x) < box.halfW + clearance &&
        Math.abs(z - box.z) < box.halfD + clearance
      ) {
        return false;
      }
    }
    return true;
  }

  getRandomPosition(margin = 3, clearance = 0.6): THREE.Vector3 {
    const half = this.groundSize / 2 - margin;

    // Heightmap: sample random point, verify it's in the spawn region
    if (this.heightmapData) {
      for (let attempt = 0; attempt < 50; attempt++) {
        const x = (Math.random() - 0.5) * half * 2;
        const z = (Math.random() - 0.5) * half * 2;
        if (this.navGrid && !this.navGrid.isInSpawnRegion(x, z)) continue;
        const y = this.getTerrainY(x, z);
        return new THREE.Vector3(x, y, z);
      }
      // Fallback: spawn at origin
      return new THREE.Vector3(0, this.getTerrainY(0, 0), 0);
    }

    for (let attempt = 0; attempt < 50; attempt++) {
      const x = snapPos((Math.random() - 0.5) * half * 2, 0);
      const z = snapPos((Math.random() - 0.5) * half * 2, 0);
      const y = this.getTerrainY(x, z);
      if ((y === 0 || this.isOnBoxSurface(x, z)) && this.hasClearance(x, z, y, clearance)) {
        if (this.navGrid && !this.navGrid.isInSpawnRegion(x, z)) continue;
        return new THREE.Vector3(x, y, z);
      }
    }
    return new THREE.Vector3(0, 0, 0);
  }
}
