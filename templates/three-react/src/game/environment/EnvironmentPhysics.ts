import * as THREE from 'three';
import { sampleHeightmap } from '../terrain/TerrainNoise';
import { getBoxHeightAt } from '../pathfinding';
import { EnvironmentContext } from './EnvironmentContext';
import { worldToBoxLocal, boxLocalToWorld } from './CollisionUtils';

/**
 * Handles all movement / collision / height queries that characters call every frame.
 * Extracted from the monolithic Terrain class — logic is identical, field access goes
 * through the shared EnvironmentContext.
 */
export class EnvironmentPhysics {
  constructor(private ctx: EnvironmentContext) {}

  // ── Height queries ──────────────────────────────────────────────────

  /** Floor height ignoring small prop debris (walls only). Used by loot physics. */
  getFloorY(x: number, z: number): number {
    if (this.ctx.overworldMap) {
      return this.ctx.overworldMap.getTerrainY(x, z);
    }
    if (this.ctx.heightmapData) {
      return sampleHeightmap(this.ctx.heightmapData, this.ctx.heightmapRes, this.ctx.heightmapGroundSize, x, z);
    }
    return this.ctx.baseFloorY + this.getCellHeightAt(x, z);
  }

  /** Like getTerrainY but ignores prop debris (tables, chairs). Used for projectile terrain-follow. */
  getTerrainYNoProps(x: number, z: number): number {
    if (this.ctx.overworldMap) {
      return this.ctx.overworldMap.getTerrainY(x, z);
    }
    if (this.ctx.heightmapData) {
      return sampleHeightmap(this.ctx.heightmapData, this.ctx.heightmapRes, this.ctx.heightmapGroundSize, x, z);
    }
    let maxY = this.ctx.baseFloorY + this.getCellHeightAt(x, z);
    for (const box of this.ctx.debris) {
      if (box.isProp) continue;
      if (Math.abs(x - box.x) < box.halfW && Math.abs(z - box.z) < box.halfD) {
        const h = getBoxHeightAt(box, x, z);
        maxY = Math.max(maxY, h);
      }
    }
    return maxY;
  }

  /** Get the ground/debris height at a point, optionally expanded by a radius */
  getTerrainY(x: number, z: number, radius = 0): number {
    // Overworld: delegate to OverworldMap
    if (this.ctx.overworldMap) {
      return this.ctx.overworldMap.getTerrainY(x, z);
    }

    // Heightmap: bilinear interpolation + debris boxes
    if (this.ctx.heightmapData) {
      let maxY: number;
      if (radius <= 0) {
        maxY = sampleHeightmap(this.ctx.heightmapData, this.ctx.heightmapRes, this.ctx.heightmapGroundSize, x, z);
      } else {
        // With radius: sample center + 4 offsets and take max
        maxY = sampleHeightmap(this.ctx.heightmapData, this.ctx.heightmapRes, this.ctx.heightmapGroundSize, x, z);
        const r = radius * 0.7;
        maxY = Math.max(maxY, sampleHeightmap(this.ctx.heightmapData, this.ctx.heightmapRes, this.ctx.heightmapGroundSize, x + r, z));
        maxY = Math.max(maxY, sampleHeightmap(this.ctx.heightmapData, this.ctx.heightmapRes, this.ctx.heightmapGroundSize, x - r, z));
        maxY = Math.max(maxY, sampleHeightmap(this.ctx.heightmapData, this.ctx.heightmapRes, this.ctx.heightmapGroundSize, x, z + r));
        maxY = Math.max(maxY, sampleHeightmap(this.ctx.heightmapData, this.ctx.heightmapRes, this.ctx.heightmapGroundSize, x, z - r));
      }
      // Also check nearby debris boxes (rocks, POIs, etc.) — spatial hash + OBB
      const nearby = this.ctx.debrisSpatial.query(x, z, radius);
      for (const box of nearby) {
        const { lx, lz } = worldToBoxLocal(box, x, z);
        if (Math.abs(lx) < box.halfW + radius && Math.abs(lz) < box.halfD + radius) {
          const h = getBoxHeightAt(box, x, z);
          maxY = Math.max(maxY, h);
        }
      }
      return maxY;
    }

    // Box-based: O(n) iteration
    let maxY = this.ctx.baseFloorY;

    // Add cell height offset from stair system (includes sub-cell stair steps)
    maxY += this.getCellHeightAt(x, z);

    for (const box of this.ctx.debris) {
      if (
        Math.abs(x - box.x) < box.halfW + radius &&
        Math.abs(z - box.z) < box.halfD + radius
      ) {
        const h = getBoxHeightAt(box, x, z);
        maxY = Math.max(maxY, h);
      }
    }
    return maxY;
  }

