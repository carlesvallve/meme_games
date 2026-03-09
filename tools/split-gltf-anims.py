#!/usr/bin/env python3
"""
split-gltf-anims.py — Extract shared animations from glTF character files.

These .gltf files contain mesh + skeleton + animations with embedded base64
buffers. Since all 52 characters share the same skeleton and identical 16
animation clips, we:

1. Extract animations from one source file → shared-anims.gltf
2. Strip animations from all character files → mesh + skeleton only

Expected savings: ~200MB → ~12MB (52 mesh-only × ~175KB + 1 shared × ~650KB)

Usage:
    python3 tools/split-gltf-anims.py [--dir DIR] [--source NAME] [--dry-run]
"""

import argparse
import base64
import copy
import json
import os
import sys
from pathlib import Path

GLTF_DIR_DEFAULT = 'templates/three-react/public/models/gltf-chars'
SOURCE_DEFAULT = 'BaseCharacter'
SHARED_FILENAME = 'shared-anims.gltf'


def decode_buffer(gltf: dict) -> bytes:
    """Decode the single base64 data URI buffer."""
    uri = gltf['buffers'][0]['uri']
    prefix = 'data:application/octet-stream;base64,'
    if not uri.startswith(prefix):
        raise ValueError(f'Unexpected buffer URI format: {uri[:60]}...')
    return base64.b64decode(uri[len(prefix):])


def encode_buffer(raw: bytes) -> str:
    """Encode raw bytes as a data URI."""
    b64 = base64.b64encode(raw).decode('ascii')
    return f'data:application/octet-stream;base64,{b64}'


def get_accessor_sets(gltf: dict) -> tuple[set[int], set[int], set[int]]:
    """Return (mesh_accessors, skin_accessors, anim_accessors) index sets."""
    mesh_acc = set()
    for mesh in gltf.get('meshes', []):
        for prim in mesh['primitives']:
            for idx in prim['attributes'].values():
                mesh_acc.add(idx)
            if 'indices' in prim:
                mesh_acc.add(prim['indices'])

    skin_acc = set()
    for skin in gltf.get('skins', []):
        if 'inverseBindMatrices' in skin:
            skin_acc.add(skin['inverseBindMatrices'])

    anim_acc = set()
    for anim in gltf.get('animations', []):
        for sampler in anim['samplers']:
            anim_acc.add(sampler['input'])
            anim_acc.add(sampler['output'])

    return mesh_acc, skin_acc, anim_acc


def rebuild_with_accessors(gltf: dict, raw_buf: bytes, keep_indices: set[int]) -> tuple[list, list, bytes]:
    """Rebuild accessors, bufferViews, and buffer keeping only specified accessor indices.
    Returns (new_accessors, new_bufferViews, new_buffer_bytes) with remapped indices."""
    sorted_keep = sorted(keep_indices)
    old_to_new = {old: new for new, old in enumerate(sorted_keep)}

    new_accessors = []
    new_bvs = []
    new_buf = bytearray()

    for old_idx in sorted_keep:
        acc = copy.deepcopy(gltf['accessors'][old_idx])
        bv = copy.deepcopy(gltf['bufferViews'][old_idx])  # 1:1 mapping

        # Extract the raw bytes for this bufferView
        offset = bv.get('byteOffset', 0)
        length = bv['byteLength']
        chunk = raw_buf[offset:offset + length]

        # Update bufferView to point at new position
        bv['byteOffset'] = len(new_buf)
        bv['buffer'] = 0
        new_bvs.append(bv)

        # Update accessor
        new_idx = len(new_accessors)
        acc['bufferView'] = new_idx
        new_accessors.append(acc)

        new_buf.extend(chunk)

    return new_accessors, new_bvs, bytes(new_buf), old_to_new


def extract_shared_anims(gltf: dict, raw_buf: bytes) -> dict:
    """Create a new glTF with only animations + skeleton nodes (no mesh)."""
    _, skin_acc, anim_acc = get_accessor_sets(gltf)

    # We need animation accessors + skin accessor (for the skeleton binding)
    keep = anim_acc | skin_acc
    new_accessors, new_bvs, new_buf, old_to_new = rebuild_with_accessors(gltf, raw_buf, keep)

    # Build output glTF
    out = {
        'asset': copy.deepcopy(gltf['asset']),
        'scene': 0,
        'scenes': [{'nodes': copy.deepcopy(gltf['scenes'][0]['nodes'])}],
        'nodes': copy.deepcopy(gltf['nodes']),
        'skins': copy.deepcopy(gltf['skins']),
        'animations': copy.deepcopy(gltf['animations']),
        'accessors': new_accessors,
        'bufferViews': new_bvs,
        'buffers': [{'byteLength': len(new_buf), 'uri': encode_buffer(new_buf)}],
    }

    # Remap skin accessor
    for skin in out['skins']:
        if 'inverseBindMatrices' in skin:
            skin['inverseBindMatrices'] = old_to_new[skin['inverseBindMatrices']]

    # Remap animation sampler accessors
    for anim in out['animations']:
        for sampler in anim['samplers']:
            sampler['input'] = old_to_new[sampler['input']]
            sampler['output'] = old_to_new[sampler['output']]

    # Remove mesh references from nodes (keep skeleton structure)
    for node in out['nodes']:
        node.pop('mesh', None)

    # Remove meshes and materials
    out.pop('meshes', None)
    out.pop('materials', None)

    return out


