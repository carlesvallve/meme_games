import type * as THREE from 'three';
import type { CharacterType } from './game/character';

export interface VoxelModel {
  size: { x: number; y: number; z: number };
  voxels: Map<string, number>;
}

export interface ParticleSystem {
  group: THREE.Group;
  update(dt: number): void;
  dispose(): void;
}

export interface ParticleOptions {
  count?: number;
  area?: { x: number; y: number; z: number };
  speed?: number;
  size?: number;
  color?: number;
  opacity?: number;
}

export interface GameInstance {
  destroy: () => void;
}

export interface SpeechBubbleData {
  id: number;
  text: string;
  x: number;
  y: number;
  opacity: number;
}

export type { CharacterType };
