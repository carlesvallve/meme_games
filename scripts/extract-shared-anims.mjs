#!/usr/bin/env node
/**
 * Extract shared animations from q-* character packs.
 *
 * For each rig group with 3+ models sharing the same skeleton:
 * 1. Extract animations into shared-anims[-subgroup].glb (skeleton + anims only)
 *    - Uses gltf-transform (animations have no Draco mesh data to preserve)
 * 2. Strip animations from each model at the RAW BINARY level
 *    - Preserves original Draco compression by only modifying JSON + trimming binary buffer
 *
 * Usage: node scripts/extract-shared-anims.mjs [--dry-run]
 */

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

const MODELS_DIR = 'templates/three-react/public/models';
const SKIP_PACKS = ['q-casual']; // already done
const MIN_GROUP_SIZE = 3;
const DRY_RUN = process.argv.includes('--dry-run');

// ─── GLB Binary Utilities ────────────────────────────────────────────

/** Parse a GLB file into { json, binChunk }. */
function parseGlb(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== 0x46546C67) throw new Error('Not a GLB file');

  // Chunk 0: JSON
  const jsonLen = view.getUint32(12, true);
  const jsonType = view.getUint32(16, true);
  if (jsonType !== 0x4E4F534A) throw new Error('First chunk is not JSON');
  const jsonBytes = buffer.slice(20, 20 + jsonLen);
  const json = JSON.parse(new TextDecoder().decode(jsonBytes));

  // Chunk 1: BIN (optional)
  let binChunk = null;
  const binOffset = 20 + jsonLen;
  if (binOffset + 8 <= buffer.byteLength) {
    const binLen = view.getUint32(binOffset, true);
    binChunk = buffer.slice(binOffset + 8, binOffset + 8 + binLen);
  }

  return { json, binChunk };
}

/** Rebuild a GLB from modified JSON + binary chunk. */
function buildGlb(json, binChunk) {
  const jsonStr = JSON.stringify(json);
  // JSON chunk must be padded to 4-byte boundary with spaces
  const jsonPadded = jsonStr + ' '.repeat((4 - (jsonStr.length % 4)) % 4);
  const jsonBuf = new TextEncoder().encode(jsonPadded);

  // BIN chunk must be padded to 4-byte boundary with zeros
  let binPadded = binChunk;
  if (binChunk && binChunk.byteLength % 4 !== 0) {
    const pad = 4 - (binChunk.byteLength % 4);
    binPadded = new Uint8Array(binChunk.byteLength + pad);
    binPadded.set(new Uint8Array(binChunk.buffer, binChunk.byteOffset, binChunk.byteLength));
  }

  const totalLen = 12 + 8 + jsonBuf.byteLength + (binPadded ? 8 + binPadded.byteLength : 0);
  const out = new Uint8Array(totalLen);
  const view = new DataView(out.buffer);

  // Header
  view.setUint32(0, 0x46546C67, true); // magic
  view.setUint32(4, 2, true);           // version
  view.setUint32(8, totalLen, true);     // total length

  // JSON chunk
  let offset = 12;
  view.setUint32(offset, jsonBuf.byteLength, true);
  view.setUint32(offset + 4, 0x4E4F534A, true); // JSON
  out.set(jsonBuf, offset + 8);
  offset += 8 + jsonBuf.byteLength;

  // BIN chunk
  if (binPadded) {
    view.setUint32(offset, binPadded.byteLength, true);
    view.setUint32(offset + 4, 0x004E4942, true); // BIN
    out.set(binPadded instanceof Uint8Array ? binPadded : new Uint8Array(binPadded), offset + 8);
  }

  return out;
}

// ─── Skeleton Analysis ───────────────────────────────────────────────

/** Build skeleton fingerprint from glTF JSON. */
function skeletonFingerprint(gltf) {
  if (!gltf.skins || gltf.skins.length === 0) return null;
  const skin = gltf.skins[0];
  const joints = skin.joints || [];
  if (joints.length === 0) return null;

  const nodes = gltf.nodes || [];
  const bones = [];
  const edges = [];
  const jointSet = new Set(joints);

  for (const jointIdx of joints) {
    const node = nodes[jointIdx];
    if (!node) continue;
    bones.push(node.name || `node_${jointIdx}`);
    if (node.children) {
      for (const childIdx of node.children) {
        if (jointSet.has(childIdx)) {
          const childNode = nodes[childIdx];
          edges.push(`${node.name}->${childNode?.name}`);
        }
      }
    }
  }

  bones.sort();
  edges.sort();
  return JSON.stringify({ bones, edges });
}

