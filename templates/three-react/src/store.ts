import { create } from 'zustand';
import type { CharacterType, SpeechBubbleData } from './types';
import { Layer } from './game/core/Entity';
import type { TerrainPreset } from './game/terrain';
import type { HeightmapStyle } from './game/terrain';
import type { OverworldState } from './game/overworld';
import { DEFAULT_CHARACTER_PARAMS } from './game/character';
import type {
  MovementParams,
  MeleeParams,
  RangedParams,
} from './game/character';
import type { LevelSnapshot } from './game/dungeon';
import type { PotionEffect } from './game/combat/PotionEffectSystem';

export interface ActivePotionDisplay {
  effect: PotionEffect;
  remaining: number;
  duration: number;
  positive: boolean;
}

export interface PotionSlot {
  colorIndex: number;
  count: number;
}
import { floorSeed } from './utils/SeededRandom';

export type {
  MovementParams,
  MeleeParams,
  RangedParams,
} from './game/character';

/**
 * Enemy params — overrides of the base MovementParams that characters share,
 * plus a few enemy-specific AI additions (speedVariance, chaseRange, playerDamage).
 * Field names match MovementParams where they overlap.
 */
export interface EnemyParams {
  // ── Character overrides ──
  hp: number;
  speed: [number, number];
  attackDamage: number;
  attackCooldown: number;
  invulnDuration: number;
  stunDuration: number;
  melee: MeleeParams;
  ranged: RangedParams & { enabled: boolean };
  // ── Enemy AI ──
  /** Chase range in nav grid cells. Converted to world units at point of use. */
  chaseRange: number;
  /** Damage the player deals to enemies (attacker-side). */
  playerDamage: number;
  /** Difficulty multiplier (0 = trivial, 1 = normal, 2 = hard). Scales density, spawn rate, and enemy speed. */
  difficulty: number;
  /** Enemy density: ratio of enemies per walkable nav cell (e.g. 0.02 = 1 enemy per 50 cells). */
  enemyDensity: number;
  /** Hard cap on total enemies (prevents performance issues on large maps). */
  maxEnemies: number;
  /** Seconds between wave-spawn attempts once initial enemies are placed. */
  spawnInterval: number;
  /** Allowed enemy type IDs (empty = all). */
  allowedTypes: string[];
  /** Seconds after last damage before regen starts. */
  regenDelay: number;
  /** HP per second once regen is active (scaled by tier). */
  regenRate: number;
}

export const DEFAULT_ENEMY_PARAMS: EnemyParams = {
  hp: 4,
  speed: [0.5, 1.5],
  attackDamage: 1,
  attackCooldown: 1.2,
  invulnDuration: 0.5,
  stunDuration: 0.15,
  melee: {
    autoTarget: true,
    knockback: 5,
    showSlashEffect: true,
    hitstopEnabled: true,
  },
  ranged: {
    enabled: false,
    autoTarget: true,
    knockback: 2.5,
  },
  chaseRange: 12,
  playerDamage: 2,
  difficulty: 1.0,
  enemyDensity: 0.02,
  maxEnemies: 32,
  spawnInterval: 20,
  allowedTypes: [],
  regenDelay: 5.0,
  regenRate: 0.1,
};

export interface ParticleToggles {
  dust: boolean;
  lightRain: boolean;
  rain: boolean;
  debris: boolean;
}

export type MovementMode = 'free' | 'grid';

export type LightPreset = 'default' | 'bright' | 'dark' | 'none';

export interface TorchParams {
  intensity: number;
  distance: number;
  offsetForward: number; // forward from character facing
  offsetRight: number; // right of character facing
  offsetUp: number; // height above character
  color: string;
  flicker: number;
}

export interface CameraParams {
  /** Vertical field of view in degrees */
  fov: number;
  minDistance: number;
  maxDistance: number;
  /** Current camera distance (zoom level); synced with camera and scroll/pinch. */
  distance: number;
  pitchMin: number;
  pitchMax: number;
  rotationSpeed: number;
  zoomSpeed: number;
  collisionLayers: number;
  collisionSkin: number;
}

export interface PostProcessSettings {
  enabled: boolean;
  bloom: {
    enabled: boolean;
    strength: number;
    radius: number;
    threshold: number;
  };
  ssao: {
    enabled: boolean;
    radius: number;
    minDistance: number;
    maxDistance: number;
  };
  vignette: { enabled: boolean; offset: number; darkness: number };
  colorGrade: {
    enabled: boolean;
    brightness: number;
    contrast: number;
    saturation: number;
  };
}

