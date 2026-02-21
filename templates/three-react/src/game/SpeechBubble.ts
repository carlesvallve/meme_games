import * as THREE from 'three';
import { useGameStore } from '../store';
import { getRandomThought } from './thoughtBubbles';
import type { CharacterType } from './characters';
import type { SpeechBubbleData } from '../types';

interface ActiveBubble {
  id: number;
  text: string;
  age: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
}

export class SpeechBubbleSystem {
  private bubbles: ActiveBubble[] = [];
  private timer = 0;
  private nextDelay = 0;
  private idCounter = 0;
  private characterType: CharacterType = 'boy';
  private playerMesh: THREE.Object3D | null = null;
  private camera: THREE.Camera | null = null;
  private screenWidth = window.innerWidth;
  private screenHeight = window.innerHeight;

  constructor() {
    this.nextDelay = 5 + Math.random() * 6;
    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    this.screenWidth = window.innerWidth;
    this.screenHeight = window.innerHeight;
  };

  setCharacter(type: CharacterType): void {
    this.characterType = type;
  }

  setPlayerMesh(mesh: THREE.Object3D): void {
    this.playerMesh = mesh;
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  update(dt: number): void {
    this.timer += dt;

    // Spawn new bubble
    if (this.timer >= this.nextDelay) {
      this.timer = 0;
      this.nextDelay = 8 + Math.random() * 8;
      this.spawnBubble();
    }

    // Update existing bubbles
    for (const b of this.bubbles) {
      b.age += dt;
    }

    // Remove expired
    this.bubbles = this.bubbles.filter(b => b.age < b.duration);

    // Project to screen and push to store
    this.pushToStore();
  }

  private spawnBubble(): void {
    const text = getRandomThought(this.characterType);
    this.bubbles.push({
      id: this.idCounter++,
      text,
      age: 0,
      duration: 4,
      fadeIn: 0.3,
      fadeOut: 0.3,
    });
  }

  private pushToStore(): void {
    if (!this.playerMesh || !this.camera) {
      useGameStore.getState().setSpeechBubbles([]);
      return;
    }

    const result: SpeechBubbleData[] = [];
    const pos = new THREE.Vector3();
    this.playerMesh.getWorldPosition(pos);
    pos.y += 1.4; // Above head

    const projected = pos.clone().project(this.camera);

    // Convert NDC to screen coords
    const x = (projected.x * 0.5 + 0.5) * this.screenWidth;
    const y = (1 - (projected.y * 0.5 + 0.5)) * this.screenHeight;

    // Behind camera check
    if (projected.z > 1) {
      useGameStore.getState().setSpeechBubbles([]);
      return;
    }

    for (const b of this.bubbles) {
      let opacity = 1;
      if (b.age < b.fadeIn) {
        opacity = b.age / b.fadeIn;
      } else if (b.age > b.duration - b.fadeOut) {
        opacity = (b.duration - b.age) / b.fadeOut;
      }

      result.push({
        id: b.id,
        text: b.text,
        x,
        y: y - 20, // Offset slightly above the projected point
        opacity: Math.max(0, Math.min(1, opacity)),
      });
    }

    useGameStore.getState().setSpeechBubbles(result);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    useGameStore.getState().setSpeechBubbles([]);
  }
}
