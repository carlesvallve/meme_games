import * as THREE from 'three';
import { Entity, Layer } from './Entity';
import { NavGrid } from './NavGrid';

const CELL = 1;
const HALF = 0.5;
function snapHalf(v: number): number { return Math.max(HALF, Math.round(v / HALF) * HALF); }
/** Snap position so that box edges align to HALF boundaries given its half-size */
function snapPos(v: number, halfSize: number): number {
  // Snap the left/bottom edge to nearest HALF, then offset by halfSize to get center
  const edge = Math.round((v - halfSize) / HALF) * HALF;
  return edge + halfSize;
}

interface DebrisBox {
  x: number;
  z: number;
  halfW: number;
  halfD: number;
  height: number;
}

export class Terrain {
  readonly group = new THREE.Group();
  private debris: DebrisBox[] = [];
  private debrisEntities: Entity[] = [];
  private readonly groundSize = 40;

  constructor(scene: THREE.Scene) {
    this.createGround();
    this.createGridLines();
    this.createDebris();
    scene.add(this.group);
  }

  private createGround(): void {
    const geo = new THREE.PlaneGeometry(this.groundSize, this.groundSize);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      roughness: 0.95,
      metalness: 0.05,
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  private createGridLines(): void {
    const grid = new THREE.GridHelper(this.groundSize, this.groundSize / HALF, 0x444466, 0x333355);
    grid.position.y = 0.01;
    const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const mat of mats) {
      mat.transparent = true;
      mat.opacity = 0.9;
      mat.depthWrite = false;
    }
    this.group.add(grid);
  }

