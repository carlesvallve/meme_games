import { createDisplayConfig } from '@sttg/game-base';

const { DPR, PX, GAME } = createDisplayConfig();

export { DPR, PX, GAME };

// --- Lighting ---
export const LIGHTING = {
  // System config
  AMBIENT: 1,              // Base brightness 0–1 (lower = darker unlit areas)
  AMBIENT_COLOR: [0.08, 0.05, 0.15], // Deeper dark purple for unlit areas [r,g,b] 0–1
  MAX_LIGHTS: 32,
  GRADIENT_SIZE: 128,
  FALLOFF_INNER: 0.35,     // Inner falloff ring — wide bright center
  FALLOFF_MID: 0.65,       // Mid falloff ring — slow fade
  INNER_ALPHA: 1.0,        // Alpha at inner ring (1.0 = full color reveal)
  MID_ALPHA: 0.75,         // Alpha at mid ring — still mostly bright here

  // Player radial light
  PLAYER_RADIUS: 280,      // in PX units
  PLAYER_INTENSITY: 1.0,
  PLAYER_COLOR: [1.0, 1.0, 1.0],

  // Headlight cone
  CONE_LENGTH: 900,        // in PX units (longer reach)
  CONE_ANGLE: Math.PI / 2.5, // spread angle in radians (wider beam)
  CONE_INTENSITY: 1.0,
  CONE_COLOR: [1.0, 1.0, 1.0],

  // Death / intro radial light
  DEATH_RADIUS: 350,       // in PX units (bigger so it's clearly visible alone)
  DEATH_INTENSITY: 1.0,
  DEATH_COLOR: [1.0, 0.95, 0.8],
};

// --- Pixel art render scale (each sprite pixel = this many screen pixels) ---
export const PIXEL_SCALE = 2;

// --- Arena (larger than screen) ---

export const ARENA = {
  WIDTH: GAME.WIDTH * 2.5,
  HEIGHT: GAME.HEIGHT * 2.5,
  CENTER_X: (GAME.WIDTH * 2.5) / 2,
  CENTER_Y: (GAME.HEIGHT * 2.5) / 2,
  // Spawn margin outside visible area
  SPAWN_MARGIN: 100 * PX,
};

// --- Player ---

// Controls mode: 'classic' = rotate+thrust, 'direct' = move in input direction (auto-thrust)
export const CONTROLS_MODE = 'direct';

export const PLAYER = {
  START_X: ARENA.CENTER_X,
  START_Y: ARENA.CENTER_Y,
  WIDTH: 48 * PX,
  HEIGHT: 48 * PX,
  COLOR: 0x44ddff,
  MAX_HEALTH: 5,
  INVULN_DURATION: 1500, // ms of invulnerability after hit
  INVULN_BLINK_RATE: 100, // ms between alpha toggles
  // Magnetic attraction range for XP gems
  MAGNET_RANGE: 120 * PX,
  MAGNET_SPEED: 120 * PX,
  // Ship physics
  ROTATION_SPEED: 4.5, // radians per second (classic mode)
  TURN_SPEED: 18, // radians per second (direct mode mobile — fast snap)
  TURN_SPEED_DESKTOP: 8, // radians per second (direct mode desktop — smoother)
  THRUST_FORCE: 550 * PX, // acceleration per second
  MAX_SPEED: 300 * PX, // max velocity magnitude
  DRAG: 0.97, // velocity multiplier per frame (at 60fps) — higher friction
  DEAD_STOP: 2 * PX, // snap to 0 below this speed
  REVERSE_RATIO: 0.6, // reverse thrust is 60% of forward thrust
  // Aiming cone preference
  AIM_CONE_HALF: Math.PI / 3, // 60 degrees = 120 degree cone
  AIM_CONE_WEIGHT: 0.5, // enemies in cone scored at half distance
  HIT_KNOCKBACK: 250 * PX, // impulse applied to player when hit by enemy
};

// --- Knockback ---

