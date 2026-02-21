import * as THREE from 'three';
import type { Terrain } from './Terrain';
import type { LootSystem } from './Loot';
import { Entity, Layer, entityRegistry } from './Entity';
import { buildVoxelGeometry } from '../utils/voxelMesh';
import type { VoxelModel } from '../types';

interface ChestObj {
  group: THREE.Group;
  entity: Entity;
  opened: boolean;
  openTimer: number;
  lidPivot: THREE.Object3D;
  fadeTimer: number;      // starts after lid fully open
  removed: boolean;
  baseY: number;
}

// Palette indices
const _ = 0;
const DARK_BROWN = 1;
const LIGHT_BROWN = 2;
const GOLD = 3;
const METAL = 4;

const chestPalette: Record<number, THREE.Color> = {
  [_]: new THREE.Color('#000000'),
  [DARK_BROWN]: new THREE.Color('#4a2f1a'),
  [LIGHT_BROWN]: new THREE.Color('#8B5E3C'),
  [GOLD]: new THREE.Color('#FFD700'),
  [METAL]: new THREE.Color('#6a6a7a'),
};

const D = DARK_BROWN;
const L = LIGHT_BROWN;
const G = GOLD;
const M = METAL;

function buildChestBodyModel(): VoxelModel {
  // 4 wide x 3 tall x 3 deep body
  const voxels = new Map<string, number>();
  // Bottom layer (y=0)
  for (let x = 0; x < 4; x++) for (let z = 0; z < 3; z++) voxels.set(`${x},0,${z}`, D);
  // Middle layer (y=1) — hollow inside but we keep it solid for voxel look
  for (let x = 0; x < 4; x++) for (let z = 0; z < 3; z++) voxels.set(`${x},1,${z}`, L);
  // Gold lock on front center (y=1)
  voxels.set('1,1,0', G);
  voxels.set('2,1,0', G);
  // Metal corners
  voxels.set('0,0,0', M);
  voxels.set('3,0,0', M);
  voxels.set('0,0,2', M);
  voxels.set('3,0,2', M);

  return { size: { x: 4, y: 2, z: 3 }, voxels };
}

function buildChestLidModel(): VoxelModel {
  // 4 wide x 1 tall x 3 deep lid
  const voxels = new Map<string, number>();
  for (let x = 0; x < 4; x++) for (let z = 0; z < 3; z++) voxels.set(`${x},0,${z}`, D);
  // Gold trim on front
  voxels.set('1,0,0', G);
  voxels.set('2,0,0', G);
  // Metal corners
  voxels.set('0,0,0', M);
  voxels.set('3,0,0', M);
  voxels.set('0,0,2', M);
  voxels.set('3,0,2', M);

  return { size: { x: 4, y: 1, z: 3 }, voxels };
}

const VOXEL_SCALE = 0.2;

export class ChestSystem {
  private chests: ChestObj[] = [];
  private readonly scene: THREE.Scene;
  private readonly terrain: Terrain;
  private readonly lootSystem: LootSystem;
  private readonly count = 8;
  private readonly interactDist = 1.2;
  private readonly openSpeed = 3; // 1/seconds to fully open

