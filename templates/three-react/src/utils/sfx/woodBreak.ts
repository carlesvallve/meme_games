/** Wood breaking — barrel/crate smashed apart.
 *
 *  4 layered passes with staggered timing:
 *  1. Impact thump — low sine punch when weapon connects
 *  2. Splintering crack — mid-freq noise burst, the wood fracturing
 *  3. Debris scatter — delayed rattling pieces bouncing on stone floor
 *  4. Settling tail — quiet low rumble as pieces come to rest
 */
export function sfxWoodBreak(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const now = ctx.currentTime;
  const pitch = 0.75 + Math.random() * 0.5; // ±25% variation

  // ── 1. Impact thump (t=0) — low punch of weapon hitting wood ──
  const thump = ctx.createOscillator();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(110 * pitch, now);
  thump.frequency.exponentialRampToValueAtTime(40 * pitch, now + 0.12);

  const thumpGain = ctx.createGain();
  thumpGain.gain.setValueAtTime(0.28, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

  thump.connect(thumpGain);
  thumpGain.connect(dest);
  thump.start(now);
  thump.stop(now + 0.16);

  // ── 2. Splintering crack (t=0.01) — the wood fracturing apart ──
  const crackDur = 0.2;
  const crackBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * crackDur), ctx.sampleRate);
  const crackData = crackBuf.getChannelData(0);
  for (let i = 0; i < crackData.length; i++) {
    crackData[i] = Math.random() * 2 - 1;
  }
  const crackSrc = ctx.createBufferSource();
  crackSrc.buffer = crackBuf;

  // Bandpass sweeping down — crack starts sharp, becomes woody
  const crackBP = ctx.createBiquadFilter();
  crackBP.type = 'bandpass';
  crackBP.Q.value = 3;
  crackBP.frequency.setValueAtTime(600 * pitch, now + 0.01);
  crackBP.frequency.exponentialRampToValueAtTime(180 * pitch, now + 0.01 + crackDur);

  const crackGain = ctx.createGain();
  crackGain.gain.setValueAtTime(0, now);
  crackGain.gain.linearRampToValueAtTime(0.22, now + 0.015);
  crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.01 + crackDur);

  crackSrc.connect(crackBP);
  crackBP.connect(crackGain);
  crackGain.connect(dest);
  crackSrc.start(now + 0.01);
  crackSrc.stop(now + 0.01 + crackDur + 0.02);

  // Tonal crack accent — sawtooth snap for that woody fiber splitting sound
  const snap = ctx.createOscillator();
  snap.type = 'sawtooth';
  snap.frequency.setValueAtTime(160 * pitch, now + 0.01);
  snap.frequency.exponentialRampToValueAtTime(60 * pitch, now + 0.09);

  const snapLP = ctx.createBiquadFilter();
  snapLP.type = 'lowpass';
  snapLP.frequency.value = 500 * pitch;

  const snapGain = ctx.createGain();
  snapGain.gain.setValueAtTime(0.1, now + 0.01);
  snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

  snap.connect(snapLP);
  snapLP.connect(snapGain);
  snapGain.connect(dest);
  snap.start(now + 0.01);
  snap.stop(now + 0.11);

  // ── 3. Debris scatter (t=0.08) — pieces tumbling and bouncing ──
  const debrisDelay = 0.08;
  const debrisDur = 0.25;
  const debrisBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * debrisDur), ctx.sampleRate);
  const debrisData = debrisBuf.getChannelData(0);
  // Irregular noise — multiply by random amplitude envelope for bouncy rattling
  for (let i = 0; i < debrisData.length; i++) {
    const t = i / ctx.sampleRate;
    // Amplitude modulation: rapid bursts that decay
    const burstEnv = Math.pow(Math.abs(Math.sin(t * 35 * pitch)), 3);
    debrisData[i] = (Math.random() * 2 - 1) * burstEnv;
  }
  const debrisSrc = ctx.createBufferSource();
  debrisSrc.buffer = debrisBuf;

  const debrisBP = ctx.createBiquadFilter();
  debrisBP.type = 'bandpass';
  debrisBP.Q.value = 2;
  debrisBP.frequency.setValueAtTime(400 * pitch, now + debrisDelay);
  debrisBP.frequency.exponentialRampToValueAtTime(200 * pitch, now + debrisDelay + debrisDur);

  const debrisGain = ctx.createGain();
  debrisGain.gain.setValueAtTime(0, now);
  debrisGain.gain.setValueAtTime(0.15, now + debrisDelay);
  debrisGain.gain.linearRampToValueAtTime(0.1, now + debrisDelay + 0.06);
  debrisGain.gain.exponentialRampToValueAtTime(0.001, now + debrisDelay + debrisDur);

  debrisSrc.connect(debrisBP);
  debrisBP.connect(debrisGain);
  debrisGain.connect(dest);
  debrisSrc.start(now + debrisDelay);
  debrisSrc.stop(now + debrisDelay + debrisDur + 0.02);

  // ── 4. Settling tail (t=0.2) — low rumble as debris comes to rest ──
  const tailDelay = 0.2;
  const tailDur = 0.18;
  const tailBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * tailDur), ctx.sampleRate);
  const tailData = tailBuf.getChannelData(0);
  for (let i = 0; i < tailData.length; i++) {
    tailData[i] = Math.random() * 2 - 1;
  }
  const tailSrc = ctx.createBufferSource();
  tailSrc.buffer = tailBuf;

  const tailLP = ctx.createBiquadFilter();
  tailLP.type = 'lowpass';
  tailLP.frequency.setValueAtTime(300 * pitch, now + tailDelay);
  tailLP.frequency.exponentialRampToValueAtTime(80, now + tailDelay + tailDur);
  tailLP.Q.value = 0.5;

  const tailGain = ctx.createGain();
  tailGain.gain.setValueAtTime(0, now);
  tailGain.gain.setValueAtTime(0.08, now + tailDelay);
  tailGain.gain.exponentialRampToValueAtTime(0.001, now + tailDelay + tailDur);

  tailSrc.connect(tailLP);
  tailLP.connect(tailGain);
  tailGain.connect(dest);
  tailSrc.start(now + tailDelay);
  tailSrc.stop(now + tailDelay + tailDur + 0.02);
}