export const KNOCKBACK = {
  ENEMY_HIT: 80 * PX, // impulse applied to enemy when hit by projectile
};

// --- Elite enemies ---

export const ELITE = {
  UNLOCK_MINUTE: 0,        // elites from the very start
  INITIAL_CHANCE: 0.10,    // 10% chance per spawn
  CHANCE_PER_MIN: 0.04,    // +4% per minute
  MAX_CHANCE: 0.30,        // cap at 30%
  HP_MULT: 2.0,            // 2x base HP
  SPEED_MULT: 1.3,         // 1.3x base speed
  SIZE_MULT: 1.25,         // 1.25x visual size
  SCORE_MULT: 3,           // 3x score
  XP_MULT: 2,              // 2x xp drop
};

// --- Enemies ---

export const ENEMY = {
  TRACK_RANGE: 300 * PX,
  WANDER_SPEED_RATIO: 0.4,
};

export const ENEMY_TYPES = {
  COPILOT: {
    name: 'Copilot Popup',
    width: 16 * PX,
    height: 16 * PX,
    color: 0x44ff44,
    speed: 120 * PX,
    health: 1,
    damage: 1,
    score: 10,
    xpDrop: 1, // small gem
  },
  PR: {
    name: 'AI-Generated PR',
    width: 22 * PX,
    height: 22 * PX,
    color: 0xff8833,
    speed: 80 * PX,
    health: 3,
    damage: 1,
    score: 25,
    xpDrop: 2, // medium gem
    zigzagAmplitude: 60 * PX,
    zigzagFrequency: 0.003,
  },
  SUGGESTION: {
    name: 'Smart Suggestion',
    width: 30 * PX,
    height: 30 * PX,
    color: 0x9944ff,
    speed: 50 * PX,
    health: 6,
    damage: 1,
    score: 50,
    xpDrop: 3, // large gem
  },
};

export const BOSS = {
  name: 'Giant Clippy',
  width: 48 * PX,
  height: 48 * PX,
  color: 0xff4444,
  speed: 40 * PX,
  health: 20,
  damage: 2,
  score: 200,
  xpDrop: 10,
  SPAWN_INTERVAL: 45000, // Every 45 seconds (was 30s — less overwhelming early game)
  MAX_SIMULTANEOUS: 3,   // hard cap on bosses alive at once
  ESCORT_COUNT: 4,       // copilots spawned alongside boss
  ESCORT_SPREAD: 80,     // px spread around boss spawn point
  // Boss behavior phases
  CHARGE_SPEED: 260 * PX,       // speed during charge
  CHARGE_TELEGRAPH: 900,        // ms telegraph before charge
  CHARGE_DURATION: 900,         // ms of actual charge
  CHARGE_COOLDOWN: 3000,        // base ms between charges (randomized ±40%)
  ORBIT_SPEED: 1.4,             // radians/sec during orbit phase
  ORBIT_RADIUS: 160 * PX,       // orbit distance from player
  ORBIT_DURATION: 2500,         // ms of orbiting
  RALLY_RANGE: 400 * PX,        // nearby slops get enraged within this range
  RALLY_SPEED_MULT: 1.15,       // speed multiplier for rallied slops (subtle boost)
  RALLY_TRACK_RANGE: 450 * PX,  // rallied slops track from further away
};

// --- Waves ---

export const WAVES = {
  INITIAL_SPAWN_RATE: 1400, // ms between spawns at start
  MIN_SPAWN_RATE: 350,      // fastest spawn rate
  SPAWN_RATE_DECREASE: 30,  // ms decrease per wave
  ENEMIES_PER_WAVE: 5,
  WAVE_DURATION: 10000,     // ms per wave
  MAX_ENEMIES: 20,          // starting cap on simultaneous enemies
  // Minimum floor: if fewer than this, spawn catch-up enemies
  MIN_ENEMIES: 4,
  MIN_ENEMIES_MAX: 8,       // floor grows over time up to this
  MIN_ENEMIES_RATE: 0.6,    // +0.6 per minute
};

