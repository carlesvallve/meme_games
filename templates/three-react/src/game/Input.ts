export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  action: boolean;
  cancel: boolean;
  pause: boolean;
}

export class Input {
  private keys: Record<string, boolean> = {};
  /**
   * Queued attack flag — set on keydown/tap, only cleared by update().
   * Survives across frames (including hitstop) until the game actually reads it.
   */
  private actionQueued = false;
  private pauseQueued = false;
  private state: InputState = {
    forward: false, backward: false,
    left: false, right: false,
    action: false, cancel: false, pause: false,
  };

  private touchStartX = 0;
  private touchStartY = 0;
  private touchActive = false;
  private readonly minSwipeDistance = 30;

  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onTouchStart: (e: TouchEvent) => void;
  private onTouchEnd: (e: TouchEvent) => void;

  constructor() {
    this.onKeyDown = (e: KeyboardEvent) => {
      this.keys[e.code] = true;
      if (e.code === 'Space' || e.code === 'KeyF') {
        this.actionQueued = true;
        e.preventDefault();
      }
      if (e.code === 'KeyP' || e.code === 'Escape') {
        this.pauseQueued = true;
      }
    };
    this.onKeyUp = (e: KeyboardEvent) => {
      this.keys[e.code] = false;
    };
    this.onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      this.touchStartX = touch.clientX;
      this.touchStartY = touch.clientY;
      this.touchActive = true;
    };
    this.onTouchEnd = (e: TouchEvent) => {
      if (!this.touchActive) return;
      this.touchActive = false;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - this.touchStartX;
      const dy = touch.clientY - this.touchStartY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (Math.max(absDx, absDy) < this.minSwipeDistance) {
        // Tap — queue action
        this.actionQueued = true;
        return;
      }
      if (absDx > absDy) {
        if (dx > 0) this.state.right = true;
        else this.state.left = true;
      } else {
        if (dy > 0) this.state.backward = true;
        else this.state.forward = true;
      }
    };

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('touchstart', this.onTouchStart, { passive: false });
    window.addEventListener('touchend', this.onTouchEnd, { passive: false });
  }

  /**
   * Read current input state. Consumes queued action — call once per gameplay frame.
   * Do NOT call during hitstop so queued attacks survive until the game resumes.
   */
  update(): InputState {
    this.state.forward = !!(this.keys['KeyW'] || this.keys['ArrowUp']);
    this.state.backward = !!(this.keys['KeyS'] || this.keys['ArrowDown']);
    this.state.left = !!(this.keys['KeyA'] || this.keys['ArrowLeft']);
    this.state.right = !!(this.keys['KeyD'] || this.keys['ArrowRight']);
    this.state.action = this.actionQueued;
    this.state.cancel = !!this.keys['Escape'];
    this.state.pause = this.pauseQueued;
    this.actionQueued = false;
    this.pauseQueued = false;
    return { ...this.state };
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('touchstart', this.onTouchStart);
    window.removeEventListener('touchend', this.onTouchEnd);
  }
}
