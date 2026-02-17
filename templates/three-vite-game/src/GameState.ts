/** Singleton game state container. */
class GameStateClass {
  score = 0;
  highScore = 0;
  isPlaying = false;

  reset(): void {
    this.score = 0;
    this.isPlaying = false;
  }
}

export const GameState = new GameStateClass();
