import * as THREE from 'three';
import { VOX_HEROES, type VoxCharEntry } from './VoxCharacterDB';

// ── Character slots ──
// One slot per hero; all VOX_HEROES are shown on the start screen grid.

export type CharacterType =
  | 'slot0' | 'slot1' | 'slot2' | 'slot3' | 'slot4' | 'slot5'
  | 'slot6' | 'slot7' | 'slot8' | 'slot9' | 'slot10' | 'slot11';

const ALL_SLOTS: CharacterType[] = [
  'slot0', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5',
  'slot6', 'slot7', 'slot8', 'slot9', 'slot10', 'slot11',
];

// ── VOX Roster ──
// All heroes in order; each slot maps to one VOX_HEROES entry.

function pickRoster(): Record<CharacterType, VoxCharEntry> {
  return Object.fromEntries(
    ALL_SLOTS.map((slot, i) => [slot, VOX_HEROES[i]]),
  ) as Record<CharacterType, VoxCharEntry>;
}

export let voxRoster: Record<CharacterType, VoxCharEntry> = pickRoster();

export function rerollRoster(): void {
  voxRoster = pickRoster();
}

export function getSlots(): CharacterType[] {
  return ALL_SLOTS;
}

// ── Per-slot colors (fixed for visual distinction) ──

export const CHARACTER_TEAM_COLORS: Record<CharacterType, string> = {
  slot0: '#e94560',
  slot1: '#4a9eff',
  slot2: '#44cc66',
  slot3: '#ffaa22',
  slot4: '#aa66ff',
  slot5: '#ff6b9d',
  slot6: '#00ccaa',
  slot7: '#ff8844',
  slot8: '#88ccff',
  slot9: '#ccff88',
  slot10: '#ffcc00',
  slot11: '#c44',
};

// ── Names from roster ──

export function getCharacterName(type: CharacterType): string {
  return voxRoster[type]?.name ?? type;
}

export const CHARACTER_NAMES: Record<CharacterType, string> = new Proxy(
  {} as Record<CharacterType, string>,
  { get: (_t, prop: string) => voxRoster[prop as CharacterType]?.name ?? prop },
);

// ── Mesh ──

const CHAR_MESH_SCALE = 1;

/** Default character height (VOX models are built at 0.5 target height * mesh scale) */
export const VOX_CHARACTER_HEIGHT = 0.5 * CHAR_MESH_SCALE;

/** Create a placeholder mesh that will be replaced by a VOX skin */
export function createCharacterMesh(): THREE.Mesh {
  const geo = new THREE.BoxGeometry(0.15, 0.3, 0.15);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.scale.setScalar(CHAR_MESH_SCALE);
  return mesh;
}
