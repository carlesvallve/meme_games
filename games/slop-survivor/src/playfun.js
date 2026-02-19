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

  // Auto-save every 30 seconds
  setInterval(() => {
    if (sdk && initialized) {
      sdk.savePoints();
    }
  }, 30000);

  // Save on page unload
  window.addEventListener('beforeunload', () => {
    if (sdk && initialized) {
      sdk.savePoints();
    }
  });
}
