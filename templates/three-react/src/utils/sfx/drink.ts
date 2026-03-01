/** Drinking / gulping potion sound.
 *
 *  3 layered passes:
 *  1. Liquid gulp (t=0) — resonant low tone with wobble
 *  2. Bubble burst (t=0.08) — short noise pop
 *  3. Swallow (t=0.15) — descending tone
 */
export function sfxDrink(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const now = ctx.currentTime;
  const pitch = 0.92 + Math.random() * 0.16;

  // ── 1. Liquid gulp — resonant low tone with LFO wobble ──
  const gulp = ctx.createOscillator();
  gulp.type = 'sine';
  gulp.frequency.setValueAtTime(180 * pitch, now);
  gulp.frequency.exponentialRampToValueAtTime(120 * pitch, now + 0.12);

  // Wobble via LFO for liquid feel
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 18;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 25 * pitch;
  lfo.connect(lfoGain);
  lfoGain.connect(gulp.frequency);
  lfo.start(now);
  lfo.stop(now + 0.18);

  const gulpGain = ctx.createGain();
  gulpGain.gain.setValueAtTime(0.12, now);
  gulpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

  gulp.connect(gulpGain);
  gulpGain.connect(dest);
  gulp.start(now);
  gulp.stop(now + 0.18);

  // ── 2. Bubble burst — short filtered noise pop ──
  const bubbleDelay = 0.08;
  const bubbleDur = 0.06;
  const bubbleBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * bubbleDur), ctx.sampleRate);
  const bubbleData = bubbleBuf.getChannelData(0);
  for (let i = 0; i < bubbleData.length; i++) {
    bubbleData[i] = Math.random() * 2 - 1;
  }
  const bubbleSrc = ctx.createBufferSource();
  bubbleSrc.buffer = bubbleBuf;

  const bubbleBP = ctx.createBiquadFilter();
  bubbleBP.type = 'bandpass';
  bubbleBP.frequency.setValueAtTime(600 * pitch, now + bubbleDelay);
  bubbleBP.Q.value = 4;

  const bubbleGain = ctx.createGain();
  bubbleGain.gain.setValueAtTime(0, now);
  bubbleGain.gain.setValueAtTime(0.08, now + bubbleDelay);
  bubbleGain.gain.exponentialRampToValueAtTime(0.001, now + bubbleDelay + bubbleDur);

  bubbleSrc.connect(bubbleBP);
  bubbleBP.connect(bubbleGain);
  bubbleGain.connect(dest);
  bubbleSrc.start(now + bubbleDelay);
  bubbleSrc.stop(now + bubbleDelay + bubbleDur + 0.01);

  // ── 3. Swallow — descending tone ──
  const swallowDelay = 0.15;
  const swallow = ctx.createOscillator();
  swallow.type = 'triangle';
  swallow.frequency.setValueAtTime(300 * pitch, now + swallowDelay);
  swallow.frequency.exponentialRampToValueAtTime(80 * pitch, now + swallowDelay + 0.1);

  const swallowGain = ctx.createGain();
  swallowGain.gain.setValueAtTime(0, now);
  swallowGain.gain.setValueAtTime(0.07, now + swallowDelay);
  swallowGain.gain.exponentialRampToValueAtTime(0.001, now + swallowDelay + 0.12);

  swallow.connect(swallowGain);
  swallowGain.connect(dest);
  swallow.start(now + swallowDelay);
  swallow.stop(now + swallowDelay + 0.14);
}
