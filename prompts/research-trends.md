# Trend Research Prompt

> **Option A (recommended):** Ask Claude Code — "Research viral AI/tech memes trending on X right now and save them as a trends JSON file." Claude will web-search, compile results, and write the JSON directly.
>
> **Option B:** Paste this prompt into Grok on x.com (or the xAI API) for real-time X data.
>
> Replace `{{DATE}}` with yesterday's date (YYYY-MM-DD format).

---

## Prompt

```
You are a viral trend researcher. Search X posts from the last 48 hours (as of {{DATE}}) for the most viral AI and tech memes — especially ones that mock, celebrate, or satirize:

- New AI model releases (GPT, Claude, Gemini, Llama, Grok, etc.)
- AI hype cycles and doomerism
- Tech CEO drama and rivalries
- AI-generated content fails or wins
- Developer culture and coding memes
- Startup culture and VC absurdity
- AI taking jobs / not taking jobs
- Prompt engineering and jailbreaks

For each trend, provide:

1. **Trend name** — short catchy label
2. **Hashtags** — the actual hashtags being used on X
3. **Description** — 2-3 sentences explaining the meme/trend and why it's viral
4. **Engagement** — rough scale: "mega-viral" (100k+ interactions), "viral" (10k-100k), "trending" (1k-10k)
5. **Visual elements** — what imagery, characters, or formats people are using
6. **Game concepts** — exactly 2 game ideas that riff on this trend. Each concept MUST use a **different gameplay genre** (see genre pool below). No two concepts across all 5 trends should repeat a genre. Each concept should include:
   - Genre (from the pool)
   - A one-line pitch
   - Core mechanic (what the player does — be specific to the genre)
   - Win/lose condition

**Genre pool** (pick 10 unique genres across all 10 concepts — maximize contrast):
Platformer, Endless Runner, Tower Defense, Cooking/Task Juggle, Auto-Battler, Point & Click Adventure, Merge/Crafting, Tactics/Turn-Based, Roguelike/Dungeon Crawl, Rhythm/Timing, Physics Puzzle, Tycoon/Idle, Survival/Horde, Card Battle, Stealth/Infiltration, Racing, Puzzle Bobble/Match, Boss Rush, Simulation/Sandbox, Bullet Hell/Shmup

Return the results as a JSON array, ranked by virality (most viral first). Return exactly 5 trends.

Output schema:

{
  "date": "{{DATE}}",
  "trends": [
    {
      "rank": 1,
      "name": "Trend Name",
      "hashtags": ["#hashtag1", "#hashtag2"],
      "description": "Why this is viral right now...",
      "engagement": "mega-viral",
      "visual_elements": ["element1", "element2"],
      "concepts": [
        {
          "id": 1,
          "genre": "Tower Defense",
          "pitch": "One-line game pitch",
          "mechanic": "What the player does",
          "win_condition": "How to win",
          "lose_condition": "How to lose"
        },
        {
          "id": 2,
          "genre": "Roguelike/Dungeon Crawl",
          "pitch": "One-line game pitch",
          "mechanic": "What the player does",
          "win_condition": "How to win",
          "lose_condition": "How to lose"
        }
      ]
    }
  ]
}
```

---

## How to use

### Option A — Claude Code (no Grok needed)

1. Ask Claude Code: *"Research the latest viral AI/tech memes on X and create a trends JSON"*
2. Claude will search the web, compile 5 trends with game concepts, and write `trends-YYYY-MM-DD.json`
3. Pick a trend: `node scripts/create-from-trend.mjs --trends trends-2026-02-16.json --rank 1 --concept 1 --name my-game`

### Option B — Grok (real-time X data)

1. Go to [grok.x.ai](https://grok.x.ai) or use the xAI API
2. Paste the prompt above with `{{DATE}}` replaced (e.g. `2026-02-16`)
3. Copy the JSON response
4. Save it to a file (e.g. `trends-2026-02-16.json`)
5. Feed it into the pipeline: `node scripts/create-from-trend.mjs --trends trends-2026-02-16.json --rank 1 --concept 1 --name my-game`
