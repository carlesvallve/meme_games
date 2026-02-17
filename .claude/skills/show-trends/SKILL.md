---
name: show-trends
description: Display the latest researched AI/tech meme trends. Use when the user wants to see or review current trends.
---

Display the latest researched trends in a readable format.

## Instructions

1. Find the most recent `trends-*.json` file in the project root (sort by filename date). If none exists, tell the user to run `/research-trends` first.

2. Read the file and display the trends as a well-formatted summary:

   For each trend show:
   - **Rank** and **Name**
   - **Engagement** level
   - **Hashtags**
   - **Description** (why it's viral)
   - **Visual elements**
   - **Concept 1:** genre, pitch + mechanic (one line each)
   - **Concept 2:** genre, pitch + mechanic (one line each)

   Use a clear visual separator between trends.

3. At the end, remind the user: "Run `/pick-trend <rank> <concept> <name>` to generate a game brief."
