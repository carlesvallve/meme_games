import * as THREE from 'three';
import type { Terrain } from './Terrain';
import { useGameStore } from '../store';
import { Entity, Layer } from './Entity';
import { audioSystem } from '../utils/AudioSystem';

interface LootItem {
  mesh: THREE.Mesh;
  entity: Entity;
  vel: THREE.Vector3;
  grounded: boolean;
  bounceCount: number;
  age: number;
  delay: number;         // stagger before ejection starts
  gracePeriod: number;
  collected: boolean;
  type: 'coin' | 'potion';
  value: number;
}

const GRAVITY = 20;
const DRAG = 3.5;       // air drag — kills velocity fast for a punchy burst
const BOUNCE_Y = -0.35;
const BOUNCE_XZ = 0.6;
const SETTLE_THRESHOLD = 0.5;

export class LootSystem {
  private items: LootItem[] = [];
  private readonly scene: THREE.Scene;
  private readonly terrain: Terrain;
  private readonly pickupRadius = 0.4;

  private readonly coinGeo: THREE.BufferGeometry;
  private readonly potionGeo: THREE.BufferGeometry;
  private readonly coinMat: THREE.MeshStandardMaterial;
  private readonly potionMats: THREE.MeshStandardMaterial[];

  constructor(scene: THREE.Scene, terrain: Terrain) {
    this.scene = scene;
    this.terrain = terrain;

    this.coinGeo = new THREE.OctahedronGeometry(0.08, 0);
    this.potionGeo = new THREE.SphereGeometry(0.07, 6, 4);

    this.coinMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      emissive: 0xffd700,
      emissiveIntensity: 0.4,
      roughness: 0.3,
      metalness: 0.8,
    });

    this.potionMats = [
      new THREE.MeshStandardMaterial({ color: 0xff4444, emissive: 0xff4444, emissiveIntensity: 0.3, roughness: 0.2, metalness: 0.1 }),
      new THREE.MeshStandardMaterial({ color: 0x44aaff, emissive: 0x44aaff, emissiveIntensity: 0.3, roughness: 0.2, metalness: 0.1 }),
      new THREE.MeshStandardMaterial({ color: 0x44ff88, emissive: 0x44ff88, emissiveIntensity: 0.3, roughness: 0.2, metalness: 0.1 }),
    ];
  }

  spawnLoot(position: THREE.Vector3): void {
    const count = 4 + Math.floor(Math.random() * 5); // 4-8 items

    for (let i = 0; i < count; i++) {
      const isCoin = Math.random() < 0.7;
      const type: 'coin' | 'potion' = isCoin ? 'coin' : 'potion';

      const geo = isCoin ? this.coinGeo : this.potionGeo;
      const mat = isCoin
        ? this.coinMat
        : this.potionMats[Math.floor(Math.random() * this.potionMats.length)];

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(position);
      mesh.position.y += 0.3; // start above chest
      mesh.castShadow = true;
      mesh.visible = false; // hidden until delay expires
      this.scene.add(mesh);

      const entity = new Entity(mesh, { layer: Layer.Collectible, radius: 0.08 });

      // Random ejection angle
      const angle = Math.random() * Math.PI * 2;
      const hSpeed = 2.5 + Math.random() * 2.0;
      const vel = new THREE.Vector3(
        Math.cos(angle) * hSpeed,
        4.0 + Math.random() * 2.0, // punchy upward — drag keeps it below walls
        Math.sin(angle) * hSpeed,
      );

      this.items.push({
        mesh,
        entity,
        vel,
        grounded: false,
        bounceCount: 0,
        age: 0,
        delay: i * 0.04 + Math.random() * 0.03, // stagger each item
        gracePeriod: 1.2 + Math.random() * 0.6,
        collected: false,
        type,
        value: isCoin ? 1 : 3,
      });
    }
  }

  update(dt: number, playerPos: THREE.Vector3): { coins: number; potions: number } {
    let coins = 0;
    let potions = 0;
    const { magnetRadius, magnetSpeed } = useGameStore.getState().playerParams;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      if (item.collected) continue;

      item.age += dt;

      // Stagger delay — hold before ejection
      if (item.delay > 0) {
        item.delay -= dt;
        continue;
      }
      if (!item.mesh.visible) item.mesh.visible = true;

      // Physics (if not grounded)
      if (!item.grounded) {
        // Air drag — decays horizontal + vertical velocity for a punchy burst
        const dragFactor = Math.exp(-DRAG * dt);
        item.vel.x *= dragFactor;
        item.vel.z *= dragFactor;
        item.vel.y -= GRAVITY * dt;
        item.mesh.position.x += item.vel.x * dt;
        item.mesh.position.y += item.vel.y * dt;
        item.mesh.position.z += item.vel.z * dt;

        // Spin
        item.mesh.rotation.y += dt * 8;
        item.mesh.rotation.x += dt * 5;

        // Floor check
        const terrainY = this.terrain.getTerrainY(item.mesh.position.x, item.mesh.position.z);
        const floorY = terrainY + 0.08; // mesh radius

        if (item.mesh.position.y <= floorY) {
          item.mesh.position.y = floorY;
          const impactSpeed = Math.abs(item.vel.y);

          if (impactSpeed < SETTLE_THRESHOLD && item.vel.length() < 1) {
            // Settle
            item.grounded = true;
            item.vel.set(0, 0, 0);
            audioSystem.sfx('thud', Math.min(impactSpeed / 8, 1), item.bounceCount);
          } else {
            // Bounce
            item.vel.y *= BOUNCE_Y;
            item.vel.x *= BOUNCE_XZ;
            item.vel.z *= BOUNCE_XZ;
            audioSystem.sfx('thud', Math.min(impactSpeed / 8, 1), item.bounceCount);
            item.bounceCount++;
          }
        }
      } else {
        // Slow spin when grounded
        item.mesh.rotation.y += dt * 2;
      }

      // Distance to player (XZ)
      const dx = playerPos.x - item.mesh.position.x;
      const dz = playerPos.z - item.mesh.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Magnet attraction after grace period
      if (item.age > item.gracePeriod && dist < magnetRadius && dist > this.pickupRadius) {
        // Stop physics, float toward player
        item.grounded = true;
        const speed = (1 - dist / magnetRadius) * magnetSpeed * dt;
        item.mesh.position.x += (dx / dist) * speed;
        item.mesh.position.z += (dz / dist) * speed;
        // Float up slightly toward player height
        const dy = playerPos.y + 0.3 - item.mesh.position.y;
        item.mesh.position.y += dy * 4 * dt;
      }

      // Pickup
      if (dist < this.pickupRadius) {
        item.collected = true;
        item.mesh.visible = false;
        if (item.type === 'coin') coins++;
        else potions++;
      }
    }

    // Clean up collected items
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].collected && !this.items[i].mesh.visible) {
        const item = this.items[i];
        item.entity.destroy();
        this.scene.remove(item.mesh);
        this.items.splice(i, 1);
      }
    }

    return { coins, potions };
  }

  dispose(): void {
    for (const item of this.items) {
      item.entity.destroy();
      this.scene.remove(item.mesh);
    }
    this.items.length = 0;
    this.coinGeo.dispose();
    this.potionGeo.dispose();
    this.coinMat.dispose();
    for (const mat of this.potionMats) mat.dispose();
  }
}
