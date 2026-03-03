import * as THREE from 'three';
import { useGameStore } from '../../store';
import { entityRegistry, Layer } from '../core/Entity';
import { revealUniforms } from '../rendering/RevealShader';
import type { SpeechBubbleData } from '../../types';
import type { Character } from '../character';

/** Height offset above the character mesh for speech bubble placement */
const BUBBLE_Y_OFFSET = 0.7;

interface ActiveBubble {
  id: number;
  text: string;
  age: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
  /** The character this bubble belongs to */
  character: Character;
}

export class SpeechBubbleSystem {
  private bubbles: ActiveBubble[] = [];
  private idCounter = 0;
  private camera: THREE.Camera | null = null;
  private characters: Character[] = [];
  private screenWidth = window.innerWidth;
  private screenHeight = window.innerHeight;
  private raycaster = new THREE.Raycaster();
  private _dir = new THREE.Vector3();

  /** Per-character timer for staggered spawning */
  private charTimers = new Map<Character, { timer: number; nextDelay: number }>();
  private paused = false;

  constructor() {
    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    this.screenWidth = window.innerWidth;
    this.screenHeight = window.innerHeight;
  };

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
  }

  /** Register all characters for speech bubbles */
  setCharacters(characters: Character[]): void {
    this.characters = characters;
    // Initialize timers for new characters
    for (const char of characters) {
      if (!this.charTimers.has(char)) {
        this.charTimers.set(char, {
          timer: 0,
          // Stagger initial delays so they don't all talk at once
          nextDelay: 3 + Math.random() * 10,
        });
      }
    }
    // Clean up removed characters
    for (const key of this.charTimers.keys()) {
      if (!characters.includes(key)) {
        this.charTimers.delete(key);
      }
    }
  }

  update(dt: number): void {
    if (this.paused) return;

    // Spawn bubbles per character
    for (const char of this.characters) {
      const state = this.charTimers.get(char);
      if (!state) continue;

      state.timer += dt;
      if (state.timer >= state.nextDelay) {
        state.timer = 0;
        // NPCs talk less frequently than the player character
        state.nextDelay = char.selected
          ? 6 + Math.random() * 8
          : 10 + Math.random() * 15;
        this.spawnBubble(char);
      }
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

  /** Immediately clear all bubbles and pause updates (e.g. before floor transition). */
  dismissAll(): void {
    this.paused = true;
    this.bubbles.length = 0;
    useGameStore.getState().setSpeechBubbles([]);
  }

  /** Resume bubble spawning (call after floor transition completes). */
  resume(): void {
    this.paused = false;
  }

  /**
   * Force-fade any current bubble on a character and schedule a new one
   * after a short delay. Call this when a character's skin changes.
   */
  onSkinChanged(char: Character): void {
    // Trigger fade-out on any existing bubble for this character
    for (const b of this.bubbles) {
      if (b.character === char) {
        // Jump to the fade-out region so it fades out quickly
        b.duration = b.age + 0.4;
        b.fadeOut = 0.4;
      }
    }
    // Schedule a new bubble from the new personality shortly after
    const state = this.charTimers.get(char);
    if (state) {
      state.timer = 0;
      state.nextDelay = 1.0 + Math.random() * 0.5;
    }
  }

  private spawnBubble(char: Character): void {
    const entry = char.voxEntry;
    // Use exclamations pool for the first bubble after a skin change (short delay),
    // otherwise mix thoughts + sounds
    const state = this.charTimers.get(char);
    const isIntro = state && state.nextDelay < 2;
    const pool = entry
      ? (isIntro ? entry.exclamations : [...entry.thoughts, ...entry.sounds])
      : ['...'];
    const text = pool[Math.floor(Math.random() * pool.length)];

    // Only allow one active bubble per character
    this.bubbles = this.bubbles.filter(b => b.character !== char);

    this.bubbles.push({
      id: this.idCounter++,
      text,
      age: 0,
      duration: 4,
      fadeIn: 0.3,
      fadeOut: 0.5,
      character: char,
    });
  }

  private isOccluded(worldPos: THREE.Vector3): boolean {
    if (!this.camera) return false;
    if (revealUniforms.u_revealActive.value > 0.5) return false;

    const camPos = this.camera.position;
    this._dir.copy(worldPos).sub(camPos);
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
    if (!this.camera) {
      useGameStore.getState().setSpeechBubbles([]);
      return;
    }

    const result: SpeechBubbleData[] = [];
    const pos = new THREE.Vector3();

    for (const b of this.bubbles) {
      const mesh = b.character.mesh;
      // Follow mesh visibility: hide bubble when character is hidden/dimmed
      if (!mesh.visible) continue;

      mesh.getWorldPosition(pos);
      // Shift bubble up when HP bar is visible
      const hpBarExtra = b.character.showingHpBar ? 0.1 : 0;
      pos.y += BUBBLE_Y_OFFSET + hpBarExtra;

      const projected = pos.clone().project(this.camera);

      // Behind camera — skip
      if (projected.z > 1) continue;

      const x = (projected.x * 0.5 + 0.5) * this.screenWidth;
      const y = (1 - (projected.y * 0.5 + 0.5)) * this.screenHeight;

      // Fade for occlusion
      const occluded = this.isOccluded(pos);
      let occlusionAlpha = occluded ? 0.15 : 1;

      // Fade for distance (NPCs further away get dimmer)
      if (!b.character.selected) {
        const camDist = pos.distanceTo(this.camera.position);
        const distAlpha = THREE.MathUtils.clamp(1 - (camDist - 5) / 15, 0.1, 1);
        occlusionAlpha *= distAlpha;
      }

      // Age-based fade
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
        y: y - 10,
        opacity: Math.max(0, Math.min(1, opacity * occlusionAlpha)),
      });
    }

    useGameStore.getState().setSpeechBubbles(result);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    useGameStore.getState().setSpeechBubbles([]);
  }
}
