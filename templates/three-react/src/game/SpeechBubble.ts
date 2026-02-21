import * as THREE from 'three';
import { useGameStore } from '../store';
import { getRandomThought } from './thoughtBubbles';
import { entityRegistry, Layer } from './Entity';
import { CHARACTER_HEIGHTS, type CharacterType } from './characters';
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
  private raycaster = new THREE.Raycaster();
  private _dir = new THREE.Vector3();
  private occluded = false;
  private occludedAlpha = 1;

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

  private isPlayerOccluded(playerPos: THREE.Vector3): boolean {
    if (!this.camera) return false;

    const camPos = this.camera.position;
    this._dir.copy(playerPos).sub(camPos);
    const dist = this._dir.length();
    if (dist < 0.01) return false;
    this._dir.divideScalar(dist);

    this.raycaster.set(camPos, this._dir);
    this.raycaster.near = 0.1;
    this.raycaster.far = dist;

    const occluders = entityRegistry.getByLayer(Layer.Architecture).map(e => e.object3D);
    const hits = this.raycaster.intersectObjects(occluders, true);
    return hits.length > 0;
  }

  private pushToStore(): void {
    if (!this.playerMesh || !this.camera) {
      useGameStore.getState().setSpeechBubbles([]);
      return;
    }

    const result: SpeechBubbleData[] = [];
    const pos = new THREE.Vector3();
    this.playerMesh.getWorldPosition(pos);
    // Position above head — height varies per character type
    const charHeight = CHARACTER_HEIGHTS[this.characterType] ?? 0.8;
    pos.y += charHeight + 0.15;

    const projected = pos.clone().project(this.camera);

    // Convert NDC to screen coords
    const x = (projected.x * 0.5 + 0.5) * this.screenWidth;
    const y = (1 - (projected.y * 0.5 + 0.5)) * this.screenHeight;

    // Behind camera check
    if (projected.z > 1) {
      useGameStore.getState().setSpeechBubbles([]);
      return;
    }

    // Fade out when occluded by architecture
    this.occluded = this.isPlayerOccluded(pos);
    const fadeSpeed = 8;
    const targetAlpha = this.occluded ? 0 : 1;
    this.occludedAlpha += (targetAlpha - this.occludedAlpha) * Math.min(1, fadeSpeed * 0.016);

    if (this.occludedAlpha < 0.01) {
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
        opacity: Math.max(0, Math.min(1, opacity * this.occludedAlpha)),
      });
    }

    useGameStore.getState().setSpeechBubbles(result);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    useGameStore.getState().setSpeechBubbles([]);
  }
}
