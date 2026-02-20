// Play.fun (OpenGameProtocol) integration
// Wires game events to Play.fun points tracking

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

  const refocus = () => {
    if (canvas) canvas.focus();
    const game = window.__GAME__;
    if (game) {
      game.input.keyboard.enabled = true;
      game.input.keyboard.resetKeys();
    }
  };

  // Clicking anywhere on the page reclaims focus
  document.addEventListener('click', refocus);
  // Pointer down on canvas (catches touch too)
  document.addEventListener('pointerdown', refocus);
  // Mouse entering the game area reclaims focus (desktop)
  if (canvas) canvas.addEventListener('mouseenter', refocus);
  // Window regaining focus
  window.addEventListener('focus', refocus);

  // Detect orphaned focus (on body/html = nothing has focus)
  // Poll briefly after DOM changes since SDK widget hides asynchronously
  const observer = new MutationObserver(() => {
    for (const delay of [50, 150, 300]) {
      setTimeout(() => {
        const active = document.activeElement;
        if (!active || active === document.body || active === document.documentElement) {
          refocus();
        }
      }, delay);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
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
