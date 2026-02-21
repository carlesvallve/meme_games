// Placeholder audio manager — will integrate Strudel.cc in Phase 2
class AudioManagerClass {
  constructor() {
    this.muted = false;
    this.ctx = null;
  }

  init() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      // Audio not supported
    }
  }

  playTone(freq = 440, duration = 0.1, type = 'square', volume = 0.15) {
    if (this.muted || !this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.value = volume;
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) { /* ignore */ }
  }

  // SFX presets
  sfxStep() { this.playTone(100, 0.05, 'sine', 0.05); }
  sfxHit() { this.playTone(200, 0.15, 'sawtooth', 0.1); }
  sfxDamage() { this.playTone(80, 0.2, 'square', 0.12); }
  sfxCard() { this.playTone(600, 0.08, 'sine', 0.1); }
  sfxBust() { this.playTone(60, 0.3, 'sawtooth', 0.15); }
  sfxVictory() {
    this.playTone(523, 0.15, 'square', 0.1);
    setTimeout(() => this.playTone(659, 0.15, 'square', 0.1), 150);
    setTimeout(() => this.playTone(784, 0.3, 'square', 0.1), 300);
  }
  sfxDefeat() {
    this.playTone(300, 0.2, 'sawtooth', 0.1);
    setTimeout(() => this.playTone(200, 0.3, 'sawtooth', 0.12), 200);
  }
  sfxChest() {
    this.playTone(400, 0.1, 'sine', 0.1);
    setTimeout(() => this.playTone(600, 0.15, 'sine', 0.1), 100);
  }
  sfxCardAdd() {
    this.playTone(500, 0.08, 'sine', 0.1);
    setTimeout(() => this.playTone(700, 0.08, 'sine', 0.08), 80);
    setTimeout(() => this.playTone(900, 0.12, 'sine', 0.06), 160);
  }
  sfxCardPlay() {
    this.playTone(400, 0.06, 'sine', 0.1);
    setTimeout(() => this.playTone(550, 0.1, 'sine', 0.08), 60);
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }
}

export const audioManager = new AudioManagerClass();
