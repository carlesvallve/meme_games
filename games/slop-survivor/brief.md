# Game Brief: slop-survivor

## Trend Context

**Trend:** Microslop — AI Slop Backlash
**Hashtags:** #Microslop #AISlop #StreisandEffect
**Why it's viral:** Microsoft CEO Satya Nadella asked people to stop calling AI output 'slop' — triggering a massive Streisand Effect. The internet renamed Microsoft to 'Microslop' and someone even made a browser extension for it. Millions learned the word 'slop' for the first time and started using it everywhere.
**Visual references:** Microsoft logo melting into goo, Windows blue screen with slop, Nadella facepalm, slop monster eating a computer

## Game Concept

**Genre:** Survival/Horde
**Pitch:** Vampire Survivors-style — wade through an ever-growing horde of AI slop to keep your codebase clean
**Core mechanic:** Top-down arena: you're a developer surrounded by expanding waves of slop creatures (Copilot popups, AI-generated PRs, 'smart' suggestions). Auto-attack nearby slop. Pick up power-ups: Code Review (area blast), .gitignore (shield), Linter (orbital). Every 30s a slop boss spawns (giant Clippy, Cortana's ghost). Surviving drops upgrade gems to level up your weapons.
**Win condition:** Survive as long as possible — score = slop destroyed + time survived. Every minute unlocks a new weapon choice.
**Lose condition:** Health reaches zero from slop contact

## Technical Spec

- **Engine:** Phaser 3 (2D browser game)
- **Target:** 60fps on mobile and desktop
- **Resolution:** responsive, DPR-aware (use `createDisplayConfig()`)

## Monorepo Architecture

This game lives in a pnpm workspace monorepo. It depends on `@sttg/game-base` which re-exports Phaser, Vite, Strudel, and shared utilities. **Do NOT install phaser, vite, or @strudel/web directly.**

### package.json

```json
{
  "name": "@sttg/slop-survivor",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@sttg/game-base": "workspace:*"
  }
}
```

### vite.config.js

```js
import { createViteConfig } from '@sttg/game-base/vite';
export default createViteConfig({ port: 3000 });
```

### src/core/EventBus.js

```js
export { EventBus, eventBus } from '@sttg/game-base';

export const Events = {
  GAME_START: 'game:start',
  GAME_OVER: 'game:over',
  SCORE_CHANGE: 'score:change',
  // ... add game-specific events here
};
```

### src/core/GameState.js

```js
export { GameState, gameState } from '@sttg/game-base';
```

### src/core/Constants.js

```js
import { createDisplayConfig } from '@sttg/game-base';

const { DPR, PX, GAME } = createDisplayConfig();
export { DPR, PX, GAME };

// Game-specific constants below...
```

### Import rules

- `import Phaser from 'phaser'` — OK (resolved via game-base)
- `import { EventBus, eventBus, Events } from '../core/EventBus.js'` — use the local re-export
- `import { gameState } from '../core/GameState.js'` — use the local re-export
- `import { DPR, PX, GAME } from '../core/Constants.js'` — use the local constants
- **Never** `import ... from '@sttg/game-base'` directly in scene files — always go through `src/core/`

## Visual Style

- Pixel art sprites — no raw rectangles in the final game
- Bold, saturated colors that pop on mobile screens
- Exaggerated animations (squash & stretch on jumps, impacts, scoring)
- AI/tech iconography tied to the trend (Microsoft logo melting into goo, Windows blue screen with slop, Nadella facepalm, slop monster eating a computer)
- Gradient backgrounds per scene (menu, gameplay, game-over)
- Particle effects on key moments: scoring, death/fail, power-ups
- Screen shake on impacts
- Score pop animation (scale up + fade) on change

## Audio Direction

- Background music via Strudel.cc (procedural, chiptune or lo-fi style)
- Distinct music per scene (menu theme, gameplay loop, game-over sting)
- SFX for: player action, scoring, death/fail, button press
- Mute toggle button in top-right corner
- Music crossfade on scene transitions

## Game Flow

1. **Menu Scene** — Title with trend-themed art, "Tap to Play" button, best score display
2. **Game Scene** — Core gameplay with HUD (current score, best score)
3. **GameOver Scene** — Final score prominently displayed, "Play Again" + "Share" buttons
4. Camera fade transitions between all scenes (350ms)

## Controls

- **Desktop:** Arrow keys / WASD for movement, Space for action
- **Mobile:** Touch zones for movement, tap for action
- Minimum 44px touch targets
- No hover-only interactions

## Shareability

- Game-over screen shows score prominently with trend hashtag #Microslop #AISlop #StreisandEffect
- Screenshot-friendly layout — no UI overlapping the score area
- Share button that copies score text with hashtags

## Polish Checklist

- [ ] Smooth 60fps gameplay
- [ ] Menu → Game → GameOver flow with fade transitions
- [ ] Score system with current + best score (localStorage)
- [ ] Mobile touch support with 44px+ targets
- [ ] Audio with mute toggle
- [ ] Particle effects on key actions
- [ ] Gradient backgrounds per scene
- [ ] Button hover/press/release states
- [ ] No raw rectangles — pixel art or styled shapes only
- [ ] Score pop animation on change