def strip_anims(gltf: dict, raw_buf: bytes) -> dict:
    """Remove animations from a glTF, keeping mesh + skeleton only."""
    mesh_acc, skin_acc, _ = get_accessor_sets(gltf)

    keep = mesh_acc | skin_acc
    new_accessors, new_bvs, new_buf, old_to_new = rebuild_with_accessors(gltf, raw_buf, keep)

    out = copy.deepcopy(gltf)
    out['animations'] = []
    out['accessors'] = new_accessors
    out['bufferViews'] = new_bvs
    out['buffers'] = [{'byteLength': len(new_buf), 'uri': encode_buffer(new_buf)}]

    # Remap mesh accessors
    for mesh in out['meshes']:
        for prim in mesh['primitives']:
            for attr_name in prim['attributes']:
                prim['attributes'][attr_name] = old_to_new[prim['attributes'][attr_name]]
            if 'indices' in prim:
                prim['indices'] = old_to_new[prim['indices']]

    # Remap skin accessors
    for skin in out['skins']:
        if 'inverseBindMatrices' in skin:
            skin['inverseBindMatrices'] = old_to_new[skin['inverseBindMatrices']]

    return out


def main():
    parser = argparse.ArgumentParser(description='Split glTF animations into shared file')
    parser.add_argument('--dir', default=GLTF_DIR_DEFAULT, help='Directory containing .gltf files')
    parser.add_argument('--source', default=SOURCE_DEFAULT, help='Source model to extract animations from')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be done without writing')
    args = parser.parse_args()

    gltf_dir = Path(args.dir)
    if not gltf_dir.exists():
        print(f'Error: directory {gltf_dir} does not exist', file=sys.stderr)
        sys.exit(1)

    shared_path = gltf_dir / SHARED_FILENAME
    source_path = gltf_dir / f'{args.source}.gltf'

    if not source_path.exists():
        print(f'Error: source file {source_path} does not exist', file=sys.stderr)
        sys.exit(1)

    # Phase 1: Extract shared animations
    print(f'=== Phase 1: Extract shared animations from {args.source} ===')
    with open(source_path) as f:
        source_gltf = json.load(f)

    raw_buf = decode_buffer(source_gltf)
    shared_gltf = extract_shared_anims(source_gltf, raw_buf)

    anim_names = [a['name'] for a in shared_gltf['animations']]
    shared_size = len(json.dumps(shared_gltf))
    print(f'  Animations: {len(anim_names)} — {", ".join(anim_names)}')
    print(f'  Shared file size: {shared_size / 1024:.1f} KB')

    if not args.dry_run:
        with open(shared_path, 'w') as f:
            json.dump(shared_gltf, f)
        print(f'  Written: {shared_path}')
    else:
        print(f'  [dry-run] Would write: {shared_path}')

    # Phase 2: Strip animations from all character files
    print(f'\n=== Phase 2: Strip animations from character files ===')
    gltf_files = sorted(gltf_dir.glob('*.gltf'))
    total_before = 0
    total_after = 0
    stripped = 0

    for gltf_path in gltf_files:
        if gltf_path.name == SHARED_FILENAME:
            continue

        with open(gltf_path) as f:
            gltf = json.load(f)

        if not gltf.get('animations'):
            print(f'  {gltf_path.name}: no animations, skipping')
            continue

        before_size = gltf_path.stat().st_size
        raw = decode_buffer(gltf)
        stripped_gltf = strip_anims(gltf, raw)
        out_json = json.dumps(stripped_gltf)
        after_size = len(out_json)

        total_before += before_size
        total_after += after_size
        stripped += 1

        savings_pct = (1 - after_size / before_size) * 100
        print(f'  {gltf_path.name}: {before_size/1024:.0f}KB → {after_size/1024:.0f}KB ({savings_pct:.0f}% reduction)')

        if not args.dry_run:
            with open(gltf_path, 'w') as f:
                f.write(out_json)

    print(f'\n=== Summary ===')
    print(f'  Files processed: {stripped}')
    print(f'  Before: {total_before / 1024 / 1024:.1f} MB')
    print(f'  After:  {total_after / 1024 / 1024:.1f} MB (characters only)')
    print(f'  Shared: {shared_size / 1024:.0f} KB')
    print(f'  Total:  {(total_after + shared_size) / 1024 / 1024:.1f} MB')
    print(f'  Savings: {(total_before - total_after - shared_size) / 1024 / 1024:.1f} MB')
    if args.dry_run:
        print('\n  [dry-run] No files were modified.')


if __name__ == '__main__':
    main()
