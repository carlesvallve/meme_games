#!/usr/bin/env python3
"""Parse Unity .mat files (YAML) and produce a JSON material manifest.

Usage:
    python3 parse-materials.py <materials_dir> [output.json]

Reads all .mat files in <materials_dir>, extracts PBR-relevant properties
(_BaseColor, _Smoothness, _Metallic, texture refs), and writes a JSON
mapping material_name -> properties.
"""

import json
import os
import re
import sys
from typing import Optional


def parse_mat_file(path: str) -> Optional[dict]:
    """Extract material properties from a Unity .mat YAML file."""
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        text = f.read()

    # Material name — find m_Name within the Material: block (not MonoBehaviour)
    mat_block = re.search(r"^Material:(.+?)(?:^--- |\Z)", text, re.MULTILINE | re.DOTALL)
    if not mat_block:
        return None
    mat_text = mat_block.group(1)
    name_match = re.search(r"m_Name:\s*(.+)", mat_text)
    if not name_match:
        return None
    name = name_match.group(1).strip()
    if not name:
        return None

    mat: dict = {"name": name, "color": [1, 1, 1, 1], "smoothness": 0.5, "metallic": 0, "textures": {}}

    # Parse _BaseColor (URP) or _Color (Standard)
    for color_key in ["_BaseColor", "_Color"]:
        pattern = rf"{color_key}:\s*\{{r:\s*([\d.]+),\s*g:\s*([\d.]+),\s*b:\s*([\d.]+),\s*a:\s*([\d.]+)\}}"
        m = re.search(pattern, text)
        if m and color_key == "_BaseColor":
            mat["color"] = [float(m.group(i)) for i in range(1, 5)]
            break
        elif m and color_key == "_Color":
            mat["color"] = [float(m.group(i)) for i in range(1, 5)]

    # Parse _EmissionColor
    m = re.search(r"_EmissionColor:\s*\{r:\s*([\d.]+),\s*g:\s*([\d.]+),\s*b:\s*([\d.]+),\s*a:\s*([\d.]+)\}", text)
    if m:
        e = [float(m.group(i)) for i in range(1, 4)]
        if any(v > 0 for v in e):
            mat["emissive"] = e

    # Parse float properties
    float_map = {
        "_Smoothness": "smoothness",
        "_Glossiness": "smoothness",
        "_Metallic": "metallic",
        "_BumpScale": "normalScale",
        "_OcclusionStrength": "aoStrength",
        "_Cutoff": "alphaCutoff",
    }
    for unity_key, our_key in float_map.items():
        m = re.search(rf"- {unity_key}:\s*([\d.]+)", text)
        if m:
            mat[our_key] = float(m.group(1))

    # Parse texture references (check if fileID != 0, meaning a texture is assigned)
    tex_map = {
        "_BaseMap": "map",
        "_MainTex": "map",
        "_BumpMap": "normalMap",
        "_MetallicGlossMap": "metalnessMap",
        "_OcclusionMap": "aoMap",
        "_EmissionMap": "emissiveMap",
    }
    for unity_key, our_key in tex_map.items():
        # Multi-line: find the tex env entry, then check its m_Texture fileID
        pattern = rf"- {unity_key}:\s*\n\s*m_Texture:\s*\{{fileID:\s*(\d+)"
        m = re.search(pattern, text)
        if m and m.group(1) != "0":
            # Has a texture reference — we'd need to resolve the GUID
            guid_pattern = rf"- {unity_key}:\s*\n\s*m_Texture:\s*\{{fileID:\s*\d+,\s*guid:\s*([a-f0-9]+)"
            gm = re.search(guid_pattern, text)
            guid = gm.group(1) if gm else "unknown"
            mat["textures"][our_key] = {"guid": guid}

    # Render mode
    alpha_clip_m = re.search(r"- _AlphaClip:\s*([\d.]+)", text)
    surface_m = re.search(r"- _Surface:\s*([\d.]+)", text)
    if surface_m and float(surface_m.group(1)) == 1:
        mat["transparent"] = True
    if alpha_clip_m and float(alpha_clip_m.group(1)) == 1:
        mat["alphaTest"] = True

    return mat


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <materials_dir> [output.json]")
        sys.exit(1)

    mat_dir = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(mat_dir, "materials.json")

    materials = {}
    for fname in sorted(os.listdir(mat_dir)):
        if not fname.endswith(".mat"):
            continue
        fpath = os.path.join(mat_dir, fname)
        mat = parse_mat_file(fpath)
        if mat:
            materials[mat["name"]] = mat

    with open(out_path, "w") as f:
        json.dump(materials, f, indent=2)

    print(f"Parsed {len(materials)} materials -> {out_path}")
    for name, m in materials.items():
        c = m["color"]
        hex_color = "#{:02x}{:02x}{:02x}".format(
            int(c[0] * 255), int(c[1] * 255), int(c[2] * 255)
        )
        print(f"  {name}: {hex_color} smooth={m['smoothness']:.2f} metal={m['metallic']:.1f}")


if __name__ == "__main__":
    main()
