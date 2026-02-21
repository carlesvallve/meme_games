/** Tiny landing thud for small items.
 *  - intensity 0–1 scales volume
 *  - bounceCount lowers pitch on each consecutive landing (0 = first, highest)
 */
export function sfxThud(ctx: AudioContext, intensity = 1, bounceCount = 0, dest: AudioNode = ctx.destination): void {
  const now = ctx.currentTime;

  // Pitch drops with each bounce, plus ±10% random variation
  const bounceDrop = Math.pow(0.7, bounceCount); // 1.0 → 0.7 → 0.49 → ...
  const rand = 0.9 + Math.random() * 0.2;
  const pitch = bounceDrop * rand;

  const vol = (0.03 + intensity * 0.04) * bounceDrop;
  const dur = 0.04 + intensity * 0.03;

  // Light tap oscillator
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(280 * pitch, now);
  osc.frequency.exponentialRampToValueAtTime(150 * pitch, now + dur);

  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(vol, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + dur);

  osc.connect(oscGain);
  oscGain.connect(dest);
  osc.start(now);
  osc.stop(now + dur);

  // Tiny noise click for surface texture
  const noiseDur = 0.015 + intensity * 0.01;
  const bufferSize = Math.floor(ctx.sampleRate * noiseDur);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900 * pitch;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(vol * 0.4, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + noiseDur);

  noise.connect(lp);
  lp.connect(noiseGain);
  noiseGain.connect(dest);
  noise.start(now);
  noise.stop(now + noiseDur);
}
