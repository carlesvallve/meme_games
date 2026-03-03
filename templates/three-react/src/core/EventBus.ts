// Template scaffolding — part of the @sttg/game-base contract.
// Not used by the dungeon-crawler example (which uses zustand for all state/events),
// but kept so new games scaffolded from this template have a ready-made event bus.
export { EventBus, eventBus } from '@sttg/game-base';

export const Events = {
  GAME_START: 'game:start',
  GAME_OVER: 'game:over',
  GAME_PAUSE: 'game:pause',
  GAME_RESUME: 'game:resume',
  SCORE_CHANGE: 'score:change',
  HP_CHANGE: 'hp:change',
};
