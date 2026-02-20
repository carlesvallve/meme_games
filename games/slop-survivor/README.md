# Slop Survivor

Vampire-survivors-style arcade shooter. Survive waves of rogue Copilots, cursed PRs, and AI-generated slop.

**Live:** https://slopsurvivor.snaptothegrid.com/
**Play.fun:** https://play.fun/games/slop-survivor

## Commands

```bash
pnpm --filter @sttg/slop-survivor dev      # local dev server
pnpm --filter @sttg/slop-survivor build    # production build
pnpm --filter @sttg/slop-survivor deploy   # build + deploy to Vercel
```

## Deploy

The deploy script builds with Vite, links to the correct Vercel project, and pushes to production:

```
vite build && cd dist && vercel link --project slop-survivor --yes && vercel --prod --yes
```

The `vercel link` step is needed because `vite build` wipes the `dist/` folder (and its `.vercel/` config) on every build. The link re-associates `dist/` with the "slop-survivor" Vercel project before deploying.

## Play.fun Integration

The game integrates with [Play.fun](https://play.fun) (OpenGameProtocol) for points tracking and leaderboards via the Browser SDK.

### Setup

1. `index.html` loads the SDK via `<script src="https://sdk.play.fun/latest"></script>`
2. `index.html` includes the ownership verification meta tag: `<meta name="x-ogp-key" content="...">`
3. `src/playfun.js` initializes the SDK and wires game events to points

### Points flow

| Event | SDK call | Behavior |
|-------|----------|----------|
| `SCORE_CHANGED` | `sdk.addPoints(delta)` | Cached locally, no UI modal |
| `GAME_OVER` | `sdk.savePoints()` | Persists to server, may show leaderboard modal |
| `beforeunload` | `sdk.savePoints()` | Silent fallback to avoid losing unsaved points |

### Keyboard focus workaround

The Play.fun SDK renders UI via iframes/overlays that steal keyboard focus from the Phaser canvas. When a modal closes, focus lands on `document.body` and Phaser stops receiving keyboard input entirely.

On the Play.fun dashboard this is handled by their iframe wrapper (they refocus the game iframe after modal close). But when the game runs **standalone on its own page**, we must recover focus ourselves.

**Solution** (in `src/playfun.js` `watchFocus()`):
- Listen for `focusout` on the canvas. After a 200ms delay (lets the modal finish closing), check if focus is "orphaned" on `body`/`documentElement`. If so, refocus the canvas and re-enable `game.input.keyboard`.
- Listen for `mouseenter` on the canvas so hovering back over the game area restores input immediately.

The canvas also needs `tabindex="0"` to be focusable and `outline: none` in CSS to hide the browser's default focus ring.
