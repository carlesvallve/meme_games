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

const RANGED_CONFIG: Record<string, ProjectileConfig> = {
  archer:      { kind: 'arrow',    color: 0xddbb77, speed: 12, damage: 3, lifetime: 1.2, cooldown: 0.35 },
  mage:        { kind: 'fireball', color: 0x4466ff, speed: 10, damage: 2, lifetime: 1.0, cooldown: 0.45 },
  priestess:   { kind: 'fireball', color: 0xffee44, speed: 10, damage: 2, lifetime: 1.0, cooldown: 0.45 },
  alchemist:   { kind: 'fireball', color: 0x44ff88, speed: 10, damage: 2, lifetime: 1.0, cooldown: 0.45 },
  necromancer: { kind: 'fireball', color: 0xaa44ff, speed: 10, damage: 2, lifetime: 1.0, cooldown: 0.45 },
};

/** Get projectile config for a hero id, or null if melee */
export function getProjectileConfig(heroId: string): ProjectileConfig | null {
  return RANGED_CONFIG[heroId] ?? null;
}

/** Check if a hero id is ranged */
export function isRangedHeroId(heroId: string): boolean {
  return heroId in RANGED_CONFIG;
}
