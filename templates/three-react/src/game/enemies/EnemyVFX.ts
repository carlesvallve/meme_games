import * as THREE from 'three';
import type { Character } from '../character';
import type { GoreSystem } from '../combat/GoreSystem';

// ── Slash trail particles ────────────────────────────────────────────

export type SlashStyle = 'horizontal' | 'vertical' | 'thrust' | 'short' | 'default';

export interface SlashTrail {
  points: THREE.Points;
  velocities: Float32Array;
  age: number;
  lifetime: number;
}

const TRAIL_CONFIG: Record<SlashStyle, { count: number; lifetime: number; size: number; offset: number; sideShift: number }> = {
  horizontal: { count: 8,  lifetime: 0.2, size: 0.05, offset: 0.25, sideShift: 0.18 },
  vertical:   { count: 8,  lifetime: 0.2,  size: 0.075,  offset: 0.25, sideShift: 0 },
  thrust:     { count: 10, lifetime: 0.4,  size: 0.05, offset: 0.5,  sideShift: 0.1 },
  short:      { count: 7,  lifetime: 0.3, size: 0.075, offset: 0.35, sideShift: 0.1 },
  default:    { count: 6,  lifetime: 0.2, size: 0.05, offset: 0,    sideShift: 0 },
};

export function createSlashTrail(
  scene: THREE.Scene, x: number, y: number, z: number,
  facing: number, style: SlashStyle, flipped: boolean,
): SlashTrail {
  const cfg = TRAIL_CONFIG[style];
  const positions = new Float32Array(cfg.count * 3);
  const velocities = new Float32Array(cfg.count * 3);

  // Direction vectors relative to character facing
  const fwdX = -Math.sin(facing);
  const fwdZ = -Math.cos(facing);
  const rightX = -fwdZ;
  const rightZ = fwdX;
  const flipSign = flipped ? 1 : -1;

  const wpX = x + fwdX * cfg.offset;
  const wpY = y + 0.22;
  const wpZ = z + fwdZ * cfg.offset;

  for (let i = 0; i < cfg.count; i++) {
    const speed = 2.0 + Math.random() * 2.5;
    let vx: number, vy: number, vz: number;

    if (style === 'horizontal') {
      // Particles spread along a vertical line, offset to the slash origin side
      const t = i / (cfg.count - 1);
      const spread = (t - 0.5) * 0.3; // vertical spread
      const sideOffset = cfg.sideShift * flipSign;
      positions[i * 3]     = wpX + rightX * sideOffset + (Math.random() - 0.5) * 0.04;
      positions[i * 3 + 1] = wpY + spread;
      positions[i * 3 + 2] = wpZ + rightZ * sideOffset + (Math.random() - 0.5) * 0.04;
      // All move in the same sideways direction
      vx = rightX * -flipSign * speed;
      vy = (Math.random() - 0.5) * 0.3;
      vz = rightZ * -flipSign * speed;
    } else if (style === 'vertical') {
      // Particles spread laterally, offset upward, all move downward
      const t = i / (cfg.count - 1);
      const spread = (t - 0.5) * 0.3; // lateral spread
      const downOffset = -0.15; // start below
      positions[i * 3]     = wpX + rightX * spread + (Math.random() - 0.5) * 0.04;
      positions[i * 3 + 1] = wpY + downOffset;
      positions[i * 3 + 2] = wpZ + rightZ * spread + (Math.random() - 0.5) * 0.04;
      // Move up + slightly forward (diagonal)
      vx = -fwdX * speed * 0.35;
      vy = speed;
      vz = -fwdZ * speed * 0.35;
    } else {
      // Thrust/short: start at weapon tip, offset laterally based on flip
      const sideShift = cfg.sideShift * flipSign;
      positions[i * 3]     = wpX + rightX * sideShift + (Math.random() - 0.5) * 0.04;
      positions[i * 3 + 1] = wpY + (Math.random() - 0.5) * 0.04;
      positions[i * 3 + 2] = wpZ + rightZ * sideShift + (Math.random() - 0.5) * 0.04;
      const backX = Math.sin(facing);
      const backZ = Math.cos(facing);
      const spread = (Math.random() - 0.5) * 0.8;
      vx = (backX + spread * backZ) * speed;
      vy = (Math.random() - 0.3) * 0.5;
      vz = (backZ - spread * backX) * speed;
    }

    velocities[i * 3]     = vx;
    velocities[i * 3 + 1] = vy;
    velocities[i * 3 + 2] = vz;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: cfg.size,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);
  return { points, velocities, age: 0, lifetime: cfg.lifetime };
}

