// ── Dungeon Props ──────────────────────────────────────────────────
// Places VOX prop meshes inside dungeon rooms using the VoxDungeonDB registry.

import * as THREE from 'three';
import { loadVoxModel, buildVoxMesh } from '../utils/VoxModelLoader';
import { Entity, Layer } from './Entity';
import type { DungeonPropEntry, PropPlacement } from './VoxDungeonDB';
import { getRandomProp, getPropsWhere } from './VoxDungeonDB';

// ── Geometry cache ──

const geoCache = new Map<string, THREE.BufferGeometry>();

async function loadPropGeo(entry: DungeonPropEntry, tileSize: number): Promise<THREE.BufferGeometry | null> {
  const scale = entry.scalesWithDungeon ? tileSize : 1;
  const key = `${entry.id}:${scale}`;
  if (geoCache.has(key)) return geoCache.get(key)!;
  try {
    const { model, palette } = await loadVoxModel(entry.voxPath);
    const targetHeight = entry.baseHeight * scale;
    const geo = buildVoxMesh(model, palette, targetHeight);
    geoCache.set(key, geo);
    return geo;
  } catch (err) {
    console.warn(`[DungeonProps] Failed to load ${entry.id}:`, err);
    return null;
  }
}

// ── Room templates ──
// Each template defines which prop categories to place in a room.

interface RoomTemplate {
  name: string;
  props: { category: string; count: number }[];
  minSize: number;  // minimum room dimension to use this template
}

const ROOM_TEMPLATES: RoomTemplate[] = [
  // Storage: barrels, boxes, pots
  { name: 'storage', minSize: 3, props: [
    { category: 'barrel', count: 2 },
    { category: 'box', count: 1 },
    { category: 'pot', count: 2 },
  ]},
  // Library: bookcases, table, candelabrum
  { name: 'library', minSize: 4, props: [
    { category: 'bookcase_large', count: 1 },
    { category: 'bookcase_small', count: 1 },
    { category: 'table_small', count: 1 },
    { category: 'candelabrum_small', count: 1 },
  ]},
  // Dining: table, chairs, mugs
  { name: 'dining', minSize: 4, props: [
    { category: 'table_small', count: 1 },
    { category: 'chair', count: 2 },
    { category: 'mug', count: 2 },
  ]},
  // Shrine: altar, candelabrum, banners
  { name: 'shrine', minSize: 4, props: [
    { category: 'altar', count: 1 },
    { category: 'candelabrum', count: 2 },
    { category: 'banner', count: 1 },
  ]},
  // Tomb room: tombs, torches
  { name: 'tomb', minSize: 4, props: [
    { category: 'tomb', count: 2 },
    { category: 'torch_ground', count: 2 },
  ]},
  // Guard room: bench, barrel, torch
  { name: 'guard', minSize: 3, props: [
    { category: 'bench', count: 1 },
    { category: 'barrel', count: 1 },
    { category: 'torch_ground', count: 1 },
  ]},
  // Minimal: just torches
  { name: 'torchlit', minSize: 3, props: [
    { category: 'torch_ground', count: 2 },
  ]},
];

// ── Placement ──

interface RoomRect {
  x: number; z: number; w: number; d: number;
}

interface PlacedProp {
  mesh: THREE.Mesh;
  entity: Entity;
  entry: DungeonPropEntry;
}

