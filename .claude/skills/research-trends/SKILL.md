---
name: research-trends
description: Web-search for viral AI/tech meme trends on X and create a trends JSON file.
---

Research viral AI/tech meme trends on X and create a trends JSON file.

## Instructions

1. Use web search to find the latest viral AI and tech memes trending on X (Twitter). Search for:
   - AI model releases and drama (GPT, Claude, Gemini, Grok, Llama)
   - AI hype cycles, doomerism, and bubble talk
   - Tech CEO drama and rivalries
   - AI-generated content fails or wins
   - Developer culture memes (vibe coding, AI slop, prompt engineering)
   - Startup culture and VC absurdity
   - AI taking jobs / not taking jobs

2. Compile exactly 5 trends ranked by virality. For each trend include:
   - `rank` (1-5, most viral first)
   - `name` — catchy label
   - `hashtags` — actual hashtags used on X
   - `description` — 2-3 sentences on why it's viral
   - `engagement` — "mega-viral" / "viral" / "trending"
   - `visual_elements` — imagery and formats people use
   - `concepts` — exactly 2 game ideas with **distinct genres** (see Genre Pool below), each with: id, genre, pitch, mechanic, win_condition, lose_condition

## Genre Pool

Each concept MUST pick a unique genre from this pool. No two concepts across all 5 trends should share the same genre (10 concepts = 10 different genres). Pick the genre that best amplifies the humor of the trend.

Available genres (not exhaustive — invent new ones if a trend demands it):

| Genre | Reference | What makes it fun |
|-------|-----------|-------------------|
| Platformer | Super Mario, Celeste | Precision movement, satisfying jumps |
| Endless Runner | Temple Run, Canabalt | One-button tension, speed escalation |
| Tower Defense | Bloons TD, Kingdom Rush | Strategic placement, wave pressure |
| Cooking / Task Juggle | Overcooked, Papa's Pizzeria | Multitasking chaos, order queues |
| Auto-Battler | Auto Chess, Super Auto Pets | Draft + positioning, hands-off combat |
| Point & Click Adventure | Monkey Island (lite) | Puzzle solving, humor through dialogue |
| Merge / Crafting | Suika Game, 2048 | Combine items, chain reactions |
| Tactics / Turn-Based | Into the Breach, XCOM-lite | Grid positioning, risk management |
| Roguelike / Dungeon Crawl | Slay the Spire-lite | Room choices, build-a-deck/loadout |
| Rhythm / Timing | Guitar Hero, Taiko | Beat-matching, flow state |
| Physics Puzzle | Angry Birds, Cut the Rope | Trajectory, chain reactions |
| Tycoon / Idle | Cookie Clicker, AdVenture Capitalist | Growth loops, upgrades |
| Survival / Crafting | Vampire Survivors-lite | Horde dodging, power scaling |
| Card Battle | Slay the Spire, Balatro | Hand management, combos |
| Stealth / Infiltration | Metal Gear-lite | Avoid detection, timing |
| Racing | Micro Machines | Track mastery, boost management |
| Puzzle Bobble / Match | Tetris, Puyo Puyo | Pattern matching, chain clears |
| Boss Rush | Cuphead-lite | Pattern memorization, dodge windows |
| Simulation / Sandbox | SimCity-lite | Systems interact, emergent chaos |
| Bullet Hell / Shmup | Touhou-lite | Dense patterns, weaving |

When picking genres, maximize **contrast** — don't cluster similar genres together. A good set for 5 trends might be: Cooking, Tactics, Endless Runner, Merge, Stealth.

3. Save the result as `trends-YYYY-MM-DD.json` in the project root (use today's date).

4. Display a summary table of all 5 trends with their concepts.

5. Tell the user: "Run `/pick-trend` to choose a concept and generate a game brief."

Use the JSON schema from `prompts/research-trends.md` as reference for the output format.
