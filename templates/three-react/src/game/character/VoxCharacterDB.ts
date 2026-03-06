// ── VOX Character Database ──
// Registry of all VOX characters with personality data for speech bubbles.

/** When/how often to play footstep SFX. */
export type StepMode = 'walker' | 'jumper' | 'flyer';
// - walker: normal steps (each hop half + land on impact)
// - jumper: only play step on landing, half the time (e.g. blob, slob)
// - flyer: no steps (bat, beholder/gazer)

export interface VoxCharEntry {
  id: string;           // e.g. "knight", "blob_a"
  name: string;         // display name: "Knight", "Blob A (Green)"
  category: 'hero' | 'enemy';
  folderPath: string;   // URL path to the VOX folder (URL-encoded for spaces/parens)
  prefix: string;       // file prefix inside VOX folder
  thoughts: string[];   // idle thought bubbles
  exclamations: string[]; // reactions to events (hits, discoveries)
  sounds: string[];     // onomatopoeia / grunts
  /** Footstep frequency / movement mode. Default 'walker'. */
  stepMode: StepMode;
}

const BASE = '/models/Square Dungeon Asset Pack/Characters';

// ── Personality data by archetype ──

type Archetype = keyof typeof PERSONALITIES;

const PERSONALITIES = {
  // ── Heroes ──
  adventurer: {
    thoughts: [
      'Another dungeon, another day.', 'Wonder what\'s around the corner.',
      'I smell treasure.', 'My sword arm itches.', 'This place gives me chills.',
      'I\'ve seen worse.', 'Keep moving forward.', 'Fortune favors the bold.',
    ],
    exclamations: [
      'Ha!', 'Take that!', 'For glory!', 'Not bad!', 'Onward!', 'Got it!',
    ],
    sounds: ['Hah!', 'Hyah!', 'Hmph.', 'Heh.', 'Tch.', '*cracks knuckles*'],
  },
  alchemist: {
    thoughts: [
      'Fascinating compound...', 'I need more reagents.', 'The formula is close.',
      'What would happen if...', 'This could be volatile.', 'Science demands sacrifice.',
      'My notes are smudged.', 'Eureka... almost.',
    ],
    exclamations: [
      'Eureka!', 'Interesting!', 'The reaction!', 'It works!', 'Volatile!', 'Perfect mixture!',
    ],
    sounds: ['*bubble*', '*fizz*', '*pop*', 'Hmm...', '*sizzle*', '*clink*'],
  },
  amazon: {
    thoughts: [
      'The jungle calls.', 'Strength is earned.', 'I fear nothing.',
      'My spear thirsts.', 'The hunt continues.', 'Nature provides.',
      'Weakness is a choice.', 'I am the storm.',
    ],
    exclamations: [
      'HYAAH!', 'For the tribe!', 'Yield!', 'Too slow!', 'My prey!', 'Victory!',
    ],
    sounds: ['Raaah!', 'Hyah!', 'Tsk.', '*war cry*', 'Hmph!', '*stomps*'],
  },
  archer: {
    thoughts: [
      'Wind is shifting.', 'Steady... steady...', 'One shot, one kill.',
      'Eyes on the target.', 'My quiver runs low.', 'Patience is a weapon.',
      'I see everything.', 'Distance is my ally.',
    ],
    exclamations: [
      'Bullseye!', 'Got \'em!', 'Clean shot!', 'Nocked!', 'Target down!', 'Direct hit!',
    ],
    sounds: ['*twang*', '*whoosh*', 'Shh...', '*thwip*', 'Tch.', '*draws bow*'],
  },
  barbarian: {
    thoughts: [
      'SMASH.', 'Too much thinking.', 'Where fight?', 'Me hungry.',
      'This axe needs blood.', 'Talking is boring.', 'Rage building.',
      'Civilization is overrated.',
    ],
    exclamations: [
      'RAAAGH!', 'SMASH!', 'BLOOD!', 'CRUSH!', 'MORE!', 'DESTROY!',
    ],
    sounds: ['GRAAAH!', '*roar*', 'Hrrngh!', 'RAAA!', '*chest pound*', '*grunts*'],
  },
  bard: {
    thoughts: [
      'That would make a great song.', 'La la la...', 'I need new material.',
      'The acoustics here are terrible.', 'Every battle is a verse.',
      'My lute is out of tune.', 'Inspiration strikes!', 'This dungeon lacks ambiance.',
    ],
    exclamations: [
      'Bravo!', 'Encore!', 'What a performance!', 'Spectacular!', 'A tale to tell!', 'Magnificent!',
    ],
    sounds: ['La la la~', '*strums*', 'Tra la la~', '*hums*', '*whistles*', 'Do re mi~'],
  },
  knight: {
    thoughts: [
      'Honor above all.', 'My oath holds.', 'This armor is heavy.',
      'For king and country.', 'Duty calls.', 'A knight never rests.',
      'Chivalry lives.', 'Shield up, always.',
    ],
    exclamations: [
      'For honor!', 'Stand fast!', 'Have at thee!', 'En garde!', 'By my sword!', 'Charge!',
    ],
    sounds: ['*clank*', '*visor up*', 'Hmm.', '*salutes*', '*sword drawn*', '*armor clanks*'],
  },
  mage: {
    thoughts: [
      'The arcane flows here.', 'I sense ley lines.', 'Knowledge is power.',
      'My mana reserves...', 'This spell needs work.', 'Reality is negotiable.',
      'The weave trembles.', 'Fascinating enchantment.',
    ],
    exclamations: [
      'By the arcane!', 'Behold!', 'Power unleashed!', 'Alakazam!', 'Feel my wrath!', 'Ignis!',
    ],
    sounds: ['*crackle*', '*whooom*', 'Hmm...', '*zap*', '*arcane hum*', '*pages flip*'],
  },
  monk: {
    thoughts: [
      'Inner peace.', 'The path is clear.', 'Breathe.',
      'Balance in all things.', 'Mind over matter.', 'Stillness before the storm.',
      'The body is a temple.', 'Discipline conquers all.',
    ],
    exclamations: [
      'KIAI!', 'Flow!', 'Center!', 'Focus!', 'Release!', 'Harmony!',
    ],
    sounds: ['Hm.', 'Om...', '*exhales*', 'Ha!', '*meditates*', '...'],
  },
  necromancer: {
    thoughts: [
      'Death is just a door.', 'The dead whisper to me.', 'Bones remember.',
      'Life is overrated.', 'My minions await.', 'Darkness is comforting.',
      'The grave is patient.', 'Mortality is temporary.',
    ],
    exclamations: [
      'Rise!', 'Serve me!', 'From beyond!', 'Death comes!', 'Obey!', 'The grave speaks!',
    ],
    sounds: ['*dark chuckle*', 'Heh heh...', '*bones rattle*', 'Ssss...', '*whispers*', '*cackle*'],
  },
  priestess: {
    thoughts: [
      'The light guides me.', 'Blessings upon this place.', 'I sense darkness.',
      'Healing is my purpose.', 'Faith sustains.', 'May the light protect.',
      'Evil lurks here.', 'Prayer gives strength.',
    ],
    exclamations: [
      'By the light!', 'Be healed!', 'Blessed!', 'Sacred light!', 'Purify!', 'Divine grace!',
    ],
    sounds: ['*chants*', '*prayer*', 'Mmm...', '*holy glow*', '*blessing*', '*hymn*'],
  },
  rogue: {
    thoughts: [
      'Stay in the shadows.', 'Every lock has a key.', 'Trust no one.',
      'Quick and quiet.', 'Pockets feel light.', 'I was never here.',
      'Everyone has a price.', 'The shadows are my home.',
    ],
    exclamations: [
      'Gotcha!', 'Too easy.', 'Yoink!', 'Swiped!', 'Behind you!', 'Mine now.',
    ],
    sounds: ['*sneaks*', 'Shh...', '*lockpick*', '*vanishes*', 'Heh.', '*coin flip*'],
  },

  // ── Enemies ──
  bat: {
    thoughts: ['Screech.', 'Dark. Good.', 'Echo...', 'Hang here.', 'Wings tired.'],
    exclamations: ['SCREEE!', 'FLAP!', '*swoops*', 'EEE!', 'SKREE!'],
    sounds: ['*flap flap*', '*screech*', '*squeak*', '*flutter*', '*hiss*'],
  },
  beholder: {
    thoughts: [
      'I see all.', 'You are beneath me.', 'My gaze is absolute.',
      'Perfection is lonely.', 'Reality bends to my will.',
    ],
    exclamations: ['GAZE UPON ME!', 'YOU DARE?!', 'WITNESS!', 'INFERIOR!', 'BEHOLD!'],
    sounds: ['*eyes swivel*', '*levitates*', 'Mmmrrr...', '*ray charges*', '*blinks*'],
  },
  blob: {
    thoughts: ['Bloop.', 'Splorch.', 'Absorb?', 'Jiggle.', 'Hungry.', 'Gloop.'],
    exclamations: ['SPLAT!', 'BLOOP!', 'SPLORCH!', 'GLOOP!', 'ABSORB!'],
    sounds: ['*splish*', '*jiggle*', '*bloop*', '*squish*', '*splat*', '*wobble*'],
  },
  bugbear: {
    thoughts: ['Crush puny things.', 'Ambush time.', 'Me strongest.', 'Sneak good.'],
    exclamations: ['RAARGH!', 'CRUSH!', 'SURPRISE!', 'SMASH TINY!', 'GRAAH!'],
    sounds: ['*growls*', 'Grrr...', '*snarls*', '*stomps*', '*snorts*'],
  },
  devil: {
    thoughts: [
      'Your soul looks tasty.', 'Let\'s make a deal.', 'Hellfire warms me.',
      'Mortals amuse me.', 'Contract pending.',
    ],
    exclamations: ['BURN!', 'DEAL!', 'DAMNATION!', 'INFERNO!', 'MWAHAHA!'],
    sounds: ['*cackle*', '*flames crackle*', 'Heh heh...', '*evil laugh*', '*tail swish*'],
  },
  dragon: {
    thoughts: [
      'My hoard grows.', 'Insects, all of them.', 'I am ancient.',
      'Fire is my art.', 'Treasures call to me.',
    ],
    exclamations: ['BURN!', 'INSOLENT!', 'KNEEL!', 'MY TREASURE!', 'RAAAAWR!'],
    sounds: ['*ROAR*', '*breathes fire*', '*rumbles*', '*wings spread*', '*earth shakes*'],
  },
  gargoyle: {
    thoughts: ['Stone. Patient.', 'I watch.', 'Centuries pass.', 'Still. Waiting.'],
    exclamations: ['AWAKEN!', 'STONE FURY!', 'CRUMBLE!', 'SHATTER!'],
    sounds: ['*crumbles*', '*stone grinds*', '*crack*', '*thud*', '...'],
  },
  ghost: {
    thoughts: ['Booo...', 'So cold here.', 'I remember... something.', 'Trapped.', 'Fading...'],
    exclamations: ['BOOOO!', 'LEAVE!', 'HAUNTED!', 'MINE!', 'FOREVER!'],
    sounds: ['*woooo*', '*chains rattle*', '*whispers*', '*fades*', '*chill*'],
  },
  goblin: {
    thoughts: ['Shiny?', 'Stab stab!', 'Me smart.', 'Treasure mine!', 'Hehehe.'],
    exclamations: ['STAB!', 'MINE!', 'SHINY!', 'HEHEHE!', 'GET \'EM!'],
    sounds: ['*cackle*', 'Heh heh!', '*snickers*', '*scurries*', '*giggles*'],
  },
  golem: {
    thoughts: ['Obey.', 'Protect.', 'Crush intruders.', 'Master\'s will.', 'Guard.'],
    exclamations: ['CRUSH!', 'DESTROY!', 'OBEY!', 'PROTECT!', 'SMASH!'],
    sounds: ['*THOOM*', '*grinding*', '*heavy steps*', '*rumbles*', '*earth shakes*'],
  },
  hobgoblin: {
    thoughts: ['Strategy first.', 'Discipline wins.', 'Formation!', 'We are organized.'],
    exclamations: ['ATTACK!', 'FORMATION!', 'CHARGE!', 'DISCIPLINE!', 'ADVANCE!'],
    sounds: ['*war drum*', 'Hrrm.', '*marches*', '*barks orders*', '*horn blows*'],
  },
  hydra: {
    thoughts: ['More heads, more thoughts.', 'We disagree.', 'Hungry x3.', 'Which way?'],
    exclamations: ['BITE!', 'HEADS UP!', 'DEVOUR!', 'MULTIPLY!', 'SNAP!'],
    sounds: ['*hisss*', '*snap snap*', '*multiple roars*', '*heads bicker*', '*snarl*'],
  },
  imp: {
    thoughts: ['Mischief time!', 'Tee hee!', 'Ooh shiny!', 'Prank!', 'Chaos!'],
    exclamations: ['NYAHAHA!', 'GOTCHA!', 'PRANK!', 'CHAOS!', 'MISCHIEF!'],
    sounds: ['*giggles*', 'Tee hee!', '*zips around*', '*evil snicker*', '*poof*'],
  },
  mimic: {
    thoughts: ['Look normal.', 'Be a chest.', 'They always open.', 'Patience...', 'Hungry.'],
    exclamations: ['SURPRISE!', 'CHOMP!', 'NOT A CHEST!', 'GOTCHA!', 'SNAP!'],
    sounds: ['*creaaak*', '*CHOMP*', '*lid snaps*', '*tongue lashes*', '*clicks teeth*'],
  },
  minotaur: {
    thoughts: ['The maze is mine.', 'I smell fear.', 'CHARGE!', 'Lost? Good.'],
    exclamations: ['CHARGE!', 'GORE!', 'TRAMPLE!', 'MY LABYRINTH!', 'RAAAH!'],
    sounds: ['*SNORT*', '*hooves pound*', '*bellows*', '*horns scrape*', '*bull rush*'],
  },
  rat: {
    thoughts: ['Cheese?', 'Skitter.', 'Dark corners.', 'Nibble.', 'Swarm soon.'],
    exclamations: ['SQUEAK!', 'BITE!', 'SWARM!', 'SCATTER!', 'FLEE!'],
    sounds: ['*squeak*', '*skitter*', '*nibble*', '*scratching*', '*chittering*'],
  },
  skeleton: {
    thoughts: ['Rattle.', 'No flesh, no pain.', 'Bony.', 'Calcium deficient.', 'Cold draft.'],
    exclamations: ['CLATTER!', 'BONES!', 'RATTLE!', 'UNDEAD!', 'RISE!'],
    sounds: ['*rattle*', '*clack*', '*bones clatter*', '*jaw drops*', '*reassembles*'],
  },
  slob: {
    thoughts: ['Ooze.', 'Drip.', 'Slow.', 'Absorb.', 'Sticky.', 'Blergh.'],
    exclamations: ['SPLAT!', 'OOZE!', 'ABSORB!', 'BLERGH!', 'DRIP!'],
    sounds: ['*drip*', '*ooze*', '*slurp*', '*squelch*', '*plop*', '*gurgle*'],
  },
  spider: {
    thoughts: ['Web needs fixing.', 'Patient.', 'Eight eyes watching.', 'Silk is art.'],
    exclamations: ['BITE!', 'WEB!', 'TRAPPED!', 'VENOM!', 'ENSNARE!'],
    sounds: ['*skitters*', '*web spins*', '*hisss*', '*clicks*', '*silk stretches*'],
  },
  vampire: {
    thoughts: [
      'The night is young.', 'I thirst.', 'Centuries of boredom.',
      'Sunlight... unpleasant.', 'Your blood sings.',
    ],
    exclamations: ['BLEH!', 'SUBMIT!', 'YOUR BLOOD!', 'ETERNAL!', 'DARKNESS!'],
    sounds: ['*hisss*', '*cape swoosh*', '*fangs extend*', '*bats scatter*', 'Bleh!'],
  },
  werewolf: {
    thoughts: ['Moon rising.', 'The beast stirs.', 'I can smell you.', 'Primal.', 'Hunt.'],
    exclamations: ['AWOOO!', 'HUNT!', 'FERAL!', 'TEAR!', 'PACK!'],
    sounds: ['*HOWL*', '*growls*', '*snarls*', '*sniffs*', '*panting*'],
  },
  wolf: {
    thoughts: ['Pack hunts.', 'Hungry.', 'Scent trail.', 'Alpha leads.', 'Moon.'],
    exclamations: ['AWOOO!', 'SNAP!', 'PACK!', 'HUNT!', 'BITE!'],
    sounds: ['*howl*', '*growl*', '*bark*', '*snarl*', '*whine*', '*pants*'],
  },
  zombie: {
    thoughts: ['Brains...', 'Hnnngh.', 'Hungry.', 'Was I... alive?', 'Shamble.'],
    exclamations: ['BRAAAAINS!', 'HNNNGH!', 'GRAAH!', 'FEED!', 'UUURGH!'],
    sounds: ['*groan*', '*shuffle*', '*moan*', '*gurgle*', '*shambles*'],
  },
} as const;

