import { create } from 'zustand';
import type { CharacterType, SpeechBubbleData } from './types';
import { Layer } from './game/Entity';
import type { TerrainPreset } from './game/Terrain';
import type { HeightmapStyle } from './game/TerrainNoise';

export interface ParticleToggles {
  dust: boolean;
  lightRain: boolean;
  rain: boolean;
  debris: boolean;
}

export interface PlayerParams {
  speed: number;
  stepHeight: number;
  slopeHeight: number;
  capsuleRadius: number;
  arrivalReach: number;
  hopHeight: number;
  magnetRadius: number;
  magnetSpeed: number;
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
  minDistance: number;
  maxDistance: number;
  pitchMin: number;
  pitchMax: number;
  rotationSpeed: number;
  zoomSpeed: number;
  collisionLayers: number;
}

// ── Defaults ──────────────────────────────────────────────────────────

export const DEFAULT_PLAYER_PARAMS: PlayerParams = {
  speed: 4, stepHeight: 0.8, slopeHeight: 1.5, capsuleRadius: 0.2,
  arrivalReach: 0.1, hopHeight: 0.1, magnetRadius: 2, magnetSpeed: 16,
};

export const DEFAULT_CAMERA_PARAMS: CameraParams = {
  minDistance: 5, maxDistance: 25, pitchMin: -80, pitchMax: -10,
  rotationSpeed: 0.005, zoomSpeed: 0.01, collisionLayers: Layer.None,
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
  terrainPreset: 'heightmap' as TerrainPreset,
  heightmapStyle: 'islands' as HeightmapStyle,
  paletteName: 'random',
  wallGap: 1,
  gridOpacity: 0.25,
  resolutionScale: 1,
};

// ── localStorage persistence ──────────────────────────────────────────

const SETTINGS_KEY = 'dcrawler:settings';
const CHARACTERS_KEY = 'dcrawler:characters';

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
  gridOpacity?: number;
  resolutionScale?: number;
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
    gridOpacity: s.gridOpacity,
    resolutionScale: s.resolutionScale,
    particleToggles: s.particleToggles,
  };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

/** Movement-only subset of PlayerParams, used for per-character storage. */
interface StoredMovementParams {
  speed: number;
  stepHeight: number;
  slopeHeight: number;
  capsuleRadius: number;
  arrivalReach: number;
  hopHeight: number;
}

export function loadCharacterParams(type: string): StoredMovementParams | null {
  try {
    const raw = localStorage.getItem(CHARACTERS_KEY);
    if (!raw) return null;
    const all = JSON.parse(raw);
    return all[type] ?? null;
  } catch { return null; }
}

export function saveCharacterParams(type: string, params: StoredMovementParams): void {
  try {
    const raw = localStorage.getItem(CHARACTERS_KEY);
    const all: Record<string, StoredMovementParams> = raw ? JSON.parse(raw) : {};
    const d = DEFAULT_PLAYER_PARAMS;
    const isDefault =
      params.speed === d.speed && params.stepHeight === d.stepHeight &&
      params.slopeHeight === d.slopeHeight && params.capsuleRadius === d.capsuleRadius &&
      params.arrivalReach === d.arrivalReach && params.hopHeight === d.hopHeight;
    if (isDefault) {
      delete all[type];
    } else {
      all[type] = { speed: params.speed, stepHeight: params.stepHeight, slopeHeight: params.slopeHeight, capsuleRadius: params.capsuleRadius, arrivalReach: params.arrivalReach, hopHeight: params.hopHeight };
    }
    if (Object.keys(all).length === 0) {
      localStorage.removeItem(CHARACTERS_KEY);
    } else {
      localStorage.setItem(CHARACTERS_KEY, JSON.stringify(all));
    }
  } catch { /* ignore */ }
}

export function clearCharacterParams(type: string): void {
  try {
    const raw = localStorage.getItem(CHARACTERS_KEY);
    if (!raw) return;
    const all = JSON.parse(raw);
    delete all[type];
    if (Object.keys(all).length === 0) {
      localStorage.removeItem(CHARACTERS_KEY);
    } else {
      localStorage.setItem(CHARACTERS_KEY, JSON.stringify(all));
    }
  } catch { /* ignore */ }
}

// ── Store ─────────────────────────────────────────────────────────────

interface GameStore {
  phase: 'menu' | 'select' | 'playing' | 'paused' | 'gameover';
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
  gridOpacity: number;
  resolutionScale: number;

  setPhase: (phase: GameStore['phase']) => void;
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
  setPlayerParam: (key: keyof PlayerParams, value: number) => void;
  setCameraParam: <K extends keyof CameraParams>(key: K, value: CameraParams[K]) => void;
  setLightPreset: (preset: LightPreset) => void;
  toggleTorch: () => void;
  setTorchParam: <K extends keyof TorchParams>(key: K, value: TorchParams[K]) => void;
  setTerrainPreset: (preset: TerrainPreset) => void;
  setHeightmapStyle: (style: HeightmapStyle) => void;
  setPaletteName: (name: string) => void;
  setPaletteActive: (name: string) => void;
  setWallGap: (gap: number) => void;
  setGridOpacity: (gridOpacity: number) => void;
  setResolutionScale: (scale: number) => void;

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
  playerParams: saved.playerParams ?? { ...DEFAULT_PLAYER_PARAMS },
  cameraParams: saved.cameraParams ?? { ...DEFAULT_CAMERA_PARAMS },
  lightPreset: saved.lightPreset ?? DEFAULT_LIGHT_PRESET,
  torchEnabled: saved.torchEnabled ?? true,
  torchParams: saved.torchParams ?? { ...DEFAULT_TORCH_PARAMS },
  terrainPreset: saved.terrainPreset ?? DEFAULT_SCENE_SETTINGS.terrainPreset,
  heightmapStyle: saved.heightmapStyle ?? DEFAULT_SCENE_SETTINGS.heightmapStyle,
  paletteName: saved.paletteName ?? DEFAULT_SCENE_SETTINGS.paletteName,
  paletteActive: '',
  wallGap: saved.wallGap ?? DEFAULT_SCENE_SETTINGS.wallGap,
  gridOpacity: saved.gridOpacity ?? DEFAULT_SCENE_SETTINGS.gridOpacity,
  resolutionScale: saved.resolutionScale ?? DEFAULT_SCENE_SETTINGS.resolutionScale,

  setPhase: (phase) => set({ phase }),
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
  setGridOpacity: (gridOpacity) => set({ gridOpacity }),
  setResolutionScale: (resolutionScale) => set({ resolutionScale }),

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
