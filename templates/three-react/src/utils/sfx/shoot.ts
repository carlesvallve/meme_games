/** Short procedural shoot/fire SFX — bandpass chirp rising quickly */
export function sfxShoot(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const now = ctx.currentTime;
  const duration = 0.12;

  // White noise burst
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Bandpass chirp: low to high for a "pew" feel
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(600, now);
  filter.frequency.exponentialRampToValueAtTime(3000, now + duration * 0.4);
  filter.frequency.exponentialRampToValueAtTime(1200, now + duration);
  filter.Q.value = 4;

  // Envelope
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.14, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  source.start(now);
  source.stop(now + duration);
}
