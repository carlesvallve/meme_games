/** Creaky hinge / wooden crate opening sound */
export function sfxChest(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const now = ctx.currentTime;
  const duration = 0.35;
  // ±10% random pitch variation
  const pitch = 0.9 + Math.random() * 0.2;

  // Filtered noise for woody texture
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;

  // Bandpass — single smooth sweep, lower freq range
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 8;
  bp.frequency.setValueAtTime(150 * pitch, now);
  bp.frequency.exponentialRampToValueAtTime(450 * pitch, now + 0.15);
  bp.frequency.exponentialRampToValueAtTime(250 * pitch, now + duration);

  // Gain envelope — single swell, no gap
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.08, now);
  noiseGain.gain.linearRampToValueAtTime(0.18, now + 0.1);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  noise.connect(bp);
  bp.connect(noiseGain);
  noiseGain.connect(dest);
  noise.start(now);
  noise.stop(now + duration);

  // Tonal creak — low sawtooth with slow wobble
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(120 * pitch, now);
  osc.frequency.exponentialRampToValueAtTime(300 * pitch, now + 0.12);
  osc.frequency.exponentialRampToValueAtTime(180 * pitch, now + duration);

  // LFO for vibrato (wobbly hinge)
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 20;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 25;
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);

  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0.03, now);
  oscGain.gain.linearRampToValueAtTime(0.06, now + 0.1);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  // Lowpass to tame harshness
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 600;

  osc.connect(lp);
  lp.connect(oscGain);
  oscGain.connect(dest);
  osc.start(now);
  lfo.start(now);
  osc.stop(now + duration);
  lfo.stop(now + duration);
}
