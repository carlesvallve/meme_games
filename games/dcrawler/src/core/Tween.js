/**
 * Lightweight tween engine inspired by battlecards' animate system.
 * Supports chaining, easing, delays, and callbacks on DOM elements.
 *
 * Usage:
 *   tween(el)
 *     .clear()
 *     .to({ opacity: 1, y: 0, scale: 1 }, 250, ease.easeOut)
 *     .wait(100)
 *     .to({ opacity: 0, y: -30 }, 200, ease.easeInOut)
 *     .call(() => el.remove());
 */

// ---- Easing functions ----
export const ease = {
  linear: t => t,
  easeIn: t => t * t,
  easeOut: t => t * (2 - t),
  easeInOut: t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeOutBack: t => { const s = 1.70158; return --t * t * ((s + 1) * t + s) + 1; },
  easeOutBounce: t => {
    if (t < 1 / 2.75) return 7.5625 * t * t;
    if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
    if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
    return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
  },
  easeOutElastic: t => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t - 0.1) * 5 * Math.PI) + 1;
  },
};

// Default animation duration
export const ANIM_DUR = 250;

// Active tween registry (for clearing)
const _activeTweens = new Map();

/**
 * Create a tween chain for an element.
 * Supports DOM elements and plain objects.
 */
export function tween(target) {
  return new TweenChain(target);
}

class TweenChain {
  constructor(target) {
    this.target = target;
    this.queue = [];
    this._running = false;
  }

  /** Cancel all pending/running animations on this target */
  clear() {
    const existing = _activeTweens.get(this.target);
    if (existing) {
      existing._cancelled = true;
      existing.queue = [];
    }
    _activeTweens.set(this.target, this);
    this._cancelled = false;
    return this;
  }

  /** Animate properties over duration with easing */
  to(props, duration = ANIM_DUR, easeFn = ease.easeInOut) {
    this.queue.push({ type: 'tween', props, duration, ease: easeFn });
    this._maybeStart();
    return this;
  }

  /** Wait for a delay */
  wait(duration) {
    this.queue.push({ type: 'wait', duration });
    this._maybeStart();
    return this;
  }

  /** Execute a callback */
  call(fn) {
    this.queue.push({ type: 'call', fn });
    this._maybeStart();
    return this;
  }

  _maybeStart() {
    if (!this._running) {
      this._running = true;
      this._next();
    }
  }

  _next() {
    if (this._cancelled || this.queue.length === 0) {
      this._running = false;
      if (_activeTweens.get(this.target) === this) {
        _activeTweens.delete(this.target);
      }
      return;
    }

    const step = this.queue.shift();

    if (step.type === 'call') {
      step.fn();
      this._next();
    } else if (step.type === 'wait') {
      setTimeout(() => this._next(), step.duration);
    } else if (step.type === 'tween') {
      this._animate(step);
    }
  }

  _animate({ props, duration, ease: easeFn }) {
    const target = this.target;
    const isDom = target instanceof HTMLElement;

    // Zero-duration: set end values immediately
    if (duration <= 0) {
      for (const key of Object.keys(props)) {
        this._setValue(target, key, props[key], isDom);
      }
      this._next();
      return;
    }

    // Capture start values
    const startValues = {};
    const endValues = {};

    for (const key of Object.keys(props)) {
      endValues[key] = props[key];
      startValues[key] = this._getValue(target, key, isDom);
    }

    const startTime = performance.now();

    const tick = (now) => {
      if (this._cancelled) return;

      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = easeFn(t);

      for (const key of Object.keys(props)) {
        const from = startValues[key];
        const to = endValues[key];
        const current = from + (to - from) * eased;
        this._setValue(target, key, current, isDom);
      }

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        this._next();
      }
    };

    requestAnimationFrame(tick);
  }

  _getValue(target, key, isDom) {
    if (!isDom) {
      return target[key] || 0;
    }

    const style = target.style;
    const computed = getComputedStyle(target);

    switch (key) {
      case 'x': return this._getTransformValue(target, 'translateX');
      case 'y': return this._getTransformValue(target, 'translateY');
      case 'scale': return this._getTransformValue(target, 'scale') || 1;
      case 'scaleX': return this._getTransformValue(target, 'scaleX') || 1;
      case 'scaleY': return this._getTransformValue(target, 'scaleY') || 1;
      case 'rotation': return this._getTransformValue(target, 'rotate');
      case 'opacity': return parseFloat(computed.opacity) || 0;
      case 'width': return parseFloat(computed.width) || 0;
      case 'height': return parseFloat(computed.height) || 0;
      default: return parseFloat(style[key]) || 0;
    }
  }

  _setValue(target, key, value, isDom) {
    if (!isDom) {
      target[key] = value;
      return;
    }

    switch (key) {
      case 'x':
      case 'y':
      case 'scale':
      case 'scaleX':
      case 'scaleY':
      case 'rotation':
        this._setTransformPart(target, key, value);
        break;
      case 'opacity':
        target.style.opacity = value;
        break;
      case 'width':
        target.style.width = `${value}px`;
        break;
      case 'height':
        target.style.height = `${value}px`;
        break;
      default:
        target.style[key] = value;
    }
  }

  _getTransformValue(target, prop) {
    // Store transform parts on the element for tracking
    const parts = target._tweenTransform || { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0 };
    target._tweenTransform = parts;

    switch (prop) {
      case 'translateX': return parts.x;
      case 'translateY': return parts.y;
      case 'scale': return parts.scale;
      case 'scaleX': return parts.scaleX;
      case 'scaleY': return parts.scaleY;
      case 'rotate': return parts.rotation;
      default: return 0;
    }
  }

  _setTransformPart(target, key, value) {
    if (!target._tweenTransform) {
      target._tweenTransform = { x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotation: 0 };
    }
    const t = target._tweenTransform;

    switch (key) {
      case 'x': t.x = value; break;
      case 'y': t.y = value; break;
      case 'scale': t.scale = value; break;
      case 'scaleX': t.scaleX = value; break;
      case 'scaleY': t.scaleY = value; break;
      case 'rotation': t.rotation = value; break;
    }

    const sx = t.scale * t.scaleX;
    const sy = t.scale * t.scaleY;
    target.style.transform = `translate(${t.x}px, ${t.y}px) scale(${sx}, ${sy}) rotate(${t.rotation}rad)`;
  }
}
