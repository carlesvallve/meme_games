/**
 * Unified character settings — single source of truth for all character
 * movement, combat, animation, climbing, and projectile configuration.
 */

// ── Movement ────────────────────────────────────────────────────────────

export type MovementMode = 'free' | 'grid';

export interface MeleeParams {
  /** Auto-target nearest enemy (snap facing toward target). */
  autoTarget: boolean;
  /** Knockback impulse speed inflicted on hit. */
  knockback: number;
  /** Show slash arc VFX on attacks. */
  showSlashEffect: boolean;
  /** Enable hit-stop (brief freeze on impact). */
  hitstopEnabled: boolean;
}

export interface RangedParams {
  /** Auto-target nearest enemy in forward cone. */
  autoTarget: boolean;
  /** Knockback impulse speed inflicted on hit. */
  knockback: number;
}

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
  /** Knockback velocity decay rate (exp(-knockbackDecay * dt)). */
  knockbackDecay: number;
  /** Invulnerability duration after hit (seconds). */
  invulnDuration: number;
  /** Hit flash duration (seconds). */
  flashDuration: number;
  /** Stun duration when hit (seconds). */
  stunDuration: number;
  /** How long to hold the last action frame before returning to idle (seconds). */
  actionHoldTime: number;
  /** Forward lunge distance during attack (world units). */
  lungeDistance: number;
  /** How fast the lunge completes (seconds). */
  lungeDuration: number;
  /** Exhaustion duration after combo (seconds). */
  exhaustDuration: number;
  /** Enable poor-man's foot IK: bottom voxels conform to terrain slope. */
  footIKEnabled: boolean;
  /** Loot/collectible magnet pickup radius. */
  magnetRadius: number;
  /** Loot/collectible magnet pull speed. */
  magnetSpeed: number;
  /** Melee combat settings. */
  melee: MeleeParams;
  /** Ranged combat settings. */
  ranged: RangedParams;
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
  knockbackDecay: 14,
  invulnDuration: 0.8,
  flashDuration: 0.15,
  stunDuration: 0.08,
  actionHoldTime: 0.12,
  lungeDistance: 0.3,
  lungeDuration: 0.15,
  exhaustDuration: 0.25,
  footIKEnabled: false,
  // loot / VFX
  magnetRadius: 0.7,
  magnetSpeed: 16,
  // combat modes
  melee: { autoTarget: true, knockback: 5, showSlashEffect: true, hitstopEnabled: true },
  ranged: { autoTarget: true, knockback: 2.5 },
};

// ── Physics ─────────────────────────────────────────────────────────────

/** Gravity acceleration for falling (units/s²) */
export const GRAVITY = 18;
/** Max fall speed (units/s) */
export const MAX_FALL_SPEED = 12;
/** Smoothing speed for stepping up (exponential lerp rate) */
export const STEP_UP_RATE = 12;
/** Minimum time between any foot sounds (step or land) per character */
export const FOOT_SFX_COOLDOWN = 0.12;

// ── Animation ───────────────────────────────────────────────────────────

/** Frame rates per animation type */
export const VOX_FPS: Record<string, number> = {
  idle: 2.5,
  walk: 8,
  action: 8,
};

/** Per-archetype action hold time (seconds on last action frame before returning to idle). */
const ACTION_HOLD_BY_ARCHETYPE: Partial<Record<string, number>> = {
  knight:     0.22,
  barbarian:  0.18,
  adventurer: 0.12,
  amazon:     0.08,
  rogue:      0.04,
  monk:       0.03,
};

const DEFAULT_ACTION_HOLD = 0.12;

/** Get action hold time for a character archetype. */
export function getActionHoldTime(archetype: string): number {
  return ACTION_HOLD_BY_ARCHETYPE[archetype] ?? DEFAULT_ACTION_HOLD;
}

/** Per-archetype lunge config: [distance, duration]. */
const LUNGE_BY_ARCHETYPE: Partial<Record<string, [number, number]>> = {
  knight:     [0.20, 0.15],  // vertical — less lunge
  barbarian:  [0.22, 0.15],  // vertical — less lunge
  adventurer: [0.25, 0.15],  // horizontal — slightly less than default
  amazon:     [0.40, 0.14],  // thrust — more forward
  rogue:      [0.30, 0.15],  // short — default
  monk:       [0.30, 0.15],  // short — default
  // Ranged — no lunge
  archer:      [0, 0.15],
  mage:        [0, 0.15],
  priestess:   [0, 0.15],
  alchemist:   [0, 0.15],
  necromancer: [0, 0.15],
  bard:        [0, 0.15],
};

