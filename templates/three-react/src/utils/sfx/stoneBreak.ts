/** Stone/earth breaking — obstacle smashed apart.
 *
 *  4 layered passes with staggered timing:
 *  1. Impact crack (t=0) — deep stone fracture + low thud
 *  2. Rubble burst (t=0.02) — mid-freq crumbling noise
 *  3. Debris scatter (t=0.1) — rocks bouncing and tumbling
 *  4. Dust settle (t=0.25) — quiet low rumble tail
 */
export function sfxStoneBreak(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const now = ctx.currentTime;
  const pitch = 0.8 + Math.random() * 0.4; // ±20% variation

  // ── 1. Impact crack (t=0) — deep stone fracture ──
  const crack = ctx.createOscillator();
  crack.type = 'sine';
  crack.frequency.setValueAtTime(140 * pitch, now);
  crack.frequency.exponentialRampToValueAtTime(35 * pitch, now + 0.15);

  const crackGain = ctx.createGain();
  crackGain.gain.setValueAtTime(0.25, now);
  crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

  crack.connect(crackGain);
  crackGain.connect(dest);
  crack.start(now);
  crack.stop(now + 0.19);

  // Bright crack overtone
  const crack2 = ctx.createOscillator();
  crack2.type = 'triangle';
  crack2.frequency.setValueAtTime(800 * pitch, now);
  crack2.frequency.exponentialRampToValueAtTime(200 * pitch, now + 0.08);

  const crack2Gain = ctx.createGain();
  crack2Gain.gain.setValueAtTime(0.06, now);
  crack2Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

  crack2.connect(crack2Gain);
  crack2Gain.connect(dest);
  crack2.start(now);
  crack2.stop(now + 0.1);

  // ── 2. Rubble burst (t=0.02) — crumbling noise ──
  const rubbleDur = 0.22;
  const rubbleBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * rubbleDur), ctx.sampleRate);
  const rubbleData = rubbleBuf.getChannelData(0);
  for (let i = 0; i < rubbleData.length; i++) {
    rubbleData[i] = Math.random() * 2 - 1;
  }
  const rubbleSrc = ctx.createBufferSource();
  rubbleSrc.buffer = rubbleBuf;

  const rubbleBP = ctx.createBiquadFilter();
  rubbleBP.type = 'bandpass';
  rubbleBP.Q.value = 2;
  rubbleBP.frequency.setValueAtTime(500 * pitch, now + 0.02);
  rubbleBP.frequency.exponentialRampToValueAtTime(120 * pitch, now + 0.02 + rubbleDur);

  const rubbleGain = ctx.createGain();
  rubbleGain.gain.setValueAtTime(0, now);
  rubbleGain.gain.linearRampToValueAtTime(0.18, now + 0.025);
  rubbleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.02 + rubbleDur);

  rubbleSrc.connect(rubbleBP);
  rubbleBP.connect(rubbleGain);
  rubbleGain.connect(dest);
  rubbleSrc.start(now + 0.02);
  rubbleSrc.stop(now + 0.02 + rubbleDur + 0.02);

  // ── 3. Debris scatter (t=0.1) — rocks tumbling ──
  const debrisDelay = 0.1;
  const debrisDur = 0.3;
  const debrisBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * debrisDur), ctx.sampleRate);
  const debrisData = debrisBuf.getChannelData(0);
  for (let i = 0; i < debrisData.length; i++) {
    const t = i / ctx.sampleRate;
    // Irregular bouncing rocks
    const bounce1 = Math.pow(Math.abs(Math.sin(t * 25 * pitch)), 8);
    const bounce2 = Math.pow(Math.abs(Math.sin(t * 42 * pitch + 1.7)), 6);
    const combined = Math.max(bounce1, bounce2);
    const decay = Math.exp(-t * 4);
    debrisData[i] = (Math.random() * 2 - 1) * combined * decay;
  }
  const debrisSrc = ctx.createBufferSource();
  debrisSrc.buffer = debrisBuf;

  const debrisBP = ctx.createBiquadFilter();
  debrisBP.type = 'bandpass';
  debrisBP.Q.value = 1.5;
  debrisBP.frequency.setValueAtTime(350 * pitch, now + debrisDelay);
  debrisBP.frequency.exponentialRampToValueAtTime(100 * pitch, now + debrisDelay + debrisDur);

  const debrisGain = ctx.createGain();
  debrisGain.gain.setValueAtTime(0, now);
  debrisGain.gain.setValueAtTime(0.14, now + debrisDelay);
  debrisGain.gain.exponentialRampToValueAtTime(0.001, now + debrisDelay + debrisDur);

  debrisSrc.connect(debrisBP);
  debrisBP.connect(debrisGain);
  debrisGain.connect(dest);
  debrisSrc.start(now + debrisDelay);
  debrisSrc.stop(now + debrisDelay + debrisDur + 0.02);

  // ── 4. Dust settle (t=0.25) — low rumble tail ──
  const dustDelay = 0.25;
  const dustDur = 0.2;
  const dustBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dustDur), ctx.sampleRate);
  const dustData = dustBuf.getChannelData(0);
  for (let i = 0; i < dustData.length; i++) {
    dustData[i] = Math.random() * 2 - 1;
  }
  const dustSrc = ctx.createBufferSource();
  dustSrc.buffer = dustBuf;

  const dustLP = ctx.createBiquadFilter();
  dustLP.type = 'lowpass';
  dustLP.frequency.setValueAtTime(250 * pitch, now + dustDelay);
  dustLP.frequency.exponentialRampToValueAtTime(60, now + dustDelay + dustDur);
  dustLP.Q.value = 0.5;

  const dustGain = ctx.createGain();
  dustGain.gain.setValueAtTime(0, now);
  dustGain.gain.setValueAtTime(0.06, now + dustDelay);
  dustGain.gain.exponentialRampToValueAtTime(0.001, now + dustDelay + dustDur);

  dustSrc.connect(dustLP);
  dustLP.connect(dustGain);
  dustGain.connect(dest);
  dustSrc.start(now + dustDelay);
  dustSrc.stop(now + dustDelay + dustDur + 0.02);
}
