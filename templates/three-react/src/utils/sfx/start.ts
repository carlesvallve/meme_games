import { playTone } from './primitives';

export function sfxStart(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  playTone(ctx, 523, 0.15, 'square', 0.1, dest);
  setTimeout(() => playTone(ctx, 659, 0.15, 'square', 0.1, dest), 150);
  setTimeout(() => playTone(ctx, 784, 0.3, 'square', 0.1, dest), 300);
}