// Default fallback personality
const DEFAULT_PERSONALITY: Pick<VoxCharEntry, 'thoughts' | 'exclamations' | 'sounds'> = {
  thoughts: ['...', 'Hmm.', '*looks around*', 'Something stirs.'],
  exclamations: ['Ha!', 'Huh!', 'What?!', 'There!'],
  sounds: ['*rustles*', '...', '*shifts*', 'Hmm.'],
};

/** Extract the base archetype name from a folder name. E.g. "Blob A (Green)" -> "blob" */
export function getArchetype(folder: string): string {
  return folder
    .replace(/\s*\([^)]*\)\s*/g, '')  // strip parens: "Blob A (Green)" -> "Blob A"
    .replace(/\s+[A-H]$/i, '')         // strip variant letter: "Blob A" -> "Blob"
    .trim()
    .toLowerCase();
}

/** Step mode by enemy archetype: flyer = no steps, jumper = step only on landing (half the time). */
const STEP_MODE_BY_ARCHETYPE: Partial<Record<Archetype, StepMode>> = {
  bat: 'flyer',
  beholder: 'flyer',
  dragon: 'flyer',
  ghost: 'flyer',
  blob: 'jumper',
  mimic: 'jumper',
  slob: 'walker',
};

/** Per-character animation speed multiplier (critters scurry, heavy monsters lumber). */
const CHARACTER_ANIM_SCALE: Partial<Record<string, number>> = {
  rat: 1.4,
  spider: 1.4,
  imp: 1.3,
  goblin: 1.35,
  blob: 1.2,
  bat: 1.2,
};

