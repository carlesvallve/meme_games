import type { CharacterModelOpts } from './CharacterModel';

const GLTF_SCALE = 0.2;

/** Shared animation file for all glTF characters (loaded once, cached globally). */
export const GLTF_ANIM_URL = '/models/gltf-chars/shared-anims.glb';

/** Shared animation set GLBs — loaded once and cached globally.
 *  Each contains constraint-retargeted animations for the Imminence skeleton. */
export const ANIM_SETS = [
  { id: 'Idles', url: '/models/scifi-soldiers/anims/Idles.glb' },
  { id: 'Movement', url: '/models/scifi-soldiers/anims/Movement.glb' },
  { id: 'Combat', url: '/models/scifi-soldiers/anims/Combat.glb' },
  { id: 'Social', url: '/models/scifi-soldiers/anims/Social.glb' },
  { id: 'Misc', url: '/models/scifi-soldiers/anims/Misc.glb' },
  { id: 'Work', url: '/models/scifi-soldiers/anims/Work.glb' },
];

export interface CharacterModelDef {
  id: string;
  label: string;
  /** null = placeholder box (no GLB) */
  opts: Omit<CharacterModelOpts, 'onLoaded'> | null;
  /** 'imminence' = CharacterModel (mesh+shared anims), 'gltf' = GltfCharacterModel (self-contained) */
  loader?: 'imminence' | 'gltf';
}

export const CHARACTER_MODELS: CharacterModelDef[] = [
  { id: 'none', label: 'Box (default)', opts: null },
  // ── Imminence (mesh + shared anim GLBs) ──
  {
    id: 'imminence-male',
    label: 'Imminence Male',
    opts: { meshUrl: '/models/scifi-soldiers/Imminence-Update-Male.glb', scale: 0.5, rotation: [0, 0, 0] },
    loader: 'imminence',
  },
  {
    id: 'imminence-female',
    label: 'Imminence Female',
    opts: { meshUrl: '/models/scifi-soldiers/Imminence-Update-Female.glb', scale: 0.5, rotation: [0, 0, 0] },
    loader: 'imminence',
  },
  // ── Pre-retargeted glTF characters (self-contained mesh + animations) ──
  ...makeGltfModels([
    'BaseCharacter',
    'BlueSoldier_Female', 'BlueSoldier_Male',
    'Casual_Bald', 'Casual_Female', 'Casual_Male',
    'Casual2_Female', 'Casual2_Male',
    'Casual3_Female', 'Casual3_Male',
    'Chef_Female', 'Chef_Hat', 'Chef_Male',
    'Cow',
    'Cowboy_Female', 'Cowboy_Hair', 'Cowboy_Male',
    'Doctor_Female_Old', 'Doctor_Female_Young',
    'Doctor_Male_Old', 'Doctor_Male_Young',
    'Elf',
    'Goblin_Female', 'Goblin_Male',
    'Kimono_Female', 'Kimono_Male',
    'Knight_Golden_Female', 'Knight_Golden_Male', 'Knight_Male',
    'Ninja_Female', 'Ninja_Male', 'Ninja_Male_Hair', 'Ninja_Sand', 'Ninja_Sand_Female',
    'OldClassy_Female', 'OldClassy_Male',
    'Pirate_Female', 'Pirate_Male',
    'Pug',
    'Soldier_Female', 'Soldier_Male',
    'Suit_Female', 'Suit_Male',
    'VikingHelmet', 'Viking_Female', 'Viking_Male',
    'Witch', 'Wizard',
    'Worker_Female', 'Worker_Male',
    'Zombie_Female', 'Zombie_Male',
  ]),
];

function makeGltfModels(names: string[]): CharacterModelDef[] {
  return names.map((name) => ({
    id: `gltf-${name.toLowerCase()}`,
    label: name.replace(/_/g, ' '),
    opts: { meshUrl: `/models/gltf-chars/${name}.glb`, scale: GLTF_SCALE, rotation: [0, 0, 0] },
    loader: 'gltf' as const,
  }));
}
