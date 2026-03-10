#!/usr/bin/env node
/**
 * Analyze skeleton rigs across q-* character packs.
 * Groups models by identical bone hierarchy → candidates for shared animations.
 *
 * Usage: node scripts/analyze-skeletons.mjs
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';

const MODELS_DIR = 'templates/three-react/public/models';
const SKIP_PACKS = ['q-casual']; // already done

/**
 * Parse a GLB file's JSON chunk (no Draco decoding needed — just skeleton metadata).
 * GLB layout: 12-byte header → chunk0 (JSON) → chunk1 (BIN)
 */
function parseGlbJson(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  // GLB header: magic(4) version(4) length(4)
  const magic = view.getUint32(0, true);
  if (magic !== 0x46546C67) throw new Error('Not a GLB file');
  // Chunk 0: length(4) type(4) data(length)
  const chunkLen = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  if (chunkType !== 0x4E4F534A) throw new Error('First chunk is not JSON');
  const jsonBytes = buffer.slice(20, 20 + chunkLen);
  return JSON.parse(new TextDecoder().decode(jsonBytes));
}

/** Build skeleton fingerprint from glTF JSON. */
function skeletonFingerprint(gltf) {
  if (!gltf.skins || gltf.skins.length === 0) return null;

  const skin = gltf.skins[0]; // Use first skin
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
    // Find parent-child edges within the skeleton
    if (node.children) {
      for (const childIdx of node.children) {
        if (jointSet.has(childIdx)) {
          const childNode = nodes[childIdx];
          edges.push(`${node.name || `node_${jointIdx}`}->${childNode?.name || `node_${childIdx}`}`);
        }
      }
    }
  }

  bones.sort();
  edges.sort();
  return JSON.stringify({ bones, edges });
}

/** Get animation names from glTF JSON. */
function getAnimationNames(gltf) {
  if (!gltf.animations) return [];
  return gltf.animations.map((a, i) => a.name || `anim_${i}`);
}

async function analyzePackDir(packPath) {
  const files = (await readdir(packPath)).filter(f => f.endsWith('.glb'));
  const results = [];

  for (const file of files) {
    const filePath = join(packPath, file);
    const modelName = basename(file, '.glb');
    try {
      const buffer = await readFile(filePath);
      const gltf = parseGlbJson(buffer);
      const fingerprint = skeletonFingerprint(gltf);
      const anims = getAnimationNames(gltf);
      const fileSize = buffer.byteLength;

      results.push({
        name: modelName,
        file,
        fingerprint,
        animCount: anims.length,
        anims,
        boneCount: fingerprint ? JSON.parse(fingerprint).bones.length : 0,
        fileSize,
      });
    } catch (err) {
      console.error(`  [ERROR] ${file}: ${err.message}`);
    }
  }

  return results;
}

async function main() {
  const entries = await readdir(MODELS_DIR);
  const packs = entries.filter(e => e.startsWith('q-') && !SKIP_PACKS.includes(e));
  packs.sort();

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  SKELETON ANALYSIS — ${packs.length} packs (excluding ${SKIP_PACKS.join(', ')})`);
  console.log(`${'='.repeat(70)}\n`);

  const allPackResults = {};

  for (const pack of packs) {
    const packPath = join(MODELS_DIR, pack);
    const packStat = await stat(packPath);
    if (!packStat.isDirectory()) continue;

    console.log(`\n── ${pack} ${'─'.repeat(55 - pack.length)}`);
    const models = await analyzePackDir(packPath);

    // Group by fingerprint
    const groups = new Map();
    for (const model of models) {
      const key = model.fingerprint ?? 'NO_SKELETON';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(model);
    }

    const packResult = {
      totalModels: models.length,
      totalSize: models.reduce((s, m) => s + m.fileSize, 0),
      groups: [],
    };

    let groupIdx = 0;
    for (const [fp, members] of groups) {
      groupIdx++;
      const isCandidate = fp !== 'NO_SKELETON' && members.length >= 3;
      const boneCount = members[0]?.boneCount ?? 0;
      const groupSize = members.reduce((s, m) => s + m.fileSize, 0);

      // Collect unique anim names across group
      const allAnims = new Set();
      for (const m of members) m.anims.forEach(a => allAnims.add(a));

      const groupInfo = {
        groupId: groupIdx,
        boneCount,
        modelCount: members.length,
        isCandidate,
        models: members.map(m => m.name),
        anims: [...allAnims],
        groupSize,
      };
      packResult.groups.push(groupInfo);

      const tag = isCandidate ? ' ★ CANDIDATE' : fp === 'NO_SKELETON' ? ' (no skeleton)' : '';
      console.log(`  Group ${groupIdx}: ${members.length} models, ${boneCount} bones${tag}`);
      console.log(`    Size: ${(groupSize / 1024).toFixed(0)} KB`);
      console.log(`    Models: ${members.map(m => m.name).join(', ')}`);
      console.log(`    Anims (${allAnims.size}): ${[...allAnims].slice(0, 8).join(', ')}${allAnims.size > 8 ? '...' : ''}`);
    }

    const totalKB = (packResult.totalSize / 1024).toFixed(0);
    console.log(`  Total: ${models.length} models, ${totalKB} KB`);
    allPackResults[pack] = packResult;
  }

  // Summary
  console.log(`\n${'='.repeat(70)}`);
  console.log('  SUMMARY — Candidate groups for shared animations');
  console.log(`${'='.repeat(70)}\n`);

  let totalOriginal = 0;
  let totalCandidateSize = 0;

  for (const [pack, result] of Object.entries(allPackResults)) {
    totalOriginal += result.totalSize;
    const candidates = result.groups.filter(g => g.isCandidate);
    if (candidates.length === 0) {
      console.log(`  ${pack}: no candidates (${result.totalModels} models, all unique rigs or < 3)`);
    } else {
      for (const g of candidates) {
        totalCandidateSize += g.groupSize;
        console.log(`  ${pack} group ${g.groupId}: ${g.modelCount} models, ${g.boneCount} bones, ${g.anims.length} anims`);
        console.log(`    Models: ${g.models.join(', ')}`);
      }
    }
  }

  console.log(`\n  Total across all packs: ${(totalOriginal / (1024 * 1024)).toFixed(1)} MB`);
  console.log(`  Candidate models size: ${(totalCandidateSize / (1024 * 1024)).toFixed(1)} MB`);
  console.log('');
}

main().catch(console.error);