/** Get the per-character animation multiplier (1.0 = default). */
export function getCharacterAnimScale(archetype: string): number {
  return CHARACTER_ANIM_SCALE[archetype] ?? 1.0;
}

// ── Slash style per melee archetype ──

import type { SlashStyle } from '../enemies/EnemyVFX';

const SLASH_STYLE_BY_ARCHETYPE: Partial<Record<string, SlashStyle>> = {
  adventurer: 'horizontal', // 'horizontal',
  knight: 'short', // 'vertical',
  barbarian: 'short', // 'vertical',
  amazon: 'thrust',
  rogue: 'short',
  monk: 'short',
};

/** Get the melee slash VFX style for a character archetype. Default 'default' for monsters/unmapped. */
export function getSlashStyle(archetype: string): SlashStyle {
  return SLASH_STYLE_BY_ARCHETYPE[archetype] ?? 'default';
}


function getPersonality(folder: string): Pick<VoxCharEntry, 'thoughts' | 'exclamations' | 'sounds'> {
  const archetype = getArchetype(folder);
  const p = PERSONALITIES[archetype as Archetype];
  if (p) return { thoughts: [...p.thoughts], exclamations: [...p.exclamations], sounds: [...p.sounds] };
  return { ...DEFAULT_PERSONALITY };
}