// --- Difficulty scaling ---
// All values scale linearly with elapsed minutes (capped at max)

export const DIFFICULTY = {
  // Enemy stat multipliers (multiply base stats by 1 + rate * minutes, capped)
  HEALTH_SCALE_RATE: 0.12,     // +12% health per minute
  HEALTH_SCALE_MAX: 2.5,       // cap at 2.5x base health
  SPEED_SCALE_RATE: 0.05,      // +5% speed per minute
  SPEED_SCALE_MAX: 1.4,        // cap at 1.4x base speed
  DAMAGE_SCALE_RATE: 0.08,     // +8% damage per minute (rounded, so kicks in ~min 6+)
  DAMAGE_SCALE_MAX: 3.0,       // cap at 3x damage

  // Wave composition scaling
  ENEMIES_PER_WAVE_RATE: 0.5,  // +0.5 enemies per wave per minute
  ENEMIES_PER_WAVE_MAX: 10,    // cap
  MAX_ENEMIES_RATE: 3,         // +3 max enemies per minute
  MAX_ENEMIES_CAP: 45,         // hard cap

  // Boss escalation (per boss number, not time)
  BOSS_HEALTH_PER_SPAWN: 10,    // +10 HP per successive boss (20→30→40→50...)
  BOSS_SPEED_PER_SPAWN: 3 * PX, // +3 speed per successive boss (gentler ramp)
  BOSS_CHARGE_CD_REDUCTION: 200,  // charge cooldown decreases by 200ms per boss
  BOSS_CHARGE_CD_MIN: 2500,       // minimum charge cooldown (more breathing room)
  BOSS_CHARGE_DURATION_INCREASE: 200, // charge duration increases by 200ms per boss
  BOSS_CHARGE_DURATION_MAX: 1800,     // cap on charge duration
  BOSS_CHARGE_SPEED_INCREASE: 30 * PX, // charge speed increases per boss
  BOSS_CHARGE_SPEED_MAX: 500 * PX,     // cap on charge speed
  BOSS_CHARGE_KNOCKBACK: 450 * PX,     // extra knockback when hit during boss charge
  BOSS_OVERLAP_START_MIN: 3,     // no multi-boss before this many minutes
  BOSS_OVERLAP_CHANCE_PER_MIN: 0.08,  // +8% chance per minute (after start) to allow multi-boss
  BOSS_OVERLAP_CHANCE_MAX: 0.6,       // cap at 60% chance

  // Powerup scarcity
  POWERUP_DROP_DECAY_RATE: 0.04,  // drop chance multiplier decreases by 4% per minute
  POWERUP_DROP_MIN_MULT: 0.4,    // never below 40% of original drop rate

  // Enemy speed variance — random per-enemy modifier increases over time
  SPEED_VARIANCE_RATE: 0.02,     // variance range grows by 2% per minute
  SPEED_VARIANCE_MAX: 0.3,       // max ±30% speed variance
};

// --- Enemy behavior variants ---
// Behaviors unlock progressively; chance starts low and ramps up

