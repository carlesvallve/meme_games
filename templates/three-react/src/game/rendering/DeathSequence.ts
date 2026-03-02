// ── Death Sequence ───────────────────────────────────────────────────
// Orchestrates everything that happens when the player dies:
// potion cleanup, gore, loot, SFX, body hide, cinematic transition → select screen.
//
// Contains two cinematic transition effects:
//   1. Soul Ascend — slow-mo → camera drifts up → desaturate → fade to black
//   2. Screen Shatter — slow-mo → voronoi fracture → shards fall away to black

import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { useGameStore } from '../../store';
import type { PostProcessStack } from './PostProcessing';
import type { Camera } from './Camera';
import type { Character } from '../character';
import type { GoreSystem } from '../combat/GoreSystem';
import type { LootSystem } from '../combat/Loot';
import type { PotionEffectSystem } from '../combat/PotionEffectSystem';
import type { PotionVFX } from '../combat/PotionVFX';
import type { audioSystem as AudioSystemType } from '../../utils/AudioSystem';

// ── Shatter Shader ───────────────────────────────────────────────────

const ShatterShader = {
  name: 'ShatterShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    progress: { value: 0.0 },
    seed: { value: 0.0 },
    resolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float progress;
    uniform float seed;
    uniform vec2 resolution;
    varying vec2 vUv;

    // Hash functions for voronoi
    vec2 hash2(vec2 p) {
      p = vec2(dot(p, vec2(127.1 + seed, 311.7 + seed)),
               dot(p, vec2(269.5 + seed, 183.3 + seed)));
      return fract(sin(p) * 43758.5453);
    }

    void main() {
      // Aspect-corrected UVs
      vec2 uv = vUv;
      vec2 aspect = vec2(resolution.x / resolution.y, 1.0);
      vec2 uvA = uv * aspect;

      // Voronoi cells
      float cellScale = 3.0; // ~9 cells
      vec2 cellUV = uvA * cellScale;
      vec2 cellId = floor(cellUV);
      vec2 cellFrac = fract(cellUV);

      float minDist = 10.0;
      float secondDist = 10.0;
      vec2 nearestPoint = vec2(0.0);
      vec2 nearestId = vec2(0.0);

      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 neighbor = vec2(float(x), float(y));
          vec2 point = hash2(cellId + neighbor);
          vec2 diff = neighbor + point - cellFrac;
          float d = length(diff);
          if (d < minDist) {
            secondDist = minDist;
            minDist = d;
            nearestPoint = point;
            nearestId = cellId + neighbor;
          } else if (d < secondDist) {
            secondDist = d;
          }
        }
      }

      // Edge distance (for cracks)
      float edge = secondDist - minDist;

      // Per-cell random direction and rotation
      vec2 cellRand = hash2(nearestId * 7.31);
      float cellAngle = cellRand.x * 6.2831; // random direction
      vec2 cellDir = vec2(cos(cellAngle), sin(cellAngle));
      float cellRotSpeed = (cellRand.y - 0.5) * 4.0; // random rotation speed

      // Phase 1 (0→0.3): cracks appear
      // Phase 2 (0.3→1.0): cells separate and fall
      float crackPhase = smoothstep(0.0, 0.3, progress);
      float movePhase = smoothstep(0.2, 1.0, progress);

      // Crack darkening
      float crackWidth = 0.02 + crackPhase * 0.08;
      float crack = 1.0 - smoothstep(crackWidth - 0.01, crackWidth, edge);

      // Cell displacement: move outward + gravity fall
      float moveAmount = movePhase * movePhase * 0.6; // accelerating
      float gravity = movePhase * movePhase * movePhase * 0.8; // cubic gravity
      vec2 displacement = cellDir * moveAmount / aspect;
      displacement.y -= gravity; // fall

      // Cell rotation
      float rot = movePhase * cellRotSpeed;
      vec2 center = (nearestId + nearestPoint) / cellScale / aspect;
      vec2 toCenter = uv - center;
      float cosR = cos(rot);
      float sinR = sin(rot);
      vec2 rotated = vec2(
        toCenter.x * cosR - toCenter.y * sinR,
        toCenter.x * sinR + toCenter.y * cosR
      );
      vec2 rotDisp = rotated - toCenter;

      // Sample with displacement
      vec2 sampleUV = uv + displacement + rotDisp * movePhase;

      // Clamp and sample
      vec4 color = texture2D(tDiffuse, clamp(sampleUV, 0.0, 1.0));

      // Darken cracks
      color.rgb *= mix(1.0, 0.0, crack * crackPhase);

      // Fade to black as pieces fly away
      float fadeFactor = 1.0 - smoothstep(0.5, 1.0, progress);
      color.rgb *= fadeFactor;

      // Fully black at the end
      color.rgb *= 1.0 - smoothstep(0.85, 1.0, progress);

      gl_FragColor = color;
    }
  `,
};

// ── Types ────────────────────────────────────────────────────────────

type Phase = 'idle' | 'slowmo' | 'effect' | 'done';
export type DeathEffectType = 'soul' | 'shatter';

export interface DeathSequenceDeps {
  potionSystem: PotionEffectSystem;
  potionVFX: PotionVFX;
  goreSystem: GoreSystem;
  lootSystem: LootSystem;
  audioSystem: typeof AudioSystemType;
}

// ── DeathSequence ────────────────────────────────────────────────────

export class DeathSequence {
  private postProcess: PostProcessStack;
  private cam: Camera;
  private deps: DeathSequenceDeps;

  // Sequence state
  private _triggered = false;

  // Transition state machine
  private phase: Phase = 'idle';
  private effectType: DeathEffectType = 'soul';
  private elapsed = 0;
  private timeScale = 1.0;
  private deathPos = new THREE.Vector3();
  private onComplete: (() => void) | null = null;

  // Timing
  private static readonly SLOWMO_DURATION = 0.5;
  private static readonly SOUL_DURATION = 2.5;
  private static readonly SHATTER_DURATION = 1.6;
  private static readonly SLOWMO_TARGET = 0.15;

  // Soul ascend state
  private baseSaturation = 0;
  private baseBrightness = 0;
  private baseTargetY = 0;

  // Shatter state
  private shatterPass: ShaderPass;
  private shatterInserted = false;

  constructor(postProcess: PostProcessStack, cam: Camera, deps: DeathSequenceDeps) {
    this.postProcess = postProcess;
    this.cam = cam;
    this.deps = deps;

    // Create shatter pass (disabled by default)
    this.shatterPass = new ShaderPass(ShatterShader);
    this.shatterPass.enabled = false;
  }

  get triggered(): boolean { return this._triggered; }

  get isActive(): boolean { return this.phase !== 'idle'; }

  /** Reset after respawn (called from spawnCharacters). */
  reset(): void {
    this._triggered = false;
  }

  /** Update deps if systems are recreated (e.g. on scene regen). */
  updateDeps(partial: Partial<DeathSequenceDeps>): void {
    Object.assign(this.deps, partial);
  }

  // ── Trigger ──────────────────────────────────────────────────────

  /** Trigger the full death sequence. Returns false if already triggered. */
  trigger(playerChar: Character): boolean {
    if (this._triggered) return false;
    this._triggered = true;

    const { potionSystem, potionVFX, goreSystem, lootSystem, audioSystem } = this.deps;

    // Clear active effects
    potionSystem.clearEffects();
    potionVFX.clearAll();
    useGameStore.getState().setActivePotionEffects([]);
    useGameStore.getState().clearPotionInventory();
    useGameStore.getState().setPhase('player_dead');

    // Gore, loot, SFX
    const pos = playerChar.mesh.position.clone();
    goreSystem.spawnGore(playerChar.mesh, playerChar.groundY, [], playerChar.lastHitDirX, playerChar.lastHitDirZ);
    lootSystem.spawnLoot(pos);
    audioSystem.sfxAt('death', pos.x, pos.z);
    audioSystem.sfx('deathJingle');
    playerChar.hideBody();

    // Cinematic transition → character select
    // TODO: randomize between 'soul' | 'shatter' — soul ascend is implemented but disabled for now
    this.startTransition('shatter', pos, () => {
      useGameStore.getState().onStartGame?.();
    });

    return true;
  }

  // ── Transition ───────────────────────────────────────────────────

  private startTransition(type: DeathEffectType, deathPos: THREE.Vector3, onComplete: () => void): void {
    this.effectType = type;
    this.deathPos.copy(deathPos);
    this.onComplete = onComplete;
    this.phase = 'slowmo';
    this.elapsed = 0;
    this.timeScale = 1.0;

    // Snapshot current color grade values
    this.baseSaturation = this.postProcess.getSaturation();
    this.baseBrightness = this.postProcess.getBrightness();
    this.baseTargetY = deathPos.y;

    if (type === 'shatter') {
      // Insert shatter pass if not already
      if (!this.shatterInserted) {
        this.postProcess.insertPassBeforeFade(this.shatterPass);
        this.shatterInserted = true;
      }
      this.shatterPass.uniforms['seed'].value = Math.random() * 100;
      this.shatterPass.uniforms['progress'].value = 0;
      this.shatterPass.uniforms['resolution'].value.set(
        window.innerWidth, window.innerHeight,
      );
      // Strong shake on shatter
      this.cam.shake(0.35, 0.25);
    }
  }

  /** Tick the death transition. Returns scaled dt for game systems. */
  update(rawDt: number): { scaledDt: number; active: boolean } {
    if (this.phase === 'idle') {
      return { scaledDt: rawDt, active: false };
    }

    this.elapsed += rawDt;

    switch (this.phase) {
      case 'slowmo':
        this.updateSlowmo();
        break;
      case 'effect':
        this.updateEffect();
        break;
    }

    const scaledDt = rawDt * this.timeScale;
    return { scaledDt, active: true };
  }

  private updateSlowmo(): void {
    const t = Math.min(1, this.elapsed / DeathSequence.SLOWMO_DURATION);
    // Ease-out slow down
    this.timeScale = 1.0 - (1.0 - DeathSequence.SLOWMO_TARGET) * (1 - (1 - t) * (1 - t));

    if (t >= 1) {
      this.phase = 'effect';
      this.elapsed = 0;
      this.timeScale = DeathSequence.SLOWMO_TARGET;

      if (this.effectType === 'shatter') {
        this.shatterPass.enabled = true;
      }
    }
  }

  private updateEffect(): void {
    const duration = this.effectType === 'soul'
      ? DeathSequence.SOUL_DURATION
      : DeathSequence.SHATTER_DURATION;
    const t = Math.min(1, this.elapsed / duration);

    if (this.effectType === 'soul') {
      this.updateSoulAscend(t);
    } else {
      this.updateShatter(t);
    }

    // Slowly ramp time scale back up during effect
    this.timeScale = DeathSequence.SLOWMO_TARGET + t * (0.4 - DeathSequence.SLOWMO_TARGET);

    if (t >= 1) {
      this.cleanup();
      this.complete();
    }
  }

  private updateSoulAscend(t: number): void {
    // Desaturate: ease-in-out to full grayscale
    const desatT = t * t * (3 - 2 * t); // smoothstep
    const saturation = this.baseSaturation + (-1.0 - this.baseSaturation) * desatT;
    this.postProcess.setSaturation(saturation);
    this.postProcess.setColorGradeEnabled(true);

    // Slight brightness boost for ethereal feel (peaks mid-transition, fades with dimming)
    const brightPeak = Math.sin(t * Math.PI); // peaks at t=0.5
    const brightness = this.baseBrightness + 0.2 * brightPeak;
    this.postProcess.setBrightness(brightness);

    // Camera drifts upward — ease-out
    const liftT = 1 - (1 - t) * (1 - t); // ease-out quadratic
    const liftY = this.baseTargetY + 3.5 * liftT;
    this.cam.setTargetYOverride(liftY);

    // Progressive fade to black — starts immediately with camera rise
    // Ease-in: very gentle at first, accelerating toward the end
    const fadeAlpha = 1.0 - t * t * t;
    this.postProcess.setFadeAlpha(fadeAlpha);
  }

  private updateShatter(t: number): void {
    this.shatterPass.uniforms['progress'].value = t;
  }

  private cleanup(): void {
    // Restore color grade
    this.postProcess.setSaturation(this.baseSaturation);
    this.postProcess.setBrightness(this.baseBrightness);

    // Clear camera override
    this.cam.setTargetYOverride(null);

    // Restore fade to fully visible (select screen is HTML overlay, canvas just needs to be clean)
    this.postProcess.setFadeAlpha(1.0);

    // Disable shatter
    this.shatterPass.enabled = false;
    this.shatterPass.uniforms['progress'].value = 0;

    this.timeScale = 1.0;
    this.phase = 'idle';
  }

  private complete(): void {
    const cb = this.onComplete;
    this.onComplete = null;
    cb?.();
  }
}
