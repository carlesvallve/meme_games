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

// ── Gamepad constants ────────────────────────────────────────────────
// Standard gamepad mapping (https://w3c.github.io/gamepad/#remapping)
const GP_BUTTON_A = 0;       // Attack (bottom face button)
const GP_BUTTON_B = 1;       // Cancel / interact
const GP_BUTTON_X = 2;       // Interact
const GP_BUTTON_Y = 3;       // Map
const GP_BUTTON_START = 9;   // Pause
const GP_BUTTON_SELECT = 8;  // Camera snap
const GP_STICK_DEADZONE = 0.25;

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

  // ── Gamepad edge-detection (previous frame button state) ──
  private prevGpButtons: boolean[] = [];
  private gpLoggedOnce = false;

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

    // Gamepad connection logging
    window.addEventListener('gamepadconnected', (e) => {
      const gp = (e as GamepadEvent).gamepad;
      console.log(`[Gamepad] Connected: "${gp.id}" (index: ${gp.index}, buttons: ${gp.buttons.length}, axes: ${gp.axes.length}, mapping: "${gp.mapping}")`);
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      const gp = (e as GamepadEvent).gamepad;
      console.log(`[Gamepad] Disconnected: "${gp.id}"`);
    });
  }

  /** Check if a gamepad button was just pressed this frame (edge-triggered). */
  private gpJustPressed(gp: Gamepad, index: number): boolean {
    const pressed = gp.buttons[index]?.pressed ?? false;
    const wasPrev = this.prevGpButtons[index] ?? false;
    return pressed && !wasPrev;
  }

  /** Poll gamepad and merge into queued flags + movement state. */
  private pollGamepad(): { stickX: number; stickY: number } {
    const gamepads = navigator.getGamepads?.();
    if (!gamepads) return { stickX: 0, stickY: 0 };

    // Use first connected gamepad
    let gp: Gamepad | null = null;
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i]) { gp = gamepads[i]; break; }
    }
    if (!gp) return { stickX: 0, stickY: 0 };

    if (!this.gpLoggedOnce) {
      this.gpLoggedOnce = true;
      console.log(`[Gamepad] Polling: "${gp.id}", mapping: "${gp.mapping}", axes: [${gp.axes.map(a => a.toFixed(2)).join(', ')}]`);
    }

    // Edge-triggered buttons → queue flags (like keydown)
    if (this.gpJustPressed(gp, GP_BUTTON_A)) this.attackQueued = true;
    if (this.gpJustPressed(gp, GP_BUTTON_B)) this.interactQueued = true;
    if (this.gpJustPressed(gp, GP_BUTTON_X)) this.interactQueued = true;
    if (this.gpJustPressed(gp, GP_BUTTON_Y)) this.mapKeyQueued = true;
    if (this.gpJustPressed(gp, GP_BUTTON_START)) this.pauseQueued = true;
    if (this.gpJustPressed(gp, GP_BUTTON_SELECT)) this.cameraSnapQueued = true;

    // Save button state for next frame edge detection
    this.prevGpButtons = gp.buttons.map(b => b.pressed);

    // Left stick (axes 0 = X, 1 = Y)
    let stickX = gp.axes[0] ?? 0;
    let stickY = gp.axes[1] ?? 0;
    if (Math.abs(stickX) < GP_STICK_DEADZONE) stickX = 0;
    if (Math.abs(stickY) < GP_STICK_DEADZONE) stickY = 0;

    return { stickX, stickY };
  }

  /**
   * Read current input state. Consumes queued action — call once per gameplay frame.
   * Do NOT call during hitstop so queued attacks survive until the game resumes.
   */
  update(): InputState {
    // Poll gamepad before reading state (queues button presses, returns stick)
    const { stickX, stickY } = this.pollGamepad();

    this.state.forward = !!(this.keys['KeyW'] || this.keys['ArrowUp']) || stickY < -GP_STICK_DEADZONE;
    this.state.backward = !!(this.keys['KeyS'] || this.keys['ArrowDown']) || stickY > GP_STICK_DEADZONE;
    this.state.left = !!(this.keys['KeyA'] || this.keys['ArrowLeft']) || stickX < -GP_STICK_DEADZONE;
    this.state.right = !!(this.keys['KeyD'] || this.keys['ArrowRight']) || stickX > GP_STICK_DEADZONE;
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
