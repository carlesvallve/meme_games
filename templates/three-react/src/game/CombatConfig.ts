// ── Combat Configuration ─────────────────────────────────────────────
// Defines ranged vs melee hero classification and projectile parameters.

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
  mage:        { kind: 'fireball', color: 0x4466ff, speed: 10, damage: 2, lifetime: 1.0, cooldown: 0.45 },
  priestess:   { kind: 'fireball', color: 0xffee44, speed: 10, damage: 2, lifetime: 1.0, cooldown: 0.45 },
  alchemist:   { kind: 'fireball', color: 0x44ff88, speed: 10, damage: 2, lifetime: 1.0, cooldown: 0.45 },
  necromancer: { kind: 'fireball', color: 0xaa44ff, speed: 10, damage: 2, lifetime: 1.0, cooldown: 0.45 },
};


/** Half a voxel in world units (height step); used to nudge muzzle up. */
const HALF_VOXEL = 0.5 / 15;

/** Per-hero muzzle offset (where the projectile spawns relative to character). Slightly lower than old default. */
const MUZZLE_OFFSETS: Record<string, MuzzleOffset> = {
  archer:      { forward: 0.32, up: 0.2 + HALF_VOXEL },
  mage:        { forward: 0.28, up: 0.2 + HALF_VOXEL },
  priestess:   { forward: 0.28, up: 0.2 + HALF_VOXEL },
  alchemist:   { forward: 0.28, up: 0.2 + HALF_VOXEL },
  necromancer: { forward: 0.28, up: 0.2 + HALF_VOXEL },
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
