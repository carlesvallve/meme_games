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

export type CameraMode = 'topdown' | 'thirdperson';

export interface CameraParams {
  cameraMode: CameraMode;
  followLaziness: number;
  targetOffset: [number, number, number];
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
  cameraMode: 'topdown',
  followLaziness: 0.8,
  targetOffset: [0, 0.8, 0],
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
  ambient: 1.2,
  dirPrimary: 2.0,
  dirFill: 1.5,
  dirRim: 0.7,
  hemi: 1.0,
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
  ssao: { enabled: false, radius: 0.5, minDistance: 0.001, maxDistance: 0.1 },
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
// Automatically saves all serializable state (skips functions, arrays, nulls, and transient keys).

const SETTINGS_KEY = 'three-react:settings';

/** Keys that should never be persisted (transient / runtime-only) */
const TRANSIENT_KEYS = new Set([
  'phase', 'charAnimation', 'charAnimationList', 'settingsPanelOpen',
  'onStartGame', 'onPauseToggle', 'onResetCameraParams', 'onResetLightParams',
  'onGenerateObstacles', 'onGenerateTerrain', 'onGenerateLadders', 'onClearObstacles', 'onGenerateWorld', 'onMergeWorld',
  'drawCalls',
]);

function loadSettings(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {};
}

function saveSettings(): void {
  const s = useGameStore.getState() as unknown as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(s)) {
    if (TRANSIENT_KEYS.has(key)) continue;
    const val = s[key];
    // Skip functions and null callbacks
    if (typeof val === 'function' || val === null) continue;
    data[key] = val;
  }
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
  charStepUp: number;
  charStepDown: number;
  charRotSpeed: number;
  setCharRotSpeed: (v: number) => void;
  charGravity: number;
  setCharGravity: (v: number) => void;
  charSnapMode: 'free' | '4dir' | '8dir';
  charAutoMove: boolean;
  setCharAutoMove: (v: boolean) => void;
  charContinuousPath: boolean;
  setCharContinuousPath: (v: boolean) => void;
  setCharAnimation: (v: string) => void;
  setCharSpeed: (v: number) => void;
  setCharMoveSpeed: (v: number) => void;
  setCharHop: (v: boolean) => void;
  setCharDebugPath: (v: boolean) => void;
  setCharStringPull: (v: boolean) => void;
  setCharStepUp: (v: number) => void;
  setCharStepDown: (v: number) => void;
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
  debugNavGrid: boolean;
  setDebugNavGrid: (v: boolean) => void;
  obstacleSnap: boolean;
  setObstacleSnap: (v: boolean) => void;
  worldRevealEnabled: boolean;
  setWorldRevealEnabled: (v: boolean) => void;
  ladderDensity: number;
  setLadderDensity: (v: number) => void;
  onGenerateObstacles: (() => void) | null;
  onGenerateTerrain: (() => void) | null;
  onGenerateLadders: (() => void) | null;
  onClearObstacles: (() => void) | null;
  onGenerateWorld: (() => void) | null;
  onMergeWorld: (() => void) | null;
  drawCalls: number;
}

const saved = loadSettings();

export const useGameStore = create<GameStore>((set) => ({
  phase: 'menu',

  particleToggles: (saved.particleToggles as ParticleToggles) ?? { ...DEFAULT_PARTICLE_TOGGLES },
  cameraParams: (() => {
    const def = { ...DEFAULT_CAMERA_PARAMS };
    const savedCam = saved.cameraParams as CameraParams | undefined;
    if (!savedCam) return def;
    return { ...def, ...savedCam };
  })(),
  lightPreset: (saved.lightPreset as LightPreset) ?? DEFAULT_LIGHT_PRESET,
  torchEnabled: (saved.torchEnabled as boolean) ?? false,
  torchParams: (saved.torchParams as TorchParams) ?? { ...DEFAULT_TORCH_PARAMS },
  gridOpacity: (saved.gridOpacity as number) ?? 0.25,
  gridCellSize: (saved.gridCellSize as number) ?? 0.5,
  setGridCellSize: (gridCellSize) => set({ gridCellSize }),
  timeOfDay: (saved.timeOfDay as number) ?? 10,
  dayCycleEnabled: (saved.dayCycleEnabled as boolean) ?? false,
  dayCycleSpeed: (saved.dayCycleSpeed as number) ?? 1,
  fastNights: (saved.fastNights as boolean) ?? true,
  sunDebug: false,
  postProcess: (saved.postProcess as PostProcessSettings) ?? { ...DEFAULT_POST_PROCESS },

  charAnimation: 'Idle',
  charSpeed: (saved.charSpeed as number) ?? 1,
  charMoveSpeed: (saved.charMoveSpeed as number) ?? 5,
  charHop: (saved.charHop as boolean) ?? true,
  charDebugPath: (saved.charDebugPath as boolean) ?? false,
  charStringPull: (saved.charStringPull as boolean) ?? true,
  charStepUp: (saved.charStepUp as number) ?? 0.5,
  charStepDown: (saved.charStepDown as number) ?? 1.0,
  charRotSpeed: (saved.charRotSpeed as number) ?? 12,
  setCharRotSpeed: (charRotSpeed) => set({ charRotSpeed }),
  charGravity: (saved.charGravity as number) ?? 60,
  setCharGravity: (charGravity) => set({ charGravity }),
  charSnapMode: ((saved.charSnapMode as string) ?? '8dir') as 'free' | '4dir' | '8dir',
  charAutoMove: (saved.charAutoMove as boolean) ?? true,
  setCharAutoMove: (charAutoMove) => set({ charAutoMove }),
  charContinuousPath: (saved.charContinuousPath as boolean) ?? true,
  setCharContinuousPath: (charContinuousPath) => set({ charContinuousPath }),
  setCharAnimation: (charAnimation) => set({ charAnimation }),
  setCharSpeed: (charSpeed) => set({ charSpeed }),
  setCharMoveSpeed: (charMoveSpeed) => set({ charMoveSpeed }),
  setCharHop: (charHop) => set({ charHop }),
  setCharDebugPath: (charDebugPath) => set({ charDebugPath }),
  setCharStringPull: (charStringPull) => set({ charStringPull }),
  setCharStepUp: (charStepUp) => set({ charStepUp }),
  setCharStepDown: (charStepDown) => set({ charStepDown }),
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

  debugNavGrid: (saved.debugNavGrid as boolean) ?? false,
  setDebugNavGrid: (debugNavGrid) => set({ debugNavGrid }),
  obstacleSnap: (saved.obstacleSnap as boolean) ?? true,
  setObstacleSnap: (obstacleSnap) => set({ obstacleSnap }),
  worldRevealEnabled: (saved.worldRevealEnabled as boolean) ?? true,
  setWorldRevealEnabled: (worldRevealEnabled) => set({ worldRevealEnabled }),
  ladderDensity: (saved.ladderDensity as number) ?? 0.5,
  setLadderDensity: (ladderDensity) => set({ ladderDensity }),
  onStartGame: null,
  onPauseToggle: null,
  onResetCameraParams: null,
  onResetLightParams: null,
  onGenerateObstacles: null,
  onGenerateTerrain: null,
  onGenerateLadders: null,
  onClearObstacles: null,
  onGenerateWorld: null,
  onMergeWorld: null,
  drawCalls: 0,
}));

// Auto-save settings to localStorage on any change
useGameStore.subscribe(saveSettings);
