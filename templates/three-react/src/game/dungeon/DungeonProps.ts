// ── Dungeon Props ──────────────────────────────────────────────────
// Places VOX prop meshes inside dungeon rooms using the VoxDungeonDB registry.

import * as THREE from 'three';
import { loadVoxModel, buildVoxMesh, tintGeometry } from '../../utils/VoxModelLoader';
import { Entity, Layer } from '../core/Entity';
import type { DungeonPropEntry, PropPlacement } from './VoxDungeonDB';
import { getRandomProp, getRandomPropStyled, extractPropStyle, getPropsWhere, getRandomTile } from './VoxDungeonDB';
import { loadTileEntry } from './VoxDungeonLoader';
import { useGameStore } from '../../store';
import { SeededRandom } from '../../utils/SeededRandom';
import { POTION_HUES } from '../combat/PotionEffectSystem';
import type { PotionEffectSystem } from '../combat/PotionEffectSystem';

// Light cap removed — room visibility hides lights in non-active rooms so GPU cost is bounded.

/** Module-level seeded RNG for prop placement — set at start of populate(). */
let rng = new SeededRandom(0);

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
  // ── Tiny rooms (1–2 cell wide) ──
  { name: 'nook', minSize: 1, weight: 5, props: [
    { category: 'torch_wall', count: 1 },
    { category: 'pot', count: 1 },
    { category: 'barrel', count: 1 },
  ]},
  { name: 'closet', minSize: 1, weight: 4, props: [
    { category: 'torch_wall', count: 1 },
    { category: 'box', count: 1 },
    { category: 'chest', count: 1 },
  ]},
  { name: 'alcove', minSize: 1, weight: 3, props: [
    { category: 'candelabrum', count: 1 },
    { category: 'potion', count: 1 },
    { category: 'book', count: 1 },
  ]},
  // ── Small rooms (2+ cell wide) ──
  { name: 'pantry', minSize: 2, weight: 4, props: [
    { category: 'barrel', count: 2 },
    { category: 'pot', count: 2 },
    { category: 'torch_wall', count: 1 },
    { category: 'box', count: 1 },
  ]},
  { name: 'cell', minSize: 2, weight: 3, props: [
    { category: 'bench', count: 1 },
    { category: 'torch_wall', count: 1 },
    { category: 'pot', count: 1 },
    { category: 'chest', count: 1 },
  ]},
  { name: 'vestibule', minSize: 2, weight: 3, props: [
    { category: 'torch_wall', count: 2 },
    { category: 'banner', count: 1 },
    { category: 'signpost', count: 1 },
  ]},
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
    { category: 'chest', count: 1 },
  ]},
  // ── Barracks ──
  { name: 'barracks', minSize: 4, weight: 3, props: [
    { category: 'bench', count: 2 },
    { category: 'bench_large', count: 1 },
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
    { category: 'chest', count: 1 },
  ]},
  // ── Jail ──
  { name: 'jail', minSize: 3, weight: 2, props: [
    { category: 'wall_grate', count: 4 },
    { category: 'bench', count: 2 },
    { category: 'pot', count: 2 },
    { category: 'torch_wall', count: 3 },
    { category: 'barrel', count: 1 },
    { category: 'bookcase_small', count: 1 },
    { category: 'chest', count: 1 },
  ]},
  // ── Treasure Room ──
  { name: 'treasure', minSize: 3, weight: 2, props: [
    { category: 'chest', count: 4 },
    { category: 'candelabrum', count: 3 },
    { category: 'torch_wall', count: 3 },
    { category: 'banner', count: 2 },
    { category: 'potion', count: 1 },
    { category: 'bookcase_small', count: 1 },
  ]},
  // ── Bar / Tavern ──
  { name: 'bar', minSize: 4, weight: 2, props: [
    { category: 'table_large', count: 1 },
    { category: 'table_small', count: 1 },
    { category: 'chair', count: 4 },
    { category: 'mug', count: 3 },
    { category: 'barrel', count: 3 },
    { category: 'bottle', count: 2 },
    { category: 'torch_wall', count: 3 },
    { category: 'banner', count: 2 },
    { category: 'chest', count: 1 },
  ]},
  // ── Chapel ──
  { name: 'chapel', minSize: 4, weight: 2, props: [
    { category: 'altar', count: 1 },
    { category: 'candelabrum', count: 3 },
    { category: 'banner', count: 4 },
    { category: 'bench', count: 1 },
    { category: 'bench_large', count: 2 },
    { category: 'torch_wall', count: 3 },
    { category: 'bookcase_small', count: 1 },
    { category: 'chest', count: 1 },
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
    { category: 'potion', count: 2 },
    { category: 'bottle', count: 2 },
    { category: 'candelabrum_small', count: 2 },
    { category: 'bookcase_small', count: 3 },
    { category: 'bookcase_large', count: 1 },
    { category: 'torch_wall', count: 2 },
    { category: 'chest', count: 1 },
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
    { category: 'chest', count: 1 },
  ]},
  // ── Shrine ──
  { name: 'shrine', minSize: 3, weight: 2, props: [
    { category: 'altar', count: 1 },
    { category: 'candelabrum', count: 3 },
    { category: 'banner', count: 4 },
    { category: 'torch_wall', count: 3 },
    { category: 'potion', count: 1 },
    { category: 'bookcase_small', count: 1 },
    { category: 'chest', count: 1 },
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
    { category: 'bench', count: 1 },
    { category: 'bench_large', count: 1 },
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
    { category: 'bottle', count: 1 },
    { category: 'bookcase_small', count: 1 },
    { category: 'chest', count: 1 },
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
    { category: 'bottle', count: 1 },
    { category: 'bookcase_small', count: 1 },
    { category: 'chest', count: 1 },
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
    { category: 'bottle', count: 1 },
    { category: 'bookcase_small', count: 1 },
    { category: 'chest', count: 1 },
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
  'bench_large': 0.14,
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

export interface PlacedProp {
  mesh: THREE.Mesh;
  entity: Entity;
  entry: DungeonPropEntry;
  /** Dungeon grid cell (gx, gz) where this prop is placed — used to mark nav cells unwalkable */
  gridCell: { gx: number; gz: number };
  /** For chests: open-state geometry to swap when player opens */
  openGeo?: THREE.BufferGeometry;
  /** If this is a small item placed on a surface, points to the surface prop */
  surfaceOf?: PlacedProp;
  /** Potion color index (0-7) for potion/bottle props */
  colorIndex?: number;
  /** Floating label sprite for potion/bottle props */
  potionLabel?: THREE.Sprite;
}

/** Create a small floating label sprite for a potion/bottle prop */
function createPropPotionLabel(text: string, color: string): THREE.Sprite {
  const isUnknown = text === '?';
  const canvas = document.createElement('canvas');
  canvas.width = isUnknown ? 96 : 192;
  canvas.height = isUnknown ? 96 : 48;
  const ctx = canvas.getContext('2d')!;

  if (isUnknown) {
    ctx.font = 'bold 52px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.arc(48, 48, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText('?', 48, 51);
  } else {
    ctx.font = 'bold 26px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const metrics = ctx.measureText(text);
    const pw = Math.min(metrics.width + 18, 180);
    const px = (192 - pw) / 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.roundRect(px, 3, pw, 42, 10);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, 96, 26);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  if (isUnknown) {
    sprite.scale.set(0.20, 0.20, 1);
  } else {
    sprite.scale.set(0.42, 0.105, 1);
  }
  sprite.renderOrder = 2;
  sprite.raycast = () => {}; // exclude from raycaster
  return sprite;
}

/** Update text/color on a prop potion label */
function updatePropPotionLabel(sprite: THREE.Sprite, text: string, color: string): void {
  const mat = sprite.material as THREE.SpriteMaterial;
  const oldTex = mat.map;
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 26px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const metrics = ctx.measureText(text);
  const pw = Math.min(metrics.width + 18, 180);
  const px = (192 - pw) / 2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.roundRect(px, 3, pw, 42, 10);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, 96, 26);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  mat.map = texture;
  mat.needsUpdate = true;
  sprite.scale.set(0.42, 0.105, 1);
  if (oldTex) oldTex.dispose();
}

export class DungeonPropSystem {
  private props: PlacedProp[] = [];
  private labels: THREE.Sprite[] = [];
  private readonly parent: THREE.Object3D;
  private cellSize = 0.75;
  private torchLights: { light: THREE.PointLight; baseIntensity: number; phase: number }[] = [];
  private torchTime = 0;
  /** All point lights in the dungeon (torches + portals) for proximity culling */
  private allLights: THREE.PointLight[] = [];
  private static readonly MAX_ACTIVE_LIGHTS = 6;
  private potionSystem: PotionEffectSystem | null = null;
  /** Positions of destroyed props — tracked for serialization */
  private destroyedPositions: Array<{ x: number; z: number }> = [];
  /** Room index → template name assigned during populate() */
  private roomTemplateMap = new Map<number, string>();

  // Entrance/exit: spawn positions (cell center) and portal trigger positions (at wall)
  private entrancePos: THREE.Vector3 | null = null;
  private entrancePortalPos: THREE.Vector3 | null = null;
  private exitPos: THREE.Vector3 | null = null;
  private exitPortalPos: THREE.Vector3 | null = null;
  private entranceFacing: number = 0; // Y rotation facing into room
  private exitWallDir: [number, number] = [0, 0]; // unit vector pointing toward exit wall

  constructor(parent: THREE.Object3D) {
    this.parent = parent;
  }

  /** Set the potion effect system for tinting and label updates */
  setPotionSystem(system: PotionEffectSystem): void {
    this.potionSystem = system;
    system.onLabelUpdate((colorIndex, label, positive) => {
      this.updatePotionLabelsForColor(colorIndex, label, positive);
    });
  }

  /** Update all potion/bottle prop labels of a given colorIndex when identified */
  private updatePotionLabelsForColor(colorIndex: number, labelText: string, positive: boolean): void {
    const color = positive ? '#44ff66' : '#ff4444';
    for (const prop of this.props) {
      if (prop.colorIndex === colorIndex && prop.potionLabel) {
        updatePropPotionLabel(prop.potionLabel, labelText, color);
      }
    }
  }

  /** Attach a point light to a prop mesh if it's a light source (torch, candelabrum). */
  private attachLight(mesh: THREE.Mesh, entry: DungeonPropEntry): void {
    if (!entry.lightSource) return;
    const isWallMount = entry.placement === 'wall_mount';
    // Vary color from reddish to yellow-orange
    const colors = [0xff6622, 0xff7733, 0xff8833, 0xff9944, 0xffaa44, 0xffbb55, 0xffcc66];
    const color = colors[Math.floor(rng.next() * colors.length)];
    const intensity = isWallMount ? 2.0 : 2.5;
    const distance = isWallMount ? this.cellSize * 8 : this.cellSize * 6;
    const light = new THREE.PointLight(color, intensity, distance, 1.5);
    // Position light at the top of the prop (flame area)
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const topY = mesh.geometry.boundingBox
      ? mesh.geometry.boundingBox.max.y * 0.95
      : this.cellSize * 0.3;
    light.position.set(0, topY, 0);
    light.castShadow = false;
    mesh.add(light);
    this.torchLights.push({ light, baseIntensity: intensity, phase: Math.random() * Math.PI * 2 });
    this.allLights.push(light);
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
    entranceRoom = -1,
    exitRoom = -1,
    dungeonTheme = 'a_a',
    seed?: number,
    cellHeights?: Float32Array,
    roomOwnership?: number[],
  ): Promise<void> {
    // Initialize seeded RNG for prop placement
    const actualSeed = seed ?? (Math.random() * 0xFFFFFFFF) >>> 0;
    rng = new SeededRandom(actualSeed);

    this.cellSize = cellSize;
    const halfWorld = groundSize / 2;
    const baseFloorY = cellSize / 15; // VOX ground tile thickness
    const gridD = Math.floor(groundSize / cellSize);
    /** Get floor Y at a grid cell, including stair height offset */
    const getFloorY = (gx: number, gz: number): number => {
      const ch = cellHeights && gx >= 0 && gx < gridW && gz >= 0 && gz < gridD
        ? cellHeights[gz * gridW + gx] : 0;
      return baseFloorY + ch;
    };
    // Default floorY for backward compat (entrance room, height 0)
    const floorY = baseFloorY;
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

    // Block cells in front of entrance/exit portals before placing room props.
    // Portal sits on a wall-edge cell facing into the room; block the cell it faces.
    for (const portalRoomIdx of [entranceRoom, exitRoom]) {
      if (portalRoomIdx < 0 || portalRoomIdx >= rooms.length) continue;
      const room = rooms[portalRoomIdx];
      for (let gz = room.z; gz < room.z + room.d; gz++) {
        for (let gx = room.x; gx < room.x + room.w; gx++) {
          if (!openGrid[gz * gridW + gx]) continue;
          const atN = gz === room.z && (gz - 1 < 0 || !openGrid[(gz - 1) * gridW + gx]);
          const atS = gz === room.z + room.d - 1 && (gz + 1 >= gridH || !openGrid[(gz + 1) * gridW + gx]);
          const atW = gx === room.x && (gx - 1 < 0 || !openGrid[gz * gridW + (gx - 1)]);
          const atE = gx === room.x + room.w - 1 && (gx + 1 >= gridW || !openGrid[gz * gridW + (gx + 1)]);
          if (atN || atS || atW || atE) {
            // Block wall-edge cell (potential portal) and the cell in front of it
            occupied.add(`${gx},${gz}`);
            if (atN) occupied.add(`${gx},${gz + 1}`);
            if (atS) occupied.add(`${gx},${gz - 1}`);
            if (atW) occupied.add(`${gx + 1},${gz}`);
            if (atE) occupied.add(`${gx - 1},${gz}`);
          }
        }
      }
    }

    // testProp override: read from store
    const testProp = (await import('../../store')).useGameStore.getState().testProp;

    for (let roomIdx = 0; roomIdx < rooms.length; roomIdx++) {
      const room = rooms[roomIdx];
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
        // ~2% chance to leave a room empty (atmospheric)
        if (rng.next() < 0.02) continue;
        // Weighted pick
        const totalWeight = eligible.reduce((s, t) => s + t.weight, 0);
        let roll = rng.next() * totalWeight;
        let template = eligible[0];
        for (const t of eligible) {
          roll -= t.weight;
          if (roll <= 0) { template = t; break; }
        }
        // Record room → template assignment for room-monster affinity
        this.roomTemplateMap.set(roomIdx, template.name);
        // Place room label at center
        const centerWx = toWorldX(room.x + (room.w - 1) / 2);
        const centerWz = toWorldZ(room.z + (room.d - 1) / 2);
        const centerGx = Math.floor(room.x + room.w / 2);
        const centerGz = Math.floor(room.z + room.d / 2);
        const label = createRoomLabel(template.name, centerWx, getFloorY(centerGx, centerGz) + wallHeight - 1, centerWz);
        label.visible = showRoomLabels;
        label.userData.labelsDisabled = !showRoomLabels;
        this.parent.add(label);
        this.labels.push(label);

        // Start with template props, then sprinkle 1-3 random extras for variety
        propList = [...template.props];
        const extraRolls = rng.next() < 0.3 ? 3 : rng.next() < 0.6 ? 2 : 1;
        const extras = ['pot', 'bottle', 'book', 'mug', 'potion', 'torch_wall', 'banner', 'bookcase_small', 'bookcase_small'];
        for (let e = 0; e < extraRolls; e++) {
          propList.push({ category: extras[Math.floor(rng.next() * extras.length)], count: 1 });
        }
      }

      // ~50% of rooms use a consistent wood style for all furniture
      const WOOD_STYLES = ['a', 'b', 'c'];
      const roomStyle: string | null = rng.next() < 0.5
        ? WOOD_STYLES[Math.floor(rng.next() * WOOD_STYLES.length)]
        : null;

      // Split props into 3 groups: chairs, small items, everything else
      const smallItems: { category: string; count: number }[] = [];
      const chairItems: { category: string; count: number }[] = [];
      const largeItems: { category: string; count: number }[] = [];
      for (const item of propList) {
        if (SMALL_ITEM_CATEGORIES.has(item.category)) {
          smallItems.push(item);
        } else if (item.category === 'chair' || item.category === 'bench' || item.category === 'bench_large') {
          chairItems.push(item);
        } else {
          largeItems.push(item);
        }
      }

      // Track placed surfaces in this room for small item placement
      interface SurfaceSlot { wx: number; wz: number; surfaceY: number; used: number; maxItems: number; rotation: number; parentProp?: PlacedProp }
      const surfaces: SurfaceSlot[] = [];

      // Track placed tables for chair placement
      interface TableSlot { wx: number; wz: number; seatsUsed: number; maxSeats: number; isLarge: boolean; woodStyle: string | null }
      const tables: TableSlot[] = [];

      // ── Pass 1: place furniture and large items ──
      const currentFloor = useGameStore.getState().floor;
      for (const { category, count } of largeItems) {
        for (let i = 0; i < count; i++) {
          const entry = roomStyle
            ? getRandomPropStyled(category, roomStyle, () => rng.next())
            : getRandomProp(category, () => rng.next(), currentFloor);
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
              getFloorY(cell.gx, cell.gz) + (entry.mountHeight ?? 0.5) * wallHeight - cellSize,
              wz + push[1] * cellSize * 0.5,
            );

            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.parent.add(mesh);
            this.attachLight(mesh, entry);

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
          const isPotion = entry.category === 'potion' || entry.category === 'bottle';
          let geo = await loadPropGeo(entry, cellSize, isChest);
          if (!geo) continue;

          // Assign random potion color index and tint geometry
          let potionColorIndex: number | undefined;
          if (isPotion) {
            potionColorIndex = rng.int(0, POTION_HUES.length);
            geo = tintGeometry(geo, POTION_HUES[potionColorIndex], 1.2);
          }

          let openGeo: THREE.BufferGeometry | undefined;
          if (isChest && entry.voxPathClosed) {
            try {
              const voxScale = await getClosedVoxelScale(entry, cellSize);
              if (voxScale) {
                // Load open model using closed model's voxel scale
                const { model: openModel } = await loadVoxModel(entry.voxPath);
                const openTargetHeight = openModel.size.z * voxScale; // same per-voxel scale
                openGeo = await loadPropGeo(entry, cellSize, false, openTargetHeight) ?? undefined;
              } else {
                openGeo = await loadPropGeo(entry, cellSize, false) ?? undefined;
              }
            } catch (err) {
              console.warn(`[DungeonProps] Failed to load open geo for ${entry.id}:`, err);
              // Fallback: try loading open variant without height matching
              try {
                openGeo = await loadPropGeo(entry, cellSize, false) ?? undefined;
              } catch { /* give up */ }
            }
          }

          const mesh = new THREE.Mesh(geo, voxMat.clone());
          const wx = toWorldX(cell.gx);
          const wz = toWorldZ(cell.gz);
          mesh.position.set(wx, getFloorY(cell.gx, cell.gz), wz);

          // Rotation — use stored wallSide from findCell for deterministic wall-facing
          // Push wall-aligned props toward the wall within their cell (stay inside cell bounds)
          if ((entry.wallAligned || entry.placement === 'corner' || entry.placement === 'wall') && cell.wallSide) {
            mesh.rotation.y = WALL_ROT[cell.wallSide];
            const push = WALL_PUSH[cell.wallSide];
            mesh.position.x += push[0] * cellSize * 0.35;
            mesh.position.z += push[1] * cellSize * 0.35;
          } else {
            mesh.rotation.y = (Math.floor(rng.next() * 4)) * Math.PI / 2;
          }

          mesh.castShadow = true;
          mesh.receiveShadow = true;
          if (isChest) {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            mat.emissive.setHex(0x330808);
            mat.emissiveIntensity = 0.4;
          }
          this.parent.add(mesh);
          this.attachLight(mesh, entry);

          const propScale = entry.scalesWithDungeon ? cellSize : 1;
          const entity = new Entity(mesh, {
            layer: Layer.Prop,
            radius: entry.radius * propScale,
            weight: entry.destroyable ? 3 : 5,
          });

          const placedProp: PlacedProp = { mesh, entity, entry, gridCell: { gx: cell.gx, gz: cell.gz }, openGeo };

          // Add floating label + store colorIndex for potion/bottle props
          if (isPotion && potionColorIndex !== undefined) {
            placedProp.colorIndex = potionColorIndex;
            mesh.userData.colorIndex = potionColorIndex;
            const ps = this.potionSystem;
            const identified = ps ? ps.isIdentified(potionColorIndex) : false;
            const text = identified ? (ps?.getLabel(potionColorIndex) ?? '?') : '?';
            const positive = ps ? ps.isPositive(potionColorIndex) : true;
            const color = identified ? (positive ? '#44ff66' : '#ff4444') : '#ffffff';
            const propHeight = entry.baseHeight * propScale;
            const label = createPropPotionLabel(text, color);
            label.position.set(0, propHeight + 0.06, 0);
            mesh.add(label);
            placedProp.potionLabel = label;
          }

          this.props.push(placedProp);

          // Track as surface for small item placement
          const surfaceH = SURFACE_CATEGORIES[entry.category];
          if (surfaceH !== undefined) {
            const surfScale = entry.scalesWithDungeon ? cellSize : 1;
            surfaces.push({
              wx: mesh.position.x,
              wz: mesh.position.z,
              surfaceY: getFloorY(cell.gx, cell.gz) + surfaceH * surfScale,
              used: 0,
              maxItems: entry.category.includes('large') ? 3
                : (entry.category === 'barrel' || entry.category === 'box' || entry.category === 'pot') ? 1
                : 2,
              rotation: mesh.rotation.y,
              parentProp: placedProp,
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
              woodStyle: extractPropStyle(entry.id),
            });
          }
        }
      }

      // ── Pass 2: place chairs around tables (or against walls) ──
      for (const { category, count } of chairItems) {
        for (let i = 0; i < count; i++) {
          // Try to seat around a table — pick style-matched entry
          const availableTables = tables.filter(t => t.seatsUsed < t.maxSeats);
          if (availableTables.length > 0) {
            const table = availableTables[Math.floor(rng.next() * availableTables.length)];
            const seatIdx = table.seatsUsed;
            table.seatsUsed++;

            // Pick chair/bench matching the table's wood style
            const entry = table.woodStyle
              ? getRandomPropStyled(category, table.woodStyle, () => rng.next())
              : getRandomProp(category, () => rng.next());
            if (!entry) continue;

            const geo = await loadPropGeo(entry, cellSize);
            if (!geo) continue;

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
            const tgx = Math.floor((table.wx + halfWorld) / cellSize);
            const tgz = Math.floor((table.wz + halfWorld) / cellSize);
            mesh.position.set(table.wx + ox, getFloorY(tgx, tgz), table.wz + oz);
            mesh.rotation.y = rot;
            mesh.castShadow = true;
            this.parent.add(mesh);

            const dummyEntity = new Entity(mesh, { layer: Layer.Prop, radius: 0.01, weight: 0 });
            this.props.push({ mesh, entity: dummyEntity, entry, gridCell: { gx: tgx, gz: tgz } });
          } else {
            // No table — place against wall (random style)
            const entry = roomStyle
              ? getRandomPropStyled(category, roomStyle, () => rng.next())
              : getRandomProp(category, () => rng.next());
            if (!entry) continue;

            const cell = this.findCell(
              { ...entry, placement: 'wall' } as any,
              room, occupied, openGrid, gridW,
            );
            if (!cell) continue;
            occupied.add(`${cell.gx},${cell.gz}`);

            const geo = await loadPropGeo(entry, cellSize);
            if (!geo) continue;

            const mesh = new THREE.Mesh(geo, voxMat.clone());
            mesh.position.set(toWorldX(cell.gx), getFloorY(cell.gx, cell.gz), toWorldZ(cell.gz));
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
          const entry = getRandomProp(category, () => rng.next());
          if (!entry) continue;

          const isSmallPotion = entry.category === 'potion' || entry.category === 'bottle';
          let smallPotionColorIndex: number | undefined;

          // Try to find an available surface
          const available = surfaces.filter(s => s.used < s.maxItems);
          if (available.length > 0) {
            const surface = available[Math.floor(rng.next() * available.length)];
            surface.used++;

            let geo = await loadPropGeo(entry, cellSize);
            if (!geo) continue;

            // Tint potion/bottle geometry
            if (isSmallPotion) {
              smallPotionColorIndex = rng.int(0, POTION_HUES.length);
              geo = tintGeometry(geo, POTION_HUES[smallPotionColorIndex], 1.2);
            }

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
            mesh.rotation.y = rng.next() * Math.PI * 2;
            mesh.castShadow = true;
            this.parent.add(mesh);

            // Small items are decorative — no collision, projectiles pass through
            mesh.userData.noProjectileStick = true;
            const dummyEntity = new Entity(mesh, { layer: Layer.Prop, radius: 0.01, weight: 0 });
            const surfaceCell = surface.parentProp ? surface.parentProp.gridCell : { gx: 0, gz: 0 };
            const smallProp: PlacedProp = { mesh, entity: dummyEntity, entry, gridCell: surfaceCell, surfaceOf: surface.parentProp };

            // Add label + colorIndex for potion/bottle
            if (isSmallPotion && smallPotionColorIndex !== undefined) {
              smallProp.colorIndex = smallPotionColorIndex;
              mesh.userData.colorIndex = smallPotionColorIndex;
              const ps = this.potionSystem;
              const identified = ps ? ps.isIdentified(smallPotionColorIndex) : false;
              const text = identified ? (ps?.getLabel(smallPotionColorIndex) ?? '?') : '?';
              const positive = ps ? ps.isPositive(smallPotionColorIndex) : true;
              const color = identified ? (positive ? '#44ff66' : '#ff4444') : '#ffffff';
              const propScale = entry.scalesWithDungeon ? cellSize : 1;
              const propHeight = entry.baseHeight * propScale;
              const label = createPropPotionLabel(text, color);
              label.position.set(0, propHeight + 0.06, 0);
              mesh.add(label);
              smallProp.potionLabel = label;
            }

            this.props.push(smallProp);
          } else {
            // No surfaces available — rarely place on floor (~10% chance)
            if (rng.next() > 0.1) continue;
            const cell = this.findCell(entry, room, occupied, openGrid, gridW);
            if (!cell) continue;

            let geo = await loadPropGeo(entry, cellSize);
            if (!geo) continue;

            // Tint potion/bottle geometry
            if (isSmallPotion) {
              smallPotionColorIndex = rng.int(0, POTION_HUES.length);
              geo = tintGeometry(geo, POTION_HUES[smallPotionColorIndex], 1.2);
            }

            const mesh = new THREE.Mesh(geo, voxMat.clone());
            mesh.position.set(toWorldX(cell.gx), getFloorY(cell.gx, cell.gz), toWorldZ(cell.gz));
            mesh.rotation.y = rng.next() * Math.PI * 2;
            mesh.castShadow = true;
            this.parent.add(mesh);

            const dummyEntity = new Entity(mesh, { layer: Layer.Prop, radius: 0.01, weight: 0 });
            const floorProp: PlacedProp = { mesh, entity: dummyEntity, entry, gridCell: { gx: cell.gx, gz: cell.gz } };

            // Add label + colorIndex for potion/bottle
            if (isSmallPotion && smallPotionColorIndex !== undefined) {
              floorProp.colorIndex = smallPotionColorIndex;
              mesh.userData.colorIndex = smallPotionColorIndex;
              const ps = this.potionSystem;
              const identified = ps ? ps.isIdentified(smallPotionColorIndex) : false;
              const text = identified ? (ps?.getLabel(smallPotionColorIndex) ?? '?') : '?';
              const positive = ps ? ps.isPositive(smallPotionColorIndex) : true;
              const color = identified ? (positive ? '#44ff66' : '#ff4444') : '#ffffff';
              const propScale = entry.scalesWithDungeon ? cellSize : 1;
              const propHeight = entry.baseHeight * propScale;
              const label = createPropPotionLabel(text, color);
              label.position.set(0, propHeight + 0.06, 0);
              mesh.add(label);
              floorProp.potionLabel = label;
            }

            this.props.push(floorProp);
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

    // ── Entrance / Exit wall props ──
    await this.placeEntranceExit(
      rooms, entranceRoom, exitRoom, occupied, openGrid, gridW, gridH,
      cellSize, halfWorld, wallHeight, dungeonTheme, getFloorY,
    );

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

    // Place wall-mount props (torches, banners) on ~30% of corridor wall cells
    const corridorMountProps = ['torch_wall', 'torch_wall', 'banner'];
    for (const cell of corridorWallCells) {
      if (occupied.has(`${cell.gx},${cell.gz}`)) continue;
      if (rng.next() > 0.3) continue;

      const category = corridorMountProps[Math.floor(rng.next() * corridorMountProps.length)];
      const entry = getRandomProp(category, () => rng.next());
      if (!entry) continue;

      const geo = await loadPropGeo(entry, cellSize);
      if (!geo) continue;

      // wall_mount props don't occupy the floor cell
      const mesh = new THREE.Mesh(geo, voxMat.clone());
      const wx = toWorldX(cell.gx);
      const wz = toWorldZ(cell.gz);
      const faceRot = WALL_ROT[cell.wallSide];
      mesh.rotation.y = faceRot;

      const push = WALL_PUSH[cell.wallSide];
      mesh.position.set(
        wx + push[0] * cellSize * 0.5,
        getFloorY(cell.gx, cell.gz) + (entry.mountHeight ?? 0.5) * wallHeight - cellSize,
        wz + push[1] * cellSize * 0.5,
      );

      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.parent.add(mesh);
      this.attachLight(mesh, entry);

      const dummyEntity = new Entity(mesh, { layer: Layer.Prop, radius: 0.01, weight: 0 });
      this.props.push({ mesh, entity: dummyEntity, entry, gridCell: { gx: cell.gx, gz: cell.gz } });
    }

    // Place floor-level wall props (barrels, crates, bookcases, etc.) on ~15% of corridor wall cells
    const corridorFloorProps = [
      'barrel', 'barrel', 'box', 'box', 'pot',
      'bookcase_small', 'bench', 'chest',
      'candelabrum', 'wall_grate',
    ];
    for (const cell of corridorWallCells) {
      if (occupied.has(`${cell.gx},${cell.gz}`)) continue;
      if (rng.next() > 0.15) continue;

      const category = corridorFloorProps[Math.floor(rng.next() * corridorFloorProps.length)];
      const corridorFloor = useGameStore.getState().floor;
      const entry = getRandomProp(category, () => rng.next(), corridorFloor);
      if (!entry) continue;

      const isCorridorChest = entry.category === 'chest';
      const geo = await loadPropGeo(entry, cellSize, isCorridorChest);
      if (!geo) continue;

      // Load open geometry for corridor chests (same logic as room chests)
      let openGeo: THREE.BufferGeometry | undefined;
      if (isCorridorChest && entry.voxPathClosed) {
        try {
          const voxScale = await getClosedVoxelScale(entry, cellSize);
          if (voxScale) {
            const { model: openModel } = await loadVoxModel(entry.voxPath);
            const openTargetHeight = openModel.size.z * voxScale;
            openGeo = await loadPropGeo(entry, cellSize, false, openTargetHeight) ?? undefined;
          } else {
            openGeo = await loadPropGeo(entry, cellSize, false) ?? undefined;
          }
        } catch {
          try { openGeo = await loadPropGeo(entry, cellSize, false) ?? undefined; } catch { /* give up */ }
        }
      }

      occupied.add(`${cell.gx},${cell.gz}`);

      const mesh = new THREE.Mesh(geo, voxMat.clone());
      const wx = toWorldX(cell.gx);
      const wz = toWorldZ(cell.gz);

      // Face into corridor (away from wall)
      mesh.rotation.y = WALL_ROT[cell.wallSide];
      const push = WALL_PUSH[cell.wallSide];
      const floorY = getFloorY(cell.gx, cell.gz);

      if (entry.placement === 'wall_mount') {
        // wall_grate etc — mount on wall surface
        mesh.position.set(
          wx + push[0] * cellSize * 0.5,
          floorY + (entry.mountHeight ?? 0.5) * wallHeight - cellSize,
          wz + push[1] * cellSize * 0.5,
        );
      } else {
        // Floor-level: push against wall
        mesh.position.set(
          wx + push[0] * cellSize * 0.35,
          floorY,
          wz + push[1] * cellSize * 0.35,
        );
      }

      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (isCorridorChest) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.emissive.setHex(0x330808);
        mat.emissiveIntensity = 0.4;
      }
      this.parent.add(mesh);
      this.attachLight(mesh, entry);

      const propEntity = new Entity(mesh, {
        layer: Layer.Prop,
        radius: entry.radius * (entry.scalesWithDungeon ? cellSize : 1),
        weight: Infinity,
      });
      this.props.push({ mesh, entity: propEntity, entry, gridCell: { gx: cell.gx, gz: cell.gz }, openGeo });
    }

    // Balance lights per flood-fill region: cull excess, seed missing
    await this.balanceRegionLights(openGrid, gridW, gridH, gridDoors, cellSize, wallHeight, voxMat, toWorldX, toWorldZ, getFloorY);

    // Start hidden — room visibility will show props in visible rooms
    for (const p of this.props) p.mesh.visible = false;
    for (const l of this.labels) l.visible = false;
  }

  /** Remove a point light attached to a prop mesh from all tracking arrays. */
  private removeLightFromProp(mesh: THREE.Mesh): void {
    const light = mesh.children.find(c => c instanceof THREE.PointLight) as THREE.PointLight | undefined;
    if (!light) return;
    const tlIdx = this.torchLights.findIndex(t => t.light === light);
    if (tlIdx >= 0) this.torchLights.splice(tlIdx, 1);
    const alIdx = this.allLights.indexOf(light);
    if (alIdx >= 0) this.allLights.splice(alIdx, 1);
    mesh.remove(light);
    light.dispose();
  }

  /** Update torch light flickering and proximity culling — call once per frame. */
  update(dt: number, playerPos?: THREE.Vector3): void {
    // ── Proximity light culling: enable only the N closest lights to the player ──
    // Also respect room visibility: lights whose parent torch mesh is hidden or
    // in a visited (dimmed) room stay disabled.
    if (playerPos) {
      const _wpos = new THREE.Vector3();
      const sorted = this.allLights
        .map((light) => {
          light.getWorldPosition(_wpos);
          const dx = _wpos.x - playerPos.x;
          const dz = _wpos.z - playerPos.z;
          // Light is room-disabled if parent is hidden OR light was dimmed by room visibility
          const roomDisabled = (light.parent && !light.parent.visible) || light.userData.roomDimmed === true;
          return { light, dist2: dx * dx + dz * dz, roomDisabled };
        })
        .sort((a, b) => a.dist2 - b.dist2);

      let activeCount = 0;
      for (const entry of sorted) {
        if (entry.roomDisabled) {
          entry.light.visible = false;
        } else if (activeCount < DungeonPropSystem.MAX_ACTIVE_LIGHTS) {
          entry.light.visible = true;
          activeCount++;
        } else {
          entry.light.visible = false;
        }
      }
    } else {
      for (const light of this.allLights) {
        light.visible = !light.userData.roomDimmed && (light.parent ? light.parent.visible : true);
      }
    }

    // ── Torch flickering ──
    if (this.torchLights.length === 0) return;
    this.torchTime += dt * 12;
    const flickerAmount = 0.15;
    for (const t of this.torchLights) {
      if (!t.light.visible || !t.light.parent || !t.light.parent.visible) continue;
      const time = this.torchTime + t.phase;
      const flicker = 1 + (
        Math.sin(time) * 0.5 +
        Math.sin(time * 2.3) * 0.3 +
        Math.sin(time * 5.7) * 0.2
      ) * flickerAmount;
      t.light.intensity = t.baseIntensity * flicker;
    }
  }

  /** Grid cells (dungeon space gx, gz) that have a floor prop — use to mark those nav cells unwalkable.
   *  Excludes wall_mount props and small decorative items. */
  getPropGridCells(): { gx: number; gz: number }[] {
    return this.props
      .filter(p => p.entry.placement !== 'wall_mount' && !SMALL_ITEM_CATEGORIES.has(p.entry.category))
      .map(p => p.gridCell);
  }

  /** All prop meshes with their placement grid cell for room visibility registration. */
  getAllPropMeshesWithCells(): { mesh: THREE.Mesh; gx: number; gz: number }[] {
    return this.props.map(p => ({ mesh: p.mesh, gx: p.gridCell.gx, gz: p.gridCell.gz }));
  }

  /** All room labels for room visibility registration. */
  getAllLabels(): THREE.Sprite[] {
    return [...this.labels];
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
  getDebrisBoxes(): { x: number; z: number; halfW: number; halfD: number; height: number; exact?: boolean; isProp?: boolean }[] {
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
  getInteractiveChests(): { position: THREE.Vector3; mesh: THREE.Mesh; entity: Entity; openGeo?: THREE.BufferGeometry; variantId: string }[] {
    const out: { position: THREE.Vector3; mesh: THREE.Mesh; entity: Entity; openGeo?: THREE.BufferGeometry; variantId: string }[] = [];
    const worldPos = new THREE.Vector3();
    for (const p of this.props) {
      if (p.entry.category !== 'chest') continue;
      p.mesh.getWorldPosition(worldPos);
      out.push({ position: worldPos.clone(), mesh: p.mesh, entity: p.entity, openGeo: p.openGeo, variantId: p.entry.id });
    }
    return out;
  }

  /** Toggle room name labels on/off (e.g. from voxel dungeon settings). */
  setRoomLabelsVisible(visible: boolean): void {
    for (const label of this.labels) {
      label.userData.labelsDisabled = !visible;
      if (!visible) label.visible = false;
    }
  }

  /** Balance lights per flood-fill region: enforce both a minimum and maximum.
   *  Min = 2 (or 1 for tiny ≤4-cell regions). Max = 4 + floor(cells/12).
   *  Removes most-clustered lights when over max, seeds wall torches when under min. */
  private async balanceRegionLights(
    openGrid: boolean[],
    gridW: number,
    gridH: number,
    gridDoors: { x: number; z: number; orientation: 'NS' | 'EW' }[] | undefined,
    cellSize: number,
    wallHeight: number,
    voxMat: THREE.MeshStandardMaterial,
    toWorldX: (gx: number) => number,
    toWorldZ: (gz: number) => number,
    getFloorY: (gx: number, gz: number) => number,
  ): Promise<void> {
    // Build set of door cell indices (these block flood fill)
    const doorCells = new Set<number>();
    if (gridDoors) {
      for (const door of gridDoors) {
        const gx = Math.round(door.x);
        const gz = Math.round(door.z);
        if (gx >= 0 && gx < gridW && gz >= 0 && gz < gridH) {
          doorCells.add(gz * gridW + gx);
        }
      }
    }

    // BFS flood-fill to partition open cells into connected regions (stopping at doors)
    const regionOf = new Int32Array(gridW * gridH).fill(-1);
    const regionSizes: number[] = [];
    const regionCells: number[][] = []; // cell indices per region
    let regionCount = 0;
    for (let idx = 0; idx < gridW * gridH; idx++) {
      if (!openGrid[idx] || regionOf[idx] >= 0 || doorCells.has(idx)) continue;
      const rid = regionCount++;
      const cells: number[] = [];
      const queue = [idx];
      regionOf[idx] = rid;
      while (queue.length > 0) {
        const cur = queue.pop()!;
        cells.push(cur);
        const cx = cur % gridW;
        const cz = (cur - cx) / gridW;
        for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as [number, number][]) {
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridH) continue;
          const ni = nz * gridW + nx;
          if (!openGrid[ni] || regionOf[ni] >= 0 || doorCells.has(ni)) continue;
          regionOf[ni] = rid;
          queue.push(ni);
        }
      }
      regionSizes.push(cells.length);
      regionCells.push(cells);
    }

    // Group light-source props by region
    const regionLights: Map<number, number[]> = new Map();
    for (let i = 0; i < this.props.length; i++) {
      const p = this.props[i];
      if (!p.entry.lightSource) continue;
      const { gx, gz } = p.gridCell;
      if (gx < 0 || gx >= gridW || gz < 0 || gz >= gridH) continue;
      const rid = regionOf[gz * gridW + gx];
      if (rid < 0) continue;
      let arr = regionLights.get(rid);
      if (!arr) { arr = []; regionLights.set(rid, arr); }
      arr.push(i);
    }

    // ── Phase 1: Remove excess lights ──
    const toRemove: Set<number> = new Set();
    for (const [rid, indices] of regionLights) {
      const cap = 4 + Math.floor((regionSizes[rid] || 0) / 12);
      if (indices.length <= cap) continue;

      // Priority: wall torches are cheapest to lose, then floor candelabra, then surface candelabra (never remove)
      // 0 = wall_mount torch (remove first), 1 = floor candelabra, 2 = surface-mounted (protect)
      const lights = indices.map(i => {
        const p = this.props[i];
        let priority: number;
        if (p.surfaceOf) priority = 2;             // on a table/surface — protect
        else if (p.entry.placement === 'wall_mount') priority = 0; // wall torch — remove first
        else priority = 1;                          // floor candelabra
        return { idx: i, wx: p.mesh.position.x, wz: p.mesh.position.z, minDistSq: Infinity, priority };
      });
      for (let a = 0; a < lights.length; a++) {
        for (let b = a + 1; b < lights.length; b++) {
          const dx = lights[a].wx - lights[b].wx;
          const dz = lights[a].wz - lights[b].wz;
          const dist = dx * dx + dz * dz;
          if (dist < lights[a].minDistSq) lights[a].minDistSq = dist;
          if (dist < lights[b].minDistSq) lights[b].minDistSq = dist;
        }
      }
      // Sort: lowest priority first (wall torches), then most-clustered first
      lights.sort((a, b) => a.priority - b.priority || a.minDistSq - b.minDistSq);
      const removeCount = lights.length - cap;
      for (let r = 0; r < removeCount; r++) {
        // Never remove surface-mounted lights
        if (lights[r].priority >= 2) break;
        toRemove.add(lights[r].idx);
      }
    }

    // Apply removals
    if (toRemove.size > 0) {
      const sortedRemove = [...toRemove].sort((a, b) => b - a);
      for (const idx of sortedRemove) {
        const p = this.props[idx];
        this.removeLightFromProp(p.mesh);
        this.parent.remove(p.mesh);
        if (p.mesh.material instanceof THREE.Material) p.mesh.material.dispose();
        this.props.splice(idx, 1);
      }
    }

    // ── Phase 2: Seed lights in under-lit regions ──
    // Collect existing light world positions per region after removals
    const regionExistingLights: Map<number, { wx: number; wz: number }[]> = new Map();
    for (const p of this.props) {
      if (!p.entry.lightSource) continue;
      const { gx, gz } = p.gridCell;
      if (gx < 0 || gx >= gridW || gz < 0 || gz >= gridH) continue;
      const rid = regionOf[gz * gridW + gx];
      if (rid < 0) continue;
      let arr = regionExistingLights.get(rid);
      if (!arr) { arr = []; regionExistingLights.set(rid, arr); }
      arr.push({ wx: p.mesh.position.x, wz: p.mesh.position.z });
    }

    for (let rid = 0; rid < regionCount; rid++) {
      const size = regionSizes[rid];
      const cap = 4 + Math.floor(size / 12);
      const minLights = Math.max(1, Math.min(cap, 1 + Math.floor(size / 10)));
      const existing = regionExistingLights.get(rid) || [];
      const needed = minLights - existing.length;
      if (needed <= 0) continue;

      // Find wall-adjacent cells in this region to place torches
      const wallCandidates: { gx: number; gz: number; wallSide: 'N' | 'S' | 'E' | 'W'; wx: number; wz: number }[] = [];
      for (const idx of regionCells[rid]) {
        const gx = idx % gridW;
        const gz = (idx - gx) / gridW;
        for (const [side, dx, dz] of [['N', 0, -1], ['S', 0, 1], ['W', -1, 0], ['E', 1, 0]] as ['N' | 'S' | 'E' | 'W', number, number][]) {
          const nx = gx + dx;
          const nz = gz + dz;
          if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridH || !openGrid[nz * gridW + nx]) {
            wallCandidates.push({ gx, gz, wallSide: side, wx: toWorldX(gx), wz: toWorldZ(gz) });
            break;
          }
        }
      }

      if (wallCandidates.length === 0) continue;

      // Greedy farthest-point seeding: each new torch placed at the candidate
      // farthest from all existing + already-seeded lights
      const placedLights: { wx: number; wz: number }[] = [...existing];

      for (let n = 0; n < needed; n++) {
        // Score each candidate by its min distance to any placed light
        let bestIdx = -1;
        let bestDist = -1;
        for (let ci = 0; ci < wallCandidates.length; ci++) {
          const c = wallCandidates[ci];
          let minDist = Infinity;
          for (const l of placedLights) {
            const dx = c.wx - l.wx;
            const dz = c.wz - l.wz;
            const dist = dx * dx + dz * dz;
            if (dist < minDist) minDist = dist;
          }
          // If no existing lights, use distance from region centroid to spread out
          if (placedLights.length === 0) minDist = 0;
          if (minDist > bestDist) {
            bestDist = minDist;
            bestIdx = ci;
          }
        }

        if (bestIdx < 0) break;
        const cell = wallCandidates[bestIdx];
        // Remove chosen candidate so it's not picked again
        wallCandidates.splice(bestIdx, 1);

        const entry = getRandomProp('torch_wall', () => rng.next());
        if (!entry) continue;

        const geo = await loadPropGeo(entry, cellSize);
        if (!geo) continue;

        const mesh = new THREE.Mesh(geo, voxMat.clone());
        mesh.rotation.y = WALL_ROT[cell.wallSide];
        const push = WALL_PUSH[cell.wallSide];
        mesh.position.set(
          cell.wx + push[0] * cellSize * 0.5,
          getFloorY(cell.gx, cell.gz) + (entry.mountHeight ?? 0.5) * wallHeight - cellSize,
          cell.wz + push[1] * cellSize * 0.5,
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.parent.add(mesh);
        this.attachLight(mesh, entry);

        const dummyEntity = new Entity(mesh, { layer: Layer.Prop, radius: 0.01, weight: 0 });
        this.props.push({ mesh, entity: dummyEntity, entry, gridCell: { gx: cell.gx, gz: cell.gz } });
        placedLights.push({ wx: cell.wx, wz: cell.wz });
      }
    }
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

    // Fallback 1: wall props can also use corners (small rooms have mostly corners)
    if (candidates.length === 0 && entry.placement === 'wall') {
      for (let gz = room.z; gz < room.z + room.d; gz++) {
        for (let gx = room.x; gx < room.x + room.w; gx++) {
          if (!openGrid[gz * gridW + gx]) continue;
          if (occupied.has(`${gx},${gz}`)) continue;
          const atLeft = gx === room.x;
          const atRight = gx === room.x + room.w - 1;
          const atTop = gz === room.z;
          const atBottom = gz === room.z + room.d - 1;
          const isEdge = atLeft || atRight || atTop || atBottom;
          if (!isEdge) continue;
          const distN = gz - room.z;
          const distS = (room.z + room.d - 1) - gz;
          const distW = gx - room.x;
          const distE = (room.x + room.w - 1) - gx;
          const min = Math.min(distN, distS, distW, distE);
          let wallSide: 'N' | 'S' | 'E' | 'W';
          if (min === distN) wallSide = 'N';
          else if (min === distS) wallSide = 'S';
          else if (min === distW) wallSide = 'W';
          else wallSide = 'E';
          candidates.push({ gx, gz, wallSide });
        }
      }
    }

    // Fallback 2: any open cell — for center/anywhere/wall props that still couldn't find a spot
    if (candidates.length === 0 && entry.placement !== 'corner' && entry.placement !== 'wall_mount') {
      for (let gz = room.z; gz < room.z + room.d; gz++) {
        for (let gx = room.x; gx < room.x + room.w; gx++) {
          if (!openGrid[gz * gridW + gx]) continue;
          if (occupied.has(`${gx},${gz}`)) continue;
          candidates.push({ gx, gz, wallSide: null });
        }
      }
    }

    if (candidates.length === 0) return null;
    return candidates[Math.floor(rng.next() * candidates.length)];
  }

  /** Place entrance and exit VOX props on wall edges of the designated rooms. */
  private async placeEntranceExit(
    rooms: RoomRect[],
    entranceRoomIdx: number,
    exitRoomIdx: number,
    occupied: Set<string>,
    openGrid: boolean[],
    gridW: number,
    gridH: number,
    cellSize: number,
    halfWorld: number,
    wallHeight: number,
    theme: string,
    getFloorY: (gx: number, gz: number) => number,
  ): Promise<void> {
    if (entranceRoomIdx < 0 || exitRoomIdx < 0) return;
    if (entranceRoomIdx >= rooms.length || exitRoomIdx >= rooms.length) return;

    const toWorldX = (gx: number) => -halfWorld + (gx + 0.5) * cellSize;
    const toWorldZ = (gz: number) => -halfWorld + (gz + 0.5) * cellSize;

    const voxMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.75,
      metalness: 0.1,
    });

    const placePortal = async (
      roomIdx: number,
      isEntrance: boolean,
    ): Promise<void> => {
      const room = rooms[roomIdx];

      // Find a wall-edge cell: room edge cell with a closed neighbor (wall) on one side
      // First pass: unoccupied cells. Second pass: allow occupied cells as fallback.
      let candidates: { gx: number; gz: number; wallSide: 'N' | 'S' | 'E' | 'W' }[] = [];
      for (let pass = 0; pass < 2 && candidates.length === 0; pass++) {
        for (let gz = room.z; gz < room.z + room.d; gz++) {
          for (let gx = room.x; gx < room.x + room.w; gx++) {
            if (!openGrid[gz * gridW + gx]) continue;
            if (pass === 0 && occupied.has(`${gx},${gz}`)) continue;

            // Check all four sides (not else-if, so corners can match multiple)
            if (gz === room.z && (gz - 1 < 0 || !openGrid[(gz - 1) * gridW + gx])) {
              candidates.push({ gx, gz, wallSide: 'N' });
            }
            if (gz === room.z + room.d - 1 && (gz + 1 >= gridH || !openGrid[(gz + 1) * gridW + gx])) {
              candidates.push({ gx, gz, wallSide: 'S' });
            }
            if (gx === room.x && (gx - 1 < 0 || !openGrid[gz * gridW + (gx - 1)])) {
              candidates.push({ gx, gz, wallSide: 'W' });
            }
            if (gx === room.x + room.w - 1 && (gx + 1 >= gridW || !openGrid[gz * gridW + (gx + 1)])) {
              candidates.push({ gx, gz, wallSide: 'E' });
            }
          }
        }
      }

      if (candidates.length === 0) {
        console.warn(`[DungeonProps] No wall-edge cell found for ${isEntrance ? 'entrance' : 'exit'} in room ${roomIdx}`);
        return;
      }

      // Pick a random candidate
      const cell = candidates[Math.floor(rng.next() * candidates.length)];
      occupied.add(`${cell.gx},${cell.gz}`);

      // Block the cell in front of the portal (into the room) so no props spawn there
      const frontPush = WALL_PUSH[cell.wallSide];
      if (frontPush) {
        const fgx = cell.gx - frontPush[0];
        const fgz = cell.gz - frontPush[1];
        occupied.add(`${fgx},${fgz}`);
      }

      // Load entrance VOX tile
      const tileEntry = getRandomTile('entrance', theme);
      if (!tileEntry) return;
      const geo = await loadTileEntry(tileEntry);
      if (!geo) return;

      const mesh = new THREE.Mesh(geo, voxMat.clone());
      const wx = toWorldX(cell.gx);
      const wz = toWorldZ(cell.gz);

      // Rotate to face into the room from the wall
      const faceRot = WALL_ROT[cell.wallSide];
      mesh.rotation.y = faceRot;

      // Push mesh to the wall face
      const push = WALL_PUSH[cell.wallSide];
      mesh.position.set(
        wx + push[0] * cellSize * 0.5,
        getFloorY(cell.gx, cell.gz),
        wz + push[1] * cellSize * 0.5,
      );

      mesh.castShadow = true;
      mesh.receiveShadow = true;

      // Tint exit prop slightly to distinguish it
      if (!isEntrance) {
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.emissive.setHex(0x001133);
        mat.emissiveIntensity = 0.5;
      }

      this.parent.add(mesh);

      // Orb above portal: support bracket + glowing sphere
      const lightColor = isEntrance ? 0xffcc66 : 0x88bbff;
      // Place orb right on top of the portal mesh
      geo.computeBoundingBox();
      const meshTop = mesh.position.y + (geo.boundingBox?.max.y ?? 0.5);
      const orbY = meshTop + 0.1;
      const orbX = mesh.position.x;
      const orbZ = mesh.position.z;

      // Support bracket (thin cylinder from portal top to orb)
      const bracketHeight = 0.1;
      const bracketGeo = new THREE.CylinderGeometry(0.025, 0.035, bracketHeight, 6);
      const bracketMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.6, metalness: 0.4 });
      const bracket = new THREE.Mesh(bracketGeo, bracketMat);
      bracket.position.set(orbX, orbY - bracketHeight * 0.5, orbZ);
      bracket.castShadow = true;
      this.parent.add(bracket);

      // Small base plate where bracket meets the wall
      const plateGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.03, 8);
      const plate = new THREE.Mesh(plateGeo, bracketMat.clone());
      plate.position.set(orbX, orbY - bracketHeight, orbZ);
      this.parent.add(plate);

      // Glowing orb
      const orbGeo = new THREE.SphereGeometry(0.08, 12, 12);
      const orbMat = new THREE.MeshBasicMaterial({ color: lightColor });
      const orb = new THREE.Mesh(orbGeo, orbMat);
      orb.position.set(orbX, orbY, orbZ);
      this.parent.add(orb);

      // Point light emanating from the orb
      const light = new THREE.PointLight(lightColor, 8, cellSize * 6, 1.5);
      light.position.set(orbX, orbY, orbZ);
      this.parent.add(light);
      this.allLights.push(light);

      const dummyEntity = new Entity(mesh, { layer: Layer.Prop, radius: 0.01, weight: 0 });
      this.props.push({ mesh, entity: dummyEntity, entry: { id: tileEntry.id, category: 'entrance', voxPath: tileEntry.voxPath, baseHeight: 1, radius: 0.01, placement: 'wall_mount' as PropPlacement }, gridCell: { gx: cell.gx, gz: cell.gz } });

      // Store positions: spawn in cell center, portal trigger at the wall
      const cellY = getFloorY(cell.gx, cell.gz);
      const spawnPos = new THREE.Vector3(wx, cellY, wz);
      const portalPos = new THREE.Vector3(
        wx + push[0] * cellSize * 0.5,
        cellY,
        wz + push[1] * cellSize * 0.5,
      );
      if (isEntrance) {
        this.entrancePos = spawnPos;
        this.entrancePortalPos = portalPos;
        this.entranceFacing = faceRot;
      } else {
        this.exitPos = spawnPos;
        this.exitPortalPos = portalPos;
        this.exitWallDir = [push[0], push[1]];
      }
    };

    await placePortal(entranceRoomIdx, true);
    await placePortal(exitRoomIdx, false);
  }

  /** World position where the player should spawn (cell center, in front of portal). */
  /** Get room template name for a given room index. Returns undefined for rooms with no template (empty/test). */
  getRoomTemplate(roomIdx: number): string | undefined {
    return this.roomTemplateMap.get(roomIdx);
  }

  /** Get the full room→template map. */
  getRoomTemplateMap(): ReadonlyMap<number, string> {
    return this.roomTemplateMap;
  }

  getEntrancePosition(): THREE.Vector3 | null {
    return this.entrancePos;
  }

  /** World position of the entrance portal wall (trigger point). */
  getEntrancePortalPosition(): THREE.Vector3 | null {
    return this.entrancePortalPos;
  }

  /** Y rotation the entrance faces (into the room). */
  getEntranceFacing(): number {
    return this.entranceFacing;
  }

  /** World position where the player should spawn (cell center, in front of exit). */
  getExitPosition(): THREE.Vector3 | null {
    return this.exitPos;
  }

  /** World position of the exit portal wall (trigger point). */
  getExitPortalPosition(): THREE.Vector3 | null {
    return this.exitPortalPos;
  }

  /** Unit vector [dx, dz] pointing toward the exit wall. */
  getExitWallDir(): [number, number] {
    return this.exitWallDir;
  }

  /** Return all prop entities (for HMR re-registration). */
  getEntities(): Entity[] {
    return this.props.map(p => p.entity);
  }

  /** Get all collectible props (potions, bottles) — can be picked up by player */
  getCollectibleProps(): PlacedProp[] {
    return this.props.filter(p => p.entry.category === 'potion' || p.entry.category === 'bottle');
  }

  /** Silently remove a prop (for collectible pickup — no debris/orphans) */
  removeProp(prop: PlacedProp): void {
    const idx = this.props.indexOf(prop);
    if (idx < 0) return;
    // Clean up potion label
    if (prop.potionLabel) {
      prop.mesh.remove(prop.potionLabel);
      (prop.potionLabel.material as THREE.SpriteMaterial).map?.dispose();
      (prop.potionLabel.material as THREE.SpriteMaterial).dispose();
    }
    // Clean up any attached light
    this.removeLightFromProp(prop.mesh);
    prop.entity.destroy();
    this.parent.remove(prop.mesh);
    (prop.mesh.material as THREE.Material).dispose();
    this.props.splice(idx, 1);
  }

  /** Get all destroyable props (barrels, crates, pots) */
  getDestroyableProps(): PlacedProp[] {
    return this.props.filter(p => p.entry.destroyable);
  }

  /** Destroy a single prop — removes mesh, entity, cleans up.
   *  Returns position, category, and any orphaned tabletop items that were sitting on it. */
  destroyProp(prop: PlacedProp): { position: THREE.Vector3; category: string; orphans: PlacedProp[] } | null {
    const idx = this.props.indexOf(prop);
    if (idx < 0) return null;
    const pos = prop.mesh.position.clone();
    const category = prop.entry.category;

    // Find small items that were sitting on this surface
    const orphans = this.props.filter(p => p.surfaceOf === prop);
    for (const orphan of orphans) {
      orphan.surfaceOf = undefined; // unlink
    }

    // Track destroyed position for serialization
    this.destroyedPositions.push({ x: pos.x, z: pos.z });

    // Clean up any attached light
    this.removeLightFromProp(prop.mesh);
    prop.entity.destroy();
    this.parent.remove(prop.mesh);
    (prop.mesh.material as THREE.Material).dispose();
    // Don't dispose geometry — it's shared via geoCache
    this.props.splice(idx, 1);

    return { position: pos, category, orphans };
  }

  /** Serialize destroyed prop positions */
  serializeDestroyed(): Array<{ x: number; z: number }> {
    return [...this.destroyedPositions];
  }

  /** Remove props that were destroyed in a previous visit */
  restoreDestroyed(saved: Array<{ x: number; z: number }>): void {
    for (const s of saved) {
      // Find closest matching destroyable prop
      let bestDist = Infinity;
      let bestProp: PlacedProp | null = null;
      for (const p of this.props) {
        if (!p.entry.destroyable) continue;
        const dx = p.mesh.position.x - s.x;
        const dz = p.mesh.position.z - s.z;
        const dist = dx * dx + dz * dz;
        if (dist < bestDist) { bestDist = dist; bestProp = p; }
      }
      if (bestProp && bestDist < 0.5) {
        // Also remove orphaned surface items (tabletop items on this prop)
        const orphans = this.props.filter(p => p.surfaceOf === bestProp);
        for (const orphan of orphans) {
          orphan.entity.destroy();
          this.parent.remove(orphan.mesh);
          (orphan.mesh.material as THREE.Material).dispose();
          const oi = this.props.indexOf(orphan);
          if (oi >= 0) this.props.splice(oi, 1);
        }
        // Track as destroyed
        this.destroyedPositions.push({ x: s.x, z: s.z });
        bestProp.entity.destroy();
        this.parent.remove(bestProp.mesh);
        (bestProp.mesh.material as THREE.Material).dispose();
        const idx = this.props.indexOf(bestProp);
        if (idx >= 0) this.props.splice(idx, 1);
      }
    }
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
