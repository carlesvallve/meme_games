/** Arrow whoosh — breathy air-cutting noise with a tonal whistle */
export function sfxArrow(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const now = ctx.currentTime;
  const duration = 0.18;
  const pitchMul = 0.8 + Math.random() * 0.4;

  // White noise burst — the air cutting
  const bufSize = Math.floor(ctx.sampleRate * duration);
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;

  // Bandpass sweep: mid to low for a whoosh
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2500 * pitchMul, now);
  bp.frequency.exponentialRampToValueAtTime(400 * pitchMul, now + duration);
  bp.Q.value = 1.2;

  // Highpass to remove rumble
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 200;

  // Envelope: quick attack, smooth decay
  const vol = 0.05 + Math.random() * 0.02;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(vol, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  src.connect(bp);
  bp.connect(hp);
  hp.connect(gain);
  gain.connect(dest);
  src.start(now);
  src.stop(now + duration + 0.02);

  // Subtle tonal whistle — arrow shaft vibrating
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1800 * pitchMul, now);
  osc.frequency.exponentialRampToValueAtTime(900 * pitchMul, now + duration);

  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0, now);
  oscGain.gain.linearRampToValueAtTime(0.015, now + 0.01);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.connect(oscGain);
  oscGain.connect(dest);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}
