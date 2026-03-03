// ── Door System ─────────────────────────────────────────────────────
// Swing doors placed at dungeon room doorways. Doors auto-open when
// the player approaches and close when they walk away. Uses a
// dynamicDebris box on Terrain for collision blocking when closed.
// Wide openings (gapWidth >= 2) get double doors that swing apart.
// Supports both procedural BoxGeometry doors and VOX door meshes.

import * as THREE from 'three';
import type { DoorDef } from './DungeonGenerator';
import type { DebrisBox } from '../environment/EnvironmentContext';
import type { TerrainLike } from './DungeonBuilder';
import { Entity, Layer } from '../core/Entity';
import { getRandomTile } from './VoxDungeonDB';
import { getCellSize, getWallTargetHeight } from './VoxDungeonLoader';
import { loadVoxModel, buildVoxMesh } from '../../utils/VoxModelLoader';

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface DoorObj {
  group: THREE.Group;
  /** Single door: 1 pivot. Double door: 2 pivots (left swings -, right swings +). */
  pivots: THREE.Group[];
  isDouble: boolean;
  entity: Entity;
  debrisBox: DebrisBox;
  isOpen: boolean;
  openProgress: number; // 0 = closed, 1 = open
  swingSign: number; // +1 or -1 — approach side (single doors only)
  orientation: 'NS' | 'EW';
  worldX: number;
  worldZ: number;
}

const OPEN_DIST = 1.2;
const CLOSE_DIST = 0.8;
const LATERAL_TOLERANCE = 0.6; // max offset along the door's parallel axis
const APPROACH_DOT = 0.3; // min dot-product of move direction vs door normal to trigger open
const ANIM_SPEED = 3.0;

// Procedural door dimensions
const DOOR_HEIGHT = 2.2;
const DOOR_THICK = 0.1;
const WALL_STUB = 0.2;

export class DoorSystem {
  private doors: DoorObj[] = [];
  private readonly terrain: TerrainLike;
  private readonly parent: THREE.Object3D;
  private _prevPositions: THREE.Vector3[] = [];
  /** Per-cell height offsets from stair system */
  private cellHeights: Float32Array | null = null;
  private gridW = 0;
  private gridD = 0;
  private doorCellSize = 0;
  private groundSize = 0;

  constructor(
    parent: THREE.Object3D,
    terrain: TerrainLike,
    doorDefs: DoorDef[],
    cellSize: number,
    useVoxDoors = false,
    frameMaterial?: THREE.Material,
    cellHeights?: Float32Array,
    gridW = 0,
    gridD = 0,
    groundSize = 0,
  ) {
    this.parent = parent;
    this.terrain = terrain;
    this.cellHeights = cellHeights ?? null;
    this.gridW = gridW;
    this.gridD = gridD;
    this.doorCellSize = cellSize;
    this.groundSize = groundSize;

    if (useVoxDoors) {
      for (const def of doorDefs) {
        this.createVoxDoor(def, cellSize, frameMaterial);
      }
    } else {
      const doorMat = new THREE.MeshStandardMaterial({
        color: 0x6b4226,
        roughness: 0.7,
        metalness: 0.15,
        emissive: 0x1a0a00,
        emissiveIntensity: 0.2,
      });
      const stubMat = new THREE.MeshStandardMaterial({
        color: 0x2a2a3e,
        roughness: 0.85,
        metalness: 0.1,
      });
      const plankMat = new THREE.MeshStandardMaterial({
        color: 0x8b5e3c,
        roughness: 0.8,
        metalness: 0.1,
      });
      for (const def of doorDefs) {
        this.createDoor(def, cellSize, doorMat, stubMat, plankMat);
      }
    }
  }

  // ── VOX door creation ──
  // Procedural blocky frame (two pillars + lintel) with a downscaled VOX door panel inside.

