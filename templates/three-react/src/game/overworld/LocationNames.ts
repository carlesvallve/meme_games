/**
 * LocationNames — deterministic procedural name generator for overworld locations.
 *
 * Generates evocative fantasy names for:
 *  - Heightmap regions (biome-aware: meadow, desert, snow, etc.)
 *  - Villages / towns
 *  - Dungeon entrances
 *
 * All names are seed-deterministic via mulberry32 PRNG.
 * Uses multiple name patterns per category to avoid repetition.
 */

// ── PRNG ─────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// ── Town / Village name pools ────────────────────────────────────────

// Syllable-based: prefix + suffix → "Thornwick", "Ashford"
const TOWN_PREFIX = [
  // Nature
  'Ash', 'Alder', 'Aspen', 'Birch', 'Bracken', 'Briar', 'Bramble', 'Clover',
  'Elm', 'Elder', 'Fern', 'Fox', 'Glen', 'Hart', 'Hawk', 'Hazel',
  'Heath', 'Heather', 'Holly', 'Ivy', 'Juniper', 'Lark', 'Laurel', 'Lichen',
  'Linden', 'Maple', 'Marsh', 'Marten', 'Moss', 'Nettle', 'Oak', 'Osprey',
  'Otter', 'Owl', 'Pine', 'Raven', 'Reed', 'Rowan', 'Sedge', 'Sage',
  'Swift', 'Tarn', 'Thistle', 'Wren', 'Willow', 'Yew',
  // Landscape
  'Cairn', 'Cliff', 'Crag', 'Dale', 'Drift', 'Dun', 'Fell', 'Glen',
  'Hallow', 'Hollow', 'Knoll', 'Tor', 'Vale', 'Wold', 'Moor',
  // Material / quality
  'Amber', 'Black', 'Brine', 'Cinder', 'Copper', 'Flint', 'Frost', 'Garnet',
  'Gold', 'Grey', 'Iron', 'Jade', 'Peat', 'Silver', 'Stone', 'Thorn',
  // Time / sky
  'Dawn', 'Dusk', 'Ember', 'Mist', 'Moon', 'Night', 'North', 'Shadow',
  'Star', 'Storm', 'Sun', 'Thunder', 'Twilight', 'Wind', 'Winter',
  // Animals
  'Bear', 'Crane', 'Crow', 'Drake', 'Falcon', 'Finch', 'Heron', 'Kite',
  'Lynx', 'Pike', 'Salmon', 'Sparrow', 'Stag', 'Viper', 'Wolf',
  // Misc evocative
  'Bram', 'Kern', 'Quill', 'Wicker', 'Cobble', 'Coppice', 'Forge',
  'Haven', 'Keld', 'Lantern', 'Pebble', 'Pilgrim', 'Rook', 'Sable',
  'Spinner', 'Tallow', 'Umber', 'Weathered', 'Anchor', 'Barrel',
] as const;

const TOWN_SUFFIX = [
  // Anglo-Saxon / Norse
  'ford', 'wick', 'vale', 'mere', 'holm', 'dale', 'moor',
  'fell', 'haven', 'keep', 'stead', 'brook', 'ridge', 'gate',
  'wood', 'crest', 'watch', 'thorpe', 'barrow', 'bury',
  'ton', 'well', 'field', 'cliff', 'march', 'reach',
  'shire', 'hurst', 'ley', 'stow', 'garth', 'by',
  'thwaite', 'ham', 'ness', 'wold', 'den', 'stead',
  // Celtic / broader
  'glen', 'cairn', 'loch', 'burn', 'toft', 'combe',
  'mouth', 'minster', 'bourne', 'ling', 'port', 'way',
  'hold', 'fen', 'spring', 'bridge', 'stone', 'mire',
  'bend', 'bank', 'hall', 'mill', 'hearth', 'light',
] as const;

// "The [Adj] [Noun]" pattern → "The Golden Hearth", "The Broken Shield"
const TOWN_THE_ADJ = [
  'Golden', 'Broken', 'Silver', 'Crimson', 'Twisted', 'Crooked',
  'Rusty', 'Hollow', 'Last', 'First', 'Fallen', 'Weary',
  'Lonely', 'Wandering', 'Sleeping', 'Burning', 'Frozen', 'Hidden',
  'Sunken', 'Ancient', 'Tired', 'Laughing', 'Silent', 'Merry',
  'Drunken', 'Blind', 'Mad', 'Dancing', 'Singing', 'Praying',
  'Gilded', 'Tarnished', 'Shining', 'Faded', 'Leaning', 'Sinking',
  'Winding', 'Painted', 'Weathered', 'Battered', 'Proud', 'Humble',
  'Mossy', 'Dusty', 'Copper', 'Midnight', 'Scarlet', 'Emerald',
  'Grateful', 'Faithful', 'Stubborn', 'Lucky', 'Blessed', 'Cursed',
] as const;

