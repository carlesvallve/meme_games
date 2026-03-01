import * as THREE from 'three';
import type { Terrain } from './Terrain';
import { useGameStore } from '../store';
import { Entity, Layer } from './Entity';
import { audioSystem } from '../utils/AudioSystem';
import type { SavedLoot } from './LevelState';
import { loadVoxModel, buildVoxMesh, tintGeometry } from '../utils/VoxModelLoader';
import { POTION_HUES, POTION_COLORS } from './PotionEffectSystem';
import type { PotionEffectSystem } from './PotionEffectSystem';

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
  /** Color index 0-7 for potions (maps to PotionEffectSystem) */
  colorIndex: number;
  /** Sparkle sprites attached when potion is grounded */
  sparkles?: THREE.Mesh[];
  sparklePhase?: number;
  /** Floating label sprite */
  label?: THREE.Sprite;
}

const GRAVITY = 20;
const DRAG = 3.5;       // air drag — kills velocity fast for a punchy burst
const BOUNCE_Y = -0.35;
const BOUNCE_XZ = 0.6;
const SETTLE_THRESHOLD = 0.5;

/** Create a floating label sprite for a potion */
function createPotionLabel(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Dark background pill
  const metrics = ctx.measureText(text);
  const pw = Math.min(metrics.width + 12, 120);
  const px = (128 - pw) / 2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.roundRect(px, 2, pw, 28, 6);
  ctx.fill();
  // Text
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 17);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.3, 0.075, 1);
  sprite.position.set(0, 0.18, 0);
  sprite.renderOrder = 2;
  sprite.raycast = () => {}; // exclude from raycaster
  return sprite;
}

/** Update label text and color on an existing sprite */
function updatePotionLabel(sprite: THREE.Sprite, text: string, color: string): void {
  const mat = sprite.material as THREE.SpriteMaterial;
  const oldTex = mat.map;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const metrics = ctx.measureText(text);
  const pw = Math.min(metrics.width + 12, 120);
  const px = (128 - pw) / 2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.roundRect(px, 2, pw, 28, 6);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 17);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  mat.map = texture;
  mat.needsUpdate = true;
  if (oldTex) oldTex.dispose();
}

export class LootSystem {
  private items: LootItem[] = [];
  private readonly scene: THREE.Scene;
  private readonly terrain: Terrain;
  private readonly pickupRadius = 0.2;

  private readonly coinGeo: THREE.BufferGeometry;
  private readonly coinMat: THREE.MeshStandardMaterial;
  /** Shared material for all tinted potions (vertex colors carry the tint). */
  private readonly potionMat: THREE.MeshStandardMaterial;
  private readonly potionMatFallback: THREE.MeshStandardMaterial;
  /** Base geometries: potion shape (colorIndex 0-3) and bottle shape (4-7) */
  private potionBaseGeo: THREE.BufferGeometry | null = null;
  private bottleBaseGeo: THREE.BufferGeometry | null = null;
  /** Pre-tinted geometries per colorIndex (0-7). Built once base geos load. */
  private tintedGeos: (THREE.BufferGeometry | null)[] = new Array(8).fill(null);
  private potionGeoFallback: THREE.BufferGeometry;
  private potionGeosReady = false;
  /** Sparkle sprite shared geometry */
  private sparkleGeo: THREE.PlaneGeometry;

  /** Reference to the potion effect system (set after construction) */
  private potionSystem: PotionEffectSystem | null = null;