function heroEntry(folder: string): VoxCharEntry {
  const prefix = folder.toLowerCase().replace(/\s+/g, '_');
  const encoded = encodeURIComponent(folder);
  return {
    id: prefix,
    name: folder,
    category: 'hero',
    folderPath: `${BASE}/Heroes/${encoded}/VOX`,
    prefix,
    ...getPersonality(folder),
    stepMode: 'walker',
  };
}

function enemyEntry(folder: string): VoxCharEntry {
  const stripped = folder.replace(/\s*\([^)]*\)\s*/g, '').trim();
  const prefix = stripped.toLowerCase().replace(/\s+/g, '_');
  const encoded = folder
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
  const archetype = getArchetype(folder) as Archetype;
  return {
    id: prefix + (folder !== stripped ? '_' + folder.match(/\(([^)]*)\)/)?.[1]?.toLowerCase().replace(/\s+/g, '_') : ''),
    name: folder,
    category: 'enemy',
    folderPath: `${BASE}/Enemies/${encoded}/VOX`,
    prefix,
    ...getPersonality(folder),
    stepMode: STEP_MODE_BY_ARCHETYPE[archetype] ?? 'walker',
  };
}

export const VOX_HEROES: VoxCharEntry[] = [
  'Adventurer', 'Alchemist', 'Amazon', 'Archer', 'Barbarian', 'Bard',
  'Knight', 'Mage', 'Monk', 'Necromancer', 'Priestess', 'Rogue',
].map(heroEntry);

