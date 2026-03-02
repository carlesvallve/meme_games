/**
 * Barrel file — public API for the enemies/ folder.
 * External code imports from './enemies' instead of reaching into individual files.
 */
export { EnemySystem } from './EnemySystem';
export type { HitImpactCallbacks } from './EnemyCombat';
export { isInAttackArc } from './EnemyCombat';
