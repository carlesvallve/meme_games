import * as THREE from 'three';
import { Entity, entityRegistry } from '../core/Entity';
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
import { OverworldMap } from '../overworld/OverworldMap';
import { OW_TOTAL_SIZE } from '../overworld/OverworldTiles';
import { buildFullCastle, buildFullDungeonEntrance } from '../overworld/OverworldPOIs';
import { sampleHeightmap } from '../terrain/TerrainNoise';

export type { HeightmapStyle } from '../terrain/TerrainNoise';
import { createTextLabel } from '../rendering/TextLabel';

// ── Environment (facade) ────────────────────────────────────────────

export class Environment implements TerrainLike {
  private ctx: EnvironmentContext;
  private physics: EnvironmentPhysics;
  private terrainBuilder: TerrainBuilder;
  private dungeonBuilder: DungeonBuilder;
  private navigation: EnvironmentNavigation;

  constructor(
    scene: THREE.Scene,
    preset: TerrainPreset = 'basic',
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

    const groundSize = preset === 'overworld'
      ? Math.ceil(OW_TOTAL_SIZE) + 2 // slight margin
      : useGameStore.getState().dungeonSize;

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
    if (preset !== 'overworld') {
      this.terrainBuilder.createGround();
    }
    if (preset !== 'heightmap' && preset !== 'voxelDungeon' && preset !== 'overworld') {
      this.terrainBuilder.createGridLines();
    }
    this.ctx.group.add(this.ctx.boxGroup);
    this.createDebris();
    // Build spatial hash for fast debris lookups (after all debris is registered)
    this.ctx.rebuildSpatialHash();
    scene.add(this.ctx.group);
  }

  // ── Dispatch debris creation by preset ────────────────────────────

  private createDebris(): void {
    const preset = this.ctx.preset;
    if (preset === 'overworld') {
      const seed = this.ctx.dungeonSeed ?? (Math.random() * 0xffffffff) >>> 0;
      const owMap = new OverworldMap(seed);
      owMap.build();
      if (useGameStore.getState().natureEnabled) {
        owMap.generateNatureForTiles();
      }
      owMap.generatePOIMarkers();
      this.ctx.overworldMap = owMap;
      this.ctx.group.add(owMap.group);
    } else if (preset === 'heightmap') {
      this.terrainBuilder.createHeightmapMesh();
      // Create water mesh after heightmap data is available (conforms to terrain at edges)
      this.terrainBuilder.createHeightmapWater();
      // Flatten terrain at POI locations, place POI meshes + register debris
      const poiExclusions = this.placeHeightmapPOIs();
      // Generate nature after POI flattening (so trees/rocks get correct heights and avoid POI areas)
      if (useGameStore.getState().natureEnabled) {
        this.terrainBuilder.generateNatureElements(poiExclusions);
      }
    } else if (preset === 'voxelDungeon') {
      this.dungeonBuilder.createVoxelDungeonDebris();
    } else {
      this.terrainBuilder.createScatteredDebris();
    }
  }