export const VOX_ENEMIES: VoxCharEntry[] = [
  'Bat', 'Beholder',
  'Blob A (Green)', 'Blob B (Blue)', 'Blob C (Pink)', 'Blob D (Orange)',
  'Bugbear', 'Devil', 'Dragon', 'Gargoyle', 'Ghost', 'Goblin', 'Golem',
  'Hobgoblin', 'Hydra', 'Imp',
  'Mimic A (Wood)', 'Mimic B (Darkest Wood)', 'Mimic C (Metal)', 'Mimic D (Gold)',
  'Mimic E (Purple)', 'Mimic F (Red)', 'Mimic G (Blue)', 'Mimic H (1 Bit)',
  'Minotaur', 'Rat', 'Skeleton',
  'Slob A (Green)', 'Slob B (Blue)', 'Slob C (Pink)', 'Slob D (Orange)',
  'Spider', 'Vampire', 'Werewolf', 'Wolf', 'Zombie',
].map(enemyEntry);

export const ALL_VOX_CHARACTERS: VoxCharEntry[] = [...VOX_HEROES, ...VOX_ENEMIES];

/** Get the enemy pool filtered by allowed types. Empty allowedTypes = all. */
export function getFilteredEnemies(allowedTypes: string[]): VoxCharEntry[] {
  if (allowedTypes.length === 0) return VOX_ENEMIES;
  const set = new Set(allowedTypes);
  return VOX_ENEMIES.filter(e => set.has(e.id));
}

/** Unique enemy type groups (base archetype → ids). E.g. 'blob' → ['blob_a_green','blob_b_blue',...] */
export function getEnemyTypeGroups(): { label: string; ids: string[] }[] {
  const groups = new Map<string, { label: string; ids: string[] }>();
  for (const e of VOX_ENEMIES) {
    // Use the same archetype extraction as the personality system
    const archetype = getArchetype(e.name);
    let group = groups.get(archetype);
    if (!group) {
      const label = archetype.charAt(0).toUpperCase() + archetype.slice(1);
      group = { label, ids: [] };
      groups.set(archetype, group);
    }
    group.ids.push(e.id);
  }
  return [...groups.values()];
}

export function getRandomVoxChar(): VoxCharEntry {
  return ALL_VOX_CHARACTERS[Math.floor(Math.random() * ALL_VOX_CHARACTERS.length)];
}

// ── Per-Monster Stats (3-Tier System) ────────────────────────────────

export interface MonsterStats {
  tier: 'low' | 'mid' | 'high';
  hp: [number, number];
  mp: [number, number];
  damage: [number, number];
  atkSpeed: [number, number];
  movSpeed: [number, number];
  critChance: number;
  /** Deflect chance 0-1. On deflect: zero damage, "CLANK!" sfx, spark, slight knockback. */
  armour: number;
}

