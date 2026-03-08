#!/bin/bash
# Convert Imminence characters + Kevin Iglesias animations → split GLBs
#
# Usage:
#   ./convert.sh
#
# Output:
#   public/models/scifi-soldiers/
#     Imminence-Update-Male.glb       ← mesh + skeleton only
#     Imminence-Update-Female.glb     ← mesh + skeleton only
#     anims/
#       Idles.glb                     ← shared animation clips
#       Movement.glb
#       Combat.glb
#       Social.glb
#       Misc.glb
#       Work.glb

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SCRIPT="$SCRIPT_DIR/convert-fbx.py"
OUTPUT_DIR="$PROJECT_DIR/public/models/scifi-soldiers"

# Source paths
UNITY_DIR="/Users/carlesvallve/work/UnityProjects/DL Test/Assets"
MESH_DIR="$UNITY_DIR/Imminence - Sci-fi Soldiers/Contents/Meshes"
ANIM_DIR="$UNITY_DIR/Kevin Iglesias/Human Animations/Animations/Male"
MAT_JSON="$OUTPUT_DIR/materials.json"

# Reference skeleton for retargeting (any Imminence character works)
REF_FBX="$MESH_DIR/Imminence Update Male.fbx"

echo "================================================"
echo "Split GLB Pipeline"
echo "================================================"
echo "Meshes:  $MESH_DIR"
echo "Anims:   $ANIM_DIR"
echo "Output:  $OUTPUT_DIR"
echo ""

mkdir -p "$OUTPUT_DIR/anims"

# ── Step 1: Mesh-only GLBs (Imminence characters) ─────────────────

CHARACTERS=("Imminence Update Male" "Imminence Update Female")

echo "--- Step 1: Character meshes ---"
for char in "${CHARACTERS[@]}"; do
    fbx="$MESH_DIR/${char}.fbx"
    out_name=$(echo "$char" | tr ' ' '-')
    out="$OUTPUT_DIR/${out_name}.glb"

    if [ ! -f "$fbx" ]; then
        echo "  SKIP: $fbx not found"
        continue
    fi

    echo "  Converting: $char"
    MAT_ARGS=()
    if [ -f "$MAT_JSON" ]; then
        MAT_ARGS=(--materials "$MAT_JSON")
    fi

    cd /tmp && /opt/homebrew/bin/blender --background --python "$SCRIPT" -- \
        --mesh-only --fbx "$fbx" --out "$out" "${MAT_ARGS[@]}" 2>&1 | \
        grep -E "Exported" || true
done

# ── Step 2: Animation GLBs (per category) ─────────────────────────

CATEGORIES=("Combat" "Idles" "Misc" "Movement" "Social" "Work")

echo ""
echo "--- Step 2: Shared animation sets ---"
for cat in "${CATEGORIES[@]}"; do
    cat_dir="$ANIM_DIR/$cat"
    out="$OUTPUT_DIR/anims/${cat}.glb"

    if [ ! -d "$cat_dir" ]; then
        echo "  SKIP: $cat (no directory)"
        continue
    fi

    # Collect all FBX files in this category (recursively)
    ARGS=(--anim-only --ref-fbx "$REF_FBX" --out "$out")
    count=0
    while IFS= read -r -d '' f; do
        ARGS+=(--anim-fbx "$f")
        ((count++))
    done < <(find "$cat_dir" -name "*.fbx" -print0 | sort -z)

    if [ "$count" -eq 0 ]; then
        echo "  SKIP: $cat (no FBX files)"
        continue
    fi

    echo "  Converting: $cat ($count animations)"
    cd /tmp && /opt/homebrew/bin/blender --background --python "$SCRIPT" -- \
        "${ARGS[@]}" 2>&1 | grep -E "(retarget|Exported|Error)" || true
done

echo ""
echo "================================================"
echo "Done! Output:"
echo ""
echo "Meshes:"
ls -lh "$OUTPUT_DIR"/Imminence*.glb 2>/dev/null || echo "  (none)"
echo ""
echo "Animations:"
ls -lh "$OUTPUT_DIR"/anims/*.glb 2>/dev/null || echo "  (none)"
echo "================================================"
