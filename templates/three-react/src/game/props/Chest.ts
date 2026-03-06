import * as THREE from 'three';
import type { Environment } from '../environment';
import type { LootSystem } from '../combat/Loot';
import { Entity, Layer, entityRegistry } from '../core/Entity';
import { buildVoxelGeometry } from '../../utils/voxelMesh';
import type { VoxelModel } from '../../types';
import type { SavedChest } from '../dungeon';
import { getChestTier } from '../dungeon';
import type { ChestTier } from '../dungeon';

interface ChestObj {
  group: THREE.Group;
  entity: Entity;
  opened: boolean;
  openTimer: number;
  lidPivot: THREE.Object3D;
  fadeTimer: number; // starts after lid fully open
  removed: boolean;
  baseY: number;
  /** If true, opening this chest spawns a mimic enemy instead of loot */
  isMimic: boolean;
  /** Mimic variant letter (a–h) for enemy selection */
  mimicVariant?: string;
  /** Chest variant ID (e.g. 'chest_d') — determines loot tier and mimic variant */
  variantId?: string;
  /** Prop chest (voxel dungeon): mesh + parent for removal, or openGeo for swap-to-open */
  propRef?: {
    mesh: THREE.Mesh;
    parent: THREE.Object3D;
    openGeo?: THREE.BufferGeometry;
  };
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
  for (let x = 0; x < 4; x++)
    for (let z = 0; z < 3; z++) voxels.set(`${x},0,${z}`, D);
  // Middle layer (y=1) — hollow inside but we keep it solid for voxel look
  for (let x = 0; x < 4; x++)
    for (let z = 0; z < 3; z++) voxels.set(`${x},1,${z}`, L);
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
  for (let x = 0; x < 4; x++)
    for (let z = 0; z < 3; z++) voxels.set(`${x},0,${z}`, D);
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

const VOXEL_SCALE = 0.06;
const MIMIC_CHANCE = 0.1;
const MIMIC_VARIANTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

export type MimicSpawnCallback = (position: THREE.Vector3, variant?: string) => void;

export class ChestSystem {
  private chests: ChestObj[] = [];
  private readonly scene: THREE.Scene;
  private readonly terrain: Environment;
  private readonly lootSystem: LootSystem;
  private readonly count: number;
  private readonly interactDist = 0.7;
  private readonly openSpeed = 3; // 1/seconds to fully open

  private bodyGeo: THREE.BufferGeometry;
  private lidGeo: THREE.BufferGeometry;
  private readonly fadeDelay = 0.8; // seconds after lid opens before fade starts
  private readonly fadeDuration = 0.3; // seconds to fade out
  private material: THREE.MeshStandardMaterial;
  private onMimicSpawn: MimicSpawnCallback | null = null;

  constructor(
    scene: THREE.Scene,
    terrain: Environment,
    lootSystem: LootSystem,
    usePropChestsOnly = false,
    maxFreeChests?: number,
  ) {
    this.scene = scene;
    this.terrain = terrain;
    this.lootSystem = lootSystem;
    this.count = usePropChestsOnly ? 0 : (maxFreeChests ?? 8);

    this.bodyGeo = buildVoxelGeometry(
      buildChestBodyModel(),
      chestPalette,
      VOXEL_SCALE,
    );
    this.lidGeo = buildVoxelGeometry(
      buildChestLidModel(),
      chestPalette,
      VOXEL_SCALE,
    );
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.7,
      metalness: 0.2,
    });

