// ── Dungeon Props ──────────────────────────────────────────────────
// Places VOX prop meshes inside dungeon rooms using the VoxDungeonDB registry.

import * as THREE from 'three';
import { loadVoxModel, buildVoxMesh } from '../utils/VoxModelLoader';
import { Entity, Layer } from './Entity';
import type { DungeonPropEntry, PropPlacement } from './VoxDungeonDB';
import { getRandomProp, getPropsWhere } from './VoxDungeonDB';

// ── Geometry cache ──

const geoCache = new Map<string, THREE.BufferGeometry>();

/** For scalesWithDungeon props: targetHeight = baseHeight × tileSize.
 *  baseHeight is in "per-tile" units — e.g. 0.3 means 30% of one tile tall. */

/** Load (and cache) a prop geometry.
 *  @param heightOverride — if set, use this as targetHeight instead of baseHeight×scale.
 *    Used to make open/closed chest variants share the same voxel scale. */
async function loadPropGeo(entry: DungeonPropEntry, tileSize: number, useClosed = false, heightOverride?: number): Promise<THREE.BufferGeometry | null> {
  const scale = entry.scalesWithDungeon ? tileSize : 1;
  const path = useClosed && entry.voxPathClosed ? entry.voxPathClosed : entry.voxPath;
  const targetHeight = heightOverride ?? entry.baseHeight * scale;
  const key = `${entry.id}:${targetHeight.toFixed(4)}:${useClosed ? 'closed' : 'open'}`;
  if (geoCache.has(key)) return geoCache.get(key)!;
  try {
    const { model, palette } = await loadVoxModel(path);
    const geo = buildVoxMesh(model, palette, targetHeight);
    geoCache.set(key, geo);
    return geo;
  } catch (err) {
    if (useClosed && entry.voxPathClosed) {
      console.warn(`[DungeonProps] Closed variant not found, using open for ${entry.id}:`, err);
      return loadPropGeo(entry, tileSize, false);
    }
    console.warn(`[DungeonProps] Failed to load ${entry.id}:`, err);
    return null;
  }
}

/** For entries with voxPathClosed, compute the closed model's voxel scale
 *  so the open variant can use the same per-voxel size. */
async function getClosedVoxelScale(entry: DungeonPropEntry, tileSize: number): Promise<number | null> {
  if (!entry.voxPathClosed) return null;
  try {
    const { model } = await loadVoxModel(entry.voxPathClosed);
    const closedVoxelHeight = model.size.z; // VOX Z = Three.js Y (height)
    const scale = entry.scalesWithDungeon ? tileSize : 1;
    const targetHeight = entry.baseHeight * scale;
    return targetHeight / closedVoxelHeight; // per-voxel scale
  } catch {
    return null;
  }
}

// ── Room templates ──
// Each template defines which prop categories to place in a room.

/** weight = relative probability of being picked (higher = more common) */
interface RoomTemplate {
  name: string;
  props: { category: string; count: number }[];
  minSize: number;
  weight: number;
}

