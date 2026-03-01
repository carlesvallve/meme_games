/** Ceramic shatter — pot smashed into shards.
 *
 *  5 layered passes with staggered timing:
 *  1. Impact crack (t=0) — bright ring of clay fracturing
 *  2. Shatter burst (t=0) — the pot exploding + low thud body
 *  3. First bounce (t=0.08) — large shards hitting stone
 *  4. Shard tinkle (t=0.15) — smaller pieces scattering and bouncing
 *  5. Grit settle (t=0.28) — powder/dust tail
 */
export function sfxCeramicBreak(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const now = ctx.currentTime;
  const pitch = 0.9 + Math.random() * 0.2; // ±10% variation — subtle pitch shift for ceramic

  // ── 1. Impact crack (t=0) — bright ring of ceramic fracturing ──
  const ring = ctx.createOscillator();
  ring.type = 'sine';
  ring.frequency.setValueAtTime(1800 * pitch, now);
  ring.frequency.exponentialRampToValueAtTime(500 * pitch, now + 0.1);

  const ringGain = ctx.createGain();
  ringGain.gain.setValueAtTime(0.09, now);
  ringGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

  ring.connect(ringGain);
  ringGain.connect(dest);
  ring.start(now);
  ring.stop(now + 0.13);

  // Detuned harmonic for richer ceramic resonance
  const ring2 = ctx.createOscillator();
  ring2.type = 'triangle';
  ring2.frequency.setValueAtTime(2600 * pitch, now);
  ring2.frequency.exponentialRampToValueAtTime(800 * pitch, now + 0.07);

  const ring2Gain = ctx.createGain();
  ring2Gain.gain.setValueAtTime(0.045, now);
  ring2Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

  ring2.connect(ring2Gain);
  ring2Gain.connect(dest);
  ring2.start(now);
  ring2.stop(now + 0.09);

  // ── 2. Shatter burst (t=0) — the pot exploding ──
  const shatterDur = 0.16;
  const shatterBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * shatterDur), ctx.sampleRate);
  const shatterData = shatterBuf.getChannelData(0);
  for (let i = 0; i < shatterData.length; i++) {
    shatterData[i] = Math.random() * 2 - 1;
  }
  const shatterSrc = ctx.createBufferSource();
  shatterSrc.buffer = shatterBuf;

  const shatterHP = ctx.createBiquadFilter();
  shatterHP.type = 'highpass';
  shatterHP.frequency.setValueAtTime(1500 * pitch, now);
  shatterHP.frequency.exponentialRampToValueAtTime(400 * pitch, now + shatterDur);

  const shatterGain = ctx.createGain();
  shatterGain.gain.setValueAtTime(0.15, now);
  shatterGain.gain.exponentialRampToValueAtTime(0.001, now + shatterDur);

  shatterSrc.connect(shatterHP);
  shatterHP.connect(shatterGain);
  shatterGain.connect(dest);
  shatterSrc.start(now);
  shatterSrc.stop(now + shatterDur + 0.02);

  // Low thud body
  const thud = ctx.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(85 * pitch, now);
  thud.frequency.exponentialRampToValueAtTime(30, now + 0.1);

  const thudGain = ctx.createGain();
  thudGain.gain.setValueAtTime(0.08, now);
  thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

  thud.connect(thudGain);
  thudGain.connect(dest);
  thud.start(now);
  thud.stop(now + 0.13);

  // ── 3. First bounce (t=0.08) — large shards hitting stone floor ──
  const bounce1Delay = 0.08;
  const bounce1Dur = 0.12;
  const bounce1Buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * bounce1Dur), ctx.sampleRate);
  const bounce1Data = bounce1Buf.getChannelData(0);
  for (let i = 0; i < bounce1Data.length; i++) {
    bounce1Data[i] = Math.random() * 2 - 1;
  }
  const bounce1Src = ctx.createBufferSource();
  bounce1Src.buffer = bounce1Buf;

  const bounce1BP = ctx.createBiquadFilter();
  bounce1BP.type = 'bandpass';
  bounce1BP.Q.value = 3;
  bounce1BP.frequency.setValueAtTime(2000 * pitch, now + bounce1Delay);
  bounce1BP.frequency.exponentialRampToValueAtTime(700 * pitch, now + bounce1Delay + bounce1Dur);

  const bounce1Gain = ctx.createGain();
  bounce1Gain.gain.setValueAtTime(0, now);
  bounce1Gain.gain.setValueAtTime(0.11, now + bounce1Delay);
  bounce1Gain.gain.exponentialRampToValueAtTime(0.001, now + bounce1Delay + bounce1Dur);

  bounce1Src.connect(bounce1BP);
  bounce1BP.connect(bounce1Gain);
  bounce1Gain.connect(dest);
  bounce1Src.start(now + bounce1Delay);
  bounce1Src.stop(now + bounce1Delay + bounce1Dur + 0.02);

  // Resonant ping on first bounce — a shard ringing on stone
  const ping = ctx.createOscillator();
  ping.type = 'sine';
  ping.frequency.setValueAtTime(3200 * pitch, now + bounce1Delay);
  ping.frequency.exponentialRampToValueAtTime(1600 * pitch, now + bounce1Delay + 0.06);

  const pingGain = ctx.createGain();
  pingGain.gain.setValueAtTime(0, now);
  pingGain.gain.setValueAtTime(0.035, now + bounce1Delay);
  pingGain.gain.exponentialRampToValueAtTime(0.001, now + bounce1Delay + 0.07);

  ping.connect(pingGain);
  pingGain.connect(dest);
  ping.start(now + bounce1Delay);
  ping.stop(now + bounce1Delay + 0.08);

  // ── 4. Shard tinkle (t=0.15) — smaller pieces scattering ──
  const scatterDelay = 0.15;
  const scatterDur = 0.35;
  const scatterBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * scatterDur), ctx.sampleRate);
  const scatterData = scatterBuf.getChannelData(0);
  // Irregular micro-impacts — sharp spikes with random spacing
  for (let i = 0; i < scatterData.length; i++) {
    const t = i / ctx.sampleRate;
    // Multiple overlapping bounce rhythms at different rates for organic feel
    const bounce1 = Math.pow(Math.abs(Math.sin(t * 40 * pitch)), 12);
    const bounce2 = Math.pow(Math.abs(Math.sin(t * 67 * pitch + 1.3)), 10);
    const bounce3 = Math.pow(Math.abs(Math.sin(t * 95 * pitch + 2.7)), 14);
    const combined = Math.max(bounce1, bounce2, bounce3);
    const decay = Math.exp(-t * 5);
    scatterData[i] = (Math.random() * 2 - 1) * combined * decay;
  }
  const scatterSrc = ctx.createBufferSource();
  scatterSrc.buffer = scatterBuf;

  const scatterBP = ctx.createBiquadFilter();
  scatterBP.type = 'bandpass';
  scatterBP.Q.value = 2.5;
  scatterBP.frequency.setValueAtTime(3000 * pitch, now + scatterDelay);
  scatterBP.frequency.exponentialRampToValueAtTime(1000 * pitch, now + scatterDelay + scatterDur);

  const scatterGain = ctx.createGain();
  scatterGain.gain.setValueAtTime(0, now);
  scatterGain.gain.setValueAtTime(0.12, now + scatterDelay);
  scatterGain.gain.linearRampToValueAtTime(0.08, now + scatterDelay + 0.08);
  scatterGain.gain.exponentialRampToValueAtTime(0.001, now + scatterDelay + scatterDur);

  scatterSrc.connect(scatterBP);
  scatterBP.connect(scatterGain);
  scatterGain.connect(dest);
  scatterSrc.start(now + scatterDelay);
  scatterSrc.stop(now + scatterDelay + scatterDur + 0.02);

  // ── 5. Grit settle (t=0.28) — powder and tiny fragments ──
  const dustDelay = 0.28;
  const dustDur = 0.22;
  const dustBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dustDur), ctx.sampleRate);
  const dustData = dustBuf.getChannelData(0);
  for (let i = 0; i < dustData.length; i++) {
    dustData[i] = Math.random() * 2 - 1;
  }
  const dustSrc = ctx.createBufferSource();
  dustSrc.buffer = dustBuf;

  const dustLP = ctx.createBiquadFilter();
  dustLP.type = 'lowpass';
  dustLP.frequency.setValueAtTime(800 * pitch, now + dustDelay);
  dustLP.frequency.exponentialRampToValueAtTime(120, now + dustDelay + dustDur);
  dustLP.Q.value = 0.5;

  const dustGain = ctx.createGain();
  dustGain.gain.setValueAtTime(0, now);
  dustGain.gain.setValueAtTime(0.05, now + dustDelay);
  dustGain.gain.exponentialRampToValueAtTime(0.001, now + dustDelay + dustDur);

  dustSrc.connect(dustLP);
  dustLP.connect(dustGain);
  dustGain.connect(dest);
  dustSrc.start(now + dustDelay);
  dustSrc.stop(now + dustDelay + dustDur + 0.02);
}
