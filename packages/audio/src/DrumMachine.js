// DrumMachine.js — Web Audio API drum sequencer
// Configurable patterns and gain levels. Bypasses Strudel's AudioWorklet.

import { gameState } from '@sttg/game-base';
import { getCtx } from './SfxEngine.js';

// --- Drum sound generators ---

function playKick(ctx, time, gain = 0.3) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, time);
  osc.frequency.exponentialRampToValueAtTime(40, time + 0.1);

  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.setValueAtTime(200, time);

  osc.connect(lpf).connect(g).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.15);
}

function playSnare(ctx, time, gain = 0.08) {
  const bufferSize = Math.floor(ctx.sampleRate * 0.08);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(gain, time);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.07);

  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.setValueAtTime(1000, time);

  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.setValueAtTime(3500, time);

  noise.connect(hpf).connect(lpf).connect(noiseGain).connect(ctx.destination);
  noise.start(time);
  noise.stop(time + 0.08);

  // Body tone
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(200, time);
  osc.frequency.exponentialRampToValueAtTime(80, time + 0.05);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(gain * 0.6, time);
  oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
  osc.connect(oscGain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.06);
}

function playHihat(ctx, time, gain = 0.04, open = false) {
  const dur = open ? 0.08 : 0.025;
  const bufferSize = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + dur);

  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.setValueAtTime(7000, time);

  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.setValueAtTime(12000, time);

  noise.connect(hpf).connect(lpf).connect(g).connect(ctx.destination);
  noise.start(time);
  noise.stop(time + dur);
}

// --- Default patterns ---

const DEFAULT_PATTERNS = {
  normal: [
    { kick: true,  hat: true },
    { hat: true },
    { hat: true },
    { kick: true,  hat: true },
    { hat: true },
    { hat: true },
    { snare: true, hat: true },
    { hat: true },
    { hat: true },
    { hat: true },
    { kick: true,  hat: true },
    { hat: true },
    { hat: true },
    { hat: true },
    { snare: true, hat: true },
    { hat: true },
  ],
  heavy: [
    { kick: true,  hat: true },
    { hat: true },
    { kick: true,  hat: true },
    { hat: true },
    { snare: true, hat: true },
    { hat: true },
    { hat: true },
    { kick: true,  hat: true },
    { kick: true,  hat: true },
    { hat: true },
    { kick: true,  hat: true },
    { hat: true },
    { snare: true, hat: true },
    { hat: true },
    { snare: true, openHat: true },
    { kick: true,  hat: true },
  ],
};

const DEFAULT_TIER_GAINS = {
  3: { kick: 0.25, snare: 0.07, hat: 0.03 },
  4: { kick: 0.30, snare: 0.09, hat: 0.04 },
  5: { kick: 0.35, snare: 0.10, hat: 0.05 },
};

export class DrumMachine {
  /**
   * @param {object} [config]
   * @param {object} [config.patterns] - Pattern map (keys like 'normal', 'heavy')
   * @param {object} [config.tierGains] - Gain levels per tier (3, 4, 5)
   * @param {number} [config.minTier=3] - Minimum tier that activates drums
   * @param {number} [config.heavyTier=4] - Tier at which heavy pattern kicks in
   */
  constructor(config = {}) {
    this._patterns = config.patterns || DEFAULT_PATTERNS;
    this._tierGains = config.tierGains || DEFAULT_TIER_GAINS;
    this._minTier = config.minTier ?? 3;
    this._heavyTier = config.heavyTier ?? 4;
    this._running = false;
    this._timer = null;
    this._step = 0;
    this._pattern = null;
    this._bpm = 125;
    this._gains = this._tierGains[this._minTier] || DEFAULT_TIER_GAINS[3];
    this._ducked = false;
  }

  /**
   * Start the drum machine at a given tier.
   * @param {number} tier - Intensity tier
   * @param {number} bpm - Beats per minute
   */
  start(tier, bpm) {
    this.stop();
    if (tier < this._minTier || gameState.isMuted) return;

    this._bpm = bpm;
    this._pattern = tier >= this._heavyTier ? this._patterns.heavy : this._patterns.normal;
    this._gains = this._tierGains[tier] || this._tierGains[this._minTier] || DEFAULT_TIER_GAINS[3];
    this._step = 0;
    this._running = true;
    this._ducked = false;

    this._scheduleLoop();
  }

  stop() {
    this._running = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  duck() {
    this._ducked = true;
  }

  unduck() {
    this._ducked = false;
  }

  _scheduleLoop() {
    if (!this._running) return;

    const intervalMs = (60 / this._bpm / 4) * 1000;

    this._timer = setTimeout(() => {
      if (!this._running) return;

      if (!gameState.isMuted && !this._ducked) {
        this._playStep();
      }

      this._step = (this._step + 1) % this._pattern.length;
      this._scheduleLoop();
    }, intervalMs);
  }

  _playStep() {
    const step = this._pattern[this._step];
    if (!step) return;

    const ctx = getCtx();
    const now = ctx.currentTime;

    if (step.kick) playKick(ctx, now, this._gains.kick);
    if (step.snare) playSnare(ctx, now, this._gains.snare);
    if (step.hat) playHihat(ctx, now, this._gains.hat, false);
    if (step.openHat) playHihat(ctx, now, this._gains.hat * 1.2, true);
  }
}