const ROOM_TEMPLATES: RoomTemplate[] = [
  // ── Library ──
  { name: 'library', minSize: 4, weight: 3, props: [
    { category: 'bookcase_large', count: 6 },
    { category: 'bookcase_small', count: 4 },
    { category: 'table_small', count: 1 },
    { category: 'candelabrum_small', count: 2 },
    { category: 'torch_wall', count: 3 },
    { category: 'book', count: 4 },
    { category: 'chest', count: 1 },
  ]},
  // ── Study ──  (small library variant)
  { name: 'study', minSize: 3, weight: 2, props: [
    { category: 'bookcase_small', count: 3 },
    { category: 'bookcase_large', count: 2 },
    { category: 'table_small', count: 1 },
    { category: 'chair', count: 2 },
    { category: 'candelabrum_small', count: 1 },
    { category: 'torch_wall', count: 2 },
    { category: 'book', count: 3 },
  ]},
  // ── Barracks ──
  { name: 'barracks', minSize: 4, weight: 3, props: [
    { category: 'bench', count: 3 },
    { category: 'barrel', count: 2 },
    { category: 'bookcase_small', count: 1 },
    { category: 'torch_wall', count: 3 },
    { category: 'banner', count: 3 },
    { category: 'chest', count: 1 },
  ]},
  // ── Crypt ──
  { name: 'crypt', minSize: 4, weight: 2, props: [
    { category: 'tomb', count: 4 },
    { category: 'candelabrum', count: 3 },
    { category: 'torch_wall', count: 3 },
    { category: 'banner', count: 2 },
    { category: 'pot', count: 2 },
    { category: 'bookcase_small', count: 1 },
  ]},
  // ── Jail ──
  { name: 'jail', minSize: 3, weight: 2, props: [
    { category: 'wall_grate', count: 4 },
    { category: 'bench', count: 2 },
    { category: 'pot', count: 2 },
    { category: 'torch_wall', count: 3 },
    { category: 'barrel', count: 1 },
    { category: 'bookcase_small', count: 1 },
  ]},
  // ── Treasure Room ──
  { name: 'treasure', minSize: 3, weight: 1, props: [
    { category: 'chest', count: 4 },
    { category: 'candelabrum', count: 3 },
    { category: 'torch_wall', count: 3 },
    { category: 'banner', count: 2 },
    { category: 'potion', count: 2 },
    { category: 'bookcase_small', count: 1 },
  ]},
  // ── Bar / Tavern ──
  { name: 'bar', minSize: 4, weight: 2, props: [
    { category: 'table_large', count: 1 },
    { category: 'table_small', count: 1 },
    { category: 'chair', count: 4 },
    { category: 'mug', count: 3 },
    { category: 'barrel', count: 3 },
    { category: 'bottle', count: 3 },
    { category: 'torch_wall', count: 3 },
    { category: 'banner', count: 2 },
  ]},
  // ── Chapel ──
  { name: 'chapel', minSize: 4, weight: 2, props: [
    { category: 'altar', count: 1 },
    { category: 'candelabrum', count: 3 },
    { category: 'banner', count: 4 },
    { category: 'bench', count: 3 },
    { category: 'torch_wall', count: 3 },
    { category: 'bookcase_small', count: 1 },
  ]},
  // ── Storage ──
  { name: 'storage', minSize: 3, weight: 4, props: [
    { category: 'barrel', count: 3 },
    { category: 'box', count: 3 },
    { category: 'pot', count: 2 },
    { category: 'torch_wall', count: 2 },
    { category: 'chest', count: 1 },
    { category: 'bookcase_small', count: 1 },
  ]},
  // ── Armory ──
  { name: 'armory', minSize: 3, weight: 2, props: [
    { category: 'barrel', count: 2 },
    { category: 'box', count: 3 },
    { category: 'bench', count: 2 },
    { category: 'banner', count: 3 },
    { category: 'torch_wall', count: 3 },
    { category: 'chest', count: 1 },
    { category: 'bookcase_small', count: 1 },
  ]},
  // ── Alchemy Lab ──
  { name: 'alchemy', minSize: 3, weight: 2, props: [
    { category: 'table_small', count: 1 },
    { category: 'potion', count: 4 },
    { category: 'bottle', count: 3 },
    { category: 'candelabrum_small', count: 2 },
    { category: 'bookcase_small', count: 3 },
    { category: 'bookcase_large', count: 1 },
    { category: 'torch_wall', count: 2 },
  ]},
  // ── Dining Hall ──
  { name: 'dining', minSize: 4, weight: 2, props: [
    { category: 'table_large', count: 1 },
    { category: 'table_small', count: 1 },
    { category: 'chair', count: 5 },
    { category: 'mug', count: 4 },
    { category: 'candelabrum_small', count: 2 },
    { category: 'barrel', count: 2 },
    { category: 'torch_wall', count: 3 },
    { category: 'banner', count: 2 },
    { category: 'bookcase_small', count: 1 },
  ]},
  // ── Shrine ──
  { name: 'shrine', minSize: 3, weight: 2, props: [
    { category: 'altar', count: 1 },
    { category: 'candelabrum', count: 3 },
    { category: 'banner', count: 4 },
    { category: 'torch_wall', count: 3 },
    { category: 'potion', count: 2 },
    { category: 'bookcase_small', count: 1 },
  ]},
  // ── Trap Room ──
  { name: 'trap', minSize: 3, weight: 1, props: [
    { category: 'trap_spike', count: 3 },
    { category: 'pot', count: 3 },
    { category: 'torch_wall', count: 3 },
    { category: 'chest', count: 1 },
    { category: 'bookcase_small', count: 1 },
  ]},
  // ── Guard Post ──
  { name: 'guard', minSize: 3, weight: 3, props: [
    { category: 'bench', count: 2 },
    { category: 'barrel', count: 2 },
    { category: 'torch_wall', count: 3 },
    { category: 'banner', count: 3 },
    { category: 'chest', count: 1 },
    { category: 'bookcase_small', count: 1 },
  ]},
  // ── Cellar ──
  { name: 'cellar', minSize: 3, weight: 3, props: [
    { category: 'barrel', count: 4 },
    { category: 'box', count: 2 },
    { category: 'pot', count: 3 },
    { category: 'torch_wall', count: 2 },
    { category: 'bottle', count: 2 },
    { category: 'bookcase_small', count: 1 },
  ]},
  // ── Torch Gallery ── (corridors / connector rooms)
  { name: 'gallery', minSize: 3, weight: 2, props: [
    { category: 'torch_wall', count: 4 },
    { category: 'banner', count: 3 },
    { category: 'signpost', count: 1 },
    { category: 'bookcase_small', count: 1 },
  ]},
  // ── Abandoned ── (sparse, atmospheric)
  { name: 'abandoned', minSize: 3, weight: 2, props: [
    { category: 'pot', count: 2 },
    { category: 'box', count: 2 },
    { category: 'torch_wall', count: 2 },
    { category: 'book', count: 2 },
    { category: 'bottle', count: 2 },
    { category: 'bookcase_small', count: 1 },
  ]},
  // ── Tomb Vault ── (large crypt)
  { name: 'tomb_vault', minSize: 5, weight: 1, props: [
    { category: 'tomb', count: 5 },
    { category: 'candelabrum', count: 3 },
    { category: 'torch_wall', count: 4 },
    { category: 'banner', count: 3 },
    { category: 'chest', count: 1 },
    { category: 'bookcase_large', count: 2 },
  ]},
  // ── Kitchen ──
  { name: 'kitchen', minSize: 3, weight: 2, props: [
    { category: 'table_small', count: 1 },
    { category: 'barrel', count: 2 },
    { category: 'pot', count: 3 },
    { category: 'torch_wall', count: 2 },
    { category: 'mug', count: 2 },
    { category: 'bottle', count: 2 },
    { category: 'bookcase_small', count: 1 },
  ]},
  // ── Trophy Room ──
  { name: 'trophy', minSize: 4, weight: 1, props: [
    { category: 'banner', count: 5 },
    { category: 'candelabrum', count: 3 },
    { category: 'torch_wall', count: 3 },
    { category: 'table_small', count: 1 },
    { category: 'chest', count: 1 },
    { category: 'bookcase_large', count: 1 },
  ]},
];

