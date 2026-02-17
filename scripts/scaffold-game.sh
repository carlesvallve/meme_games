#!/usr/bin/env bash
set -euo pipefail

# scaffold-game.sh — Create a new game in the monorepo from a plugin template.
#
# Usage:
#   ./scripts/scaffold-game.sh <engine> <game-name>
#
# Arguments:
#   engine     2d (Phaser+Vite) or 3d (Three.js+Vite)
#   game-name  kebab-case name, e.g. "flappy-meme"
#
# What it does:
#   1. Copies the game-creator plugin template into games/<game-name>/
#   2. Patches package.json for the pnpm workspace (@sttg scope, workspace deps, etc.)
#   3. Updates index.html <title>
#   4. Runs pnpm install to link everything
#   5. Verifies the game builds
#
# Example:
#   ./scripts/scaffold-game.sh 2d flappy-meme

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# --- Parse arguments ---

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <engine> <game-name>"
  echo "  engine:    2d or 3d"
  echo "  game-name: kebab-case (e.g. flappy-meme)"
  exit 1
fi

ENGINE="$1"
GAME_NAME="$2"
GAME_DIR="$REPO_ROOT/games/$GAME_NAME"

# Validate engine
case "$ENGINE" in
  2d) TEMPLATE_DIR_NAME="phaser-2d" ;;
  3d) TEMPLATE_DIR_NAME="threejs-3d" ;;
  *)
    echo "Error: engine must be '2d' or '3d', got '$ENGINE'"
    exit 1
    ;;
esac

# Check game doesn't already exist
if [[ -d "$GAME_DIR" ]]; then
  echo "Error: $GAME_DIR already exists"
  exit 1
fi

# --- Locate the plugin template ---

TEMPLATE_DIR=""
SEARCH_PATHS=(
  "$HOME/.claude/plugins/cache/local-plugins/game-creator/1.0.0/templates/$TEMPLATE_DIR_NAME"
  "$HOME/.claude/plugins/marketplaces/game-creator/templates/$TEMPLATE_DIR_NAME"
)

for path in "${SEARCH_PATHS[@]}"; do
  if [[ -d "$path" ]]; then
    TEMPLATE_DIR="$path"
    break
  fi
done

if [[ -z "$TEMPLATE_DIR" ]]; then
  echo "Error: Could not find game-creator plugin template ($TEMPLATE_DIR_NAME)"
  echo "Searched:"
  for path in "${SEARCH_PATHS[@]}"; do
    echo "  - $path"
  done
  echo ""
  echo "Make sure the game-creator plugin is installed:"
  echo "  /plugin install game-creator"
  exit 1
fi

echo "==> Using template: $TEMPLATE_DIR"

# --- Copy template ---

echo "==> Copying template to games/$GAME_NAME/"
cp -r "$TEMPLATE_DIR" "$GAME_DIR"

# Remove any npm lockfile that may have been in the template
rm -f "$GAME_DIR/package-lock.json"

# --- Patch index.html title ---

TITLE=$(echo "$GAME_NAME" | sed 's/-/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)}1')

if [[ -f "$GAME_DIR/index.html" ]]; then
  sed -i '' "s|<title>.*</title>|<title>$TITLE</title>|" "$GAME_DIR/index.html"
  echo "==> Set <title> to \"$TITLE\""
fi

# --- Adapt game for monorepo (patches source files, installs deps, verifies build) ---

"$REPO_ROOT/scripts/adapt-game.sh" "$GAME_NAME"

echo ""
echo "==> Done! Game scaffolded at games/$GAME_NAME/"
