import * as THREE from 'three';

const _pos = new THREE.Vector3();

/** Base multiplier for bipeds (fit foot-bone XZ spread to cell). */
const BIPED_SCALE_MULTIPLIER = 0.35;
/** Base multiplier for quadrupeds (fit height to cell). */
const QUADRUPED_SCALE_MULTIPLIER = 0.85;

/** Bone name patterns that identify feet (lowercase). */
const FOOT_PATTERNS = ['foot', 'toe', 'ankle', 'heel'];

/** Known quadruped model name patterns (lowercase). */
const QUADRUPED_NAMES = new Set([
  'alpaca', 'bull', 'cat', 'chick', 'chicken', 'cow', 'deer', 'dog', 'donkey',
  'fox', 'horse', 'husky', 'pig', 'pug', 'raccoon', 'sheep', 'shibainu',
  'stag', 'wolf',
  'germanshepherd',
  'dino', 'frog', 'fish',
]);

function isQuadrupedByName(meshUrl: string): boolean {
  const filename = meshUrl.split('/').pop()?.replace(/\.\w+$/, '')?.toLowerCase() ?? '';
  for (const name of QUADRUPED_NAMES) {
    if (filename.includes(name)) return true;
  }
  return false;
}

/**
 * Find foot bones and return their XZ bounding extent.
 * Returns 0 if no foot bones found.
 */
function measureFootBoneSpread(model: THREE.Object3D): number {
  const footPositions: THREE.Vector3[] = [];

  model.traverse((child) => {
    if (!(child as THREE.Bone).isBone) return;
    const lower = child.name.toLowerCase();
    if (FOOT_PATTERNS.some(p => lower.includes(p))) {
      const wp = new THREE.Vector3();
      child.getWorldPosition(wp);
      footPositions.push(wp);
    }
  });

  if (footPositions.length < 2) return 0;

  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const p of footPositions) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }

  return Math.max(maxX - minX, maxZ - minZ);
}

export interface AutoFitResult {
  scale: number;
  /** Y offset to apply so the model's feet sit at Y=0. */
  offsetY: number;
}

/**
 * Compute the ideal uniform scale so a model fits within a grid cell,
 * plus a Y offset to ground the model (feet at Y=0).
 *
 * For bipeds: measures XZ spread between foot bones (immune to weapons/accessories).
 * Falls back to bottom-slice vertex sampling if no foot bones found.
 * For quadrupeds (by name): fits height to cell.
 */
export function computeAutoFit(model: THREE.Object3D, cellSize: number, meshUrl: string): AutoFitResult {
  const fullBox = new THREE.Box3().setFromObject(model);
  const fullSize = fullBox.getSize(new THREE.Vector3());
  const height = fullSize.y;
  if (height < 0.001) return { scale: 1, offsetY: 0 };

  const isQuadruped = isQuadrupedByName(meshUrl);

  // Y offset: if min.y < 0, the model sinks below origin — lift it up
  // After scaling, the offset needs to account for scale, so store raw min.y
  const rawMinY = fullBox.min.y;

  let scale: number;

  if (isQuadruped) {
    const raw = cellSize / height;
    scale = raw * QUADRUPED_SCALE_MULTIPLIER;
  } else {
    // Biped: try foot bones first
    let xzExtent = measureFootBoneSpread(model);

    // Fallback: bottom-slice vertex sampling (lowest 30%)
    if (xzExtent < 0.001) {
      const sliceCutoff = fullBox.min.y + height * 0.3;
      let minX = Infinity, maxX = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;
      let count = 0;

      model.traverse((child) => {
        if (!(child as THREE.Mesh).isMesh) return;
        const mesh = child as THREE.Mesh;
        const posAttr = mesh.geometry.getAttribute('position');
        if (!posAttr) return;

        for (let i = 0; i < posAttr.count; i++) {
          _pos.fromBufferAttribute(posAttr, i);
          mesh.localToWorld(_pos);
          if (_pos.y <= sliceCutoff) {
            if (_pos.x < minX) minX = _pos.x;
            if (_pos.x > maxX) maxX = _pos.x;
            if (_pos.z < minZ) minZ = _pos.z;
            if (_pos.z > maxZ) maxZ = _pos.z;
            count++;
          }
        }
      });

      xzExtent = count >= 3 ? Math.max(maxX - minX, maxZ - minZ) : Math.max(fullSize.x, fullSize.z);
    }

    if (xzExtent < 0.001) xzExtent = height;
    scale = (cellSize / xzExtent) * BIPED_SCALE_MULTIPLIER;
  }

  // Compute offsetY: lift model so its bottom sits at Y=0 after scaling
  const offsetY = rawMinY < -0.01 ? -rawMinY * scale : 0;

  console.log(`[autoFit] ${meshUrl.split('/').pop()} → h=${height.toFixed(2)} minY=${rawMinY.toFixed(2)} quad=${isQuadruped} → scale=${scale.toFixed(4)} offsetY=${offsetY.toFixed(4)}`);
  return { scale, offsetY };
}