  /** Place full-size POIs on heightmap when zooming in from overworld.
   *  Flattens terrain around each POI, updates mesh + colors, then places structures.
   *  Returns exclusion zones for nature generation. */
  private placeHeightmapPOIs(): { x: number; z: number; r: number }[] {
    const store = useGameStore.getState();
    const owState = store.overworldState;
    if (!owState || owState.activeTileIndex === null) return [];

    const tileDef = owState.tiles[owState.activeTileIndex];
    if (!tileDef?.pois?.length) return [];

    const groundSize = this.ctx.heightmapGroundSize;
    const hmData = this.ctx.heightmapData;
    const hmRes = this.ctx.heightmapRes;
    const mesh = this.ctx.heightmapMesh;
    if (!hmData || !hmRes || !mesh) return [];

    const verts = hmRes + 1;
    const cellSize = groundSize / hmRes;
    const halfGround = groundSize / 2;
    const waterY = this.terrainBuilder.getWaterY();
    const minPoiY = waterY + 0.25; // ensure POIs sit above water
    let modified = false;

    for (const poi of tileDef.pois) {
      // Map normalized position to heightmap world coords
      const cx = poi.nx * groundSize;
      const cz = poi.nz * groundSize;

      // Flatten radius depends on POI type
      const flatRadius = poi.type === 'village' ? 2.0 : 1.5;
      const blendWidth = 1.5; // smooth transition zone
      const totalRadius = flatRadius + blendWidth;

      // Sample center height, clamp above water level
      const sampledY = sampleHeightmap(hmData, hmRes, groundSize, cx, cz);
      const flatY = Math.max(sampledY, minPoiY);

      // Find vertex range to check
      const minGx = Math.max(0, Math.floor((cx - totalRadius + halfGround) / cellSize) - 1);
      const maxGx = Math.min(verts - 1, Math.ceil((cx + totalRadius + halfGround) / cellSize) + 1);
      const minGz = Math.max(0, Math.floor((cz - totalRadius + halfGround) / cellSize) - 1);
      const maxGz = Math.min(verts - 1, Math.ceil((cz + totalRadius + halfGround) / cellSize) + 1);

      for (let gz = minGz; gz <= maxGz; gz++) {
        for (let gx = minGx; gx <= maxGx; gx++) {
          const wx = gx * cellSize - halfGround;
          const wz = gz * cellSize - halfGround;
          const dx = wx - cx;
          const dz = wz - cz;
          const dist = Math.sqrt(dx * dx + dz * dz);

          if (dist > totalRadius) continue;

          const idx = gz * verts + gx;
          const origH = hmData[idx];

          if (dist <= flatRadius) {
            // Fully flat zone
            hmData[idx] = flatY;
          } else {
            // Blend zone: smooth lerp from flatY back to original
            const t = (dist - flatRadius) / blendWidth;
            const smooth = t * t * (3 - 2 * t); // smoothstep
            hmData[idx] = flatY + (origH - flatY) * smooth;
          }
          modified = true;
        }
      }
    }

    // Update mesh vertex positions from flattened heightmap data
    if (modified) {
      const posAttr = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let gz = 0; gz < verts; gz++) {
        for (let gx = 0; gx < verts; gx++) {
          const idx = gz * verts + gx;
          posAttr.setY(idx, hmData[idx]);
        }
      }
      posAttr.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      mesh.geometry.computeBoundingSphere();

      // Recolor from flattened data (slope-based colors will update)
      this.terrainBuilder.applyPalette(this.ctx.palette, this.ctx.paletteName);
    }