/** Group models in a pack by skeleton fingerprint. */
async function groupByRig(packPath) {
  const files = (await readdir(packPath)).filter(f => f.endsWith('.glb') && !f.startsWith('shared-anims'));
  const groups = new Map();

  for (const file of files) {
    const filePath = join(packPath, file);
    const buffer = await readFile(filePath);
    const { json } = parseGlb(buffer);
    const fp = skeletonFingerprint(json);
    const key = fp ?? 'NO_SKELETON';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      name: basename(file, '.glb'),
      file,
      path: filePath,
      fileSize: buffer.byteLength,
    });
  }

  return groups;
}

// ─── Extraction (gltf-transform — no Draco mesh data to preserve) ────

/** Create a shared-anims GLB: skeleton + animations only, no mesh geometry. */
async function extractSharedAnims(io, representativePath, outputPath) {
  const doc = await io.read(representativePath);
  const root = doc.getRoot();

  // Remove all meshes and their primitives
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) prim.dispose();
    mesh.dispose();
  }

  // Remove materials and textures
  for (const mat of root.listMaterials()) mat.dispose();
  for (const tex of root.listTextures()) tex.dispose();

  // Clear mesh references from nodes
  for (const node of root.listNodes()) {
    if (node.getMesh()) node.setMesh(null);
  }

  const binary = await io.writeBinary(doc);
  await writeFile(outputPath, binary);

  return {
    animCount: root.listAnimations().length,
    size: binary.byteLength,
  };
}

// ─── Stripping (raw binary — preserves original Draco compression) ────

/**
 * Strip animations from a GLB at the binary level.
 * Preserves original Draco compression by only modifying JSON metadata
 * and compacting the binary buffer to remove animation data.
 */