export const ENEMY_BEHAVIORS = {
  DASHER: {
    unlockMinute: 2,            // when this behavior can first appear
    initialChance: 0.08,        // chance at unlock time
    chancePerMinute: 0.04,      // additional chance per minute after unlock
    maxChance: 0.35,            // cap
    appliesTo: ['COPILOT'],     // which enemy types can get this behavior
    // Dasher stats
    telegraphDuration: 600,     // ms flashing before dash
    dashSpeed: 350 * PX,        // speed during dash
    dashDuration: 500,          // ms of dash
    dashCooldown: 4000,         // ms between dashes
    dashColor: 0xff4444,        // flash color during telegraph
  },
  SHOOTER: {
    unlockMinute: 3.5,
    initialChance: 0.06,
    chancePerMinute: 0.03,
    maxChance: 0.25,
    appliesTo: ['PR'],
    // Shooter stats
    telegraphDuration: 800,     // ms warning before firing
    projectileSpeed: 180 * PX,
    projectileDamage: 1,
    projectileLifetime: 2500,   // ms
    projectileSize: 8 * PX,
    projectileColor: 0xff6633,
    fireCooldown: 3500,         // ms between shots
    fireRange: 350 * PX,        // only fires when player is within this range
  },
  SPLITTER: {
    unlockMinute: 5,
    initialChance: 0.05,
    chancePerMinute: 0.025,
    maxChance: 0.20,
    appliesTo: ['SUGGESTION'],
    // Splitter stats
    splitCount: 3,              // how many mini-enemies spawn on death
    splitSpeedMult: 1.8,        // children are faster
    splitHealthMult: 0.3,       // children have less health
  },
  MINE_LAYER: {
    unlockMinute: 6.5,
    initialChance: 0.04,
    chancePerMinute: 0.02,
    maxChance: 0.15,
    appliesTo: ['PR'],
    // Mine layer stats
    mineCooldown: 3000,         // ms between mine drops
    mineLifetime: 5000,         // ms before mine despawns
    mineDamage: 1,
    mineRadius: 40 * PX,        // blast radius
    mineArmTime: 1000,          // ms before mine becomes active
    mineColor: 0xff3366,
  },
};

// --- Weapons ---

export const WEAPONS = {
  AUTO_ATTACK: {
    range: 160 * PX,
    damage: 1,
    cooldown: 2400, // ms between attacks
    projectileSpeed: 350 * PX,
    projectileSize: 9 * PX,
    projectileColor: 0x66ccff,
    projectileLifetime: 1200, // ms
  },
  LASER: {
    damage: 2,
    cooldown: 420, // ms between shots (was 280)
    projectileSpeed: 550 * PX,
    projectileSize: 12 * PX,
    projectileColor: 0xffcc00,
    projectileLifetime: 1500, // ms
    trailColor: 0xffcc00,
  },
  HOMING_MISSILE: {
    damage: 3,
    cooldown: 2200, // ms between volleys
    projectileSpeed: 200 * PX, // starts slow, accelerates
    maxSpeed: 380 * PX,
    acceleration: 400 * PX, // px/s^2
    turnRate: 4.0, // radians/sec
    projectileSize: 10 * PX,
    projectileLifetime: 3000,
    blastRadius: 60 * PX,
    blastDamage: 2, // splash damage (in addition to direct hit)
    trailColor: 0xff6633,
  },
  MINE: {
    damage: 3,
    cooldown: 2200, // ms between drops
    minSpeed: 80 * PX, // player must be moving this fast to drop
    projectileSize: 10 * PX,
    fuseTime: 800, // ms before armed (blinks)
    blastRadius: 60 * PX,
    lifetime: 3000, // ms before auto-detonation
    trailColor: 0xcc33ff,
  },
};

export const UPGRADE_OPTIONS = [
  // Repeatable stat upgrades
  { id: 'attack_speed', name: 'Attack Speed+', desc: 'Faster attacks', icon: 'icon-attack-speed', repeatable: true, apply: (w) => { w.cooldown = Math.max(200, w.cooldown - 100); } },
  { id: 'attack_damage', name: 'Damage+', desc: 'More damage', icon: 'icon-damage', repeatable: true, apply: (w) => { w.damage += 1; } },
  { id: 'attack_range', name: 'Range+', desc: 'Longer range', icon: 'icon-range', repeatable: true, apply: (w) => { w.range += 40 * PX; } },
  { id: 'projectile_speed', name: 'Proj Speed+', desc: 'Faster projectiles', icon: 'icon-proj-speed', repeatable: true, apply: (w) => { w.projectileSpeed += 80 * PX; } },
  { id: 'extra_projectile', name: 'Multi-Shot', desc: '+1 projectile', icon: 'icon-multi-shot', repeatable: true, apply: (w) => { w.projectileCount = (w.projectileCount || 1) + 1; } },
  { id: 'wider_area', name: 'Area+', desc: 'Bigger hit area', icon: 'icon-area', repeatable: true, apply: (w) => { w.projectileSize += 4 * PX; } },
  // homing_missiles removed — now a timed powerup drop
  // guided_laser removed — guided laser is now always active by default
  // triple_shot removed — now a timed powerup drop
  // mines removed — now a timed powerup drop
];