// ── Surface / small-item categories ──
// Surfaces: furniture that small items can be placed on top of.
// surfaceHeight = how high above floorY the top surface sits (in meters, unscaled).
const SURFACE_CATEGORIES: Record<string, number> = {
  'table_small': 0.18,
  'table_large': 0.20,
  'bookcase_small': 0.55,
  'bookcase_large': 0.85,
  'bench': 0.14,
  'altar': 0.6,
  'tomb': 0.25,
  'barrel': 0.22,
  'box': 0.18,
  'pot': 0.16,
};

// Small items that prefer being placed on surfaces rather than the floor.
const SMALL_ITEM_CATEGORIES = new Set([
  'book', 'mug', 'bottle', 'potion', 'candelabrum_small',
]);

// ── Wall direction lookups (no trig, unambiguous) ──

/** Rotation to face INTO the room from each wall side.
 *  In Three.js rotation.y: 0 = face -Z, PI/2 = face -X, PI = face +Z, -PI/2 = face +X */
const WALL_ROT: Record<string, number> = {
  'N': Math.PI,       // on north wall → face south (into room)
  'S': 0,             // on south wall → face north (into room)
  'W': -Math.PI / 2,  // on west wall → face east (into room)
  'E': Math.PI / 2,   // on east wall → face west (into room)
};

/** Unit vector pointing TOWARD the wall (for push/nudge offsets).
 *  N=low gz=-Z, S=high gz=+Z, W=low gx=-X, E=high gx=+X */
const WALL_PUSH: Record<string, [number, number]> = {
  'N': [0, -1],
  'S': [0, 1],
  'W': [-1, 0],
  'E': [1, 0],
};

// ── Room label sprite ──

function createRoomLabel(text: string, x: number, y: number, z: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = 256;
  canvas.height = 64;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.roundRect(4, 4, 248, 56, 8);
  ctx.fill();
  ctx.font = 'bold 28px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text.toUpperCase(), 128, 34);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(x, y, z);
  sprite.scale.set(2, 0.5, 1);
  return sprite;
}

// ── Placement ──

interface RoomRect {
  x: number; z: number; w: number; d: number;
}

interface PlacedProp {
  mesh: THREE.Mesh;
  entity: Entity;
  entry: DungeonPropEntry;
  /** Dungeon grid cell (gx, gz) where this prop is placed — used to mark nav cells unwalkable */
  gridCell: { gx: number; gz: number };
  /** For chests: open-state geometry to swap when player opens */
  openGeo?: THREE.BufferGeometry;
}

export class DungeonPropSystem {
  private props: PlacedProp[] = [];
  private labels: THREE.Sprite[] = [];
  private readonly parent: THREE.Object3D;
  private cellSize = 0.75;

  constructor(parent: THREE.Object3D) {
    this.parent = parent;
  }

