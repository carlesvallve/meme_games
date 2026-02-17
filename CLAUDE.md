# STTG Meme Games — Monorepo

## Structure

```
packages/
  game-base/       → @sttg/game-base — shared Phaser utilities (EventBus, GameState, display, vite)
  social-browser/  → @sttg/social-browser — browser fingerprint & share
  social/          → @sttg/social — server-side social (sessions, JWT)
  ui/              → @sttg/ui — React UI components
games/
  <game-name>/     → individual games (each is a workspace package @sttg/<game-name>)
scripts/
  scaffold-game.sh → create a new game from a plugin template
  adapt-game.sh    → convert a game-creator game to use @sttg/game-base
templates/         → game engine templates (phaser-2d, threejs-3d, etc.)
```

## @sttg/game-base

All Phaser games depend on `@sttg/game-base` (`workspace:*`). It provides:

| Export | Import path | Purpose |
|--------|------------|---------|
| `EventBus`, `eventBus` | `@sttg/game-base` | Lightweight pub/sub event emitter |
| `GameState`, `gameState` | `@sttg/game-base` | Singleton state container (score, gameOver, etc.) |
| `createDisplayConfig()` | `@sttg/game-base` | Responsive DPR/PX/GAME sizing |
| `createViteConfig()` | `@sttg/game-base/vite` | Pre-configured Vite config for games |

## Game file conventions

Every game under `games/` follows this structure:

- **`package.json`** — depends only on `@sttg/game-base: workspace:*` (no direct phaser/vite deps)
- **`vite.config.js`** — `import { createViteConfig } from '@sttg/game-base/vite'; export default createViteConfig({ port: 3000 });`
- **`src/core/EventBus.js`** — re-exports from game-base + defines game-specific `Events` object
- **`src/core/GameState.js`** — re-exports from game-base: `export { GameState, gameState } from '@sttg/game-base';`
- **`src/core/Constants.js`** — uses `createDisplayConfig()` from game-base, then defines game-specific constants

### Constants.js pattern

```js
import { createDisplayConfig } from '@sttg/game-base';

const { DPR, PX, GAME } = createDisplayConfig();

export { DPR, PX, GAME };

// Game-specific constants below...
export const PLAYER = { ... };
export const COLORS = { ... };
```

### EventBus.js pattern

```js
export { EventBus, eventBus } from '@sttg/game-base';

export const Events = {
  GAME_START: 'game:start',
  GAME_OVER: 'game:over',
  // ... game-specific events
};
```

## After creating a game with game-creator

Always run the adapt script to convert to monorepo conventions:

```bash
./scripts/adapt-game.sh <game-name>
```

This patches package.json, EventBus, GameState, vite.config, and Constants to use `@sttg/game-base`, then runs `pnpm install` and verifies the build. The script is idempotent.

## Common commands

```bash
pnpm build                              # build all packages
pnpm --filter @sttg/<game-name> dev     # dev server for a game
pnpm --filter @sttg/<game-name> build   # production build for a game
./scripts/scaffold-game.sh 2d <name>    # scaffold from template
./scripts/adapt-game.sh <name>          # adapt game-creator output
```

## Game Quality Standards

Minimum polish level for all games produced by the pipeline.

### Gameplay
- Core loop playable in under 2 seconds from page load
- Responsive to both keyboard (arrows/WASD/space) and touch
- Score system with current + best score (persisted to localStorage)
- Clean restart cycle: Menu → Play → GameOver → Menu

### Visuals
- No raw rectangles in final game — use pixel art sprites or styled shapes with gradients/borders
- Gradient backgrounds on menu and game-over scenes
- Camera fade transitions between scenes (350ms)
- Score pop animation on change (scale up + fade)
- At least one particle effect (e.g. on death or scoring)
- Buttons with hover, press, and release states
- Screen shake on impacts

### Audio
- Background music per scene (Strudel.cc procedural — chiptune or lo-fi)
- SFX for: player action, scoring, death/fail
- Mute toggle button (top-right corner)
- Music transitions on scene change

### Mobile
- Touch zones for movement and action
- Minimum 44px touch targets
- No hover-only interactions
- Viewport meta tag with `user-scalable=no`

### Shareability
- Game-over screen shows score prominently
- Screenshot-friendly layout (no UI overlapping score)
- Share button with trend hashtags

## Pipeline Workflow

Full trend-to-game pipeline:

```
1. Research trends    →  /research-trends
2. Pick a concept     →  /pick-trend
3. Create the game    →  /make-game (paste the generated brief — includes monorepo conventions)
4. Adapt (safety net) →  ./scripts/adapt-game.sh my-game  (idempotent — fixes any missed conventions)
5. Polish & iterate   →  /improve-game, /add-audio, /design-game
6. Verify             →  pnpm --filter @sttg/my-game build
```

> **Note:** The game brief template includes full monorepo architecture (imports, package.json, vite config) so `/make-game` should produce already-adapted code. Step 4 is a safety net — run it anyway since it's idempotent and fast.

### Custom slash commands

| Command | What it does |
|---------|-------------|
| `/research-trends` | Web-searches for viral AI/tech memes on X, compiles 5 trends with game concepts, saves `trends-YYYY-MM-DD.json` |
| `/show-trends` | Display the latest trends JSON in a readable format |
| `/pick-trend` | Shows all trends from the latest JSON, lets you pick one, generates a game brief in `games/<name>/brief.md` |
| `/pick-trend 1 2 microslop` | Shorthand: pick rank 1, concept 2, name it "microslop" — no prompts |
| `/create-trendy-game` | **Full auto pipeline:** weighted-random pick → brief → make-game → adapt → design → audio → assets → build |
| `/create-trendy-game 3 2 my-game` | Same but with explicit rank, concept, and name |

### Pipeline files

| File | Purpose |
|------|---------|
| `.claude/commands/research-trends.md` | Slash command: research trends via web search |
| `.claude/commands/pick-trend.md` | Slash command: pick a trend and generate a game brief |
| `prompts/research-trends.md` | Standalone Grok prompt (alternative to `/research-trends`) |
| `prompts/game-brief.md` | Template that turns a trend+concept into a `/make-game` brief |
| `scripts/create-from-trend.mjs` | Node script: reads trend JSON, fills brief template, outputs game brief |
