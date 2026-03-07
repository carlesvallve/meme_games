/**
 * Minimal audio system for step SFX.
 * Loads grass_step WAVs from /sfx/steps/grass/ and plays random picks
 * with pitch variation — same approach as voxel-engine.
 */

// Excluded: 12, 19 (renamed with _exclude suffix in source files)
const GRASS_STEP_INDICES = [0,1,2,3,4,5,6,7,8,9,10,11,13,14,15,16,17,18];
const grassBuffers: AudioBuffer[] = [];
let grassLoading = false;

function ensureGrassSteps(ctx: AudioContext): void {
  if (grassBuffers.length > 0 || grassLoading) return;
  grassLoading = true;
  for (const i of GRASS_STEP_INDICES) {
    const url = `/sfx/steps/grass/grass_step_${String(i).padStart(2, '0')}.wav`;
    fetch(url)
      .then(r => r.arrayBuffer())
      .then(buf => ctx.decodeAudioData(buf))
      .then(decoded => grassBuffers.push(decoded))
      .catch(() => { /* ignore missing files */ });
  }
}

class AudioSystem {
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

  /** Play a random grass step WAV with slight pitch variation */
  playStep(volume = 0.7): void {
    if (this.muted) return;
    const ctx = this.ensureContext();
    if (!ctx) return;

    ensureGrassSteps(ctx);
    if (grassBuffers.length === 0) return; // still loading

    const buffer = grassBuffers[Math.floor(Math.random() * grassBuffers.length)];
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = 0.85 + Math.random() * 0.3;

    if (volume < 0.99) {
      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);
      source.connect(gain);
    } else {
      source.connect(ctx.destination);
    }
    source.start();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }
}

export const audioSystem = new AudioSystem();
