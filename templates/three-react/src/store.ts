import { create } from 'zustand';
import type { CharacterType, SpeechBubbleData } from './types';
import { Layer } from './game/Entity';

export interface ParticleToggles {
  dust: boolean;
  lightRain: boolean;
  rain: boolean;
  debris: boolean;
}

export interface PlayerParams {
  speed: number;
  stepHeight: number;
  capsuleRadius: number;
  hopHeight: number;
  magnetRadius: number;
  magnetSpeed: number;
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

interface GameStore {
  phase: 'menu' | 'select' | 'playing' | 'paused' | 'gameover';
  score: number;
  hp: number;
  maxHp: number;
  floor: number;
  message: string | null;

  selectedCharacter: CharacterType | null;
  collectibles: number;
  speechBubbles: SpeechBubbleData[];
  particleToggles: ParticleToggles;
  playerParams: PlayerParams;
  cameraParams: CameraParams;

  setPhase: (phase: GameStore['phase']) => void;
  setScore: (score: number) => void;
  setHP: (hp: number, maxHp: number) => void;
  setFloor: (floor: number) => void;
  showMessage: (msg: string | null) => void;

  selectCharacter: (type: CharacterType) => void;
  setCollectibles: (n: number) => void;
  setSpeechBubbles: (bubbles: SpeechBubbleData[]) => void;
  toggleParticle: (key: keyof ParticleToggles) => void;
  setPlayerParam: (key: keyof PlayerParams, value: number) => void;
  setCameraParam: <K extends keyof CameraParams>(key: K, value: CameraParams[K]) => void;

  onStartGame: (() => void) | null;
  onPauseToggle: (() => void) | null;
  onRestart: (() => void) | null;
}

export const useGameStore = create<GameStore>((set) => ({
  phase: 'menu',
  score: 0,
  hp: 100,
  maxHp: 100,
  floor: 1,
  message: null,

  selectedCharacter: null,
  collectibles: 0,
  speechBubbles: [],
  particleToggles: { dust: true, lightRain: false, rain: false, debris: false },
  playerParams: { speed: 4, stepHeight: 0.5, capsuleRadius: 0.25, hopHeight: 0.05, magnetRadius: 2, magnetSpeed: 16 },
  cameraParams: { minDistance: 5, maxDistance: 25, pitchMin: -80, pitchMax: -10, rotationSpeed: 0.005, zoomSpeed: 0.01, collisionLayers: Layer.Architecture },

  setPhase: (phase) => set({ phase }),
  setScore: (score) => set({ score }),
  setHP: (hp, maxHp) => set({ hp, maxHp }),
  setFloor: (floor) => set({ floor }),
  showMessage: (message) => set({ message }),

  selectCharacter: (type) => set({ selectedCharacter: type, phase: 'playing' }),
  setCollectibles: (collectibles) => set({ collectibles }),
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

  onStartGame: null,
  onPauseToggle: null,
  onRestart: null,
}));
