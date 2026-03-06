/**
 * Barrel file — public API for the character/ folder.
 * External code imports from './character' instead of reaching into individual files.
 * This keeps the internal file structure an implementation detail.
 */
export { Character } from './Character';
export { lerpAngle } from '../../utils/math';
export {
  DEFAULT_CHARACTER_PARAMS,
  GRAVITY, MAX_FALL_SPEED, STEP_UP_RATE, FOOT_SFX_COOLDOWN,
  VOX_FPS, DEFAULT_HOP_FREQUENCY,
  CLIMB_SPEED, MOUNT_SPEED, DISMOUNT_SPEED, CLIMB_WALL_OFFSET,
  HALF_VOXEL,
  getProjectileConfig,
  getMuzzleOffset,
  isRangedHeroId,
} from './CharacterSettings';
export type {
  MovementMode,
  MovementParams,
  MeleeParams,
  RangedParams,
  ProjectileConfig,
  MuzzleOffset,
} from './CharacterSettings';
export { Enemy } from './Enemy';
export { FootIK } from './FootIK';
export { CharacterClimbing } from './CharacterClimbing';
export { CharacterCombat } from './CharacterCombat';
export { VoxAnimator } from './VoxAnimator';
export { HpBar } from './HpBar';
export { DebugPathVis } from './DebugPathVis';

// Re-exports from sub-modules
export type { CharacterType } from './characters';
export {
  CHARACTER_TEAM_COLORS,
  CHARACTER_NAMES,
  VOX_CHARACTER_HEIGHT,
  getSlots,
  getHeroSlots,
  getMonsterSlots,
  getCharacterName,
  rerollRoster,
  rerollMonsters,
  voxRoster,
  createCharacterMesh,
} from './characters';

export type { VoxCharEntry, StepMode, MonsterStats } from './VoxCharacterDB';
export {
  VOX_HEROES, VOX_ENEMIES, ALL_VOX_CHARACTERS, getRandomVoxChar,
  getArchetype, getCharacterStats, getMonsterStats, randomInRange,
  getFilteredEnemies, getSlashStyle,
} from './VoxCharacterDB';
