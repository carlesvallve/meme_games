export { EventBus, eventBus } from '@sttg/game-base';

export const Events = {
  // Game lifecycle
  GAME_START: 'game:start',
  GAME_OVER: 'game:over',
  GAME_RESTART: 'game:restart',

  // Player
  PLAYER_MOVE: 'player:move',
  PLAYER_JUMP: 'player:jump',
  PLAYER_DIED: 'player:died',

  // Score
  SCORE_CHANGED: 'score:changed',

  // Particles
  PARTICLES_EMIT: 'particles:emit',

  // Audio (used by /add-audio)
  AUDIO_INIT: 'audio:init',
  MUSIC_MENU: 'music:menu',
  MUSIC_GAMEPLAY: 'music:gameplay',
  MUSIC_GAMEOVER: 'music:gameover',
  MUSIC_STOP: 'music:stop',
};
