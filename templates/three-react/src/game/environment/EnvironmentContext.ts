import * as THREE from 'three';
import { Entity } from '../core/Entity';
import { NavGrid } from '../pathfinding';
import type { SlopeDir } from '../pathfinding';
import type { LadderDef, WalkMask, StairDef, LadderHint } from '../dungeon';
import { DoorSystem, DungeonPropSystem, RoomVisibility } from '../dungeon';
import type { TerrainPalette } from '../terrain/ColorPalettes';
import type { HeightmapStyle } from '../terrain/TerrainNoise';
import type { NatureGeneratorResult } from '../terrain/NatureGenerator';
import type { OverworldMap } from '../overworld/OverworldMap';

// ── Types ───────────────────────────────────────────────────────────

export interface DebrisBox {
  x: number;
  z: number;
  halfW: number;
  halfD: number;
  height: number;
  slopeDir?: SlopeDir;
  /** If true, this debris is from a prop (table, chair, etc.) — excluded from projectile terrain-follow. */
  isProp?: boolean;
  /** Optional Y-axis rotation in radians. When set, the box is an OBB (oriented bounding box). */
  rotation?: number;
}

// ── Spatial hash for fast debris lookup ─────────────────────────────

const DEBRIS_CELL = 4; // meters per spatial hash cell

export class DebrisSpatialHash {
  private cells = new Map<number, DebrisBox[]>();

  private key(cx: number, cz: number): number {
    return ((cx + 500) * 1000 + (cz + 500)) | 0;
  }

  clear(): void {
    this.cells.clear();
  }

  /** Build spatial index from debris array. Call once after all debris is added. */
  build(debris: DebrisBox[]): void {
    this.cells.clear();
    for (const box of debris) {
      const maxHalf = Math.max(box.halfW, box.halfD);
      const minCX = Math.floor((box.x - maxHalf) / DEBRIS_CELL);
      const maxCX = Math.floor((box.x + maxHalf) / DEBRIS_CELL);
      const minCZ = Math.floor((box.z - maxHalf) / DEBRIS_CELL);
      const maxCZ = Math.floor((box.z + maxHalf) / DEBRIS_CELL);
      for (let cx = minCX; cx <= maxCX; cx++) {
        for (let cz = minCZ; cz <= maxCZ; cz++) {
          const k = this.key(cx, cz);
          let cell = this.cells.get(k);
          if (!cell) { cell = []; this.cells.set(k, cell); }
          cell.push(box);
        }
      }
    }
  }

  /** Query all debris that might overlap a point ± radius. */
  query(x: number, z: number, radius: number): DebrisBox[] {
    const minCX = Math.floor((x - radius) / DEBRIS_CELL);
    const maxCX = Math.floor((x + radius) / DEBRIS_CELL);
    const minCZ = Math.floor((z - radius) / DEBRIS_CELL);
    const maxCZ = Math.floor((z + radius) / DEBRIS_CELL);

    if (minCX === maxCX && minCZ === maxCZ) {
      return this.cells.get(this.key(minCX, minCZ)) ?? [];
    }

    // Collect unique boxes from multiple cells
    const seen = new Set<DebrisBox>();
    const result: DebrisBox[] = [];
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        const cell = this.cells.get(this.key(cx, cz));
        if (!cell) continue;
        for (const box of cell) {
          if (!seen.has(box)) { seen.add(box); result.push(box); }
        }
      }
    }
    return result;
  }
}

export type TerrainPreset =
  | 'basic'
  | 'heightmap'
  | 'voxelDungeon'
  | 'overworld';

// ── Shared mutable state ────────────────────────────────────────────

export class EnvironmentContext {
  readonly group = new THREE.Group();
  boxGroup = new THREE.Group();

  // Debris / collision
  debris: DebrisBox[] = [];
  debrisEntities: Entity[] = [];
  dynamicDebris: DebrisBox[] = [];
  debrisSpatial = new DebrisSpatialHash();

  // Generation params
  readonly groundSize: number;
  readonly preset: TerrainPreset;
  readonly heightmapStyle: HeightmapStyle;
  palette: TerrainPalette;
  paletteName: string;

  // Water plane + depth pass
  waterMaterial: THREE.ShaderMaterial | null = null;
  waterMesh: THREE.Mesh | null = null;
  depthTarget: THREE.WebGLRenderTarget | null = null;

  // Heightmap mesh data (only for 'heightmap' preset)
  heightmapData: Float32Array | null = null;
  heightmapRes = 0;
  heightmapGroundSize = 0;
  heightmapMaxHeight = 8;
  heightmapPosterize = 4;
  heightmapMesh: THREE.Mesh | null = null;
  heightmapSkirtMesh: THREE.Mesh | null = null;
  heightmapGrid: THREE.LineSegments | null = null;
  heightmapSeed: number | undefined;
  isRemeshing = false;

  // Ladder data
  ladderDefs: LadderDef[] = [];
  ladderMeshes: THREE.Group[] = [];
  dungeonLadderHints: LadderHint[] = [];
  rampCells: Set<number> = new Set();

  // NavGrid
  navGrid: NavGrid | null = null;

  // Dungeon walk mask
  walkMask: WalkMask | null = null;
  effectiveGroundSize = 0;
  baseFloorY = 0;