  private createVoxDoor(
    def: DoorDef,
    cellSize: number,
    frameMaterial?: THREE.Material,
  ): void {
    const isNS = def.orientation === 'NS';
    const wallH = getWallTargetHeight();

    // Frame dimensions — proportional to cell/wall size
    const frameW = cellSize * 1.15; // slightly wider than cell — covers wall gaps without z-fighting
    const frameThick = cellSize * 0.35; // shallow depth
    const pillarW = cellSize * 0.2; // pillar width (side columns)
    const lintelH = wallH * 0.18; // top beam height
    const openingW = frameW - pillarW * 2; // clear opening between pillars
    const openingH = wallH - lintelH; // clear opening below lintel

    // Door panel: snugly fills the opening
    const doorPanelW = openingW * 0.99;
    const doorPanelH = openingH * 0.99;

    const group = new THREE.Group();
    const doorY = this.getDoorCellHeight(def.x, def.z);
    group.position.set(def.x, doorY, def.z);
    if (isNS) group.rotation.y = Math.PI / 2;

    // Frame material — use dungeon ground material if provided, else fallback grey
    const frameMat =
      frameMaterial ??
      new THREE.MeshStandardMaterial({
        color: 0xa8a0a0,
        roughness: 0.85,
        metalness: 0.1,
      });

    // Left pillar
    const pillarGeo = new THREE.BoxGeometry(pillarW, wallH, frameThick);
    const leftPillar = new THREE.Mesh(pillarGeo, frameMat);
    leftPillar.position.set(-frameW / 2 + pillarW / 2, wallH / 2, 0);
    leftPillar.castShadow = true;
    leftPillar.receiveShadow = true;
    group.add(leftPillar);

    // Right pillar
    const rightPillar = new THREE.Mesh(pillarGeo, frameMat);
    rightPillar.position.set(frameW / 2 - pillarW / 2, wallH / 2, 0);
    rightPillar.castShadow = true;
    rightPillar.receiveShadow = true;
    group.add(rightPillar);

    // Lintel (top beam)
    const lintelGeo = new THREE.BoxGeometry(frameW, lintelH, frameThick);
    const lintel = new THREE.Mesh(lintelGeo, frameMat);
    lintel.position.set(0, wallH - lintelH / 2, 0);
    lintel.castShadow = true;
    lintel.receiveShadow = true;
    group.add(lintel);

    // Pivot for the swinging door panel — hinge at left inner edge
    const pivot = new THREE.Group();
    pivot.position.set(-openingW / 2, 0, 0);
    group.add(pivot);

    // Try to load VOX door panel — randomly pick from doors and gates
    const doorEntry = getRandomTile(Math.random() < 0.7 ? 'door' : 'gate');
    if (doorEntry) {
      // Queue async load — door will pop in once ready
      this.loadVoxDoorPanel(pivot, doorEntry, doorPanelW, doorPanelH, openingW);
    } else {
      // Fallback: procedural wooden panel
      this.addProceduralPanel(pivot, doorPanelW, doorPanelH, openingW);
    }

    this.parent.add(group);

    const halfOpening = cellSize / 2;
    const entity = new Entity(group, {
      layer: Layer.Prop,
      radius: halfOpening,
      weight: Infinity,
    });

    // Door panel debris (dynamic — removed when door opens)
    const debrisBox: DebrisBox = {
      x: def.x,
      z: def.z,
      halfW: isNS ? frameThick / 2 : halfOpening,
      halfD: isNS ? halfOpening : frameThick / 2,
      height: wallH,
    };

    this.terrain.addDynamicDebris(debrisBox);

    // Pillar debris (static — always blocks passage on the sides)
    const pillarOffset = frameW / 2 - pillarW / 2;
    const pillarHalfW = isNS ? frameThick / 2 : pillarW / 2;
    const pillarHalfD = isNS ? pillarW / 2 : frameThick / 2;
    const leftPillarDebris: DebrisBox = {
      x: def.x + (isNS ? 0 : -pillarOffset),
      z: def.z + (isNS ? -pillarOffset : 0),
      halfW: pillarHalfW,
      halfD: pillarHalfD,
      height: wallH,
    };
    const rightPillarDebris: DebrisBox = {
      x: def.x + (isNS ? 0 : pillarOffset),
      z: def.z + (isNS ? pillarOffset : 0),
      halfW: pillarHalfW,
      halfD: pillarHalfD,
      height: wallH,
    };
    this.terrain.addStaticDebris(leftPillarDebris);
    this.terrain.addStaticDebris(rightPillarDebris);

    this.doors.push({
      group,
      pivots: [pivot],
      isDouble: false,
      entity,
      debrisBox,
      isOpen: false,
      openProgress: 0,
      swingSign: 1,
      orientation: def.orientation,
      worldX: def.x,
      worldZ: def.z,
    });
  }

