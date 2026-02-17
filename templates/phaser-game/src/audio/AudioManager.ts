/**
 * Audio manager stub.
 *
 * Integration point for @strudel/web or Phaser's built-in audio.
 * Replace this with actual audio logic when ready.
 */
class AudioManagerClass {
  private muted = false;

  play(_key: string): void {
    if (this.muted) return;
    // TODO: implement audio playback
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }
}

export const AudioManager = new AudioManagerClass();
