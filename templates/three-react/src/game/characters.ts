import * as THREE from 'three';
import { VOX_HEROES, type VoxCharEntry } from './VoxCharacterDB';

// ── Character slots ──
// Internal identifiers for the 4 character slots.
// Visual appearance comes from the VOX roster, not these names.

export type CharacterType = 'slot0' | 'slot1' | 'slot2' | 'slot3';

const ALL_SLOTS: CharacterType[] = ['slot0', 'slot1', 'slot2', 'slot3'];

// ── VOX Roster ──
// 4 randomly-picked unique heroes assigned to each slot.

function pickRoster(): Record<CharacterType, VoxCharEntry> {
  const shuffled = [...VOX_HEROES].sort(() => Math.random() - 0.5);
  return Object.fromEntries(
    ALL_SLOTS.map((slot, i) => [slot, shuffled[i]]),
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
