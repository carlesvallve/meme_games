#!/usr/bin/env bash
set -euo pipefail

# adapt-game.sh — Convert a game-creator-generated game to use @sttg/game-base.
#
# Usage:
#   ./scripts/adapt-game.sh <game-name>
#
# Arguments:
#   game-name  Name of the game directory under games/ (e.g. "flappy-meme")
#
# What it does:
#   1. Runs the Node adapt script to patch source files
#   2. Runs pnpm install to link workspace deps
#   3. Verifies the game builds
#
# Idempotent — safe to run multiple times on the same game.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <game-name>"
  echo "  game-name: directory name under games/ (e.g. flappy-meme)"
  exit 1
fi

GAME_NAME="$1"
GAME_DIR="$REPO_ROOT/games/$GAME_NAME"

if [[ ! -d "$GAME_DIR" ]]; then
  echo "Error: Game directory not found: $GAME_DIR"
  exit 1
fi

# --- Run Node adapt script ---

echo "==> Adapting $GAME_NAME for monorepo..."
node "$REPO_ROOT/scripts/adapt-game.mjs" "$GAME_DIR"

# --- Install dependencies ---

echo "==> Running pnpm install..."
cd "$REPO_ROOT"
pnpm install

# --- Verify build ---

echo "==> Verifying build..."
pnpm --filter "@sttg/$GAME_NAME" build

echo ""
echo "==> Done! $GAME_NAME is now using @sttg/game-base."
echo ""
echo "Next steps:"
echo "  pnpm --filter @sttg/$GAME_NAME dev    # start dev server"
echo "  pnpm --filter @sttg/$GAME_NAME build  # production build"
