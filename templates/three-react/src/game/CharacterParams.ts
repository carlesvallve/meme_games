/**
 * Single source of truth for character movement/combat defaults.
 * Player params (store) and enemies spread this and override only what differs.
 */

export type MovementMode = 'free' | 'grid';

export interface MovementParams {
  speed: number;
  stepHeight: number;
  slopeHeight: number;
  capsuleRadius: number;
  arrivalReach: number;
  hopHeight: number;
  movementMode: MovementMode;
  showPathDebug: boolean;
  /** Melee attack reach (distance); used for arc check. */
  attackReach: number;
  /** Melee attack arc half-angle in radians (total arc = 2 * attackArcHalf). */
  attackArcHalf: number;
  /** Melee damage dealt per hit. */
  attackDamage: number;
  /** Seconds between melee attacks (AI). */
  attackCooldown: number;
  /** Chase/aggro range for AI (units). */
  chaseRange: number;
  /** Knockback impulse speed when hit. */
  knockbackSpeed: number;
  /** Knockback velocity decay rate (exp(-knockbackDecay * dt)). */
  knockbackDecay: number;
  /** Invulnerability duration after hit (seconds). */
  invulnDuration: number;
  /** Hit flash duration (seconds). */
  flashDuration: number;
  /** Stun duration when hit (seconds). */
  stunDuration: number;
  /** Attack animation / hit window duration (seconds). */
  attackDuration: number;
  /** Exhaustion duration after combo (seconds). */
  exhaustDuration: number;
  /** Enable poor-man's foot IK: bottom voxels conform to terrain slope. */
  footIKEnabled: boolean;
}

/** Default params for any character. Override only what you need (e.g. enemies). */
export const DEFAULT_CHARACTER_PARAMS: MovementParams = {
  // movement
  speed: 4,
  stepHeight: 0.4,
  slopeHeight: 0.75,
  capsuleRadius: 0.1,
  arrivalReach: 0.05,
  hopHeight: 0.05,
  movementMode: 'grid' as MovementMode,
  showPathDebug: true,
  // combat
  attackReach: 0.75,
  attackArcHalf: Math.PI / 3,
  attackDamage: 1,
  attackCooldown: 0,
  chaseRange: 0,
  knockbackSpeed: 1.5,
  knockbackDecay: 14,
  invulnDuration: 0.8,
  flashDuration: 0.15,
  stunDuration: 0.08,
  attackDuration: 0.2,
  exhaustDuration: 1.0,
  footIKEnabled: false,
};
