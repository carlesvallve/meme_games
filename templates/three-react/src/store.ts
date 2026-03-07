import { create } from 'zustand';
import { Layer } from './game/core/Entity';

export interface ParticleToggles {
  dust: boolean;
  lightRain: boolean;
  rain: boolean;
  debris: boolean;
}

export type LightPreset = 'default' | 'bright' | 'dark' | 'none';

export interface TorchParams {
  intensity: number;
  distance: number;
  offsetForward: number;
  offsetRight: number;
  offsetUp: number;
  color: string;
  flicker: number;
}

export interface CameraParams {
  fov: number;
  minDistance: number;
  maxDistance: number;
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

export const LIGHT_DEFAULTS = {
  ambient: 1.0,
  dirPrimary: 2.0,
  dirFill: 1.0,
  dirRim: 0.7,
  hemi: 0.8,
};

export const LIGHT_PRESET_SCALES: Record<LightPreset, number> = {
  default: 1.5,
  bright: 2.25,
  dark: 0.25,
  none: 0,
};

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

// ── localStorage persistence ──────────────────────────────────────────

const SETTINGS_KEY = 'three-react:settings';

interface SavedSettings {
  cameraParams?: CameraParams;
  lightPreset?: LightPreset;
  torchEnabled?: boolean;
  torchParams?: TorchParams;
  timeOfDay?: number;
  dayCycleEnabled?: boolean;
  dayCycleSpeed?: number;
  postProcess?: PostProcessSettings;
  particleToggles?: ParticleToggles;
  gridOpacity?: number;
  gridCellSize?: number;
  charSpeed?: number;
  charMoveSpeed?: number;
  charHop?: boolean;
  charDebugPath?: boolean;
  charStringPull?: boolean;
  charStepHeight?: number;
  charSnapMode?: 'free' | '4dir' | '8dir';
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
    cameraParams: s.cameraParams,
    lightPreset: s.lightPreset,
    torchEnabled: s.torchEnabled,
    torchParams: s.torchParams,
    timeOfDay: s.timeOfDay,
    dayCycleEnabled: s.dayCycleEnabled,
    dayCycleSpeed: s.dayCycleSpeed,
    postProcess: s.postProcess,
    particleToggles: s.particleToggles,
    gridOpacity: s.gridOpacity,
    gridCellSize: s.gridCellSize,
    charSpeed: s.charSpeed,
    charMoveSpeed: s.charMoveSpeed,
    charHop: s.charHop,
    charDebugPath: s.charDebugPath,
    charStringPull: s.charStringPull,
    charStepHeight: s.charStepHeight,
    charSnapMode: s.charSnapMode,
  };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

// ── Store ─────────────────────────────────────────────────────────────

interface GameStore {
  phase: 'menu' | 'playing' | 'paused';

  particleToggles: ParticleToggles;
  cameraParams: CameraParams;
  lightPreset: LightPreset;
  torchEnabled: boolean;
  torchParams: TorchParams;
  gridOpacity: number;
  gridCellSize: number;
  setGridCellSize: (v: number) => void;
  timeOfDay: number;
  dayCycleEnabled: boolean;
  dayCycleSpeed: number;
  fastNights: boolean;
  sunDebug: boolean;
  postProcess: PostProcessSettings;

  // Character
  charAnimation: string;
  charSpeed: number;
  charMoveSpeed: number;
  charHop: boolean;
  charDebugPath: boolean;
  charStringPull: boolean;
  charStepHeight: number;
  charSnapMode: 'free' | '4dir' | '8dir';
  setCharAnimation: (v: string) => void;
  setCharSpeed: (v: number) => void;
  setCharMoveSpeed: (v: number) => void;
  setCharHop: (v: boolean) => void;
  setCharDebugPath: (v: boolean) => void;
  setCharStringPull: (v: boolean) => void;
  setCharStepHeight: (v: number) => void;
  setCharSnapMode: (v: 'free' | '4dir' | '8dir') => void;
  /** Populated by Game.ts after model loads */
  charAnimationList: string[];
  setCharAnimationList: (v: string[]) => void;

  settingsPanelOpen: boolean;
  setSettingsPanelOpen: (v: boolean) => void;

  setPhase: (phase: GameStore['phase']) => void;
  toggleParticle: (key: keyof ParticleToggles) => void;
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
  setGridOpacity: (gridOpacity: number) => void;
  setTimeOfDay: (v: number) => void;
  setDayCycleEnabled: (v: boolean) => void;
  setDayCycleSpeed: (v: number) => void;
  setFastNights: (v: boolean) => void;
  setSunDebug: (v: boolean) => void;
  setPostProcess: (settings: PostProcessSettings) => void;
  setPostProcessParam: <K extends keyof PostProcessSettings>(
    key: K,
    value: PostProcessSettings[K],
  ) => void;

