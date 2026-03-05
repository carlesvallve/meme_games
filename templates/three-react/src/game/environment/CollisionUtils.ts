/**
 * CollisionUtils — reusable helpers for creating DebrisBox colliders from meshes and geometry.
 *
 * Usage:
 *   import { debrisFromMesh, debrisFromBox, debrisFromGroup } from './CollisionUtils';
 *   ctx.debris.push(debrisFromMesh(mesh));
 *   ctx.debris.push(debrisFromBox(x, z, halfW, halfD, height, rotation));
 */

import * as THREE from 'three';
import type { DebrisBox } from './EnvironmentContext';

// ── Primitives ─────────────────────────────────────────────────────

/** Create a debris box from explicit dimensions + optional rotation. */
export function debrisFromBox(
  x: number,
  z: number,
  halfW: number,
  halfD: number,
  height: number,
  rotation?: number,
): DebrisBox {
  return { x, z, halfW, halfD, height, rotation };
}

// ── From Mesh / Object3D ───────────────────────────────────────────

/**
 * Create a debris box from a mesh's world-space position, bounding box, and Y-rotation.
 * Uses the mesh's geometry bounding box for sizing.
 * @param mesh - The mesh to create a collider for
 * @param opts.trunkFraction - Scale XZ extents (e.g., 0.4 for trunk-only). Default 1.0
 * @param opts.heightOverride - Override box top height (absolute Y). If unset, uses mesh bbox.
 */
export function debrisFromMesh(
  mesh: THREE.Mesh,
  opts: { trunkFraction?: number; heightOverride?: number } = {},
): DebrisBox {
  const frac = opts.trunkFraction ?? 1.0;

  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox!;
  const scale = mesh.scale;
  const pos = mesh.position;

  const halfW = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)) * scale.x * frac;
  const halfD = Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z)) * scale.z * frac;
  const height = opts.heightOverride ?? (pos.y + bb.max.y * scale.y);

  return {
    x: pos.x,
    z: pos.z,
    halfW,
    halfD,
    height,
    rotation: mesh.rotation.y || undefined,
  };
}

/**
 * Create debris boxes from all meshes in a group (non-recursive, one level).
 * Useful for compound structures where each child mesh needs its own collider.
 */
export function debrisFromGroup(
  group: THREE.Group,
  opts: { trunkFraction?: number } = {},
): DebrisBox[] {
  const result: DebrisBox[] = [];
  const groupPos = group.position;
  const groupRotY = group.rotation.y;
  const cosR = Math.cos(groupRotY);
  const sinR = Math.sin(groupRotY);

  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    child.geometry.computeBoundingBox();
    const bb = child.geometry.boundingBox;
    if (!bb) continue;

    const frac = opts.trunkFraction ?? 1.0;
    const scale = child.scale;
    const lx = child.position.x;
    const lz = child.position.z;

    // Transform child local pos to world via group rotation
    const wx = groupPos.x + lx * cosR + lz * sinR;
    const wz = groupPos.z - lx * sinR + lz * cosR;

    const halfW = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x)) * scale.x * frac;
    const halfD = Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z)) * scale.z * frac;
    const height = groupPos.y + child.position.y + bb.max.y * scale.y;

    // Combine child rotation with group rotation
    const totalRot = groupRotY + (child.rotation.y || 0);
    result.push({ x: wx, z: wz, halfW, halfD, height, rotation: totalRot || undefined });
  }
  return result;
}

/**
 * Create a single debris box enclosing an entire group's world-space bounding box.
 * Simpler than per-child, good for solid structures.
 */
export function debrisFromGroupBounds(
  group: THREE.Group,
  opts: { heightOverride?: number; padding?: number } = {},
): DebrisBox {
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const pad = opts.padding ?? 0;

  return {
    x: center.x,
    z: center.z,
    halfW: size.x / 2 + pad,
    halfD: size.z / 2 + pad,
    height: opts.heightOverride ?? box.max.y,
    rotation: group.rotation.y || undefined,
  };
}

// ── OBB helpers (for use in custom collision code) ─────────────────

/** Transform a world-space point into a debris box's local space (inverse rotation). */
export function worldToBoxLocal(box: DebrisBox, wx: number, wz: number): { lx: number; lz: number } {
  const dx = wx - box.x;
  const dz = wz - box.z;
  if (!box.rotation) return { lx: dx, lz: dz };
  const cos = Math.cos(-box.rotation);
  const sin = Math.sin(-box.rotation);
  return { lx: dx * cos + dz * sin, lz: -dx * sin + dz * cos };
}

/** Transform a local-space displacement back to world space. */
export function boxLocalToWorld(rotation: number | undefined, lx: number, lz: number): { wx: number; wz: number } {
  if (!rotation) return { wx: lx, wz: lz };
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return { wx: lx * cos + lz * sin, wz: -lx * sin + lz * cos };
}

/** Check if a world-space point (with radius) overlaps a debris box (OBB-aware). */
export function pointOverlapsDebris(box: DebrisBox, wx: number, wz: number, radius = 0): boolean {
  const { lx, lz } = worldToBoxLocal(box, wx, wz);
  return Math.abs(lx) < box.halfW + radius && Math.abs(lz) < box.halfD + radius;
}