  constructor(scene: THREE.Scene, terrain: Terrain) {
    this.scene = scene;
    this.terrain = terrain;

    this.coinGeo = new THREE.OctahedronGeometry(0.05, 0);
    this.potionGeoFallback = new THREE.SphereGeometry(0.05, 6, 4);

    this.coinMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      emissive: 0xffd700,
      emissiveIntensity: 0.4,
      roughness: 0.3,
      metalness: 0.8,
    });

    this.potionMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.4,
      metalness: 0.1,
    });

    this.potionMatFallback = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.4,
      metalness: 0.1,
      emissive: 0x222222,
      emissiveIntensity: 0.3,
    });

    this.sparkleGeo = new THREE.PlaneGeometry(0.025, 0.025);

    this.loadPotionModels();
  }

  /** Set the potion effect system reference and register label update callback */
  setPotionSystem(system: PotionEffectSystem): void {
    this.potionSystem = system;
    system.onLabelUpdate((colorIndex, label, positive) => {
      this.updateLabelsForColor(colorIndex, label, positive);
    });
  }

  private async loadPotionModels(): Promise<void> {
    const P = '/models/Square%20Dungeon%20Asset%20Pack/Props';
    const potionPath = `${P}/Potion/Potion%20A%20(Red)/VOX/potion_a.vox`;
    const bottlePath = `${P}/Bottle/Bottle%20A%20(Red)/VOX/bottle_a.vox`;
    const POTION_LOOT_HEIGHT = 0.12;
    try {
      const [potionResult, bottleResult] = await Promise.all([
        loadVoxModel(potionPath),
        loadVoxModel(bottlePath),
      ]);
      this.potionBaseGeo = buildVoxMesh(potionResult.model, potionResult.palette, POTION_LOOT_HEIGHT);
      this.bottleBaseGeo = buildVoxMesh(bottleResult.model, bottleResult.palette, POTION_LOOT_HEIGHT);

      // Build 8 tinted variants: 0-3 = potion shape, 4-7 = bottle shape
      for (let i = 0; i < 8; i++) {
        const baseGeo = i < 4 ? this.potionBaseGeo : this.bottleBaseGeo;
        this.tintedGeos[i] = tintGeometry(baseGeo, POTION_HUES[i], 1.2);
      }
      this.potionGeosReady = true;
    } catch (e) {
      console.warn('[Loot] Failed to load potion vox models, using fallback spheres', e);
    }
  }

  /** Get the tinted geometry for a given colorIndex */
  private getPotionGeo(colorIndex: number): THREE.BufferGeometry {
    if (this.potionGeosReady && this.tintedGeos[colorIndex]) {
      return this.tintedGeos[colorIndex]!;
    }
    return this.potionGeoFallback;
  }

  spawnLoot(position: THREE.Vector3): void {
    const count = 2 + Math.floor(Math.random() * 3); // 2-4 items

    for (let i = 0; i < count; i++) {
      const isCoin = Math.random() < 0.7;
      const type: 'coin' | 'potion' = isCoin ? 'coin' : 'potion';

      const colorIndex = Math.floor(Math.random() * 8);
      const geo = isCoin ? this.coinGeo : this.getPotionGeo(colorIndex);
      const mat = isCoin ? this.coinMat : (this.potionGeosReady ? this.potionMat : this.potionMatFallback);

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(position);
      mesh.position.y += 0.15; // start above chest
      mesh.castShadow = true;
      mesh.visible = false; // hidden until delay expires
      this.scene.add(mesh);

      const entity = new Entity(mesh, { layer: Layer.Collectible, radius: 0.04 });

      // Random ejection angle
      const angle = Math.random() * Math.PI * 2;
      const hSpeed = 1.8 + Math.random() * 1.4;
      const vel = new THREE.Vector3(
        Math.cos(angle) * hSpeed,
        3.0 + Math.random() * 1.5,
        Math.sin(angle) * hSpeed,
      );

      const item: LootItem = {
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
        colorIndex,
      };

      // Add floating label for potions
      if (!isCoin) {
        this.addPotionLabel(item);
      }

      this.items.push(item);
    }
  }

  /** Add a floating label to a potion item */
  private addPotionLabel(item: LootItem): void {
    const ps = this.potionSystem;
    const identified = ps ? ps.isIdentified(item.colorIndex) : false;
    const text = identified ? (ps?.getLabel(item.colorIndex) ?? '???') : '???';
    const positive = ps ? ps.isPositive(item.colorIndex) : true;
    const color = identified ? (positive ? '#44ff66' : '#ff4444') : '#ffffff';
    const label = createPotionLabel(text, color);
    item.mesh.add(label);
    item.label = label;
  }

  /** Update all labels of a given colorIndex when it becomes identified */
  private updateLabelsForColor(colorIndex: number, labelText: string, positive: boolean): void {
    const color = positive ? '#44ff66' : '#ff4444';
    for (const item of this.items) {
      if (item.collected || item.type !== 'potion') continue;
      if (item.colorIndex === colorIndex && item.label) {
        updatePotionLabel(item.label, labelText, color);
      }
    }
  }

  update(dt: number, playerPos: THREE.Vector3): { coins: number; potions: number; potionColorIndices: number[] } {
    let coins = 0;
    let potions = 0;
    const potionColorIndices: number[] = [];
    const { magnetRadius, magnetSpeed } = useGameStore.getState().characterParams;

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
        const oldX = item.mesh.position.x;
        const oldZ = item.mesh.position.z;
        item.mesh.position.x += item.vel.x * dt;
        item.mesh.position.y += item.vel.y * dt;
        item.mesh.position.z += item.vel.z * dt;

        // Wall containment — reject movement into structural wall cells (ignores props)
        {
          const newX = item.mesh.position.x;
          const newZ = item.mesh.position.z;
          if (!this.terrain.isOpenCell(newX, newZ)) {
            // Try X-only and Z-only to allow sliding along walls
            const openX = this.terrain.isOpenCell(newX, oldZ);
            const openZ = this.terrain.isOpenCell(oldX, newZ);
            if (openX && !openZ) {
              item.mesh.position.z = oldZ;
              item.vel.z *= -0.3;
            } else if (openZ && !openX) {
              item.mesh.position.x = oldX;
              item.vel.x *= -0.3;
            } else {
              item.mesh.position.x = oldX;
              item.mesh.position.z = oldZ;
              item.vel.x *= -0.3;
              item.vel.z *= -0.3;
            }
          }
        }

        // Spin
        item.mesh.rotation.y += dt * 8;
        item.mesh.rotation.x += dt * 5;

        // Floor check — use getFloorY to skip prop debris (chests, barrels, etc.)
        const terrainY = this.terrain.getFloorY(item.mesh.position.x, item.mesh.position.z);
        const floorY = terrainY + 0.04; // mesh radius

        if (item.mesh.position.y <= floorY) {
          item.mesh.position.y = floorY;
          const impactSpeed = Math.abs(item.vel.y);

          if (impactSpeed < SETTLE_THRESHOLD && item.vel.length() < 1) {
            // Settle
            item.grounded = true;
            item.vel.set(0, 0, 0);
            // Spawn sparkle particles for potions
            if (item.type === 'potion' && !item.sparkles) {
              this.spawnSparkles(item);
            }
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
        // Smoothly upright potions that landed tilted/upside-down
        if (item.type === 'potion') {
          const lerpSpeed = 8 * dt;
          item.mesh.rotation.x += (0 - item.mesh.rotation.x) * lerpSpeed;
          item.mesh.rotation.z += (0 - item.mesh.rotation.z) * lerpSpeed;
          // Animate sparkles
          if (item.sparkles && item.sparklePhase !== undefined) {
            item.sparklePhase += dt * 3;
            for (let si = 0; si < item.sparkles.length; si++) {
              const sp = item.sparkles[si];
              const phase = item.sparklePhase + si * (Math.PI * 2 / item.sparkles.length);
              // Orbit around potion
              const radius = 0.06 + Math.sin(phase * 1.7) * 0.02;
              sp.position.set(
                Math.cos(phase) * radius,
                0.04 + Math.sin(phase * 2.3) * 0.03,
                Math.sin(phase) * radius,
              );
              // Pulse opacity
              const mat = sp.material as THREE.MeshBasicMaterial;
              mat.opacity = 0.4 + Math.sin(phase * 3) * 0.4;
              sp.scale.setScalar(0.6 + Math.sin(phase * 2) * 0.4);
            }
          }
        }
      }

      // Distance to player (XZ)
      const dx = playerPos.x - item.mesh.position.x;
      const dz = playerPos.z - item.mesh.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Magnet attraction after grace period (coins have wider pull)
      const effectiveRadius = item.type === 'coin' ? magnetRadius * 1.2 : magnetRadius;
      if (item.age > item.gracePeriod && dist < effectiveRadius && dist > this.pickupRadius) {
        // Stop physics, float toward player
        item.grounded = true;
        const speed = (1 - dist / effectiveRadius) * magnetSpeed * dt;
        item.mesh.position.x += (dx / dist) * speed;
        item.mesh.position.z += (dz / dist) * speed;
        // Float up slightly toward player height
        const dy = playerPos.y + 0.15 - item.mesh.position.y;
        item.mesh.position.y += dy * 4 * dt;
      }

      // Pickup
      if (dist < this.pickupRadius) {
        item.collected = true;
        item.mesh.visible = false;
        // Hide sparkles
        if (item.sparkles) {
          for (const sp of item.sparkles) sp.visible = false;
        }
        if (item.type === 'coin') {
          coins++;
        } else {
          potions++;
          potionColorIndices.push(item.colorIndex);
        }
      }
    }

    // Clean up collected items
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].collected && !this.items[i].mesh.visible) {
        const item = this.items[i];
        item.entity.destroy();
        // Remove sparkles from scene
        if (item.sparkles) {
          for (const sp of item.sparkles) {
            item.mesh.remove(sp);
          }
        }
        // Remove label
        if (item.label) {
          item.mesh.remove(item.label);
          (item.label.material as THREE.SpriteMaterial).map?.dispose();
          (item.label.material as THREE.SpriteMaterial).dispose();
        }
        this.scene.remove(item.mesh);
        this.items.splice(i, 1);
      }
    }

    return { coins, potions, potionColorIndices };
  }

  /** All active loot item meshes (for room visibility). */
  getMeshes(): THREE.Mesh[] {
    return this.items.filter(i => !i.collected).map(i => i.mesh);
  }

  /** Serialize grounded loot for level persistence (skip in-flight items) */
  serialize(): SavedLoot[] {
    return this.items
      .filter(i => !i.collected && i.grounded)
      .map(i => ({
        x: i.mesh.position.x,
        z: i.mesh.position.z,
        type: i.type,
        value: i.value,
        colorIndex: i.colorIndex,
      }));
  }

  /** Restore loot from saved state — place directly on ground */
  restoreLoot(saved: SavedLoot[]): void {
    for (const s of saved) {
      const isCoin = s.type === 'coin';
      const colorIndex = s.colorIndex ?? Math.floor(Math.random() * 8);
      const geo = isCoin ? this.coinGeo : this.getPotionGeo(colorIndex);
      const mat = isCoin ? this.coinMat : (this.potionGeosReady ? this.potionMat : this.potionMatFallback);

      const mesh = new THREE.Mesh(geo, mat);
      const terrainY = this.terrain.getFloorY(s.x, s.z);
      mesh.position.set(s.x, terrainY + 0.04, s.z);
      mesh.castShadow = true;
      this.scene.add(mesh);

      const entity = new Entity(mesh, { layer: Layer.Collectible, radius: 0.04 });

      const item: LootItem = {
        mesh,
        entity,
        vel: new THREE.Vector3(),
        grounded: true,
        bounceCount: 0,
        age: 10, // past grace period
        delay: 0,
        gracePeriod: 0,
        collected: false,
        type: s.type,
        value: s.value,
        colorIndex,
      };
      // Restored potions get sparkles + label immediately
      if (!isCoin) {
        this.spawnSparkles(item);
        this.addPotionLabel(item);
      }
      this.items.push(item);
    }
  }

  /** Spawn sparkle particles as children of the potion mesh, colored to match potion tint. */
  private spawnSparkles(item: LootItem): void {
    const count = 3;
    item.sparkles = [];
    item.sparklePhase = Math.random() * Math.PI * 2;
    const potionColor = POTION_COLORS[item.colorIndex] ?? new THREE.Color(0xffffff);
    for (let si = 0; si < count; si++) {
      const sparkleMat = new THREE.MeshBasicMaterial({
        color: potionColor,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const sp = new THREE.Mesh(this.sparkleGeo, sparkleMat);
      sp.renderOrder = 1;
      const angle = (si / count) * Math.PI * 2;
      sp.position.set(Math.cos(angle) * 0.06, 0.04, Math.sin(angle) * 0.06);
      item.mesh.add(sp);
      item.sparkles.push(sp);
    }
  }

  dispose(): void {
    for (const item of this.items) {
      item.entity.destroy();
      if (item.sparkles) {
        for (const sp of item.sparkles) item.mesh.remove(sp);
      }
      if (item.label) {
        item.mesh.remove(item.label);
        (item.label.material as THREE.SpriteMaterial).map?.dispose();
        (item.label.material as THREE.SpriteMaterial).dispose();
      }
      this.scene.remove(item.mesh);
    }
    this.items.length = 0;
    this.coinGeo.dispose();
    this.potionGeoFallback.dispose();
    if (this.potionBaseGeo) this.potionBaseGeo.dispose();
    if (this.bottleBaseGeo) this.bottleBaseGeo.dispose();
    for (const geo of this.tintedGeos) { if (geo) geo.dispose(); }
    this.coinMat.dispose();
    this.potionMat.dispose();
    this.potionMatFallback.dispose();
    this.sparkleGeo.dispose();
  }
}
