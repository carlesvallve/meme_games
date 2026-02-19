// sfx.js — Game-specific SFX for Slop Survivor
// Low-level primitives (playTone, playNotes, playNoise, getCtx) come from @sttg/audio

import { gameState } from '../core/GameState.js';
import { getCtx, playTone, playNotes, playNoise } from '@sttg/audio';

// --- Game SFX ---

// Player auto-attack — quick laser pew
export function attackSfx() {
  if (gameState.isMuted) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(220, now + 0.08);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.15, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(3000, now);
  osc.connect(f).connect(g).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.1);
}

// Manual laser fire — bright zap
export function laserSfx() {
  if (gameState.isMuted) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(1200, now);
  osc.frequency.exponentialRampToValueAtTime(400, now + 0.06);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.18, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(5000, now);
  osc.connect(f).connect(g).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.08);
}

// Enemy hit — short thwack (projectile impact)
export function enemyHitSfx() {
  if (gameState.isMuted) return;
  playNoise(0.06, 0.12, 2000, 200);
  playTone(130.81, 'square', 0.05, 0.1, 800);
}

// Enemy death — wet PUFFF splat (bigger, more satisfying)
export function enemyDeathSfx() {
  if (gameState.isMuted) return;
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Noise burst — the "puff"
  const bufSize = Math.floor(ctx.sampleRate * 0.25);
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.22, now);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.setValueAtTime(1800, now);
  lpf.frequency.exponentialRampToValueAtTime(300, now + 0.15);
  noise.connect(lpf).connect(ng).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + 0.25);

  // Low thump — body impact
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(100, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.15);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.2, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  osc.connect(g).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.2);
}

// XP gem pickup — sparkle chime
export function xpPickupSfx() {
  if (gameState.isMuted) return;
  playNotes([659.25, 987.77], 'square', 0.1, 0.06, 0.2, 5000);
}

// Power-up collect — ascending whoosh
export function powerUpSfx() {
  if (gameState.isMuted) return;
  playNotes([261.63, 329.63, 440, 523.25, 659.25], 'square', 0.08, 0.05, 0.2, 5000);
}

// Player hit — crunchy impact
export function playerHitSfx() {
  if (gameState.isMuted) return;
  playNoise(0.15, 0.25, 1200, 100);
  playTone(65.41, 'square', 0.15, 0.25, 600);
}

// Boss spawn — deep ominous horn
export function bossSpawnSfx() {
  if (gameState.isMuted) return;
  const ctx = getCtx();
  const now = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(55, now);
  osc.frequency.linearRampToValueAtTime(65.41, now + 0.6);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.25, now + 0.15);
  g.gain.setValueAtTime(0.25, now + 0.4);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(400, now);

  osc.connect(f).connect(g).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.8);

  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(32.7, now);
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.2, now);
  g2.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
  osc2.connect(g2).connect(ctx.destination);
  osc2.start(now);
  osc2.stop(now + 0.8);
}

// Boss charge — aggressive swoosh with rising pitch
export function bossChargeSfx() {
  if (gameState.isMuted) return;
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Noise swoosh — bandpass sweep low→high
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.setValueAtTime(3, now);
  bp.frequency.setValueAtTime(200, now);
  bp.frequency.exponentialRampToValueAtTime(2500, now + 0.25);
  bp.frequency.exponentialRampToValueAtTime(800, now + 0.45);

  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0, now);
  ng.gain.linearRampToValueAtTime(0.12, now + 0.05);
  ng.gain.setValueAtTime(0.12, now + 0.15);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

  noise.connect(bp).connect(ng).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + 0.5);

  // Low rumble undertone
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(60, now);
  osc.frequency.linearRampToValueAtTime(90, now + 0.3);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.08, now);
  og.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(200, now);
  osc.connect(lp).connect(og).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.4);
}

