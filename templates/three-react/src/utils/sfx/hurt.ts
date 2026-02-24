import { playTone } from './primitives';

/** Player-hurt sound — descending tone with noise */
export function sfxHurt(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const now = ctx.currentTime;

  // Descending "oof" tone
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(250, now);
  osc.frequency.exponentialRampToValueAtTime(80, now + 0.2);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.12, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

  osc.connect(gain);
  gain.connect(dest);
  osc.start(now);
  osc.stop(now + 0.25);

  // Short noise burst for impact
  const bufferSize = Math.floor(ctx.sampleRate * 0.05);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.08, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  source.connect(noiseGain);
  noiseGain.connect(dest);
  source.start(now);
  source.stop(now + 0.06);
}