const TOWN_THE_NOUN = [
  // Objects
  'Hearth', 'Shield', 'Crown', 'Lantern', 'Anchor', 'Bell',
  'Throne', 'Anvil', 'Chalice', 'Arrow', 'Horn', 'Drum',
  'Wheel', 'Plow', 'Kettle', 'Barrel', 'Mast', 'Compass',
  'Goblet', 'Hammer', 'Sword', 'Coin', 'Key', 'Candle',
  'Banner', 'Scepter', 'Mirror', 'Loom', 'Cradle', 'Fiddle',
  'Quiver', 'Saddle', 'Spyglass', 'Pendulum', 'Cartwheel', 'Flagon',
  // Structures
  'Oak', 'Willow', 'Bridge', 'Tower', 'Well', 'Gate',
  'Pillar', 'Arch', 'Fountain', 'Chapel', 'Citadel', 'Spire',
  // Animals
  'Stag', 'Boar', 'Falcon', 'Wolf', 'Serpent', 'Fox',
  'Dragon', 'Griffin', 'Phoenix', 'Hound', 'Stallion', 'Raven',
  'Wyvern', 'Owl', 'Bear', 'Lion', 'Hart', 'Crane',
  'Kraken', 'Manticore', 'Basilisk', 'Chimera', 'Pegasus', 'Hydra',
] as const;

// Possessive pattern → "Aldric's Crossing", "Maren's Rest"
const TOWN_PERSON = [
  // Male-coded
  'Aldric', 'Beric', 'Cael', 'Cedric', 'Dunstan', 'Edric',
  'Gareth', 'Hadric', 'Leoric', 'Oswin', 'Ronan', 'Theron',
  'Torvin', 'Wulfric', 'Alaric', 'Beringar', 'Corwin', 'Darian',
  'Ermund', 'Fenwick', 'Godfrey', 'Halvar', 'Idris', 'Jorund',
  'Kael', 'Lothar', 'Merrick', 'Nolan', 'Osric', 'Pellan',
  'Ragnar', 'Soren', 'Thaddeus', 'Ulric', 'Valric', 'Weylan',
  // Female-coded
  'Maren', 'Isolde', 'Elara', 'Brynn', 'Petra', 'Sigrid',
  'Astrid', 'Freya', 'Venna', 'Thyra', 'Mira', 'Seren',
  'Ylva', 'Kira', 'Eirlys', 'Aelith', 'Bronwyn', 'Cressida',
  'Dagna', 'Elowen', 'Fionnuala', 'Gwyneth', 'Helga', 'Ingrid',
  'Jessamine', 'Katla', 'Lyris', 'Morwenna', 'Nerys', 'Oona',
  'Rhiannon', 'Svala', 'Tamsin', 'Una', 'Viveka', 'Winifred',
] as const;

const TOWN_PERSON_SUFFIX = [
  'Crossing', 'Rest', 'Landing', 'Folly', 'Hollow', 'Perch',
  'Watch', 'Stand', 'Post', 'Reach', 'End', 'Bluff',
  'Respite', 'Claim', 'Promise', 'Vigil', 'Refuge', 'Camp',
  'Hope', 'Fortune', 'Legacy', 'Burden', 'Trial', 'Gift',
  'Gambit', 'Grace', 'Anchor', 'Summit', 'Ferry', 'Hold',
  'Triumph', 'Lament', 'Bounty', 'Beacon', 'Venture', 'Return',
] as const;

// ── Region name pools ────────────────────────────────────────────────