  // Stair system cell heights (voxelDungeon)
  cellHeights: Float32Array | null = null;
  dungeonCellSize = 0;
  dungeonGridW = 0;
  dungeonGridD = 0;
  dungeonRoomOwnership: number[] | null = null;
  visOwnership: number[] | null = null;
  stairMap: Map<number, StairDef> = new Map();
  dualLevelCells = new Map<number, number>();
  ladderCellSet = new Set<number>();

  // Door system
  doorSystem: DoorSystem | null = null;
  doorCenters: { x: number; z: number; orientation: 'NS' | 'EW' }[] = [];
  _roomCount = 0;
  propSystem: DungeonPropSystem | null = null;
  roomVisibility: RoomVisibility | null = null;

  // Entrance/exit
  entranceRoomCenter: THREE.Vector3 | null = null;
  exitRoomCenter: THREE.Vector3 | null = null;
  natureResult: NatureGeneratorResult | null = null;
  overworldMap: OverworldMap | null = null;
  _disposed = false;

  /** Data-driven water Y level computed from heightmap data. null = use default. */
  computedWaterY: number | null = null;

  propChestRegistrar:
    | ((
        list: {
          position: THREE.Vector3;
          mesh: THREE.Mesh;
          entity: Entity;
          openGeo?: THREE.BufferGeometry;
          variantId: string;
        }[],
      ) => void)
    | null = null;
  onDungeonReadyCb: (() => void) | null = null;
  dungeonSeed: number | undefined;

  /** Meshes registered as projectile colliders (arrows stick to these). */
  projectileColliders: THREE.Object3D[] = [];

  constructor(
    groundSize: number,
    preset: TerrainPreset,
    heightmapStyle: HeightmapStyle,
    palette: TerrainPalette,
    paletteName: string,
    dungeonSeed?: number,
  ) {
    this.groundSize = groundSize;
    this.preset = preset;
    this.heightmapStyle = heightmapStyle;
    this.palette = palette;
    this.paletteName = paletteName;
    this.dungeonSeed = dungeonSeed;
    // Initialize heightmapSeed from dungeonSeed so heightmap terrain is deterministic
    if (preset === 'heightmap' && dungeonSeed != null) {
      this.heightmapSeed = dungeonSeed;
    }
  }

  // ── Unified collider registration API ──────────────────────────────

  /** Invisible proxy meshes created for projectile raycasts (disposed with scene). */
  private proxyColliders: THREE.Mesh[] = [];

  /**
   * Register a static collider. Handles:
   *  - Movement collision (debris array + spatial hash)
   *  - Projectile collision (proxy mesh auto-created if no mesh provided)
   *
   * Call `rebuildSpatialHash()` once after all colliders are registered.
   *
   * @param box - The collision box (position, dimensions, optional rotation)
   * @param opts.mesh - Visible mesh for projectile raycasts. If omitted, an invisible proxy box is created.
   * @param opts.projectile - Whether projectiles should collide. Default true.
   */
  addCollider(box: DebrisBox, opts: { mesh?: THREE.Object3D; projectile?: boolean } = {}): void {
    this.debris.push(box);
    const wantProjectile = opts.projectile !== false;
    if (wantProjectile) {
      if (opts.mesh) {
        this.projectileColliders.push(opts.mesh);
      } else {
        // Create invisible proxy box for raycast
        const proxy = this.createProxyMesh(box);
        this.proxyColliders.push(proxy);
        this.group.add(proxy);
        this.projectileColliders.push(proxy);
      }
    }
  }

  /**
   * Register multiple static colliders at once (e.g., compound structure).
   * A single mesh covers all boxes for projectile raycasts.
   */
  addColliders(boxes: DebrisBox[], opts: { mesh?: THREE.Object3D; projectile?: boolean } = {}): void {
    for (const box of boxes) this.debris.push(box);
    const wantProjectile = opts.projectile !== false;
    if (wantProjectile && opts.mesh) {
      this.projectileColliders.push(opts.mesh);
    }
  }

  /** Create an invisible box mesh for projectile raycasts. */
  private createProxyMesh(box: DebrisBox): THREE.Mesh {
    const h = Math.max(0.1, box.height - (box.slopeDir ? 0 : 0));
    const geo = new THREE.BoxGeometry(box.halfW * 2, h, box.halfD * 2);
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(box.x, h / 2, box.z);
    if (box.rotation) mesh.rotation.y = box.rotation;
    mesh.updateMatrixWorld(true);
    return mesh;
  }

  /** Dispose proxy collider meshes. Called during scene teardown. */
  disposeProxies(): void {
    for (const p of this.proxyColliders) {
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
      p.removeFromParent();
    }
    this.proxyColliders.length = 0;
    this.projectileColliders.length = 0;
  }

  /**
   * Rebuild the spatial hash index. Call once after all static colliders
   * are registered (at end of scene setup). This enables fast O(1)
   * collision queries instead of O(n) brute force.
   */
  rebuildSpatialHash(): void {
    this.debrisSpatial.build(this.debris);
  }

  /**
   * Get all projectile-collidable objects (for passing to ProjectileSystem).
   * Includes terrain mesh, box group, and any registered projectile colliders.
   */
  getProjectileColliders(): THREE.Object3D[] {
    const result: THREE.Object3D[] = [this.boxGroup];
    if (this.heightmapMesh) result.push(this.heightmapMesh);
    result.push(...this.projectileColliders);
    return result;
  }
}
