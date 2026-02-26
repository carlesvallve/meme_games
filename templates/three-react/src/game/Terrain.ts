import * as THREE from 'three';
import { Entity, Layer, entityRegistry } from './Entity';
import { NavGrid, getBoxHeightAt } from './NavGrid';
import type { SlopeDir } from './NavGrid';
import { generateHeightmap, sampleHeightmap, getHeightmapConfig } from './TerrainNoise';
import type { LadderDef } from './Ladder';
import type { HeightmapStyle } from './TerrainNoise';
export type { HeightmapStyle } from './TerrainNoise';
import { generateDungeon } from './DungeonGenerator';
import type { WalkMask } from './DungeonGenerator';
import { DoorSystem } from './Door';
import { generateNature, type NatureGeneratorResult } from './NatureGenerator';
import { paletteBiome } from './ColorPalettes';
import { buildVoxelDungeonCollision, loadVoxelDungeonVisuals } from './VoxelDungeon';
import { DUNGEON_VARIANTS } from './VoxDungeonDB';
import { DungeonPropSystem, clearPropCache } from './DungeonProps';
import { useGameStore } from '../store';
import { randomPalette, palettes } from './ColorPalettes';
import type { TerrainPalette } from './ColorPalettes';

const HALF = 0.25;
function snapHalf(v: number): number { return Math.max(HALF, Math.round(v / HALF) * HALF); }
/** Snap position so that box edges align to HALF boundaries given its half-size */
function snapPos(v: number, halfSize: number): number {
  const edge = Math.round((v - halfSize) / HALF) * HALF;
  return edge + halfSize;
}

export interface DebrisBox {
  x: number;
  z: number;
  halfW: number;
  halfD: number;
  height: number;
  slopeDir?: SlopeDir;
  /** If true, this debris is from a prop (table, chair, etc.) — excluded from projectile terrain-follow. */
  isProp?: boolean;
}

// ── Terrain presets ─────────────────────────────────────────────────

export type TerrainPreset = 'scattered' | 'terraced' | 'heightmap' | 'dungeon' | 'rooms' | 'voxelDungeon';

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
    spawnClear: 1.5,
    generateBox() {
      const w = snapHalf(0.2 + Math.random() * 0.9);
      const d = snapHalf(0.2 + Math.random() * 0.9);
      const isTall = Math.random() < 0.2;
      const h = snapHalf(isTall ? 1 + Math.random() * 1.75 : 0.15 + Math.random() * 0.4);
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

  /** BSP-partitioned dungeon with rooms, corridors, and walls */
  dungeon: {
    count: 0,
    spawnClear: 0,
    generateBox() { return { w: 1, d: 1, h: 0.5 }; },
    generatePos() { return null; },
  },

  /** Simple random room placement with corridors */
  rooms: {
    count: 0,
    spawnClear: 0,
    generateBox() { return { w: 1, d: 1, h: 0.5 }; },
    generatePos() { return null; },
  },

  /** Blocky VOX dungeon with full-cube wall tiles */
  voxelDungeon: {
    count: 0,
    spawnClear: 0,
    generateBox() { return { w: 1, d: 1, h: 0.5 }; },
    generatePos() { return null; },
  },
};

const DEBUG_RAMPS = true;

// ── Terrain class ───────────────────────────────────────────────────

export class Terrain {
  readonly group = new THREE.Group();
  private debris: DebrisBox[] = [];
  private debrisEntities: Entity[] = [];
  private boxGroup = new THREE.Group(); // visible box meshes for click raycast
  private readonly groundSize = 40;
  readonly preset: TerrainPreset;
  private readonly heightmapStyle: HeightmapStyle;
  private palette: TerrainPalette;
  private paletteName: string;

  // Water plane + depth pass for foam
  private waterMaterial: THREE.ShaderMaterial | null = null;
  private waterMesh: THREE.Mesh | null = null;
  private depthTarget: THREE.WebGLRenderTarget | null = null;

  // Heightmap mesh data (only for 'heightmap' preset)
  private heightmapData: Float32Array | null = null;
  private heightmapRes = 0;
  private heightmapGroundSize = 0;
  private heightmapMaxHeight = 8;
  private heightmapPosterize = 4;
  private heightmapMesh: THREE.Mesh | null = null;
  private heightmapSkirtMesh: THREE.Mesh | null = null;
  private heightmapGrid: THREE.LineSegments | null = null;

  // Heightmap seed (stored so remesh can reproduce identical terrain)
  private heightmapSeed: number | undefined;
  private isRemeshing = false;

  // Ladder data
  private ladderDefs: LadderDef[] = [];
  private ladderMeshes: THREE.Group[] = [];
  private rampCells: Set<number> = new Set();

  // NavGrid reference (set after buildNavGrid, used by getRandomPosition)
  private navGrid: NavGrid | null = null;

  // Dungeon walk mask (only for dungeon/rooms presets)
  private walkMask: WalkMask | null = null;
  private effectiveGroundSize: number = 0; // may differ from groundSize for voxel dungeons
  private baseFloorY: number = 0; // minimum floor height (e.g. VOX ground tile thickness)

  // Dynamic debris (e.g. doors) — checked by resolveMovement alongside static debris
  private dynamicDebris: DebrisBox[] = [];

  // Door system (only for rooms preset)
  private doorSystem: DoorSystem | null = null;
  private propSystem: DungeonPropSystem | null = null;
  private natureResult: NatureGeneratorResult | null = null;
  private _disposed = false;
  /** Called when voxel dungeon props are ready; used to register prop chests with ChestSystem */
  private propChestRegistrar: ((list: { position: THREE.Vector3; mesh: THREE.Mesh; entity: Entity; openGeo?: THREE.BufferGeometry }[]) => void) | null = null;


  constructor(scene: THREE.Scene, preset: TerrainPreset = 'scattered', heightmapStyle: HeightmapStyle = 'rolling', palettePick: string = 'random') {
    this.preset = preset;
    this.heightmapStyle = heightmapStyle;
    if (palettePick !== 'random' && palettes[palettePick]) {
      this.palette = palettes[palettePick];
      this.paletteName = palettePick;
    } else {
      const { name, palette } = randomPalette();
      this.palette = palette;
      this.paletteName = name;
    }
    this.createGround();
    if (preset !== 'heightmap' && preset !== 'voxelDungeon') {
      this.createGridLines();
    }
    this.group.add(this.boxGroup);
    this.createDebris();
    scene.add(this.group);
  }

