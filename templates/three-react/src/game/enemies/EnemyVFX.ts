import * as THREE from 'three';
import type { Character } from '../character';
import type { GoreSystem } from '../combat/GoreSystem';

// ── Slash arc visual ─────────────────────────────────────────────────

export interface SlashArc {
  mesh: THREE.Mesh;
  parent: THREE.Object3D;
  age: number;
  lifetime: number;
  totalIndices: number;
  segments: number;
}

export function createSlashArc(parent: THREE.Object3D): SlashArc {
  const arcAngle = Math.PI * 0.7;
  const innerR = 0.1;
  const outerR = 0.5;
  const segments = 14;
  const vertCount = (segments + 1) * 2;
  const positions = new Float32Array(vertCount * 3);

  for (let i = 0; i <= segments; i++) {
    const a = -arcAngle / 2 + (arcAngle * i) / segments;
    const oi = i * 3;
    positions[oi]     = Math.sin(a) * outerR;
    positions[oi + 1] = 0;
    positions[oi + 2] = -Math.cos(a) * outerR;
    const ii = (segments + 1 + i) * 3;
    positions[ii]     = Math.sin(a) * innerR;
    positions[ii + 1] = 0;
    positions[ii + 2] = -Math.cos(a) * innerR;
  }

  const indices: number[] = [];
  for (let i = 0; i < segments; i++) {
    const o0 = i;
    const o1 = i + 1;
    const i0 = segments + 1 + i;
    const i1 = segments + 1 + i + 1;
    indices.push(o0, o1, i1);
    indices.push(o0, i1, i0);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.setDrawRange(0, 0);

  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 0.25, 0);
  mesh.rotation.y = 0;

  parent.add(mesh);
  return { mesh, parent, age: 0, lifetime: 0.18, totalIndices: indices.length, segments };
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
  private slashArcs: SlashArc[] = [];
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

  pushSlashArc(parent: THREE.Object3D): void {
    this.slashArcs.push(createSlashArc(parent));
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
    this.updateSlashArcs(dt);
    this.updateHitSparks(dt);
    this.updateDamageNumbers(dt);
  }

  private updateSlashArcs(dt: number): void {
    for (let i = this.slashArcs.length - 1; i >= 0; i--) {
      const arc = this.slashArcs[i];
      arc.age += dt;
      if (arc.age >= arc.lifetime) {
        arc.parent.remove(arc.mesh);
        arc.mesh.geometry.dispose();
        (arc.mesh.material as THREE.Material).dispose();
        this.slashArcs.splice(i, 1);
        continue;
      }

      const t = arc.age / arc.lifetime;
      const sweepT = Math.min(t / 0.6, 1);
      const eased = 1 - (1 - sweepT) * (1 - sweepT);
      const revealedSegments = Math.ceil(eased * arc.segments);
      const indexCount = revealedSegments * 6;
      arc.mesh.geometry.setDrawRange(0, Math.min(indexCount, arc.totalIndices));

      const scale = 1 + t * 0.2;
      arc.mesh.scale.set(scale, scale, scale);

      const opacity = 0.35 * (1 - t * t);
      (arc.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
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

    for (const arc of this.slashArcs) {
      arc.parent.remove(arc.mesh);
      arc.mesh.geometry.dispose();
      (arc.mesh.material as THREE.Material).dispose();
    }
    this.slashArcs = [];

    for (const hs of this.hitSparks) {
      this.scene.remove(hs.points);
      hs.points.geometry.dispose();
      (hs.points.material as THREE.PointsMaterial).dispose();
    }
    this.hitSparks = [];
  }
}
