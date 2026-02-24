/** Swoosh/slash sound — breathy noise sweep, like a blade cutting air */
export function sfxSlash(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const now = ctx.currentTime;
  const duration = 0.22;

  // White noise burst
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Randomize pitch range per swing
  const pitchMul = 0.7 + Math.random() * 0.6; // 0.7–1.3x
  const startFreq = 2000 * pitchMul;
  const endFreq = 300 * pitchMul;

  // Bandpass: sweep from mid to low for a windy whoosh (not metallic)
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(startFreq, now);
  filter.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
  filter.Q.value = 0.8; // wide band = breathy, not resonant

  // Gentle highpass to remove rumble
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 150;

  // Envelope: soft attack, smooth decay — low volume
  const vol = 0.04 + Math.random() * 0.02; // 0.04–0.06
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(vol, now + 0.02);
  gain.gain.linearRampToValueAtTime(vol * 0.8, now + 0.06);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  source.connect(filter);
  filter.connect(hp);
  hp.connect(gain);
  gain.connect(dest);
  source.start(now);
  source.stop(now + duration);
}