const REGION_ADJ = [
  // Mood / atmosphere
  'Verdant', 'Whispering', 'Silent', 'Restless', 'Serene', 'Solemn',
  'Peaceful', 'Ominous', 'Tranquil', 'Brooding', 'Eerie', 'Haunting',
  'Desolate', 'Forlorn', 'Mournful', 'Hallowed', 'Ethereal', 'Eldritch',
  // State / condition
  'Sunken', 'Shattered', 'Broken', 'Withered', 'Blooming', 'Fading',
  'Scarred', 'Blighted', 'Barren', 'Tangled', 'Crumbling', 'Rotting',
  'Petrified', 'Overgrown', 'Flooded', 'Parched', 'Scorched', 'Thriving',
  // Time / age
  'Ancient', 'Forgotten', 'Twilight', 'Moonlit', 'Timeless', 'Primeval',
  'Ageless', 'Newborn', 'Undying', 'Everlasting', 'Dawn-touched', 'Dusk-veiled',
  // Color / light
  'Crimson', 'Golden', 'Emerald', 'Ashen', 'Pale', 'Darkened',
  'Luminous', 'Amber', 'Obsidian', 'Ivory', 'Cobalt', 'Vermilion',
  'Opalescent', 'Tarnished', 'Gleaming', 'Shadowed', 'Radiant', 'Gilded',
  // Elemental
  'Frozen', 'Misty', 'Smoldering', 'Drowned', 'Windswept', 'Storm-torn',
  'Thunder-scarred', 'Rain-soaked', 'Sun-bleached', 'Frost-bitten', 'Flame-kissed',
  // Character
  'Cursed', 'Sacred', 'Hidden', 'Forsaken', 'Wild', 'Lonely',
  'Rugged', 'Harsh', 'Gentle', 'Boundless', 'Endless', 'Winding',
  'Treacherous', 'Merciful', 'Defiant', 'Slumbering', 'Awakening', 'Wounded',
  // Evocative
  'Veiled', 'Shrouded', 'Thorned', 'Weeping', 'Crooked', 'Hollow',
  'Dwindling', 'Sprawling', 'Splintered', 'Stricken', 'Untamed', 'Savage',
  'Benighted', 'Primal', 'Spectral', 'Wraithlike', 'Feywild', 'Arcane',
] as const;

// Biome-specific nouns for heightmap regions
const REGION_NOUNS: Record<string, readonly string[]> = {
  // Green/lush biomes
  meadow: [
    'Meadows', 'Glades', 'Pastures', 'Fields', 'Greens', 'Wilds',
    'Grasslands', 'Lowlands', 'Commons', 'Clearings', 'Lea', 'Downs',
    'Prairies', 'Steppes', 'Veld', 'Heathlands', 'Savanna', 'Champaign',
    'Sward', 'Uplands', 'Tablelands', 'Wolds', 'Dales',
  ],
  highlands: [
    'Highlands', 'Ridges', 'Crags', 'Peaks', 'Bluffs', 'Moors',
    'Plateaus', 'Summits', 'Scarps', 'Cliffs', 'Spires', 'Pinnacles',
    'Escarpments', 'Buttes', 'Aeries', 'Ramparts', 'Parapets', 'Battlements',
    'Heights', 'Crown', 'Citadels', 'Bastions', 'Strongholds',
  ],
  tropical: [
    'Canopy', 'Thicket', 'Jungle', 'Groves', 'Wilds', 'Tangle',
    'Rainwood', 'Fernlands', 'Overgrowth', 'Verdure', 'Tropics', 'Briar',
    'Understory', 'Mangroves', 'Gnarl', 'Labyrinth', 'Eden', 'Paradise',
    'Bower', 'Orchards', 'Vinelands', 'Terrace', 'Cradle',
  ],
  enchanted: [
    'Woods', 'Glens', 'Hollows', 'Groves', 'Thickets', 'Dells',
    'Glade', 'Copse', 'Bower', 'Arbor', 'Sanctuary', 'Wyld',
    'Holt', 'Weald', 'Greenwood', 'Wildwood', 'Deepwood', 'Heartwood',
    'Timberlands', 'Silvans', 'Feywood', 'Dreaming', 'Reverie',
  ],
  swamp: [
    'Marshes', 'Bogs', 'Fens', 'Mires', 'Swamps', 'Sloughs',
    'Wetlands', 'Quagmire', 'Morass', 'Bayou', 'Bottoms', 'Fen',
    'Delta', 'Mangroves', 'Shallows', 'Siltlands', 'Mudflats', 'Backwater',
    'Muskeg', 'Plash', 'Carr', 'Oxbow', 'Washes',
  ],

  // Warm/dry biomes
  autumn: [
    'Reaches', 'Heaths', 'Dales', 'Fells', 'Barrens', 'Downs',
    'Hollows', 'Slopes', 'Timberlands', 'Copperwoods', 'Drifts', 'Vales',
    'Groves', 'Thickets', 'Glens', 'Ridges', 'Braes', 'Leas',
    'Hinterlands', 'Uplands', 'Brakes', 'Coombs', 'Boscage',
  ],
  mars: [
    'Wastes', 'Badlands', 'Flats', 'Barrens', 'Expanse', 'Desolation',
    'Scorch', 'Bluffs', 'Mesa', 'Canyons', 'Gulch', 'Dust',
    'Crucible', 'Furnace', 'Kiln', 'Cauldron', 'Anvil', 'Brimstone',
    'Hellscape', 'Inferno', 'Perdition', 'Devastation', 'Ruin',
  ],
  sands: [
    'Dunes', 'Sands', 'Wastes', 'Flats', 'Expanse', 'Desert',
    'Drift', 'Erg', 'Oasis', 'Mirage', 'Savanna', 'Steppe',
    'Hammada', 'Alkali', 'Playa', 'Wadi', 'Arroyos', 'Tombolo',
    'Simoom', 'Sirocco', 'Caravan', 'Bazaar', 'Souk',
  ],
  coral: [
    'Shores', 'Reefs', 'Shallows', 'Tides', 'Lagoon', 'Coast',
    'Strand', 'Atoll', 'Islets', 'Cove', 'Tidepools', 'Breakers',
    'Archipelago', 'Inlet', 'Estuary', 'Fjord', 'Grotto', 'Shoals',
    'Bight', 'Sound', 'Narrows', 'Passage', 'Drift',
  ],
  ash: [
    'Ashlands', 'Cinders', 'Wastes', 'Char', 'Ruins', 'Scorch',
    'Pyre', 'Embers', 'Fallout', 'Slag', 'Blight', 'Aftermath',
    'Caldera', 'Fumaroles', 'Obsidian Fields', 'Pumice', 'Tephra', 'Crater',
    'Deathlands', 'Scorchmark', 'Sootfall', 'Cinderveil', 'Hearthstone',
  ],

  // Cold/dark biomes
  snowland: [
    'Tundra', 'Wastes', 'Reaches', 'Expanse', 'Glacier', 'Frost',
    'Permafrost', 'Drift', 'Snowfields', 'Icecap', 'Whiteout', 'Floe',
    'Taiga', 'Boreal', 'Firn', 'Moraine', 'Nunatak', 'Serac',
    'Frostbite', 'Rimeland', 'Winterscape', 'Blizzard', 'Hailmark',
  ],
  obsidian: [
    'Depths', 'Void', 'Abyss', 'Darkness', 'Chasm', 'Rift',
    'Umbra', 'Eclipse', 'Nihil', 'Maw', 'Penumbra', 'Shade',
    'Oblivion', 'Terminus', 'Nexus', 'Crucible', 'Maelstrom', 'Vortex',
    'Nadir', 'Perdition', 'Purgatory', 'Limbo', 'Netherreach',
  ],
};

