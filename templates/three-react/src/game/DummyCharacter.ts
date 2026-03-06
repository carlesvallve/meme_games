import * as THREE from 'three';
import type { NavGrid } from './pathfinding/NavGrid';
import { findPath } from './pathfinding/AStar';

const TURN_SPEED = 12;
const WAYPOINT_THRESHOLD = 0.3;
const HOP_HEIGHT = 0.06;

export class DummyCharacter {
  readonly root: THREE.Group;
  private navGrid: NavGrid;
  private facingAngle = 0;
  private path: { x: number; z: number }[] = [];
  private pathIndex = 0;
  private moveSpeed = 0;
  private hopEnabled = true;
  private hopPhase = 0;

  constructor(navGrid: NavGrid) {
    this.navGrid = navGrid;
    this.root = new THREE.Group();

    const geo = new THREE.BoxGeometry(0.5, 1, 0.5);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x44aaff, roughness: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  /** Camera-relative WASD movement. Cancels any active A* path. */
  moveDirectional(dx: number, dz: number, cameraAngleY: number, dt: number, speed: number): void {
    if (dx === 0 && dz === 0) {
      if (this.moveSpeed > 0 && this.path.length === 0) {
        this.moveSpeed = 0;
      }
      return;
    }

    // Cancel A* path
    this.path.length = 0;

    // Rotate input by camera Y angle
    const cos = Math.cos(cameraAngleY);
    const sin = Math.sin(cameraAngleY);
    const worldX = dx * cos + dz * sin;
    const worldZ = -dx * sin + dz * cos;

    const len = Math.sqrt(worldX * worldX + worldZ * worldZ);
    const nx = worldX / len;
    const nz = worldZ / len;

    this.moveSpeed = speed;
    const pos = this.root.position;
    pos.x += nx * speed * dt;
    pos.z += nz * speed * dt;

    // Clamp to navGrid bounds
    const half = this.navGrid.getHalfSize();
    pos.x = Math.max(-half, Math.min(half, pos.x));
    pos.z = Math.max(-half, Math.min(half, pos.z));

    // Smooth facing
    const targetAngle = Math.atan2(nx, nz);
    this.facingAngle = lerpAngle(this.facingAngle, targetAngle, 1 - Math.exp(-TURN_SPEED * dt));
    this.root.rotation.y = this.facingAngle;
  }

  /** Click-to-move: find A* path and follow it. */
  goTo(worldX: number, worldZ: number, speed: number): boolean {
    const pos = this.root.position;
    const result = findPath(this.navGrid, pos.x, pos.z, worldX, worldZ);
    if (!result.found || result.path.length < 2) return false;
    this.path = result.path;
    this.pathIndex = 1;
    this.moveSpeed = speed;
    return true;
  }

  /** Advance path following + hop. Call every frame. */
  update(dt: number, speed: number): void {
    // Follow A* path
    if (this.path.length > 0 && this.pathIndex < this.path.length) {
      const target = this.path[this.pathIndex];
      const pos = this.root.position;
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < WAYPOINT_THRESHOLD) {
        this.pathIndex++;
        if (this.pathIndex >= this.path.length) {
          this.path.length = 0;
          this.moveSpeed = 0;
        }
      } else {
        const step = Math.min(speed * dt, dist);
        pos.x += (dx / dist) * step;
        pos.z += (dz / dist) * step;

        const targetAngle = Math.atan2(dx / dist, dz / dist);
        this.facingAngle = lerpAngle(this.facingAngle, targetAngle, 1 - Math.exp(-TURN_SPEED * dt));
        this.root.rotation.y = this.facingAngle;

        this.moveSpeed = speed;
      }
    }

    // Simple hop when moving
    if (this.hopEnabled && this.moveSpeed > 0) {
      this.hopPhase += dt * this.moveSpeed * 2;
      const hop = Math.abs(Math.sin(this.hopPhase)) * HOP_HEIGHT;
      this.root.position.y = hop;
    } else {
      this.root.position.y = 0;
      this.hopPhase = 0;
    }
  }

  getPosition(): THREE.Vector3 {
    return this.root.position;
  }

  dispose(): void {
    this.root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else (mat as THREE.Material).dispose();
      }
    });
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