const DEFAULT_LUNGE: [number, number] = [0.30, 0.15];

/** Get lunge [distance, duration] for a character archetype. */
export function getLungeConfig(archetype: string): [number, number] {
  return LUNGE_BY_ARCHETYPE[archetype] ?? DEFAULT_LUNGE;
}

/** Per-archetype exhaustion duration (seconds of recovery after a 3-hit combo). */
const EXHAUST_BY_ARCHETYPE: Partial<Record<string, number>> = {
  knight:     0.55,
  barbarian:  0.45,
  adventurer: 0.35,
  amazon:     0.30,
  rogue:      0.18,
  monk:       0.15,
};

const DEFAULT_EXHAUST = 0.35;

/** Get exhaustion duration for a character archetype. */
export function getExhaustDuration(archetype: string): number {
  return EXHAUST_BY_ARCHETYPE[archetype] ?? DEFAULT_EXHAUST;
}

/** Default hop frequency (hops per second while walking) */
export const DEFAULT_HOP_FREQUENCY = 4;
/** Reference speed for animation scaling (1x hop frequency at this speed) */
export const ANIM_REFERENCE_SPEED = 3.0;

// ── Climbing ────────────────────────────────────────────────────────────

export const CLIMB_SPEED = 1.6;       // m/s along ladder
export const MOUNT_SPEED = 3.0;       // m/s walking to ladder entry
export const DISMOUNT_SPEED = 2.0;    // m/s stepping off ladder
/** How far the character stands in front of the cliff during climbing (along facing normal) */
export const CLIMB_WALL_OFFSET = 0.18;

// ── Projectiles ─────────────────────────────────────────────────────────

export interface ProjectileConfig {
  kind: 'arrow' | 'fireball';
  color: number;
  speed: number;
  damage: number;
  lifetime: number;
  cooldown: number;
}

/** Muzzle (spawn point) offset in character-local space: forward = in front, up = above ground. */
export interface MuzzleOffset {
  forward: number;
  up: number;
}

const RANGED_CONFIG: Record<string, ProjectileConfig> = {
  archer:      { kind: 'arrow',    color: 0xddbb77, speed: 12, damage: 3, lifetime: 1.2, cooldown: 0.35 },
  mage:        { kind: 'fireball', color: 0x66aaff, speed: 10, damage: 2, lifetime: 1.0, cooldown: 0.45 },
  priestess:   { kind: 'fireball', color: 0xffee44, speed: 10, damage: 2, lifetime: 1.0, cooldown: 0.45 },
  alchemist:   { kind: 'fireball', color: 0x44ff88, speed: 10, damage: 2, lifetime: 1.0, cooldown: 0.45 },
  necromancer: { kind: 'fireball', color: 0xaa44ff, speed: 10, damage: 2, lifetime: 1.0, cooldown: 0.45 },
  bard:        { kind: 'fireball', color: 0xff88dd, speed: 10, damage: 2, lifetime: 1.0, cooldown: 0.45 },
};

/** Half a voxel in world units (height step); used to nudge muzzle up. */
export const HALF_VOXEL = 0.5 / 15;

/** Per-hero muzzle offset (where the projectile spawns relative to character). Slightly lower than old default. */
const MUZZLE_OFFSETS: Record<string, MuzzleOffset> = {
  archer:      { forward: 0.32, up: 0.2 + HALF_VOXEL },
  mage:        { forward: 0.28, up: 0.2 + HALF_VOXEL },
  priestess:   { forward: 0.28, up: 0.2 + HALF_VOXEL },
  alchemist:   { forward: 0.28, up: 0.2 + HALF_VOXEL },
  necromancer: { forward: 0.28, up: 0.2 + HALF_VOXEL },
  bard:        { forward: 0.28, up: 0.2 + HALF_VOXEL },
};

const DEFAULT_MUZZLE: MuzzleOffset = { forward: 0.3, up: 0.2 + HALF_VOXEL };

/** Get muzzle offset for a hero id (forward and up in local space). */
export function getMuzzleOffset(heroId: string): MuzzleOffset {
  return MUZZLE_OFFSETS[heroId] ?? DEFAULT_MUZZLE;
}

/** Get projectile config for a hero id, or null if melee */
export function getProjectileConfig(heroId: string): ProjectileConfig | null {
  return RANGED_CONFIG[heroId] ?? null;
}

/** Check if a hero id is ranged */
export function isRangedHeroId(heroId: string): boolean {
  return heroId in RANGED_CONFIG;
}