  async populate(
    rooms: RoomRect[],
    cellSize: number,
    groundSize: number,
    openGrid: boolean[],
    gridW: number,
    gridDoors?: { x: number; z: number; orientation: 'NS' | 'EW' }[],
    wallHeight = 2.5,
    showRoomLabels = true,
  ): Promise<void> {
    this.cellSize = cellSize;
    const halfWorld = groundSize / 2;
    const floorY = cellSize / 15; // VOX ground tile thickness
    const toWorldX = (gx: number) => -halfWorld + (gx + 0.5) * cellSize;
    const toWorldZ = (gz: number) => -halfWorld + (gz + 0.5) * cellSize;

    const voxMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.75,
      metalness: 0.1,
    });

    // Block door cells + immediate neighbors so props never block entrances.
    const occupied = new Set<string>();
    if (gridDoors) {
      const DOOR_BUFFER = 1;
      for (const door of gridDoors) {
        const gx = Math.round(door.x);
        const gz = Math.round(door.z);
        for (let dz = -DOOR_BUFFER; dz <= DOOR_BUFFER; dz++) {
          for (let dx = -DOOR_BUFFER; dx <= DOOR_BUFFER; dx++) {
            occupied.add(`${gx + dx},${gz + dz}`);
          }
        }
      }
    }

    // Also block room edge cells that face a corridor opening (+ 1 cell inward)
    const gridH = Math.floor(groundSize / cellSize);
    for (const room of rooms) {
      for (let gx = room.x; gx < room.x + room.w; gx++) {
        // Top edge → corridor above
        if (room.z > 0 && openGrid[(room.z - 1) * gridW + gx]) {
          occupied.add(`${gx},${room.z}`);
          if (room.d > 2) occupied.add(`${gx},${room.z + 1}`);
        }
        // Bottom edge → corridor below
        const bz = room.z + room.d - 1;
        if (bz + 1 < gridH && openGrid[(bz + 1) * gridW + gx]) {
          occupied.add(`${gx},${bz}`);
          if (room.d > 2) occupied.add(`${gx},${bz - 1}`);
        }
      }
      for (let gz = room.z; gz < room.z + room.d; gz++) {
        // Left edge → corridor to left
        if (room.x > 0 && openGrid[gz * gridW + room.x - 1]) {
          occupied.add(`${room.x},${gz}`);
          if (room.w > 2) occupied.add(`${room.x + 1},${gz}`);
        }
        // Right edge → corridor to right
        const rx = room.x + room.w - 1;
        if (rx + 1 < gridW && openGrid[gz * gridW + rx + 1]) {
          occupied.add(`${rx},${gz}`);
          if (room.w > 2) occupied.add(`${rx - 1},${gz}`);
        }
      }
    }

    // testProp override: read from store
    const testProp = (await import('../store')).useGameStore.getState().testProp;

    for (const room of rooms) {
      let propList: { category: string; count: number }[];

      if (testProp) {
        // Test mode: fill every room with this category (one per open cell, capped)
        const area = room.w * room.d;
        propList = [{ category: testProp, count: Math.min(area, 20) }];
      } else {
        // Weighted random template selection
        const minDim = Math.min(room.w, room.d);
        const eligible = ROOM_TEMPLATES.filter(t => t.minSize <= minDim);
        if (eligible.length === 0) continue;
        // ~5% chance to leave a room empty (atmospheric)
        if (Math.random() < 0.05) continue;
        // Weighted pick
        const totalWeight = eligible.reduce((s, t) => s + t.weight, 0);
        let roll = Math.random() * totalWeight;
        let template = eligible[0];
        for (const t of eligible) {
          roll -= t.weight;
          if (roll <= 0) { template = t; break; }
        }
        // Place room label at center
        const centerWx = toWorldX(room.x + (room.w - 1) / 2);
        const centerWz = toWorldZ(room.z + (room.d - 1) / 2);
        const label = createRoomLabel(template.name, centerWx, wallHeight - 1, centerWz);
        label.visible = showRoomLabels;
        this.parent.add(label);
        this.labels.push(label);

        // Start with template props, then sprinkle 1-3 random extras for variety
        propList = [...template.props];
        const extraRolls = Math.random() < 0.3 ? 3 : Math.random() < 0.6 ? 2 : 1;
        const extras = ['pot', 'bottle', 'book', 'mug', 'potion', 'torch_wall', 'banner', 'bookcase_small', 'bookcase_small'];
        for (let e = 0; e < extraRolls; e++) {
          propList.push({ category: extras[Math.floor(Math.random() * extras.length)], count: 1 });
        }
      }

      // Split props into 3 groups: chairs, small items, everything else
      const smallItems: { category: string; count: number }[] = [];
      const chairItems: { category: string; count: number }[] = [];
      const largeItems: { category: string; count: number }[] = [];
      for (const item of propList) {
        if (SMALL_ITEM_CATEGORIES.has(item.category)) {
          smallItems.push(item);
        } else if (item.category === 'chair' || item.category === 'bench') {
          chairItems.push(item);
        } else {
          largeItems.push(item);
        }
      }

      // Track placed surfaces in this room for small item placement
      interface SurfaceSlot { wx: number; wz: number; surfaceY: number; used: number; maxItems: number; rotation: number }
      const surfaces: SurfaceSlot[] = [];

      // Track placed tables for chair placement
      interface TableSlot { wx: number; wz: number; seatsUsed: number; maxSeats: number; isLarge: boolean }
      const tables: TableSlot[] = [];

      // ── Pass 1: place furniture and large items ──
      for (const { category, count } of largeItems) {
        for (let i = 0; i < count; i++) {
          const entry = getRandomProp(category);
          if (!entry) continue;

          // ── Wall-mounted props (banners, wall torches) ──
          if (entry.placement === 'wall_mount') {
            const cell = this.findCell(entry, room, occupied, openGrid, gridW);
            if (!cell) continue;
            occupied.add(`${cell.gx},${cell.gz}`);

            const geo = await loadPropGeo(entry, cellSize);
            if (!geo) continue;

            const mesh = new THREE.Mesh(geo, voxMat.clone());
            const wx = toWorldX(cell.gx);
            const wz = toWorldZ(cell.gz);
            const faceRot = cell.wallSide ? WALL_ROT[cell.wallSide] : 0;
            mesh.rotation.y = faceRot;

            // Push to the wall face using direct wallSide lookup (no trig)
            const push = cell.wallSide ? WALL_PUSH[cell.wallSide] : [0, 0] as [number, number];
            mesh.position.set(
              wx + push[0] * cellSize * 0.5,
              (entry.mountHeight ?? 0.5) * wallHeight - cellSize,
              wz + push[1] * cellSize * 0.5,
            );

            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.parent.add(mesh);

            // No entity/collision — wall mounts are decorative
            const dummyEntity = new Entity(mesh, { layer: Layer.Prop, radius: 0.01, weight: 0 });
            this.props.push({ mesh, entity: dummyEntity, entry, gridCell: { gx: cell.gx, gz: cell.gz } });
            continue;
          }

          // ── Regular floor props ──
          const cell = this.findCell(entry, room, occupied, openGrid, gridW);
          if (!cell) continue;

          occupied.add(`${cell.gx},${cell.gz}`);

          // Chests: place closed mesh, keep open geometry for swap on interact.
          // Both variants use the closed model's voxel scale so they match in size.
          const isChest = entry.category === 'chest';
          const geo = await loadPropGeo(entry, cellSize, isChest);
          if (!geo) continue;

          let openGeo: THREE.BufferGeometry | undefined;
          if (isChest && entry.voxPathClosed) {
            const voxScale = await getClosedVoxelScale(entry, cellSize);
            if (voxScale) {
              // Load open model using closed model's voxel scale
              const { model: openModel } = await loadVoxModel(entry.voxPath);
              const openTargetHeight = openModel.size.z * voxScale; // same per-voxel scale
              openGeo = await loadPropGeo(entry, cellSize, false, openTargetHeight) ?? undefined;
            } else {
              openGeo = await loadPropGeo(entry, cellSize, false) ?? undefined;
            }
          }

          const mesh = new THREE.Mesh(geo, voxMat.clone());
          const wx = toWorldX(cell.gx);
          const wz = toWorldZ(cell.gz);
          mesh.position.set(wx, floorY, wz);

          // Rotation — use stored wallSide from findCell for deterministic wall-facing
          // Push wall-aligned props toward the wall within their cell (stay inside cell bounds)
          if ((entry.wallAligned || entry.placement === 'corner' || entry.placement === 'wall') && cell.wallSide) {
            mesh.rotation.y = WALL_ROT[cell.wallSide];
            const push = WALL_PUSH[cell.wallSide];
            mesh.position.x += push[0] * cellSize * 0.35;
            mesh.position.z += push[1] * cellSize * 0.35;
          } else {
            mesh.rotation.y = (Math.floor(Math.random() * 4)) * Math.PI / 2;
          }

          mesh.castShadow = true;
          mesh.receiveShadow = true;
          if (isChest) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            mat.emissive.setHex(0x330808);
            mat.emissiveIntensity = 0.4;
          }
          this.parent.add(mesh);

          const propScale = entry.scalesWithDungeon ? cellSize : 1;
          const entity = new Entity(mesh, {
            layer: Layer.Prop,
            radius: entry.radius * propScale,
            weight: entry.destroyable ? 3 : 5,
          });

          this.props.push({ mesh, entity, entry, gridCell: { gx: cell.gx, gz: cell.gz }, openGeo });

          // Track as surface for small item placement
          const surfaceH = SURFACE_CATEGORIES[entry.category];
          if (surfaceH !== undefined) {
            const surfScale = entry.scalesWithDungeon ? cellSize : 1;
            surfaces.push({
              wx: mesh.position.x,
              wz: mesh.position.z,
              surfaceY: floorY + surfaceH * surfScale,
              used: 0,
              maxItems: entry.category.includes('large') ? 3
                : (entry.category === 'barrel' || entry.category === 'box' || entry.category === 'pot') ? 1
                : 2,
              rotation: mesh.rotation.y,
            });
          }

          // Track tables for chair placement
          if (entry.category === 'table_small' || entry.category === 'table_large') {
            tables.push({
              wx: mesh.position.x,
              wz: mesh.position.z,
              seatsUsed: 0,
              maxSeats: entry.category === 'table_large' ? 4 : 2,
              isLarge: entry.category === 'table_large',
            });
          }
        }
      }

      // ── Pass 2: place chairs around tables (or against walls) ──
      for (const { category, count } of chairItems) {
        for (let i = 0; i < count; i++) {
          const entry = getRandomProp(category);
          if (!entry) continue;

          const geo = await loadPropGeo(entry, cellSize);
          if (!geo) continue;

          // Try to seat around a table
          const availableTables = tables.filter(t => t.seatsUsed < t.maxSeats);
          if (availableTables.length > 0) {
            const table = availableTables[Math.floor(Math.random() * availableTables.length)];
            const seatIdx = table.seatsUsed;
            table.seatsUsed++;

            // Place at cardinal offsets around table, facing inward
            const dist = table.isLarge ? 0.45 : 0.35;
            const SEAT_OFFSETS: [number, number, number][] = [
              [0, -dist, Math.PI],       // north side (low Z), face south
              [0, dist, 0],              // south side (high Z), face north
              [-dist, 0, Math.PI / 2],   // west side, face east
              [dist, 0, -Math.PI / 2],   // east side, face west
            ];
            const [ox, oz, rot] = SEAT_OFFSETS[seatIdx % 4];

            const mesh = new THREE.Mesh(geo, voxMat.clone());
            mesh.position.set(table.wx + ox, floorY, table.wz + oz);
            mesh.rotation.y = rot;
            mesh.castShadow = true;
            this.parent.add(mesh);

            const dummyEntity = new Entity(mesh, { layer: Layer.Prop, radius: 0.01, weight: 0 });
            this.props.push({ mesh, entity: dummyEntity, entry, gridCell: { gx: 0, gz: 0 } });
          } else {
            // No table — place against wall
            const cell = this.findCell(
              { ...entry, placement: 'wall' } as any,
              room, occupied, openGrid, gridW,
            );
            if (!cell) continue;
            occupied.add(`${cell.gx},${cell.gz}`);

            const mesh = new THREE.Mesh(geo, voxMat.clone());
            mesh.position.set(toWorldX(cell.gx), floorY, toWorldZ(cell.gz));
            if (cell.wallSide) {
              mesh.rotation.y = WALL_ROT[cell.wallSide];
              const push = WALL_PUSH[cell.wallSide];
              mesh.position.x += push[0] * cellSize * 0.15;
              mesh.position.z += push[1] * cellSize * 0.15;
            }
            mesh.castShadow = true;
            this.parent.add(mesh);

            const entity = new Entity(mesh, { layer: Layer.Prop, radius: entry.radius, weight: 3 });
            this.props.push({ mesh, entity, entry, gridCell: { gx: cell.gx, gz: cell.gz } });
          }
        }
      }

      // ── Pass 3: place small items on surfaces ──
      for (const { category, count } of smallItems) {
        for (let i = 0; i < count; i++) {
          const entry = getRandomProp(category);
          if (!entry) continue;

          // Try to find an available surface
          const available = surfaces.filter(s => s.used < s.maxItems);
          if (available.length > 0) {
            const surface = available[Math.floor(Math.random() * available.length)];
            surface.used++;

            const geo = await loadPropGeo(entry, cellSize);
            if (!geo) continue;

            const mesh = new THREE.Mesh(geo, voxMat.clone());
            // Use deterministic slot positions so items never overlap
            // Single-item surfaces (altars etc.) get centered placement
            const SURFACE_SLOTS: [number, number][] = [
              [-0.1, 0], [0.1, 0], [0, -0.1],
            ];
            const slot: [number, number] = surface.maxItems === 1
              ? [0, 0]
              : SURFACE_SLOTS[(surface.used - 1) % SURFACE_SLOTS.length];
            mesh.position.set(
              surface.wx + slot[0],
              surface.surfaceY,
              surface.wz + slot[1],
            );
            mesh.rotation.y = Math.random() * Math.PI * 2;
            mesh.castShadow = true;
            this.parent.add(mesh);

            // Small items are decorative — no collision entity
            const dummyEntity = new Entity(mesh, { layer: Layer.Prop, radius: 0.01, weight: 0 });
            this.props.push({ mesh, entity: dummyEntity, entry, gridCell: { gx: 0, gz: 0 } });
          } else {
            // No surfaces available — place on floor as fallback
            const cell = this.findCell(entry, room, occupied, openGrid, gridW);
            if (!cell) continue;

            const geo = await loadPropGeo(entry, cellSize);
            if (!geo) continue;

            const mesh = new THREE.Mesh(geo, voxMat.clone());
            mesh.position.set(toWorldX(cell.gx), floorY, toWorldZ(cell.gz));
            mesh.rotation.y = Math.random() * Math.PI * 2;
            mesh.castShadow = true;
            this.parent.add(mesh);

            const dummyEntity = new Entity(mesh, { layer: Layer.Prop, radius: 0.01, weight: 0 });
            this.props.push({ mesh, entity: dummyEntity, entry, gridCell: { gx: cell.gx, gz: cell.gz } });
          }
        }
      }
    }

    // ── Room connectivity validation ──
    // Ensure every room is traversable between all its entrances.
    // If props block connectivity, remove the closest blocker and re-check.
    const inRoom = new Set<string>();
    for (const room of rooms) {
      for (let gz = room.z; gz < room.z + room.d; gz++) {
        for (let gx = room.x; gx < room.x + room.w; gx++) {
          inRoom.add(`${gx},${gz}`);
        }
      }
    }

    for (const room of rooms) {
      // Find entrance cells: room edge cells adjacent to an open cell outside the room
      const entrances: { gx: number; gz: number }[] = [];
      for (let gx = room.x; gx < room.x + room.w; gx++) {
        if (room.z > 0 && openGrid[(room.z - 1) * gridW + gx])
          entrances.push({ gx, gz: room.z });
        const bz = room.z + room.d - 1;
        if (bz + 1 < gridH && openGrid[(bz + 1) * gridW + gx])
          entrances.push({ gx, gz: bz });
      }
      for (let gz = room.z; gz < room.z + room.d; gz++) {
        if (room.x > 0 && openGrid[gz * gridW + room.x - 1])
          entrances.push({ gx: room.x, gz });
        const rx = room.x + room.w - 1;
        if (rx + 1 < gridW && openGrid[gz * gridW + rx + 1])
          entrances.push({ gx: rx, gz });
      }

      if (entrances.length < 2) continue; // nothing to connect

      // Collect floor props in this room (wall_mount don't block)
      const roomProps = this.props.filter(p =>
        p.entry.placement !== 'wall_mount' &&
        p.gridCell.gx >= room.x && p.gridCell.gx < room.x + room.w &&
        p.gridCell.gz >= room.z && p.gridCell.gz < room.z + room.d
      );

      const validate = (): { gx: number; gz: number }[] => {
        // Build blocked set from current room props
        const blocked = new Set<string>();
        for (const p of roomProps) {
          if (this.props.includes(p)) blocked.add(`${p.gridCell.gx},${p.gridCell.gz}`);
        }

        // Flood fill from first entrance
        const start = entrances[0];
        const visited = new Set<string>();
        const queue = [`${start.gx},${start.gz}`];
        visited.add(queue[0]);
        while (queue.length > 0) {
          const key = queue.shift()!;
          const [cx, cz] = key.split(',').map(Number);
          for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx < room.x || nx >= room.x + room.w || nz < room.z || nz >= room.z + room.d) continue;
            const nk = `${nx},${nz}`;
            if (visited.has(nk) || blocked.has(nk)) continue;
            if (!openGrid[nz * gridW + nx]) continue;
            visited.add(nk);
            queue.push(nk);
          }
        }

        // Return unreachable entrances
        return entrances.filter(e => !visited.has(`${e.gx},${e.gz}`));
      };

      // Iteratively remove blocking props until all entrances are connected
      let unreachable = validate();
      let safety = 20;
      while (unreachable.length > 0 && safety-- > 0) {
        // Find the room prop closest to any unreachable entrance
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = roomProps.length - 1; i >= 0; i--) {
          const p = roomProps[i];
          if (!this.props.includes(p)) continue;
          for (const e of unreachable) {
            const dist = Math.abs(p.gridCell.gx - e.gx) + Math.abs(p.gridCell.gz - e.gz);
            if (dist < bestDist) { bestDist = dist; bestIdx = i; }
          }
        }
        if (bestIdx < 0) break;

        // Remove that prop
        const removed = roomProps[bestIdx];
        occupied.delete(`${removed.gridCell.gx},${removed.gridCell.gz}`);
        removed.entity.destroy();
        this.parent.remove(removed.mesh);
        const mainIdx = this.props.indexOf(removed);
        if (mainIdx >= 0) this.props.splice(mainIdx, 1);

        unreachable = validate();
      }
    }

    // ── Corridor wall props (torches & banners) ──
    // Find open cells not inside any room, adjacent to a wall

    const corridorWallCells: { gx: number; gz: number; wallSide: 'N' | 'S' | 'E' | 'W' }[] = [];
    for (let gz = 0; gz < gridH; gz++) {
      for (let gx = 0; gx < gridW; gx++) {
        if (!openGrid[gz * gridW + gx]) continue;
        if (inRoom.has(`${gx},${gz}`)) continue;
        if (occupied.has(`${gx},${gz}`)) continue;
        // Check each cardinal neighbor for a wall
        const dirs: ['N' | 'S' | 'E' | 'W', number, number][] = [
          ['N', 0, -1], ['S', 0, 1], ['W', -1, 0], ['E', 1, 0],
        ];
        for (const [side, dx, dz] of dirs) {
          const nx = gx + dx;
          const nz = gz + dz;
          if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridH || !openGrid[nz * gridW + nx]) {
            corridorWallCells.push({ gx, gz, wallSide: side });
            break; // one wall prop per cell
          }
        }
      }
    }

    // Place wall torches/banners on ~30% of corridor wall cells
    const corridorWallProps = ['torch_wall', 'torch_wall', 'banner']; // bias toward torches
    for (const cell of corridorWallCells) {
      if (occupied.has(`${cell.gx},${cell.gz}`)) continue;
      if (Math.random() > 0.3) continue;

      const category = corridorWallProps[Math.floor(Math.random() * corridorWallProps.length)];
      const entry = getRandomProp(category);
      if (!entry) continue;

      const geo = await loadPropGeo(entry, cellSize);
      if (!geo) continue;

      occupied.add(`${cell.gx},${cell.gz}`);

      const mesh = new THREE.Mesh(geo, voxMat.clone());
      const wx = toWorldX(cell.gx);
      const wz = toWorldZ(cell.gz);
      const faceRot = WALL_ROT[cell.wallSide];
      mesh.rotation.y = faceRot;

      const push = WALL_PUSH[cell.wallSide];
      mesh.position.set(
        wx + push[0] * cellSize * 0.5,
        (entry.mountHeight ?? 0.5) * wallHeight - cellSize,
        wz + push[1] * cellSize * 0.5,
      );

      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.parent.add(mesh);

      const dummyEntity = new Entity(mesh, { layer: Layer.Prop, radius: 0.01, weight: 0 });
      this.props.push({ mesh, entity: dummyEntity, entry, gridCell: { gx: cell.gx, gz: cell.gz } });
    }

    console.log(`[DungeonProps] Placed ${this.props.length} props in ${rooms.length} rooms + corridors`);
  }

  /** Grid cells (dungeon space gx, gz) that have a floor prop — use to mark those nav cells unwalkable.
   *  Excludes wall_mount props and small decorative items. */
  getPropGridCells(): { gx: number; gz: number }[] {
    return this.props
      .filter(p => p.entry.placement !== 'wall_mount' && !SMALL_ITEM_CATEGORIES.has(p.entry.category))
      .map(p => p.gridCell);
  }

  /** Actual world positions of floor props (accounts for wall push offsets).
   *  Use these for nav cell blocking instead of tile grid coords. */
  getPropWorldPositions(): { x: number; z: number }[] {
    return this.props
      .filter(p => p.entry.placement !== 'wall_mount' && !SMALL_ITEM_CATEGORIES.has(p.entry.category))
      .map(p => ({ x: p.mesh.position.x, z: p.mesh.position.z }));
  }

  /** Get debris boxes for physical collision (keyboard movement).
   *  Excludes wall_mount and small decorative items.
   *  Each prop occupies exactly 1 nav cell — debris box is half-cellSize on each side. */
  getDebrisBoxes(): { x: number; z: number; halfW: number; halfD: number; height: number; exact?: boolean }[] {
    return this.props
      .filter(p => p.entry.placement !== 'wall_mount' && !SMALL_ITEM_CATEGORIES.has(p.entry.category))
      .map(p => {
        const pos = p.mesh.position;
        // Small debris box for physical collision — must not bleed into adjacent nav cells
        // Height must exceed stepHeight (0.8) so characters can't step over props
        const half = 0.1;
        return { x: pos.x, z: pos.z, halfW: half, halfD: half, height: 2.0, exact: true };
      });
  }

  /** Interactive chest props (category 'chest') for registration with ChestSystem in voxel dungeon */
  getInteractiveChests(): { position: THREE.Vector3; mesh: THREE.Mesh; entity: Entity; openGeo?: THREE.BufferGeometry }[] {
    const out: { position: THREE.Vector3; mesh: THREE.Mesh; entity: Entity; openGeo?: THREE.BufferGeometry }[] = [];
    const worldPos = new THREE.Vector3();
    for (const p of this.props) {
      if (p.entry.category !== 'chest') continue;
      p.mesh.getWorldPosition(worldPos);
      out.push({ position: worldPos.clone(), mesh: p.mesh, entity: p.entity, openGeo: p.openGeo });
    }
    return out;
  }

  /** Toggle room name labels on/off (e.g. from voxel dungeon settings). */
  setRoomLabelsVisible(visible: boolean): void {
    for (const label of this.labels) label.visible = visible;
  }

  private findCell(
    entry: DungeonPropEntry,
    room: RoomRect,
    occupied: Set<string>,
    openGrid: boolean[],
    gridW: number,
  ): { gx: number; gz: number; wallSide: 'N' | 'S' | 'E' | 'W' | null } | null {
    const candidates: { gx: number; gz: number; wallSide: 'N' | 'S' | 'E' | 'W' | null }[] = [];

    for (let gz = room.z; gz < room.z + room.d; gz++) {
      for (let gx = room.x; gx < room.x + room.w; gx++) {
        if (!openGrid[gz * gridW + gx]) continue;
        if (occupied.has(`${gx},${gz}`)) continue;

        const atLeft = gx === room.x;
        const atRight = gx === room.x + room.w - 1;
        const atTop = gz === room.z;
        const atBottom = gz === room.z + room.d - 1;
        const isEdge = atLeft || atRight || atTop || atBottom;
        const isCorner = (atLeft || atRight) && (atTop || atBottom);

        // Determine which wall this cell is on (closest edge)
        let wallSide: 'N' | 'S' | 'E' | 'W' | null = null;
        if (isEdge) {
          const distN = gz - room.z;
          const distS = (room.z + room.d - 1) - gz;
          const distW = gx - room.x;
          const distE = (room.x + room.w - 1) - gx;
          const min = Math.min(distN, distS, distW, distE);
          if (min === distN) wallSide = 'N';
          else if (min === distS) wallSide = 'S';
          else if (min === distW) wallSide = 'W';
          else wallSide = 'E';
        }

        if (entry.placement === 'corner' && isCorner) candidates.push({ gx, gz, wallSide });
        else if ((entry.placement === 'wall' || entry.placement === 'wall_mount') && isEdge && !isCorner) candidates.push({ gx, gz, wallSide });
        else if (entry.placement === 'center' && !isEdge) candidates.push({ gx, gz, wallSide });
        else if (entry.placement === 'anywhere') candidates.push({ gx, gz, wallSide });
      }
    }

    // Fallback: any open cell — only for center/anywhere props (wall/corner/wall_mount should not float mid-room)
    if (candidates.length === 0 && entry.placement !== 'wall' && entry.placement !== 'corner' && entry.placement !== 'wall_mount') {
      for (let gz = room.z; gz < room.z + room.d; gz++) {
        for (let gx = room.x; gx < room.x + room.w; gx++) {
          if (!openGrid[gz * gridW + gx]) continue;
          if (occupied.has(`${gx},${gz}`)) continue;
          candidates.push({ gx, gz, wallSide: null });
        }
      }
    }

    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  /** Return all prop entities (for HMR re-registration). */
  getEntities(): Entity[] {
    return this.props.map(p => p.entity);
  }

  dispose(): void {
    for (const prop of this.props) {
      prop.entity.destroy();
      this.parent.remove(prop.mesh);
    }
    this.props.length = 0;
    for (const label of this.labels) {
      (label.material as THREE.SpriteMaterial).map?.dispose();
      (label.material as THREE.SpriteMaterial).dispose();
      this.parent.remove(label);
    }
    this.labels.length = 0;
  }
}

export function clearPropCache(): void {
  for (const geo of geoCache.values()) geo.dispose();
  geoCache.clear();
}