  private bodyGeo: THREE.BufferGeometry;
  private lidGeo: THREE.BufferGeometry;
  private readonly fadeDelay = 0.8;   // seconds after lid opens before fade starts
  private readonly fadeDuration = 0.3; // seconds to fade out
  private material: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, terrain: Terrain, lootSystem: LootSystem) {
    this.scene = scene;
    this.terrain = terrain;
    this.lootSystem = lootSystem;

    this.bodyGeo = buildVoxelGeometry(buildChestBodyModel(), chestPalette, VOXEL_SCALE);
    this.lidGeo = buildVoxelGeometry(buildChestLidModel(), chestPalette, VOXEL_SCALE);
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7,
      metalness: 0.2,
    });

    for (let i = 0; i < this.count; i++) {
      this.spawnChest();
    }
  }

  private readonly spawnClearance = 1.2;

  private spawnChest(): void {
    let pos: THREE.Vector3 | null = null;
    const checkMask = Layer.Architecture | Layer.Prop | Layer.Collectible;

    for (let attempt = 0; attempt < 30; attempt++) {
      const candidate = this.terrain.getRandomPosition(4, 0.8);
      const nearby = entityRegistry.queryRadius(candidate, this.spawnClearance, checkMask);
      if (nearby.length === 0) {
        pos = candidate;
        break;
      }
    }
    if (!pos) return; // couldn't find a clear spot

    const group = new THREE.Group();
    group.position.set(pos.x, pos.y, pos.z);

    // Body mesh
    const bodyMesh = new THREE.Mesh(this.bodyGeo, this.material);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    // Body center is at origin of its geometry; shift up so bottom sits at y=0
    bodyMesh.position.y = VOXEL_SCALE; // half of body height (2 voxels * 0.2 / 2)
    group.add(bodyMesh);

    // Lid pivot — positioned at back-top edge of body
    const lidPivot = new THREE.Object3D();
    lidPivot.position.set(0, VOXEL_SCALE * 2, -VOXEL_SCALE * 1.5); // top-back of body
    group.add(lidPivot);

    // Lid mesh — offset so it rotates from its back edge
    const lidMesh = new THREE.Mesh(this.lidGeo, this.material);
    lidMesh.castShadow = true;
    lidMesh.position.set(0, VOXEL_SCALE * 0.5, VOXEL_SCALE * 1.5); // offset forward from pivot
    lidPivot.add(lidMesh);

    this.scene.add(group);

    const entity = new Entity(group, { layer: Layer.Prop, radius: 0.4 });

    this.chests.push({
      group,
      entity,
      opened: false,
      openTimer: 0,
      lidPivot,
      fadeTimer: 0,
      removed: false,
      baseY: pos.y,
    });
  }

  update(dt: number, playerPos: THREE.Vector3, stepHeight: number): number {
    let opened = 0;

    for (const chest of this.chests) {
      if (chest.removed) continue;

      // Animate lid if opening
      if (chest.opened) {
        if (chest.openTimer < 1) {
          chest.openTimer = Math.min(1, chest.openTimer + dt * this.openSpeed);
          const t = 1 - Math.pow(1 - chest.openTimer, 3);
          chest.lidPivot.rotation.x = -t * 1.7;
        } else {
          // Lid fully open — run fade timer
          chest.fadeTimer += dt;

          if (chest.fadeTimer > this.fadeDelay) {
            const fadeProgress = Math.min(1, (chest.fadeTimer - this.fadeDelay) / this.fadeDuration);
            // Sink down + scale down
            chest.group.position.y = chest.baseY - fadeProgress * 0.4;
            chest.group.scale.setScalar(1 - fadeProgress * 0.3);

            // Fade opacity on all child meshes
            chest.group.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                if (!child.material.transparent) {
                  // Clone material for this chest so we don't affect others
                  child.material = child.material.clone();
                  child.material.transparent = true;
                }
                child.material.opacity = 1 - fadeProgress;
              }
            });

            if (fadeProgress >= 1) {
              chest.removed = true;
              chest.entity.destroy();
              this.scene.remove(chest.group);
            }
          }
        }
        continue;
      }

      // Check player proximity (XZ distance) and elevation
      const dx = playerPos.x - chest.group.position.x;
      const dz = playerPos.z - chest.group.position.z;
      const dy = Math.abs(playerPos.y - chest.baseY);
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < this.interactDist && dy <= stepHeight) {
        chest.opened = true;
        chest.openTimer = 0;
        opened++;

        // Spawn loot at chest position
        this.lootSystem.spawnLoot(chest.group.position);
      }
    }

    return opened;
  }

  dispose(): void {
    for (const chest of this.chests) {
      chest.entity.destroy();
      this.scene.remove(chest.group);
    }
    this.chests.length = 0;
    this.bodyGeo.dispose();
    this.lidGeo.dispose();
    this.material.dispose();
  }
}
