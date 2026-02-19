export { EventBus, eventBus } from '@sttg/game-base';
import { AudioEvents } from '@sttg/audio';

export const Events = {
  // Game lifecycle
  GAME_START: 'game:start',
  GAME_OVER: 'game:over',
  GAME_RESTART: 'game:restart',

  // Player
  PLAYER_MOVE: 'player:move',
  PLAYER_HIT: 'player:hit',
  PLAYER_DIED: 'player:died',
  PLAYER_HEAL: 'player:heal',
  PLAYER_INVULNERABLE: 'player:invulnerable',

  // Enemies
  ENEMY_KILLED: 'enemy:killed',
  ENEMY_SPAWN: 'enemy:spawn',

  // Power-ups
  POWERUP_COLLECTED: 'powerup:collected',
  POWERUP_SPAWN: 'powerup:spawn',
  POWERUP_CHOSEN: 'powerup:chosen',

  // XP / Leveling
  XP_COLLECTED: 'xp:collected',
  XP_CHANGED: 'xp:changed',
  LEVEL_UP: 'level:up',
  WEAPON_UPGRADE: 'weapon:upgrade',

  // Boss
  BOSS_SPAWN: 'boss:spawn',
  BOSS_KILLED: 'boss:killed',
  BOSS_CHARGE: 'boss:charge',

  // Enemy behaviors
  ENEMY_SPLIT: 'enemy:split',

  // Wave
  WAVE_START: 'wave:start',
  WAVE_COMPLETE: 'wave:complete',

  // Score
  SCORE_CHANGED: 'score:changed',

  // Particles / VFX
  PARTICLES_EMIT: 'particles:emit',
  SCREEN_SHAKE: 'vfx:screenShake',
  CAMERA_FLASH: 'vfx:cameraFlash',
  SLOP_SPLATTER: 'vfx:slopSplatter',
  XP_SPARKLE: 'vfx:xpSparkle',
  DAMAGE_NUMBER: 'vfx:damageNumber',
  DEATH_EXPLOSION: 'vfx:deathExplosion',

  // Ship
  SHIP_BOARD: 'ship:board',

  // Audio — from @sttg/audio base events
  ...AudioEvents,
};
