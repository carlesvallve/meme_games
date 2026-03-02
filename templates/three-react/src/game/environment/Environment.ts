import * as THREE from 'three';
import { Entity, entityRegistry } from '../Entity';
import type { NavGrid } from '../pathfinding';
import type { LadderDef } from '../dungeon';
import { DoorSystem, DungeonPropSystem, RoomVisibility } from '../dungeon';
import { randomPalette, palettes } from '../terrain/ColorPalettes';
import type { TerrainPalette } from '../terrain/ColorPalettes';
import type { HeightmapStyle } from '../terrain/TerrainNoise';
import { useGameStore } from '../../store';

import {
  EnvironmentContext,
  type DebrisBox,
  type TerrainPreset,
} from './EnvironmentContext';
import { EnvironmentPhysics } from './EnvironmentPhysics';
import { EnvironmentNavigation } from './EnvironmentNavigation';
import { TerrainBuilder } from '../terrain/TerrainBuilder';
import { DungeonBuilder, type TerrainLike } from '../dungeon/DungeonBuilder';

export type { HeightmapStyle } from '../terrain/TerrainNoise';

// ── Environment (facade) ────────────────────────────────────────────

export class Environment implements TerrainLike {
  private ctx: EnvironmentContext;
  private physics: EnvironmentPhysics;
  private terrainBuilder: TerrainBuilder;
  private dungeonBuilder: DungeonBuilder;
  private navigation: EnvironmentNavigation;

  constructor(
    scene: THREE.Scene,
    preset: TerrainPreset = 'scattered',
    heightmapStyle: HeightmapStyle = 'rolling',
    palettePick: string = 'random',
    dungeonSeed?: number,
  ) {
    // Resolve palette
    let palette: TerrainPalette;
    let paletteName: string;
    if (palettePick !== 'random' && palettes[palettePick]) {
      palette = palettes[palettePick];
      paletteName = palettePick;
    } else {
      const pick = randomPalette();
      palette = pick.palette;
      paletteName = pick.name;
    }

    const groundSize = useGameStore.getState().dungeonSize;

    // Create shared context
    this.ctx = new EnvironmentContext(
      groundSize,
      preset,
      heightmapStyle,
      palette,
      paletteName,
      dungeonSeed,
    );

    // Create sub-modules
    this.physics = new EnvironmentPhysics(this.ctx);
    this.terrainBuilder = new TerrainBuilder(
      this.ctx,
      (x: number, z: number, radius?: number) =>
        this.physics.getTerrainY(x, z, radius),
    );
    this.dungeonBuilder = new DungeonBuilder(
      this.ctx,
      (x, z, w, d, h, skip) =>
        this.terrainBuilder.placeBox(x, z, w, d, h, skip),
      this, // Environment implements TerrainLike
    );
    this.navigation = new EnvironmentNavigation(
      this.ctx,
      this.physics,
      (li: number) => this.terrainBuilder.createSingleLadderMesh(li),
    );

    // Initialize terrain
    this.terrainBuilder.createGround();
    if (preset !== 'heightmap' && preset !== 'voxelDungeon') {
      this.terrainBuilder.createGridLines();
    }
    this.ctx.group.add(this.ctx.boxGroup);
    this.createDebris();
    scene.add(this.ctx.group);
  }

  // ── Dispatch debris creation by preset ────────────────────────────

  private createDebris(): void {
    const preset = this.ctx.preset;
    if (preset === 'heightmap') {
      this.terrainBuilder.createHeightmapMesh();
    } else if (preset === 'terraced') {
      this.terrainBuilder.createTerracedDebris();
    } else if (preset === 'voxelDungeon') {
      this.dungeonBuilder.createVoxelDungeonDebris();
    } else if (preset === 'dungeon' || preset === 'rooms') {
      this.dungeonBuilder.createDungeonDebris();
    } else {
      this.terrainBuilder.createScatteredDebris();
    }
  }

  // ── TerrainLike interface (needed by DoorSystem via DungeonBuilder) ──

  addStaticDebris(box: DebrisBox): void {
    this.ctx.debris.push(box);
  }

  addDynamicDebris(box: DebrisBox): void {
    if (!this.ctx.dynamicDebris.includes(box)) {
      this.ctx.dynamicDebris.push(box);
    }
  }

  removeDynamicDebris(box: DebrisBox): void {
    const idx = this.ctx.dynamicDebris.indexOf(box);
    if (idx >= 0) this.ctx.dynamicDebris.splice(idx, 1);
  }

  registerVisibility(
    obj: THREE.Object3D,
    roomIds: number[],
    wx?: number,
    wz?: number,
  ): void {
    this.dungeonBuilder.registerVisibility(obj, roomIds, wx, wz);
  }

