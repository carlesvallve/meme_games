export class GameState {
  score = 0;
  bestScore = 0;
  started = false;
  gameOver = false;

  reset(): void {
    this.score = 0;
    this.started = false;
    this.gameOver = false;
  }

  addScore(points = 1): void {
    this.score += points;
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
    }
  }
}

export const gameState = new GameState();