// ── Damage number ────────────────────────────────────────────────────

export interface DamageNumber {
  sprite: THREE.Sprite;
  age: number;
  lifetime: number;
  startY: number;
  startX: number;
  startZ: number;
  dirX: number;
  dirZ: number;
  baseScaleX: number;
  baseScaleY: number;
}

export function createDamageNumber(scene: THREE.Scene, x: number, y: number, z: number, amount: number, dirX = 0, dirZ = 0, isCrit = false): DamageNumber {
  const canvas = document.createElement('canvas');
  canvas.width = isCrit ? 128 : 64;
  canvas.height = isCrit ? 48 : 32;
  const ctx = canvas.getContext('2d')!;
  if (isCrit) {
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffaa22';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    const text = `${amount}!`;
    ctx.strokeText(text, 64, 24);
    ctx.fillText(text, 64, 24);
  } else {
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff4444';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeText(`${amount}`, 32, 16);
    ctx.fillText(`${amount}`, 32, 16);
  }

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(x, y + 0.5, z);
  const scaleX = isCrit ? 0.6 : 0.4;
  const scaleY = isCrit ? 0.3 : 0.2;
  sprite.scale.set(scaleX, scaleY, 1);
  sprite.renderOrder = 1002;
  scene.add(sprite);

  return { sprite, age: 0, lifetime: isCrit ? 2.0 : 1.6, startY: y + 0.5, startX: x, startZ: z, dirX, dirZ, baseScaleX: scaleX, baseScaleY: scaleY };
}

export function createFloatingLabel(scene: THREE.Scene, x: number, y: number, z: number, text: string, color = '#ffffff', size: 'sm' | 'md' = 'sm'): DamageNumber {
  const canvas = document.createElement('canvas');
  const isMd = size === 'md';
  canvas.width = isMd ? 160 : 128;
  canvas.height = isMd ? 40 : 32;
  const ctx = canvas.getContext('2d')!;
  ctx.font = isMd ? 'bold 24px monospace' : 'bold 20px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(x, y + 0.5, z);
  const scaleX = isMd ? 0.65 : 0.55;
  const scaleY = isMd ? 0.19 : 0.16;
  sprite.scale.set(scaleX, scaleY, 1);
  sprite.renderOrder = 1002;
  scene.add(sprite);

  return { sprite, age: 0, lifetime: 1.2, startY: y + 0.5, startX: x, startZ: z, dirX: 0, dirZ: 0, baseScaleX: scaleX, baseScaleY: scaleY };
}

// ── Hit spark particles ──────────────────────────────────────────────

export interface HitSparks {
  points: THREE.Points;
  velocities: Float32Array;
  age: number;
  lifetime: number;
}

export function createHitSparks(scene: THREE.Scene, x: number, y: number, z: number, dirX: number, dirZ: number): HitSparks {
  const count = 8;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = x;
    positions[i * 3 + 1] = y + 0.3;
    positions[i * 3 + 2] = z;

    const spread = (Math.random() - 0.5) * 2;
    const speed = 2 + Math.random() * 3;
    velocities[i * 3] = (dirX + spread * 0.5) * speed;
    velocities[i * 3 + 1] = (Math.random() * 1.5 + 0.5) * speed * 0.4;
    velocities[i * 3 + 2] = (dirZ + spread * 0.5) * speed;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffffaa,
    size: 0.06,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);
  return { points, velocities, age: 0, lifetime: 0.3 };
}

export function createMetalSparks(scene: THREE.Scene, x: number, y: number, z: number, dirX: number, dirZ: number): HitSparks {
  const count = 12;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = x;
    positions[i * 3 + 1] = y + 0.3;
    positions[i * 3 + 2] = z;

    const spread = (Math.random() - 0.5) * 3;
    const speed = 3 + Math.random() * 4;
    velocities[i * 3] = (dirX + spread * 0.6) * speed;
    velocities[i * 3 + 1] = (Math.random() * 2 + 1) * speed * 0.4;
    velocities[i * 3 + 2] = (dirZ + spread * 0.6) * speed;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0xffeedd,
    size: 0.07,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);
  return { points, velocities, age: 0, lifetime: 0.4 };
}

