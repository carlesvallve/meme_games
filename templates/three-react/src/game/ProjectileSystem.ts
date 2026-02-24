import * as THREE from 'three';
import type { ProjectileConfig } from './CombatConfig';
import type { Enemy } from './Enemy';
import { audioSystem } from '../utils/AudioSystem';

// ── Constants ────────────────────────────────────────────────────────

const MAX_ACTIVE = 6;
const HIT_RADIUS = 0.3;
const FLY_Y_OFFSET = 0.3; // height above ground
const MAX_RANGE = 12;

// ── Homing constants ─────────────────────────────────────────────────
const HOMING_SEEK_RADIUS = 6;     // max distance to start tracking a target
const HOMING_TURN_RATE = 3.5;     // radians/sec — how fast the projectile steers
const HOMING_MIN_AGE = 0.05;      // don't home during initial launch burst
const HOMING_MAX_ANGLE = Math.PI / 3; // ~60° — only home on enemies roughly ahead

// ── Auto-target constants ────────────────────────────────────────────
const AUTO_TARGET_RANGE = 10;          // max distance to auto-target an enemy
const AUTO_TARGET_MIN_DOT = 0.5;       // cos(60°) — forward cone for target selection
const AUTO_TARGET_SPREAD = 0.1;        // ±~3° random deviation

// ── Projectile data ──────────────────────────────────────────────────

interface Projectile {
  mesh: THREE.Object3D;
  vx: number;
  vz: number;
  speed: number;
  damage: number;
  age: number;
  lifetime: number;
  startX: number;
  startZ: number;
  ownerKey: string;
  light: THREE.PointLight | null;
  isArrow: boolean;
}

// ── Mesh factories ───────────────────────────────────────────────────

function createArrowMesh(color: number): THREE.Group {
  const group = new THREE.Group();

  // Shaft
  const shaftGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.3, 4);
  shaftGeo.rotateZ(Math.PI / 2); // lay along X axis
  const shaftMat = new THREE.MeshStandardMaterial({ color: 0x886644 });
  group.add(new THREE.Mesh(shaftGeo, shaftMat));

  // Tip
  const tipGeo = new THREE.ConeGeometry(0.03, 0.08, 4);
  tipGeo.rotateZ(-Math.PI / 2); // point along +X
  tipGeo.translate(0.19, 0, 0);
  const tipMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 });
  group.add(new THREE.Mesh(tipGeo, tipMat));

  // Small light so the arrow is visible in dark dungeons
  const light = new THREE.PointLight(0xffffee, 1.0, 2.5);
  light.position.set(0.1, 0, 0);
  group.add(light);

  return group;
}

function createFireballMesh(color: number): THREE.Group {
  const group = new THREE.Group();

  const geo = new THREE.SphereGeometry(0.08, 8, 6);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  group.add(new THREE.Mesh(geo, mat));

  // Glow light
  const light = new THREE.PointLight(color, 1.5, 3);
  light.position.set(0, 0, 0);
  group.add(light);

  return group;
}

// ── Hit callback type ────────────────────────────────────────────────

export interface ProjectileHitInfo {
  enemy: Enemy;
  damage: number;
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirZ: number;
}

// ── ProjectileSystem ─────────────────────────────────────────────────

export class ProjectileSystem {
  private projectiles: Projectile[] = [];
  private cooldowns = new Map<string, number>();
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Fire a projectile, auto-targeting the nearest enemy in a forward cone.
   *  Falls back to character facing if no enemy is in range. */
  fireProjectile(
    ownerKey: string,
    config: ProjectileConfig,
    x: number,
    z: number,
    groundY: number,
    facing: number,
    enemies: ReadonlyArray<Enemy>,
  ): boolean {
    // Cooldown check
    const cd = this.cooldowns.get(ownerKey) ?? 0;
    if (cd > 0) return false;

    // Max active check
    if (this.projectiles.length >= MAX_ACTIVE) return false;

    // Set cooldown
    this.cooldowns.set(ownerKey, config.cooldown);

    // Auto-target: pick nearest enemy within forward cone
    const faceDirX = -Math.sin(facing);
    const faceDirZ = -Math.cos(facing);
    let dirX = faceDirX;
    let dirZ = faceDirZ;

    let bestDist = AUTO_TARGET_RANGE;
    for (const enemy of enemies) {
      if (!enemy.isAlive) continue;
      const edx = enemy.mesh.position.x - x;
      const edz = enemy.mesh.position.z - z;
      const eDist = Math.sqrt(edx * edx + edz * edz);
      if (eDist < 0.1 || eDist > bestDist) continue;

      // Check forward cone: dot product with facing
      const enx = edx / eDist;
      const enz = edz / eDist;
      const dot = faceDirX * enx + faceDirZ * enz;
      if (dot < AUTO_TARGET_MIN_DOT) continue; // outside ~120° cone

      bestDist = eDist;
      dirX = enx;
      dirZ = enz;
    }

    // Add slight random spread (±3°)
    const spread = (Math.random() - 0.5) * AUTO_TARGET_SPREAD;
    const cos = Math.cos(spread), sin = Math.sin(spread);
    const sdx = dirX * cos - dirZ * sin;
    const sdz = dirX * sin + dirZ * cos;
    dirX = sdx;
    dirZ = sdz;

    // Create mesh
    const isArrow = config.kind === 'arrow';
    const mesh = isArrow ? createArrowMesh(config.color) : createFireballMesh(config.color);

    // Spawn slightly ahead of owner
    const spawnOffset = 0.3;
    const px = x + dirX * spawnOffset;
    const pz = z + dirZ * spawnOffset;
    const py = groundY + FLY_Y_OFFSET;
    mesh.position.set(px, py, pz);

    // Orient: rotation.y so the mesh faces the travel direction
    if (isArrow) {
      // Arrow group: +X is forward, so rotate to match dir
      mesh.rotation.y = -Math.atan2(dirX, -dirZ) + Math.PI / 2;
    } else {
      mesh.rotation.y = Math.atan2(dirX, dirZ);
    }

    this.scene.add(mesh);

    // Extract light from projectile mesh (both arrows and fireballs have one)
    const light = (mesh.children.find(c => c instanceof THREE.PointLight) as THREE.PointLight | null);

    this.projectiles.push({
      mesh,
      vx: dirX * config.speed,
      vz: dirZ * config.speed,
      speed: config.speed,
      damage: config.damage,
      age: 0,
      lifetime: config.lifetime,
      startX: px,
      startZ: pz,
      ownerKey,
      light,
      isArrow,
    });

    // SFX — spatial, type-specific
    const sfxType = isArrow ? 'arrow' : 'fireball';
    audioSystem.sfxAt(sfxType, px, pz);

    return true;
  }

