import * as THREE from 'three';
import { ALL_VOX_CHARACTERS, getArchetype, type VoxCharEntry } from './VoxCharacterDB';

// ── Character slots ──
// One slot per hero; all VOX_HEROES are shown on the start screen grid.

export type CharacterType =
  | 'slot0' | 'slot1' | 'slot2' | 'slot3' | 'slot4' | 'slot5'
  | 'slot6' | 'slot7' | 'slot8' | 'slot9' | 'slot10';

const ALL_SLOTS: CharacterType[] = [
  'slot0', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5',
  'slot6', 'slot7', 'slot8', 'slot9', 'slot10',
];

// ── VOX Roster ──
// Each slot maps to a unique character *type* (archetype).
// If a type has variants (e.g. Blob A/B/C/D), one is picked at random.

function pickRoster(): Record<CharacterType, VoxCharEntry> {
  // Group all characters by base archetype
  const groups = new Map<string, VoxCharEntry[]>();
  for (const entry of ALL_VOX_CHARACTERS) {
    const archetype = getArchetype(entry.name);
    let group = groups.get(archetype);
    if (!group) { group = []; groups.set(archetype, group); }
    group.push(entry);
  }

  // Pick one random variant per archetype, then shuffle
  const uniqueTypes = [...groups.values()].map(
    variants => variants[Math.floor(Math.random() * variants.length)],
  );
  const shuffled = uniqueTypes.sort(() => Math.random() - 0.5);

  return Object.fromEntries(
    ALL_SLOTS.map((slot, i) => [slot, shuffled[i % shuffled.length]]),
  ) as Record<CharacterType, VoxCharEntry>;
}

// Persist roster across Vite HMR so character skins don't reshuffle on code edits
const _wr = window as unknown as { __voxRoster?: Record<CharacterType, VoxCharEntry> };
if (!_wr.__voxRoster) _wr.__voxRoster = pickRoster();
export let voxRoster: Record<CharacterType, VoxCharEntry> = _wr.__voxRoster;

export function rerollRoster(): void {
  voxRoster = pickRoster();
  _wr.__voxRoster = voxRoster;
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