// Boss killed — heavy satisfying explosion with victorious chime
export function bossKillSfx() {
  if (gameState.isMuted) return;
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Big boom — noise burst with deep lowpass sweep
  const bufSize = Math.floor(ctx.sampleRate * 0.8);
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize * 0.5);
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.35, now);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.setValueAtTime(2500, now);
  lpf.frequency.exponentialRampToValueAtTime(150, now + 0.5);
  noise.connect(lpf).connect(ng).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + 0.8);

  // Deep sub rumble
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(80, now);
  sub.frequency.exponentialRampToValueAtTime(25, now + 0.6);
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0.3, now);
  sg.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
  sub.connect(sg).connect(ctx.destination);
  sub.start(now);
  sub.stop(now + 0.6);

  // Victory chime — ascending notes after the boom
  const chimeDelay = 0.25;
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => {
    const t = now + chimeDelay + i * 0.08;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(5000, t);
    osc.connect(f).connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.25);
  });
}

// Commit blast — punchy explosion with satisfying crunch
export function blastSfx() {
  if (gameState.isMuted) return;
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Big noise burst
  const bufSize = Math.floor(ctx.sampleRate * 0.5);
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufSize * 0.6);
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.3, now);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.setValueAtTime(3000, now);
  lpf.frequency.exponentialRampToValueAtTime(200, now + 0.3);
  noise.connect(lpf).connect(ng).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + 0.5);

  // Sub thump
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(90, now);
  sub.frequency.exponentialRampToValueAtTime(30, now + 0.3);
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0.25, now);
  sg.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  sub.connect(sg).connect(ctx.destination);
  sub.start(now);
  sub.stop(now + 0.35);

  // Metallic crunch
  const crunch = ctx.createOscillator();
  crunch.type = 'sawtooth';
  crunch.frequency.setValueAtTime(350, now);
  crunch.frequency.exponentialRampToValueAtTime(60, now + 0.15);
  const cg = ctx.createGain();
  cg.gain.setValueAtTime(0.15, now);
  cg.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  const cf = ctx.createBiquadFilter();
  cf.type = 'lowpass';
  cf.frequency.setValueAtTime(1800, now);
  crunch.connect(cf).connect(cg).connect(ctx.destination);
  crunch.start(now);
  crunch.stop(now + 0.2);
}

// Health pickup — warm ascending chime
export function healSfx() {
  if (gameState.isMuted) return;
  playNotes([440, 554.37, 659.25], 'sine', 0.1, 0.06, 0.18, 4000);
}

// Level up — triumphant fanfare
export function levelUpSfx() {
  if (gameState.isMuted) return;
  playNotes([523.25, 659.25, 783.99, 1046.5], 'square', 0.12, 0.08, 0.25, 5000);
}

// Button click — soft pop
export function clickSfx() {
  if (gameState.isMuted) return;
  playTone(523.25, 'sine', 0.06, 0.15, 5000);
}

// UI navigate / card hover — soft high blip
export function navSfx() {
  if (gameState.isMuted) return;
  playTone(880, 'sine', 0.04, 0.1, 4000);
}

// Ship explosion — big boom with noise burst and low rumble
export function explosionSfx() {
  if (gameState.isMuted) return;
  const ctx = getCtx();
  const now = ctx.currentTime;

  const bufferSize = Math.floor(ctx.sampleRate * 0.6);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const boomGain = ctx.createGain();
  boomGain.gain.setValueAtTime(0.35, now);
  boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  const boomLpf = ctx.createBiquadFilter();
  boomLpf.type = 'lowpass';
  boomLpf.frequency.setValueAtTime(2000, now);
  boomLpf.frequency.exponentialRampToValueAtTime(200, now + 0.4);
  source.connect(boomLpf).connect(boomGain).connect(ctx.destination);
  source.start(now);
  source.stop(now + 0.6);

  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(60, now);
  sub.frequency.exponentialRampToValueAtTime(20, now + 0.5);
  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0.3, now);
  subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  sub.connect(subGain).connect(ctx.destination);
  sub.start(now);
  sub.stop(now + 0.5);

  const crunch = ctx.createOscillator();
  crunch.type = 'sawtooth';
  crunch.frequency.setValueAtTime(400, now);
  crunch.frequency.exponentialRampToValueAtTime(50, now + 0.3);
  const crunchGain = ctx.createGain();
  crunchGain.gain.setValueAtTime(0.2, now);
  crunchGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  const crunchLpf = ctx.createBiquadFilter();
  crunchLpf.type = 'lowpass';
  crunchLpf.frequency.setValueAtTime(1500, now);
  crunch.connect(crunchLpf).connect(crunchGain).connect(ctx.destination);
  crunch.start(now);
  crunch.stop(now + 0.3);
}

