export { Environment } from './Environment';
export { EnvironmentContext, DebrisSpatialHash, type DebrisBox, type TerrainPreset } from './EnvironmentContext';
export { EnvironmentPhysics } from './EnvironmentPhysics';
export { EnvironmentNavigation } from './EnvironmentNavigation';
export {
  debrisFromBox,
  debrisFromMesh,
  debrisFromGroup,
  debrisFromGroupBounds,
  worldToBoxLocal,
  boxLocalToWorld,
  pointOverlapsDebris,
} from './CollisionUtils';
export type { HeightmapStyle } from '../terrain/TerrainNoise';
