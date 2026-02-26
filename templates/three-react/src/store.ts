import { create } from 'zustand';
import type { CharacterType, SpeechBubbleData } from './types';
import { Layer } from './game/Entity';
import type { TerrainPreset } from './game/Terrain';
import type { HeightmapStyle } from './game/TerrainNoise';
import { DEFAULT_CHARACTER_PARAMS } from './game/CharacterParams';

export interface ParticleToggles {
  dust: boolean;
  lightRain: boolean;
  rain: boolean;
  debris: boolean;
}

export type MovementMode = 'free' | 'grid';

export interface PlayerParams {
  speed: number;
  stepHeight: number;
  slopeHeight: number;
  capsuleRadius: number;
  arrivalReach: number;
  hopHeight: number;
  magnetRadius: number;
  magnetSpeed: number;
  movementMode: MovementMode;
  showPathDebug: boolean;
  exhaustionEnabled: boolean;
  attackReach: number;
  attackArcHalf: number;
  attackDamage: number;
  attackCooldown: number;
  chaseRange: number;
  knockbackSpeed: number;
  knockbackDecay: number;
  invulnDuration: number;
  flashDuration: number;
  stunDuration: number;
  attackDuration: number;
  exhaustDuration: number;
  showSlashEffect: boolean;
}

export type LightPreset = 'default' | 'bright' | 'dark' | 'none';