// ── Defaults ──────────────────────────────────────────────────────────

export const DEFAULT_CAMERA_PARAMS: CameraParams = {
  fov: 60,
  minDistance: 5,
  maxDistance: 25,
  distance: 12,
  pitchMin: -80,
  pitchMax: 0,
  rotationSpeed: 0.005,
  zoomSpeed: 0.01,
  collisionLayers: Layer.None,
  collisionSkin: 0.1,
};

export const DEFAULT_TORCH_PARAMS: TorchParams = {
  intensity: 2.5,
  distance: 8,
  offsetForward: 0.3,
  offsetRight: 0.25,
  offsetUp: 1.0,
  color: '#ff9944',
  flicker: 0.3,
};

export const DEFAULT_LIGHT_PRESET: LightPreset = 'default';

/** Base intensity for each scene light — presets multiply these. */
export const LIGHT_DEFAULTS = {
  ambient: 1.0,
  dirPrimary: 2.0,
  dirFill: 1.0,
  dirRim: 0.7,
  hemi: 0.8,
};

/** Multiplier per light preset (applied to LIGHT_DEFAULTS). */
export const LIGHT_PRESET_SCALES: Record<LightPreset, number> = {
  default: 1.5,
  bright: 2.25,
  dark: 0.25,
  none: 0,
};

/** Extra multiplier for exterior (heightmap) terrain. */
export const LIGHT_EXTERIOR_SCALE = 1.6;

export const DEFAULT_POST_PROCESS: PostProcessSettings = {
  enabled: true,
  bloom: { enabled: true, strength: 0.3, radius: 0.4, threshold: 0.85 },
  ssao: { enabled: true, radius: 0.5, minDistance: 0.001, maxDistance: 0.1 },
  vignette: { enabled: true, offset: 1.0, darkness: 1.2 },
  colorGrade: { enabled: true, brightness: 0, contrast: 0.1, saturation: 0 },
};

export const DEFAULT_PARTICLE_TOGGLES: ParticleToggles = {
  dust: true,
  lightRain: false,
  rain: false,
  debris: false,
};

export const DEFAULT_SCENE_SETTINGS = {
  terrainPreset: 'voxelDungeon' as TerrainPreset,
  heightmapStyle: 'islands' as HeightmapStyle,
  paletteName: 'random',
  roomSpacing: 2,
  roomSpacingMax: 5,
  tileSize: 0.75,
  gridOpacity: 0.25,
  resolutionScale: 1,
  testProp: '' as string, // empty = normal templates, category name = spawn only that
  testFloor: '' as string, // empty = random ground tiles, tile id = use only that
  doorChance: 0.7,
  heightChance: 0.55, // probability of height change between rooms (0–1)
  loopChance: 0.35, // loop corridor budget as fraction of rooms (0–1)
  roomLabels: true, // voxelDungeon: show room name labels (e.g. "Barracks")
  natureEnabled: true,
  useBiomes: true,
  debugBiomes: false,
  debugDebris: false,
  debugProjectileStick: false,
  forceStairs: false,
  timeOfDay: 10,
  dayCycleEnabled: false,
  dayCycleSpeed: 1,
  fastNights: true,
  sunDebug: false,
  hmrCacheEnabled: false,
  dungeonVariant: 'random',
  dungeonSize: 40,
  progressiveLayout: true, // dungeon layout scales with floor (size, height, doors)
};

// ── localStorage persistence ──────────────────────────────────────────

const SETTINGS_KEY = 'dcrawler:settings';

interface SavedSettings {
  characterParams?: MovementParams;
  cameraParams?: CameraParams;
  lightPreset?: LightPreset;
  torchEnabled?: boolean;
  torchParams?: TorchParams;
  terrainPreset?: TerrainPreset;
  heightmapStyle?: HeightmapStyle;
  paletteName?: string;
  roomSpacing?: number;
  roomSpacingMax?: number;
  tileSize?: number;
  gridOpacity?: number;
  resolutionScale?: number;
  testProp?: string;
  testFloor?: string;
  doorChance?: number;
  heightChance?: number;
  loopChance?: number;
  roomLabels?: boolean;
  natureEnabled?: boolean;
  useBiomes?: boolean;
  debugBiomes?: boolean;
  debugDebris?: boolean;
  debugProjectileStick?: boolean;
  forceStairs?: boolean;
  timeOfDay?: number;
  dayCycleEnabled?: boolean;
  dayCycleSpeed?: number;
  fastNights?: boolean;
  sunDebug?: boolean;
  hmrCacheEnabled?: boolean;
  dungeonVariant?: string;
  dungeonSize?: number;
  progressiveLayout?: boolean;
  progressionRecipe?: string;
  postProcess?: PostProcessSettings;
  characterPushEnabled?: boolean;
  particleToggles?: ParticleToggles;
  enemyParams?: EnemyParams;
  enemiesEnabled?: boolean;
  /** @deprecated Renamed to characterParams; kept for migration. */
  playerParams?: MovementParams;
}