// --- Power-ups ---

export const POWERUP_TYPES = {
  CODE_REVIEW: {
    name: 'Code Review',
    desc: 'Vortex that pulls enemies in and damages them!',
    color: 0xff6633,
    width: 30 * PX,
    height: 30 * PX,
    duration: 8000,
    vortexRadius: 200 * PX,
    vortexPullForce: 120 * PX,  // pull speed px/s
    vortexDamage: 1,             // damage per tick
    vortexTickRate: 500,         // ms between damage ticks
    unlockMinute: 1.5,
  },
  GITIGNORE: {
    name: '.gitignore',
    desc: 'Shield — blocks all damage for 5 seconds!',
    color: 0xffcc00,
    width: 30 * PX,
    height: 30 * PX,
    duration: 5000,
    unlockMinute: 0,
  },
  LINTER: {
    name: 'Linter',
    desc: 'Orbital — spinning projectile destroys nearby slop!',
    color: 0xcc33ff,
    width: 30 * PX,
    height: 30 * PX,
    duration: 8000,
    orbitRadius: 80 * PX,
    orbitSpeed: 0.004,
    orbitDamage: 2,
    unlockMinute: 1,
  },
  MINES: {
    name: 'Mine Layer',
    desc: 'Drop mines behind you for 8 seconds!',
    color: 0xcc33ff,
    width: 30 * PX,
    height: 30 * PX,
    duration: 8000,
    unlockMinute: 2,
  },
  TRIPLE_SHOT: {
    name: 'Triple Shot',
    desc: 'Fire 3 lasers in a cone for 10 seconds!',
    color: 0x33ccff,
    width: 30 * PX,
    height: 30 * PX,
    duration: 10000,
    unlockMinute: 2.5,
  },
  HOMING: {
    name: 'Homing Missiles',
    desc: 'Auto-targeting missiles with blast radius for 12 seconds!',
    color: 0xff4444,
    width: 30 * PX,
    height: 30 * PX,
    duration: 12000,
    unlockMinute: 3,
  },
};

// --- Powerup drop system (unified) ---
export const POWERUP_DROP = {
  // Single drop chance per enemy kill (replaces per-type dropChance)
  BASE_CHANCE: 0.06,           // 6% base chance per kill
  // Scales with elapsed minutes
  RAMP_START_MINUTE: 2,       // drop chance starts increasing at 2 min
  RAMP_PER_MINUTE: 0.015,     // +1.5% per minute after ramp start
  MAX_CHANCE: 0.14,            // cap at 14%
  // Minimum time between powerup drops (prevents flooding)
  MIN_INTERVAL: 8000,          // ms — at least 8s between drops
  // Number of choices offered
  CHOICE_COUNT: 2,
  // Generic token appearance
  TOKEN_SIZE: 30 * PX,
  TOKEN_COLOR: 0x4488ff,
};

// --- XP Gems ---

export const XP_GEM = {
  SMALL: { value: 1, size: 12 * PX, color: 0x9944ff },
  MEDIUM: { value: 3, size: 18 * PX, color: 0x7733cc },
  LARGE: { value: 8, size: 24 * PX, color: 0x6622aa },
  LIFETIME: 15000, // ms before despawn
};

// --- Colors (green/purple/orange theme) ---

