import type { CharacterModelOpts } from './CharacterModel';


/** Shared animation file for all glTF characters (loaded once, cached globally). */
export const GLTF_ANIM_URL = '/models/q-casual/shared-anims.glb';

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
  category: string;
  /** null = placeholder box (no GLB) */
  opts: Omit<CharacterModelOpts, 'onLoaded'> | null;
  /** 'imminence' = CharacterModel (mesh+shared anims), 'gltf' = GltfCharacterModel (self-contained) */
  loader?: 'imminence' | 'gltf';
  dummyShape?: 'box' | 'capsule' | 'arrow';
  dummyColor?: number;
}

const DUMMY_SHAPES = ['box', 'capsule', 'arrow'] as const;
const DUMMY_COLORS: [string, number][] = [
  ['Red', 0xff4444], ['Blue', 0x4488ff], ['Green', 0x44ff44],
  ['Yellow', 0xffff44], ['Purple', 0xaa44ff], ['Orange', 0xff8844],
];

function makeDummyModels(): CharacterModelDef[] {
  const models: CharacterModelDef[] = [];
  for (const shape of DUMMY_SHAPES) {
    for (const [colorName, colorHex] of DUMMY_COLORS) {
      models.push({
        id: `dummy-${shape}-${colorName.toLowerCase()}`,
        label: `${shape[0].toUpperCase() + shape.slice(1)} ${colorName}`,
        category: 'Dummy',
        opts: null,
        dummyShape: shape,
        dummyColor: colorHex,
      });
    }
  }
  return models;
}

function makeGltfModels(
  names: string[], category: string,
  basePath = '/models/q-casual',
  fixDoubleLinear = false,
  sharedAnimUrl?: string,
): CharacterModelDef[] {
  return names.map((name) => ({
    id: `gltf-${category.toLowerCase()}-${name.toLowerCase()}`,
    label: name.replace(/_/g, ' '),
    category,
    opts: {
      meshUrl: `${basePath}/${name}.glb`,
      rotation: [0, 0, 0] as [number, number, number],
      fixDoubleLinear,
      ...(sharedAnimUrl ? { sharedAnimUrl } : {}),
    },
    loader: 'gltf' as const,
  }));
}

