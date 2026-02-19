// AudioManager.js — Strudel BGM controller (generic)
// Handles init, play, stop, duck/unduck for background music patterns.
// Supports adaptive intensity tiers for gameplay BGM.

import { initStrudel, hush } from '@strudel/web';
import { gameState } from '@sttg/game-base';

export class AudioManager {
  /**
   * @param {object} [config]
   * @param {object} [config.tierCpmMap] - Map of tier number to CPM, e.g. { 1: 110, 2: 118, ... }
   * @param {import('./DrumMachine.js').DrumMachine} [config.drumMachine] - DrumMachine instance
   * @param {string} [config.storageKey='audio-muted'] - localStorage key for mute preference
   */
  constructor(config = {}) {
    this._tierCpmMap = config.tierCpmMap || {};
    this._drumMachine = config.drumMachine || null;
    this._storageKey = config.storageKey || 'audio-muted';
    this.initialized = false;
    this.currentMusic = null;
    this._pendingPattern = null;
    this._currentTier = 0;
    this._isAdaptive = false;
    this._adaptivePatternFn = null;
  }

  async init() {
    if (this.initialized) return;
    try {
      // Suppress Strudel's AudioWorklet/getTrigger warnings —
      // Strudel falls back to ScriptProcessor fine, but logs errors on every note
      const origWarn = console.warn;
      const origError = console.error;
      const origLog = console.log;
      const strudelFilter = (s) =>
        typeof s === 'string' && (s.includes('AudioWorklet') || s.includes('getTrigger') || s.includes('audioworklet') || s.includes('[cyclist]'));
      console.warn = (...args) => { if (!strudelFilter(args[0])) origWarn.apply(console, args); };
      console.error = (...args) => { if (!strudelFilter(args[0])) origError.apply(console, args); };
      console.log = (...args) => { if (!strudelFilter(args[0])) origLog.apply(console, args); };
      await initStrudel();
      this.initialized = true;
      // Load mute preference from localStorage
      try {
        const muted = localStorage.getItem(this._storageKey);
        if (muted === 'true') {
          gameState.isMuted = true;
        }
      } catch (e) { /* localStorage not available */ }
      // Play any music that was queued during init
      if (this._pendingPattern && !gameState.isMuted) {
        this.resumeMusic();
      }
    } catch (e) {
      console.warn('[Audio] Strudel init failed:', e);
    }
  }

  playMusic(patternFn) {
    this._isAdaptive = false;
    this._adaptivePatternFn = null;
    this._currentTier = 0;

    if (gameState.isMuted || !this.initialized) {
      this._pendingPattern = patternFn;
      return;
    }
    this.stopMusic();
    this._pendingPattern = patternFn;
    setTimeout(() => {
      try {
        this.currentMusic = patternFn();
      } catch (e) {
        console.warn('[Audio] BGM error:', e);
      }
    }, 100);
  }

  /**
   * Start adaptive music — a pattern function that accepts a tier (1-5).
   * Call setIntensityTier() to change the active tier.
   */
  playAdaptive(patternFn, initialTier = 1) {
    this._isAdaptive = true;
    this._adaptivePatternFn = patternFn;
    this._currentTier = initialTier;
    this._pendingPattern = () => patternFn(initialTier);

    if (gameState.isMuted || !this.initialized) return;

    this.stopMusic();
    setTimeout(() => {
      try {
        this.currentMusic = patternFn(initialTier);
        if (this._drumMachine) {
          const bpm = this._tierCpmMap[initialTier] || 125;
          this._drumMachine.start(initialTier, bpm);
        }
      } catch (e) {
        console.warn('[Audio] Adaptive BGM error:', e);
      }
    }, 100);
  }

  /**
   * Transition to a new intensity tier.
   * Only restarts the pattern if the tier actually changed.
   */
  setIntensityTier(tier) {
    const t = Math.max(1, Math.min(5, tier));
    if (!this._isAdaptive || t === this._currentTier) return;
    this._currentTier = t;
    this._pendingPattern = () => this._adaptivePatternFn(t);

    if (gameState.isMuted || !this.initialized) return;

    try { hush(); } catch (e) { /* noop */ }
    this.currentMusic = null;

    setTimeout(() => {
      try {
        this.currentMusic = this._adaptivePatternFn(t);
        if (this._drumMachine) {
          const bpm = this._tierCpmMap[t] || 125;
          this._drumMachine.start(t, bpm);
        }
      } catch (e) {
        console.warn('[Audio] Tier change error:', e);
      }
    }, 100);
  }

  getCurrentTier() {
    return this._currentTier;
  }

  /** Temporarily silence music (freeze/dialog). Remembers state for resume. */
  duck() {
    if (!this.initialized || this._ducked) return;
    this._ducked = true;
    try { hush(); } catch (e) { /* noop */ }
    this.currentMusic = null;
    if (this._drumMachine) this._drumMachine.duck();
  }

  /** Restore music after duck. */
  unduck() {
    if (!this._ducked) return;
    this._ducked = false;
    if (this._drumMachine) this._drumMachine.unduck();
    if (gameState.isMuted || !this.initialized || !this._pendingPattern) return;
    const fn = this._pendingPattern;
    setTimeout(() => {
      try {
        this.currentMusic = fn();
      } catch (e) {
        console.warn('[Audio] Unduck error:', e);
      }
    }, 100);
  }

  stopMusic() {
    if (!this.initialized) return;
    try { hush(); } catch (e) { /* noop */ }
    this.currentMusic = null;
    if (this._drumMachine) this._drumMachine.stop();
  }

  /** Called when mute is toggled off — resume last pattern */
  resumeMusic() {
    if (this._pendingPattern && !gameState.isMuted && this.initialized) {
      this.stopMusic();
      const fn = this._pendingPattern;
      setTimeout(() => {
        try {
          this.currentMusic = fn();
          // Resume drums if in adaptive mode
          if (this._isAdaptive && this._drumMachine && this._currentTier >= 3) {
            const bpm = this._tierCpmMap[this._currentTier] || 125;
            this._drumMachine.start(this._currentTier, bpm);
          }
        } catch (e) {
          console.warn('[Audio] BGM resume error:', e);
        }
      }, 100);
    }
  }
}
