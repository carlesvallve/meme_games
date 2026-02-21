import { playTone } from './primitives';

export function sfxCoin(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  playTone(ctx, 1200, 0.08, 'sine', 0.08, dest);
  setTimeout(() => playTone(ctx, 1500, 0.1, 'sine', 0.06, dest), 60);
}