// Ship engines on — sci-fi swoosh rising to a whine
export function enginesOnSfx() {
  if (gameState.isMuted) return;
  const ctx = getCtx();
  const now = ctx.currentTime;

  const bufSize = Math.floor(ctx.sampleRate * 1.2);
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) d[i] = Math.random() * 2 - 1;

  const swoosh = ctx.createBufferSource();
  swoosh.buffer = buf;

  const swooshHpf = ctx.createBiquadFilter();
  swooshHpf.type = 'highpass';
  swooshHpf.frequency.setValueAtTime(200, now);
  swooshHpf.frequency.exponentialRampToValueAtTime(800, now + 0.6);

  const swooshLpf = ctx.createBiquadFilter();
  swooshLpf.type = 'lowpass';
  swooshLpf.frequency.setValueAtTime(500, now);
  swooshLpf.frequency.exponentialRampToValueAtTime(4000, now + 0.5);
  swooshLpf.frequency.exponentialRampToValueAtTime(1500, now + 1.0);

  const swooshGain = ctx.createGain();
  swooshGain.gain.setValueAtTime(0, now);
  swooshGain.gain.linearRampToValueAtTime(0.06, now + 0.15);
  swooshGain.gain.setValueAtTime(0.06, now + 0.4);
  swooshGain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

  swoosh.connect(swooshHpf).connect(swooshLpf).connect(swooshGain).connect(ctx.destination);
  swoosh.start(now);
  swoosh.stop(now + 1.2);

  const whine = ctx.createOscillator();
  whine.type = 'sine';
  whine.frequency.setValueAtTime(150, now);
  whine.frequency.exponentialRampToValueAtTime(600, now + 0.5);
  whine.frequency.exponentialRampToValueAtTime(350, now + 1.0);

  const whineGain = ctx.createGain();
  whineGain.gain.setValueAtTime(0, now);
  whineGain.gain.linearRampToValueAtTime(0.03, now + 0.2);
  whineGain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);

  whine.connect(whineGain).connect(ctx.destination);
  whine.start(now);
  whine.stop(now + 1.0);
}

// --- Continuous engine sound system ---

let engineNoiseSource = null;
let engineNoiseGain = null;
let engineNoiseLpf = null;
let engineNoiseHpf = null;
let engineWhistle = null;
let engineWhistleGain = null;
let engineWhistleFilter = null;
let engineRunning = false;

export function startEngine() {
  if (gameState.isMuted || engineRunning) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  engineRunning = true;

  const bufferSize = ctx.sampleRate * 2;
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    noiseData[i] = Math.random() * 2 - 1;
  }

  engineNoiseSource = ctx.createBufferSource();
  engineNoiseSource.buffer = noiseBuffer;
  engineNoiseSource.loop = true;

  engineNoiseHpf = ctx.createBiquadFilter();
  engineNoiseHpf.type = 'highpass';
  engineNoiseHpf.frequency.setValueAtTime(400, now);
  engineNoiseHpf.Q.setValueAtTime(0.5, now);

  engineNoiseLpf = ctx.createBiquadFilter();
  engineNoiseLpf.type = 'lowpass';
  engineNoiseLpf.frequency.setValueAtTime(1200, now);
  engineNoiseLpf.Q.setValueAtTime(1.0, now);

  engineNoiseGain = ctx.createGain();
  engineNoiseGain = ctx.createGain();
  engineNoiseGain.gain.setValueAtTime(0, now);
  engineNoiseGain.gain.linearRampToValueAtTime(0.00275, now + 0.5);

  engineNoiseSource.connect(engineNoiseHpf).connect(engineNoiseLpf)
    .connect(engineNoiseGain).connect(ctx.destination);
  engineNoiseSource.start();

  engineWhistle = ctx.createOscillator();
  engineWhistle.type = 'sine';
  engineWhistle.frequency.setValueAtTime(280, now);

  engineWhistleFilter = ctx.createBiquadFilter();
  engineWhistleFilter.type = 'bandpass';
  engineWhistleFilter.frequency.setValueAtTime(300, now);
  engineWhistleFilter.Q.setValueAtTime(5, now);

  engineWhistleGain = ctx.createGain();
  engineWhistleGain.gain.setValueAtTime(0, now);
  engineWhistleGain.gain.linearRampToValueAtTime(0.00165, now + 0.5);

  engineWhistle.connect(engineWhistleFilter).connect(engineWhistleGain)
    .connect(ctx.destination);
  engineWhistle.start();
}