// Fallback nouns for unknown palettes
const REGION_NOUNS_DEFAULT = [
  'Lands', 'Reaches', 'Wilds', 'Expanse', 'Territory', 'Frontier',
  'Domain', 'Province', 'Realm', 'Hinterlands', 'Outskirts', 'Borderlands',
  'Marches', 'Outlands', 'Wilderness', 'Backlands', 'Dominion', 'Tracts',
] as const;

// Style-specific flavor (terraces, islands, caves)
const STYLE_PREFIX: Record<string, readonly string[]> = {
  terraces: [
    'Stepped', 'Tiered', 'Layered', 'Carved', 'Terraced',
    'Ridged', 'Shelved', 'Cascading', 'Stacked', 'Ringed',
    'Benched', 'Graded', 'Sculpted', 'Hewn', 'Chiseled',
  ],
  islands: [
    'Scattered', 'Drifting', 'Sunken', 'Floating', 'Lost',
    'Stranded', 'Divided', 'Fractured', 'Adrift', 'Marooned',
    'Splintered', 'Archipelagic', 'Isolated', 'Shattered', 'Dispersed',
  ],
  caves: [
    'Sunless', 'Deep', 'Hollow', 'Shadowed', 'Buried',
    'Subterranean', 'Cavernous', 'Underground', 'Lightless', 'Echoing',
    'Abyssal', 'Stygian', 'Nether', 'Cthonic', 'Labyrinthine',
  ],
};

