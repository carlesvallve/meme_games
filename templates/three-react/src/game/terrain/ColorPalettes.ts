export interface TerrainPalette {
  flat: number;
  gentleSlope: number;
  steepSlope: number;
  cliff: number;
  sand: number;
  wetSand: number;
  waterShallow: number;
  waterDeep: number;
}

export type BiomeType =
  | 'temperate'
  | 'autumn'
  | 'tropical'
  | 'winter'
  | 'desert'
  | 'volcanic'
  | 'barren'
  | 'swamp'
  | 'enchanted';

export const paletteBiome: Record<string, BiomeType> = {
  meadow: 'temperate',
  autumn: 'autumn',
  mars: 'barren',
  obsidian: 'volcanic',
  sands: 'desert',
  snowland: 'winter',
  highlands: 'temperate',
  tropical: 'tropical',
  enchanted: 'enchanted',
  swamp: 'swamp',
  coral: 'tropical',
  ash: 'volcanic',
};

export const palettes: Record<string, TerrainPalette> = {
  // Classic green meadow
  meadow: {
    flat: 0x345a28,
    gentleSlope: 0x3f6630,
    steepSlope: 0x7a7580,
    cliff: 0x908a95,
    sand: 0xc2a55a,
    wetSand: 0x8a7a4a,
    waterShallow: 0x7ad4e0,
    waterDeep: 0x3a9ab5,
  },

  // Autumn — orange/brown fallen leaves, dark bark rock
  autumn: {
    flat: 0x9a6018,
    gentleSlope: 0xb07020,
    steepSlope: 0x5a4035,
    cliff: 0x6a5040,
    sand: 0xd0a040,
    wetSand: 0x907028,
    waterShallow: 0x5aa898,
    waterDeep: 0x286058,
  },

  // Mars — red-orange dust, dark basalt rock, murky water
  mars: {
    flat: 0xa84020,
    gentleSlope: 0xc05028,
    steepSlope: 0x5a2828,
    cliff: 0x6a3830,
    sand: 0xd06830,
    wetSand: 0x904820,
    waterShallow: 0x506070,
    waterDeep: 0x303848,
  },

  // Obsidian — dark volcanic ground, black rock, lava-tinted water
  obsidian: {
    flat: 0x3d4838,
    gentleSlope: 0x485242,
    steepSlope: 0x3a3838,
    cliff: 0x4a4848,
    sand: 0x605850,
    wetSand: 0x484040,
    waterShallow: 0xd04820,
    waterDeep: 0x901a08,
  },

  // Sands — golden desert, sandstone rock, oasis water
  sands: {
    flat: 0xc8a048,
    gentleSlope: 0xd8b058,
    steepSlope: 0xa07840,
    cliff: 0xb88850,
    sand: 0xe0c870,
    wetSand: 0xb8a050,
    waterShallow: 0x48c0c8,
    waterDeep: 0x1878a0,
  },

  // Snowland — white/pale blue snow, icy blue rock, frozen water
  snowland: {
    flat: 0xb8c8d0,
    gentleSlope: 0xc8d4da,
    steepSlope: 0x6878a0,
    cliff: 0x8090b0,
    sand: 0xd8d8d0,
    wetSand: 0xa0b0b8,
    waterShallow: 0x70c0e8,
    waterDeep: 0x3870b0,
  },

  // Highlands — cool mossy blue-green, slate rock
  highlands: {
    flat: 0x2a5a3a,
    gentleSlope: 0x356648,
    steepSlope: 0x606878,
    cliff: 0x787e8a,
    sand: 0xa09870,
    wetSand: 0x707058,
    waterShallow: 0x5ab0c8,
    waterDeep: 0x2a6a90,
  },

  // Tropical — vivid green, tan rock, turquoise lagoon
  tropical: {
    flat: 0x208828,
    gentleSlope: 0x28a030,
    steepSlope: 0x8a8068,
    cliff: 0xa89880,
    sand: 0xe8c860,
    wetSand: 0xb89848,
    waterShallow: 0x40e8d0,
    waterDeep: 0x18a8a0,
  },

  // Enchanted — deep emerald, purple-tinted rock, magical water
  enchanted: {
    flat: 0x206840,
    gentleSlope: 0x288050,
    steepSlope: 0x584068,
    cliff: 0x705888,
    sand: 0xb0a060,
    wetSand: 0x807848,
    waterShallow: 0x7080e8,
    waterDeep: 0x3848b0,
  },

  // Swamp — murky olive, dark mossy rock, brackish water
  swamp: {
    flat: 0x3a4828,
    gentleSlope: 0x445530,
    steepSlope: 0x484838,
    cliff: 0x585848,
    sand: 0x706840,
    wetSand: 0x505030,
    waterShallow: 0x506848,
    waterDeep: 0x2a4028,
  },

  // Coral reef — pink/coral ground, white rock, crystal water
  coral: {
    flat: 0xb06060,
    gentleSlope: 0xc07070,
    steepSlope: 0xc0b0a0,
    cliff: 0xd8d0c8,
    sand: 0xe8c898,
    wetSand: 0xc0a078,
    waterShallow: 0x50e0d8,
    waterDeep: 0x28a0b8,
  },

  // Ash — post-apocalyptic gray, charcoal rock, dark murky water
  ash: {
    flat: 0x585850,
    gentleSlope: 0x636358,
    steepSlope: 0x383838,
    cliff: 0x484848,
    sand: 0x787068,
    wetSand: 0x585048,
    waterShallow: 0x484020,
    waterDeep: 0x282010,
  },
};

const paletteNames = Object.keys(palettes);

/** Pick a random palette. Optionally pass a seed for deterministic selection. */
export function randomPalette(seed?: number): {
  name: string;
  palette: TerrainPalette;
} {
  const idx =
    seed !== undefined
      ? Math.abs(seed) % paletteNames.length
      : Math.floor(Math.random() * paletteNames.length);
  const name = paletteNames[idx];
  return { name, palette: palettes[name] };
}

export const defaultPalette = palettes.meadow;
