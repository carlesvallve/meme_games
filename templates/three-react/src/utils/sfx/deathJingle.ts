/** Ambient synth wave on death — a slow, ethereal wash that swells and fades.
 *  Layered detuned sine/triangle oscillators with filtering for a dreamy pad feel. */
export function sfxDeathJingle(ctx: AudioContext, dest: AudioNode = ctx.destination): void {
  const now = ctx.currentTime;
  const start = now + 0.2;
  const duration = 2.8;

  // Master gain
  const master = ctx.createGain();
  master.gain.value = 0.12;
  master.connect(dest);

  // Low-pass filter — keeps everything warm and non-harsh
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.setValueAtTime(800, start);
  lpf.frequency.linearRampToValueAtTime(400, start + duration); // closes down over time
  lpf.Q.value = 1.5;
  lpf.connect(master);

  // Base chord: A minor voicing (A2, E3, A3, C4) — somber, hollow
  const freqs = [110, 164.81, 220, 261.63];
  const detunes = [-6, 4, -3, 7]; // slight detune for width

  for (let i = 0; i < freqs.length; i++) {
    const freq = freqs[i];

    // Main oscillator — sine for the low, triangle for upper voices
    const osc = ctx.createOscillator();
    osc.type = i < 2 ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(freq, start);
    osc.detune.setValueAtTime(detunes[i], start);
    // Very slow pitch drift downward
    osc.frequency.exponentialRampToValueAtTime(freq * 0.97, start + duration);

    // Detuned pair for chorus/width
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq, start);
    osc2.detune.setValueAtTime(-detunes[i] + 8, start);
    osc2.frequency.exponentialRampToValueAtTime(freq * 0.97, start + duration);

    // Envelope: slow swell in, hold, long fade
    const env = ctx.createGain();
    const vol = i < 2 ? 0.35 : 0.2; // bass voices louder
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(vol, start + 0.8); // slow attack
    env.gain.setValueAtTime(vol, start + duration * 0.4);
    env.gain.exponentialRampToValueAtTime(0.001, start + duration);

    osc.connect(env);
    osc2.connect(env);
    env.connect(lpf);
    osc.start(start);
    osc2.start(start);
    osc.stop(start + duration + 0.1);
    osc2.stop(start + duration + 0.1);
  }

  // Filtered noise layer — adds breathy, wind-like texture
  const noiseLen = ctx.sampleRate * duration;
  const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) {
    noiseData[i] = Math.random() * 2 - 1;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuf;

  const noiseBpf = ctx.createBiquadFilter();
  noiseBpf.type = 'bandpass';
  noiseBpf.frequency.setValueAtTime(500, start);
  noiseBpf.frequency.linearRampToValueAtTime(250, start + duration);
  noiseBpf.Q.value = 2.0;

  const noiseEnv = ctx.createGain();
  noiseEnv.gain.setValueAtTime(0, start);
  noiseEnv.gain.linearRampToValueAtTime(0.03, start + 1.0);
  noiseEnv.gain.exponentialRampToValueAtTime(0.001, start + duration);

  noise.connect(noiseBpf);
  noiseBpf.connect(noiseEnv);
  noiseEnv.connect(master);
  noise.start(start);
  noise.stop(start + duration + 0.1);
}
