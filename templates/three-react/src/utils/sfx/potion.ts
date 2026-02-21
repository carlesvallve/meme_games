/** Bubbly liquid potion pickup — low gurgle sweep + two resonant bubble pops */
export function sfxPotion(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const now = ctx.currentTime;

  // Low gurgle sweep (filtered noise for liquid body)
  const bufLen = Math.floor(ctx.sampleRate * 0.25);
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(300, now);
  bp.frequency.linearRampToValueAtTime(600, now + 0.2);
  bp.Q.value = 3;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.08, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  noise.connect(bp);
  bp.connect(noiseGain);
  noiseGain.connect(dest);
  noise.start(now);
  noise.stop(now + 0.25);

  // Bubble pop 1 — short sine blip with pitch drop
  const bub1 = ctx.createOscillator();
  const g1 = ctx.createGain();
  bub1.type = 'sine';
  bub1.frequency.setValueAtTime(800, now + 0.05);
  bub1.frequency.exponentialRampToValueAtTime(400, now + 0.12);
  g1.gain.setValueAtTime(0.1, now + 0.05);
  g1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  bub1.connect(g1);
  g1.connect(dest);
  bub1.start(now + 0.05);
  bub1.stop(now + 0.13);

  // Bubble pop 2 — higher, slightly delayed
  const bub2 = ctx.createOscillator();
  const g2 = ctx.createGain();
  bub2.type = 'sine';
  bub2.frequency.setValueAtTime(1000, now + 0.12);
  bub2.frequency.exponentialRampToValueAtTime(500, now + 0.2);
  g2.gain.setValueAtTime(0.08, now + 0.12);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  bub2.connect(g2);
  g2.connect(dest);
  bub2.start(now + 0.12);
  bub2.stop(now + 0.21);
}
