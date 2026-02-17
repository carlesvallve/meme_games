---
name: pick-trend
description: Pick a trend from the latest trends JSON and generate a game brief for /make-game.
---

Pick a trend from a trends JSON file and generate a game brief.

Arguments: $ARGUMENTS

## Instructions

1. Find the most recent `trends-*.json` file in the project root. If none exists, tell the user to run `/research-trends` first.

2. Read the trends file and display all trends as a numbered list showing: rank, name, engagement level, and both game concepts (with a one-line pitch each).

3. Ask the user to pick:
   - Which trend (by rank number)
   - Which concept (1 or 2)
   - A game name in kebab-case

   If the user provided arguments (e.g. `/pick-trend 1 2 microslop`), parse them as: rank, concept, name — and skip the interactive prompt.

4. Run the script:
   ```
   node scripts/create-from-trend.mjs --trends <file> --rank <N> --concept <N> --name <name>
   ```

5. Read the generated brief from `games/<name>/brief.md` and display it.

6. Tell the user their next steps:
   - Run `/make-game` and paste the brief
   - After game-creator finishes: `./scripts/adapt-game.sh <name>`