// "X of Y" pattern → "Shores of Forgotten Wind"
const REGION_OF_NOUN = [
  // Elements
  'Wind', 'Thunder', 'Frost', 'Flame', 'Mist', 'Storm',
  'Lightning', 'Hail', 'Ember', 'Smoke', 'Rain', 'Snow',
  // Celestial
  'Starlight', 'Moonlight', 'Dusk', 'Dawn', 'Twilight', 'Eclipse',
  'Sunrise', 'Sunset', 'Solstice', 'Equinox', 'Aurora',
  // Abstract / emotional
  'Sorrow', 'Silence', 'Memory', 'Madness', 'Wrath', 'Grace',
  'Hope', 'Despair', 'Regret', 'Longing', 'Defiance', 'Valor',
  'Mercy', 'Vengeance', 'Mourning', 'Reverie', 'Penance', 'Rapture',
  // Material / substance
  'Ruin', 'Glass', 'Iron', 'Bone', 'Stone', 'Crystal',
  'Amber', 'Obsidian', 'Gold', 'Silver', 'Jade', 'Coral',
  'Salt', 'Ash', 'Rust', 'Moss', 'Thorn', 'Bramble',
  // Living
  'Wolves', 'Serpents', 'Ravens', 'Spirits', 'Giants', 'Dragons',
  'Wraiths', 'Phantoms', 'Ancients', 'Elders', 'Titans', 'Behemoths',
  // Concepts
  'Ages', 'Echoes', 'Whispers', 'Lament', 'Song', 'Prophecy',
  'Oath', 'Blood', 'Tears', 'Shadow', 'Light', 'Doom',
] as const;

const REGION_OF_ADJ = [
  'Forgotten', 'Eternal', 'Dying', 'Endless', 'Shattered',
  'Lost', 'Burning', 'Frozen', 'Howling', 'Sleeping',
  'Wandering', 'Fleeting', 'Fading', 'Rising', 'Fallen',
  'Ancient', 'Unending', 'Silent', 'Broken', 'Stolen',
  'Waning', 'Gathering', 'Relentless', 'Ceaseless', 'Undying',
  'Forsaken', 'Whispering', 'Screaming', 'Bleeding', 'Crumbling',
  'Vanishing', 'Lingering', 'Restless', 'Waking', 'Dreaming',
] as const;

// ── Dungeon name pools ───────────────────────────────────────────────

// Pattern 1: "[Place] of [Thing]" → "Crypt of Shadows"
const DUNGEON_PLACE = [
  // Classic
  'Crypt', 'Tomb', 'Vault', 'Pit', 'Lair', 'Den',
  'Catacomb', 'Dungeon', 'Sanctum', 'Shrine', 'Ruins',
  'Keep', 'Depths', 'Hollow', 'Barrow', 'Sepulcher',
  'Grotto', 'Cavern', 'Warren', 'Halls', 'Cistern',
  // Exotic / specific
  'Ossuary', 'Reliquary', 'Undercroft', 'Oubliette',
  'Bastion', 'Labyrinth', 'Necropolis', 'Spire', 'Cellar',
  'Mine', 'Gaol', 'Forge', 'Chapel', 'Archive',
  'Mausoleum', 'Vestibule', 'Athenaeum', 'Aqueduct', 'Ziggurat',
  // Organic / natural
  'Gullet', 'Maw', 'Throat', 'Bowels', 'Nest',
  'Hive', 'Burrow', 'Roost', 'Spawning Pool', 'Cocoon',
  // Arcane / mystic
  'Sanctum', 'Crucible', 'Observatory', 'Orrery', 'Scriptorium',
  'Apothecary', 'Athenaeum', 'Conservatory', 'Menagerie', 'Laboratory',
  // Military
  'Armory', 'Barracks', 'Stockade', 'Rampart', 'Battlement',
  'Garrison', 'Watchtower', 'Bulwark', 'Stronghold', 'Citadel',
] as const;

const DUNGEON_OF = [
  // Classic horror
  'of Shadows', 'of the Fallen', 'of Bones', 'of Whispers',
  'of the Damned', 'of Echoes', 'of Despair', 'of the Lost',
  'of Thorns', 'of Ash', 'of the Forgotten', 'of Dread',
  'of Iron', 'of the Deep', 'of Nightmares', 'of Sorrow',
  'of the Void', 'of Ruin', 'of the Cursed', 'of Flame',
  'of Rot', 'of Teeth', 'of the Blind', 'of Chains',
  // Evocative phrases
  'of Worms', 'of the Hollow King', 'of Broken Oaths',
  'of the Pale', 'of Silence', 'of the Wretched',
  'of Madness', 'of the Nameless', 'of Black Water',
  'of Coiled Serpents', 'of the Withered Hand',
  'of Splintered Crowns', 'of Dripping Walls',
  'of the Unborn', 'of Crawling Things', 'of No Return',
  // Mythic / grand
  'of the Forgotten God', 'of the Last Throne', 'of the Pale Court',
  'of the Iron Maiden', 'of the Shattered Altar', 'of the Blind Prophet',
  'of Twelve Sorrows', 'of the Weeping Saint', 'of Unquiet Dead',
  'of the Drowned Bell', 'of Rusted Crowns', 'of the Severed Tongue',
  // Material / sensory
  'of Amber', 'of Glass', 'of Venom', 'of Plague',
  'of Bile', 'of Mercury', 'of Bloodstone', 'of Brimstone',
  'of Frozen Tears', 'of Liquid Night', 'of Molten Gold',
] as const;