  /** Load a VOX door model at a custom height and add it to the pivot */
  private async loadVoxDoorPanel(
    pivot: THREE.Group,
    entry: import('./VoxDungeonDB').DungeonTileEntry,
    panelW: number,
    panelH: number,
    openingW: number,
  ): Promise<void> {
    try {
      const { model, palette } = await loadVoxModel(entry.voxPath);
      const geo = buildVoxMesh(model, palette, panelH);

      // Compute actual mesh width to scale it to the desired panel width
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      const meshW = bb.max.x - bb.min.x;
      const scaleX = meshW > 0 ? panelW / meshW : 1;

      const voxMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.7,
        metalness: 0.15,
      });

      const doorMesh = new THREE.Mesh(geo, voxMat);
      doorMesh.scale.x = scaleX;
      // Center the panel in the opening, offset from the hinge
      doorMesh.position.set(openingW / 2, 0, 0);
      doorMesh.castShadow = true;
      doorMesh.receiveShadow = true;
      pivot.add(doorMesh);
    } catch (err) {
      console.warn(
        '[Door] Failed to load VOX door panel, using procedural fallback',
        err,
      );
      this.addProceduralPanel(pivot, panelW, panelH, openingW);
    }
  }

  /** Fallback: add a simple procedural wooden panel to the pivot */
  private addProceduralPanel(
    pivot: THREE.Group,
    panelW: number,
    panelH: number,
    openingW: number,
  ): void {
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x6b4226,
      roughness: 0.7,
      metalness: 0.15,
    });
    const panelGeo = new THREE.BoxGeometry(panelW, panelH, DOOR_THICK);
    const panel = new THREE.Mesh(panelGeo, doorMat);
    panel.position.set(openingW / 2, panelH / 2, 0);
    panel.castShadow = true;
    panel.receiveShadow = true;
    pivot.add(panel);
  }

  // ── Procedural door creation (original) ──

  private createDoor(
    def: DoorDef,
    cellSize: number,
    doorMat: THREE.MeshStandardMaterial,
    stubMat: THREE.MeshStandardMaterial,
    plankMat: THREE.MeshStandardMaterial,
  ): void {
    const isNS = def.orientation === 'NS';
    const isDouble = def.gapWidth >= 2;

    // Total opening width in world units
    const openingWidth = def.gapWidth * cellSize;
    // Each panel width
    const panelWidth = isDouble
      ? (openingWidth - WALL_STUB * 2) / 2 - 0.05 // small gap between panels
      : openingWidth - WALL_STUB * 2;

    const group = new THREE.Group();
    group.position.set(def.x, 0, def.z);
    if (isNS) group.rotation.y = Math.PI / 2;

    // Wall stubs flanking the opening
    const halfOpening = openingWidth / 2;
    const stubGeo = new THREE.BoxGeometry(WALL_STUB, DOOR_HEIGHT, DOOR_THICK);

    const stubLeft = new THREE.Mesh(stubGeo, stubMat);
    stubLeft.position.set(-halfOpening + WALL_STUB / 2, DOOR_HEIGHT / 2, 0);
    stubLeft.castShadow = true;
    stubLeft.receiveShadow = true;
    group.add(stubLeft);

    const stubRight = new THREE.Mesh(stubGeo, stubMat);
    stubRight.position.set(halfOpening - WALL_STUB / 2, DOOR_HEIGHT / 2, 0);
    stubRight.castShadow = true;
    stubRight.receiveShadow = true;
    group.add(stubRight);

    // Lintel (upper band) spanning full opening width
    const WALL_HEIGHT = 2.5;
    const lintelH = WALL_HEIGHT - DOOR_HEIGHT;
    if (lintelH > 0) {
      const lintelGeo = new THREE.BoxGeometry(
        openingWidth,
        lintelH,
        DOOR_THICK,
      );
      const lintel = new THREE.Mesh(lintelGeo, stubMat);
      lintel.position.set(0, DOOR_HEIGHT + lintelH / 2, 0);
      lintel.castShadow = true;
      lintel.receiveShadow = true;
      group.add(lintel);
    }

    const pivots: THREE.Group[] = [];

    if (isDouble) {
      // Double doors: two panels, each hinged at the outer edge
      const leftPivot = new THREE.Group();
      leftPivot.position.set(-halfOpening + WALL_STUB, 0, 0);
      group.add(leftPivot);
      this.addDoorPanel(leftPivot, panelWidth, doorMat, plankMat);
      pivots.push(leftPivot);

      const rightPivot = new THREE.Group();
      rightPivot.position.set(halfOpening - WALL_STUB, 0, 0);
      group.add(rightPivot);
      this.addDoorPanel(rightPivot, -panelWidth, doorMat, plankMat);
      pivots.push(rightPivot);
    } else {
      // Single door: hinge at left edge
      const pivot = new THREE.Group();
      pivot.position.set(-halfOpening + WALL_STUB, 0, 0);
      group.add(pivot);
      this.addDoorPanel(pivot, panelWidth, doorMat, plankMat);
      pivots.push(pivot);
    }

    this.parent.add(group);

    const entityRadius = halfOpening;
    const entity = new Entity(group, {
      layer: Layer.Prop,
      radius: entityRadius,
      weight: Infinity,
    });

    // Debris box for collision (world space)
    const debrisBox: DebrisBox = {
      x: def.x,
      z: def.z,
      halfW: isNS ? DOOR_THICK / 2 : halfOpening,
      halfD: isNS ? halfOpening : DOOR_THICK / 2,
      height: DOOR_HEIGHT,
    };

    this.terrain.addDynamicDebris(debrisBox);

    this.doors.push({
      group,
      pivots,
      isDouble,
      entity,
      debrisBox,
      isOpen: false,
      openProgress: 0,
      swingSign: 1,
      orientation: def.orientation,
      worldX: def.x,
      worldZ: def.z,
    });
  }

  /** Add a door panel + planks to a pivot group. Negative width = panel extends in -X. */
  private addDoorPanel(
    pivot: THREE.Group,
    panelWidth: number,
    doorMat: THREE.MeshStandardMaterial,
    plankMat: THREE.MeshStandardMaterial,
  ): void {
    const absW = Math.abs(panelWidth);
    const doorGeo = new THREE.BoxGeometry(absW, DOOR_HEIGHT, DOOR_THICK);
    const doorMesh = new THREE.Mesh(doorGeo, doorMat);
    doorMesh.position.set(panelWidth / 2, DOOR_HEIGHT / 2, 0);
    doorMesh.castShadow = true;
    doorMesh.receiveShadow = true;
    pivot.add(doorMesh);

    // Decorative planks
    const plankGeo = new THREE.BoxGeometry(absW - 0.1, 0.04, DOOR_THICK + 0.02);
    for (const py of [0.4, 1.1, 1.8]) {
      const plank = new THREE.Mesh(plankGeo, plankMat);
      plank.position.set(panelWidth / 2, py, 0);
      pivot.add(plank);
    }
  }

  update(
    dt: number,
    characterPositions: THREE.Vector3[],
    stepHeight: number,
  ): void {
    // Track previous positions to compute movement direction
    if (!this._prevPositions) this._prevPositions = [];

    for (const door of this.doors) {
      let closestDist = Infinity;
      let closestDx = 0;
      let closestDz = 0;
      let anyApproaching = false;

      for (let ci = 0; ci < characterPositions.length; ci++) {
        const pos = characterPositions[ci];
        const dx = pos.x - door.worldX;
        const dz = pos.z - door.worldZ;
        const dy = Math.abs(pos.y - door.group.position.y);
        if (dy > stepHeight) continue;

        // Perpendicular = distance along the axis the door faces
        // Lateral = distance along the door's width axis
        const perp = door.orientation === 'EW' ? Math.abs(dz) : Math.abs(dx);
        const lateral = door.orientation === 'EW' ? Math.abs(dx) : Math.abs(dz);

        // Only trigger when character is in front of the door, not diagonally
        if (lateral > LATERAL_TOLERANCE) continue;

        if (perp < closestDist) {
          closestDist = perp;
          closestDx = dx;
          closestDz = dz;
        }
        if (perp < OPEN_DIST) {
          // Check movement direction: must be moving toward the door
          const prev = this._prevPositions[ci];
          if (prev) {
            const mvx = pos.x - prev.x;
            const mvz = pos.z - prev.z;
            const mvLen = Math.sqrt(mvx * mvx + mvz * mvz);
            if (mvLen > 0.001) {
              // Door normal: perpendicular axis pointing from char to door
              const normX = door.orientation === 'EW' ? 0 : -Math.sign(dx);
              const normZ = door.orientation === 'EW' ? -Math.sign(dz) : 0;
              const dot = (mvx / mvLen) * normX + (mvz / mvLen) * normZ;
              if (dot > APPROACH_DOT) {
                anyApproaching = true;
              }
            }
          }
        }
      }

      const shouldOpen = anyApproaching;
      const shouldClose = closestDist > CLOSE_DIST;

      if (shouldOpen && !door.isOpen) {
        door.isOpen = true;
        if (!door.isDouble) {
          // Single door: swing away from closest character
          if (door.orientation === 'EW') {
            door.swingSign = closestDz >= 0 ? 1 : -1;
          } else {
            door.swingSign = closestDx >= 0 ? 1 : -1;
          }
        }
      } else if (shouldClose && door.isOpen) {
        door.isOpen = false;
      }

      // Animate
      const target = door.isOpen ? 1 : 0;
      const prev = door.openProgress;

      if (door.openProgress < target) {
        door.openProgress = Math.min(
          target,
          door.openProgress + dt * ANIM_SPEED,
        );
      } else if (door.openProgress > target) {
        door.openProgress = Math.max(
          target,
          door.openProgress - dt * ANIM_SPEED,
        );
      }

      const easedProgress = easeInOutCubic(door.openProgress);

      if (door.isDouble) {
        // Double doors: left swings +90°, right swings -90° (always swing apart)
        const angle = easedProgress * (Math.PI / 2);
        door.pivots[0].rotation.y = angle; // left panel swings open
        door.pivots[1].rotation.y = -angle; // right panel swings opposite
      } else {
        // Single door: swing based on approach side
        door.pivots[0].rotation.y =
          easedProgress * (Math.PI / 2) * door.swingSign;
      }

      // Manage dynamic debris collision: disable while opening or closing so character isn't blocked
      if (door.openProgress > 0) {
        this.terrain.removeDynamicDebris(door.debrisBox);
      } else {
        this.terrain.addDynamicDebris(door.debrisBox);
      }
    }

    // Store current positions for next frame's direction check
    this._prevPositions = characterPositions.map((p) => p.clone());
  }

  /** Check if a door at the given index is open (or opening).
   *  Requires door to be at least 40% open to prevent visibility flicker. */
  isDoorOpen(index: number): boolean {
    const door = this.doors[index];
    return door ? door.openProgress > 0.4 : false;
  }

  /** Number of doors in the system. */
  getDoorCount(): number {
    return this.doors.length;
  }

  /** Return door groups that are currently open or opening/closing (so projectiles don't raycast them). */
  getOpenDoorObjects(): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const door of this.doors) {
      if (door.openProgress > 0) out.push(door.group);
    }
    return out;
  }

  /** Return all door entities (for HMR re-registration). */
  getEntities(): Entity[] {
    return this.doors.map((d) => d.entity);
  }

  /** Return all door groups (for room visibility registration). */
  getDoorGroups(): THREE.Group[] {
    return this.doors.map((d) => d.group);
  }

  /** Look up the cell height at a world-space door position. */
  private getDoorCellHeight(wx: number, wz: number): number {
    if (!this.cellHeights || this.doorCellSize <= 0) return 0;
    const halfW = this.groundSize / 2;
    const gx = Math.floor((wx + halfW) / this.doorCellSize);
    const gz = Math.floor((wz + halfW) / this.doorCellSize);
    if (gx < 0 || gx >= this.gridW || gz < 0 || gz >= this.gridD) return 0;
    return this.cellHeights[gz * this.gridW + gx];
  }

  dispose(): void {
    for (const door of this.doors) {
      door.entity.destroy();
      this.terrain.removeDynamicDebris(door.debrisBox);
      this.parent.remove(door.group);
    }
    this.doors.length = 0;
  }
}