  /** Surface normal at (x, z) for aligning decals/splats. Heightmap: gradient-based; box terrain: up. */
  getTerrainNormal(x: number, z: number): THREE.Vector3 {
    const up = new THREE.Vector3(0, 1, 0);
    if (this.ctx.overworldMap) {
      // Gradient-based normal for overworld tiles
      const eps = 0.05;
      const hL = this.ctx.overworldMap.getTerrainY(x - eps, z);
      const hR = this.ctx.overworldMap.getTerrainY(x + eps, z);
      const hD = this.ctx.overworldMap.getTerrainY(x, z - eps);
      const hU = this.ctx.overworldMap.getTerrainY(x, z + eps);
      const dx = (hR - hL) / (2 * eps);
      const dz = (hU - hD) / (2 * eps);
      return new THREE.Vector3(-dx, 1, -dz).normalize();
    }
    if (this.ctx.heightmapData) {
      const eps = 0.05;
      const hL = this.getTerrainY(x - eps, z);
      const hR = this.getTerrainY(x + eps, z);
      const hD = this.getTerrainY(x, z - eps);
      const hU = this.getTerrainY(x, z + eps);
      const dx = (hR - hL) / (2 * eps);
      const dz = (hU - hD) / (2 * eps);
      const n = new THREE.Vector3(-dx, 1, -dz).normalize();
      return n;
    }
    return up;
  }

  /** Returns true if the world position is on a stair cell */
  isOnStairs(x: number, z: number): boolean {
    if (!this.ctx.cellHeights || this.ctx.dungeonCellSize <= 0) return false;
    const halfW = this.ctx.groundSize / 2;
    const cs = this.ctx.dungeonCellSize;
    const mgx = Math.floor((x + halfW) / cs);
    const mgz = Math.floor((z + halfW) / cs);
    if (mgx < 0 || mgx >= this.ctx.dungeonGridW || mgz < 0 || mgz >= this.ctx.dungeonGridD) return false;
    return this.ctx.stairMap.has(mgz * this.ctx.dungeonGridW + mgx);
  }

  // ── Collision / movement resolution ─────────────────────────────────

