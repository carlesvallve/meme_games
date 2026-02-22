// ── Door System ─────────────────────────────────────────────────────
// Swing doors placed at dungeon room doorways. Doors auto-open when
// the player approaches and close when they walk away. Uses a
// dynamicDebris box on Terrain for collision blocking when closed.
// Wide openings (gapWidth >= 2) get double doors that swing apart.

import * as THREE from 'three';
import type { DoorDef } from './DungeonGenerator';
import type { Terrain, DebrisBox } from './Terrain';
import { Entity, Layer } from './Entity';

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
  swingSign: number;    // +1 or -1 — approach side (single doors only)
  orientation: 'NS' | 'EW';
  worldX: number;
  worldZ: number;
}

const OPEN_DIST = 2.5;
const CLOSE_DIST = 3.5;
const ANIM_SPEED = 3.0;

// Door dimensions
const DOOR_HEIGHT = 2.2;
const DOOR_THICK = 0.1;
const WALL_STUB = 0.2;

export class DoorSystem {
  private doors: DoorObj[] = [];
  private readonly terrain: Terrain;
  private readonly parent: THREE.Object3D;

  constructor(parent: THREE.Object3D, terrain: Terrain, doorDefs: DoorDef[], cellSize: number) {
    this.parent = parent;
    this.terrain = terrain;

    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x6B4226,
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
      color: 0x8B5E3C,
      roughness: 0.8,
      metalness: 0.1,
    });

    for (const def of doorDefs) {
      this.createDoor(def, cellSize, doorMat, stubMat, plankMat);
    }
  }

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
      const lintelGeo = new THREE.BoxGeometry(openingWidth, lintelH, DOOR_THICK);
      const lintel = new THREE.Mesh(lintelGeo, stubMat);
      lintel.position.set(0, DOOR_HEIGHT + lintelH / 2, 0);
      lintel.castShadow = true;
      lintel.receiveShadow = true;
      group.add(lintel);
    }

    const pivots: THREE.Group[] = [];

    if (isDouble) {
      // Double doors: two panels, each hinged at the outer edge
      // Left panel: hinge at left stub edge, swings inward
      const leftPivot = new THREE.Group();
      leftPivot.position.set(-halfOpening + WALL_STUB, 0, 0);
      group.add(leftPivot);
      this.addDoorPanel(leftPivot, panelWidth, doorMat, plankMat);
      pivots.push(leftPivot);

      // Right panel: hinge at right stub edge, swings opposite
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
      layer: Layer.Architecture,
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

  update(dt: number, characterPositions: THREE.Vector3[], stepHeight: number): void {
    for (const door of this.doors) {
      let closestDist = Infinity;
      let closestDx = 0;
      let closestDz = 0;
      let anyInRange = false;

      for (const pos of characterPositions) {
        const dx = pos.x - door.worldX;
        const dz = pos.z - door.worldZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const dy = Math.abs(pos.y - 0);

        if (dist < closestDist && dy <= stepHeight) {
          closestDist = dist;
          closestDx = dx;
          closestDz = dz;
        }
        if (dist < OPEN_DIST && dy <= stepHeight) {
          anyInRange = true;
        }
      }

      const shouldOpen = anyInRange;
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
        door.openProgress = Math.min(target, door.openProgress + dt * ANIM_SPEED);
      } else if (door.openProgress > target) {
        door.openProgress = Math.max(target, door.openProgress - dt * ANIM_SPEED);
      }

      const easedProgress = easeInOutCubic(door.openProgress);

      if (door.isDouble) {
        // Double doors: left swings +90°, right swings -90° (always swing apart)
        const angle = easedProgress * (Math.PI / 2);
        door.pivots[0].rotation.y = angle;   // left panel swings open
        door.pivots[1].rotation.y = -angle;  // right panel swings opposite
      } else {
        // Single door: swing based on approach side
        door.pivots[0].rotation.y = easedProgress * (Math.PI / 2) * door.swingSign;
      }

      // Manage dynamic debris collision
      if (prev < 1 && door.openProgress >= 1) {
        this.terrain.removeDynamicDebris(door.debrisBox);
      } else if (prev >= 1 && door.openProgress < 1) {
        this.terrain.addDynamicDebris(door.debrisBox);
      } else if (prev > 0 && door.openProgress <= 0) {
        this.terrain.addDynamicDebris(door.debrisBox);
      }
    }
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
