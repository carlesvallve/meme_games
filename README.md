# STTG Meme Games

A pnpm monorepo for building trend-driven browser games with Phaser 3, procedural audio (Strudel.cc), and pixel art — all generated via Claude Code.

## Quick Start

```bash
pnpm install
pnpm --filter @sttg/slop-survivor dev    # start dev server on localhost:3000
```

## Structure

```
packages/
  game-base/        @sttg/game-base     Shared Phaser utilities (EventBus, GameState, display, Vite config)
  audio/            @sttg/audio         Shared audio engine (Strudel BGM, Web Audio SFX, DrumMachine)
  social-browser/   @sttg/social-browser  Browser fingerprint & share
  social/           @sttg/social        Server-side social (sessions, JWT)
  ui/               @sttg/ui            React UI components

games/
  slop-survivor/    @sttg/slop-survivor   Vampire Survivors-style AI slop horde game

scripts/
  scaffold-game.sh    Create a new game from a template
  adapt-game.sh       Convert a game-creator game to monorepo conventions
  create-from-trend.mjs  Generate a game brief from a trend JSON
```

## Common Commands

```bash
# From monorepo root
pnpm install                                 # install all dependencies
pnpm build                                   # build all packages (via Turbo)
pnpm --filter @sttg/<game-name> dev          # dev server for a game
pnpm --filter @sttg/<game-name> build        # production build
pnpm --filter @sttg/<game-name> run deploy   # build + deploy to Vercel

# IMPORTANT: use `pnpm run deploy`, NOT `pnpm deploy`
# `pnpm deploy` is a built-in pnpm command (package deploy to directory)
# `pnpm run deploy` runs the deploy script from package.json
```

## Game Architecture

Every game depends on `@sttg/game-base` (workspace:\*) — no direct phaser/vite dependencies.

Each game follows this layout:

```
games/<name>/
  package.json          depends on @sttg/game-base, @sttg/audio
  vite.config.js        uses createViteConfig() from game-base
  index.html
  src/
    main.js             entry point
    core/
      Constants.js      ALL config values (zero magic numbers)
      EventBus.js       re-exports from game-base + game-specific events
      GameState.js      extends game-base GameState with game-specific fields
      GameConfig.js     Phaser game configuration
    scenes/             Phaser scenes (MenuScene, GameScene, GameOverScene, UIScene)
    entities/           game objects (Player, Enemy, XPGem, PowerUp, etc.)
    systems/            managers (WaveSystem, WeaponSystem, LevelSystem, VFXSystem)
    audio/              AudioManager, AudioBridge, music.js, sfx.js
    sprites/            pixel art data (palette, player, enemies, tiles)
    ui/                 UI components (DialogBubble, SpeechBubble, VirtualJoystick)
```

## Creating a New Game

### From a trend (full pipeline)

```bash
# 1. Research viral trends
# (use /research-trends slash command in Claude Code)

# 2. Pick a trend and generate a brief
# (use /pick-trend slash command)

# 3. Build the game from the brief
# (use /make-game slash command with the generated brief)

# 4. Adapt to monorepo (safety net, idempotent)
./scripts/adapt-game.sh <game-name>

# 5. Verify
pnpm --filter @sttg/<game-name> build
```

### From scratch

```bash
./scripts/scaffold-game.sh 2d my-game
pnpm install
pnpm --filter @sttg/my-game dev
```

---

# Slop Survivor

A Vampire Survivors-style browser game where you pilot a dev ship through waves of AI slop creatures.

**Live:** deployed via Vercel

## Concept

You're a developer surrounded by expanding waves of slop creatures — Copilot popups, AI-generated PRs, and "smart" suggestions. Auto-attack nearby slop, collect XP gems to level up weapons, grab power-ups, and survive as long as possible.

Inspired by the **Microslop** trend — when Microsoft CEO Satya Nadella asked people to stop calling AI output "slop," triggering a massive Streisand Effect.

## Controls

| Platform | Move | Fire | Skip dialog |
|----------|------|------|-------------|
| Desktop  | Arrow keys / WASD | Space | Space / Click |
| Mobile   | Virtual joystick | Tap (while joystick active) | Tap |

- **M** key toggles mute on desktop

## Gameplay Systems

### Weapons (level up to upgrade)
- **Laser** — manual aimed shot (Space)
- **Auto-turret** — fires at nearest enemy automatically
- **Orbital linter** — rotating projectiles around the ship
- **Homing missiles** — lock on and track enemies
- **Guided shot** — steerable beam weapon

### Power-ups (dropped by enemies)
- **Code Review** — area blast that damages all nearby enemies
- **.gitignore** — temporary shield
- **Linter** — orbital damage ring
- **Mines** — drop proximity mines behind you (timed)
- **Triple Shot** — three-way laser spread (timed)

### Difficulty Scaling
Time-based difficulty that ramps "smartly" — not just more enemies:
- Enemy stats (health, speed, damage) scale with elapsed minutes
- Boss escalation: each successive boss is harder (more HP, faster charges, longer charge range)
- Power-up drop rate decreases over time
- **Progressive enemy behaviors** unlock over time:
  - **2 min** — Dashers (telegraph + high-speed charge)
  - **3.5 min** — Shooters (telegraph + projectile fire)
  - **5 min** — Splitters (split into 3 fast mini-enemies on death)
  - **6.5 min** — Mine Layers (drop proximity mines)

### Audio
- Procedural chiptune BGM via Strudel.cc with adaptive 5-tier intensity
- Web Audio API SFX (laser, explosions, engine hum, typing blips)
- DrumMachine layer that kicks in at higher intensity

## Development

```bash
# Dev server (hot reload)
pnpm --filter @sttg/slop-survivor dev

# Production build
pnpm --filter @sttg/slop-survivor build

# Deploy to Vercel
pnpm --filter @sttg/slop-survivor run deploy
```

### Key Files

| File | What to edit |
|------|-------------|
| `src/core/Constants.js` | All game balance values, colors, sizes, difficulty curves |
| `src/systems/WaveSystem.js` | Enemy spawning, wave composition, difficulty scaling |
| `src/systems/WeaponSystem.js` | Weapon stats, upgrades, projectile behavior |
| `src/entities/Enemy.js` | Enemy AI, behavior variants (dasher, shooter, splitter, mine layer) |
| `src/entities/Player.js` | Ship movement, thrust physics, shields |
| `src/audio/music.js` | BGM compositions (Strudel patterns) |
| `src/audio/sfx.js` | Sound effects (Web Audio API) |
| `src/sprites/` | Pixel art data (palette indices in 2D arrays) |

## Tech Stack

- **Engine:** Phaser 3
- **Bundler:** Vite (via @sttg/game-base)
- **Music:** Strudel.cc (@strudel/web) — AGPL-3.0
- **SFX:** Web Audio API (procedural, no audio files)
- **Art:** Code-generated pixel art (canvas textures at runtime)
- **Deployment:** Vercel
- **Package manager:** pnpm 9.x with workspaces