  /** Water plane Y. Lower for caves so only low areas flood. */
  private getWaterY(): number {
    return this.preset === 'heightmap' && this.heightmapStyle === 'caves' ? -0.5 : -0.05;
  }

  private createGround(): void {
    const size = this.groundSize;
    const geo = new THREE.PlaneGeometry(size, size, 64, 64);
    geo.rotateX(-Math.PI / 2);

    // Dungeon modes have their own floors — no water plane needed
    if (this.preset === 'dungeon' || this.preset === 'rooms' || this.preset === 'voxelDungeon') {
      return;
    }

    // Scattered / terraced: solid floor plane instead of water
    if (this.preset === 'scattered' || this.preset === 'terraced') {
      const floorMat = new THREE.MeshStandardMaterial({
        color: this.palette.flat,
        roughness: 0.95,
        metalness: 0.05,
      });
      const floor = new THREE.Mesh(geo, floorMat);
      floor.position.y = -0.01;
      floor.receiveShadow = true;
      this.waterMesh = floor; // reuse field for raycasting
      this.group.add(floor);
      return;
    }

    // Depth render target for foam around all objects
    const depthTarget = new THREE.WebGLRenderTarget(1024, 1024, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    depthTarget.depthTexture = new THREE.DepthTexture(1024, 1024);
    depthTarget.depthTexture.format = THREE.DepthFormat;
    depthTarget.depthTexture.type = THREE.UnsignedIntType;
    this.depthTarget = depthTarget;

    const waterMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uShallowColor: { value: new THREE.Color(this.palette.waterShallow) },
        uDeepColor: { value: new THREE.Color(this.palette.waterDeep) },
        uDepthTex: { value: depthTarget.depthTexture },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 100 },
        uResolution: { value: new THREE.Vector2(1024, 1024) },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec4 vScreenPos;
        varying vec3 vWorldPos;
        varying float vViewZ;

        void main() {
          vec3 pos = position;
          // Gentle wave
          pos.y += sin(pos.x * 0.6 + uTime * 0.3) * cos(pos.z * 0.5 + uTime * 0.2) * 0.012;
          vec4 worldPos = modelMatrix * vec4(pos, 1.0);
          vWorldPos = worldPos.xyz;
          vec4 viewPos = viewMatrix * worldPos;
          vViewZ = -viewPos.z;
          vScreenPos = projectionMatrix * viewPos;
          gl_Position = vScreenPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uShallowColor;
        uniform vec3 uDeepColor;
        uniform sampler2D uDepthTex;
        uniform float uCameraNear;
        uniform float uCameraFar;
        uniform vec2 uResolution;
        varying vec4 vScreenPos;
        varying vec3 vWorldPos;
        varying float vViewZ;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2(1,0)), f.x),
            mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x),
            f.y
          );
        }

        float linearizeDepth(float d) {
          return uCameraNear * uCameraFar / (uCameraFar - d * (uCameraFar - uCameraNear));
        }

        void main() {
          // Screen-space UV from clip coords
          vec2 screenUV = (vScreenPos.xy / vScreenPos.w) * 0.5 + 0.5;

          // Scene depth behind this water fragment
          float sceneDepthRaw = texture2D(uDepthTex, screenUV).r;
          float sceneDepth = linearizeDepth(sceneDepthRaw);
          float waterDepth = vViewZ;

          // How much scene geometry is behind the water surface (in world units)
          float depthDiff = sceneDepth - waterDepth;

          // Discard water in front of scene (terrain above water)
          if (depthDiff < 0.0) discard;

          // Wave offset for animated foam
          float waveOffset = sin(vWorldPos.x * 0.8 + uTime * 0.5) * 0.03
                           + sin(vWorldPos.z * 0.6 + uTime * 0.35) * 0.02;

          float animDepth = depthDiff + waveOffset;

          // Color: shallow → deep
          float depthMix = smoothstep(0.0, 3.0, animDepth);
          vec3 col = mix(uShallowColor, uDeepColor, depthMix);

          // Subtle caustics
          float t = uTime * 0.15;
          float caustic = noise(vWorldPos.xz * 1.5 + t) * noise(vWorldPos.xz * 2.2 - t * 0.7);
          col += vec3(caustic * 0.04);

          // ── Smooth foam line at edges ──
          // Sample depth at neighboring pixels to soften jagged triangle edges
          float foamNoise = noise(vWorldPos.xz * 5.0 + uTime * 0.3) * 0.008
                          + noise(vWorldPos.xz * 12.0 - uTime * 0.2) * 0.004;

          vec2 texel = 1.5 / uResolution;  // 1.5px blur radius
          float foamSum = 0.0;
          float totalWeight = 0.0;
          for (int ox = -1; ox <= 1; ox++) {
            for (int oz = -1; oz <= 1; oz++) {
              vec2 off = vec2(float(ox), float(oz)) * texel;
              float sDepth = linearizeDepth(texture2D(uDepthTex, screenUV + off).r);
              float dd = sDepth - vViewZ;
              // Compute per-sample foam
              float sGradX = dFdx(dd);
              float sGradY = dFdy(dd);
              float sGrad = length(vec2(sGradX, sGradY));
              float fw = mix(0.05, 0.1, smoothstep(0.01, 0.1, sGrad));
              float w = (ox == 0 && oz == 0) ? 2.0 : 1.0;
              foamSum += smoothstep(fw + foamNoise, 0.0, dd) * w;
              totalWeight += w;
            }
          }
          float foamLine = (foamSum / totalWeight) * 0.9;

          float foam = min(0.9, foamLine);
          col = mix(col, vec3(1.0), foam);

          // Alpha: fade in smoothly, more opaque deep
          float alpha = smoothstep(0.0, 0.5, animDepth) * 0.6;
          alpha = max(alpha, foam * 0.95);

          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    this.waterMaterial = waterMat;

    const water = new THREE.Mesh(geo, waterMat);
    water.position.y = this.getWaterY();
    this.waterMesh = water;
    this.group.add(water);
  }

  /** Render depth pass and animate water. Call before main render. */
  updateWater(dt: number, renderer?: THREE.WebGLRenderer, scene?: THREE.Scene, camera?: THREE.Camera): void {
    if (!this.waterMaterial) return;
    this.waterMaterial.uniforms.uTime.value += dt;

    if (renderer && scene && camera && this.depthTarget && this.waterMesh) {
      // Update camera uniforms
      if (camera instanceof THREE.PerspectiveCamera) {
        this.waterMaterial.uniforms.uCameraNear.value = camera.near;
        this.waterMaterial.uniforms.uCameraFar.value = camera.far;
      }

      // Resize depth target to match renderer
      const size = renderer.getSize(new THREE.Vector2());
      if (this.depthTarget.width !== size.x || this.depthTarget.height !== size.y) {
        this.depthTarget.setSize(size.x, size.y);
        this.waterMaterial.uniforms.uResolution.value.set(size.x, size.y);
      }

      // Render depth pass: hide water, render scene to depth target
      this.waterMesh.visible = false;
      renderer.setRenderTarget(this.depthTarget);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      this.waterMesh.visible = true;
    }
  }

  getPaletteName(): string {
    return this.paletteName;
  }

  /** Swap palette and recolor existing terrain mesh + water without regenerating */
  applyPalette(pal: TerrainPalette, name: string): void {
    this.palette = pal;
    this.paletteName = name;

    // Update water colors
    if (this.waterMaterial) {
      this.waterMaterial.uniforms.uShallowColor.value.set(pal.waterShallow);
      this.waterMaterial.uniforms.uDeepColor.value.set(pal.waterDeep);
    }

    // Recolor heightmap mesh vertices
    if (!this.heightmapMesh || !this.heightmapData) return;
    const geo = this.heightmapMesh.geometry;
    const colorAttr = geo.getAttribute('color') as THREE.BufferAttribute;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    if (!colorAttr || !posAttr) return;

    const heights = this.heightmapData;
    const res = this.heightmapRes;
    const groundSize = this.heightmapGroundSize;
    const maxHeight = this.heightmapMaxHeight;
    const hmCellSize = groundSize / res;
    const eps = hmCellSize * 0.5;
    const maxPassableSlope = (0.75 / hmCellSize) * 0.4;
    const waterY = this.getWaterY();
    const verts = res + 1;

    const colorFlat = new THREE.Color(pal.flat);
    const colorGentleSlope = new THREE.Color(pal.gentleSlope);
    const colorSteepSlope = new THREE.Color(pal.steepSlope);
    const colorCliff = new THREE.Color(pal.cliff);
    const colorSand = new THREE.Color(pal.sand);
    const colorWetSand = new THREE.Color(pal.wetSand);
    const tmpColor = new THREE.Color();

    const isCaves = this.preset === 'heightmap' && this.heightmapStyle === 'caves';
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
          const terraceStep = maxHeight / Math.max(this.heightmapPosterize, 2);
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

  setGridOpacity(opacity: number): void {
    this.group.traverse((obj) => {
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

  private createGridLines(): void {
    const gridOpacity = useGameStore.getState().gridOpacity;
    const grid = new THREE.GridHelper(this.groundSize, this.groundSize / HALF, 0x444466, 0x333355);
    grid.position.y = 0.01;
    const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const mat of mats) {
      mat.transparent = true;
      mat.opacity = gridOpacity;
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
    // Dark lines on light surfaces, light lines on dark surfaces
    const lum = baseColor.r * 0.299 + baseColor.g * 0.587 + baseColor.b * 0.114;
    const gridColor = lum > 0.25
      ? baseColor.clone().multiplyScalar(0.65)
      : baseColor.clone().multiplyScalar(1.4);
    const mat = new THREE.LineBasicMaterial({
      color: gridColor,
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
    } else if (this.preset === 'voxelDungeon') {
      this.createVoxelDungeonDebris();
    } else if (this.preset === 'dungeon' || this.preset === 'rooms') {
      this.createDungeonDebris();
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
    const config = { ...getHeightmapConfig(this.heightmapStyle) };
    const groundSize = this.groundSize - 4; // usable area (2m margin each side)
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
    const result = generateHeightmap(config, groundSize, this.heightmapSeed, resolutionScale);
    this.heightmapSeed = result.seed;
    const heights = result.heights;
    const rampCells = result.rampCells;
    this.rampCells = rampCells;
    this.heightmapData = heights;
    // During remesh, keep original ladder defs (world positions don't change)
    if (!this.isRemeshing) {
      this.ladderDefs = result.ladders;
    }
    console.log(`[Terrain] Heightmap style=${this.heightmapStyle}, ladders=${this.ladderDefs.length}, rampCells=${rampCells.size}`);
    this.heightmapRes = res;
    this.heightmapGroundSize = groundSize;
    this.heightmapMaxHeight = config.maxHeight;
    this.heightmapPosterize = config.posterize || 4;

    // Debug: render heightmap as grayscale canvas overlay
    this.debugHeightmapCanvas(heights, verts, config.maxHeight);

    // ── Build mesh geometry ──
    const positions = new Float32Array(verts * verts * 3);
    const colors = new Float32Array(verts * verts * 3);
    const indices: number[] = [];

    // Slope-based color palette
    const pal = this.palette;
    console.log(`[Terrain] Palette: ${this.paletteName}`);
    const colorFlat = new THREE.Color(pal.flat);
    const colorGentleSlope = new THREE.Color(pal.gentleSlope);
    const colorSteepSlope = new THREE.Color(pal.steepSlope);
    const colorCliff = new THREE.Color(pal.cliff);
    const colorSand = new THREE.Color(pal.sand);
    const colorWetSand = new THREE.Color(pal.wetSand);
    const tmpColor = new THREE.Color();
    const waterY = this.getWaterY();

    const isCaves = this.preset === 'heightmap' && this.heightmapStyle === 'caves';
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
    // NavGrid: maxSlope = (slopeHeight / hmCellSize) * 0.4
    // Default slopeHeight=0.75 from CharacterParams.
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
        // 1. Flat vertex near cliff above → stay green
        // 2. Cliff vertex at bottom edge (has a lower flat neighbor) → blend to green
        //    so triangle interpolation between this and the flat neighbor stays green.
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
    this.group.add(surfaceMesh);
    this.heightmapMesh = surfaceMesh;

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
    this.group.add(skirtMesh);
    this.heightmapSkirtMesh = skirtMesh;

    // ── Build grid line overlay ──
    // Wireframe grid + contour rungs. Per-vertex color: black on bright terrain, light gray on dark (cave) so grid is visible.
    const linePoints: number[] = [];
    const lineColors: number[] = [];
    const bias = 0.02; // slight offset to prevent z-fighting
    const geo = surfaceMesh.geometry;
    const normals = geo.getAttribute('normal') as THREE.BufferAttribute;

    /** Get biased position for vertex index (offset along normal) */
    const bx = (i: number) => positions[i * 3] + normals.getX(i) * bias;
    const by = (i: number) => positions[i * 3 + 1] + normals.getY(i) * bias;
    const bz = (i: number) => positions[i * 3 + 2] + normals.getZ(i) * bias;

    /** Line color from vertex luminance: 0 = black on bright, 0.7 = light gray on dark (cave floor). */
    const contrastForVertex = (vi: number): number => {
      const r = colors[vi * 3], g = colors[vi * 3 + 1], b = colors[vi * 3 + 2];
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      return lum > 0.18 ? 0 : 0.7;
    };

    const gridWaterY = waterY; // hide grid only when fully below water (caves: -0.5, else -0.05)

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
    // Sample the heightmap to get Y at each grid intersection, so the grid works at any scale.
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

    // Generate nature (trees, rocks, grass, flowers)
    if (useGameStore.getState().natureEnabled) {
      this.generateNatureElements();
    }
  }

  private generateNatureElements(): void {
    if (!this.heightmapData) return;
    // Dispose previous nature
    if (this.natureResult) {
      this.group.remove(this.natureResult.group);
      this.natureResult.dispose();
      this.natureResult = null;
    }

    // Build exclusion zones from ramps and ladders
    const exclusions: { x: number; z: number; r: number }[] = [];
    const gs = this.heightmapGroundSize;
    const res = this.heightmapRes;
    const cellSize = gs / res;
    const halfG = gs / 2;
    for (const idx of this.rampCells) {
      const gz = Math.floor(idx / (res + 1));
      const gx = idx - gz * (res + 1);
      exclusions.push({ x: gx * cellSize - halfG, z: gz * cellSize - halfG, r: cellSize * 1.2 });
    }
    for (const ld of this.ladderDefs) {
      exclusions.push({ x: ld.bottomX, z: ld.bottomZ, r: 1.5 });
      exclusions.push({ x: ld.highWorldX ?? ld.bottomX, z: ld.highWorldZ ?? ld.bottomZ, r: 1.5 });
      exclusions.push({ x: ld.lowWorldX, z: ld.lowWorldZ, r: 1.5 });
    }

    const biome = paletteBiome[this.paletteName] ?? 'temperate';
    const result = generateNature(
      this.heightmapData,
      this.heightmapRes,
      this.heightmapGroundSize,
      this.getWaterY(),
      biome,
      this.palette,
      this.heightmapSeed ?? 0,
      exclusions,
      useGameStore.getState().useBiomes,
    );
    this.natureResult = result;
    this.group.add(result.group);

    if (useGameStore.getState().debugBiomes && useGameStore.getState().useBiomes) {
      this.tintTerrainByPatches(result);
    }

    // Register tree trunks as small debris so characters walk around them
    for (const t of result.treePositions) {
      const h = sampleHeightmap(this.heightmapData, this.heightmapRes, this.heightmapGroundSize, t.x, t.z);
      this.debris.push({
        x: t.x, z: t.z,
        halfW: t.radius, halfD: t.radius,
        height: h + 0.3,
      });
    }
  }

  private tintTerrainByPatches(nature: NatureGeneratorResult): void {
    if (!this.heightmapMesh || !this.heightmapData) return;
    const geo = this.heightmapMesh.geometry;
    const colorAttr = geo.getAttribute('color') as THREE.BufferAttribute;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    if (!colorAttr || !posAttr) return;

    const th = nature.patchThreshold;
    const tintStrength = 0.7;
    const treeColor = new THREE.Color(0.0, 0.9, 0.0);
    const rockColor = new THREE.Color(1.0, 0.5, 0.0);
    const flowerColor = new THREE.Color(1.0, 0.0, 1.0);
    const cliffColor = new THREE.Color(this.palette.cliff);

    const heights = this.heightmapData;
    const res = this.heightmapRes;
    const gs = this.heightmapGroundSize;
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

    console.log(`[Terrain] Patch tint: ${tinted}/${posAttr.count} vertices tinted`);

    colorAttr.needsUpdate = true;
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

    const rungSpacing = 0.2;
    const rungCount = Math.max(1, Math.floor(ladderLength / rungSpacing));
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

    const railGeo = new THREE.BoxGeometry(railThickness, ladderLength + 0.15, railThickness);
    const rungGeo = new THREE.BoxGeometry(railWidth, rungThickness, rungThickness);

    // Place ladder at the cliff face (offset slightly outward)
    const offsetFromWall = 0.06;
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

  private createDungeonDebris(): void {
    const { wallGap, doorChance } = useGameStore.getState();
    const output = generateDungeon(this.preset as 'dungeon' | 'rooms', this.groundSize, wallGap, undefined, undefined, doorChance);
    this.walkMask = output.walkMask;
    this.effectiveGroundSize = this.groundSize;

    console.log(`[Terrain] ${this.preset}: ${output.roomCount} rooms, ${output.corridorCount} corridors, ${output.boxes.length} boxes, ${output.doors.length} doors`);

    for (const def of output.boxes) {
      this.placeBox(def.x, def.z, def.w, def.d, def.h, true);
    }

    if (output.doors.length > 0) {
      this.doorSystem = new DoorSystem(
        this.group,
        this,
        output.doors,
        output.walkMask.cellSize,
      );
    }
  }

  private createVoxelDungeonDebris(): void {
    const { wallGap, roomSpacing, tileSize, doorChance, dungeonVariant } = useGameStore.getState();
    const output = generateDungeon('dungeon', this.groundSize, wallGap, tileSize, roomSpacing, doorChance);
    this.walkMask = output.walkMask;
    this.effectiveGroundSize = this.groundSize;
    const cellSize = output.walkMask.cellSize;

    console.log(`[Terrain] voxelDungeon: ${output.roomCount} rooms, ${output.corridorCount} corridors, ${output.doors.length} doors`);

    // Snapshot openGrid for visual tile placement BEFORE door-flanking mutation
    const { openGrid, gridW, gridD } = output.walkMask;
    const visualOpenGrid = openGrid.slice();

    // Mark door-flanking cells (pillar cells) as unwalkable so only the central cell is passable
    // This only affects walkMask/collision — visuals use the pre-mutation snapshot
    for (const d of output.gridDoors) {
      const gx = Math.round(d.x);
      const gz = Math.round(d.z);
      if (d.orientation === 'NS') {
        // Corridor runs along X — pillars above and below
        if (gz - 1 >= 0) openGrid[(gz - 1) * gridW + gx] = false;
        if (gz + 1 < gridD) openGrid[(gz + 1) * gridW + gx] = false;
      } else {
        // Corridor runs along Z — pillars left and right
        if (gx - 1 >= 0) openGrid[gz * gridW + (gx - 1)] = false;
        if (gx + 1 < gridW) openGrid[gz * gridW + (gx + 1)] = false;
      }
    }

    // Resolve dungeon theme variant
    const theme = dungeonVariant === 'random'
      ? DUNGEON_VARIANTS[Math.floor(Math.random() * DUNGEON_VARIANTS.length)]
      : dungeonVariant;

    const voxConfig = {
      openGrid: visualOpenGrid,
      gridW: output.walkMask.gridW,
      gridD: output.walkMask.gridD,
      cellSize,
      groundSize: this.groundSize,
      doors: output.doors,
      gridDoors: output.gridDoors,
      roomOwnership: output.roomOwnership,
      theme,
    };

    const vdResult = buildVoxelDungeonCollision(voxConfig, this.boxGroup);
    this.debris.push(...vdResult.debris);
    this.debrisEntities.push(...vdResult.entities);

    // VOX ground tiles are ~0.1m tall — characters should stand on top
    this.baseFloorY = 1 * (cellSize / 15); // VOX_GROUND_Y * voxelScale

    // Load visuals async, then create doors + props (need tile geometry to be loaded first)
    loadVoxelDungeonVisuals(voxConfig, this.group).then(async () => {
      if (this._disposed) return; // terrain was regenerated while loading — bail out
      if (output.doors.length > 0) {
        this.doorSystem = new DoorSystem(
          this.group,
          this,
          output.doors,
          cellSize,
          true, // useVoxDoors
        );
      }

      // Place props in rooms
      clearPropCache();
      this.propSystem = new DungeonPropSystem(this.group);
      await this.propSystem.populate(
        output.rooms,
        cellSize,
        this.groundSize,
        output.walkMask.openGrid,
        output.walkMask.gridW,
        output.gridDoors,
        undefined, // wallHeight default
        useGameStore.getState().roomLabels,
      );

      // Register prop debris boxes for physical collision (keyboard movement)
      const propDebris = this.propSystem.getDebrisBoxes();
      for (const d of propDebris) d.isProp = true;
      this.debris.push(...propDebris);

      // Block the nav cell at each prop's actual world position (accounts for wall push offset).
      if (this.navGrid && this.propSystem) {
        const propPositions = this.propSystem.getPropWorldPositions();
        const blocked: { gx: number; gz: number }[] = [];
        for (const { x, z } of propPositions) {
          blocked.push(this.navGrid.worldToGrid(x, z));
        }
        this.navGrid.applyBlockedCells(blocked);
      }

      // Register interactive prop chests with ChestSystem (voxel dungeon)
      if (this.propChestRegistrar && this.propSystem) {
        const chests = this.propSystem.getInteractiveChests();
        if (chests.length > 0) this.propChestRegistrar(chests);
      }

      // Apply grid opacity to async-loaded grid overlay
      this.setGridOpacity(useGameStore.getState().gridOpacity);
    });
  }

  /** Set callback to run when voxel dungeon prop chests are placed (so Game can register them with ChestSystem). */
  setPropChestRegistrar(cb: ((list: { position: THREE.Vector3; mesh: THREE.Mesh; entity: Entity; openGeo?: THREE.BufferGeometry }[]) => void) | null): void {
    this.propChestRegistrar = cb;
  }

  /** Re-fire the prop chest registrar with existing prop chests (for HMR reuse). */
  reregisterPropChests(): void {
    if (this.propChestRegistrar && this.propSystem) {
      const chests = this.propSystem.getInteractiveChests();
      if (chests.length > 0) this.propChestRegistrar(chests);
    }
  }

  /** Show or hide voxel dungeon room name labels (e.g. from settings toggle). */
  setRoomLabelsVisible(visible: boolean): void {
    this.propSystem?.setRoomLabelsVisible(visible);
  }

  private createTerracedDebris(): void {
    const halfGround = this.groundSize / 2 - 2;
    const spawnClear = 2;

    const clusterCount = 5 + Math.floor(Math.random() * 4);
    const anchors: { x: number; z: number }[] = [];

    for (let c = 0; c < clusterCount; c++) {
      let ax = 0, az = 0;
      for (let attempt = 0; attempt < 20; attempt++) {
        ax = (Math.random() - 0.5) * halfGround * 1.6;
        az = (Math.random() - 0.5) * halfGround * 1.6;
        if (Math.abs(ax) < spawnClear + 1 && Math.abs(az) < spawnClear + 1) continue;
        const tooClose = anchors.some(a =>
          Math.abs(ax - a.x) < 3 && Math.abs(az - a.z) < 3
        );
        if (!tooClose) break;
      }
      anchors.push({ x: ax, z: az });

      const maxSteps = 3 + Math.floor(Math.random() * 4);
      const baseAngle = Math.random() * Math.PI * 2;
      const spread = 0.4 + Math.random() * 0.6;

      for (let step = 0; step < maxSteps; step++) {
        const h = snapHalf((step + 1) * 0.25);
        const ringBoxes = Math.max(1, Math.floor((maxSteps - step) * (2 + Math.random())));

        for (let b = 0; b < ringBoxes; b++) {
          const w = snapHalf(0.5 + Math.random() * 1);
          const d = snapHalf(0.5 + Math.random() * 1);

          const ringRadius = (maxSteps - step) * 0.6 + Math.random() * 0.75;
          const angle = baseAngle + (b / ringBoxes) * Math.PI * 2 * spread +
            (Math.random() - 0.5) * 0.5;
          const bx = snapPos(ax + Math.cos(angle) * ringRadius, w / 2);
          const bz = snapPos(az + Math.sin(angle) * ringRadius, d / 2);

          if (Math.abs(bx) > halfGround || Math.abs(bz) > halfGround) continue;
          if (Math.abs(bx) < spawnClear && Math.abs(bz) < spawnClear) continue;

          this.placeBox(bx, bz, w, d, h);
        }
      }

      const peakW = snapHalf(0.5 + Math.random() * 0.75);
      const peakD = snapHalf(0.5 + Math.random() * 0.75);
      const peakH = snapHalf((maxSteps + 1) * 0.25);
      const px = snapPos(ax, peakW / 2);
      const pz = snapPos(az, peakD / 2);
      if (Math.abs(px) < halfGround && Math.abs(pz) < halfGround) {
        this.placeBox(px, pz, peakW, peakD, peakH);
      }
    }

    const fillerCount = 60;
    for (let i = 0; i < fillerCount; i++) {
      const w = snapHalf(0.25 + Math.random() * 0.75);
      const d = snapHalf(0.25 + Math.random() * 0.75);
      const isTall = Math.random() < 0.15;
      const h = snapHalf(isTall ? 1 + Math.random() * 1.25 : 0.15 + Math.random() * 0.25);
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
      if (box.height < 0.25 || box.height > 1.0) continue;
      if (box.slopeDir !== undefined) continue;

      for (const probe of probes) {
        if (rampsPlaced >= MAX_RAMPS) break;
        if (Math.random() > 0.4) continue;

        // Probe ahead to measure the drop first, then size ramp to match (~45°)
        const probeLen = 2.0; // max look-ahead
        const probeX = box.x + probe.dx * (box.halfW + probeLen / 2);
        const probeZ = box.z + probe.dz * (box.halfD + probeLen / 2);
        const probeLowY = this.getTerrainY(
          probeX + probe.dx * probeLen / 2,
          probeZ + probe.dz * probeLen / 2, 0.1);
        const estDrop = box.height - probeLowY;
        if (estDrop < 0.15 || estDrop > 1.25) continue;

        // Ramp length ≈ drop for ~45° slope (snap to grid)
        const rampLen = snapHalf(Math.max(HALF, estDrop));
        const rampW = snapHalf(Math.min(
          probe.dx !== 0 ? box.halfD * 2 : box.halfW * 2,
          0.5 + Math.random() * 0.75,
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
        if (drop < 0.15 || drop > 1.25) continue;

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
        if (rh < 0.25) continue;

        if (this.placeSlopeBox(rx, rz, w, d, rh, probe.slopeDir)) {
          rampsPlaced++;
        }
      }
    }
  }

  /** Place a single box into the world. Skips z-fighting overlaps unless skipZFight is set. */
  private placeBox(x: number, z: number, w: number, d: number, h: number, skipZFight = false): boolean {
    const colors = [0x2a2a3e, 0x33334a, 0x252538, 0x1e1e30, 0x3a3a50];
    const hw = w / 2, hd = d / 2;

    if (!skipZFight) {
      const zFight = this.debris.some(b =>
        Math.abs(h - b.height) < 0.01 &&
        Math.abs(x - b.x) < hw + b.halfW &&
        Math.abs(z - b.z) < hd + b.halfD
      );
      if (zFight) return false;
    }

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
    // Reveal shader is auto-applied via Architecture entity layer

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.boxGroup.add(mesh);

    const isWall = h > 0.2;
    const entity = new Entity(mesh, {
      layer: isWall ? Layer.Architecture : Layer.Prop,
      radius: Math.max(hw, hd),
      weight: Infinity,
    });
    this.debrisEntities.push(entity);

    const gridLines = this.createBoxGrid(w, h, d, baseColor);
    gridLines.position.copy(mesh.position);
    this.boxGroup.add(gridLines);

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
    this.boxGroup.add(mesh);

    const entity = new Entity(mesh, {
      layer: Layer.Architecture,
      radius: Math.max(hw, hd),
      weight: Infinity,
    });
    this.debrisEntities.push(entity);

    const gridLines = this.createSlopeGrid(w, h, d, slopeDir, baseColor);
    gridLines.position.copy(mesh.position);
    this.boxGroup.add(gridLines);

    this.debris.push({ x, z, halfW: hw, halfD: hd, height: h, slopeDir });
    return true;
  }

  /** Build a NavGrid from current terrain for A* pathfinding */
  buildNavGrid(stepHeight: number, capsuleRadius: number, cellSize = 0.5, slopeHeight?: number): NavGrid {
    const navGroundSize = this.effectiveGroundSize || this.groundSize;
    const grid = new NavGrid(navGroundSize, navGroundSize, cellSize);
    if (this.heightmapData) {
      grid.buildFromHeightmap(this.heightmapData, this.heightmapRes, this.heightmapGroundSize, stepHeight, slopeHeight);
    } else if (this.walkMask) {
      // Dungeon with walkMask: the mask IS the truth. Build a flat grid (no debris),
      // then let walkMask define exactly which cells are open/blocked.
      grid.build([], stepHeight, 0);
      grid.applyWalkMask(this.walkMask.openGrid, this.walkMask.gridW, this.walkMask.gridD, this.walkMask.cellSize, navGroundSize);
    } else {
      // Free-form terrain (scattered, terraced): use debris boxes for blocking
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

    // Skip ladders where bottom is underwater
    const waterY = this.getWaterY();
    if (lowCell.surfaceHeight < waterY + 0.1) return false;

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
    const EDGE_MARGIN = Math.ceil(2.5 / grid.cellSize);
    const MAX_WALK = Math.ceil(10 / grid.cellSize);  // ~10m walk through cliff in cells
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
                      // Penalize sloped surfaces at ladder endpoints
                      // Check height variation among neighbors of each endpoint
                      let slopePenalty = 0;
                      for (const [sdx, sdz] of DIRS) {
                        const na = grid.getCell(gx + sdx, gz + sdz);
                        if (na) slopePenalty += Math.abs(na.surfaceHeight - cell.surfaceHeight);
                        const nb = grid.getCell(cx + sdx, cz + sdz);
                        if (nb && nCell) slopePenalty += Math.abs(nb.surfaceHeight - nCell.surfaceHeight);
                      }
                      const score = heightDiff * 2 + flatness * 3 + slopePenalty * 4 + dist * 0.3;
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

  /** Add a static debris box (permanent collision, e.g. door pillars) */
  addStaticDebris(box: DebrisBox): void {
    this.debris.push(box);
  }

  /** Add a dynamic debris box (e.g. closed door) for collision checks */
  addDynamicDebris(box: DebrisBox): void {
    if (!this.dynamicDebris.includes(box)) {
      this.dynamicDebris.push(box);
    }
  }

  /** Remove a dynamic debris box (e.g. door opened) */
  removeDynamicDebris(box: DebrisBox): void {
    const idx = this.dynamicDebris.indexOf(box);
    if (idx >= 0) this.dynamicDebris.splice(idx, 1);
  }

  /** Get the door system (for update calls from Game.ts) */
  getDoorSystem(): DoorSystem | null {
    return this.doorSystem;
  }

  /** Objects to exclude from projectile raycasts (e.g. open doors). */
  getOpenDoorObjects(): THREE.Object3D[] {
    return this.doorSystem?.getOpenDoorObjects() ?? [];
  }

  /** The raycastable terrain surface mesh (heightmap, floor plane, or water). */
  getTerrainMesh(): THREE.Mesh | null {
    return this.heightmapMesh ?? this.waterMesh;
  }

  /** Group containing visible box/ramp meshes (scattered/terraced). Empty for other modes. */
  getBoxGroup(): THREE.Group {
    return this.boxGroup;
  }

  /** The root terrain group (all terrain children including walls, floors, props). */
  getGroup(): THREE.Group {
    return this.group;
  }

  getDebrisCount(): number {
    return this.debris.length;
  }



  /** Get the ground/debris height at a point, optionally expanded by a radius */
  /** Floor height ignoring small prop debris (walls only). Used by loot physics. */
  getFloorY(x: number, z: number): number {
    if (this.heightmapData) {
      return sampleHeightmap(this.heightmapData, this.heightmapRes, this.heightmapGroundSize, x, z);
    }
    return this.baseFloorY;
  }

  /** Like getTerrainY but ignores prop debris (tables, chairs). Used for projectile terrain-follow. */
  getTerrainYNoProps(x: number, z: number): number {
    if (this.heightmapData) {
      return sampleHeightmap(this.heightmapData, this.heightmapRes, this.heightmapGroundSize, x, z);
    }
    let maxY = this.baseFloorY;
    for (const box of this.debris) {
      if (box.isProp) continue;
      if (Math.abs(x - box.x) < box.halfW && Math.abs(z - box.z) < box.halfD) {
        const h = getBoxHeightAt(box, x, z);
        maxY = Math.max(maxY, h);
      }
    }
    return maxY;
  }

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
    let maxY = this.baseFloorY;
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

  /** Surface normal at (x, z) for aligning decals/splats. Heightmap: gradient-based; box terrain: up. */
  getTerrainNormal(x: number, z: number): THREE.Vector3 {
    const up = new THREE.Vector3(0, 1, 0);
    if (this.heightmapData) {
      const eps = 0.05;
      const hL = this.getTerrainY(x - eps, z);
      const hR = this.getTerrainY(x + eps, z);
      const hD = this.getTerrainY(x, z - eps);
      const hU = this.getTerrainY(x, z + eps);
      const dx = (hR - hL) / (2 * eps);
      const dz = (hU - hD) / (2 * eps);
      const n = new THREE.Vector3(-dx, 1, -dz).normalize();
      return n;
    }
    return up;
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
      const heights = this.heightmapData;
      const hmRes = this.heightmapRes;
      const hmGround = this.heightmapGroundSize;
      const hmCellSize = hmGround / hmRes;
      const effectiveSlopeHeight = slopeHeight ?? stepHeight * 2;
      const maxSlope = (effectiveSlopeHeight / hmCellSize) * 0.45;
      const eps = hmCellSize * 0.5;

      /** Gradient using plain bilinear sampling — matches NavGrid exactly */
      const gradientAt = (px: number, pz: number): { gx: number; gz: number; mag: number } => {
        const hL = sampleHeightmap(heights, hmRes, hmGround, px - eps, pz);
        const hR = sampleHeightmap(heights, hmRes, hmGround, px + eps, pz);
        const hU = sampleHeightmap(heights, hmRes, hmGround, px, pz - eps);
        const hD = sampleHeightmap(heights, hmRes, hmGround, px, pz + eps);
        const gx = (hR - hL) / (2 * eps);
        const gz = (hD - hU) / (2 * eps);
        return { gx, gz, mag: Math.sqrt(gx * gx + gz * gz) };
      };

      const terrainY = this.getTerrainY(rx, rz, sampleR);

      // Resolve slope collision first, then push out of debris
      let resultX = rx;
      let resultZ = rz;
      let resultY = terrainY;

      if (oldX !== undefined && oldZ !== undefined) {
        const mx = rx - oldX;
        const mz = rz - oldZ;
        const moveLen = Math.sqrt(mx * mx + mz * mz);

        if (moveLen > 0.0001) {
          const aheadX = rx + (mx / moveLen) * eps;
          const aheadZ = rz + (mz / moveLen) * eps;
          const grad = gradientAt(aheadX, aheadZ);

          if (grad.mag > maxSlope) {
            const nx = grad.gx / grad.mag;
            const nz = grad.gz / grad.mag;
            const dot = (mx / moveLen) * nx + (mz / moveLen) * nz;
            const absDot = Math.abs(dot);

            if (absDot > 0.05) {
              // Moving into steep slope — slide along contour
              const slideX = Math.max(-halfBound, Math.min(halfBound, oldX + mx - dot * moveLen * nx));
              const slideZ = Math.max(-halfBound, Math.min(halfBound, oldZ + mz - dot * moveLen * nz));
              const slideY = this.getTerrainY(slideX, slideZ, sampleR);
              const slideGrad = gradientAt(slideX, slideZ);

              if (slideGrad.mag <= maxSlope) {
                resultX = slideX; resultZ = slideZ; resultY = slideY;
              } else {
                const smx = slideX - oldX;
                const smz = slideZ - oldZ;
                const smLen = Math.sqrt(smx * smx + smz * smz);
                if (smLen > 0.0001) {
                  const sdot = (smx / smLen) * (slideGrad.gx / slideGrad.mag) +
                               (smz / smLen) * (slideGrad.gz / slideGrad.mag);
                  if (Math.abs(sdot) <= 0.05) {
                    resultX = slideX; resultZ = slideZ; resultY = slideY;
                  } else {
                    // Fully blocked — stay put
                    resultX = oldX; resultZ = oldZ; resultY = currentY;
                  }
                } else {
                  resultX = oldX; resultZ = oldZ; resultY = currentY;
                }
              }
            }
            // else absDot <= 0.05: moving along contour, allow (resultX/Z already = rx/rz)
          }
          // else gentle slope, allow (resultX/Z already = rx/rz)
        }
      }

      // Push out of debris (props, doors, etc.)
      const pushed = this.pushOutOfDebris(resultX, resultZ, currentY, stepHeight, radius);
      return { x: pushed.x, z: pushed.z, y: resultY };
    }

    // Box-based: iterative push-out (static + dynamic debris)
    ({ x: rx, z: rz } = this.pushOutOfDebris(rx, rz, currentY, stepHeight, radius));

    const terrainY = this.getTerrainY(rx, rz, radius * 0.5);
    const y = terrainY - currentY <= stepHeight ? terrainY : currentY;

    return { x: rx, z: rz, y };
  }

  /** Push position out of any debris boxes (static + dynamic) */
  private pushOutOfDebris(rx: number, rz: number, currentY: number, stepHeight: number, radius: number): { x: number; z: number } {
    const allDebris = this.dynamicDebris.length > 0
      ? [...this.debris, ...this.dynamicDebris]
      : this.debris;
    for (let pass = 0; pass < 4; pass++) {
      for (const box of allDebris) {
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
    return { x: rx, z: rz };
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

  /** Rebuild only the heightmap mesh + grid + ladders at a new resolution scale,
   *  keeping the same seed so the terrain shape is identical. Entities are unaffected. */
  remesh(): void {
    if (this.preset !== 'heightmap') return;
    const { resolutionScale } = useGameStore.getState();
    console.log(`[Terrain] Remesh at ${resolutionScale}× (seed=${this.heightmapSeed})`);

    // Dispose old mesh, grid, and ladder visuals
    if (this.heightmapMesh) {
      this.group.remove(this.heightmapMesh);
      this.heightmapMesh.geometry.dispose();
      (this.heightmapMesh.material as THREE.Material).dispose();
      this.heightmapMesh = null;
    }
    if (this.heightmapSkirtMesh) {
      this.group.remove(this.heightmapSkirtMesh);
      this.heightmapSkirtMesh.geometry.dispose();
      (this.heightmapSkirtMesh.material as THREE.Material).dispose();
      this.heightmapSkirtMesh = null;
    }
    if (this.heightmapGrid) {
      this.group.remove(this.heightmapGrid);
      this.heightmapGrid.geometry.dispose();
      (this.heightmapGrid.material as THREE.Material).dispose();
      this.heightmapGrid = null;
    }
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
    if (this.natureResult) {
      this.group.remove(this.natureResult.group);
      this.natureResult.dispose();
      this.natureResult = null;
    }

    // Rebuild with same seed (stored from previous generation)
    this.isRemeshing = true;
    this.createHeightmapMesh();
    this.isRemeshing = false;
    this.setGridOpacity(useGameStore.getState().gridOpacity);
  }

  /** Re-register all terrain entities into the entity registry after an HMR clear. */
  reregisterEntities(): void {
    for (const entity of this.debrisEntities) {
      entityRegistry.reregister(entity);
    }
    if (this.doorSystem) {
      for (const entity of this.doorSystem.getEntities()) {
        entityRegistry.reregister(entity);
      }
    }
    if (this.propSystem) {
      for (const entity of this.propSystem.getEntities()) {
        entityRegistry.reregister(entity);
      }
    }
  }

  dispose(): void {
    this._disposed = true;

    for (const entity of this.debrisEntities) {
      entity.destroy();
    }
    this.debrisEntities.length = 0;
    this.debris.length = 0;

    // Dispose and clear boxGroup children (collision meshes)
    while (this.boxGroup.children.length > 0) {
      const child = this.boxGroup.children[0];
      this.boxGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    }

    // Dispose all children of main group (ground tiles, wallVisuals, grid, etc.)
    const toRemove = [...this.group.children];
    for (const child of toRemove) {
      this.group.remove(child);
      child.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          for (const mat of mats) mat.dispose();
        }
      });
    }

    // Clear heightmap thumbnail
    useGameStore.getState().setHeightmapThumb(null);

    // Dispose heightmap mesh resources
    if (this.heightmapMesh) {
      this.heightmapMesh.geometry.dispose();
      (this.heightmapMesh.material as THREE.Material).dispose();
      this.heightmapMesh = null;
    }
    if (this.heightmapSkirtMesh) {
      this.heightmapSkirtMesh.geometry.dispose();
      (this.heightmapSkirtMesh.material as THREE.Material).dispose();
      this.heightmapSkirtMesh = null;
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

    // Dispose nature
    if (this.natureResult) {
      this.group.remove(this.natureResult.group);
      this.natureResult.dispose();
      this.natureResult = null;
    }

    // Dispose door system
    if (this.doorSystem) {
      this.doorSystem.dispose();
      this.doorSystem = null;
    }
    // Dispose prop system
    if (this.propSystem) {
      this.propSystem.dispose();
      this.propSystem = null;
    }
    this.dynamicDebris.length = 0;
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

    // Dungeon/rooms/voxelDungeon: pick directly from NavGrid spawn-region cells
    if ((this.preset === 'dungeon' || this.preset === 'rooms' || this.preset === 'voxelDungeon') && this.navGrid) {
      for (let attempt = 0; attempt < 50; attempt++) {
        const cell = this.navGrid.getRandomSpawnCell();
        if (!cell) break;
        return new THREE.Vector3(cell.x, cell.surfaceHeight, cell.z);
      }
      // Fallback: center of first floor tile
      if (this.debris.length > 0) {
        const floor = this.debris[0];
        return new THREE.Vector3(floor.x, floor.height, floor.z);
      }
      return new THREE.Vector3(0, 0, 0);
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