export class DungeonPropSystem {
  private props: PlacedProp[] = [];
  private readonly parent: THREE.Object3D;

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
  ): Promise<void> {
    const halfWorld = groundSize / 2;
    const toWorldX = (gx: number) => -halfWorld + (gx + 0.5) * cellSize;
    const toWorldZ = (gz: number) => -halfWorld + (gz + 0.5) * cellSize;

    const voxMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.75,
      metalness: 0.1,
    });

    // Track occupied grid cells — block door cells + neighbors so props never block entrances
    const occupied = new Set<string>();
    if (gridDoors) {
      for (const door of gridDoors) {
        const gx = Math.round(door.x);
        const gz = Math.round(door.z);
        // Block the door cell and all neighbors (3×3 area)
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            occupied.add(`${gx + dx},${gz + dz}`);
          }
        }
      }
    }

    for (const room of rooms) {
      // Pick a random template that fits
      const minDim = Math.min(room.w, room.d);
      const eligible = ROOM_TEMPLATES.filter(t => t.minSize <= minDim);
      if (eligible.length === 0) continue;

      // ~25% chance to leave a room empty
      if (Math.random() < 0.25) continue;

      const template = eligible[Math.floor(Math.random() * eligible.length)];

      for (const { category, count } of template.props) {
        for (let i = 0; i < count; i++) {
          const entry = getRandomProp(category);
          if (!entry) continue;

          const cell = this.findCell(entry, room, occupied, openGrid, gridW);
          if (!cell) continue;

          occupied.add(`${cell.gx},${cell.gz}`);

          const geo = await loadPropGeo(entry, cellSize);
          if (!geo) continue;

          const mesh = new THREE.Mesh(geo, voxMat.clone());
          const wx = toWorldX(cell.gx);
          const wz = toWorldZ(cell.gz);
          mesh.position.set(wx, 0, wz);

          // Rotation
          if (entry.wallAligned) {
            // Snap flush against nearest room edge, facing inward
            mesh.rotation.y = this.getWallRotation(cell.gx, cell.gz, room);
          } else if (entry.placement === 'corner' || entry.placement === 'wall') {
            const rcx = room.x + room.w / 2;
            const rcz = room.z + room.d / 2;
            const angle = Math.atan2(rcx - cell.gx, rcz - cell.gz);
            mesh.rotation.y = angle;
          } else {
            mesh.rotation.y = (Math.floor(Math.random() * 4)) * Math.PI / 2;
          }

          mesh.castShadow = true;
          mesh.receiveShadow = true;
          this.parent.add(mesh);

          const entity = new Entity(mesh, {
            layer: Layer.Architecture,
            radius: entry.radius * cellSize,
            weight: entry.destroyable ? 3 : 5,
          });

          this.props.push({ mesh, entity, entry });
        }
      }
    }

    console.log(`[DungeonProps] Placed ${this.props.length} props in ${rooms.length} rooms`);
  }

  /** Get Y rotation so prop's back is flush against the nearest room edge, facing inward.
   *  VOX props face -Z by default, so rotation 0 = facing north (into room from south edge). */
  private getWallRotation(gx: number, gz: number, room: RoomRect): number {
    const distN = gz - room.z;                    // distance to north edge
    const distS = (room.z + room.d - 1) - gz;    // distance to south edge
    const distW = gx - room.x;                    // distance to west edge
    const distE = (room.x + room.w - 1) - gx;    // distance to east edge

    const min = Math.min(distN, distS, distW, distE);

    // Face inward (away from wall): back against wall
    if (min === distN) return Math.PI;       // on north edge → face south
    if (min === distS) return 0;             // on south edge → face north
    if (min === distW) return Math.PI / 2;   // on west edge → face east
    return -Math.PI / 2;                      // on east edge → face west
  }

  private findCell(
    entry: DungeonPropEntry,
    room: RoomRect,
    occupied: Set<string>,
    openGrid: boolean[],
    gridW: number,
  ): { gx: number; gz: number } | null {
    const candidates: { gx: number; gz: number }[] = [];

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

        if (entry.placement === 'corner' && isCorner) candidates.push({ gx, gz });
        else if (entry.placement === 'wall' && isEdge && !isCorner) candidates.push({ gx, gz });
        else if (entry.placement === 'center' && !isEdge) candidates.push({ gx, gz });
        else if (entry.placement === 'anywhere') candidates.push({ gx, gz });
      }
    }

    // Fallback: any open non-occupied cell
    if (candidates.length === 0) {
      for (let gz = room.z; gz < room.z + room.d; gz++) {
        for (let gx = room.x; gx < room.x + room.w; gx++) {
          if (!openGrid[gz * gridW + gx]) continue;
          if (occupied.has(`${gx},${gz}`)) continue;
          candidates.push({ gx, gz });
        }
      }
    }

    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  dispose(): void {
    for (const prop of this.props) {
      prop.entity.destroy();
      this.parent.remove(prop.mesh);
    }
    this.props.length = 0;
  }
}

export function clearPropCache(): void {
  for (const geo of geoCache.values()) geo.dispose();
  geoCache.clear();
}