  /**
   * Circle-vs-AABB collision resolve (capsule collider projected to XZ).
   * For heightmap terrain: just clamp to bounds and sample height (no walls).
   * For box terrain: pushes player out of blocking obstacles.
   */
  resolveMovement(
    newX: number,
    newZ: number,
    currentY: number,
    stepHeight: number,
    radius: number,
    oldX?: number,
    oldZ?: number,
    slopeHeight?: number,
  ): { x: number; z: number; y: number } {
    let rx = newX;
    let rz = newZ;

    // Clamp to world bounds (use heightmap ground size when available — it's smaller)
    const effectiveGround = this.ctx.heightmapGroundSize || this.ctx.groundSize;
    const halfBound = effectiveGround / 2 - radius;
    rx = Math.max(-halfBound, Math.min(halfBound, rx));
    rz = Math.max(-halfBound, Math.min(halfBound, rz));

    // Overworld: simple height sampling + bounds clamping (slopes are gentle)
    if (this.ctx.overworldMap) {
      const y = this.ctx.overworldMap.getTerrainY(rx, rz);
      return { x: rx, z: rz, y };
    }

    // Heightmap terrain: steep slopes act as walls.
    // Gradient = wall normal. Movement into steep uphill slopes gets projected
    // along the contour, same as sliding along a vertical wall.
    if (this.ctx.heightmapData) {
      const sampleR = radius * 0.5;
      const heights = this.ctx.heightmapData;
      const hmRes = this.ctx.heightmapRes;
      const hmGround = this.ctx.heightmapGroundSize;
      const hmCellSize = hmGround / hmRes;
      const effectiveSlopeHeight = slopeHeight ?? stepHeight * 2;
      const maxSlope = (effectiveSlopeHeight / hmCellSize) * 0.45;
      const eps = hmCellSize * 0.5;

      /** Gradient using plain bilinear sampling — matches NavGrid exactly */
      const gradientAt = (px: number, pz: number): { gx: number; gz: number; mag: number } => {
        const hL = sampleHeightmap(heights, hmRes, hmGround, px - eps, pz);
        const hR = sampleHeightmap(heights, hmRes, hmGround, px + eps, pz);
        const hU = sampleHeightmap(heights, hmRes, hmGround, px, pz - eps);
        const hD = sampleHeightmap(heights, hmRes, hmGround, px, pz + eps);
        const gx = (hR - hL) / (2 * eps);
        const gz = (hD - hU) / (2 * eps);
        return { gx, gz, mag: Math.sqrt(gx * gx + gz * gz) };
      };

      const terrainY = this.getTerrainY(rx, rz, sampleR);

      // Resolve slope collision first, then push out of debris
      let resultX = rx;
      let resultZ = rz;
      let resultY = terrainY;

      if (oldX !== undefined && oldZ !== undefined) {
        const mx = rx - oldX;
        const mz = rz - oldZ;
        const moveLen = Math.sqrt(mx * mx + mz * mz);

        if (moveLen > 0.0001) {
          const aheadX = rx + (mx / moveLen) * eps;
          const aheadZ = rz + (mz / moveLen) * eps;
          const grad = gradientAt(aheadX, aheadZ);

          if (grad.mag > maxSlope) {
            const nx = grad.gx / grad.mag;
            const nz = grad.gz / grad.mag;
            const dot = (mx / moveLen) * nx + (mz / moveLen) * nz;
            const absDot = Math.abs(dot);

            if (absDot > 0.05) {
              // Moving into steep slope — slide along contour
              const slideX = Math.max(-halfBound, Math.min(halfBound, oldX + mx - dot * moveLen * nx));
              const slideZ = Math.max(-halfBound, Math.min(halfBound, oldZ + mz - dot * moveLen * nz));
              const slideY = this.getTerrainY(slideX, slideZ, sampleR);
              const slideGrad = gradientAt(slideX, slideZ);

              if (slideGrad.mag <= maxSlope) {
                resultX = slideX; resultZ = slideZ; resultY = slideY;
              } else {
                const smx = slideX - oldX;
                const smz = slideZ - oldZ;
                const smLen = Math.sqrt(smx * smx + smz * smz);
                if (smLen > 0.0001) {
                  const sdot = (smx / smLen) * (slideGrad.gx / slideGrad.mag) +
                               (smz / smLen) * (slideGrad.gz / slideGrad.mag);
                  if (Math.abs(sdot) <= 0.05) {
                    resultX = slideX; resultZ = slideZ; resultY = slideY;
                  } else {
                    // Fully blocked — stay put
                    resultX = oldX; resultZ = oldZ; resultY = currentY;
                  }
                } else {
                  resultX = oldX; resultZ = oldZ; resultY = currentY;
                }
              }
            }
            // else absDot <= 0.05: moving along contour, allow (resultX/Z already = rx/rz)
          }
          // else gentle slope, allow (resultX/Z already = rx/rz)
        }
      }

      // Push out of debris (props, doors, etc.)
      const pushed = this.pushOutOfDebris(resultX, resultZ, currentY, stepHeight, radius);
      // Recalculate Y at pushed position (may have shifted due to debris)
      const finalY = this.getTerrainY(pushed.x, pushed.z, sampleR);
      return { x: pushed.x, z: pushed.z, y: finalY };
    }

    // Box-based: iterative push-out (static + dynamic debris)
    ({ x: rx, z: rz } = this.pushOutOfDebris(rx, rz, currentY, stepHeight, radius));

    // Cliff blocking for dungeons: prevent walking across height boundaries
    if (this.ctx.cellHeights && this.ctx.walkMask && oldX !== undefined && oldZ !== undefined) {
      const hw = (this.ctx.effectiveGroundSize || this.ctx.groundSize) / 2;
      const dcs = this.ctx.dungeonCellSize;
      const gw = this.ctx.dungeonGridW;
      const gd = this.ctx.dungeonGridD;
      const oldGX = Math.floor((oldX + hw) / dcs);
      const oldGZ = Math.floor((oldZ + hw) / dcs);
      const newGX = Math.floor((rx + hw) / dcs);
      const newGZ = Math.floor((rz + hw) / dcs);
      if (oldGX >= 0 && oldGX < gw && oldGZ >= 0 && oldGZ < gd &&
          newGX >= 0 && newGX < gw && newGZ >= 0 && newGZ < gd &&
          (oldGX !== newGX || oldGZ !== newGZ)) {
        const oldIdx = oldGZ * gw + oldGX;
        const newIdx = newGZ * gw + newGX;
        const oldH = this.ctx.cellHeights[oldIdx];
        const newH = this.ctx.cellHeights[newIdx];
        // Allow movement onto/off stair cells — stairs handle the height transition.
        // Ladder cells are NOT exempted: cliff blocking triggers the ladder climb.
        if (Math.abs(newH - oldH) > stepHeight &&
            !this.ctx.stairMap.has(oldIdx) && !this.ctx.stairMap.has(newIdx)) {
          // Block: stay at old position
          return { x: oldX, z: oldZ, y: currentY };
        }
      }
    }

    const terrainY = this.getTerrainY(rx, rz, radius * 0.5);
    const y = terrainY - currentY <= stepHeight ? terrainY : currentY;

    return { x: rx, z: rz, y };
  }