// Pattern 2: "[Adj] [Place]" → "Sunken Sanctum", "Blighted Halls"
const DUNGEON_ADJ = [
  // Decay / ruin
  'Sunken', 'Blighted', 'Forsaken', 'Accursed', 'Ruined',
  'Crumbling', 'Rotting', 'Festering', 'Collapsing', 'Decaying',
  'Corroded', 'Putrid', 'Gangrenous', 'Mouldering', 'Ransacked',
  // Violence / menace
  'Haunted', 'Defiled', 'Shattered', 'Screaming', 'Weeping',
  'Writhing', 'Bleeding', 'Howling', 'Gnawing', 'Starving',
  'Ravaged', 'Pillaged', 'Violated', 'Desecrated', 'Scourged',
  // Elements
  'Flooded', 'Burning', 'Frozen', 'Drowned', 'Smoldering',
  'Scalding', 'Glacial', 'Charred', 'Waterlogged', 'Petrified',
  // Psychological
  'Twisted', 'Nameless', 'Maddening', 'Delirious', 'Fevered',
  'Tormented', 'Deranged', 'Wretched', 'Abhorrent', 'Vile',
  // Arcane
  'Eldritch', 'Profane', 'Unholy', 'Arcane', 'Runic',
  'Hexed', 'Warded', 'Blighted', 'Cursed', 'Consecrated',
] as const;

// Pattern 3: "[Person]'s [Place]" → "Malachar's Tomb", "Thyra's Prison"
const DUNGEON_PERSON = [
  // Villains / warlords
  'Malachar', 'Vorthek', 'Grimjaw', 'Droth', 'Skarn',
  'Ghuldan', 'Corvath', 'Hakkon', 'Quelion', 'Morvaine',
  'Zarathos', 'Nergal', 'Baalgor', 'Thraxxus', 'Drazhar',
  'Krolvax', 'Mordechai', 'Sargoth', 'Vulkanus', 'Zetharak',
  // Sorcerers / mystics
  'Nethys', 'Selvaine', 'Xanthis', 'Nephira', 'Zephira',
  'Aethric', 'Lysara', 'Brythel', 'Kelara', 'Thyra',
  'Vashka', 'Ezara', 'Archimonde', 'Melisandre', 'Nostradamus',
  'Azmodiel', 'Celestine', 'Erebos', 'Hecatrix', 'Mnemosyne',
  // Titles
  'The Worm King', 'The Pale Queen', 'The Blind Oracle',
  'The Iron Bishop', 'The Red Countess', 'The Hollow Man',
  'The Last Abbot', 'The Bone Weaver', 'The Flayed Prince',
  'The Silent Warden', 'The Ash Mother', 'The Starving Lord',
] as const;

const DUNGEON_PERSON_PLACE = [
  'Tomb', 'Prison', 'Folly', 'Descent', 'End',
  'Domain', 'Torment', 'Trial', 'Legacy', 'Doom',
  'Gambit', 'Penance', 'Vigil', 'Labyrinth', 'Maw',
  'Throne', 'Cradle', 'Bargain', 'Reckoning', 'Requiem',
  'Betrayal', 'Ambition', 'Undoing', 'Madness', 'Masterwork',
  'Mistake', 'Sanctuary', 'Cage', 'Nightmare', 'Dominion',
] as const;

// ── World name pools ────────────────────────────────────────────────
// Single strong proper nouns — feel like planet/continent/realm names

