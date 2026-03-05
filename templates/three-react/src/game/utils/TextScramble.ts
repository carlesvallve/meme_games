/**
 * TextScramble — framework-agnostic left-to-right text scramble animator.
 * Usable from React (via useTextScramble hook) or plain JS (Three.js labels, etc.).
 */

const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#@&%!?';

export class TextScramble {
  private prev = '';
  private target = '';
  private startTime = 0;
  private duration: number;
  private frameId = 0;
  private _display = '';
  /** Called each frame with the current scrambled string. */
  onChange: ((text: string) => void) | null = null;

  constructor(initial = '', duration = 600) {
    this.prev = initial;
    this.target = initial;
    this._display = initial;
    this.duration = duration;
  }

  /** Current display string. */
  get display(): string { return this._display; }

  /** Whether a scramble animation is currently running. */
  get running(): boolean { return this.frameId !== 0; }

  /** Set a new target string. If different from current, starts the scramble animation. */
  scrambleTo(text: string): void {
    if (text === this.target) return;
    this.cancel();
    this.prev = this._display; // start from whatever is currently displayed
    this.target = text;
    this.startTime = performance.now();
    this.frameId = requestAnimationFrame(this.tick);
  }

  /** Cancel any running animation and snap to the current target. */
  cancel(): void {
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    }
  }

  /** Stop and clean up. */
  dispose(): void {
    this.cancel();
    this.onChange = null;
  }

  private tick = (): void => {
    const elapsed = performance.now() - this.startTime;
    const maxLen = Math.max(this.prev.length, this.target.length);
    const waveSpeed = this.duration * 0.4 / Math.max(maxLen, 1);
    const scrambleDur = this.duration * 0.3;

    let result = '';
    let allDone = true;

    for (let i = 0; i < maxLen; i++) {
      const waveStart = i * waveSpeed;
      const lockTime = waveStart + scrambleDur;
      const targetChar = this.target[i] ?? '';
      const prevChar = this.prev[i] ?? '';
      const isSpace = targetChar === ' ' && (prevChar === ' ' || prevChar === '');

      if (elapsed >= lockTime) {
        result += targetChar;
      } else if (elapsed >= waveStart) {
        allDone = false;
        result += isSpace ? ' ' : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
      } else {
        allDone = false;
        result += prevChar;
      }
    }

    this._display = result;
    this.onChange?.(result);

    if (allDone) {
      this.frameId = 0;
      this.prev = this.target;
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };
}
