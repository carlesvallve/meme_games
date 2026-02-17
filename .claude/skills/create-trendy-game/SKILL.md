---
name: create-trendy-game
description: Auto-pick a trend+concept and run the full pipeline — brief, make-game, adapt, polish — in one shot.
---

Automatically pick a trending game concept and build it end-to-end.

Arguments: $ARGUMENTS

## Instructions

### Step 1 — Find trends

Find the most recent `trends-*.json` file in the project root (sort by filename date).
If none exists, tell the user to run `/research-trends` first and stop.

### Step 2 — Smart pick

Read the trends JSON. Pick a trend and concept using **weighted random selection**:

- **Engagement weight:** mega-viral = 3, viral = 2, trending = 1
- **Genre novelty:** Check `games/` for existing game directories. Read each game's `brief.md` (if it exists) to see which genres have already been built. Strongly prefer genres not yet built.
- **Concept quality:** Prefer concepts with more specific mechanics (longer mechanic descriptions tend to be more fleshed out).

Roll the weighted random, then select the winning trend + concept.

If the user provided arguments, parse them:
- `/create-trendy-game` — full auto, random pick
- `/create-trendy-game 3` — use trend rank 3, random concept
- `/create-trendy-game 3 2` — use trend rank 3, concept 2
- `/create-trendy-game 3 2 my-game` — use trend rank 3, concept 2, name "my-game"

For the game name (if not provided): generate a short, punchy kebab-case name from the trend (2-3 words max, e.g. "slop-survivor", "vibe-hero", "glaze-runner").

### Step 3 — Generate brief

Run the script:
```
node scripts/create-from-trend.mjs --trends <file> --rank <N> --concept <N> --name <name>
```

Read the generated brief from `games/<name>/brief.md` and display a short summary:
- Trend name
- Genre
- One-line pitch
- Game name

### Step 4 — Build the game

Invoke the `/make-game` skill with the full brief content from `games/<name>/brief.md`.

**IMPORTANT:** Pass the entire brief as the argument to `/make-game`. Do not ask the user to paste it manually.

### Step 5 — Adapt for monorepo

After make-game completes, run:
```bash
./scripts/adapt-game.sh <name>
```

This is a safety net — the brief already includes monorepo conventions, but adapt-game.sh will catch anything missed. It also runs `pnpm install` and verifies the build.

### Step 6 — Polish

After adapt succeeds, run these polish passes in sequence:

1. **Design polish** — Invoke `/design-game` on `games/<name>/`
2. **Audio** — Invoke `/add-audio` on `games/<name>/`
3. **Assets** — Invoke `/add-assets` on `games/<name>/`

After each polish pass, run `pnpm --filter @sttg/<name> build` to verify nothing broke. If a build fails, fix the issue before continuing to the next pass.

### Step 7 — Final check

Run `pnpm --filter @sttg/<name> build` one last time.

### Step 8 — Launch

Start the dev server and open in the browser:
```bash
pnpm --filter @sttg/<name> dev --open
```

Run this in the background so it doesn't block. Then display:
```
Game ready: <name>
  Genre: <genre>
  Trend: <trend name>
  Running at: http://localhost:<port>
```

### Error handling

- If any step fails, stop and report which step failed and why.
- Do NOT silently skip steps.
- If make-game produces code that doesn't build, attempt to fix it before running adapt-game.sh.
