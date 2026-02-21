import { toneSweep } from './primitives';

export function sfxPickup(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  toneSweep(ctx, 400, 800, 0.15, 'sine', 0.1, dest);
}