export function updateEngine(speedRatio) {
  if (!engineRunning || !engineNoiseSource) return;
  if (gameState.isMuted) { stopEngine(); return; }
  const ctx = getCtx();
  const now = ctx.currentTime;

  const noiseVol = 0.00275 + speedRatio * 0.011;
  engineNoiseGain.gain.setTargetAtTime(noiseVol, now, 0.08);
  const hpf = 400 - speedRatio * 200;
  engineNoiseHpf.frequency.setTargetAtTime(hpf, now, 0.08);
  const lpf = 1200 + speedRatio * 3000;
  engineNoiseLpf.frequency.setTargetAtTime(lpf, now, 0.08);

  const whistleFreq = 280 + speedRatio * 420;
  engineWhistle.frequency.setTargetAtTime(whistleFreq, now, 0.08);
  const whistleVol = 0.00165 + speedRatio * 0.0044;
  engineWhistleGain.gain.setTargetAtTime(whistleVol, now, 0.08);
  engineWhistleFilter.frequency.setTargetAtTime(whistleFreq, now, 0.08);
}

let enginePaused = false;
let _savedNoiseVol = 0;
let _savedWhistleVol = 0;

export function pauseEngine() {
  if (!engineRunning || enginePaused) return;
  enginePaused = true;
  const ctx = getCtx();
  const now = ctx.currentTime;
  if (engineNoiseGain) {
    _savedNoiseVol = engineNoiseGain.gain.value;
    engineNoiseGain.gain.setTargetAtTime(0, now, 0.15);
  }
  if (engineWhistleGain) {
    _savedWhistleVol = engineWhistleGain.gain.value;
    engineWhistleGain.gain.setTargetAtTime(0, now, 0.15);
  }
}

export function resumeEngine() {
  if (!engineRunning || !enginePaused) return;
  enginePaused = false;
  const ctx = getCtx();
  const now = ctx.currentTime;
  if (engineNoiseGain) {
    engineNoiseGain.gain.setTargetAtTime(_savedNoiseVol, now, 0.15);
  }
  if (engineWhistleGain) {
    engineWhistleGain.gain.setTargetAtTime(_savedWhistleVol, now, 0.15);
  }
}

export function stopEngine() {
  if (!engineRunning) return;
  engineRunning = false;
  const ctx = getCtx();
  const now = ctx.currentTime;

  try {
    if (engineNoiseGain) engineNoiseGain.gain.setTargetAtTime(0, now, 0.2);
    if (engineWhistleGain) engineWhistleGain.gain.setTargetAtTime(0, now, 0.2);
    setTimeout(() => {
      try { if (engineNoiseSource) engineNoiseSource.stop(); } catch (e) { /* */ }
      try { if (engineWhistle) engineWhistle.stop(); } catch (e) { /* */ }
      engineNoiseSource = null;
      engineNoiseGain = null;
      engineNoiseLpf = null;
      engineNoiseHpf = null;
      engineWhistle = null;
      engineWhistleGain = null;
      engineWhistleFilter = null;
    }, 500);
  } catch (e) {
    engineNoiseSource = null;
    engineNoiseGain = null;
    engineNoiseLpf = null;
    engineNoiseHpf = null;
    engineWhistle = null;
    engineWhistleGain = null;
    engineWhistleFilter = null;
  }
}

