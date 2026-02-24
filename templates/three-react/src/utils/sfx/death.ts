/** Visceral death sound — big wet impact + metallic crunch + low burst */
export function sfxDeath(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const now = ctx.currentTime;
  const pitchMul = 0.8 + Math.random() * 0.4;

  // ── Heavy low thump (big body hit) ──
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(90 * pitchMul, now);
  osc.frequency.exponentialRampToValueAtTime(25, now + 0.2);

  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.35, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

  osc.connect(oscGain);
  oscGain.connect(dest);
  osc.start(now);
  osc.stop(now + 0.3);

  // ── Wet splatter noise (longer, louder than regular hit) ──
  const splatDur = 0.15;
  const splatSize = Math.floor(ctx.sampleRate * splatDur);
  const splatBuf = ctx.createBuffer(1, splatSize, ctx.sampleRate);
  const splatData = splatBuf.getChannelData(0);
  for (let i = 0; i < splatSize; i++) {
    splatData[i] = Math.random() * 2 - 1;
  }
  const splatSrc = ctx.createBufferSource();
  splatSrc.buffer = splatBuf;

  const splatFilter = ctx.createBiquadFilter();
  splatFilter.type = 'lowpass';
  splatFilter.frequency.setValueAtTime(3000 * pitchMul, now);
  splatFilter.frequency.exponentialRampToValueAtTime(150, now + splatDur);
  splatFilter.Q.value = 0.8;

  const splatGain = ctx.createGain();
  splatGain.gain.setValueAtTime(0.25, now);
  splatGain.gain.exponentialRampToValueAtTime(0.001, now + splatDur);

  splatSrc.connect(splatFilter);
  splatFilter.connect(splatGain);
  splatGain.connect(dest);
  splatSrc.start(now);
  splatSrc.stop(now + splatDur + 0.02);

  // ── Metallic crunch (weapon finishing blow) ──
  const crunchDur = 0.14;
  const crunchSize = Math.floor(ctx.sampleRate * crunchDur);
  const crunchBuf = ctx.createBuffer(1, crunchSize, ctx.sampleRate);
  const crunchData = crunchBuf.getChannelData(0);
  for (let i = 0; i < crunchSize; i++) {
    crunchData[i] = Math.random() * 2 - 1;
  }
  const crunchSrc = ctx.createBufferSource();
  crunchSrc.buffer = crunchBuf;

  const crunchFilter = ctx.createBiquadFilter();
  crunchFilter.type = 'bandpass';
  crunchFilter.frequency.setValueAtTime(3500 * pitchMul, now);
  crunchFilter.frequency.exponentialRampToValueAtTime(600, now + crunchDur);
  crunchFilter.Q.value = 2.5;

  const crunchGain = ctx.createGain();
  crunchGain.gain.setValueAtTime(0, now);
  crunchGain.gain.linearRampToValueAtTime(0.12, now + 0.005);
  crunchGain.gain.exponentialRampToValueAtTime(0.001, now + crunchDur);

  crunchSrc.connect(crunchFilter);
  crunchFilter.connect(crunchGain);
  crunchGain.connect(dest);
  crunchSrc.start(now);
  crunchSrc.stop(now + crunchDur + 0.02);

  // ── Delayed wet tail (gore splat settling) ──
  const tailDelay = 0.08;
  const tailDur = 0.12;
  const tailSize = Math.floor(ctx.sampleRate * tailDur);
  const tailBuf = ctx.createBuffer(1, tailSize, ctx.sampleRate);
  const tailData = tailBuf.getChannelData(0);
  for (let i = 0; i < tailSize; i++) {
    tailData[i] = Math.random() * 2 - 1;
  }
  const tailSrc = ctx.createBufferSource();
  tailSrc.buffer = tailBuf;

  const tailFilter = ctx.createBiquadFilter();
  tailFilter.type = 'lowpass';
  tailFilter.frequency.setValueAtTime(1200, now + tailDelay);
  tailFilter.frequency.exponentialRampToValueAtTime(100, now + tailDelay + tailDur);
  tailFilter.Q.value = 0.5;

  const tailGain = ctx.createGain();
  tailGain.gain.setValueAtTime(0, now);
  tailGain.gain.setValueAtTime(0.15, now + tailDelay);
  tailGain.gain.exponentialRampToValueAtTime(0.001, now + tailDelay + tailDur);

  tailSrc.connect(tailFilter);
  tailFilter.connect(tailGain);
  tailGain.connect(dest);
  tailSrc.start(now + tailDelay);
  tailSrc.stop(now + tailDelay + tailDur + 0.02);
}