  // ── Surface queries (used by EnvironmentNavigation) ─────────────────

  /** Check if point is fully on top of a box surface (not on an edge) */
  isOnBoxSurface(x: number, z: number): boolean {
    if (this.ctx.heightmapData) return true; // entire heightmap is walkable surface
    if (this.ctx.overworldMap) return true; // overworld tiles are walkable
    for (const box of this.ctx.debris) {
      if (
        Math.abs(x - box.x) < box.halfW - 0.01 &&
        Math.abs(z - box.z) < box.halfD - 0.01
      ) {
        return true;
      }
    }
    return false;
  }

  /** Check if any taller debris box overlaps within `clearance` of (x, z) at surfaceY */
  hasClearance(x: number, z: number, surfaceY: number, clearance: number): boolean {
    if (this.ctx.heightmapData) return true; // no walls on heightmap terrain
    if (this.ctx.overworldMap) return true; // no walls on overworld tiles
    for (const box of this.ctx.debris) {
      if (box.height <= surfaceY + 0.01) continue;
      if (
        Math.abs(x - box.x) < box.halfW + clearance &&
        Math.abs(z - box.z) < box.halfD + clearance
      ) {
        return false;
      }
    }
    return true;
  }

  // ── Private helpers ─────────────────────────────────────────────────

