export { EventBus, eventBus } from '@sttg/game-base';

export const Events = {
  // Game lifecycle
  GAME_START: 'game:start',
  GAME_OVER: 'game:over',
  GAME_RESTART: 'game:restart',

  // Dungeon
  DUNGEON_GENERATED: 'dungeon:generated',
  FLOOR_CHANGE: 'dungeon:floorChange',

  // Player movement
  PLAYER_MOVE: 'player:move',
  PLAYER_TURN: 'player:turn',
  PLAYER_STEP: 'player:step',

  // Combat
  COMBAT_START: 'combat:start',
  COMBAT_END: 'combat:end',
  COMBAT_DRAW_CARD: 'combat:drawCard',
  COMBAT_STAND: 'combat:stand',
  COMBAT_BUST: 'combat:bust',
  COMBAT_RESOLVE: 'combat:resolve',
  COMBAT_ATTACK: 'combat:attack',
  COMBAT_DAMAGE: 'combat:damage',
  COMBAT_CRITICAL: 'combat:critical',
  COMBAT_NEW_ROUND: 'combat:newRound',
  COMBAT_PLAYER_TURN: 'combat:playerTurn',
  COMBAT_ENEMY_TURN: 'combat:enemyTurn',

  // Hand cards
  HAND_CARD_PLAY: 'hand:cardPlay',
  HAND_CARD_DRAW: 'hand:cardDraw',

  // Encounter
  ENCOUNTER_ENEMY: 'encounter:enemy',
  ENCOUNTER_CHEST: 'encounter:chest',
  ENCOUNTER_TRAP: 'encounter:trap',
  ENCOUNTER_SHOP: 'encounter:shop',
  ENCOUNTER_STAIRS: 'encounter:stairs',

  // UI
  UI_UPDATE_HP: 'ui:updateHP',
  UI_UPDATE_ENERGY: 'ui:updateEnergy',
  UI_UPDATE_SCORE: 'ui:updateScore',
  UI_SHOW_DIALOG: 'ui:showDialog',
  UI_HIDE_DIALOG: 'ui:hideDialog',
  UI_DAMAGE_NUMBER: 'ui:damageNumber',
};
