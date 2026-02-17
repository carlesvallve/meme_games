import { GameState as BaseGameState } from '@sttg/game-base';

class SlopGameState extends BaseGameState {
  health = 5;
  maxHealth = 5;
  level = 1;
  xp = 0;
  xpToNext = 10;
  enemiesKilled = 0;
  timeSurvived = 0;
  isMuted = false;
  upgrades = [];

  reset() {
    super.reset();
    this.health = this.maxHealth;
    this.level = 1;
    this.xp = 0;
    this.xpToNext = 10;
    this.enemiesKilled = 0;
    this.timeSurvived = 0;
    this.upgrades = [];
  }

  addXP(amount) {
    this.xp += amount;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      this.xpToNext = Math.floor(this.xpToNext * 1.4);
      return true; // leveled up
    }
    return false;
  }

  takeDamage(amount = 1) {
    this.health = Math.max(0, this.health - amount);
    return this.health <= 0;
  }

  saveBest() {
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
    }
    try {
      const stored = parseInt(localStorage.getItem('slop-survivor-best') || '0', 10);
      if (this.bestScore > stored) {
        localStorage.setItem('slop-survivor-best', String(this.bestScore));
      }
    } catch (e) { /* ignore */ }
  }

  loadBest() {
    try {
      const stored = parseInt(localStorage.getItem('slop-survivor-best') || '0', 10);
      if (stored > this.bestScore) {
        this.bestScore = stored;
      }
    } catch (e) { /* ignore */ }
  }
}

export { SlopGameState as GameState };
export const gameState = new SlopGameState();
