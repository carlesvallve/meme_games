/** Metallic clank — armour deflect sound.
 *  Short percussive impact with metallic character. More "CLONK" than "TINK". */
export function sfxClank(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const now = ctx.currentTime;
  const pitchMul = 0.85 + Math.random() * 0.3;

  // Percussive body — mid-frequency hit thump
  const body = ctx.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(400 * pitchMul, now);
  body.frequency.exponentialRampToValueAtTime(120 * pitchMul, now + 0.06);

  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0.18, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

  body.connect(bodyGain);
  bodyGain.connect(dest);
  body.start(now);
  body.stop(now + 0.1);

  // Metallic overtone — short, not ringy
  const metal = ctx.createOscillator();
  metal.type = 'square';
  metal.frequency.setValueAtTime(900 * pitchMul, now);
  metal.frequency.exponentialRampToValueAtTime(350 * pitchMul, now + 0.05);

  const metalGain = ctx.createGain();
  metalGain.gain.setValueAtTime(0.08, now);
  metalGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

  metal.connect(metalGain);
  metalGain.connect(dest);
  metal.start(now);
  metal.stop(now + 0.08);

  // Noise burst — broad impact crack
  const snapDur = 0.035;
  const bufferSize = Math.floor(ctx.sampleRate * snapDur);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(2500 * pitchMul, now);
  filter.frequency.exponentialRampToValueAtTime(800 * pitchMul, now + snapDur);
  filter.Q.value = 1.5;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.18, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + snapDur);

  source.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(dest);
  source.start(now);
  source.stop(now + 0.05);
}