export function randomInRange(range: [number, number]): number {
  return range[0] + Math.random() * (range[1] - range[0]);
}

const MONSTER_STATS: Record<string, MonsterStats> = {
  // ── Low Tier — fragile, fast, swarm-type ──
  // movSpeed range: 1.0–2.5
  rat:     { tier: 'low', hp: [2, 3],  mp: [2, 4], damage: [1, 1], atkSpeed: [1.0, 1.4], movSpeed: [1.9, 2.5], critChance: 0.02, armour: 0 },
  bat:     { tier: 'low', hp: [2, 3],  mp: [2, 4], damage: [1, 2], atkSpeed: [0.8, 1.2], movSpeed: [1.7, 2.3], critChance: 0.02, armour: 0 },
  imp:     { tier: 'low', hp: [2, 3],  mp: [2, 4], damage: [1, 2], atkSpeed: [0.9, 1.3], movSpeed: [1.8, 2.4], critChance: 0.05, armour: 0 },
  goblin:  { tier: 'low', hp: [3, 4],  mp: [2, 4], damage: [1, 2], atkSpeed: [0.7, 1.0], movSpeed: [1.6, 2.1], critChance: 0.03, armour: 0 },
  blob:    { tier: 'low', hp: [3, 5],  mp: [2, 4], damage: [1, 2], atkSpeed: [0.5, 0.7], movSpeed: [1.1, 1.5], critChance: 0.01, armour: 0 }, // fallback
  blob_a:  { tier: 'low', hp: [2, 3],  mp: [2, 4], damage: [1, 1], atkSpeed: [0.5, 0.7], movSpeed: [1.0, 1.3], critChance: 0.01, armour: 0 },
  blob_b:  { tier: 'low', hp: [3, 4],  mp: [2, 4], damage: [1, 2], atkSpeed: [0.5, 0.7], movSpeed: [1.1, 1.4], critChance: 0.01, armour: 0 },
  blob_c:  { tier: 'mid', hp: [4, 6],  mp: [3, 6], damage: [2, 3], atkSpeed: [0.5, 0.7], movSpeed: [1.1, 1.5], critChance: 0.02, armour: 0.05 },
  blob_d:  { tier: 'mid', hp: [5, 8],  mp: [4, 8], damage: [2, 3], atkSpeed: [0.5, 0.7], movSpeed: [1.2, 1.5], critChance: 0.02, armour: 0.10 },
  spider:  { tier: 'low', hp: [2, 4],  mp: [2, 4], damage: [2, 3], atkSpeed: [0.9, 1.2], movSpeed: [1.5, 2.0], critChance: 0.05, armour: 0 },

  // ── Mid Tier — standard dungeon threats ──
  slob:      { tier: 'mid', hp: [7, 10],  mp: [4, 8], damage: [3, 4], atkSpeed: [0.3, 0.5], movSpeed: [1.0, 1.3], critChance: 0.02, armour: 0.25 }, // fallback
  slob_a:    { tier: 'low', hp: [4, 6],   mp: [2, 4], damage: [1, 2], atkSpeed: [0.3, 0.5], movSpeed: [0.9, 1.1], critChance: 0.01, armour: 0.10 },
  slob_b:    { tier: 'mid', hp: [6, 8],   mp: [3, 6], damage: [2, 3], atkSpeed: [0.3, 0.5], movSpeed: [0.9, 1.2], critChance: 0.02, armour: 0.15 },
  slob_c:    { tier: 'mid', hp: [8, 11],  mp: [4, 8], damage: [3, 4], atkSpeed: [0.3, 0.5], movSpeed: [1.0, 1.3], critChance: 0.02, armour: 0.25 },
  slob_d:    { tier: 'high', hp: [10, 14], mp: [6, 10], damage: [4, 5], atkSpeed: [0.3, 0.5], movSpeed: [1.0, 1.3], critChance: 0.03, armour: 0.30 },
  skeleton:  { tier: 'mid', hp: [5, 7],   mp: [4, 8], damage: [2, 3], atkSpeed: [0.6, 0.9], movSpeed: [1.4, 1.8], critChance: 0.05, armour: 0 },
  zombie:    { tier: 'mid', hp: [6, 9],   mp: [4, 8], damage: [2, 3], atkSpeed: [0.4, 0.6], movSpeed: [1.0, 1.3], critChance: 0.02, armour: 0 },
  ghost:     { tier: 'mid', hp: [4, 6],   mp: [4, 8], damage: [2, 4], atkSpeed: [0.6, 0.9], movSpeed: [1.5, 1.9], critChance: 0.05, armour: 0 },
  hobgoblin: { tier: 'mid', hp: [6, 8],   mp: [4, 8], damage: [2, 4], atkSpeed: [0.6, 0.8], movSpeed: [1.4, 1.7], critChance: 0.05, armour: 0.10 },
  wolf:      { tier: 'mid', hp: [5, 7],   mp: [4, 8], damage: [2, 3], atkSpeed: [0.8, 1.1], movSpeed: [1.7, 2.2], critChance: 0.05, armour: 0 },
  werewolf:  { tier: 'mid', hp: [7, 9],   mp: [4, 8], damage: [3, 4], atkSpeed: [0.7, 1.0], movSpeed: [1.6, 2.1], critChance: 0.08, armour: 0 },
  bugbear:   { tier: 'mid', hp: [7, 10],  mp: [4, 8], damage: [3, 5], atkSpeed: [0.4, 0.6], movSpeed: [1.2, 1.5], critChance: 0.05, armour: 0.05 },
  gargoyle:  { tier: 'mid', hp: [8, 11],  mp: [4, 8], damage: [2, 3], atkSpeed: [0.4, 0.6], movSpeed: [1.1, 1.4], critChance: 0.03, armour: 0.30 },

  // ── Mimics — tiered by variant letter (A=weakest, H=strongest) ──
  mimic_a: { tier: 'low',  hp: [3, 4],   mp: [2, 4],  damage: [1, 2], atkSpeed: [0.6, 0.9], movSpeed: [1.3, 1.6], critChance: 0.03, armour: 0 },
  mimic_b: { tier: 'low',  hp: [4, 5],   mp: [2, 4],  damage: [1, 2], atkSpeed: [0.5, 0.8], movSpeed: [1.3, 1.6], critChance: 0.04, armour: 0.05 },
  mimic_c: { tier: 'mid',  hp: [5, 7],   mp: [4, 8],  damage: [2, 3], atkSpeed: [0.5, 0.8], movSpeed: [1.3, 1.6], critChance: 0.05, armour: 0.10 },
  mimic_d: { tier: 'mid',  hp: [6, 9],   mp: [4, 8],  damage: [2, 4], atkSpeed: [0.5, 0.8], movSpeed: [1.4, 1.7], critChance: 0.06, armour: 0.10 },
  mimic_e: { tier: 'high', hp: [7, 10],  mp: [6, 10], damage: [3, 5], atkSpeed: [0.5, 0.8], movSpeed: [1.4, 1.7], critChance: 0.07, armour: 0.12 },
  mimic_f: { tier: 'high', hp: [8, 11],  mp: [6, 10], damage: [3, 5], atkSpeed: [0.5, 0.8], movSpeed: [1.4, 1.7], critChance: 0.08, armour: 0.15 },
  mimic_g: { tier: 'high', hp: [9, 12],  mp: [8, 14], damage: [4, 6], atkSpeed: [0.5, 0.8], movSpeed: [1.4, 1.7], critChance: 0.08, armour: 0.15 },
  mimic_h: { tier: 'high', hp: [10, 14], mp: [8, 14], damage: [4, 6], atkSpeed: [0.5, 0.8], movSpeed: [1.4, 1.7], critChance: 0.10, armour: 0.20 },
  mimic:   { tier: 'mid',  hp: [5, 7],   mp: [4, 8],  damage: [2, 3], atkSpeed: [0.5, 0.8], movSpeed: [1.3, 1.6], critChance: 0.05, armour: 0.10 }, // fallback

  // ── High Tier — elite/boss-class ──
  vampire:  { tier: 'high', hp: [10, 14], mp: [8, 14], damage: [4, 5], atkSpeed: [0.7, 1.0], movSpeed: [1.6, 2.0], critChance: 0.12, armour: 0 },
  devil:    { tier: 'high', hp: [12, 16], mp: [8, 14], damage: [4, 6], atkSpeed: [0.5, 0.8], movSpeed: [1.4, 1.7], critChance: 0.10, armour: 0.10 },
  beholder: { tier: 'high', hp: [10, 14], mp: [8, 14], damage: [5, 7], atkSpeed: [0.4, 0.6], movSpeed: [1.0, 1.3], critChance: 0.08, armour: 0 },
  minotaur: { tier: 'high', hp: [14, 18], mp: [8, 14], damage: [5, 7], atkSpeed: [0.4, 0.6], movSpeed: [1.3, 1.6], critChance: 0.08, armour: 0.10 },
  golem:    { tier: 'high', hp: [16, 22], mp: [8, 14], damage: [4, 6], atkSpeed: [0.3, 0.5], movSpeed: [1.0, 1.2], critChance: 0.03, armour: 0.40 },
  hydra:    { tier: 'high', hp: [14, 18], mp: [8, 14], damage: [4, 6], atkSpeed: [0.7, 1.0], movSpeed: [1.2, 1.5], critChance: 0.10, armour: 0.05 },
  dragon:   { tier: 'high', hp: [18, 25], mp: [8, 14], damage: [6, 8], atkSpeed: [0.5, 0.7], movSpeed: [1.3, 1.7], critChance: 0.15, armour: 0.25 },
};