    // Place POI meshes on the now-flat terrain
    for (const poi of tileDef.pois) {
      const wx = poi.nx * groundSize;
      const wz = poi.nz * groundSize;
      const y = sampleHeightmap(hmData, hmRes, groundSize, wx, wz);

      const isCleared = poi.type === 'dungeon' && owState.clearedDungeons.includes(poi.poiSeed);

      let poiMesh: THREE.Group;
      if (poi.type === 'village') {
        poiMesh = buildFullCastle(poi.poiSeed);
      } else {
        poiMesh = buildFullDungeonEntrance(poi.poiSeed);
      }

      poiMesh.position.set(wx, y, wz);
      poiMesh.rotation.y = ((poi.poiSeed & 0xFF) / 255) * Math.PI * 2;

      // Darken cleared dungeon entrances
      if (isCleared) {
        poiMesh.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const m = (child as THREE.Mesh).material;
            const mats = Array.isArray(m) ? m : [m];
            for (const mat of mats) {
              if ((mat as THREE.MeshStandardMaterial).color) {
                (mat as THREE.MeshStandardMaterial).color.multiplyScalar(0.5);
              }
            }
          }
        });
      }

      this.ctx.group.add(poiMesh);

      // Floating name label above POI gate/entrance
      // Starts invisible, fades in after zone announcement finishes
      const labelColor = poi.type === 'village' ? '#ffe8a0' : isCleared ? '#88aa77' : '#c0c8d8';
      const labelHeight = poi.type === 'village' ? 0.5 : 0.35;
      const skulls = poi.type === 'dungeon' && poi.skulls
        ? '\u2620'.repeat(Math.min(poi.skulls, 3))
        : '';
      const labelText = isCleared
        ? `${skulls ? skulls + ' ' : ''}${poi.name} — Conquered`
        : skulls ? `${skulls} ${poi.name}` : poi.name;
      const camOffset = poi.type === 'village' ? 1.1 : 0.5;
      const label = createTextLabel(labelText, { color: labelColor, height: labelHeight, opacity: 0, cameraOffset: camOffset });
      const mat = label.material as THREE.SpriteMaterial;
      mat.opacity = 0;
      const spawnTime = performance.now();
      // Quick fade-in if no announcement is active (e.g. returning from dungeon), otherwise wait for it
      const hasAnnouncement = useGameStore.getState().zoneAnnouncement !== null;
      const fadeDelay = isCleared || !hasAnnouncement ? 0 : 3800;
      const fadeDuration = isCleared || !hasAnnouncement ? 600 : 1200;

      const baseY = y + 1.25;
      label.position.set(wx, baseY, wz);
      // Chain fade-in after the auto camera-offset onBeforeRender
      const autoRender = label.onBeforeRender;
      label.onBeforeRender = (r, s, camera, geometry, material, group) => {
        autoRender(r, s, camera, geometry, material, group);
        const elapsed = performance.now() - spawnTime;
        mat.opacity = Math.min(1, Math.max(0, (elapsed - fadeDelay) / fadeDuration));
      };
      this.ctx.group.add(label);

      // Register collision debris for POIs — OBB (oriented bounding box)
      // POI mesh is passed for projectile raycasts (arrows stick to castle/dungeon walls)
      const rotAngle = poiMesh.rotation.y;
      const cosR = Math.cos(rotAngle);
      const sinR = Math.sin(rotAngle);
      let firstBox = true;
      const addRotatedBox = (lcx: number, lcz: number, lhw: number, lhd: number, h: number) => {
        const wcx = wx + lcx * cosR + lcz * sinR;
        const wcz = wz - lcx * sinR + lcz * cosR;
        // Pass poiMesh on first box only (registers once for projectile raycasts)
        this.ctx.addCollider(
          { x: wcx, z: wcz, halfW: lhw, halfD: lhd, height: h, rotation: rotAngle },
          firstBox ? { mesh: poiMesh } : { projectile: false },
        );
        firstBox = false;
      };

      if (poi.type === 'village') {
        // Castle keep — square, rotation-invariant (50% scale)
        addRotatedBox(0, 0, 0.5, 0.5, y + 1.5);
        // Castle walls — 4 sides, one AABB each
        const wallDist = 0.9;
        const wallHalfLen = 0.9;
        const wallHalfThick = 0.1;
        const wallH = y + 0.9;
        for (let side = 0; side < 4; side++) {
          const isX = side % 2 === 0;
          const sign = side < 2 ? 1 : -1;
          const lx = isX ? 0 : sign * wallDist;
          const lz = isX ? sign * wallDist : 0;
          const lhw = isX ? wallHalfLen : wallHalfThick;
          const lhd = isX ? wallHalfThick : wallHalfLen;
          addRotatedBox(lx, lz, lhw, lhd, wallH);
        }
      } else {
        // Dungeon entrance — two pillars + lintel
        const spacing = 0.3;
        const pillarHalf = 0.09;
        for (const pSign of [-1, 1]) {
          addRotatedBox(pSign * spacing, 0, pillarHalf, pillarHalf, y + 0.7);
        }
        // Lintel connecting pillars
        addRotatedBox(0, 0, spacing + pillarHalf, pillarHalf * 0.5, y + 0.75);
      }
    }

    // Return exclusion zones so nature doesn't spawn inside POIs
    return tileDef.pois.map(poi => ({
      x: poi.nx * groundSize,
      z: poi.nz * groundSize,
      r: poi.type === 'village' ? 2.5 : 2.0,
    }));
  }

  // ── Debug: visualize debris collision boxes ──────────────────────────

  private debugDebrisGroup: THREE.Group | null = null;

  showDebrisDebug(visible: boolean): void {
    if (!visible) {
      if (this.debugDebrisGroup) {
        this.ctx.group.remove(this.debugDebrisGroup);
        this.debugDebrisGroup.traverse((c) => {
          if (c instanceof THREE.Mesh || c instanceof THREE.LineSegments) {
            c.geometry.dispose();
            if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
            else (c.material as THREE.Material).dispose();
          }
        });
        this.debugDebrisGroup = null;
      }
      return;
    }

    // Remove old
    this.showDebrisDebug(false);

    const group = new THREE.Group();
    group.name = 'debugDebris';

    const greenMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, transparent: true, opacity: 0.5, depthTest: false });
    const redMat = new THREE.MeshBasicMaterial({ color: 0xff3333, wireframe: true, transparent: true, opacity: 0.5, depthTest: false });
    const stepHeight = 0.4; // matches CharacterSettings default

    for (const box of this.ctx.debris) {
      // Use the box's own height as the top, and terrain sample as the base
      const baseY = this.ctx.heightmapData
        ? sampleHeightmap(this.ctx.heightmapData, this.ctx.heightmapRes, this.ctx.heightmapGroundSize, box.x, box.z)
        : 0;
      const boxH = Math.max(0.05, box.height - baseY); // minimum visible size

      const isBlocking = (box.height - baseY) > stepHeight;
      const geo = new THREE.BoxGeometry(box.halfW * 2, boxH, box.halfD * 2);
      const mesh = new THREE.Mesh(geo, isBlocking ? redMat : greenMat);
      mesh.position.set(box.x, baseY + boxH / 2, box.z);
      if (box.rotation) mesh.rotation.y = box.rotation;
      mesh.renderOrder = 999;
      group.add(mesh);
    }

    this.ctx.group.add(group);
    this.debugDebrisGroup = group;
  }

  // ── TerrainLike interface (needed by DoorSystem via DungeonBuilder) ──

  addStaticDebris(box: DebrisBox, opts?: { mesh?: THREE.Object3D; projectile?: boolean }): void {
    this.ctx.addCollider(box, opts);
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
            variantId: string;
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

  getOverworldMap(): import('../overworld/OverworldMap').OverworldMap | null {
    return this.ctx.overworldMap;
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

  getNatureGroup(): THREE.Group | null {
    return this.ctx.natureResult?.group ?? null;
  }

  /** All objects that projectiles should collide with (terrain, boxes, trees, rocks, POIs). */
  getProjectileColliders(): THREE.Object3D[] {
    return this.ctx.getProjectileColliders();
  }

  getGroup(): THREE.Group {
    return this.ctx.group;
  }

  /** Get the terrain ground size in world units (uses heightmap size when available). */
  getGroundSize(): number {
    return this.ctx.heightmapGroundSize || this.ctx.groundSize;
  }

  /** Get the raw context ground size (used for physics bounds clamping). */
  getRawGroundSize(): number {
    return this.ctx.groundSize;
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

    // Dispose overworld map
    if (this.ctx.overworldMap) {
      this.ctx.overworldMap.dispose();
      this.ctx.overworldMap = null;
    }

    // Dispose nature
    if (this.ctx.natureResult) {
      this.ctx.group.remove(this.ctx.natureResult.group);
      this.ctx.natureResult.dispose();
      this.ctx.natureResult = null;
    }

    // Dispose proxy collider meshes
    this.ctx.disposeProxies();

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