const WORLD_NAMES = [
  // Classic fantasy worlds
  'Eldara', 'Valtheim', 'Solanthus', 'Khandara', 'Mythren',
  'Thaloria', 'Caldris', 'Zerathon', 'Veranthos', 'Orthane',
  'Drakenmor', 'Ashenveil', 'Solterra', 'Kaelthrim', 'Valdros',
  // Exotic / alien feel
  'Xyranthos', 'Zephyria', 'Nethara', 'Ulthane', 'Arkonis',
  'Pyratheon', 'Velundra', 'Skarveth', 'Omnithral', 'Cytheron',
  'Aethyris', 'Grymholt', 'Tyvandros', 'Erathis', 'Noxthar',
  // Nordic / harsh
  'Skaldheim', 'Nordmere', 'Frostgard', 'Thornmark', 'Grimvald',
  'Stormgald', 'Ironreach', 'Ashkeld', 'Duskhelm', 'Wyrmbane',
  'Vargath', 'Helvorn', 'Thundral', 'Korvath', 'Draugmar',
  // Elegant / ancient
  'Elarion', 'Celestara', 'Aurethis', 'Ilmandria', 'Sylvanar',
  'Thandoral', 'Vesperion', 'Luminara', 'Aethoria', 'Seraphel',
  'Coranthis', 'Galindor', 'Elyndra', 'Amaranth', 'Pellenor',
  // Dark / ominous
  'Morgathor', 'Nethervast', 'Ashenmaw', 'Dreadmere', 'Voidhollow',
  'Urnathek', 'Blackthorn', 'Darkspire', 'Grimhaven', 'Scourgehold',
  'Banefall', 'Shaderim', 'Hexagoth', 'Maldraxis', 'Necrondus',
  // Earthy / natural
  'Verdantia', 'Willowmere', 'Briarstone', 'Mosshollow', 'Deeproot',
  'Thornvale', 'Hearthglen', 'Oakenfall', 'Fernshade', 'Havenwood',
  'Mistralune', 'Amberveil', 'Sunhallow', 'Goldentide', 'Emberglen',
] as const;

// ── Generators ───────────────────────────────────────────────────────

/** Generate a village/town name from seed. Mostly single compound words. */
export function generateTownName(seed: number): string {
  const rng = mulberry32(seed + 0x7A1E);
  const pattern = rng();

  if (pattern < 0.80) {
    // Syllable combo: "Thornwick", "Ashford", "Ravendale"
    return pick(rng, TOWN_PREFIX) + pick(rng, TOWN_SUFFIX);
  } else if (pattern < 0.90) {
    // Double prefix: "Briarstone", "Ashfern"
    const a = pick(rng, TOWN_PREFIX);
    let b = pick(rng, TOWN_PREFIX);
    while (b === a) b = pick(rng, TOWN_PREFIX);
    return a + b.toLowerCase();
  } else {
    // Two words: "North Haven", "Storm Ridge"
    return pick(rng, TOWN_PREFIX) + ' ' + pick(rng, TOWN_SUFFIX).charAt(0).toUpperCase() + pick(rng, TOWN_SUFFIX).slice(1);
  }
}

/** Generate a name for a place inside a town (tavern, shop, etc.) */
export function generateTownPlaceName(seed: number): string {
  const rng = mulberry32(seed + 0x8B2C);
  const pattern = rng();

  if (pattern < 0.50) {
    // "The [Adj] [Noun]": "The Golden Hearth"
    return 'The ' + pick(rng, TOWN_THE_ADJ) + ' ' + pick(rng, TOWN_THE_NOUN);
  } else if (pattern < 0.80) {
    // Possessive: "Aldric's Crossing"
    return pick(rng, TOWN_PERSON) + "'s " + pick(rng, TOWN_PERSON_SUFFIX);
  } else {
    // "[Adj] [Noun]": "Crooked Lantern"
    return pick(rng, TOWN_THE_ADJ) + ' ' + pick(rng, TOWN_THE_NOUN);
  }
}

/** Generate a dungeon name from seed. Uses multiple patterns for variety. */
export function generateDungeonName(seed: number): string {
  const rng = mulberry32(seed + 0x3D4F);
  const pattern = rng();

  if (pattern < 0.45) {
    // "[Place] of [Thing]": "Crypt of Shadows"
    return pick(rng, DUNGEON_PLACE) + ' ' + pick(rng, DUNGEON_OF);
  } else if (pattern < 0.70) {
    // "[Adj] [Place]": "Sunken Sanctum"
    return pick(rng, DUNGEON_ADJ) + ' ' + pick(rng, DUNGEON_PLACE);
  } else if (pattern < 0.90) {
    // "[Person]'s [Place]": "Malachar's Tomb"
    return pick(rng, DUNGEON_PERSON) + "'s " + pick(rng, DUNGEON_PERSON_PLACE);
  } else {
    // "The [Adj] [Place]": "The Screaming Pit"
    return 'The ' + pick(rng, DUNGEON_ADJ) + ' ' + pick(rng, DUNGEON_PLACE);
  }
}

