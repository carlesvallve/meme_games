// Dungeon generation
export { generateDungeon, generateBSPDungeon, convertToBoxDefs } from './DungeonGenerator';
export type { BoxDef, WalkMask, DoorDef, DungeonOutput, DungeonResult } from './DungeonGenerator';

// Voxel dungeon
export { buildVoxelDungeonCollision, loadVoxelDungeonVisuals, swapGroundTiles } from './VoxelDungeon';
export type { VoxelDungeonConfig, VoxelDungeonResult, VoxelDungeonVisualResult } from './VoxelDungeon';

// Voxel dungeon DB
export { DUNGEON_VARIANTS, getDungeonTiles, getAllThemePaths, getRandomTile, getTileById, getFirstTile } from './VoxDungeonDB';
export { getPropsForCategory, getRandomProp, extractPropStyle, getRandomPropStyled, getPropById, getChestTier } from './VoxDungeonDB';
export { getAllPropPaths, getGroundTileIds, getPropCategories, getPropsWhere, getDungeonVariants } from './VoxDungeonDB';
export type { TileRole, DungeonTileEntry, PropPlacement, DungeonPropEntry, DungeonVariant, ChestTier } from './VoxDungeonDB';

// Voxel dungeon loader
export { preloadTheme, getTileGeometry, loadTileEntry, setCellSize, getCellSize, getWallTargetHeight, getGroundTargetHeight, clearCache } from './VoxDungeonLoader';

// Dungeon props
export { DungeonPropSystem, clearPropCache } from './DungeonProps';
export type { PlacedProp } from './DungeonProps';

// Doors
export { DoorSystem } from './Door';

// Ladders
export type { LadderDef, NavLink } from './Ladder';

// Stairs
export { computeCellHeights, buildStairMeshes, getStairCellSet } from './StairSystem';
export type { StairDef, LadderHint } from './StairSystem';

// Room visibility
export { RoomVisibility } from './RoomVisibility';

// Floor config
export { getActiveRecipe, getRecipeNames, getRecipe, setActiveRecipe, registerRecipe } from './FloorConfig';
export { getFloorConfig, getEnemyIdsByArchetype, buildFloorEnemyPool, buildRoomEnemyPool, getThemedFloor, getHeightmapEnemyPool } from './FloorConfig';
export type { ProgressionRecipe, FloorZoneConfig, ThemedFloor } from './FloorConfig';

// Level state persistence
export type { SavedEnemy, SavedChest, SavedCollectible, SavedLoot, SavedDestroyedProp, LevelSnapshot, LevelCache } from './LevelState';

// Dungeon builder
export { DungeonBuilder, type TerrainLike } from './DungeonBuilder';
