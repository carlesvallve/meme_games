#!/usr/bin/env node

/**
 * adapt-game.mjs — Patch a game-creator-generated game to use @sttg/game-base.
 *
 * Usage:  node scripts/adapt-game.mjs <game-dir>
 *
 * Idempotent: safe to run on an already-adapted game (no-ops gracefully).
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findFile(dir, ...candidates) {
  for (const name of candidates) {
    const full = path.join(dir, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function readIfExists(filePath) {
  if (!filePath) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function changed(original, updated) {
  return original !== updated;
}

// ---------------------------------------------------------------------------
// 1. Patch package.json
// ---------------------------------------------------------------------------

function patchPackageJson(gameDir, gameName) {
  const pkgPath = path.join(gameDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error(`  ERROR: No package.json found in ${gameDir}`);
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const original = JSON.stringify(pkg);

  // Set @sttg scope name
  if (gameName && !pkg.name?.startsWith('@sttg/')) {
    pkg.name = `@sttg/${gameName}`;
  }

  pkg.version = pkg.version || '0.1.0';
  pkg.private = true;
  pkg.type = 'module';

  // Ensure scripts
  pkg.scripts = pkg.scripts || {};
  if (!pkg.scripts.clean) pkg.scripts.clean = 'rm -rf dist';

  // Replace deps: remove individual phaser/vite/playwright etc, add game-base
  const depsToRemove = [
    'phaser', '@strudel/web', 'vite', '@playwright/test',
    '@axe-core/playwright', '@sttg/social-browser',
  ];

  for (const dep of depsToRemove) {
    if (pkg.dependencies?.[dep]) delete pkg.dependencies[dep];
    if (pkg.devDependencies?.[dep]) delete pkg.devDependencies[dep];
  }

  pkg.dependencies = pkg.dependencies || {};
  pkg.dependencies['@sttg/game-base'] = 'workspace:*';

  // Remove devDependencies if empty
  if (pkg.devDependencies && Object.keys(pkg.devDependencies).length === 0) {
    delete pkg.devDependencies;
  }

  if (changed(original, JSON.stringify(pkg))) {
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log('  [patched] package.json');
  } else {
    console.log('  [ok]      package.json (already adapted)');
  }
}

// ---------------------------------------------------------------------------
// 2. Patch EventBus
// ---------------------------------------------------------------------------

function patchEventBus(gameDir) {
  const filePath = findFile(
    gameDir, 'src/core/EventBus.js', 'src/core/EventBus.ts',
    'src/EventBus.js', 'src/EventBus.ts',
  );
  if (!filePath) {
    console.log('  [skip]    EventBus (not found)');
    return;
  }

  const src = readIfExists(filePath);

  // Already adapted?
  if (src.includes("from '@sttg/game-base'") || src.includes('from "@sttg/game-base"')) {
    console.log('  [ok]      EventBus (already adapted)');
    return;
  }

  // Extract the Events object (everything from `export const Events` to end of file)
  const eventsMatch = src.match(/(export\s+const\s+Events\s*=\s*\{[\s\S]*)/);
  const eventsBlock = eventsMatch ? eventsMatch[1].trimEnd() + '\n' : '';

  const newSrc =
    `export { EventBus, eventBus } from '@sttg/game-base';\n` +
    (eventsBlock ? `\n${eventsBlock}` : '');

  fs.writeFileSync(filePath, newSrc);
  console.log(`  [patched] ${path.relative(gameDir, filePath)}`);
}

// ---------------------------------------------------------------------------
// 3. Patch GameState
// ---------------------------------------------------------------------------

function patchGameState(gameDir) {
  const filePath = findFile(
    gameDir, 'src/core/GameState.js', 'src/core/GameState.ts',
    'src/GameState.js', 'src/GameState.ts',
  );
  if (!filePath) {
    console.log('  [skip]    GameState (not found)');
    return;
  }

  const src = readIfExists(filePath);

  if (src.includes("from '@sttg/game-base'") || src.includes('from "@sttg/game-base"')) {
    console.log('  [ok]      GameState (already adapted)');
    return;
  }

  const newSrc = `export { GameState, gameState } from '@sttg/game-base';\n`;
  fs.writeFileSync(filePath, newSrc);
  console.log(`  [patched] ${path.relative(gameDir, filePath)}`);
}

// ---------------------------------------------------------------------------
// 4. Patch vite.config
// ---------------------------------------------------------------------------

function patchViteConfig(gameDir) {
  const filePath = findFile(
    gameDir, 'vite.config.js', 'vite.config.ts',
  );
  if (!filePath) {
    console.log('  [skip]    vite.config (not found)');
    return;
  }

  const src = readIfExists(filePath);

  if (src.includes("from '@sttg/game-base/vite'") || src.includes('from "@sttg/game-base/vite"')) {
    console.log('  [ok]      vite.config (already adapted)');
    return;
  }

  // Try to extract port from existing config
  let port = 3000;
  const portMatch = src.match(/port\s*[:=]\s*(\d+)/);
  if (portMatch) port = parseInt(portMatch[1], 10);

  const newSrc =
    `import { createViteConfig } from '@sttg/game-base/vite';\n` +
    `\n` +
    `export default createViteConfig({ port: ${port} });\n`;

  fs.writeFileSync(filePath, newSrc);
  console.log(`  [patched] ${path.relative(gameDir, filePath)}`);
}

// ---------------------------------------------------------------------------
// 5. Patch Constants
// ---------------------------------------------------------------------------

function patchConstants(gameDir) {
  const filePath = findFile(
    gameDir, 'src/core/Constants.js', 'src/core/Constants.ts',
    'src/Constants.js', 'src/Constants.ts',
  );
  if (!filePath) {
    console.log('  [skip]    Constants (not found)');
    return;
  }

  const src = readIfExists(filePath);

  if (src.includes("from '@sttg/game-base'") || src.includes('from "@sttg/game-base"')) {
    console.log('  [ok]      Constants (already adapted)');
    return;
  }

  // Strategy: replace the display math block with createDisplayConfig() import.
  //
  // The game-creator skill generates one of these patterns:
  //
  // Pattern A — Full responsive block:
  //   // --- Display ---
  //   const DPR = ...
  //   const PX = ...
  //   export const GAME = { WIDTH: ..., HEIGHT: ..., ... };
  //
  // Pattern B — Simple constants:
  //   export const GAME_WIDTH = ...
  //   export const GAME_HEIGHT = ...
  //   (possibly with DPR/PX)
  //
  // Pattern C — Already has createDisplayConfig but wrong import path

  // Try Pattern A: full block from DPR through GAME export
  const fullBlockRe =
    /(?:\/\/\s*---\s*Display[\s\S]*?\n)?(?:(?:export\s+)?const\s+DPR\b[\s\S]*?)(?:export\s+const\s+GAME\s*=\s*\{[\s\S]*?\};)/;

  const fullMatch = src.match(fullBlockRe);

  if (fullMatch) {
    // Extract any createDisplayConfig options from the existing GAME object
    const opts = extractDisplayOptions(fullMatch[0]);
    const replacement = buildDisplayImport(opts);

    let newSrc = src.replace(fullMatch[0], replacement);
    // Remove any old imports that are no longer needed
    newSrc = cleanOldImports(newSrc);
    fs.writeFileSync(filePath, newSrc);
    console.log(`  [patched] ${path.relative(gameDir, filePath)}`);
    return;
  }

  // Try Pattern B: simple GAME_WIDTH/GAME_HEIGHT
  const simpleRe =
    /(?:(?:export\s+)?const\s+(?:GAME_WIDTH|GAME_HEIGHT|DPR|PX)\b[^\n]*\n)+/g;
  const simpleMatch = src.match(simpleRe);

  if (simpleMatch) {
    // Extract width/height values
    const wMatch = src.match(/GAME_WIDTH\s*=\s*(\d+)/);
    const hMatch = src.match(/GAME_HEIGHT\s*=\s*(\d+)/);
    const opts = {};
    if (wMatch) opts.designWidth = parseInt(wMatch[1], 10);
    if (hMatch) opts.designHeight = parseInt(hMatch[1], 10);

    const replacement = buildDisplayImport(opts);
    let newSrc = src.replace(simpleMatch[0], replacement + '\n');
    newSrc = cleanOldImports(newSrc);
    fs.writeFileSync(filePath, newSrc);
    console.log(`  [patched] ${path.relative(gameDir, filePath)}`);
    return;
  }

  console.log('  [skip]    Constants (no display block found to patch)');
}

function extractDisplayOptions(block) {
  const opts = {};

  // Look for gravity value
  const gravMatch = block.match(/GRAVITY\s*:\s*([\d.]+)\s*\*?\s*PX/);
  if (gravMatch) {
    const grav = parseFloat(gravMatch[1]);
    if (grav !== 800) opts.gravity = grav;
  }

  // Look for design dimensions
  const dwMatch = block.match(/(?:designWidth|DESIGN_W(?:IDTH)?)\s*[:=]\s*(\d+)/i);
  const dhMatch = block.match(/(?:designHeight|DESIGN_H(?:EIGHT)?)\s*[:=]\s*(\d+)/i);
  if (dwMatch) opts.designWidth = parseInt(dwMatch[1], 10);
  if (dhMatch) opts.designHeight = parseInt(dhMatch[1], 10);

  // Look for maxDPR
  const dprMatch = block.match(/(?:maxDPR|MAX_DPR)\s*[:=]\s*([\d.]+)/i);
  if (dprMatch) {
    const maxDPR = parseFloat(dprMatch[1]);
    if (maxDPR !== 2) opts.maxDPR = maxDPR;
  }

  return opts;
}

function buildDisplayImport(opts) {
  const optsEntries = Object.entries(opts);
  const optsStr = optsEntries.length > 0
    ? `{ ${optsEntries.map(([k, v]) => `${k}: ${v}`).join(', ')} }`
    : '';

  return (
    `import { createDisplayConfig } from '@sttg/game-base';\n` +
    `\n` +
    `const { DPR, PX, GAME } = createDisplayConfig(${optsStr});\n` +
    `\n` +
    `export { DPR, PX, GAME };`
  );
}

function cleanOldImports(src) {
  // Remove any duplicate createDisplayConfig imports or old display-related imports
  // that may have been in the original file
  return src
    .replace(/^import\s+.*?['"]\.\/display.*?['"];\s*\n/gm, '')
    .replace(/^import\s+.*?['"]\.\.\/display.*?['"];\s*\n/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

// ---------------------------------------------------------------------------
// 6. Patch index.html — add favicon if missing
// ---------------------------------------------------------------------------

const FAVICON_LINK = `<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='12' fill='%236c63ff'/><text x='32' y='46' font-size='40' text-anchor='middle' fill='white'>&#x1f3ae;</text></svg>">`;

function patchIndexHtml(gameDir) {
  const filePath = path.join(gameDir, 'index.html');
  if (!fs.existsSync(filePath)) {
    console.log('  [skip]    index.html (not found)');
    return;
  }

  const src = fs.readFileSync(filePath, 'utf8');

  if (src.includes('rel="icon"')) {
    console.log('  [ok]      index.html (favicon already present)');
    return;
  }

  // Insert after <title>...</title>
  const newSrc = src.replace(
    /(<title>[^<]*<\/title>)/,
    `$1\n  ${FAVICON_LINK}`,
  );

  if (changed(src, newSrc)) {
    fs.writeFileSync(filePath, newSrc);
    console.log('  [patched] index.html (added favicon)');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const gameDir = process.argv[2];

if (!gameDir) {
  console.error('Usage: node scripts/adapt-game.mjs <game-dir>');
  process.exit(1);
}

const resolvedDir = path.resolve(gameDir);

if (!fs.existsSync(resolvedDir)) {
  console.error(`Error: Directory not found: ${resolvedDir}`);
  process.exit(1);
}

if (!fs.existsSync(path.join(resolvedDir, 'package.json'))) {
  console.error(`Error: No package.json in ${resolvedDir}`);
  process.exit(1);
}

// Derive game name from directory
const gameName = path.basename(resolvedDir);

console.log(`\nAdapting "${gameName}" for monorepo...\n`);

patchPackageJson(resolvedDir, gameName);
patchEventBus(resolvedDir);
patchGameState(resolvedDir);
patchViteConfig(resolvedDir);
patchConstants(resolvedDir);
patchIndexHtml(resolvedDir);

console.log('\nDone patching files.\n');