/**
 * Generate a heightmap region name from seed.
 * Takes palette and style into account for thematic coherence.
 * Uses multiple patterns to avoid "[Adj] [Noun]" monotony.
 */
export function generateRegionName(
  seed: number,
  paletteName: string,
  heightmapStyle: string,
): string {
  const rng = mulberry32(seed + 0x5C2B);
  const nouns = REGION_NOUNS[paletteName] ?? REGION_NOUNS_DEFAULT;
  const pattern = rng();

  if (pattern < 0.40) {
    // "[Adj] [Noun]": "Verdant Meadows"
    const useStyleAdj = rng() < 0.35 && STYLE_PREFIX[heightmapStyle];
    const adj = useStyleAdj
      ? pick(rng, STYLE_PREFIX[heightmapStyle])
      : pick(rng, REGION_ADJ);
    return `${adj} ${pick(rng, nouns)}`;
  } else if (pattern < 0.65) {
    // "[Noun] of [Adj] [Thing]": "Shores of Forgotten Wind"
    const noun = pick(rng, nouns);
    return `${noun} of ${pick(rng, REGION_OF_ADJ)} ${pick(rng, REGION_OF_NOUN)}`;
  } else if (pattern < 0.80) {
    // "The [Adj] [Noun]": "The Whispering Hollows"
    const adj = pick(rng, REGION_ADJ);
    return `The ${adj} ${pick(rng, nouns)}`;
  } else if (pattern < 0.92) {
    // "[Person]'s [Noun]": "Isolde's Reach"
    return `${pick(rng, TOWN_PERSON)}'s ${pick(rng, nouns)}`;
  } else {
    // "[Noun] of [Noun]": "Valley of Bones"
    const noun = pick(rng, nouns);
    return `${noun} of ${pick(rng, REGION_OF_NOUN)}`;
  }
}

// ── Dungeon floor subtitle pools ────────────────────────────────────

const FLOOR_SUBTITLES_EARLY = [
  'The air grows cold.',
  'Shadows cling to the walls.',
  'Something watches from the dark.',
  'The silence is suffocating.',
  'A foul stench rises from below.',
  'Torches flicker and die.',
  'The walls weep with moisture.',
  'Distant echoes of chains.',
  'Your footsteps echo endlessly.',
  'The darkness breathes.',
  'Bones crunch underfoot.',
  'A chill wind from nowhere.',
  'The stone hums with old magic.',
  'Rats scatter at your approach.',
  'The ceiling drips with something warm.',
] as const;

const FLOOR_SUBTITLES_MID = [
  'Something stirs in the darkness.',
  'The walls are carved with warnings.',
  'Old blood stains the floor.',
  'The dead do not rest here.',
  'A presence watches, waiting.',
  'The air tastes of iron.',
  'Whispers from every direction.',
  'The ground trembles faintly.',
  'Ancient wards crumble to dust.',
  'The path behind you fades.',
  'Scratching sounds within the walls.',
  'An unnatural warmth from below.',
  'The shadows move on their own.',
  'A low growl reverberates.',
  'Something ancient was disturbed.',
] as const;

const FLOOR_SUBTITLES_FINAL = [
  "You've reached the heart.",
  'The source of darkness awaits.',
  'This is where it ends.',
  'No turning back now.',
  'The final chamber looms.',
  'An ancient evil stirs.',
  'The master of this place waits.',
  'The deepest dark.',
  'All paths lead here.',
  'The culmination of dread.',
] as const;

/** Generate a seed-deterministic atmospheric subtitle for a dungeon floor. */
export function generateDungeonFloorSubtitle(
  seed: number, floor: number, totalFloors: number,
): string {
  const rng = mulberry32(seed + floor * 0x1337);
  if (floor >= totalFloors) return pick(rng, FLOOR_SUBTITLES_FINAL);
  if (floor === 1 || totalFloors <= 2) return pick(rng, FLOOR_SUBTITLES_EARLY);
  return pick(rng, FLOOR_SUBTITLES_MID);
}

/** Generate a world name from seed. Strong single proper nouns. */
export function generateWorldName(seed: number): string {
  const rng = mulberry32(seed + 0xAE3F);
  return pick(rng, WORLD_NAMES);
}
