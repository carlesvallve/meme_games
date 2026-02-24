/** Fireball launch — deep whomp + crackling fire + rising energy tone */
export function sfxFireball(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const now = ctx.currentTime;
  const pitchMul = 0.85 + Math.random() * 0.3;

  // ── Deep whomp (launch impact) ──
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150 * pitchMul, now);
  osc.frequency.exponentialRampToValueAtTime(60, now + 0.15);

  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.12, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

  osc.connect(oscGain);
  oscGain.connect(dest);
  osc.start(now);
  osc.stop(now + 0.2);

  // ── Crackling fire noise ──
  const fireDur = 0.25;
  const fireSize = Math.floor(ctx.sampleRate * fireDur);
  const fireBuf = ctx.createBuffer(1, fireSize, ctx.sampleRate);
  const fireData = fireBuf.getChannelData(0);
  for (let i = 0; i < fireSize; i++) {
    // Crackly noise: mix of white noise and sparse pops
    fireData[i] = (Math.random() * 2 - 1) * (Math.random() > 0.7 ? 1 : 0.3);
  }
  const fireSrc = ctx.createBufferSource();
  fireSrc.buffer = fireBuf;

  const fireBP = ctx.createBiquadFilter();
  fireBP.type = 'bandpass';
  fireBP.frequency.setValueAtTime(2000 * pitchMul, now);
  fireBP.frequency.exponentialRampToValueAtTime(600, now + fireDur);
  fireBP.Q.value = 1.5;

  const fireGain = ctx.createGain();
  fireGain.gain.setValueAtTime(0, now);
  fireGain.gain.linearRampToValueAtTime(0.08, now + 0.02);
  fireGain.gain.exponentialRampToValueAtTime(0.001, now + fireDur);

  fireSrc.connect(fireBP);
  fireBP.connect(fireGain);
  fireGain.connect(dest);
  fireSrc.start(now);
  fireSrc.stop(now + fireDur + 0.02);

  // ── Rising energy tone (magical feel) ──
  const osc2 = ctx.createOscillator();
  osc2.type = 'sawtooth';
  osc2.frequency.setValueAtTime(200 * pitchMul, now);
  osc2.frequency.exponentialRampToValueAtTime(800 * pitchMul, now + 0.12);
  osc2.frequency.exponentialRampToValueAtTime(300, now + 0.22);

  const osc2BP = ctx.createBiquadFilter();
  osc2BP.type = 'bandpass';
  osc2BP.frequency.value = 600 * pitchMul;
  osc2BP.Q.value = 3;

  const osc2Gain = ctx.createGain();
  osc2Gain.gain.setValueAtTime(0, now);
  osc2Gain.gain.linearRampToValueAtTime(0.04, now + 0.02);
  osc2Gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

  osc2.connect(osc2BP);
  osc2BP.connect(osc2Gain);
  osc2Gain.connect(dest);
  osc2.start(now);
  osc2.stop(now + 0.25);
}