/** Random deflect onomatopoeia */
const DEFLECT_LABELS = ['CLANK!', 'TINK!', 'CLANG!', 'KLING!', 'TONK!'];
export function randomDeflectLabel(): string {
  return DEFLECT_LABELS[Math.floor(Math.random() * DEFLECT_LABELS.length)];
}

// ── EnemyVFX class ──────────────────────────────────────────────────

export class EnemyVFX {
  private damageNumbers: DamageNumber[] = [];
  private slashTrails: SlashTrail[] = [];
  private hitSparks: HitSparks[] = [];

  private readonly scene: THREE.Scene;
  private goreSystem: GoreSystem | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  setGoreSystem(gore: GoreSystem): void {
    this.goreSystem = gore;
  }

  getGoreSystem(): GoreSystem | null {
    return this.goreSystem;
  }

  // ── Push methods (used internally by EnemySystem/EnemyCombat) ──

  pushSlashArc(parent: THREE.Object3D, style: SlashStyle = 'horizontal'): void {
    const pos = new THREE.Vector3();
    parent.getWorldPosition(pos);
    const flipped = parent.scale.x < 0;
    this.slashTrails.push(createSlashTrail(this.scene, pos.x, pos.y, pos.z, parent.rotation.y, style, flipped));
  }

  pushDamageNumber(x: number, y: number, z: number, amount: number, dirX = 0, dirZ = 0, isCrit = false): void {
    this.damageNumbers.push(createDamageNumber(this.scene, x, y, z, amount, dirX, dirZ, isCrit));
  }

  pushFloatingLabel(x: number, y: number, z: number, text: string, color = '#ffffff', size: 'sm' | 'md' = 'sm'): void {
    this.damageNumbers.push(createFloatingLabel(this.scene, x, y, z, text, color, size));
  }

  pushHitSparks(x: number, y: number, z: number, dirX: number, dirZ: number): void {
    this.hitSparks.push(createHitSparks(this.scene, x, y, z, dirX, dirZ));
  }

  pushMetalSparks(x: number, y: number, z: number, dirX: number, dirZ: number): void {
    this.hitSparks.push(createMetalSparks(this.scene, x, y, z, dirX, dirZ));
  }

  // ── Public spawn API (external consumers: ProjectileSystem, Game.ts) ──

  spawnDamageNumber(x: number, y: number, z: number, amount: number, dirX = 0, dirZ = 0, isCrit = false): void {
    this.damageNumbers.push(createDamageNumber(this.scene, x, y + 0.3, z, amount, dirX, dirZ, isCrit));
  }

  spawnPickupLabel(x: number, y: number, z: number, text: string, color = '#ffffff', size: 'sm' | 'md' = 'sm'): void {
    const jx = (Math.random() - 0.5) * 0.3;
    const jy = (Math.random() - 0.5) * 0.2;
    const jz = (Math.random() - 0.5) * 0.3;
    this.damageNumbers.push(createFloatingLabel(this.scene, x + jx, y + 0.3 + jy, z + jz, text, color, size));
  }

  spawnHitSparks(x: number, y: number, z: number, dirX: number, dirZ: number): void {
    this.hitSparks.push(createHitSparks(this.scene, x, y, z, dirX, dirZ));
  }

  spawnBloodSplash(x: number, y: number, z: number, groundY: number, nearby?: Character[]): void {
    if (this.goreSystem) {
      this.goreSystem.spawnBloodSplash(x, y, z, groundY, nearby);
    }
  }

  spawnDeflectVFX(x: number, y: number, z: number, dirX: number, dirZ: number): void {
    this.hitSparks.push(createMetalSparks(this.scene, x, y, z, dirX, dirZ));
    this.damageNumbers.push(createFloatingLabel(this.scene, x, y + 0.3, z, randomDeflectLabel(), '#ccddff', 'md'));
  }

  // ── Update loops ──

  update(dt: number): void {
    this.updateSlashTrails(dt);
    this.updateHitSparks(dt);
    this.updateDamageNumbers(dt);
  }