/** Default fallback for unknown archetypes (mid-tier). */
const DEFAULT_MONSTER_STATS: MonsterStats = {
  tier: 'mid', hp: [5, 7], mp: [4, 8], damage: [2, 3],
  atkSpeed: [0.6, 0.9], movSpeed: [1.4, 1.7], critChance: 0.05, armour: 0,
};

/**
 * Get monster stats. Accepts either a plain archetype ('rat') or a full entry
 * name ('Mimic A (Wood)') — for multi-variant archetypes like mimics, the
 * variant letter is extracted and used for variant-specific stats lookup.
 */
export function getMonsterStats(nameOrArchetype: string): MonsterStats {
  // Direct archetype match (fast path for most enemies)
  if (MONSTER_STATS[nameOrArchetype]) return MONSTER_STATS[nameOrArchetype];
  // Try extracting variant key: "Mimic A (Wood)" → "mimic_a"
  const variantMatch = nameOrArchetype.match(/^(\w+)\s+([A-H])\b/i);
  if (variantMatch) {
    const variantKey = `${variantMatch[1].toLowerCase()}_${variantMatch[2].toLowerCase()}`;
    if (MONSTER_STATS[variantKey]) return MONSTER_STATS[variantKey];
    // Fallback to base archetype
    const base = variantMatch[1].toLowerCase();
    if (MONSTER_STATS[base]) return MONSTER_STATS[base];
  }
  return DEFAULT_MONSTER_STATS;
}

