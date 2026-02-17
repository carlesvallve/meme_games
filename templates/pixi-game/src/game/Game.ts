import { Application, Graphics } from "pixi.js";

export async function createGame(container: HTMLElement): Promise<() => void> {
  const app = new Application();

  await app.init({
    resizeTo: container,
    background: "#111827",
    antialias: false,
    roundPixels: true,
    resolution: 1,
  });

  container.appendChild(app.canvas);

  // Placeholder: a simple square that moves
  const square = new Graphics();
  square.rect(-16, -16, 32, 32);
  square.fill({ color: 0x22c55e });
  square.x = app.screen.width / 2;
  square.y = app.screen.height / 2;
  app.stage.addChild(square);

  // Game loop
  let elapsed = 0;
  app.ticker.add((ticker) => {
    elapsed += ticker.deltaTime;
    square.x = app.screen.width / 2 + Math.sin(elapsed * 0.02) * 100;
    square.y = app.screen.height / 2 + Math.cos(elapsed * 0.03) * 60;
  });

  // Return cleanup function
  return () => {
    app.destroy(true, { children: true });
  };
}
