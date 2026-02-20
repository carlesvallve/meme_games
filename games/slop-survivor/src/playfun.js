// Play.fun (OpenGameProtocol) integration
// Wires game events to Play.fun points tracking.
//
// Points flow:
//   SCORE_CHANGED -> sdk.addPoints(delta)  (cached locally, no modal)
//   GAME_OVER     -> sdk.savePoints()      (persists to server, may show modal)
//   beforeunload  -> sdk.savePoints()      (silent fallback)
//
// Keyboard focus workaround (watchFocus):
//   The Play.fun SDK renders UI via iframes/overlays that steal keyboard focus
//   from the Phaser canvas. When a modal closes, focus lands on document.body
//   and Phaser stops receiving keyboard input. On the Play.fun dashboard this is
//   handled by their iframe wrapper, but when the game runs standalone (its own
//   page), we must recover focus ourselves.
//
//   Solution: listen for `focusout` on the canvas — when focus is "orphaned"
//   (activeElement is body/documentElement), refocus the canvas and re-enable
//   Phaser's keyboard plugin. Also refocus on `mouseenter` so hovering back
//   over the game area restores input immediately.

import { eventBus, Events } from './core/EventBus.js';

const GAME_ID = 'affc20dc-2947-4909-b498-7aae820bec9b';

let sdk = null;
let initialized = false;
let lastScore = 0;

export async function initPlayFun() {
  if (typeof OpenGameSDK === 'undefined' && typeof PlayFunSDK === 'undefined') {
    console.warn('[PlayFun] SDK not loaded — skipping');
    return;
  }

  const SDKClass = typeof PlayFunSDK !== 'undefined' ? PlayFunSDK : OpenGameSDK;
  sdk = new SDKClass({
    gameId: GAME_ID,
    ui: { usePointsWidget: true },
  });

  await sdk.init();
  initialized = true;
  console.log('[PlayFun] SDK initialized');

  wireEvents();
  watchFocus();
}

// Re-focus game canvas and Phaser keyboard after Play.fun modals steal focus
function watchFocus() {
  const canvas = document.querySelector('canvas');
  if (!canvas) return;
  canvas.setAttribute('tabindex', '0');

  const refocus = () => {
    canvas.focus({ preventScroll: true });
    const game = window.__GAME__;
    if (game?.input?.keyboard) game.input.keyboard.enabled = true;
  };

  // When focus leaves canvas (SDK widget/iframe steals it), reclaim after a short delay
  // The delay lets the SDK modal open; once it closes, focus returns here
  canvas.addEventListener('focusout', () => {
    setTimeout(() => {
      const active = document.activeElement;
      if (active === document.body || active === document.documentElement) {
        refocus();
      }
    }, 200);
  });

  // Mouse entering game area reclaims focus (covers modal-close-then-hover)
  canvas.addEventListener('mouseenter', refocus);
}

function wireEvents() {
  // Award points on score changes (compute delta since payload has no delta)
  eventBus.on(Events.SCORE_CHANGED, ({ score }) => {
    if (!sdk || !initialized) return;
    const delta = score - lastScore;
    if (delta > 0) {
      sdk.addPoints(delta);
    }
    lastScore = score;
  });

  // Save points on game over
  eventBus.on(Events.GAME_OVER, () => {
    if (sdk && initialized) {
      sdk.savePoints();
    }
  });

  // Reset tracking on game restart
  eventBus.on(Events.GAME_START, () => {
    lastScore = 0;
  });

  // Save on page unload (silent fallback)
  window.addEventListener('beforeunload', () => {
    if (sdk && initialized) {
      sdk.savePoints();
    }
  });
}
