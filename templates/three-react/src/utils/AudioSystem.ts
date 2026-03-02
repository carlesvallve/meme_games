import { playTone, toneSweep, noiseBurst } from './sfx';
import { sfxHit } from './sfx/hit';
import { sfxDamage } from './sfx/damage';
import { sfxScore } from './sfx/score';
import { sfxStart } from './sfx/start';
import { sfxDeath } from './sfx/death';
import { sfxStep, sfxStepStop, sfxLand, sfxFly } from './sfx/step';
import { sfxPickup } from './sfx/pickup';
import { sfxCoin } from './sfx/coin';
import { sfxChest } from './sfx/chest';
import { sfxThud } from './sfx/thud';
import { sfxPotion } from './sfx/potion';
import { sfxSlash } from './sfx/slash';
import { sfxFleshHit } from './sfx/fleshHit';
import { sfxHurt } from './sfx/hurt';
import { sfxShoot } from './sfx/shoot';
import { sfxArrow } from './sfx/arrow';
import { sfxFireball } from './sfx/fireball';
import { sfxWoodBreak } from './sfx/woodBreak';
import { sfxCeramicBreak } from './sfx/ceramicBreak';
import { sfxDrink } from './sfx/drink';
import { sfxDeathJingle } from './sfx/deathJingle';
import { sfxUISelect, sfxUIAccept, sfxUICancel } from './sfx/uiSelect';
import { sfxGem } from './sfx/gem';
import { sfxClank } from './sfx/clank';

/**
 * Spatial audio attenuation
 *
 * Uses inverse-distance rolloff: vol = REF / (REF + dist)
 * No flat zone — volume decreases smoothly from distance 0.
 * Sounds beyond MAX_HEARING_RANGE are culled entirely.
 *
 * With ROLLOFF_REF = 3:
 *   dist  0 → vol 1.00  (right on top)
 *   dist  2 → vol 0.60
 *   dist  5 → vol 0.38
 *   dist  8 → vol 0.27
 *   dist 12 → vol 0.20
 *   dist 15 → culled (silent)
 *
 * Increase ROLLOFF_REF for slower falloff (louder at range).
 * Decrease for faster falloff (quieter at range).
 */
const MAX_HEARING_RANGE = 15;
const ROLLOFF_REF = 3;

class AudioSystemClass {
  private ctx: AudioContext | null = null;
  private muted = false;
  private playerX = 0;
  private playerZ = 0;

  init(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
    } catch {
      // Audio not supported
    }
  }

  /** Update the listener position (call each frame with player pos) */
  setPlayerPosition(x: number, z: number): void {
    this.playerX = x;
    this.playerZ = z;
  }

  private ensureContext(): AudioContext | null {
    if (!this.ctx) this.init();
    return this.ctx;
  }

  /** Compute volume multiplier based on distance from player.
   *  Uses inverse-distance falloff: vol = ref / (ref + dist)
   *  Smooth from distance 0 (vol=1) with no flat zone. */
  private distanceVolume(x: number, z: number): number {
    const dx = x - this.playerX;
    const dz = z - this.playerZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist >= MAX_HEARING_RANGE) return 0;
    return ROLLOFF_REF / (ROLLOFF_REF + dist);
  }

  playTone(freq: number, duration: number, type: OscillatorType = 'square', volume = 0.15): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    try { playTone(ctx, freq, duration, type, volume); } catch { /* ignore */ }
  }

  toneSweep(startFreq: number, endFreq: number, duration: number, type: OscillatorType = 'sine', volume = 0.1): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    try { toneSweep(ctx, startFreq, endFreq, duration, type, volume); } catch { /* ignore */ }
  }

  noiseBurst(duration = 0.1, volume = 0.1): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    try { noiseBurst(ctx, duration, volume); } catch { /* ignore */ }
  }

  playNote(note: number, octave = 4, duration = 0.2, type: OscillatorType = 'square', volume = 0.1): void {
    const freq = 440 * Math.pow(2, (note - 9 + (octave - 4) * 12) / 12);
    this.playTone(freq, duration, type, volume);
  }

  /** Play SFX at full volume (non-positional, e.g. UI sounds) */
  sfx(type: string, intensity = 1, bounceCount = 0): void {
    this.playSfx(type, 1, intensity, bounceCount);
  }

  /** Play SFX at a world position — volume attenuated by distance to player */
  sfxAt(type: string, x: number, z: number, intensity = 1, bounceCount = 0): void {
    const vol = this.distanceVolume(x, z);
    if (vol < 0.01) return; // too far, skip entirely
    this.playSfx(type, vol, intensity, bounceCount);
  }

  private playSfx(type: string, volume: number, intensity: number, bounceCount: number): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    // Step and land use intensity as volume scale (e.g. enemy steps pass 0.03 for quieter)
    const effectiveVolume = (type === 'step' || type === 'land' || type === 'fly') ? volume * intensity : volume;
    const dest = effectiveVolume < 0.99 ? this.createAttenuatedDest(ctx, effectiveVolume) : ctx.destination;

    try {
      switch (type) {
        case 'hit':    sfxHit(ctx, dest); break;
        case 'damage': sfxDamage(ctx, dest); break;
        case 'score':  sfxScore(ctx, dest); break;
        case 'start':  sfxStart(ctx, dest); break;
        case 'death':  sfxDeath(ctx, dest); break;
        case 'step':   sfxStep(ctx, dest); break;
        case 'pickup': sfxPickup(ctx, dest); break;
        case 'coin':   sfxCoin(ctx, dest); break;
        case 'chest':  sfxChest(ctx, dest); break;
        case 'thud':   sfxThud(ctx, intensity, bounceCount, dest); break;
        case 'land':     sfxLand(ctx, dest); break;
        case 'fly':      sfxFly(ctx, dest); break;
        case 'potion':   sfxPotion(ctx, dest); break;
        case 'slash':    sfxSlash(ctx, dest); break;
        case 'fleshHit':     sfxFleshHit(ctx, dest); break;
        case 'fleshHitHigh': sfxFleshHit(ctx, dest, 1.25); break;
        case 'hurt':     sfxHurt(ctx, dest); break;
        case 'shoot':    sfxShoot(ctx, dest); break;
        case 'arrow':    sfxArrow(ctx, dest); break;
        case 'fireball':     sfxFireball(ctx, dest); break;
        case 'woodBreak':    sfxWoodBreak(ctx, dest); break;
        case 'ceramicBreak': sfxCeramicBreak(ctx, dest); break;
        case 'drink':        sfxDrink(ctx, dest); break;
        case 'deathJingle':  sfxDeathJingle(ctx, dest); break;
        case 'gem':          sfxGem(ctx, dest); break;
        case 'uiSelect':     sfxUISelect(ctx, dest); break;
        case 'uiAccept':     sfxUIAccept(ctx, dest); break;
        case 'uiCancel':     sfxUICancel(ctx, dest); break;
        case 'clank':        sfxClank(ctx, dest); break;
        default:             playTone(ctx, 440, 0.1, 'sine', 0.08); break;
      }
    } catch {
      // ignore
    }
  }

  private createAttenuatedDest(ctx: AudioContext, volume: number): AudioNode {
    const gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(ctx.destination);
    return gain;
  }

  /** Stop the looping step sound (call when character stops moving) */
  stopSteps(): void {
    sfxStepStop();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }
}

export const audioSystem = new AudioSystemClass();
