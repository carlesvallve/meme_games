import { playTone } from './primitives';

const BASE_FREQ = 100;

/** Footstep — slightly higher pitch than base */
export function sfxStep(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const freq = (BASE_FREQ * 1.2) * (0.85 + Math.random() * 0.3);
  playTone(ctx, freq, 0.05, 'sine', 0.05, dest);
}

/** Landing thud — base pitch, same timbre as step */
export function sfxLand(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const freq = BASE_FREQ * (0.85 + Math.random() * 0.3);
  playTone(ctx, freq, 0.07, 'sine', 0.07, dest);
}