export interface TorchParams {
  intensity: number;
  distance: number;
  offsetForward: number;  // forward from character facing
  offsetRight: number;    // right of character facing
  offsetUp: number;       // height above character
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

// ── Defaults ──────────────────────────────────────────────────────────

/** Player params: character defaults + player-only overrides (magnet, exhaustion, slash effect). */
export const DEFAULT_PLAYER_PARAMS: PlayerParams = {
  ...DEFAULT_CHARACTER_PARAMS,
  magnetRadius: 1,
  magnetSpeed: 16,
  exhaustionEnabled: false,
  showSlashEffect: true,
};

export const DEFAULT_CAMERA_PARAMS: CameraParams = {
  fov: 60,
  minDistance: 5, maxDistance: 25, distance: 12, pitchMin: -80, pitchMax: -10,
  rotationSpeed: 0.005, zoomSpeed: 0.01, collisionLayers: Layer.None, collisionSkin: 0.1,
};

export const DEFAULT_TORCH_PARAMS: TorchParams = {
  intensity: 2.5, distance: 8, offsetForward: 0.3, offsetRight: 0.25,
  offsetUp: 1.0, color: '#ff9944', flicker: 0.3,
};

export const DEFAULT_LIGHT_PRESET: LightPreset = 'default';

export const DEFAULT_PARTICLE_TOGGLES: ParticleToggles = {
  dust: true, lightRain: false, rain: false, debris: false,
};

export const DEFAULT_SCENE_SETTINGS = {
  terrainPreset: 'voxelDungeon' as TerrainPreset,
  heightmapStyle: 'islands' as HeightmapStyle,
  paletteName: 'random',
  wallGap: 1,
  roomSpacing: 3,
  tileSize: 0.75,
  gridOpacity: 0.25,
  resolutionScale: 1,
  testProp: '' as string,  // empty = normal templates, category name = spawn only that
  testFloor: '' as string, // empty = random ground tiles, tile id = use only that
  doorChance: 0.7,
  roomLabels: true, // voxelDungeon: show room name labels (e.g. "Barracks")
  natureEnabled: true,
  useBiomes: true,
  debugBiomes: false,
  debugProjectileStick: false,
};

// ── localStorage persistence ──────────────────────────────────────────

const SETTINGS_KEY = 'dcrawler:settings';

interface SavedSettings {
  playerParams?: PlayerParams;
  cameraParams?: CameraParams;
  lightPreset?: LightPreset;
  torchEnabled?: boolean;
  torchParams?: TorchParams;
  terrainPreset?: TerrainPreset;
  heightmapStyle?: HeightmapStyle;
  paletteName?: string;
  wallGap?: number;
  roomSpacing?: number;
  tileSize?: number;
  gridOpacity?: number;
  resolutionScale?: number;
  testProp?: string;
  testFloor?: string;
  doorChance?: number;
  roomLabels?: boolean;
  natureEnabled?: boolean;
  useBiomes?: boolean;
  debugBiomes?: boolean;
  debugProjectileStick?: boolean;
  characterPushEnabled?: boolean;
  particleToggles?: ParticleToggles;
}

function loadSettings(): SavedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveSettings(): void {
  const s = useGameStore.getState();
  const data: SavedSettings = {
    playerParams: s.playerParams,
    cameraParams: s.cameraParams,
    lightPreset: s.lightPreset,
    torchEnabled: s.torchEnabled,
    torchParams: s.torchParams,
    terrainPreset: s.terrainPreset,
    heightmapStyle: s.heightmapStyle,
    paletteName: s.paletteName,
    wallGap: s.wallGap,
    roomSpacing: s.roomSpacing,
    tileSize: s.tileSize,
    gridOpacity: s.gridOpacity,
    resolutionScale: s.resolutionScale,
    testProp: s.testProp,
    testFloor: s.testFloor,
    doorChance: s.doorChance,
    roomLabels: s.roomLabels,
    natureEnabled: s.natureEnabled,
    useBiomes: s.useBiomes,
    debugBiomes: s.debugBiomes,
    debugProjectileStick: s.debugProjectileStick,
    characterPushEnabled: s.characterPushEnabled,
    particleToggles: s.particleToggles,
  };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch { /* ignore */ }
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
  floor: number;
  message: string | null;

  selectedCharacter: CharacterType | null;
  collectibles: number;
  coins: number;
  potions: number;
  speechBubbles: SpeechBubbleData[];
  particleToggles: ParticleToggles;
  playerParams: PlayerParams;
  cameraParams: CameraParams;
  lightPreset: LightPreset;
  torchEnabled: boolean;
  torchParams: TorchParams;
  terrainPreset: TerrainPreset;
  heightmapStyle: HeightmapStyle;
  paletteName: string;       // user selection: 'random' or specific name
  paletteActive: string;     // actual palette in use (for display)
  wallGap: number;
  roomSpacing: number;
  tileSize: number;
  gridOpacity: number;
  resolutionScale: number;
  testProp: string;
  testFloor: string;
  doorChance: number;
  roomLabels: boolean;
  natureEnabled: boolean;
  setNatureEnabled: (on: boolean) => void;
  useBiomes: boolean;
  setUseBiomes: (on: boolean) => void;
  debugBiomes: boolean;
  setDebugBiomes: (on: boolean) => void;
  debugProjectileStick: boolean;
  setDebugProjectileStick: (on: boolean) => void;

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
  setFloor: (floor: number) => void;
  showMessage: (msg: string | null) => void;

  selectCharacter: (type: CharacterType) => void;
  setCollectibles: (n: number) => void;
  addCoins: (n: number) => void;
  addPotions: (n: number) => void;
  setSpeechBubbles: (bubbles: SpeechBubbleData[]) => void;
  toggleParticle: (key: keyof ParticleToggles) => void;
  setPlayerParam: <K extends keyof PlayerParams>(key: K, value: PlayerParams[K]) => void;
  setCameraParam: <K extends keyof CameraParams>(key: K, value: CameraParams[K]) => void;
  setLightPreset: (preset: LightPreset) => void;
  toggleTorch: () => void;
  setTorchParam: <K extends keyof TorchParams>(key: K, value: TorchParams[K]) => void;
  setTerrainPreset: (preset: TerrainPreset) => void;
  setHeightmapStyle: (style: HeightmapStyle) => void;
  setPaletteName: (name: string) => void;
  setPaletteActive: (name: string) => void;
  setWallGap: (gap: number) => void;
  setRoomSpacing: (spacing: number) => void;
  setTileSize: (size: number) => void;
  setGridOpacity: (gridOpacity: number) => void;
  setResolutionScale: (scale: number) => void;
  setTestProp: (prop: string) => void;
  setTestFloor: (floor: string) => void;
  setDoorChance: (chance: number) => void;
  setRoomLabels: (on: boolean) => void;

  activeCharacterName: string | null;
  activeCharacterColor: string | null;
  setActiveCharacter: (name: string | null, color: string | null) => void;

  heightmapThumb: string | null;
  setHeightmapThumb: (url: string | null) => void;

  onStartGame: (() => void) | null;
  onPauseToggle: (() => void) | null;
  onRestart: (() => void) | null;
  onRegenerateScene: (() => void) | null;
  onRemesh: (() => void) | null;
  onRandomizePalette: (() => void) | null;
  onResetPlayerParams: (() => void) | null;
  onResetCameraParams: (() => void) | null;
  onResetLightParams: (() => void) | null;
  onResetSceneParams: (() => void) | null;
}

const saved = loadSettings();

export const useGameStore = create<GameStore>((set) => ({
  phase: 'menu',
  playerDeadAt: null,
  lastPointerUpWasAfterDrag: false,
  score: 0,
  hp: 100,
  maxHp: 100,
  floor: 1,
  message: null,

  selectedCharacter: null,
  collectibles: 0,
  coins: 0,
  potions: 0,
  speechBubbles: [],
  particleToggles: saved.particleToggles ?? { ...DEFAULT_PARTICLE_TOGGLES },
  playerParams: { ...DEFAULT_PLAYER_PARAMS, ...saved.playerParams },
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
  wallGap: saved.wallGap ?? DEFAULT_SCENE_SETTINGS.wallGap,
  roomSpacing: saved.roomSpacing ?? DEFAULT_SCENE_SETTINGS.roomSpacing,
  tileSize: saved.tileSize ?? DEFAULT_SCENE_SETTINGS.tileSize,
  gridOpacity: saved.gridOpacity ?? DEFAULT_SCENE_SETTINGS.gridOpacity,
  resolutionScale: saved.resolutionScale ?? DEFAULT_SCENE_SETTINGS.resolutionScale,
  testProp: saved.testProp ?? DEFAULT_SCENE_SETTINGS.testProp,
  testFloor: saved.testFloor ?? DEFAULT_SCENE_SETTINGS.testFloor,
  doorChance: saved.doorChance ?? DEFAULT_SCENE_SETTINGS.doorChance,
  roomLabels: saved.roomLabels ?? DEFAULT_SCENE_SETTINGS.roomLabels,
  natureEnabled: saved.natureEnabled ?? DEFAULT_SCENE_SETTINGS.natureEnabled,
  setNatureEnabled: (natureEnabled) => set({ natureEnabled }),
  useBiomes: saved.useBiomes ?? DEFAULT_SCENE_SETTINGS.useBiomes,
  setUseBiomes: (useBiomes) => set({ useBiomes }),
  debugBiomes: saved.debugBiomes ?? DEFAULT_SCENE_SETTINGS.debugBiomes,
  setDebugBiomes: (debugBiomes) => set({ debugBiomes }),
  debugProjectileStick: saved.debugProjectileStick ?? DEFAULT_SCENE_SETTINGS.debugProjectileStick,
  setDebugProjectileStick: (debugProjectileStick) => set({ debugProjectileStick }),

  characterPushEnabled: saved.characterPushEnabled ?? true,
  setCharacterPushEnabled: (characterPushEnabled) => set({ characterPushEnabled }),

  settingsPanelOpen: false,
  setSettingsPanelOpen: (settingsPanelOpen) => set({ settingsPanelOpen }),

  setPhase: (phase) =>
    set((s) =>
      phase === 'player_dead'
        ? { phase: 'player_dead' as const, playerDeadAt: Date.now() }
        : { phase, playerDeadAt: null },
    ),
  setPlayerDeadAt: (playerDeadAt) => set({ playerDeadAt }),
  setLastPointerUpWasAfterDrag: (lastPointerUpWasAfterDrag) => set({ lastPointerUpWasAfterDrag }),
  setScore: (score) => set({ score }),
  setHP: (hp, maxHp) => set({ hp, maxHp }),
  setFloor: (floor) => set({ floor }),
  showMessage: (message) => set({ message }),

  selectCharacter: (type) => set({ selectedCharacter: type, phase: 'playing' }),
  setCollectibles: (collectibles) => set({ collectibles }),
  addCoins: (n) => set((s) => ({ coins: s.coins + n })),
  addPotions: (n) => set((s) => ({ potions: s.potions + n })),
  setSpeechBubbles: (speechBubbles) => set({ speechBubbles }),
  toggleParticle: (key) =>
    set((s) => ({
      particleToggles: { ...s.particleToggles, [key]: !s.particleToggles[key] },
    })),
  setPlayerParam: (key, value) =>
    set((s) => ({
      playerParams: { ...s.playerParams, [key]: value },
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
  setWallGap: (wallGap) => set({ wallGap }),
  setRoomSpacing: (roomSpacing) => set({ roomSpacing }),
  setTileSize: (tileSize) => set({ tileSize }),
  setGridOpacity: (gridOpacity) => set({ gridOpacity }),
  setResolutionScale: (resolutionScale) => set({ resolutionScale }),
  setTestProp: (testProp) => set({ testProp }),
  setTestFloor: (testFloor) => set({ testFloor }),
  setDoorChance: (doorChance) => set({ doorChance }),
  setRoomLabels: (roomLabels) => set({ roomLabels }),

  activeCharacterName: null,
  activeCharacterColor: null,
  setActiveCharacter: (activeCharacterName, activeCharacterColor) => set({ activeCharacterName, activeCharacterColor }),

  heightmapThumb: null,
  setHeightmapThumb: (heightmapThumb) => set({ heightmapThumb }),

  onStartGame: null,
  onPauseToggle: null,
  onRestart: null,
  onRegenerateScene: null,
  onRemesh: null,
  onRandomizePalette: null,
  onResetPlayerParams: null,
  onResetCameraParams: null,
  onResetLightParams: null,
  onResetSceneParams: null,
}));

// Auto-save settings to localStorage on any change
useGameStore.subscribe(saveSettings);
