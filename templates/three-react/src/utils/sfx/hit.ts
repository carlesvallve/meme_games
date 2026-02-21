import { playTone } from './primitives';

export function sfxHit(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  playTone(ctx, 200, 0.15, 'sawtooth', 0.1, dest);
}
