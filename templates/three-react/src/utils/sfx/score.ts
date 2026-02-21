import { playTone } from './primitives';

export function sfxScore(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  playTone(ctx, 600, 0.08, 'sine', 0.1, dest);
}