  /** Create 0.5m grid lines on box faces */
  private createBoxGrid(w: number, h: number, d: number, baseColor: THREE.Color): THREE.LineSegments {
    const points: number[] = [];
    const hw = w / 2, hh = h / 2, hd = d / 2;

    // Horizontal lines on +X and -X faces (YZ plane)
    for (let y = -hh; y <= hh + 0.001; y += HALF) {
      for (const fx of [-hw, hw]) {
        points.push(fx, y, -hd, fx, y, hd);
      }
    }
    for (let z = -hd; z <= hd + 0.001; z += HALF) {
      for (const fx of [-hw, hw]) {
        points.push(fx, -hh, z, fx, hh, z);
      }
    }

    // Horizontal lines on +Z and -Z faces (XY plane)
    for (let y = -hh; y <= hh + 0.001; y += HALF) {
      for (const fz of [-hd, hd]) {
        points.push(-hw, y, fz, hw, y, fz);
      }
    }
    for (let x = -hw; x <= hw + 0.001; x += HALF) {
      for (const fz of [-hd, hd]) {
        points.push(x, -hh, fz, x, hh, fz);
      }
    }

    // Grid on top face (+Y, XZ plane)
    for (let x = -hw; x <= hw + 0.001; x += HALF) {
      points.push(x, hh, -hd, x, hh, hd);
    }
    for (let z = -hd; z <= hd + 0.001; z += HALF) {
      points.push(-hw, hh, z, hw, hh, z);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const mat = new THREE.LineBasicMaterial({
      color: baseColor.clone().multiplyScalar(1.4),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    return new THREE.LineSegments(geo, mat);
  }

  private createDebris(): void {
    const count = 150;
    const colors = [0x2a2a3e, 0x33334a, 0x252538, 0x1e1e30, 0x3a3a50];
    const halfGround = this.groundSize / 2 - 2;

    for (let i = 0; i < count; i++) {
      const w = snapHalf(0.4 + Math.random() * 1.8);
      const d = snapHalf(0.4 + Math.random() * 1.8);
      const isTall = Math.random() < 0.2;
      const h = snapHalf(isTall ? 2 + Math.random() * 3.5 : 0.3 + Math.random() * 0.8);

      const geo = new THREE.BoxGeometry(w, h, d);
      const color = colors[Math.floor(Math.random() * colors.length)];
      const variation = 0.85 + Math.random() * 0.3;
      const baseColor = new THREE.Color(color).multiplyScalar(variation);
      const mat = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: 0.85,
        metalness: 0.1,
      });

      const mesh = new THREE.Mesh(geo, mat);
      const x = snapPos((Math.random() - 0.5) * halfGround * 2, w / 2);
      const z = snapPos((Math.random() - 0.5) * halfGround * 2, d / 2);

      // Don't place debris in the spawn area
      if (Math.abs(x) < 3 && Math.abs(z) < 3) continue;

      // Skip if overlapping a box with the same height (causes top-face z-fighting)
      const hw = w / 2, hd = d / 2;
      const zFight = this.debris.some(b =>
        Math.abs(h - b.height) < 0.01 &&
        Math.abs(x - b.x) < hw + b.halfW &&
        Math.abs(z - b.z) < hd + b.halfD
      );
      if (zFight) continue;

      mesh.position.set(x, h / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);

      // Register as entity for layer-based queries (camera collision, etc.)
      const entity = new Entity(mesh, {
        layer: Layer.Architecture,
        radius: Math.max(hw, hd),
        weight: Infinity,
      });
      this.debrisEntities.push(entity);

      // Add grid lines on box surfaces
      const gridLines = this.createBoxGrid(w, h, d, baseColor);
      gridLines.position.copy(mesh.position);
      this.group.add(gridLines);

      this.debris.push({
        x, z,
        halfW: w / 2,
        halfD: d / 2,
        height: h,
      });
    }
  }

  /** Build a NavGrid from current debris for A* pathfinding */
  buildNavGrid(stepHeight: number, capsuleRadius: number, cellSize = 0.5): NavGrid {
    const grid = new NavGrid(this.groundSize, this.groundSize, cellSize);
    grid.build(this.debris, stepHeight, capsuleRadius);
    return grid;
  }

  /** Expose debris AABBs for camera collision */
  getDebris(): ReadonlyArray<Readonly<DebrisBox>> {
    return this.debris;
  }

  /** Get the ground/debris height at a point, optionally expanded by a radius */
  getTerrainY(x: number, z: number, radius = 0): number {
    let maxY = 0;
    for (const box of this.debris) {
      if (
        Math.abs(x - box.x) < box.halfW + radius &&
        Math.abs(z - box.z) < box.halfD + radius
      ) {
        maxY = Math.max(maxY, box.height);
      }
    }
    return maxY;
  }

  /**
   * Circle-vs-AABB collision resolve (capsule collider projected to XZ).
   * Moves the player, then pushes them out of any blocking obstacles.
   * Returns the resolved position and terrain Y.
   */
  resolveMovement(
    newX: number,
    newZ: number,
    currentY: number,
    stepHeight: number,
    radius: number,
  ): { x: number; z: number; y: number } {
    let rx = newX;
    let rz = newZ;

    // Clamp to world bounds
    const halfBound = this.groundSize / 2 - radius;
    rx = Math.max(-halfBound, Math.min(halfBound, rx));
    rz = Math.max(-halfBound, Math.min(halfBound, rz));

    // Iterative push-out (multiple passes for corners where boxes meet)
    for (let pass = 0; pass < 4; pass++) {
      for (const box of this.debris) {
        // Stepable boxes: no lateral collision — player walks over them
        // (Y adaptation handled below via radius-aware getTerrainY)
        if (box.height - currentY <= stepHeight) continue;

        // Check if circle center is inside the expanded AABB (box + radius)
        const expandedHalfW = box.halfW + radius;
        const expandedHalfD = box.halfD + radius;
        const relX = rx - box.x;
        const relZ = rz - box.z;
        if (Math.abs(relX) >= expandedHalfW || Math.abs(relZ) >= expandedHalfD) continue;

        // Circle center is inside the box AABB — need full AABB push-out
        const insideBox =
          Math.abs(relX) < box.halfW &&
          Math.abs(relZ) < box.halfD;

        if (insideBox) {
          // Push out on the axis with least penetration
          const overlapX = box.halfW + radius - Math.abs(relX);
          const overlapZ = box.halfD + radius - Math.abs(relZ);
          if (overlapX < overlapZ) {
            rx += (relX >= 0 ? 1 : -1) * overlapX;
          } else {
            rz += (relZ >= 0 ? 1 : -1) * overlapZ;
          }
          continue;
        }

        // Circle-vs-AABB: find closest point on box surface to circle center
        const closestX = Math.max(box.x - box.halfW, Math.min(rx, box.x + box.halfW));
        const closestZ = Math.max(box.z - box.halfD, Math.min(rz, box.z + box.halfD));

        const dx = rx - closestX;
        const dz = rz - closestZ;
        const distSq = dx * dx + dz * dz;

        if (distSq < radius * radius) {
          if (distSq > 0.0001) {
            // Penetrating — push out along the penetration normal
            const dist = Math.sqrt(distSq);
            const overlap = radius - dist;
            rx += (dx / dist) * overlap;
            rz += (dz / dist) * overlap;
          } else {
            // Exactly on the edge corner — push away from box center
            const awayX = rx - box.x;
            const awayZ = rz - box.z;
            const awayLen = Math.sqrt(awayX * awayX + awayZ * awayZ);
            if (awayLen > 0.0001) {
              rx += (awayX / awayLen) * radius;
              rz += (awayZ / awayLen) * radius;
            } else {
              rx += radius; // degenerate — just push +X
            }
          }
        }
      }
    }

    // Get terrain Y using player radius — starts stepping up as edge reaches debris
    const terrainY = this.getTerrainY(rx, rz, radius * 0.5);
    const y = terrainY - currentY <= stepHeight ? terrainY : currentY;

    return { x: rx, z: rz, y };
  }

  /** Check if point is fully on top of a box surface (not on an edge) */
  private isOnBoxSurface(x: number, z: number): boolean {
    for (const box of this.debris) {
      if (
        Math.abs(x - box.x) < box.halfW - 0.01 &&
        Math.abs(z - box.z) < box.halfD - 0.01
      ) {
        return true;
      }
    }
    return false;
  }

  dispose(): void {
    for (const entity of this.debrisEntities) {
      entity.destroy();
    }
    this.debrisEntities.length = 0;
  }

  /** Check if any taller debris box overlaps within `clearance` of (x, z) at surfaceY */
  private hasClearance(x: number, z: number, surfaceY: number, clearance: number): boolean {
    for (const box of this.debris) {
      if (box.height <= surfaceY + 0.01) continue; // same height or shorter — no obstruction
      if (
        Math.abs(x - box.x) < box.halfW + clearance &&
        Math.abs(z - box.z) < box.halfD + clearance
      ) {
        return false;
      }
    }
    return true;
  }

  getRandomPosition(margin = 3, clearance = 0.6): THREE.Vector3 {
    const half = this.groundSize / 2 - margin;
    for (let attempt = 0; attempt < 50; attempt++) {
      const x = snapPos((Math.random() - 0.5) * half * 2, 0);
      const z = snapPos((Math.random() - 0.5) * half * 2, 0);
      const y = this.getTerrainY(x, z);
      // Accept ground level, or fully on top of a box (not on an edge), with clearance from taller walls
      if ((y === 0 || this.isOnBoxSurface(x, z)) && this.hasClearance(x, z, y, clearance)) {
        return new THREE.Vector3(x, y, z);
      }
    }
    return new THREE.Vector3(0, 0, 0);
  }
}