function loadSettings(): SavedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {};
}

function saveSettings(): void {
  const s = useGameStore.getState();
  const data: SavedSettings = {
    characterParams: s.characterParams,
    cameraParams: s.cameraParams,
    lightPreset: s.lightPreset,
    torchEnabled: s.torchEnabled,
    torchParams: s.torchParams,
    terrainPreset: s.terrainPreset,
    heightmapStyle: s.heightmapStyle,
    paletteName: s.paletteName,
    roomSpacing: s.roomSpacing,
    roomSpacingMax: s.roomSpacingMax,
    tileSize: s.tileSize,
    gridOpacity: s.gridOpacity,
    resolutionScale: s.resolutionScale,
    testProp: s.testProp,
    testFloor: s.testFloor,
    doorChance: s.doorChance,
    heightChance: s.heightChance,
    loopChance: s.loopChance,
    roomLabels: s.roomLabels,
    natureEnabled: s.natureEnabled,
    useBiomes: s.useBiomes,
    debugBiomes: s.debugBiomes,
    debugDebris: s.debugDebris,
    debugProjectileStick: s.debugProjectileStick,
    forceStairs: s.forceStairs,
    timeOfDay: s.timeOfDay,
    dayCycleEnabled: s.dayCycleEnabled,
    dayCycleSpeed: s.dayCycleSpeed,
    fastNights: s.fastNights,
    sunDebug: s.sunDebug,
    hmrCacheEnabled: s.hmrCacheEnabled,
    dungeonVariant: s.dungeonVariant,
    dungeonSize: s.dungeonSize,
    progressiveLayout: s.progressiveLayout,
    progressionRecipe: s.progressionRecipe,
    postProcess: s.postProcess,
    characterPushEnabled: s.characterPushEnabled,
    particleToggles: s.particleToggles,
    enemyParams: s.enemyParams,
    enemiesEnabled: s.enemiesEnabled,
  };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

// ── Store ─────────────────────────────────────────────────────────────

interface GameStore {
  phase: 'menu' | 'select' | 'playing' | 'paused' | 'player_dead';
  /** When phase became 'player_dead' (Date.now()); used for cooldown before "Press any key" */
  playerDeadAt: number | null;
  /** Set by Camera on pointer up after drag so death overlay does not treat release-as-click as tap to continue */
  lastPointerUpWasAfterDrag: boolean;
  score: number;
  hp: number;
  maxHp: number;
  hunger: number;
  maxHunger: number;
  floor: number;
  /** Base seed for the entire dungeon run — combined with floor number for per-level seeds */
  dungeonBaseSeed: number;
  /** Cached level snapshots keyed by floor number */
  levelCache: Record<number, LevelSnapshot>;
  /** Dungeon theme for the current level */
  currentTheme: string;
  /** Current zone name derived from floor config (e.g. "Upper Cellars") */
  zoneName: string;
  /** Current zone subtitle (e.g. "Autumn Hills") */
  zoneSubtitle: string;
  /** Zone announcement to display on floor transition (title + optional subtitle), cleared after display */
  zoneAnnouncement: { title: string; subtitle?: string } | null;
  message: string | null;

  selectedCharacter: CharacterType | null;
  collectibles: number;
  coins: number;
  potionInventory: PotionSlot[];
  speechBubbles: SpeechBubbleData[];
  particleToggles: ParticleToggles;
  characterParams: MovementParams;
  cameraParams: CameraParams;
  lightPreset: LightPreset;
  torchEnabled: boolean;
  torchParams: TorchParams;
  terrainPreset: TerrainPreset;
  heightmapStyle: HeightmapStyle;
  paletteName: string; // user selection: 'random' or specific name
  paletteActive: string; // actual palette in use (for display)
  roomSpacing: number;
  roomSpacingMax: number;
  tileSize: number;
  gridOpacity: number;
  resolutionScale: number;
  testProp: string;
  testFloor: string;
  doorChance: number;
  heightChance: number;
  setHeightChance: (chance: number) => void;
  loopChance: number;
  setLoopChance: (chance: number) => void;
  roomLabels: boolean;
  natureEnabled: boolean;
  setNatureEnabled: (on: boolean) => void;
  useBiomes: boolean;
  setUseBiomes: (on: boolean) => void;
  debugBiomes: boolean;
  setDebugBiomes: (on: boolean) => void;
  debugDebris: boolean;
  setDebugDebris: (on: boolean) => void;
  debugProjectileStick: boolean;
  setDebugProjectileStick: (on: boolean) => void;
  forceStairs: boolean;
  setForceStairs: (on: boolean) => void;
  timeOfDay: number;
  setTimeOfDay: (v: number) => void;
  dayCycleEnabled: boolean;
  setDayCycleEnabled: (v: boolean) => void;
  dayCycleSpeed: number;
  setDayCycleSpeed: (v: number) => void;
  fastNights: boolean;
  setFastNights: (v: boolean) => void;
  sunDebug: boolean;
  setSunDebug: (v: boolean) => void;
  hmrCacheEnabled: boolean;
  setHmrCacheEnabled: (on: boolean) => void;
  dungeonVariant: string;
  setDungeonVariant: (variant: string) => void;
  /** Active progression recipe name (e.g. "Classic", "Blitz", "Nightmare"). */
  progressionRecipe: string;
  setProgressionRecipe: (name: string) => void;
  dungeonSize: number;
  setDungeonSize: (size: number) => void;
  progressiveLayout: boolean;
  setProgressiveLayout: (on: boolean) => void;
  postProcess: PostProcessSettings;
  setPostProcess: (settings: PostProcessSettings) => void;
  setPostProcessParam: <K extends keyof PostProcessSettings>(
    key: K,
    value: PostProcessSettings[K],
  ) => void;

  enemyParams: EnemyParams;
  setEnemyParam: <K extends keyof EnemyParams>(
    key: K,
    value: EnemyParams[K],
  ) => void;
  setEnemyMeleeParam: <K extends keyof MeleeParams>(
    key: K,
    value: MeleeParams[K],
  ) => void;
  setEnemyRangedParam: <K extends keyof (RangedParams & { enabled: boolean })>(
    key: K,
    value: (RangedParams & { enabled: boolean })[K],
  ) => void;

  enemiesEnabled: boolean;
  setEnemiesEnabled: (v: boolean) => void;

  /** If true, characters push each other apart when overlapping; if false, only the non-player is pushed (player stays put). */
  characterPushEnabled: boolean;
  setCharacterPushEnabled: (v: boolean) => void;

  /** True when any settings sub-panel (Scene/Player/Camera/Light) is open; game loop pauses. */
  settingsPanelOpen: boolean;
  setSettingsPanelOpen: (v: boolean) => void;

  setPhase: (phase: GameStore['phase']) => void;
  setPlayerDeadAt: (at: number | null) => void;
  setLastPointerUpWasAfterDrag: (v: boolean) => void;
  setScore: (score: number) => void;
  setHP: (hp: number, maxHp: number) => void;
  setHunger: (hunger: number, maxHunger: number) => void;
  setFloor: (floor: number) => void;
  setDungeonBaseSeed: (seed: number) => void;
  /** Get the deterministic seed for a given floor */
  getFloorSeed: (floor: number) => number;
  /** Save a level snapshot to the cache */
  saveLevelSnapshot: (floor: number, snapshot: LevelSnapshot) => void;
  /** Get a cached level snapshot (or undefined) */
  getLevelSnapshot: (floor: number) => LevelSnapshot | undefined;
  /** Clear all level cache (e.g. on new game) */
  clearLevelCache: () => void;
  setCurrentTheme: (theme: string) => void;
  setZoneName: (name: string) => void;
  setZoneSubtitle: (subtitle: string) => void;
  setZoneAnnouncement: (
    announcement: { title: string; subtitle?: string } | null,
  ) => void;
  /** Shared zone transition: clears bottom-left labels (scramble out), then optionally
   *  sets a centered announcement after a beat so it scrambles in during fade-out.
   *  Pass null announcement for transitions without centered text (e.g. returning to overworld). */
  beginZoneTransition: (announcement: { title: string; subtitle?: string } | null) => void;
  showMessage: (msg: string | null) => void;

  selectCharacter: (type: CharacterType) => void;
  setCollectibles: (n: number) => void;
  addCoins: (n: number) => void;
  addPotionToInventory: (colorIndex: number) => void;
  removePotionFromInventory: (colorIndex: number) => void;
  clearPotionInventory: () => void;
  setSpeechBubbles: (bubbles: SpeechBubbleData[]) => void;
  toggleParticle: (key: keyof ParticleToggles) => void;
  setCharacterParam: <K extends keyof MovementParams>(
    key: K,
    value: MovementParams[K],
  ) => void;
  setMeleeParam: <K extends keyof MeleeParams>(
    key: K,
    value: MeleeParams[K],
  ) => void;
  setRangedParam: <K extends keyof RangedParams>(
    key: K,
    value: RangedParams[K],
  ) => void;
  setCameraParam: <K extends keyof CameraParams>(
    key: K,
    value: CameraParams[K],
  ) => void;
  setLightPreset: (preset: LightPreset) => void;
  toggleTorch: () => void;
  setTorchParam: <K extends keyof TorchParams>(
    key: K,
    value: TorchParams[K],
  ) => void;
  setTerrainPreset: (preset: TerrainPreset) => void;
  setHeightmapStyle: (style: HeightmapStyle) => void;
  setPaletteName: (name: string) => void;
  setPaletteActive: (name: string) => void;
  setRoomSpacing: (spacing: number) => void;
  setRoomSpacingMax: (spacing: number) => void;
  setTileSize: (size: number) => void;
  setGridOpacity: (gridOpacity: number) => void;
  setResolutionScale: (scale: number) => void;
  setTestProp: (prop: string) => void;
  setTestFloor: (floor: string) => void;
  setDoorChance: (chance: number) => void;
  setRoomLabels: (on: boolean) => void;

  /** Active potion effects for HUD display */
  activePotionEffects: ActivePotionDisplay[];
  setActivePotionEffects: (effects: ActivePotionDisplay[]) => void;

  activeCharacterName: string | null;
  activeCharacterColor: string | null;
  setActiveCharacter: (name: string | null, color: string | null) => void;

  /** Overworld map state (null when not on overworld) */
  overworldState: OverworldState | null;
  setOverworldState: (state: OverworldState | null) => void;
  setOverworldActiveTile: (index: number | null) => void;
  setOverworldPlayerPos: (pos: { x: number; z: number; y: number } | null) => void;

  heightmapThumb: string | null;
  setHeightmapThumb: (url: string | null) => void;
  walkableCells: number;
  setWalkableCells: (count: number) => void;

  onStartGame: (() => void) | null;
  onPauseToggle: (() => void) | null;
  onRestart: (() => void) | null;
  onRegenerateScene: (() => void) | null;
  onRemesh: (() => void) | null;
  onRandomizePalette: (() => void) | null;
  onApplyPalette: ((name: string) => void) | null;
  onResetCharacterParams: (() => void) | null;
  onResetCameraParams: (() => void) | null;
  onResetLightParams: (() => void) | null;
  onResetSceneParams: (() => void) | null;
  onSpawnEnemy: (() => void) | null;
  onResetEnemyParams: (() => void) | null;
  onDrinkPotion: ((colorIndex: number) => void) | null;
  onTestFrenzyDrink: (() => void) | null;
  onTestFrenzyKick: (() => void) | null;
}

const saved = loadSettings();

export const useGameStore = create<GameStore>((set, get) => ({
  phase: 'menu',
  playerDeadAt: null,
  lastPointerUpWasAfterDrag: false,
  score: 0,
  hp: 100,
  maxHp: 100,
  hunger: 80,
  maxHunger: 100,
  floor: 1,
  dungeonBaseSeed: (Math.random() * 0xffffffff) >>> 0,
  levelCache: {},
  currentTheme: '',
  zoneName: 'Upper Cellars',
  zoneSubtitle: '',
  zoneAnnouncement: null,
  message: null,

  selectedCharacter: null,
  collectibles: 0,
  coins: 0,
  potionInventory: [],
  speechBubbles: [],
  particleToggles: saved.particleToggles ?? { ...DEFAULT_PARTICLE_TOGGLES },
  characterParams: {
    ...DEFAULT_CHARACTER_PARAMS,
    ...(saved.characterParams ?? saved.playerParams),
  },
  cameraParams: (() => {
    const def = { ...DEFAULT_CAMERA_PARAMS };
    const savedCam = saved.cameraParams;
    if (!savedCam) return def;
    return {
      ...def,
      ...savedCam,
      distance: savedCam.distance ?? def.distance,
    };
  })(),
  lightPreset: saved.lightPreset ?? DEFAULT_LIGHT_PRESET,
  torchEnabled: saved.torchEnabled ?? true,
  torchParams: saved.torchParams ?? { ...DEFAULT_TORCH_PARAMS },
  terrainPreset: saved.terrainPreset ?? DEFAULT_SCENE_SETTINGS.terrainPreset,
  heightmapStyle: saved.heightmapStyle ?? DEFAULT_SCENE_SETTINGS.heightmapStyle,
  paletteName: saved.paletteName ?? DEFAULT_SCENE_SETTINGS.paletteName,
  paletteActive: '',
  roomSpacing: saved.roomSpacing ?? DEFAULT_SCENE_SETTINGS.roomSpacing,
  roomSpacingMax: saved.roomSpacingMax ?? DEFAULT_SCENE_SETTINGS.roomSpacingMax,
  tileSize: saved.tileSize ?? DEFAULT_SCENE_SETTINGS.tileSize,
  gridOpacity: saved.gridOpacity ?? DEFAULT_SCENE_SETTINGS.gridOpacity,
  resolutionScale:
    saved.resolutionScale ?? DEFAULT_SCENE_SETTINGS.resolutionScale,
  testProp: saved.testProp ?? DEFAULT_SCENE_SETTINGS.testProp,
  testFloor: saved.testFloor ?? DEFAULT_SCENE_SETTINGS.testFloor,
  doorChance: saved.doorChance ?? DEFAULT_SCENE_SETTINGS.doorChance,
  heightChance: saved.heightChance ?? DEFAULT_SCENE_SETTINGS.heightChance,
  setHeightChance: (heightChance) => set({ heightChance }),
  loopChance: saved.loopChance ?? DEFAULT_SCENE_SETTINGS.loopChance,
  setLoopChance: (loopChance) => set({ loopChance }),
  roomLabels: saved.roomLabels ?? DEFAULT_SCENE_SETTINGS.roomLabels,
  natureEnabled: saved.natureEnabled ?? DEFAULT_SCENE_SETTINGS.natureEnabled,
  setNatureEnabled: (natureEnabled) => set({ natureEnabled }),
  useBiomes: saved.useBiomes ?? DEFAULT_SCENE_SETTINGS.useBiomes,
  setUseBiomes: (useBiomes) => set({ useBiomes }),
  debugBiomes: saved.debugBiomes ?? DEFAULT_SCENE_SETTINGS.debugBiomes,
  setDebugBiomes: (debugBiomes) => set({ debugBiomes }),
  debugDebris: saved.debugDebris ?? DEFAULT_SCENE_SETTINGS.debugDebris,
  setDebugDebris: (debugDebris) => set({ debugDebris }),
  debugProjectileStick:
    saved.debugProjectileStick ?? DEFAULT_SCENE_SETTINGS.debugProjectileStick,
  setDebugProjectileStick: (debugProjectileStick) =>
    set({ debugProjectileStick }),
  forceStairs: saved.forceStairs ?? DEFAULT_SCENE_SETTINGS.forceStairs,
  setForceStairs: (forceStairs) => set({ forceStairs }),
  timeOfDay: saved.timeOfDay ?? DEFAULT_SCENE_SETTINGS.timeOfDay,
  setTimeOfDay: (timeOfDay) => set({ timeOfDay }),
  dayCycleEnabled: saved.dayCycleEnabled ?? DEFAULT_SCENE_SETTINGS.dayCycleEnabled,
  setDayCycleEnabled: (dayCycleEnabled) => set({ dayCycleEnabled }),
  dayCycleSpeed: saved.dayCycleSpeed ?? DEFAULT_SCENE_SETTINGS.dayCycleSpeed,
  setDayCycleSpeed: (dayCycleSpeed) => set({ dayCycleSpeed }),
  fastNights: saved.fastNights ?? DEFAULT_SCENE_SETTINGS.fastNights,
  setFastNights: (fastNights) => set({ fastNights }),
  sunDebug: saved.sunDebug ?? DEFAULT_SCENE_SETTINGS.sunDebug,
  setSunDebug: (sunDebug) => set({ sunDebug }),
  hmrCacheEnabled:
    saved.hmrCacheEnabled ?? DEFAULT_SCENE_SETTINGS.hmrCacheEnabled,
  setHmrCacheEnabled: (hmrCacheEnabled) => set({ hmrCacheEnabled }),
  dungeonVariant: saved.dungeonVariant ?? DEFAULT_SCENE_SETTINGS.dungeonVariant,
  setDungeonVariant: (dungeonVariant) => set({ dungeonVariant }),
  progressionRecipe: saved.progressionRecipe ?? 'Classic',
  setProgressionRecipe: (progressionRecipe) => set({ progressionRecipe }),
  dungeonSize: saved.dungeonSize ?? DEFAULT_SCENE_SETTINGS.dungeonSize,
  setDungeonSize: (dungeonSize) => set({ dungeonSize }),
  progressiveLayout: saved.progressiveLayout ?? DEFAULT_SCENE_SETTINGS.progressiveLayout,
  setProgressiveLayout: (progressiveLayout) => set({ progressiveLayout }),
  postProcess: saved.postProcess ?? { ...DEFAULT_POST_PROCESS },
  setPostProcess: (postProcess) => set({ postProcess }),
  setPostProcessParam: (key, value) =>
    set((s) => ({ postProcess: { ...s.postProcess, [key]: value } })),

  enemyParams: (() => {
    const def = { ...DEFAULT_ENEMY_PARAMS };
    const se = saved.enemyParams;
    if (!se) return def;
    const merged = {
      ...def,
      ...se,
      speed: Array.isArray(se.speed)
        ? (se.speed as [number, number])
        : def.speed,
      melee: { ...def.melee, ...se.melee },
      ranged: { ...def.ranged, ...se.ranged },
    };
    return merged;
  })(),
  setEnemyParam: (key, value) =>
    set((s) => ({ enemyParams: { ...s.enemyParams, [key]: value } })),
  setEnemyMeleeParam: (key, value) =>
    set((s) => ({
      enemyParams: {
        ...s.enemyParams,
        melee: { ...s.enemyParams.melee, [key]: value } as any,
      },
    })),
  setEnemyRangedParam: (key, value) =>
    set((s) => ({
      enemyParams: {
        ...s.enemyParams,
        ranged: { ...s.enemyParams.ranged, [key]: value } as any,
      },
    })),

  enemiesEnabled: saved.enemiesEnabled ?? true,
  setEnemiesEnabled: (enemiesEnabled) => set({ enemiesEnabled }),

  characterPushEnabled: saved.characterPushEnabled ?? true,
  setCharacterPushEnabled: (characterPushEnabled) =>
    set({ characterPushEnabled }),

  settingsPanelOpen: false,
  setSettingsPanelOpen: (settingsPanelOpen) => set({ settingsPanelOpen }),

  setPhase: (phase) =>
    set((s) =>
      phase === 'player_dead'
        ? { phase: 'player_dead' as const, playerDeadAt: Date.now() }
        : { phase, playerDeadAt: null },
    ),
  setPlayerDeadAt: (playerDeadAt) => set({ playerDeadAt }),
  setLastPointerUpWasAfterDrag: (lastPointerUpWasAfterDrag) =>
    set({ lastPointerUpWasAfterDrag }),
  setScore: (score) => set({ score }),
  setHP: (hp, maxHp) => set({ hp, maxHp }),
  setHunger: (hunger, maxHunger) => set({ hunger, maxHunger }),
  setFloor: (floor) => set({ floor }),
  setDungeonBaseSeed: (dungeonBaseSeed) => set({ dungeonBaseSeed }),
  getFloorSeed: (floor) => floorSeed(get().dungeonBaseSeed, floor),
  saveLevelSnapshot: (floor, snapshot) =>
    set((s) => ({ levelCache: { ...s.levelCache, [floor]: snapshot } })),
  getLevelSnapshot: (floor) => get().levelCache[floor],
  clearLevelCache: () =>
    set({
      levelCache: {},
      dungeonBaseSeed: (Math.random() * 0xffffffff) >>> 0,
    }),
  setCurrentTheme: (currentTheme) => set({ currentTheme }),
  setZoneName: (zoneName) => set({ zoneName }),
  setZoneSubtitle: (zoneSubtitle) => set({ zoneSubtitle }),
  setZoneAnnouncement: (zoneAnnouncement) => set({ zoneAnnouncement }),
  beginZoneTransition: (announcement) => {
    // Clear bottom-left labels immediately (scramble out)
    set({ zoneName: '', zoneSubtitle: '' });
    // If there's an announcement, set it after a beat so scramble-out starts first
    if (announcement) {
      setTimeout(() => {
        useGameStore.getState().setZoneAnnouncement(announcement);
      }, 100);
    }
  },
  showMessage: (message) => set({ message }),

  selectCharacter: (type) => set({ selectedCharacter: type, phase: 'playing' }),
  setCollectibles: (collectibles) => set({ collectibles }),
  addCoins: (n) => set((s) => ({ coins: s.coins + n })),
  addPotionToInventory: (colorIndex) =>
    set((s) => {
      const inv = [...s.potionInventory];
      const existing = inv.find((slot) => slot.colorIndex === colorIndex);
      if (existing) {
        existing.count++;
      } else {
        inv.push({ colorIndex, count: 1 });
      }
      return { potionInventory: inv };
    }),
  removePotionFromInventory: (colorIndex) =>
    set((s) => {
      const inv = s.potionInventory
        .map((slot) =>
          slot.colorIndex === colorIndex
            ? { ...slot, count: slot.count - 1 }
            : slot,
        )
        .filter((slot) => slot.count > 0);
      return { potionInventory: inv };
    }),
  clearPotionInventory: () => set({ potionInventory: [] }),
  setSpeechBubbles: (speechBubbles) => set({ speechBubbles }),
  toggleParticle: (key) =>
    set((s) => ({
      particleToggles: { ...s.particleToggles, [key]: !s.particleToggles[key] },
    })),
  setCharacterParam: (key, value) =>
    set((s) => ({
      characterParams: { ...s.characterParams, [key]: value },
    })),
  setMeleeParam: (key, value) =>
    set((s) => ({
      characterParams: {
        ...s.characterParams,
        melee: { ...s.characterParams.melee, [key]: value },
      },
    })),
  setRangedParam: (key, value) =>
    set((s) => ({
      characterParams: {
        ...s.characterParams,
        ranged: { ...s.characterParams.ranged, [key]: value },
      },
    })),
  setCameraParam: (key, value) =>
    set((s) => ({
      cameraParams: { ...s.cameraParams, [key]: value },
    })),
  setLightPreset: (lightPreset) => set({ lightPreset }),
  toggleTorch: () => set((s) => ({ torchEnabled: !s.torchEnabled })),
  setTorchParam: (key, value) =>
    set((s) => ({
      torchParams: { ...s.torchParams, [key]: value },
    })),
  setTerrainPreset: (terrainPreset) => set({ terrainPreset }),
  setHeightmapStyle: (heightmapStyle) => set({ heightmapStyle }),
  setPaletteName: (paletteName) => set({ paletteName }),
  setPaletteActive: (paletteActive) => set({ paletteActive }),
  setRoomSpacing: (roomSpacing) => set({ roomSpacing }),
  setRoomSpacingMax: (roomSpacingMax) => set({ roomSpacingMax }),
  setTileSize: (tileSize) => set({ tileSize }),
  setGridOpacity: (gridOpacity) => set({ gridOpacity }),
  setResolutionScale: (resolutionScale) => set({ resolutionScale }),
  setTestProp: (testProp) => set({ testProp }),
  setTestFloor: (testFloor) => set({ testFloor }),
  setDoorChance: (doorChance) => set({ doorChance }),
  setRoomLabels: (roomLabels) => set({ roomLabels }),

  activePotionEffects: [],
  setActivePotionEffects: (activePotionEffects) => set({ activePotionEffects }),

  activeCharacterName: null,
  activeCharacterColor: null,
  setActiveCharacter: (activeCharacterName, activeCharacterColor) =>
    set({ activeCharacterName, activeCharacterColor }),

  overworldState: null,
  setOverworldState: (overworldState) => set({ overworldState }),
  setOverworldActiveTile: (index) =>
    set((s) => ({
      overworldState: s.overworldState
        ? { ...s.overworldState, activeTileIndex: index }
        : null,
    })),
  setOverworldPlayerPos: (pos) =>
    set((s) => ({
      overworldState: s.overworldState
        ? { ...s.overworldState, savedPlayerPos: pos }
        : null,
    })),

  heightmapThumb: null,
  setHeightmapThumb: (heightmapThumb) => set({ heightmapThumb }),
  walkableCells: 0,
  setWalkableCells: (walkableCells) => set({ walkableCells }),

  onStartGame: null,
  onPauseToggle: null,
  onRestart: null,
  onRegenerateScene: null,
  onRemesh: null,
  onRandomizePalette: null,
  onApplyPalette: null,
  onResetCharacterParams: null,
  onResetCameraParams: null,
  onResetLightParams: null,
  onResetSceneParams: null,
  onSpawnEnemy: null,
  onResetEnemyParams: null,
  onDrinkPotion: null,
  onTestFrenzyDrink: null,
  onTestFrenzyKick: null,
}));

// Auto-save settings to localStorage on any change
useGameStore.subscribe(saveSettings);
