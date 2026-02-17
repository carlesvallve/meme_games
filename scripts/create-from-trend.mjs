#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// --- CLI parsing ---

const { values } = parseArgs({
  options: {
    trends: { type: 'string', short: 't' },
    rank:   { type: 'string', short: 'r' },
    concept:{ type: 'string', short: 'c' },
    name:   { type: 'string', short: 'n' },
    stdout: { type: 'boolean', default: false },
    help:   { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (values.help || (!values.trends && !values.help)) {
  console.log(`
Usage: node scripts/create-from-trend.mjs [options]

Options:
  -t, --trends <file>   Path to the Grok trends JSON file (required)
  -r, --rank <n>        Trend rank to pick (1-5, default: 1)
  -c, --concept <n>     Concept id within the trend (1 or 2, default: 1)
  -n, --name <name>     Game name in kebab-case (required)
      --stdout          Print brief to stdout instead of writing a file
  -h, --help            Show this help

Example:
  node scripts/create-from-trend.mjs --trends trends.json --rank 1 --concept 1 --name ai-dodge

Pipeline:
  1. Run prompts/research-trends.md in Grok → save JSON
  2. node scripts/create-from-trend.mjs --trends file.json --rank N --concept N --name my-game
  3. /make-game (paste the generated brief)
  4. ./scripts/adapt-game.sh my-game
`);
  process.exit(values.help ? 0 : 1);
}

const trendsPath = values.trends;
const rank = parseInt(values.rank || '1', 10);
const conceptId = parseInt(values.concept || '1', 10);
const gameName = values.name;

if (!trendsPath) {
  console.error('Error: --trends is required');
  process.exit(1);
}
if (!gameName) {
  console.error('Error: --name is required');
  process.exit(1);
}
if (!/^[a-z][a-z0-9-]*$/.test(gameName)) {
  console.error('Error: --name must be kebab-case (e.g. ai-dodge)');
  process.exit(1);
}

// --- Load trends ---

let data;
try {
  const raw = readFileSync(trendsPath, 'utf-8');
  data = JSON.parse(raw);
} catch (err) {
  console.error(`Error reading trends file: ${err.message}`);
  process.exit(1);
}

const trends = data.trends || data;
if (!Array.isArray(trends)) {
  console.error('Error: expected a JSON object with a "trends" array, or a top-level array');
  process.exit(1);
}

const trend = trends.find(t => t.rank === rank);
if (!trend) {
  console.error(`Error: no trend with rank ${rank}. Available ranks: ${trends.map(t => t.rank).join(', ')}`);
  process.exit(1);
}

const concept = trend.concepts?.find(c => c.id === conceptId);
if (!concept) {
  console.error(`Error: no concept with id ${conceptId} in trend "${trend.name}". Available: ${trend.concepts?.map(c => c.id).join(', ')}`);
  process.exit(1);
}

// --- Load and fill template ---

const templatePath = join(ROOT, 'prompts', 'game-brief.md');
let template;
try {
  template = readFileSync(templatePath, 'utf-8');
} catch (err) {
  console.error(`Error reading template: ${err.message}`);
  process.exit(1);
}

const hashtags = Array.isArray(trend.hashtags) ? trend.hashtags.join(' ') : (trend.hashtags || '');
const visuals = Array.isArray(trend.visual_elements) ? trend.visual_elements.join(', ') : (trend.visual_elements || '');

const replacements = {
  '{{GAME_NAME}}':          gameName,
  '{{TREND_NAME}}':         trend.name,
  '{{HASHTAGS}}':           hashtags,
  '{{TREND_DESCRIPTION}}':  trend.description,
  '{{VISUAL_ELEMENTS}}':    visuals,
  '{{GENRE}}':              concept.genre || 'Arcade',
  '{{CONCEPT_PITCH}}':      concept.pitch,
  '{{CONCEPT_MECHANIC}}':   concept.mechanic,
  '{{WIN_CONDITION}}':      concept.win_condition,
  '{{LOSE_CONDITION}}':     concept.lose_condition,
};

let brief = template;
for (const [placeholder, value] of Object.entries(replacements)) {
  brief = brief.replaceAll(placeholder, value || '');
}

// --- Output ---

if (values.stdout) {
  console.log(brief);
} else {
  const outDir = join(ROOT, 'games', gameName);
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'brief.md');
  writeFileSync(outPath, brief, 'utf-8');
  console.log(`Brief written to: games/${gameName}/brief.md`);
}

console.log(`
--- Next steps ---
1. Run /make-game and paste the brief ${values.stdout ? 'above' : `from games/${gameName}/brief.md`}
2. After game-creator finishes: ./scripts/adapt-game.sh ${gameName}
3. Verify: pnpm --filter @sttg/${gameName} build
`);
