import { playTone } from './primitives';

export function sfxDamage(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  playTone(ctx, 80, 0.2, 'square', 0.12, dest);
}
