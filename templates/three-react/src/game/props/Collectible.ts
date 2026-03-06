import * as THREE from 'three';
import type { Environment } from '../environment';
import { useGameStore } from '../../store';
import { Entity, Layer } from '../core/Entity';
import type { SavedCollectible } from '../dungeon';

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
  private readonly terrain: Environment;
  private readonly pickupRadius = 0.2;
  private readonly count: number;
  private readonly respawnEnabled: boolean;
  private totalCollected = 0;

  private readonly gemColors = [
    0x44ffaa, 0xff44aa, 0x44aaff, 0xffaa44, 0xaa44ff,
  ];
  private readonly geometry: THREE.BufferGeometry;

  private playerSpawn: { x: number; z: number } | null = null;

  constructor(
    scene: THREE.Scene,
    terrain: Environment,
    playerSpawn?: { x: number; z: number },
    count?: number,
  ) {
    this.scene = scene;
    this.terrain = terrain;
    this.playerSpawn = playerSpawn ?? null;
    this.count = count ?? 5;
    this.respawnEnabled = false;
    this.geometry = new THREE.OctahedronGeometry(0.06, 0);

    for (let i = 0; i < this.count; i++) {
      this.spawnCollectible();
    }
  }

  private spawnCollectible(): void {
    const { magnetRadius } = useGameStore.getState().characterParams;
    const pos = this.terrain.getRandomPosition(
      4,
      0.6,
      this.playerSpawn ?? undefined,
      magnetRadius,
    );
    const color =
      this.gemColors[Math.floor(Math.random() * this.gemColors.length)];

    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.8,
    });

    const mesh = new THREE.Mesh(this.geometry, mat);
    mesh.position.set(pos.x, pos.y + 0.18, pos.z);
    mesh.castShadow = true;
    this.scene.add(mesh);

    const entity = new Entity(mesh, { layer: Layer.Collectible, radius: 0.06 });

    this.collectibles.push({
      mesh,
      entity,
      baseY: pos.y + 0.18,
      phase: Math.random() * Math.PI * 2,
      collected: false,
      respawnTimer: 0,
    });
  }

  update(dt: number, playerPos: THREE.Vector3): number {
    let collected = 0;

    for (const c of this.collectibles) {
      if (c.collected) {
        if (this.respawnEnabled) {
          c.respawnTimer -= dt;
          if (c.respawnTimer <= 0) {
            // Respawn at new position
            const pos = this.terrain.getRandomPosition(4);
            c.mesh.position.set(pos.x, pos.y + 0.18, pos.z);
            c.baseY = pos.y + 0.18;
            c.collected = false;
            c.mesh.visible = true;
          }
        }
        continue;
      }

      // Spin and bob
      c.phase += dt * 2;
      c.mesh.rotation.y += dt * 1.5;
      c.mesh.rotation.x += dt * 0.7;
      c.mesh.position.y = c.baseY + Math.sin(c.phase) * 0.05;

      // Distance to player
      const dx = playerPos.x - c.mesh.position.x;
      const dz = playerPos.z - c.mesh.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Magnet attraction
      const { magnetRadius, magnetSpeed } =
        useGameStore.getState().characterParams;
      if (dist < magnetRadius && dist > this.pickupRadius) {
        const speed = (1 - dist / magnetRadius) * magnetSpeed * dt;
        c.mesh.position.x += (dx / dist) * speed;
        c.mesh.position.z += (dz / dist) * speed;
      }

      // Pickup
      if (dist < this.pickupRadius) {
        c.collected = true;
        c.mesh.visible = false;
        c.respawnTimer = 30 + Math.random() * 30;
        collected++;
        this.totalCollected++;
      }
    }

    return collected;
  }

  /** All active collectible meshes (for room visibility). */
  getMeshes(): THREE.Mesh[] {
    return this.collectibles.filter((c) => !c.collected).map((c) => c.mesh);
  }

  getTotalCollected(): number {
    return this.totalCollected;
  }

  /** Serialize collectible state for level persistence */
  serialize(): SavedCollectible[] {
    return this.collectibles.map((c) => ({
      x: c.mesh.position.x,
      z: c.mesh.position.z,
      collected: c.collected,
    }));
  }

  /** Restore collectible state from saved data */
  restoreState(saved: SavedCollectible[]): void {
    for (const s of saved) {
      if (!s.collected) continue;
      // Find closest matching collectible
      let bestDist = Infinity;
      let bestCol: CollectibleObj | null = null;
      for (const c of this.collectibles) {
        if (c.collected) continue;
        const dx = c.mesh.position.x - s.x;
        const dz = c.mesh.position.z - s.z;
        const dist = dx * dx + dz * dz;
        if (dist < bestDist) {
          bestDist = dist;
          bestCol = c;
        }
      }
      if (bestCol && bestDist < 1) {
        bestCol.collected = true;
        bestCol.mesh.visible = false;
        bestCol.respawnTimer = 999; // don't respawn on revisit
      }
    }
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