export const COLORS = {
  // Arena
  BG_DARK: 0xffffff,
  BG_FLOOR: 0x0d1a0d,
  GRID_LINE: 0x1a3a1a,

  // Player
  PLAYER: 0x44ddff,
  PLAYER_HURT: 0xff4444,

  // Slop green (enemies)
  SLOP_GREEN: 0x44ff44,
  SLOP_DARK: 0x22cc22,

  // UI text
  UI_TEXT: '#ffffff',
  UI_SHADOW: '#000000',
  MUTED_TEXT: '#8888aa',
  SCORE_GOLD: '#ffcc00',
  HEALTH_RED: '#ff4444',
  HEALTH_BG: '#333333',
  XP_PURPLE: '#9944ff',

  // Menu / GameOver gradient backgrounds
  BG_TOP: 0x050a05,
  BG_BOTTOM: 0x0a1a0a,

  // Parallax layer tints
  BG_PARALLAX_NEAR: 0x1a2e1a,
  BG_PARALLAX_FAR: 0x0d1a0d,

  // Buttons
  BTN_PRIMARY: 0x44ff44,
  BTN_PRIMARY_HOVER: 0x66ff66,
  BTN_PRIMARY_PRESS: 0x22cc22,
  BTN_TEXT: '#000000',

  // Damage flash
  DAMAGE_TINT: 0xff0000,
};

// --- Parallax ---

export const PARALLAX = {
  FAR_FACTOR: 0.3,
  MID_FACTOR: 0.6,
  NEAR_FACTOR: 0.85,
  // BG color fading — slowly cycle layer tints through themed palettes
  COLOR_FADE_DURATION: 6000,   // ms per color transition
  COLOR_HOLD_DURATION: 5000,   // ms to hold a color before transitioning
  // Each theme has muted (m) and vivid (v) variants: [far, mid, near]
  // Layers independently pick muted or vivid for contrast variation
  COLOR_THEMES_VIVID: [
    [0x0044ff, 0x2288ff, 0x44ccff],  // electric blue
    [0x00cc44, 0x22ff66, 0x66ffaa],  // emerald green
    [0xff4400, 0xff6622, 0xff9944],  // lava orange
    [0x8800ff, 0xaa22ff, 0xdd66ff],  // ultraviolet
    [0xffcc00, 0xffdd22, 0xffee66],  // electric yellow
    [0xff0055, 0xff2277, 0xff66aa],  // hot magenta
    [0x00dddd, 0x22ffee, 0x66ffff],  // neon cyan
    [0xcc0000, 0xff2222, 0xff6644],  // lava red
    [0xff6600, 0xff8800, 0xffaa33],  // intense orange
    [0x0088ff, 0x00aaff, 0x44ddff],  // intense blue
  ],
  COLOR_THEMES_MUTED: [
    [0x112244, 0x223366, 0x334488],  // deep blue
    [0x1a3322, 0x2a5533, 0x447755],  // forest green
    [0x442211, 0x663322, 0x885533],  // burnt sienna
    [0x221133, 0x332255, 0x553377],  // dark violet
    [0x333311, 0x555522, 0x777744],  // olive
    [0x331122, 0x552233, 0x773355],  // wine
    [0x113333, 0x224444, 0x336666],  // teal dark
    [0x331111, 0x552222, 0x773333],  // dark crimson
    [0x332211, 0x553311, 0x774422],  // dark amber
    [0x112233, 0x223344, 0x334466],  // midnight blue
  ],
};

// --- UI sizing ---

export const UI = {
  BASE: GAME.UI_BASE,
  FONT: 'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, Consolas, monospace',
  TITLE_RATIO: 0.09,
  HEADING_RATIO: 0.05,
  BODY_RATIO: 0.035,
  SMALL_RATIO: 0.025,
  BTN_W_RATIO: 0.45,
  BTN_H_RATIO: 0.075,
  BTN_RADIUS: 8 * PX,
  MIN_TOUCH: 44 * PX,
  SCORE_SIZE_RATIO: 0.03,
  SCORE_STROKE: 3 * PX,
  HEART_SIZE: 24 * PX,
  HEART_SPACING: 32 * PX,
  XP_BAR_WIDTH: 200 * PX,
  XP_BAR_HEIGHT: 14 * PX,
  HUD_PADDING: 14 * PX,
};

