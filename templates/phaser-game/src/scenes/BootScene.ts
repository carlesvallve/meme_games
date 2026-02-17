import Phaser from "phaser";

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: "BootScene" });
  }

  preload(): void {
    // Create a simple colored rectangle as a placeholder sprite
    const graphics = this.make.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0xe94560);
    graphics.fillRect(0, 0, 48, 48);
    graphics.generateTexture("placeholder", 48, 48);
    graphics.destroy();
  }

  create(): void {
    this.scene.start("GameScene");
  }
}
