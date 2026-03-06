export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  attack: boolean;
  cancel: boolean;
  pause: boolean;
  cameraSnap: boolean;
  seppuku: boolean;
  /** M key — return to overworld map */
  mapKey: boolean;
  /** E key — interact (dungeon enter, etc.) */
  interact: boolean;
}

export class Input {
  private keys: Record<string, boolean> = {};
  /**
   * Queued attack flag — set on keydown/tap, only cleared by update().
   * Survives across frames (including hitstop) until the game actually reads it.
   */
  private attackQueued = false;
  private pauseQueued = false;
  private cameraSnapQueued = false;
  private seppukuQueued = false;
  private mapKeyQueued = false;
  private interactQueued = false;
  private state: InputState = {
    forward: false, backward: false,
    left: false, right: false,
    attack: false, cancel: false, pause: false,
    cameraSnap: false, seppuku: false, mapKey: false,
    interact: false,
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
      if (e.code === 'Space') {
        this.attackQueued = true;
        e.preventDefault();
      }
      if (e.code === 'KeyP' || e.code === 'Escape') {
        this.pauseQueued = true;
      }
      if (e.code === 'Tab') {
        this.cameraSnapQueued = true;
        e.preventDefault();
      }
      if (e.code === 'Digit0') {
        this.seppukuQueued = true;
      }
      if (e.code === 'KeyM') {
        this.mapKeyQueued = true;
      }
      if (e.code === 'KeyE') {
        this.interactQueued = true;
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
        // Tap on mobile — no action (tap is used for click-to-move pathfinding)
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
    this.state.attack = this.attackQueued;
    this.state.cancel = !!this.keys['Escape'];
    this.state.pause = this.pauseQueued;
    this.state.cameraSnap = this.cameraSnapQueued;
    this.state.seppuku = this.seppukuQueued;
    this.state.mapKey = this.mapKeyQueued;
    this.state.interact = this.interactQueued;
    this.attackQueued = false;
    this.pauseQueued = false;
    this.cameraSnapQueued = false;
    this.seppukuQueued = false;
    this.mapKeyQueued = false;
    this.interactQueued = false;
    return { ...this.state };
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('touchstart', this.onTouchStart);
    window.removeEventListener('touchend', this.onTouchEnd);
  }
}