  onStartGame: (() => void) | null;
  onPauseToggle: (() => void) | null;
  onResetCameraParams: (() => void) | null;
  onResetLightParams: (() => void) | null;
  obstacleSnap: boolean;
  setObstacleSnap: (v: boolean) => void;
  onGenerateObstacles: (() => void) | null;
  onClearObstacles: (() => void) | null;
}

const saved = loadSettings();

export const useGameStore = create<GameStore>((set) => ({
  phase: 'menu',

  particleToggles: saved.particleToggles ?? { ...DEFAULT_PARTICLE_TOGGLES },
  cameraParams: (() => {
    const def = { ...DEFAULT_CAMERA_PARAMS };
    const savedCam = saved.cameraParams;
    if (!savedCam) return def;
    return { ...def, ...savedCam };
  })(),
  lightPreset: saved.lightPreset ?? DEFAULT_LIGHT_PRESET,
  torchEnabled: saved.torchEnabled ?? false,
  torchParams: saved.torchParams ?? { ...DEFAULT_TORCH_PARAMS },
  gridOpacity: saved.gridOpacity ?? 0.25,
  gridCellSize: saved.gridCellSize ?? 1,
  setGridCellSize: (gridCellSize) => set({ gridCellSize }),
  timeOfDay: saved.timeOfDay ?? 10,
  dayCycleEnabled: saved.dayCycleEnabled ?? false,
  dayCycleSpeed: saved.dayCycleSpeed ?? 1,
  fastNights: true,
  sunDebug: false,
  postProcess: saved.postProcess ?? { ...DEFAULT_POST_PROCESS },

  charAnimation: 'Idle',
  charSpeed: saved.charSpeed ?? 1,
  charMoveSpeed: saved.charMoveSpeed ?? 5,
  charHop: saved.charHop ?? true,
  charDebugPath: saved.charDebugPath ?? false,
  charStringPull: saved.charStringPull ?? true,
  charStepHeight: saved.charStepHeight ?? 0.5,
  charSnapMode: (saved.charSnapMode ?? 'free') as 'free' | '4dir' | '8dir',
  setCharAnimation: (charAnimation) => set({ charAnimation }),
  setCharSpeed: (charSpeed) => set({ charSpeed }),
  setCharMoveSpeed: (charMoveSpeed) => set({ charMoveSpeed }),
  setCharHop: (charHop) => set({ charHop }),
  setCharDebugPath: (charDebugPath) => set({ charDebugPath }),
  setCharStringPull: (charStringPull) => set({ charStringPull }),
  setCharStepHeight: (charStepHeight) => set({ charStepHeight }),
  setCharSnapMode: (charSnapMode) => set({ charSnapMode }),
  charAnimationList: [],
  setCharAnimationList: (charAnimationList) => set({ charAnimationList }),

  settingsPanelOpen: false,
  setSettingsPanelOpen: (settingsPanelOpen) => set({ settingsPanelOpen }),

  setPhase: (phase) => set({ phase }),
  toggleParticle: (key) =>
    set((s) => ({
      particleToggles: { ...s.particleToggles, [key]: !s.particleToggles[key] },
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
  setGridOpacity: (gridOpacity) => set({ gridOpacity }),
  setTimeOfDay: (timeOfDay) => set({ timeOfDay }),
  setDayCycleEnabled: (dayCycleEnabled) => set({ dayCycleEnabled }),
  setDayCycleSpeed: (dayCycleSpeed) => set({ dayCycleSpeed }),
  setFastNights: (fastNights) => set({ fastNights }),
  setSunDebug: (sunDebug) => set({ sunDebug }),
  setPostProcess: (postProcess) => set({ postProcess }),
  setPostProcessParam: (key, value) =>
    set((s) => ({ postProcess: { ...s.postProcess, [key]: value } })),

  obstacleSnap: true,
  setObstacleSnap: (obstacleSnap) => set({ obstacleSnap }),
  onStartGame: null,
  onPauseToggle: null,
  onResetCameraParams: null,
  onResetLightParams: null,
  onGenerateObstacles: null,
  onClearObstacles: null,
}));

// Auto-save settings to localStorage on any change
useGameStore.subscribe(saveSettings);