export const CHARACTER_MODELS: CharacterModelDef[] = [
  ...makeDummyModels(),

  // ── Quaternius (shared-anim retargeted characters) ──
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
  ], 'Q-Casual', '/models/q-casual', true),

  // ── Q-Apocalypse ──
  ...makeGltfModels([
    'Characters_Lis', 'Characters_Lis_SingleWeapon',
    'Characters_Matt', 'Characters_Matt_SingleWeapon',
    'Characters_Sam', 'Characters_Sam_SingleWeapon',
    'Characters_Shaun', 'Characters_Shaun_SingleWeapon',
  ], 'Q-Apocalypse', '/models/q-apocalypse', false,
    '/models/q-apocalypse/shared-anims.glb'),
  // Q-Apocalypse self-contained (unique rigs)
  ...makeGltfModels([
    'Characters_GermanShepherd', 'Characters_Pug',
    'Zombie_Arm', 'Zombie_Basic', 'Zombie_Chubby', 'Zombie_Ribcage',
  ], 'Q-Apocalypse', '/models/q-apocalypse'),

  // ── Q-CubeWorld ──
  ...makeGltfModels([
    'Character_Female_1', 'Character_Female_2', 'Character_Male_1', 'Character_Male_2',
  ], 'Q-CubeWorld', '/models/q-cubeworld', false,
    '/models/q-cubeworld/shared-anims-2.glb'),
  ...makeGltfModels([
    'Demon', 'Giant', 'Goblin', 'Skeleton', 'Skeleton_Armor',
    'Wizard', 'Yeti', 'Zombie',
  ], 'Q-CubeWorld', '/models/q-cubeworld', false,
    '/models/q-cubeworld/shared-anims-4.glb'),
  ...makeGltfModels([
    'Cat', 'Dog', 'Raccoon', 'Sheep', 'Wolf',
  ], 'Q-CubeWorld', '/models/q-cubeworld', false,
    '/models/q-cubeworld/shared-anims-1.glb'),
  // Q-CubeWorld self-contained (unique rigs)
  ...makeGltfModels([
    'Chick', 'Chicken', 'Horse', 'Pig', 'Hedgehog',
  ], 'Q-CubeWorld', '/models/q-cubeworld'),

  // ── Q-Animals ──
  ...makeGltfModels([
    'Donkey', 'Horse', 'Horse_White',
  ], 'Q-Animals', '/models/q-animals', false,
    '/models/q-animals/shared-anims.glb'),
  // Q-Animals self-contained (unique rigs)
  ...makeGltfModels([
    'Alpaca', 'Bull', 'Cow', 'Deer', 'Fox',
    'Husky', 'ShibaInu', 'Stag', 'Wolf',
  ], 'Q-Animals', '/models/q-animals'),

  // ── Q-Cyberpunk (self-contained animations) ──
  ...makeGltfModels([
    'Character',
    'Enemy_2Legs', 'Enemy_2Legs_Gun', 'Enemy_Flying', 'Enemy_Flying_Gun',
    'Enemy_Large', 'Enemy_Large_Gun',
    'Turret_Cannon', 'Turret_Gun', 'Turret_GunDouble', 'Turret_Teleporter',
  ], 'Q-Cyberpunk', '/models/q-cyberpunk'),

  // ── Q-SpaceKit ──
  ...makeGltfModels([
    'Astronaut_BarbaraTheBee', 'Astronaut_FernandoTheFlamingo',
    'Astronaut_FinnTheFrog', 'Astronaut_RaeTheRedPanda',
    'Enemy_Large',
  ], 'Q-SpaceKit', '/models/q-spacekit', false,
    '/models/q-spacekit/shared-anims.glb'),
  ...makeGltfModels([
    'Mech_BarbaraTheBee', 'Mech_FernandoTheFlamingo',
    'Mech_FinnTheFrog', 'Mech_RaeTheRedPanda',
  ], 'Q-SpaceKit', '/models/q-spacekit', false,
    '/models/q-spacekit/shared-anims-4.glb'),
  // Q-SpaceKit self-contained (unique rigs)
  ...makeGltfModels([
    'Enemy_ExtraSmall', 'Enemy_Flying', 'Enemy_Small',
  ], 'Q-SpaceKit', '/models/q-spacekit'),

  // ── Q-LowPoly Men ──
  ...makeGltfModels([
    'Adventurer', 'Beach', 'Casual_2', 'Casual_Hoodie', 'Farmer',
    'King', 'Punk', 'Spacesuit', 'Suit', 'Swat', 'Worker',
  ], 'Q-LowPoly Men', '/models/q-lowpolymen', false,
    '/models/q-lowpolymen/shared-anims.glb'),

  // ── Q-LowPoly Women ──
  ...makeGltfModels([
    'Adventurer', 'Casual', 'Formal', 'Medieval', 'Punk',
    'SciFi', 'Soldier', 'Suit', 'Witch', 'Worker',
  ], 'Q-LowPoly Women', '/models/q-lowpolywomen', false,
    '/models/q-lowpolywomen/shared-anims.glb'),

  // ── Q-Robots ──
  ...makeGltfModels([
    'Flat_Mike', 'Flat_Stan', 'Tex_Mike', 'Tex_Stan',
  ], 'Q-Robots', '/models/q-robots', false,
    '/models/q-robots/shared-anims.glb'),
  // Q-Robots self-contained (unique rigs)
  ...makeGltfModels([
    'Tex_George', 'Tex_Leela', 'Flat_George', 'Flat_Leela',
  ], 'Q-Robots', '/models/q-robots'),

  // ── Q-Shooter (self-contained animations) ──
  ...makeGltfModels([
    'Character_Enemy', 'Character_Hazmat', 'Character_Soldier',
  ], 'Q-Shooter', '/models/q-shooter'),

  // ── Q-Monsters (Big rig) ──
  ...makeGltfModels([
    'Big_Alien', 'Big_Birb', 'Big_BlueDemon', 'Big_Cactoro',
    'Big_Demon', 'Big_Dino', 'Big_Fish', 'Big_Frog', 'Big_Monkroose',
    'Big_MushroomKing', 'Big_Ninja', 'Big_Orc', 'Big_Orc_Skull', 'Big_Tribal', 'Big_Yeti',
  ], 'Q-Monsters', '/models/q-monsters', false,
    '/models/q-monsters/shared-anims-1.glb'),
  // Q-Monsters (Blob rig)
  ...makeGltfModels([
    'Blob_Alien', 'Blob_Birb', 'Blob_Cactoro', 'Blob_Cat', 'Blob_Chicken',
    'Blob_Dog', 'Blob_Fish', 'Blob_GreenBlob', 'Blob_GreenSpikyBlob',
    'Blob_Mushnub', 'Blob_Mushnub_Evolved', 'Blob_Ninja', 'Blob_Orc',
    'Blob_Pigeon', 'Blob_PinkBlob', 'Blob_Wizard', 'Blob_Yeti',
  ], 'Q-Monsters', '/models/q-monsters', false,
    '/models/q-monsters/shared-anims-3.glb'),
  // Q-Monsters (Flying small rig)
  ...makeGltfModels([
    'Flying_Alpaking', 'Flying_Alpaking_Evolved', 'Flying_Armabee', 'Flying_Armabee_Evolved',
    'Flying_Dragon', 'Flying_Glub', 'Flying_Glub_Evolved',
    'Flying_Goleling', 'Flying_Goleling_Evolved', 'Flying_Pigeon',
  ], 'Q-Monsters', '/models/q-monsters', false,
    '/models/q-monsters/shared-anims-4.glb'),
  // Q-Monsters (Flying ghost rig)
  ...makeGltfModels([
    'Flying_Ghost', 'Flying_Ghost_Skull', 'Flying_Hywirl', 'Flying_Tribal',
  ], 'Q-Monsters', '/models/q-monsters', false,
    '/models/q-monsters/shared-anims-7.glb'),
  // Q-Monsters self-contained (unique rigs)
  ...makeGltfModels([
    'Big_Bunny',
    'Flying_Demon', 'Flying_Dragon_Evolved', 'Flying_Squidle',
  ], 'Q-Monsters', '/models/q-monsters'),
];

export const MODEL_CATEGORIES = [...new Set(CHARACTER_MODELS.map(m => m.category))];
