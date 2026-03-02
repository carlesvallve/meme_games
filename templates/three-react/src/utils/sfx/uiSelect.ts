/** Subtle UI navigation click — short filtered noise pop, like a soft button press. */
export function sfxUISelect(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const now = ctx.currentTime;

  // Very short burst of filtered noise — produces a soft "tick" / click
  const bufferSize = ctx.sampleRate * 0.015; // 15ms of noise
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1);
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  // Band-pass filter to shape the click — not too bassy, not too hissy
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 2200;
  filter.Q.value = 1.2;

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.04, now);
  env.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

  noise.connect(filter);
  filter.connect(env);
  env.connect(dest);
  noise.start(now);
  noise.stop(now + 0.03);
}

/** UI confirm / accept — a slightly fuller click, like a satisfying button press. */
export function sfxUIAccept(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const now = ctx.currentTime;

  // Two quick noise clicks in succession — gives a "ka-click" feel
  for (let i = 0; i < 2; i++) {
    const t = now + i * 0.04;
    const bufferSize = ctx.sampleRate * 0.018;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let j = 0; j < bufferSize; j++) {
      data[j] = (Math.random() * 2 - 1);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    // Second click slightly higher pitched for a confirming feel
    filter.frequency.value = i === 0 ? 2500 : 4000;
    filter.Q.value = 1.0;

    const env = ctx.createGain();
    const vol = i === 0 ? 0.055 : 0.075;
    env.gain.setValueAtTime(vol, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.025);

    noise.connect(filter);
    filter.connect(env);
    env.connect(dest);
    noise.start(t);
    noise.stop(t + 0.03);
  }
}

/** UI cancel / back — soft descending tone. */
export function sfxUICancel(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(520, now);
  osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.08, now);
  env.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

  osc.connect(env);
  env.connect(dest);
  osc.start(now);
  osc.stop(now + 0.14);
}
