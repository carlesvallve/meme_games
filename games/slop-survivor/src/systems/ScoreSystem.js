import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';

export class ScoreSystem {
  constructor() {
    this.onEnemyKilled = this.onEnemyKilled.bind(this);
    eventBus.on(Events.ENEMY_KILLED, this.onEnemyKilled);
  }

  onEnemyKilled({ score }) {
    // Score is already added in Enemy.die(), just ensure best is tracked
    if (gameState.score > gameState.bestScore) {
      gameState.bestScore = gameState.score;
    }
  }

  destroy() {
    eventBus.off(Events.ENEMY_KILLED, this.onEnemyKilled);
  }
}