// --- Touch zones (mobile) ---

export const TOUCH = {
  ZONE_ALPHA: 0.08,
  ZONE_COLOR: 0xffffff,
  LABEL_ALPHA: 0.25,
};

// --- Transitions ---

export const TRANSITION = {
  FADE_DURATION: 350,
  SCORE_POP_SCALE: 1.3,
  SCORE_POP_DURATION: 150,
};

// --- VFX ---

export const VFX = {
  // Particles
  SLOP_SPLATTER_COUNT: 10,       // particles on enemy death
  SLOP_SPLATTER_SPEED: 100 * PX,
  SLOP_SPLATTER_LIFETIME: 500,
  SLOP_SPLATTER_SIZE: { min: 2 * PX, max: 5 * PX },

  XP_SPARKLE_COUNT: 6,
  XP_SPARKLE_SPEED: 50 * PX,
  XP_SPARKLE_LIFETIME: 350,
  XP_SPARKLE_SIZE: { min: 1.5 * PX, max: 3 * PX },

  BOSS_SPLATTER_COUNT: 24,
  BOSS_SPLATTER_SPEED: 160 * PX,

  DEATH_PARTICLE_COUNT: 16,
  DEATH_PARTICLE_SPEED: 120 * PX,
  DEATH_PARTICLE_LIFETIME: 700,

  // Screen shake
  SHAKE_DAMAGE_INTENSITY: 0.008,
  SHAKE_DAMAGE_DURATION: 150,
  SHAKE_BOSS_INTENSITY: 0.012,
  SHAKE_BOSS_DURATION: 400,
  SHAKE_DEATH_INTENSITY: 0.02,
  SHAKE_DEATH_DURATION: 500,

  // Level up flash
  LEVELUP_FLASH_DURATION: 300,
  LEVELUP_FLASH_COLOR: { r: 153, g: 68, b: 255 }, // purple

  // Boss spawn warning
  BOSS_WARN_FLASH_DURATION: 200,
  BOSS_WARN_FLASH_COLOR: { r: 255, g: 68, b: 68 }, // red

  // Death slow-mo

  // Floating damage numbers
  DAMAGE_NUM_DURATION: 600,
  DAMAGE_NUM_RISE: 30 * PX,
  DAMAGE_NUM_SIZE_RATIO: 0.022,

  // Vignette
  VIGNETTE_ALPHA: 0.35,
  VIGNETTE_RADIUS_RATIO: 0.55, // ratio of half-diagonal

  // Thruster particles
  THRUSTER_COUNT: 2, // particles per frame when thrusting
  THRUSTER_SPEED: 80 * PX,
  THRUSTER_LIFETIME: 300,
  THRUSTER_SIZE: { min: 1.5 * PX, max: 3 * PX },
  THRUSTER_COLORS: [0xff6633, 0xffcc00, 0xff4444],

  // Menu floating particles
  MENU_PARTICLE_COUNT: 20,
  MENU_PARTICLE_SPEED: 15 * PX,
  MENU_PARTICLE_SIZE: { min: 1 * PX, max: 3 * PX },
  MENU_PARTICLE_ALPHA: { min: 0.1, max: 0.35 },

  // Score counter animation (game over)
  SCORE_COUNTER_DURATION: 1200,
};

// --- Intro cutscene ---

export const INTRO = {
  BED_X: ARENA.CENTER_X - 80 * PX,
  BED_Y: ARENA.CENTER_Y,
  // Standing position after getting out of bed (visible gap from bed)
  STAND_X: ARENA.CENTER_X - 16 * PX,
  STAND_Y: ARENA.CENTER_Y,
  SHIP_PARK_X: ARENA.CENTER_X + 60 * PX,
  SHIP_PARK_Y: ARENA.CENTER_Y,
  WAKE_DURATION: 200,
  GET_OUT_DURATION: 600,   // walking out of bed
  WALK_DURATION: 1000,     // walking to ship
  BOARD_DURATION: 400,
};
