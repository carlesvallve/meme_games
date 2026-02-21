type OscType = OscillatorType;

export function playTone(ctx: AudioContext, freq: number, duration: number, type: OscType = 'square', volume = 0.15, dest: AudioNode = ctx.destination): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = volume;
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(dest);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

export function toneSweep(ctx: AudioContext, startFreq: number, endFreq: number, duration: number, type: OscType = 'sine', volume = 0.1, dest: AudioNode = ctx.destination): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(endFreq, ctx.currentTime + duration);
  gain.gain.value = volume;
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(dest);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

export function noiseBurst(ctx: AudioContext, duration = 0.1, volume = 0.1, dest: AudioNode = ctx.destination): void {
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * volume;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = 1;
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  source.connect(gain);
  gain.connect(dest);
  source.start();
}
