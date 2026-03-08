import * as THREE from 'three';
import { audioSystem } from '../utils/AudioSystem';

/** A single debris chunk with physics. */
interface Chunk {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  groundY: number;
  life: number;
  maxLife: number;
  bounced: number;
}

const GRAVITY = 12;
const DRAG = 1.5;
const BOUNCE_Y = -0.3;
const BOUNCE_XZ = 0.4;
const MAX_BOUNCES = 2;

const sharedGeo = new THREE.BoxGeometry(1, 1, 1);

/**
 * Gore-style destruction debris: small colored cubes that fly out with
 * physics, bounce, spin, and fade away.
 */
const MAX_THUDS_PER_FRAME = 3;

export class DestructionDebris {
  private chunks: Chunk[] = [];
  private group = new THREE.Group();
  private thudsThisFrame = 0;

  constructor(private scene: THREE.Scene) {
    scene.add(this.group);
  }

  /** Spawn an explosion of debris cubes at a position. */
  spawn(
    x: number, y: number, z: number,
    color: number | THREE.Color,
    count = 30,
    ejectSpeed = 5,
    sizeMin = 0.03,
    sizeMax = 0.12,
  ): void {
    const baseColor = color instanceof THREE.Color ? color : new THREE.Color(color);

    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: baseColor.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.15),
        roughness: 0.7,
        metalness: 0.15,
        transparent: true,
        opacity: 1,
      });

      const mesh = new THREE.Mesh(sharedGeo, mat);
      const sx = sizeMin + Math.random() * (sizeMax - sizeMin);
      const sy = sizeMin + Math.random() * (sizeMax - sizeMin);
      const sz = sizeMin + Math.random() * (sizeMax - sizeMin);
      mesh.scale.set(sx, sy, sz);
      mesh.position.set(x, y, z);
      mesh.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI,
      );
      mesh.castShadow = true;

      const angle = Math.random() * Math.PI * 2;
      const speed = ejectSpeed * (0.5 + Math.random() * 0.5);
      const vel = new THREE.Vector3(
        Math.cos(angle) * speed,
        1.5 + Math.random() * 3,
        Math.sin(angle) * speed,
      );

      const life = 3 + Math.random() * 5;
      this.group.add(mesh);
      this.chunks.push({ mesh, vel, groundY: 0, life, maxLife: life, bounced: 0 });
    }
  }

  update(dt: number): void {
    this.thudsThisFrame = 0;
    const dragFactor = Math.exp(-DRAG * dt);

    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      c.life -= dt;

      if (c.life <= 0) {
        this.group.remove(c.mesh);
        (c.mesh.material as THREE.Material).dispose();
        this.chunks.splice(i, 1);
        continue;
      }

      // Physics
      c.vel.x *= dragFactor;
      c.vel.z *= dragFactor;
      c.vel.y -= GRAVITY * dt;

      c.mesh.position.x += c.vel.x * dt;
      c.mesh.position.y += c.vel.y * dt;
      c.mesh.position.z += c.vel.z * dt;

      // Spin based on velocity
      c.mesh.rotation.x += c.vel.x * dt * 4;
      c.mesh.rotation.z += c.vel.z * dt * 4;

      // Ground collision
      const restY = c.groundY + c.mesh.scale.y * 0.5 + 0.01;
      if (c.mesh.position.y < restY) {
        c.mesh.position.y = restY;
        const impactSpeed = Math.abs(c.vel.y);
        c.bounced++;
        if (c.bounced <= MAX_BOUNCES) {
          // Thud SFX — intensity from impact speed, pitch drops per bounce
          if (this.thudsThisFrame < MAX_THUDS_PER_FRAME) {
            const intensity = Math.min(impactSpeed / 8, 1);
            if (intensity > 0.05) {
              audioSystem.sfxAt('thud', c.mesh.position.x, c.mesh.position.z, intensity, c.bounced);
              this.thudsThisFrame++;
            }
          }
          c.vel.y *= BOUNCE_Y;
          c.vel.x *= BOUNCE_XZ;
          c.vel.z *= BOUNCE_XZ;
        } else {
          c.vel.set(0, 0, 0);
        }
      }

      // Fade out in last 40% of life
      const fadeStart = c.maxLife * 0.6;
      if (c.life < fadeStart) {
        (c.mesh.material as THREE.MeshStandardMaterial).opacity = c.life / fadeStart;
      }
    }
  }

  dispose(): void {
    for (const c of this.chunks) {
      this.group.remove(c.mesh);
      (c.mesh.material as THREE.Material).dispose();
    }
    this.chunks = [];
    this.scene.remove(this.group);
  }
}
