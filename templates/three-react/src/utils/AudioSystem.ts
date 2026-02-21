type OscType = OscillatorType;

class AudioSystemClass {
  private ctx: AudioContext | null = null;
  private muted = false;

  init(): void {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
    } catch {
      // Audio not supported
    }
  }

  private ensureContext(): AudioContext | null {
    if (!this.ctx) this.init();
    return this.ctx;
  }

  playTone(freq: number, duration: number, type: OscType = 'square', volume = 0.15): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.value = volume;
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // ignore
    }
  }

  toneSweep(startFreq: number, endFreq: number, duration: number, type: OscType = 'sine', volume = 0.1): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(endFreq, ctx.currentTime + duration);
      gain.gain.value = volume;
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // ignore
    }
  }

  noiseBurst(duration = 0.1, volume = 0.1): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    try {
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
      gain.connect(ctx.destination);
      source.start();
    } catch {
      // ignore
    }
  }

  playNote(note: number, octave = 4, duration = 0.2, type: OscType = 'square', volume = 0.1): void {
    // note: 0=C, 1=C#, 2=D, ... 11=B
    const freq = 440 * Math.pow(2, (note - 9 + (octave - 4) * 12) / 12);
    this.playTone(freq, duration, type, volume);
  }

  sfx(type: string): void {
    switch (type) {
      case 'hit':
        this.playTone(200, 0.15, 'sawtooth', 0.1);
        break;
      case 'damage':
        this.playTone(80, 0.2, 'square', 0.12);
        break;
      case 'score':
        this.playTone(600, 0.08, 'sine', 0.1);
        break;
      case 'start':
        this.playTone(523, 0.15, 'square', 0.1);
        setTimeout(() => this.playTone(659, 0.15, 'square', 0.1), 150);
        setTimeout(() => this.playTone(784, 0.3, 'square', 0.1), 300);
        break;
      case 'death':
        this.playTone(300, 0.2, 'sawtooth', 0.1);
        setTimeout(() => this.playTone(200, 0.3, 'sawtooth', 0.12), 200);
        break;
      case 'step':
        this.playTone(100, 0.05, 'sine', 0.05);
        break;
      case 'pickup':
        this.toneSweep(400, 800, 0.15, 'sine', 0.1);
        break;
      default:
        this.playTone(440, 0.1, 'sine', 0.08);
    }
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }
}

export const audioSystem = new AudioSystemClass();