  /** Update all projectiles: move, collide, cleanup */
  update(
    dt: number,
    enemies: ReadonlyArray<Enemy>,
    onHit: (info: ProjectileHitInfo) => void,
  ): void {
    // Decrement cooldowns
    for (const [key, cd] of this.cooldowns) {
      const next = cd - dt;
      if (next <= 0) this.cooldowns.delete(key);
      else this.cooldowns.set(key, next);
    }

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;

      // Homing: steer toward enemy at smallest angle from travel direction
      if (p.age > HOMING_MIN_AGE) {
        const curAngle = Math.atan2(p.vx, p.vz);
        let bestAngleDiff = Infinity;
        let targetX = 0, targetZ = 0;
        let hasTarget = false;

        for (const enemy of enemies) {
          if (!enemy.isAlive) continue;
          const edx = enemy.mesh.position.x - p.mesh.position.x;
          const edz = enemy.mesh.position.z - p.mesh.position.z;
          const eDsq = edx * edx + edz * edz;
          if (eDsq > HOMING_SEEK_RADIUS * HOMING_SEEK_RADIUS || eDsq < 0.01) continue;

          // Angular difference from current travel direction
          const enemyAngle = Math.atan2(edx, edz);
          let diff = enemyAngle - curAngle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const absDiff = Math.abs(diff);

          // Only consider enemies within a forward cone (~120 degrees)
          if (absDiff < HOMING_MAX_ANGLE && absDiff < bestAngleDiff) {
            bestAngleDiff = absDiff;
            targetX = enemy.mesh.position.x;
            targetZ = enemy.mesh.position.z;
            hasTarget = true;
          }
        }

        if (hasTarget) {
          // Desired direction angle
          const tdx = targetX - p.mesh.position.x;
          const tdz = targetZ - p.mesh.position.z;
          const desiredAngle = Math.atan2(tdx, tdz);

          // Shortest angular difference
          let diff = desiredAngle - curAngle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;

          // Clamp turn by turn rate
          const maxTurn = HOMING_TURN_RATE * dt;
          const turn = Math.max(-maxTurn, Math.min(maxTurn, diff));
          const newAngle = curAngle + turn;

          p.vx = Math.sin(newAngle) * p.speed;
          p.vz = Math.cos(newAngle) * p.speed;

          // Update mesh rotation to match new direction
          if (p.isArrow) {
            p.mesh.rotation.y = -Math.atan2(p.vx, -p.vz) + Math.PI / 2;
          } else {
            p.mesh.rotation.y = Math.atan2(p.vx, p.vz);
          }
        }
      }

      // Move
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.z += p.vz * dt;

      // Fireball opacity pulse
      if (p.light) {
        const pulse = 0.7 + 0.3 * Math.sin(p.age * 20);
        const mat = (p.mesh.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
        mat.opacity = pulse;
        p.light.intensity = 1.0 + 0.5 * Math.sin(p.age * 20);
      }

      // Range check
      const dx = p.mesh.position.x - p.startX;
      const dz = p.mesh.position.z - p.startZ;
      const distSq = dx * dx + dz * dz;

      // Lifetime / range removal
      if (p.age >= p.lifetime || distSq > MAX_RANGE * MAX_RANGE) {
        this.removeProjectile(i);
        continue;
      }

      // Collision check vs enemies
      let hit = false;
      for (const enemy of enemies) {
        if (!enemy.isAlive) continue;
        const ex = enemy.mesh.position.x;
        const ez = enemy.mesh.position.z;
        const cdx = p.mesh.position.x - ex;
        const cdz = p.mesh.position.z - ez;
        const cDistSq = cdx * cdx + cdz * cdz;

        if (cDistSq < HIT_RADIUS * HIT_RADIUS) {
          // Compute hit direction
          const cDist = Math.sqrt(cDistSq) || 0.01;
          const hitDirX = cdx / cDist;
          const hitDirZ = cdz / cDist;

          // Apply damage
          const wasHit = enemy.takeDamage(p.damage, p.mesh.position.x - p.vx * 0.1, p.mesh.position.z - p.vz * 0.1);
          if (wasHit) {
            onHit({
              enemy,
              damage: p.damage,
              x: ex,
              y: enemy.mesh.position.y,
              z: ez,
              dirX: -hitDirX,
              dirZ: -hitDirZ,
            });
          }

          hit = true;
          break;
        }
      }

      if (hit) {
        this.removeProjectile(i);
      }
    }
  }

  private removeProjectile(index: number): void {
    const p = this.projectiles[index];

    // Dispose mesh children
    p.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });

    this.scene.remove(p.mesh);
    this.projectiles.splice(index, 1);
  }

  dispose(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      this.removeProjectile(i);
    }
    this.cooldowns.clear();
  }
}
