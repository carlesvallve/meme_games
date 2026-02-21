import { eventBus, Events } from './EventBus.js';

class InputManager {
  constructor() {
    this.keys = {};
    this.enabled = true;
    this.touchStartX = 0;
    this.touchStartY = 0;
    this.minSwipeDistance = 30;
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onTouchStart = this._onTouchStart.bind(this);
    this._onTouchEnd = this._onTouchEnd.bind(this);
  }

  init() {
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('touchstart', this._onTouchStart, { passive: false });
    window.addEventListener('touchend', this._onTouchEnd, { passive: false });
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('touchstart', this._onTouchStart);
    window.removeEventListener('touchend', this._onTouchEnd);
  }

  _onKeyDown(e) {
    // Always allow Escape (e.g. flee combat)
    if (!this.enabled && e.code !== 'Escape') return;
    if (this.keys[e.code]) return;
    this.keys[e.code] = true;
    this._emitKey(e.code);
  }

  _onKeyUp(e) {
    this.keys[e.code] = false;
  }

  /** Check if any movement key is held and return its relative direction, or -1 */
  getHeldMoveDir() {
    if (this.keys['KeyW'] || this.keys['ArrowUp']) return 0;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) return 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) return 2;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) return 3;
    return -1;
  }

  /** Check if a turn key is held and return direction, or 0 */
  getHeldTurnDir() {
    if (this.keys['KeyQ']) return -1;
    if (this.keys['KeyE']) return 1;
    return 0;
  }

  _emitKey(code) {
    switch (code) {
      case 'KeyW': case 'ArrowUp':
        eventBus.emit('input:forward'); break;
      case 'KeyS': case 'ArrowDown':
        eventBus.emit('input:backward'); break;
      case 'KeyA': case 'ArrowLeft':
        eventBus.emit('input:strafeLeft'); break;
      case 'KeyD': case 'ArrowRight':
        eventBus.emit('input:strafeRight'); break;
      case 'KeyQ':
        eventBus.emit('input:turnLeft'); break;
      case 'KeyE':
        eventBus.emit('input:turnRight'); break;
      case 'Space':
        eventBus.emit('input:action'); break;
      case 'Escape':
        eventBus.emit('input:cancel'); break;
      case 'KeyM':
        eventBus.emit('input:map'); break;
      case 'KeyN':
        eventBus.emit('input:cheatDescend'); break;
    }
  }

  _onTouchStart(e) {
    if (!this.enabled) return;
    const touch = e.touches[0];
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
  }

  _onTouchEnd(e) {
    if (!this.enabled) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - this.touchStartX;
    const dy = touch.clientY - this.touchStartY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (Math.max(absDx, absDy) < this.minSwipeDistance) {
      // Tap - check if left or right side for turning
      if (touch.clientX < window.innerWidth * 0.25) {
        eventBus.emit('input:turnLeft');
      } else if (touch.clientX > window.innerWidth * 0.75) {
        eventBus.emit('input:turnRight');
      } else {
        eventBus.emit('input:action');
      }
      return;
    }

    if (absDx > absDy) {
      eventBus.emit(dx > 0 ? 'input:strafeRight' : 'input:strafeLeft');
    } else {
      eventBus.emit(dy > 0 ? 'input:backward' : 'input:forward');
    }
  }
}

export const inputManager = new InputManager();
