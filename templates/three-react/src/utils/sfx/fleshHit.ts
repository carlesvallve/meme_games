/** Meaty flesh-hit impact — low thump + filtered noise snap + metallic ring.
 *  Optional pitchMul: use 1 for default, >1 for higher pitch (e.g. 1.25 for terrain/wall impact). */
export function sfxFleshHit(ctx: AudioContext, dest: AudioNode = ctx.destination, pitchMulOverride?: number): void {
  const now = ctx.currentTime;

  const pitchMul = pitchMulOverride ?? (0.8 + Math.random() * 0.4);

  // Low-frequency thump (body impact)
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120 * pitchMul, now);
  osc.frequency.exponentialRampToValueAtTime(40 * pitchMul, now + 0.12);

  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.18, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

  osc.connect(oscGain);
  oscGain.connect(dest);
  osc.start(now);
  osc.stop(now + 0.15);

  // Short noise snap (the "slap" component)
  const slapDur = 0.06;
  const bufferSize = Math.floor(ctx.sampleRate * slapDur);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2000, now);
  filter.frequency.exponentialRampToValueAtTime(200, now + slapDur);
  filter.Q.value = 1;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.13, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + slapDur);

  source.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(dest);
  source.start(now);
  source.stop(now + 0.08);

  // Metallic clang layer — sharp bandpass noise sweep (old slash sound repurposed)
  const clangDur = 0.12;
  const clangSize = Math.floor(ctx.sampleRate * clangDur);
  const clangBuf = ctx.createBuffer(1, clangSize, ctx.sampleRate);
  const clangData = clangBuf.getChannelData(0);
  for (let i = 0; i < clangSize; i++) {
    clangData[i] = Math.random() * 2 - 1;
  }
  const clangSrc = ctx.createBufferSource();
  clangSrc.buffer = clangBuf;

  const clangFilter = ctx.createBiquadFilter();
  clangFilter.type = 'bandpass';
  clangFilter.frequency.setValueAtTime(4000 * pitchMul, now);
  clangFilter.frequency.exponentialRampToValueAtTime(800 * pitchMul, now + clangDur);
  clangFilter.Q.value = 2;

  const clangGain = ctx.createGain();
  clangGain.gain.setValueAtTime(0, now);
  clangGain.gain.linearRampToValueAtTime(0.07, now + 0.005);
  clangGain.gain.exponentialRampToValueAtTime(0.001, now + clangDur);

  clangSrc.connect(clangFilter);
  clangFilter.connect(clangGain);
  clangGain.connect(dest);
  clangSrc.start(now);
  clangSrc.stop(now + clangDur);
}