async function stripAnimationsRaw(modelPath) {
  const buffer = await readFile(modelPath);
  const { json, binChunk } = parseGlb(buffer);

  const animCount = json.animations?.length ?? 0;
  if (animCount === 0) return { stripped: 0 };

  // Collect all accessor indices used by animations
  const animAccessorIndices = new Set();
  for (const anim of json.animations) {
    for (const sampler of anim.samplers || []) {
      if (sampler.input != null) animAccessorIndices.add(sampler.input);
      if (sampler.output != null) animAccessorIndices.add(sampler.output);
    }
  }

  // Check which accessors are ONLY used by animations (not shared with mesh/skin)
  const nonAnimUsers = new Set();
  // Mesh accessors
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      if (prim.indices != null) nonAnimUsers.add(prim.indices);
      for (const attr of Object.values(prim.attributes || {})) nonAnimUsers.add(attr);
      // Draco extension references
      const dracoExt = prim.extensions?.KHR_draco_mesh_compression;
      if (dracoExt) {
        // Draco bufferView is separate, but the accessor indices are shared
        for (const attr of Object.values(dracoExt.attributes || {})) {
          // These are draco attribute IDs, not accessor indices — skip
        }
      }
      // Morph targets
      for (const target of prim.targets || []) {
        for (const attr of Object.values(target)) nonAnimUsers.add(attr);
      }
    }
  }
  // Skin accessors (inverseBindMatrices)
  for (const skin of json.skins || []) {
    if (skin.inverseBindMatrices != null) nonAnimUsers.add(skin.inverseBindMatrices);
  }

  // Animation-only accessors (not used by mesh/skin)
  const pureAnimAccessors = new Set();
  for (const idx of animAccessorIndices) {
    if (!nonAnimUsers.has(idx)) pureAnimAccessors.add(idx);
  }

  // Collect bufferView indices used only by animation-only accessors
  const animBufferViewIndices = new Set();
  for (const accIdx of pureAnimAccessors) {
    const acc = json.accessors[accIdx];
    if (acc && acc.bufferView != null) {
      animBufferViewIndices.add(acc.bufferView);
    }
  }

  // Verify no non-anim accessor references these bufferViews
  for (let i = 0; i < (json.accessors || []).length; i++) {
    if (pureAnimAccessors.has(i)) continue;
    const acc = json.accessors[i];
    if (acc && animBufferViewIndices.has(acc.bufferView)) {
      // Shared bufferView — don't remove it
      animBufferViewIndices.delete(acc.bufferView);
    }
  }

  // Also check image bufferViews
  for (const img of json.images || []) {
    if (img.bufferView != null) animBufferViewIndices.delete(img.bufferView);
  }
  // And Draco bufferViews
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const dracoExt = prim.extensions?.KHR_draco_mesh_compression;
      if (dracoExt && dracoExt.bufferView != null) {
        animBufferViewIndices.delete(dracoExt.bufferView);
      }
    }
  }

  // Build a compacted binary buffer without the animation bufferViews
  const oldBufViews = json.bufferViews || [];
  const keepBufViewMap = new Map(); // old index → new index
  const newBufViews = [];
  let newBinParts = [];
  let newOffset = 0;

  for (let i = 0; i < oldBufViews.length; i++) {
    if (animBufferViewIndices.has(i)) continue; // skip animation data
    const bv = { ...oldBufViews[i] };
    const oldOffset = bv.byteOffset || 0;
    const len = bv.byteLength;

    // Copy data from old binary chunk
    if (binChunk) {
      const chunk = binChunk.slice(oldOffset, oldOffset + len);
      newBinParts.push(chunk);
    }

    bv.byteOffset = newOffset;
    keepBufViewMap.set(i, newBufViews.length);
    newBufViews.push(bv);
    // Align to 4 bytes
    const aligned = Math.ceil(len / 4) * 4;
    newOffset += aligned;
  }

  // Rebuild binary buffer
  const newBin = new Uint8Array(newOffset);
  let pos = 0;
  for (const part of newBinParts) {
    newBin.set(new Uint8Array(part.buffer, part.byteOffset, part.byteLength), pos);
    pos += Math.ceil(part.byteLength / 4) * 4;
  }

  // Remap accessor bufferView indices
  for (const acc of json.accessors || []) {
    if (acc.bufferView != null) {
      if (keepBufViewMap.has(acc.bufferView)) {
        acc.bufferView = keepBufViewMap.get(acc.bufferView);
      }
    }
  }

  // Remap image bufferView indices
  for (const img of json.images || []) {
    if (img.bufferView != null && keepBufViewMap.has(img.bufferView)) {
      img.bufferView = keepBufViewMap.get(img.bufferView);
    }
  }

  // Remap Draco bufferView indices
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      const dracoExt = prim.extensions?.KHR_draco_mesh_compression;
      if (dracoExt && dracoExt.bufferView != null && keepBufViewMap.has(dracoExt.bufferView)) {
        dracoExt.bufferView = keepBufViewMap.get(dracoExt.bufferView);
      }
    }
  }

  // Remap skin inverseBindMatrices
  for (const skin of json.skins || []) {
    if (skin.inverseBindMatrices != null && keepBufViewMap.has(json.accessors[skin.inverseBindMatrices]?.bufferView)) {
      // Accessor index stays same, but its bufferView was already remapped above
    }
  }

  // Update bufferViews and buffer
  json.bufferViews = newBufViews;
  if (json.buffers && json.buffers.length > 0) {
    json.buffers[0].byteLength = newBin.byteLength;
  }

  // Remove animations (and mark accessors as unused — they stay in the array to preserve indices)
  delete json.animations;

  // Rebuild GLB
  const newGlb = buildGlb(json, newBin);
  await writeFile(modelPath, newGlb);

  return {
    stripped: animCount,
    newSize: newGlb.byteLength,
  };
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  // gltf-transform IO only for extracting shared anims (no mesh data to preserve)
  const io = new NodeIO()
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });

  const entries = await readdir(MODELS_DIR);
  const packs = entries.filter(e => e.startsWith('q-') && !SKIP_PACKS.includes(e));
  packs.sort();

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  EXTRACT SHARED ANIMATIONS${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`${'='.repeat(70)}\n`);

  let totalOriginalSize = 0;
  let totalNewSize = 0;
  const packResults = [];

  for (const pack of packs) {
    const packPath = join(MODELS_DIR, pack);
    const packStat = await stat(packPath);
    if (!packStat.isDirectory()) continue;

    console.log(`\n── ${pack} ${'─'.repeat(55 - pack.length)}`);
    const groups = await groupByRig(packPath);

    let groupIdx = 0;
    const candidateGroups = [];

    for (const [fp, members] of groups) {
      groupIdx++;
      if (fp === 'NO_SKELETON' || members.length < MIN_GROUP_SIZE) {
        console.log(`  Group ${groupIdx}: ${members.length} models — skipped (${fp === 'NO_SKELETON' ? 'no skeleton' : 'too few'})`);
        for (const m of members) {
          totalOriginalSize += m.fileSize;
          totalNewSize += m.fileSize;
        }
        continue;
      }
      candidateGroups.push({ groupIdx, members });
    }

    if (candidateGroups.length === 0) {
      console.log(`  No candidate groups — pack unchanged`);
      continue;
    }

    for (const { groupIdx, members } of candidateGroups) {
      const groupOrigSize = members.reduce((s, m) => s + m.fileSize, 0);
      totalOriginalSize += groupOrigSize;

      const suffix = candidateGroups.length > 1 ? `-${groupIdx}` : '';
      const sharedAnimsFile = `shared-anims${suffix}.glb`;
      const sharedAnimsPath = join(packPath, sharedAnimsFile);

      const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name));
      const representative = sorted[0];

      console.log(`  Group ${groupIdx}: ${members.length} models → ${sharedAnimsFile}`);
      console.log(`    Representative: ${representative.name}`);
      console.log(`    Models: ${sorted.map(m => m.name).join(', ')}`);

      if (DRY_RUN) {
        totalNewSize += groupOrigSize;
        continue;
      }

      // Step 1: Extract shared animations (via gltf-transform — no mesh Draco to preserve)
      console.log(`    Extracting animations from ${representative.name}...`);
      const animResult = await extractSharedAnims(io, representative.path, sharedAnimsPath);
      console.log(`    → ${sharedAnimsFile}: ${animResult.animCount} anims, ${(animResult.size / 1024).toFixed(0)} KB`);

      // Step 2: Strip animations from each model (raw binary — preserves Draco)
      for (const model of sorted) {
        console.log(`    Stripping anims from ${model.name}...`);
        const result = await stripAnimationsRaw(model.path);
        if (result.newSize !== undefined) {
          const pct = ((1 - result.newSize / model.fileSize) * 100).toFixed(0);
          console.log(`      ${(model.fileSize / 1024).toFixed(0)} KB → ${(result.newSize / 1024).toFixed(0)} KB (-${pct}%, stripped ${result.stripped} anims)`);
        }
      }

      // Measure final sizes
      const finalSharedSize = (await stat(sharedAnimsPath)).size;
      let finalModelsSize = 0;
      for (const model of sorted) {
        finalModelsSize += (await stat(model.path)).size;
      }
      const finalTotal = finalSharedSize + finalModelsSize;
      totalNewSize += finalTotal;

      const savedPct = ((1 - finalTotal / groupOrigSize) * 100).toFixed(0);
      console.log(`    Final: ${(finalTotal / 1024).toFixed(0)} KB (was ${(groupOrigSize / 1024).toFixed(0)} KB, saved ${savedPct}%)`);
      console.log(`      shared-anims: ${(finalSharedSize / 1024).toFixed(0)} KB, models: ${(finalModelsSize / 1024).toFixed(0)} KB`);

      packResults.push({
        pack, groupIdx, sharedAnimsFile,
        modelCount: members.length,
        originalSize: groupOrigSize,
        finalSize: finalTotal,
        models: sorted.map(m => m.name),
      });
    }
  }

  // Summary
  console.log(`\n${'='.repeat(70)}`);
  console.log('  RESULTS');
  console.log(`${'='.repeat(70)}\n`);

  for (const r of packResults) {
    const savings = ((1 - r.finalSize / r.originalSize) * 100).toFixed(0);
    console.log(`  ${r.pack}/${r.sharedAnimsFile}: ${r.modelCount} models, ${savings}% saved`);
  }

  if (!DRY_RUN && packResults.length > 0) {
    console.log(`\n  Overall candidate groups:`);
    console.log(`    Before: ${(totalOriginalSize / (1024 * 1024)).toFixed(1)} MB`);
    console.log(`    After:  ${(totalNewSize / (1024 * 1024)).toFixed(1)} MB`);
    const savedMB = (totalOriginalSize - totalNewSize) / (1024 * 1024);
    const savedPct = ((1 - totalNewSize / totalOriginalSize) * 100).toFixed(0);
    console.log(`    Saved:  ${savedMB.toFixed(1)} MB (${savedPct}%)`);
  }

  console.log(`\n  ── Mapping for CharacterModelDefs.ts ──\n`);
  for (const r of packResults) {
    console.log(`  ${r.pack}: sharedAnimUrl='/models/${r.pack}/${r.sharedAnimsFile}'`);
    console.log(`    Models: ${r.models.join(', ')}`);
  }
  console.log('');
}

main().catch(console.error);
