// SfxEngine.js — Low-level Web Audio API primitives for game SFX
// All functions check gameState.isMuted before playing.

import { gameState } from '@sttg/game-base';

let audioCtx = null;

/** Get or create the shared AudioContext. */
export function getCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

/**
 * Play a single tone that stops after duration.
 * @param {number} freq - Frequency in Hz
 * @param {OscillatorType} type - Oscillator type (sine, square, sawtooth, triangle)
 * @param {number} duration - Duration in seconds
 * @param {number} [gain=0.3] - Volume (0-1)
 * @param {number} [filterFreq=4000] - Low-pass filter cutoff in Hz
 */
export function playTone(freq, type, duration, gain = 0.3, filterFreq = 4000) {
  if (gameState.isMuted) return;
  const ctx = getCtx();
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);

  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(gain, now);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(filterFreq, now);

  osc.connect(filter).connect(gainNode).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + duration);
}

/**
 * Play a sequence of tones.
 * @param {number[]} notes - Array of frequencies in Hz
 * @param {OscillatorType} type - Oscillator type
 * @param {number} noteDuration - Duration of each note in seconds
 * @param {number} gap - Time between note starts in seconds
 * @param {number} [gain=0.3] - Volume (0-1)
 * @param {number} [filterFreq=4000] - Low-pass filter cutoff in Hz
 */
export function playNotes(notes, type, noteDuration, gap, gain = 0.3, filterFreq = 4000) {
  if (gameState.isMuted) return;
  const ctx = getCtx();
  const now = ctx.currentTime;

  notes.forEach((freq, i) => {
    const start = now + i * gap;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(gain, start);
    gainNode.gain.exponentialRampToValueAtTime(0.001, start + noteDuration);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, start);

    osc.connect(filter).connect(gainNode).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + noteDuration);
  });
}

/**
 * Play a noise burst (for clicks, whooshes, impacts).
 * @param {number} duration - Duration in seconds
 * @param {number} [gain=0.2] - Volume (0-1)
 * @param {number} [lpfFreq=4000] - Low-pass filter cutoff
 * @param {number} [hpfFreq=0] - High-pass filter cutoff (0 = disabled)
 */
export function playNoise(duration, gain = 0.2, lpfFreq = 4000, hpfFreq = 0) {
  if (gameState.isMuted) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(gain, now);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.setValueAtTime(lpfFreq, now);

  if (hpfFreq > 0) {
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.setValueAtTime(hpfFreq, now);
    source.connect(hpf).connect(lpf).connect(gainNode).connect(ctx.destination);
  } else {
    source.connect(lpf).connect(gainNode).connect(ctx.destination);
  }

  source.start(now);
  source.stop(now + duration);
}