  /** Get cell height at world position, including sub-cell stair steps */
  private getCellHeightAt(x: number, z: number): number {
    if (!this.ctx.cellHeights || this.ctx.dungeonCellSize <= 0) return 0;
    const halfW = this.ctx.groundSize / 2;
    const cs = this.ctx.dungeonCellSize;
    const mgx = Math.floor((x + halfW) / cs);
    const mgz = Math.floor((z + halfW) / cs);
    if (mgx < 0 || mgx >= this.ctx.dungeonGridW || mgz < 0 || mgz >= this.ctx.dungeonGridD) return 0;
    const idx = mgz * this.ctx.dungeonGridW + mgx;
    const cellH = this.ctx.cellHeights[idx];
    const stair = this.ctx.stairMap.get(idx);
    if (!stair) return cellH;
    // Sub-cell stair: localT = 0..1 from low side to high side
    const cellCenterX = -halfW + (mgx + 0.5) * cs;
    const cellCenterZ = -halfW + (mgz + 0.5) * cs;
    const halfCell = cs / 2;
    let localT: number;
    if (stair.axis === 'x') {
      const localX = x - cellCenterX;
      localT = stair.direction > 0 ? (localX + halfCell) / cs : (halfCell - localX) / cs;
    } else {
      const localZ = z - cellCenterZ;
      localT = stair.direction > 0 ? (localZ + halfCell) / cs : (halfCell - localZ) / cs;
    }
    localT = Math.max(0, Math.min(1, localT));
    // Smooth ramp offset to step tops — character walks ON the geometry
    // At localT=0: first step top (totalHeight/STEPS)
    // At localT=1: last step top (totalHeight)
    const STEPS = 6;
    const oneStep = stair.totalHeight / STEPS;
    return cellH + oneStep + localT * (stair.totalHeight - oneStep);
  }

  /** Push position out of any debris boxes (static + dynamic). Supports OBB via rotation field. */
  private pushOutOfDebris(rx: number, rz: number, currentY: number, stepHeight: number, radius: number): { x: number; z: number } {
    for (let pass = 0; pass < 4; pass++) {
      // Query spatial hash for nearby static debris + append dynamic
      const nearby = this.ctx.debrisSpatial.query(rx, rz, radius + 2);
      const allDebris = this.ctx.dynamicDebris.length > 0
        ? [...nearby, ...this.ctx.dynamicDebris]
        : nearby;
      for (const box of allDebris) {
        const effectiveH = getBoxHeightAt(box, rx, rz);
        if (effectiveH - currentY <= stepHeight) continue;

        // Transform player pos into box-local space for OBB support
        const { lx: relX, lz: relZ } = worldToBoxLocal(box, rx, rz);

        const expandedHalfW = box.halfW + radius;
        const expandedHalfD = box.halfD + radius;
        if (Math.abs(relX) >= expandedHalfW || Math.abs(relZ) >= expandedHalfD) continue;

        const insideBox =
          Math.abs(relX) < box.halfW &&
          Math.abs(relZ) < box.halfD;

        if (insideBox) {
          const overlapX = box.halfW + radius - Math.abs(relX);
          const overlapZ = box.halfD + radius - Math.abs(relZ);
          // Compute push in local space, then transform back to world
          let pushLX = 0, pushLZ = 0;
          if (overlapX < overlapZ) {
            pushLX = (relX >= 0 ? 1 : -1) * overlapX;
          } else {
            pushLZ = (relZ >= 0 ? 1 : -1) * overlapZ;
          }
          const { wx: pushWX, wz: pushWZ } = boxLocalToWorld(box.rotation, pushLX, pushLZ);
          rx += pushWX;
          rz += pushWZ;
          continue;
        }

        // Closest point on box in local space
        const closestLX = Math.max(-box.halfW, Math.min(relX, box.halfW));
        const closestLZ = Math.max(-box.halfD, Math.min(relZ, box.halfD));

        const dlx = relX - closestLX;
        const dlz = relZ - closestLZ;
        const distSq = dlx * dlx + dlz * dlz;

        if (distSq < radius * radius) {
          if (distSq > 0.0001) {
            const dist = Math.sqrt(distSq);
            const overlap = radius - dist;
            // Push direction in local space, transform to world
            const pushLX = (dlx / dist) * overlap;
            const pushLZ = (dlz / dist) * overlap;
            const { wx: pushWX, wz: pushWZ } = boxLocalToWorld(box.rotation, pushLX, pushLZ);
            rx += pushWX;
            rz += pushWZ;
          } else {
            const awayX = rx - box.x;
            const awayZ = rz - box.z;
            const awayLen = Math.sqrt(awayX * awayX + awayZ * awayZ);
            if (awayLen > 0.0001) {
              rx += (awayX / awayLen) * radius;
              rz += (awayZ / awayLen) * radius;
            } else {
              rx += radius;
            }
          }
        }
      }
    }
    return { x: rx, z: rz };
  }
}
