import * as THREE from 'three';
import { VOX_HEROES, VOX_ENEMIES, getArchetype, type VoxCharEntry } from './VoxCharacterDB';

// ── Character slots ──
// 12 hero slots (one per hero archetype) + 8 monster slots (random unique enemy archetypes).

export type CharacterType =
  | 'slot0' | 'slot1' | 'slot2' | 'slot3' | 'slot4' | 'slot5'
  | 'slot6' | 'slot7' | 'slot8' | 'slot9' | 'slot10' | 'slot11'
  | 'slot12' | 'slot13' | 'slot14' | 'slot15' | 'slot16' | 'slot17'
  | 'slot18' | 'slot19' | 'slot20' | 'slot21' | 'slot22' | 'slot23';

const HERO_SLOTS: CharacterType[] = [
  'slot0', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5',
  'slot6', 'slot7', 'slot8', 'slot9', 'slot10', 'slot11',
];

const MONSTER_SLOTS: CharacterType[] = [
  'slot12', 'slot13', 'slot14', 'slot15', 'slot16', 'slot17',
  'slot18', 'slot19', 'slot20', 'slot21', 'slot22', 'slot23',
];

const ALL_SLOTS: CharacterType[] = [...HERO_SLOTS, ...MONSTER_SLOTS];

// ── VOX Roster ──
// Heroes: one per archetype (random variant if multiple exist).
// Monsters: 8 random unique enemy archetypes (random variant each).

function pickRoster(): Record<CharacterType, VoxCharEntry> {
  // Heroes — shuffle and assign one per hero slot
  const heroShuffled = [...VOX_HEROES].sort(() => Math.random() - 0.5);
  const heroEntries = HERO_SLOTS.map((slot, i) => [slot, heroShuffled[i % heroShuffled.length]]);

  // Monsters — group enemies by archetype, pick 8 random unique archetypes
  const enemyGroups = new Map<string, VoxCharEntry[]>();
  for (const entry of VOX_ENEMIES) {
    const archetype = getArchetype(entry.name);
    let group = enemyGroups.get(archetype);
    if (!group) { group = []; enemyGroups.set(archetype, group); }
    group.push(entry);
  }

  // Pick one random variant per archetype, shuffle, take 8
  const uniqueEnemies = [...enemyGroups.values()]
    .map(variants => variants[Math.floor(Math.random() * variants.length)])
    .sort(() => Math.random() - 0.5)
    .slice(0, MONSTER_SLOTS.length);

  const monsterEntries = MONSTER_SLOTS.map((slot, i) => [slot, uniqueEnemies[i % uniqueEnemies.length]]);

  return Object.fromEntries([...heroEntries, ...monsterEntries]) as Record<CharacterType, VoxCharEntry>;
}

/** Re-roll only monster slots, keeping heroes the same. */
export function rerollMonsters(): void {
  const enemyGroups = new Map<string, VoxCharEntry[]>();
  for (const entry of VOX_ENEMIES) {
    const archetype = getArchetype(entry.name);
    let group = enemyGroups.get(archetype);
    if (!group) { group = []; enemyGroups.set(archetype, group); }
    group.push(entry);
  }

  const uniqueEnemies = [...enemyGroups.values()]
    .map(variants => variants[Math.floor(Math.random() * variants.length)])
    .sort(() => Math.random() - 0.5)
    .slice(0, MONSTER_SLOTS.length);

  for (let i = 0; i < MONSTER_SLOTS.length; i++) {
    voxRoster[MONSTER_SLOTS[i]] = uniqueEnemies[i % uniqueEnemies.length];
  }
  _wr.__voxRoster = voxRoster;
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

export function getHeroSlots(): CharacterType[] {
  return HERO_SLOTS;
}

export function getMonsterSlots(): CharacterType[] {
  return MONSTER_SLOTS;
}

// ── Per-slot colors (fixed for visual distinction) ──

export const CHARACTER_TEAM_COLORS: Record<CharacterType, string> = {
  // Heroes
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
  slot11: '#ff5577',
  // Monsters
  slot12: '#cc4444',
  slot13: '#8844aa',
  slot14: '#44aa88',
  slot15: '#aa8844',
  slot16: '#4488cc',
  slot17: '#aa4488',
  slot18: '#88aa44',
  slot19: '#cc8844',
  slot20: '#6644cc',
  slot21: '#cc6666',
  slot22: '#44cccc',
  slot23: '#aaaa44',
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