    for (let i = 0; i < this.count; i++) {
      this.spawnChest();
    }
  }

  setMimicSpawnCallback(cb: MimicSpawnCallback): void {
    this.onMimicSpawn = cb;
  }

  /** Register a chest placed by DungeonPropSystem (voxel dungeon). Closed mesh → swap to openGeo on interact, spawn loot. */
  registerPropChest(
    position: THREE.Vector3,
    mesh: THREE.Mesh,
    entity: Entity,
    openGeo?: THREE.BufferGeometry,
    variantId?: string,
  ): void {
    if (!openGeo)
      console.warn(
        '[ChestSystem] Chest missing openGeo (will not show open state) at',
        position.x.toFixed(2),
        position.z.toFixed(2),
      );
    const group = new THREE.Group();
    group.position.copy(position);
    const lidPivot = new THREE.Object3D();
    group.add(lidPivot);
    const parent = mesh.parent;
    if (!parent) return;
    const isMimic = Math.random() < MIMIC_CHANCE;
    // Derive mimic variant from chest variant (chest_d → 'd') instead of random
    const variantLetter = variantId ? variantId.replace('chest_', '') : undefined;
    this.chests.push({
      group,
      entity,
      opened: false,
      openTimer: 0,
      lidPivot,
      fadeTimer: 0,
      removed: false,
      baseY: position.y,
      isMimic,
      mimicVariant: isMimic ? (variantLetter ?? MIMIC_VARIANTS[Math.floor(Math.random() * MIMIC_VARIANTS.length)]) : undefined,
      variantId,
      propRef: { mesh, parent, openGeo },
    });
  }

  private readonly spawnClearance = 1.2;

  private spawnChest(): void {
    let pos: THREE.Vector3 | null = null;
    const checkMask = Layer.Architecture | Layer.Prop | Layer.Collectible;

    for (let attempt = 0; attempt < 30; attempt++) {
      const candidate = this.terrain.getRandomPosition(4, 0.8);
      const nearby = entityRegistry.queryRadius(
        candidate,
        this.spawnClearance,
        checkMask,
      );
      if (nearby.length === 0) {
        pos = candidate;
        break;
      }
    }
    if (!pos) return; // couldn't find a clear spot

    const group = new THREE.Group();
    group.position.set(pos.x, pos.y, pos.z);
    // Random 8-direction rotation (N/NE/E/SE/S/SW/W/NW)
    group.rotation.y = Math.floor(Math.random() * 8) * (Math.PI / 4);

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

    const entity = new Entity(group, { layer: Layer.Prop, radius: 0.25 });

    this.chests.push({
      group,
      entity,
      opened: false,
      openTimer: 0,
      lidPivot,
      fadeTimer: 0,
      removed: false,
      baseY: pos.y,
      isMimic: false, // free chests are never mimics (only dungeon prop chests)
    });
  }

  update(dt: number, playerPos: THREE.Vector3, stepHeight: number): number {
    let opened = 0;

    for (const chest of this.chests) {
      if (chest.removed) continue;

      // Animate lid if opening
      if (chest.opened) {
        // Prop chests (voxel dungeon): geometry swapped on open, just mark done (keep visible)
        if (chest.propRef) {
          chest.removed = true; // no further updates needed, chest stays visible as opened
          continue;
        }

        if (chest.openTimer < 1) {
          // Standard chest: animate lid pivot
          chest.openTimer = Math.min(1, chest.openTimer + dt * this.openSpeed);
          const t = 1 - Math.pow(1 - chest.openTimer, 3);
          chest.lidPivot.rotation.x = -t * 1.7;
        } else {
          // Lid fully open — run fade timer
          chest.fadeTimer += dt;

          if (chest.fadeTimer > this.fadeDelay) {
            const fadeProgress = Math.min(
              1,
              (chest.fadeTimer - this.fadeDelay) / this.fadeDuration,
            );
            // Sink down + scale down
            chest.group.position.y = chest.baseY - fadeProgress * 0.4;
            chest.group.scale.setScalar(1 - fadeProgress * 0.3);

            // Fade opacity on all child meshes
            chest.group.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                if (!child.material.transparent) {
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
      const chestPos = chest.propRef
        ? chest.propRef.mesh.position
        : chest.group.position;
      const dx = playerPos.x - chestPos.x;
      const dz = playerPos.z - chestPos.z;
      const dy = Math.abs(playerPos.y - chest.baseY);
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < this.interactDist && dy <= stepHeight) {
        chest.opened = true;
        chest.openTimer = 0;
        opened++;

        if (chest.isMimic && this.onMimicSpawn) {
          // Mimic chest: remove chest + collider first, then spawn enemy at that position
          const mimicPos = chest.propRef
            ? chest.propRef.mesh.position.clone()
            : chest.group.position.clone();

          // Remove chest and its collider/nav-block BEFORE spawning so terrain Y is correct
          chest.removed = true;
          chest.entity.destroy();
          if (chest.propRef) {
            const { mesh, parent } = chest.propRef;
            this.terrain.unblockPropAt(mesh.position.x, mesh.position.z);
            parent.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
          } else {
            this.scene.remove(chest.group);
          }

          // Now spawn mimic at the cleared position
          this.onMimicSpawn(mimicPos, chest.mimicVariant);
        } else {
          // Normal chest: spawn loot with tier based on chest variant
          const lootPos = chest.propRef
            ? chest.propRef.mesh.position.clone()
            : chest.group.position;
          const tier: ChestTier = chest.variantId ? getChestTier(chest.variantId) : 'common';
          this.lootSystem.spawnLoot(lootPos, tier);

          // Prop chest (voxel dungeon): swap to open geometry immediately
          if (chest.propRef) {
            const { mesh, openGeo } = chest.propRef;
            if (openGeo) {
              if (mesh.geometry) mesh.geometry.dispose();
              mesh.geometry = openGeo;
            } else {
              // Fallback: darken the chest to indicate it's opened
              const mat = mesh.material as THREE.MeshStandardMaterial;
              mat.emissive.setHex(0x000000);
              mat.emissiveIntensity = 0;
              mat.color.multiplyScalar(0.5);
            }
          }
        }
      }
    }

    return opened;
  }

  /** All active chest groups (for room visibility). */
  getGroups(): THREE.Group[] {
    return this.chests.filter((c) => !c.removed).map((c) => c.group);
  }

  /** Serialize chest state for level persistence */
  serialize(): SavedChest[] {
    return this.chests.map((c) => {
      const pos = c.propRef ? c.propRef.mesh.position : c.group.position;
      return {
        x: pos.x,
        z: pos.z,
        opened: c.opened || c.removed,
      };
    });
  }

  /** Mark chests as opened based on saved state (call after chests are created) */
  restoreState(saved: SavedChest[]): void {
    for (const s of saved) {
      if (!s.opened) continue;
      // Find closest matching chest
      let bestDist = Infinity;
      let bestChest: ChestObj | null = null;
      for (const c of this.chests) {
        if (c.opened || c.removed) continue;
        const pos = c.propRef ? c.propRef.mesh.position : c.group.position;
        const dx = pos.x - s.x;
        const dz = pos.z - s.z;
        const dist = dx * dx + dz * dz;
        if (dist < bestDist) {
          bestDist = dist;
          bestChest = c;
        }
      }
      if (bestChest && bestDist < 1) {
        bestChest.opened = true;
        bestChest.removed = true;
        bestChest.entity.destroy();
        if (bestChest.propRef?.openGeo) {
          const { mesh, openGeo } = bestChest.propRef;
          if (mesh.geometry) mesh.geometry.dispose();
          mesh.geometry = openGeo;
        } else {
          this.scene.remove(bestChest.group);
        }
      }
    }
  }

  dispose(): void {
    for (const chest of this.chests) {
      if (!chest.removed) {
        chest.entity.destroy();
        this.scene.remove(chest.group);
      }
    }
    this.chests.length = 0;
    this.bodyGeo.dispose();
    this.lidGeo.dispose();
    this.material.dispose();
  }
}
