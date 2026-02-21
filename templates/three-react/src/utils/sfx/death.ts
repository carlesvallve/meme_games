import { playTone } from './primitives';

export function sfxDeath(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  playTone(ctx, 300, 0.2, 'sawtooth', 0.1, dest);
  setTimeout(() => playTone(ctx, 200, 0.3, 'sawtooth', 0.12, dest), 200);
}
