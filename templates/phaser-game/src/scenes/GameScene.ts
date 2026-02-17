import Phaser from "phaser";
import { GAME_WIDTH, GAME_HEIGHT, COLORS } from "../Constants";
import { GameState } from "../GameState";
import { EventBus } from "../EventBus";

export class GameScene extends Phaser.Scene {
  private sprite!: Phaser.GameObjects.Sprite;
  private speed = 200;
  private direction = 1;

  constructor() {
    super({ key: "GameScene" });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.background);

    this.sprite = this.add.sprite(GAME_WIDTH / 2, GAME_HEIGHT / 2, "placeholder");

    GameState.isPlaying = true;
    EventBus.emit("game:started");

    // Click to change direction
    this.input.on("pointerdown", () => {
      this.direction *= -1;
      GameState.score += 1;
      EventBus.emit("game:score", GameState.score);
    });
  }

  update(_time: number, delta: number): void {
    if (!GameState.isPlaying) return;

    this.sprite.x += this.speed * this.direction * (delta / 1000);

    // Bounce off edges
    if (this.sprite.x > GAME_WIDTH - 24) {
      this.sprite.x = GAME_WIDTH - 24;
      this.direction = -1;
    } else if (this.sprite.x < 24) {
      this.sprite.x = 24;
      this.direction = 1;
    }

    this.sprite.rotation += 2 * (delta / 1000);
  }
}
