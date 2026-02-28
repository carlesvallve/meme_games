import { playTone } from './primitives';

const BASE_FREQ = 100;

/** Footstep — slightly higher pitch than base (synthetic) */
// export function sfxStep(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
//   const freq = (BASE_FREQ * 1.2) * (0.85 + Math.random() * 0.3);
//   playTone(ctx, freq, 0.05, 'sine', 0.05, dest);
// }

// ── WAV-based individual grass steps (split from sequence) ───────────
// Excluded: 12, 19 (renamed with _exclude suffix)
const GRASS_STEP_INDICES = [0,1,2,3,4,5,6,7,8,9,10,11,13,14,15,16,17,18];
const grassBuffers: AudioBuffer[] = [];
let grassLoading = false;

function ensureGrassSteps(ctx: AudioContext): void {
  if (grassBuffers.length > 0 || grassLoading) return;
  grassLoading = true;
  for (const i of GRASS_STEP_INDICES) {
    const url = `/sfx/steps/grass/grass_step_${String(i).padStart(2, '0')}.wav`;
    fetch(url)
      .then(r => r.arrayBuffer())
      .then(buf => ctx.decodeAudioData(buf))
      .then(decoded => grassBuffers.push(decoded))
      .catch(() => { /* ignore */ });
  }
}

/** Footstep — random grass step wav at slightly varied pitch */
export function sfxStep(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  ensureGrassSteps(ctx);
  if (grassBuffers.length === 0) return; // still loading

  const buffer = grassBuffers[Math.floor(Math.random() * grassBuffers.length)];
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = 0.85 + Math.random() * 0.3;
  source.connect(dest);
  source.start();
}

/** No-op — kept for API compat (loop approach removed) */
export function sfxStepStop(): void {}

/** Landing thud — base pitch, same timbre as step */
export function sfxLand(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const freq = BASE_FREQ * (0.85 + Math.random() * 0.3);
  playTone(ctx, freq, 0.07, 'sine', 0.07, dest);
}

/** Wing flap — short filtered noise burst with pitch sweep */
export function sfxFly(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const duration = 0.08 + Math.random() * 0.04;
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(800 + Math.random() * 400, ctx.currentTime);
  filter.frequency.linearRampToValueAtTime(200, ctx.currentTime + duration);
  filter.Q.value = 1.5;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.06, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  source.start();
}
