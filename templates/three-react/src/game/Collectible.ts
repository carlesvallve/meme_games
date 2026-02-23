import * as THREE from 'three';
import type { Terrain } from './Terrain';
import { useGameStore } from '../store';
import { Entity, Layer } from './Entity';

interface CollectibleObj {
  mesh: THREE.Mesh;
  entity: Entity;
  baseY: number;
  phase: number;
  collected: boolean;
  respawnTimer: number;
}

export class CollectibleSystem {
  private collectibles: CollectibleObj[] = [];
  private readonly scene: THREE.Scene;
  private readonly terrain: Terrain;
  private readonly pickupRadius = 0.4;
  private readonly count = 15;
  private totalCollected = 0;

  private readonly gemColors = [0x44ffaa, 0xff44aa, 0x44aaff, 0xffaa44, 0xaa44ff];
  private readonly geometry: THREE.BufferGeometry;

  constructor(scene: THREE.Scene, terrain: Terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.geometry = new THREE.OctahedronGeometry(0.12, 0);

    for (let i = 0; i < this.count; i++) {
      this.spawnCollectible();
    }
  }

  private spawnCollectible(): void {
    const pos = this.terrain.getRandomPosition(4);
    const color = this.gemColors[Math.floor(Math.random() * this.gemColors.length)];

    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.8,
    });

    const mesh = new THREE.Mesh(this.geometry, mat);
    mesh.position.set(pos.x, pos.y + 0.35, pos.z);
    mesh.castShadow = true;
    this.scene.add(mesh);

    const entity = new Entity(mesh, { layer: Layer.Collectible, radius: 0.12 });

    this.collectibles.push({
      mesh,
      entity,
      baseY: pos.y + 0.35,
      phase: Math.random() * Math.PI * 2,
      collected: false,
      respawnTimer: 0,
    });
  }

  update(dt: number, playerPos: THREE.Vector3): number {
    let collected = 0;

    for (const c of this.collectibles) {
      if (c.collected) {
        c.respawnTimer -= dt;
        if (c.respawnTimer <= 0) {
          // Respawn at new position
          const pos = this.terrain.getRandomPosition(4);
          c.mesh.position.set(pos.x, pos.y + 0.35, pos.z);
          c.baseY = pos.y + 0.35;
          c.collected = false;
          c.mesh.visible = true;
        }
        continue;
      }

      // Spin and bob
      c.phase += dt * 2;
      c.mesh.rotation.y += dt * 1.5;
      c.mesh.rotation.x += dt * 0.7;
      c.mesh.position.y = c.baseY + Math.sin(c.phase) * 0.1;

      // Distance to player
      const dx = playerPos.x - c.mesh.position.x;
      const dz = playerPos.z - c.mesh.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Magnet attraction
      const { magnetRadius, magnetSpeed } = useGameStore.getState().playerParams;
      if (dist < magnetRadius && dist > this.pickupRadius) {
        const speed = (1 - dist / magnetRadius) * magnetSpeed * dt;
        c.mesh.position.x += (dx / dist) * speed;
        c.mesh.position.z += (dz / dist) * speed;
      }

      // Pickup
      if (dist < this.pickupRadius) {
        c.collected = true;
        c.mesh.visible = false;
        c.respawnTimer = 3 + Math.random() * 4;
        collected++;
        this.totalCollected++;
      }
    }

    return collected;
  }

  getTotalCollected(): number {
    return this.totalCollected;
  }

  dispose(): void {
    for (const c of this.collectibles) {
      c.entity.destroy();
      this.scene.remove(c.mesh);
      (c.mesh.material as THREE.Material).dispose();
    }
    this.geometry.dispose();
  }
}