  // ── Forward: physics ──────────────────────────────────────────────

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
    return this.physics.resolveMovement(
      newX,
      newZ,
      currentY,
      stepHeight,
      radius,
      oldX,
      oldZ,
      slopeHeight,
    );
  }

  getTerrainY(x: number, z: number, radius = 0): number {
    return this.physics.getTerrainY(x, z, radius);
  }

  getTerrainYNoProps(x: number, z: number): number {
    return this.physics.getTerrainYNoProps(x, z);
  }

  getFloorY(x: number, z: number): number {
    return this.physics.getFloorY(x, z);
  }

  getTerrainNormal(x: number, z: number): THREE.Vector3 {
    return this.physics.getTerrainNormal(x, z);
  }

  isOnStairs(x: number, z: number): boolean {
    return this.physics.isOnStairs(x, z);
  }

  // ── Forward: navigation ───────────────────────────────────────────

  buildNavGrid(
    stepHeight: number,
    capsuleRadius: number,
    cellSize = 0.5,
    slopeHeight?: number,
  ): NavGrid {
    return this.navigation.buildNavGrid(
      stepHeight,
      capsuleRadius,
      cellSize,
      slopeHeight,
    );
  }

  getRandomPosition(
    margin = 3,
    clearance = 0.6,
    excludePos?: { x: number; z: number },
    excludeRadius = 0,
  ): THREE.Vector3 {
    return this.navigation.getRandomPosition(
      margin,
      clearance,
      excludePos,
      excludeRadius,
    );
  }

  // ── Forward: Environment builder ──────────────────────────────────────

  updateWater(
    dt: number,
    renderer?: THREE.WebGLRenderer,
    scene?: THREE.Scene,
    camera?: THREE.Camera,
  ): void {
    this.terrainBuilder.updateWater(dt, renderer, scene, camera);
  }

  applyPalette(pal: TerrainPalette, name: string): void {
    this.terrainBuilder.applyPalette(pal, name);
  }

  setGridOpacity(opacity: number): void {
    this.terrainBuilder.setGridOpacity(opacity);
  }

  remesh(): void {
    this.terrainBuilder.remesh();
  }

  getPaletteName(): string {
    return this.ctx.paletteName;
  }

  // ── Forward: dungeon builder ──────────────────────────────────────

  getDoorSystem(): DoorSystem | null {
    return this.dungeonBuilder.getDoorSystem();
  }

  getRoomCount(): number {
    return this.dungeonBuilder.getRoomCount();
  }

  getRoomVisibility(): RoomVisibility | null {
    return this.dungeonBuilder.getRoomVisibility();
  }

  getDoorCenters(): { x: number; z: number; orientation: 'NS' | 'EW' }[] {
    return this.dungeonBuilder.getDoorCenters();
  }

  getEntrancePosition(): THREE.Vector3 | null {
    return this.dungeonBuilder.getEntrancePosition();
  }

  getEntrancePortalPosition(): THREE.Vector3 | null {
    return this.dungeonBuilder.getEntrancePortalPosition();
  }

  getEntranceFacing(): number {
    return this.dungeonBuilder.getEntranceFacing();
  }

  getExitPosition(): THREE.Vector3 | null {
    return this.dungeonBuilder.getExitPosition();
  }

  getExitPortalPosition(): THREE.Vector3 | null {
    return this.dungeonBuilder.getExitPortalPosition();
  }

  getExitWallDir(): [number, number] {
    return this.dungeonBuilder.getExitWallDir();
  }

  getNearbyDoor(
    x: number,
    z: number,
    moveX: number,
    moveZ: number,
    range: number,
  ): { cx: number; cz: number; corrAxis: 'x' | 'z' } | null {
    return this.dungeonBuilder.getNearbyDoor(x, z, moveX, moveZ, range);
  }

  getOpenDoorObjects(): THREE.Object3D[] {
    return this.dungeonBuilder.getOpenDoorObjects();
  }

  updateProps(dt: number, playerPos?: THREE.Vector3): void {
    this.dungeonBuilder.updateProps(dt, playerPos);
  }

  getPropSystem(): DungeonPropSystem | null {
    return this.dungeonBuilder.getPropSystem();
  }

  unblockPropAt(wx: number, wz: number): void {
    this.dungeonBuilder.unblockPropAt(wx, wz);
  }

  isOpenCell(wx: number, wz: number): boolean {
    return this.dungeonBuilder.isOpenCell(wx, wz);
  }

  setOnDungeonReady(cb: (() => void) | null): void {
    this.dungeonBuilder.setOnDungeonReady(cb);
  }

  setPropChestRegistrar(
    cb:
      | ((
          list: {
            position: THREE.Vector3;
            mesh: THREE.Mesh;
            entity: Entity;
            openGeo?: THREE.BufferGeometry;
          }[],
        ) => void)
      | null,
  ): void {
    this.dungeonBuilder.setPropChestRegistrar(cb);
  }

  reregisterPropChests(): void {
    this.dungeonBuilder.reregisterPropChests();
  }

  setRoomLabelsVisible(visible: boolean): void {
    this.dungeonBuilder.setRoomLabelsVisible(visible);
  }

  getLevelTransitionPositions(): { x: number; z: number }[] {
    return this.dungeonBuilder.getLevelTransitionPositions();
  }

  // ── Direct context accessors ──────────────────────────────────────

  get preset(): TerrainPreset {
    return this.ctx.preset;
  }

  get group(): THREE.Group {
    return this.ctx.group;
  }

  getLadderDefs(): ReadonlyArray<LadderDef> {
    return this.ctx.ladderDefs;
  }

  getDebris(): ReadonlyArray<Readonly<DebrisBox>> {
    return this.ctx.debris;
  }

  getDebrisCount(): number {
    return this.ctx.debris.length;
  }

  getTerrainMesh(): THREE.Mesh | null {
    return this.ctx.heightmapMesh ?? this.ctx.waterMesh;
  }

  getBoxGroup(): THREE.Group {
    return this.ctx.boxGroup;
  }

  getGroup(): THREE.Group {
    return this.ctx.group;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  reregisterEntities(): void {
    for (const entity of this.ctx.debrisEntities) {
      entityRegistry.reregister(entity);
    }
    if (this.ctx.doorSystem) {
      for (const entity of this.ctx.doorSystem.getEntities()) {
        entityRegistry.reregister(entity);
      }
    }
    if (this.ctx.propSystem) {
      for (const entity of this.ctx.propSystem.getEntities()) {
        entityRegistry.reregister(entity);
      }
    }
  }

  dispose(): void {
    this.ctx._disposed = true;

    for (const entity of this.ctx.debrisEntities) {
      entity.destroy();
    }
    this.ctx.debrisEntities.length = 0;
    this.ctx.debris.length = 0;

    // Dispose and clear boxGroup children
    while (this.ctx.boxGroup.children.length > 0) {
      const child = this.ctx.boxGroup.children[0];
      this.ctx.boxGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (child.material instanceof THREE.Material) child.material.dispose();
      }
    }

    // Dispose all children of main group
    const toRemove = [...this.ctx.group.children];
    for (const child of toRemove) {
      this.ctx.group.remove(child);
      child.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          const mats = Array.isArray(node.material)
            ? node.material
            : [node.material];
          for (const mat of mats) mat.dispose();
        }
      });
    }

    // Clear heightmap thumbnail
    useGameStore.getState().setHeightmapThumb(null);

    // Dispose heightmap mesh resources
    if (this.ctx.heightmapMesh) {
      this.ctx.heightmapMesh.geometry.dispose();
      (this.ctx.heightmapMesh.material as THREE.Material).dispose();
      this.ctx.heightmapMesh = null;
    }
    if (this.ctx.heightmapSkirtMesh) {
      this.ctx.heightmapSkirtMesh.geometry.dispose();
      (this.ctx.heightmapSkirtMesh.material as THREE.Material).dispose();
      this.ctx.heightmapSkirtMesh = null;
    }
    if (this.ctx.heightmapGrid) {
      this.ctx.heightmapGrid.geometry.dispose();
      (this.ctx.heightmapGrid.material as THREE.Material).dispose();
      this.ctx.heightmapGrid = null;
    }
    this.ctx.heightmapData = null;
    this.ctx.navGrid = null;

    // Dispose ladder meshes
    for (const ladderGroup of this.ctx.ladderMeshes) {
      ladderGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      this.ctx.group.remove(ladderGroup);
    }
    this.ctx.ladderMeshes = [];
    this.ctx.ladderDefs = [];

    // Dispose nature
    if (this.ctx.natureResult) {
      this.ctx.group.remove(this.ctx.natureResult.group);
      this.ctx.natureResult.dispose();
      this.ctx.natureResult = null;
    }

    // Dispose room visibility
    if (this.ctx.roomVisibility) {
      this.ctx.roomVisibility.dispose();
      this.ctx.roomVisibility = null;
    }
    // Dispose door system
    if (this.ctx.doorSystem) {
      this.ctx.doorSystem.dispose();
      this.ctx.doorSystem = null;
    }
    // Dispose prop system
    if (this.ctx.propSystem) {
      this.ctx.propSystem.dispose();
      this.ctx.propSystem = null;
    }
    this.ctx.dynamicDebris.length = 0;
  }
}
