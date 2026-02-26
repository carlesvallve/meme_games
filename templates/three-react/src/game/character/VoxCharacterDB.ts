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
function getArchetype(folder: string): string {
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

export function getRandomVoxChar(): VoxCharEntry {
  return ALL_VOX_CHARACTERS[Math.floor(Math.random() * ALL_VOX_CHARACTERS.length)];
}