// ── Hero Stats ───────────────────────────────────────────────────────
// Same schema as monsters. Heroes are player-controlled so stats are tuned for survivability.

const HERO_STATS: Record<string, MonsterStats> = {
  adventurer:  { tier: 'mid', hp: [10, 10], mp: [8, 8],  damage: [2, 3], atkSpeed: [1.2, 1.2], movSpeed: [2.6, 2.6], critChance: 0.08, armour: 0.05 },
  alchemist:   { tier: 'mid', hp: [8, 8],   mp: [14, 14], damage: [2, 2], atkSpeed: [1.0, 1.0], movSpeed: [2.4, 2.4], critChance: 0.05, armour: 0 },
  amazon:      { tier: 'mid', hp: [12, 12], mp: [8, 8],  damage: [3, 4], atkSpeed: [1.1, 1.1], movSpeed: [2.7, 2.7], critChance: 0.10, armour: 0.05 },
  archer:      { tier: 'mid', hp: [8, 8],   mp: [10, 10], damage: [3, 3], atkSpeed: [1.0, 1.0], movSpeed: [2.6, 2.6], critChance: 0.12, armour: 0 },
  barbarian:   { tier: 'mid', hp: [14, 14], mp: [6, 6],  damage: [4, 5], atkSpeed: [0.8, 0.8], movSpeed: [2.5, 2.5], critChance: 0.10, armour: 0.10 },
  bard:        { tier: 'mid', hp: [8, 8],   mp: [14, 14], damage: [1, 2], atkSpeed: [1.0, 1.0], movSpeed: [2.6, 2.6], critChance: 0.05, armour: 0 },
  knight:      { tier: 'mid', hp: [14, 14], mp: [8, 8],  damage: [3, 3], atkSpeed: [0.9, 0.9], movSpeed: [2.4, 2.4], critChance: 0.05, armour: 0.20 },
  mage:        { tier: 'mid', hp: [7, 7],   mp: [16, 16], damage: [2, 2], atkSpeed: [1.0, 1.0], movSpeed: [2.1, 2.1], critChance: 0.08, armour: 0 },
  monk:        { tier: 'mid', hp: [10, 10], mp: [12, 12], damage: [2, 3], atkSpeed: [1.4, 1.4], movSpeed: [2.8, 2.8], critChance: 0.12, armour: 0 },
  necromancer: { tier: 'mid', hp: [7, 7],   mp: [16, 16], damage: [2, 2], atkSpeed: [1.0, 1.0], movSpeed: [2.4, 2.4], critChance: 0.08, armour: 0 },
  priestess:   { tier: 'mid', hp: [9, 9],   mp: [14, 14], damage: [1, 2], atkSpeed: [1.0, 1.0], movSpeed: [2.4, 2.4], critChance: 0.05, armour: 0 },
  rogue:       { tier: 'mid', hp: [9, 9],   mp: [10, 10], damage: [2, 3], atkSpeed: [1.3, 1.3], movSpeed: [2.8, 2.8], critChance: 0.15, armour: 0 },
};

/** Look up stats for any character archetype — checks heroes first, then monsters. */
export function getCharacterStats(archetype: string): MonsterStats {
  return HERO_STATS[archetype] ?? MONSTER_STATS[archetype] ?? DEFAULT_MONSTER_STATS;
}
