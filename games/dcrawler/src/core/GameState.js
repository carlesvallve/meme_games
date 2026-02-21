import { GameState as BaseGameState } from '@sttg/game-base';

class DCrawlerState extends BaseGameState {
  floor = 1;
  inCombat = false;
  exploring = true;
  currentEnemy = null;
  enemiesDefeated = 0;
  floorsCleared = 0;

  reset() {
    super.reset();
    this.floor = 1;
    this.inCombat = false;
    this.exploring = true;
    this.currentEnemy = null;
    this.enemiesDefeated = 0;
    this.floorsCleared = 0;
  }
}

export { DCrawlerState as GameState };
export const gameState = new DCrawlerState();
