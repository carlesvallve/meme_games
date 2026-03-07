import type { AABBBox } from './pathfinding/NavGrid';

/**
 * Push-out collision resolution matching voxel-engine's pushOutOfDebris.
 * 4 iterative passes, shortest-axis push when inside, closest-point push when outside.
 * Skips boxes the entity can step onto (effectiveH - currentY <= stepUp).
 */
export function resolveCollision(
  newX: number,
  newZ: number,
  obstacles: ReadonlyArray<AABBBox>,
  radius: number,
  currentY: number,
  stepUp: number,
): { x: number; z: number } {
  let rx = newX;
  let rz = newZ;

  for (let pass = 0; pass < 4; pass++) {
    for (const box of obstacles) {
      // Skip steppable obstacles
      if (box.height - currentY <= stepUp) continue;

      // Relative position to box center
      const relX = rx - box.x;
      const relZ = rz - box.z;

      // Expanded half-extents (box + capsule radius)
      const expandedHalfW = box.halfW + radius;
      const expandedHalfD = box.halfD + radius;

      // Skip if clearly outside expanded box
      if (Math.abs(relX) >= expandedHalfW || Math.abs(relZ) >= expandedHalfD) continue;

      // Check if center is inside the actual box (not expanded)
      const insideBox = Math.abs(relX) < box.halfW && Math.abs(relZ) < box.halfD;

      if (insideBox) {
        // Case 1: Center is INSIDE box — push out along shortest axis
        const overlapX = box.halfW + radius - Math.abs(relX);
        const overlapZ = box.halfD + radius - Math.abs(relZ);

        if (overlapX < overlapZ) {
          rx += (relX >= 0 ? 1 : -1) * overlapX;
        } else {
          rz += (relZ >= 0 ? 1 : -1) * overlapZ;
        }
      } else {
        // Case 2: Center is OUTSIDE box but within radius — push away from closest point
        const closestX = Math.max(-box.halfW, Math.min(relX, box.halfW));
        const closestZ = Math.max(-box.halfD, Math.min(relZ, box.halfD));

        const dlx = relX - closestX;
        const dlz = relZ - closestZ;
        const distSq = dlx * dlx + dlz * dlz;

        if (distSq < radius * radius && distSq > 0.0001) {
          const dist = Math.sqrt(distSq);
          const overlap = radius - dist;
          rx += (dlx / dist) * overlap;
          rz += (dlz / dist) * overlap;
        }
      }
    }
  }

  return { x: rx, z: rz };
}

/**
 * Compute the surface height at a position — the max height of all
 * overlapping boxes (steppable or not). Matches voxel-engine's getTerrainY.
 */
export function getSurfaceHeight(
  x: number,
  z: number,
  obstacles: ReadonlyArray<AABBBox>,
  radius: number,
): number {
  let maxH = 0;
  for (const box of obstacles) {
    if (
      Math.abs(x - box.x) < box.halfW + radius &&
      Math.abs(z - box.z) < box.halfD + radius
    ) {
      if (box.height > maxH) maxH = box.height;
    }
  }
  return maxH;
}