  private updateSlashTrails(dt: number): void {
    for (let i = this.slashTrails.length - 1; i >= 0; i--) {
      const trail = this.slashTrails[i];
      trail.age += dt;
      if (trail.age >= trail.lifetime) {
        this.scene.remove(trail.points);
        trail.points.geometry.dispose();
        (trail.points.material as THREE.PointsMaterial).dispose();
        this.slashTrails.splice(i, 1);
        continue;
      }
      const positions = trail.points.geometry.attributes.position as THREE.BufferAttribute;
      const count = positions.count;
      for (let j = 0; j < count; j++) {
        positions.setX(j, positions.getX(j) + trail.velocities[j * 3] * dt);
        positions.setY(j, positions.getY(j) + trail.velocities[j * 3 + 1] * dt);
        positions.setZ(j, positions.getZ(j) + trail.velocities[j * 3 + 2] * dt);
      }
      positions.needsUpdate = true;
      (trail.points.material as THREE.PointsMaterial).opacity = 0.6 * (1 - trail.age / trail.lifetime);
    }
  }

  private updateHitSparks(dt: number): void {
    const GRAVITY = 8;
    for (let i = this.hitSparks.length - 1; i >= 0; i--) {
      const hs = this.hitSparks[i];
      hs.age += dt;
      if (hs.age >= hs.lifetime) {
        this.scene.remove(hs.points);
        hs.points.geometry.dispose();
        (hs.points.material as THREE.PointsMaterial).dispose();
        this.hitSparks.splice(i, 1);
        continue;
      }
      const positions = hs.points.geometry.attributes.position as THREE.BufferAttribute;
      const count = positions.count;
      for (let j = 0; j < count; j++) {
        positions.setX(j, positions.getX(j) + hs.velocities[j * 3] * dt);
        hs.velocities[j * 3 + 1] -= GRAVITY * dt;
        positions.setY(j, positions.getY(j) + hs.velocities[j * 3 + 1] * dt);
        positions.setZ(j, positions.getZ(j) + hs.velocities[j * 3 + 2] * dt);
      }
      positions.needsUpdate = true;
      (hs.points.material as THREE.PointsMaterial).opacity = 1 - (hs.age / hs.lifetime);
    }
  }

  private updateDamageNumbers(dt: number): void {
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const dn = this.damageNumbers[i];
      dn.age += dt;
      if (dn.age >= dn.lifetime) {
        this.scene.remove(dn.sprite);
        (dn.sprite.material as THREE.SpriteMaterial).map?.dispose();
        (dn.sprite.material as THREE.SpriteMaterial).dispose();
        this.damageNumbers.splice(i, 1);
        continue;
      }
      const t = dn.age / dn.lifetime;

      const popEnd = 0.15;
      let scale: number;
      if (t < popEnd) {
        const pt = t / popEnd;
        scale = 1 + 0.6 * Math.sin(pt * Math.PI);
      } else {
        scale = 1;
      }
      dn.sprite.scale.set(dn.baseScaleX * scale, dn.baseScaleY * scale, 1);

      const driftT = Math.max(0, t - popEnd) / (1 - popEnd);
      const ease = 1 - (1 - driftT) * (1 - driftT);
      dn.sprite.position.y = dn.startY + driftT * 0.35;
      dn.sprite.position.x = dn.startX + dn.dirX * ease * 0.3;
      dn.sprite.position.z = dn.startZ + dn.dirZ * ease * 0.3;

      const fadeStart = 0.6;
      (dn.sprite.material as THREE.SpriteMaterial).opacity =
        t < fadeStart ? 1 : 1 - ((t - fadeStart) / (1 - fadeStart));
    }
  }

  dispose(): void {
    for (const dn of this.damageNumbers) {
      this.scene.remove(dn.sprite);
      (dn.sprite.material as THREE.SpriteMaterial).map?.dispose();
      (dn.sprite.material as THREE.SpriteMaterial).dispose();
    }
    this.damageNumbers = [];

    for (const trail of this.slashTrails) {
      this.scene.remove(trail.points);
      trail.points.geometry.dispose();
      (trail.points.material as THREE.PointsMaterial).dispose();
    }
    this.slashTrails = [];

    for (const hs of this.hitSparks) {
      this.scene.remove(hs.points);
      hs.points.geometry.dispose();
      (hs.points.material as THREE.PointsMaterial).dispose();
    }
    this.hitSparks = [];
  }
}