// Title screen appear — rising swoosh
export function titleAppearSfx() {
  if (gameState.isMuted) return;
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Filtered noise swoosh — rising bandpass sweep
  const bufSize = Math.floor(ctx.sampleRate * 0.8);
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;

  const bpf = ctx.createBiquadFilter();
  bpf.type = 'bandpass';
  bpf.frequency.setValueAtTime(200, now);
  bpf.frequency.exponentialRampToValueAtTime(3000, now + 0.5);
  bpf.frequency.exponentialRampToValueAtTime(1500, now + 0.7);
  bpf.Q.setValueAtTime(2, now);

  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0, now);
  ng.gain.linearRampToValueAtTime(0.12, now + 0.15);
  ng.gain.setValueAtTime(0.12, now + 0.3);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

  noise.connect(bpf).connect(ng).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + 0.8);

  // Subtle tonal sweep underneath
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, now);
  osc.frequency.exponentialRampToValueAtTime(800, now + 0.4);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0, now);
  og.gain.linearRampToValueAtTime(0.04, now + 0.1);
  og.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  osc.connect(og).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.5);
}

// Title screen dismiss — falling swoosh
export function titleDismissSfx() {
  if (gameState.isMuted) return;
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Filtered noise swoosh — falling bandpass sweep
  const bufSize = Math.floor(ctx.sampleRate * 0.6);
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;

  const bpf = ctx.createBiquadFilter();
  bpf.type = 'bandpass';
  bpf.frequency.setValueAtTime(2500, now);
  bpf.frequency.exponentialRampToValueAtTime(200, now + 0.4);
  bpf.Q.setValueAtTime(2, now);

  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.12, now);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

  noise.connect(bpf).connect(ng).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + 0.6);

  // Tonal sweep down
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.exponentialRampToValueAtTime(100, now + 0.35);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.05, now);
  og.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  osc.connect(og).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.4);
}

// Player death — ominous descending notes (plays after explosion)
export function deathSfx() {
  if (gameState.isMuted) return;
  playNotes([293.66, 246.94, 196, 164.81, 130.81], 'square', 0.3, 0.15, 0.2, 1500);
}

// Footstep — soft thud with slight pitch variation
export function footstepSfx() {
  if (gameState.isMuted) return;
  const ctx = getCtx();
  const now = ctx.currentTime;

  const freq = 150 + Math.random() * 50;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(60, now + 0.06);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.11, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);

  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.setValueAtTime(450, now);

  osc.connect(lpf).connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.08);

  const bufSize = Math.floor(ctx.sampleRate * 0.03);
  const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.04, now);
  ng.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
  const nf = ctx.createBiquadFilter();
  nf.type = 'lowpass';
  nf.frequency.setValueAtTime(800, now);
  noise.connect(nf).connect(ng).connect(ctx.destination);
  noise.start(now);
  noise.stop(now + 0.03);
}

// Typewriter blip — tiny high-pitched pop, varies pitch slightly each call
export function typeBlipSfx() {
  if (gameState.isMuted) return;
  const ctx = getCtx();
  const now = ctx.currentTime;

  const freq = 800 + Math.random() * 200;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(freq, now);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.06, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(2500, now);

  osc.connect(filter).connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.04);
}

// Missile launch — whooshy rising tone
export function missileSfx() {
  if (gameState.isMuted) return;
  const ctx = getCtx();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, now);
  osc.frequency.exponentialRampToValueAtTime(600, now + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.12, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(2500, now);
  osc.connect(f).connect(g).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.15);
}

// Mine drop — low thunk
export function mineDropSfx() {
  if (gameState.isMuted) return;
  playTone(100, 'sine', 0.08, 0.15, 600);
}

// Mine/missile explosion — punchy boom with low thump + noise crack
export function smallExplosionSfx() {
  if (gameState.isMuted) return;
  const ctx = getCtx();
  const now = ctx.currentTime;

  // Low thump
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, now);
  osc.frequency.exponentialRampToValueAtTime(30, now + 0.25);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.3, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  osc.connect(g).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.3);

  // Noise crack
  playNoise(0.2, 0.25, 2500, 200);
}
