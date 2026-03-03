import * as THREE from 'three';
import { Entity } from '../core/Entity';
import { NavGrid } from '../pathfinding';
import type { SlopeDir } from '../pathfinding';
import type { LadderDef, WalkMask, StairDef, LadderHint } from '../dungeon';
import { DoorSystem, DungeonPropSystem, RoomVisibility } from '../dungeon';
import type { TerrainPalette } from '../terrain/ColorPalettes';
import type { HeightmapStyle } from '../terrain/TerrainNoise';
import type { NatureGeneratorResult } from '../terrain/NatureGenerator';

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
}

export type TerrainPreset =
  | 'basic'
  | 'heightmap'
  | 'voxelDungeon';

// ── Shared mutable state ────────────────────────────────────────────

export class EnvironmentContext {
  readonly group = new THREE.Group();
  boxGroup = new THREE.Group();

  // Debris / collision
  debris: DebrisBox[] = [];
  debrisEntities: Entity[] = [];
  dynamicDebris: DebrisBox[] = [];

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
  _disposed = false;

  propChestRegistrar:
    | ((
        list: {
          position: THREE.Vector3;
          mesh: THREE.Mesh;
          entity: Entity;
          openGeo?: THREE.BufferGeometry;
        }[],
      ) => void)
    | null = null;
  onDungeonReadyCb: (() => void) | null = null;
  dungeonSeed: number | undefined;

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
  }
}
