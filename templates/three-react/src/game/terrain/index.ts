// Re-export Environment as Terrain for backward compatibility
// export { Environment as Terrain } from '../environment';
export type { TerrainPreset, DebrisBox } from '../environment';
export type { HeightmapStyle } from './TerrainNoise';
export { randomPalette, palettes, paletteBiome, defaultPalette } from './ColorPalettes';
export type { TerrainPalette, BiomeType } from './ColorPalettes';
export { WaterSystem } from './WaterSystem';
export { HeightmapBuilder } from './HeightmapBuilder';
export { BoxPlacer } from './BoxPlacer';
