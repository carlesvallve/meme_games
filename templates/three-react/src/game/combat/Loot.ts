import * as THREE from 'three';
import type { Environment } from '../environment';
import { useGameStore } from '../../store';
import { Entity, Layer } from '../core/Entity';
import { audioSystem } from '../../utils/AudioSystem';
import type { SavedLoot } from '../dungeon';
import {
  loadVoxModel,
  buildVoxMesh,
  tintGeometry,
} from '../../utils/VoxModelLoader';
import { POTION_HUES, POTION_COLORS } from './PotionEffectSystem';
import type { PotionEffectSystem } from './PotionEffectSystem';

interface LootItem {
  mesh: THREE.Mesh;
  entity: Entity;
  vel: THREE.Vector3;
  grounded: boolean;
  bounceCount: number;
  age: number;
  delay: number; // stagger before ejection starts
  gracePeriod: number;
  collected: boolean;
  type: 'coin' | 'potion' | 'food' | 'gem';
  value: number;
  /** Color index 0-7 for potions (maps to PotionEffectSystem) */
  colorIndex: number;
  /** Hunger restored on food pickup */
  hungerValue: number;
  /** Sparkle sprites attached when potion is grounded */
  sparkles?: THREE.Mesh[];
  sparklePhase?: number;
  /** Floating label sprite */
  label?: THREE.Sprite;
  /** Potion magnet activated by Space press — allows pull toward player */
  magnetActivated?: boolean;
}

const GRAVITY = 20;
const DRAG = 3.5; // air drag — kills velocity fast for a punchy burst
const BOUNCE_Y = -0.35;
const BOUNCE_XZ = 0.6;
const SETTLE_THRESHOLD = 0.5;

/** Create a floating label sprite for a potion */
function createPotionLabel(text: string, color: string): THREE.Sprite {
  const isUnknown = text === '?';
  const canvas = document.createElement('canvas');
  canvas.width = isUnknown ? 96 : 192;
  canvas.height = isUnknown ? 96 : 48;
  const ctx = canvas.getContext('2d')!;

  if (isUnknown) {
    // Big centered "?" with circular background
    ctx.font = 'bold 52px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.beginPath();
    ctx.arc(48, 48, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText('?', 48, 51);
  } else {
    ctx.font = 'bold 26px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Dark background pill
    const metrics = ctx.measureText(text);
    const pw = Math.min(metrics.width + 18, 180);
    const px = (192 - pw) / 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.roundRect(px, 3, pw, 42, 10);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, 96, 26);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(mat);
  if (isUnknown) {
    sprite.scale.set(0.2, 0.2, 1);
    sprite.position.set(0, 0.2, 0);
  } else {
    sprite.scale.set(0.42, 0.105, 1);
    sprite.position.set(0, 0.2, 0);
  }
  sprite.renderOrder = 2;
  sprite.raycast = () => {}; // exclude from raycaster
  return sprite;
}

/** Update label text and color on an existing sprite */
function updatePotionLabel(
  sprite: THREE.Sprite,
  text: string,
  color: string,
): void {
  const mat = sprite.material as THREE.SpriteMaterial;
  const oldTex = mat.map;

  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 26px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const metrics = ctx.measureText(text);
  const pw = Math.min(metrics.width + 18, 180);
  const px = (192 - pw) / 2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.roundRect(px, 3, pw, 42, 10);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, 96, 26);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  mat.map = texture;
  mat.needsUpdate = true;
  // Switch from "?" scale to text scale when identified
  sprite.scale.set(0.42, 0.105, 1);
  if (oldTex) oldTex.dispose();
}

export class LootSystem {
  private items: LootItem[] = [];
  private readonly scene: THREE.Scene;
  private readonly terrain: Environment;
  private readonly pickupRadius = 0.2;

  private readonly coinGeo: THREE.BufferGeometry;
  private readonly coinMat: THREE.MeshStandardMaterial;
  /** Gem (octahedron) geometry + materials (random color per spawn) */
  private readonly gemGeo: THREE.BufferGeometry;
  private readonly gemColors = [0x44ffaa, 0xff44aa, 0x44aaff, 0xffaa44, 0xaa44ff];
  /** Food (meat chunk) geometry + material */
  private readonly foodGeo: THREE.BufferGeometry;
  private readonly foodMat: THREE.MeshStandardMaterial;
  /** Shared material for all tinted potions (vertex colors carry the tint). */
  private readonly potionMat: THREE.MeshStandardMaterial;
  private readonly potionMatFallback: THREE.MeshStandardMaterial;
  /** Base geometries: potion shape (colorIndex 0-4) and bottle shape (5-9) */
  private potionBaseGeo: THREE.BufferGeometry | null = null;
  private bottleBaseGeo: THREE.BufferGeometry | null = null;
  /** Pre-tinted geometries per colorIndex (0-9). Built once base geos load. */
  private tintedGeos: (THREE.BufferGeometry | null)[] = new Array(
    POTION_HUES.length,
  ).fill(null);
  private potionGeoFallback: THREE.BufferGeometry;
  private potionGeosReady = false;
  /** Sparkle sprite shared geometry */
  private sparkleGeo: THREE.PlaneGeometry;

  /** Reference to the potion effect system (set after construction) */
  private potionSystem: PotionEffectSystem | null = null;

  constructor(scene: THREE.Scene, terrain: Environment) {
    this.scene = scene;
    this.terrain = terrain;

    this.coinGeo = new THREE.OctahedronGeometry(0.05, 0);
    this.gemGeo = new THREE.OctahedronGeometry(0.06, 0);
    this.foodGeo = new THREE.SphereGeometry(0.06, 6, 4);
    this.foodMat = new THREE.MeshStandardMaterial({
      color: 0x8B4513,
      emissive: 0x5C2E0A,
      emissiveIntensity: 0.4,
      roughness: 0.6,
      metalness: 0.1,
    });
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
      this.potionBaseGeo = buildVoxMesh(
        potionResult.model,
        potionResult.palette,
        POTION_LOOT_HEIGHT,
      );
      this.bottleBaseGeo = buildVoxMesh(
        bottleResult.model,
        bottleResult.palette,
        POTION_LOOT_HEIGHT,
      );

      // Build tinted variants: first half = potion shape, second half = bottle shape
      const numColors = POTION_HUES.length;
      const halfColors = Math.floor(numColors / 2);
      for (let i = 0; i < numColors; i++) {
        const baseGeo =
          i < halfColors ? this.potionBaseGeo : this.bottleBaseGeo;
        this.tintedGeos[i] = tintGeometry(baseGeo, POTION_HUES[i], 1.2);
      }
      this.potionGeosReady = true;
    } catch (e) {
      console.warn(
        '[Loot] Failed to load potion vox models, using fallback spheres',
        e,
      );
    }
  }

  /** Get the tinted geometry for a given colorIndex */
  private getPotionGeo(colorIndex: number): THREE.BufferGeometry {
    if (this.potionGeosReady && this.tintedGeos[colorIndex]) {
      return this.tintedGeos[colorIndex]!;
    }
    return this.potionGeoFallback;
  }

  spawnLoot(position: THREE.Vector3, tier: 'common' | 'rare' | 'epic' = 'common'): void {
    // Tier-based loot parameters — all item types roll within the same pool
    const tierConfig = {
      common: { minCount: 2, maxCount: 3, maxPotions: 1, coinMin: 1, coinMax: 2,
                weights: { coin: 0.55, potion: 0.15, food: 0.20, gem: 0.10 } },
      rare:   { minCount: 3, maxCount: 4, maxPotions: 2, coinMin: 2, coinMax: 4,
                weights: { coin: 0.55, potion: 0.15, food: 0.20, gem: 0.10 } },
      epic:   { minCount: 4, maxCount: 5, maxPotions: 2, coinMin: 3, coinMax: 6,
                weights: { coin: 0.55, potion: 0.15, food: 0.20, gem: 0.10 } },
    };
    const cfg = tierConfig[tier];
    const count = cfg.minCount + Math.floor(Math.random() * (cfg.maxCount - cfg.minCount + 1));
    let potionsSpawned = 0;

    for (let i = 0; i < count; i++) {
      // Weighted roll for item type
      let type: LootItem['type'];
      const roll = Math.random();
      const { coin: wCoin, potion: wPotion, gem: wGem } = cfg.weights;
      if (roll < wCoin) {
        type = 'coin';
      } else if (roll < wCoin + wPotion && potionsSpawned < cfg.maxPotions) {
        type = 'potion';
        potionsSpawned++;
      } else if (roll < wCoin + wPotion + wGem) {
        type = 'gem';
      } else if (cfg.weights.food > 0) {
        type = 'food';
      } else {
        type = 'coin'; // fallback
      }

      this.spawnLootItem(position, type, i, cfg.coinMin, cfg.coinMax);
    }
  }

  /** Spawn a single loot item of the given type at position. */
  private spawnLootItem(
    position: THREE.Vector3,
    type: LootItem['type'],
    index: number,
    coinMin = 1,
    coinMax = 2,
  ): void {
    let geo: THREE.BufferGeometry;
    let mat: THREE.Material;
    const colorIndex = Math.floor(Math.random() * POTION_HUES.length);

    switch (type) {
      case 'coin':
        geo = this.coinGeo;
        mat = this.coinMat;
        break;
      case 'potion':
        geo = this.getPotionGeo(colorIndex);
        mat = this.potionGeosReady ? this.potionMat : this.potionMatFallback;
        break;
      case 'gem': {
        geo = this.gemGeo;
        const gemColor = this.gemColors[Math.floor(Math.random() * this.gemColors.length)];
        mat = new THREE.MeshStandardMaterial({
          color: gemColor, emissive: gemColor, emissiveIntensity: 0.5,
          roughness: 0.2, metalness: 0.8,
        });
        break;
      }
      case 'food':
        geo = this.foodGeo;
        mat = this.foodMat;
        break;
    }

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    mesh.position.y += 0.15;
    mesh.castShadow = true;
    mesh.visible = false;
    this.scene.add(mesh);

    const entity = new Entity(mesh, { layer: Layer.Collectible, radius: 0.04 });

    const angle = Math.random() * Math.PI * 2;
    const hSpeed = 1.8 + Math.random() * 1.4;
    const vel = new THREE.Vector3(
      Math.cos(angle) * hSpeed,
      3.0 + Math.random() * 1.5,
      Math.sin(angle) * hSpeed,
    );

    let value = 0;
    let hungerValue = 0;
    switch (type) {
      case 'coin': value = coinMin + Math.floor(Math.random() * (coinMax - coinMin + 1)); break;
      case 'potion': value = 3; break;
      case 'gem': value = 1; break;
      case 'food': hungerValue = 15; break;
    }

    const item: LootItem = {
      mesh, entity, vel,
      grounded: false,
      bounceCount: 0,
      age: 0,
      delay: index * 0.04 + Math.random() * 0.03,
      gracePeriod: 1.2 + Math.random() * 0.6,
      collected: false,
      type, value, colorIndex, hungerValue,
    };

    // Labels
    if (type === 'potion') this.addPotionLabel(item);
    else if (type === 'gem') { const l = createPotionLabel('GEM', '#44ffcc'); mesh.add(l); item.label = l; }
    else if (type === 'food') { const l = createPotionLabel('FOOD', '#ff8844'); mesh.add(l); item.label = l; }

    this.items.push(item);
  }

  /** Spawn a food item (meat chunk) at the given position. */
  spawnFood(position: THREE.Vector3, hungerValue = 15): void {
    const mesh = new THREE.Mesh(this.foodGeo, this.foodMat);
    mesh.position.copy(position);
    mesh.position.y += 0.15;
    mesh.castShadow = true;
    mesh.visible = false;
    this.scene.add(mesh);

    const entity = new Entity(mesh, { layer: Layer.Collectible, radius: 0.04 });

    const angle = Math.random() * Math.PI * 2;
    const hSpeed = 1.5 + Math.random() * 1.0;
    const vel = new THREE.Vector3(
      Math.cos(angle) * hSpeed,
      2.5 + Math.random() * 1.5,
      Math.sin(angle) * hSpeed,
    );

    const item: LootItem = {
      mesh,
      entity,
      vel,
      grounded: false,
      bounceCount: 0,
      age: 0,
      delay: Math.random() * 0.05,
      gracePeriod: 0.8 + Math.random() * 0.4,
      collected: false,
      type: 'food',
      value: 0,
      colorIndex: -1,
      hungerValue,
    };

    // Add floating label
    const label = createPotionLabel('FOOD', '#ff8844');
    mesh.add(label);
    item.label = label;

    this.items.push(item);
  }


  /** Add a floating label to a potion item */
  private addPotionLabel(item: LootItem): void {
    const ps = this.potionSystem;
    const identified = ps ? ps.isIdentified(item.colorIndex) : false;
    const text = identified ? (ps?.getLabel(item.colorIndex) ?? '?') : '?';
    const positive = ps ? ps.isPositive(item.colorIndex) : true;
    const color = identified ? (positive ? '#44ff66' : '#ff4444') : '#ffffff';
    const label = createPotionLabel(text, color);
    item.mesh.add(label);
    item.label = label;
  }

  /** Update all labels of a given colorIndex when it becomes identified */
  private updateLabelsForColor(
    colorIndex: number,
    labelText: string,
    positive: boolean,
  ): void {
    const color = positive ? '#44ff66' : '#ff4444';
    for (const item of this.items) {
      if (item.collected || item.type !== 'potion') continue;
      if (item.colorIndex === colorIndex && item.label) {
        updatePotionLabel(item.label, labelText, color);
      }
    }
  }

  update(
    dt: number,
    playerPos: THREE.Vector3,
  ): {
    coins: number;
    gems: number;
    potions: number;
    potionColorIndices: number[];
    foodHunger: number;
  } {
    let coins = 0;
    let gems = 0;
    let potions = 0;
    let foodHunger = 0;
    const potionColorIndices: number[] = [];
    const { magnetRadius, magnetSpeed } =
      useGameStore.getState().characterParams;

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
        const terrainY = this.terrain.getFloorY(
          item.mesh.position.x,
          item.mesh.position.z,
        );
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
            audioSystem.sfx(
              'thud',
              Math.min(impactSpeed / 8, 1),
              item.bounceCount,
            );
          } else {
            // Bounce
            item.vel.y *= BOUNCE_Y;
            item.vel.x *= BOUNCE_XZ;
            item.vel.z *= BOUNCE_XZ;
            audioSystem.sfx(
              'thud',
              Math.min(impactSpeed / 8, 1),
              item.bounceCount,
            );
            item.bounceCount++;
          }
        }
      } else {
        // Slow spin when grounded
        item.mesh.rotation.y += dt * 2;
        // Smoothly upright potions/food that landed tilted/upside-down
        if (item.type === 'potion' || item.type === 'food') {
          const lerpSpeed = 8 * dt;
          item.mesh.rotation.x += (0 - item.mesh.rotation.x) * lerpSpeed;
          item.mesh.rotation.z += (0 - item.mesh.rotation.z) * lerpSpeed;
          // Animate sparkles
          if (item.sparkles && item.sparklePhase !== undefined) {
            item.sparklePhase += dt * 3;
            for (let si = 0; si < item.sparkles.length; si++) {
              const sp = item.sparkles[si];
              const phase =
                item.sparklePhase + si * ((Math.PI * 2) / item.sparkles.length);
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

      // Potions require Space to activate magnet; coins + food auto-pull
      const isPotion = item.type === 'potion';
      const canMagnet = isPotion ? !!item.magnetActivated : true;

      // Magnet attraction after grace period (coins auto-pull, potions only when activated)
      const effectiveRadius = isPotion
        ? canMagnet
          ? magnetRadius * 1.5
          : 0
        : magnetRadius * 1.2;
      if (
        canMagnet &&
        item.age > item.gracePeriod &&
        dist < effectiveRadius &&
        dist > this.pickupRadius
      ) {
        // Stop physics, float toward player
        item.grounded = true;
        const speed = (1 - dist / effectiveRadius) * magnetSpeed * dt;
        item.mesh.position.x += (dx / dist) * speed;
        item.mesh.position.z += (dz / dist) * speed;
        // Float up slightly toward player height
        const dy = playerPos.y + 0.15 - item.mesh.position.y;
        item.mesh.position.y += dy * 4 * dt;
      }

      // Auto-pickup: coins + food always, potions only after magnet activated by Space
      if ((!isPotion || item.magnetActivated) && dist < this.pickupRadius) {
        item.collected = true;
        item.mesh.visible = false;
        // Hide sparkles
        if (item.sparkles) {
          for (const sp of item.sparkles) sp.visible = false;
        }
        if (item.type === 'coin') {
          coins += item.value;
        } else if (item.type === 'gem') {
          gems += item.value;
        } else if (item.type === 'food') {
          foodHunger += item.hungerValue;
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

    return { coins, gems, potions, potionColorIndices, foodHunger };
  }

  /** Find nearest potion within radius of a position.
   *  @param badOnly — if true, only return identified bad potions (for kick). */
  getNearestPotion(
    x: number,
    z: number,
    radius: number,
    badOnly = false,
  ): LootItem | null {
    let best: LootItem | null = null;
    let bestDist = radius;
    for (const item of this.items) {
      if (item.collected || item.type !== 'potion') continue;
      if (!item.grounded) continue; // skip in-flight potions
      if (badOnly && !this.potionSystem?.isIdentifiedBad(item.colorIndex))
        continue;
      const dx = x - item.mesh.position.x;
      const dz = z - item.mesh.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < bestDist) {
        bestDist = dist;
        best = item;
      }
    }
    return best;
  }

  /** Activate magnet pull for nearby good/unidentified potions (called on Space press).
   *  Returns true if any potion was activated. */
  activatePotionMagnet(x: number, z: number, radius: number): boolean {
    let activated = false;
    for (const item of this.items) {
      if (item.collected || item.type !== 'potion' || item.magnetActivated)
        continue;
      if (!item.grounded) continue;
      // Don't magnet-pull identified bad potions — those get kicked
      if (this.potionSystem?.isIdentifiedBad(item.colorIndex)) continue;
      const dx = x - item.mesh.position.x;
      const dz = z - item.mesh.position.z;
      if (dx * dx + dz * dz < radius * radius) {
        item.magnetActivated = true;
        activated = true;
      }
    }
    return activated;
  }

  /** Kick a potion item — removes from loot, returns projectile data */
  kickPotion(
    item: LootItem,
    dirX: number,
    dirZ: number,
  ): {
    mesh: THREE.Mesh;
    colorIndex: number;
    vx: number;
    vy: number;
    vz: number;
  } | null {
    const idx = this.items.indexOf(item);
    if (idx < 0) return null;

    // Detach sparkles + label from mesh
    if (item.sparkles) {
      for (const sp of item.sparkles) item.mesh.remove(sp);
    }
    if (item.label) {
      item.mesh.remove(item.label);
      (item.label.material as THREE.SpriteMaterial).map?.dispose();
      (item.label.material as THREE.SpriteMaterial).dispose();
    }

    item.entity.destroy();
    this.items.splice(idx, 1);

    // Launch as projectile
    const speed = 5;
    return {
      mesh: item.mesh,
      colorIndex: item.colorIndex,
      vx: dirX * speed,
      vy: 3,
      vz: dirZ * speed,
    };
  }

  /** All active loot item meshes (for room visibility). */
  getMeshes(): THREE.Mesh[] {
    return this.items.filter((i) => !i.collected).map((i) => i.mesh);
  }

  /** Serialize grounded loot for level persistence (skip in-flight items) */
  serialize(): SavedLoot[] {
    return this.items
      .filter((i) => !i.collected && i.grounded)
      .map((i) => ({
        x: i.mesh.position.x,
        z: i.mesh.position.z,
        type: i.type,
        value: i.value,
        colorIndex: i.colorIndex,
        hungerValue: i.type === 'food' ? i.hungerValue : undefined,
      }));
  }

  /** Restore loot from saved state — place directly on ground */
  restoreLoot(saved: SavedLoot[]): void {
    for (const s of saved) {
      const isFood = s.type === 'food';
      const isCoin = s.type === 'coin';
      const isGem = s.type === 'gem';
      const colorIndex =
        s.colorIndex ?? Math.floor(Math.random() * POTION_HUES.length);

      let geo: THREE.BufferGeometry;
      let mat: THREE.Material;
      if (isGem) {
        geo = this.gemGeo;
        const gemColor = this.gemColors[Math.floor(Math.random() * this.gemColors.length)];
        mat = new THREE.MeshStandardMaterial({
          color: gemColor, emissive: gemColor, emissiveIntensity: 0.5,
          roughness: 0.2, metalness: 0.8,
        });
      } else if (isFood) {
        geo = this.foodGeo;
        mat = this.foodMat;
      } else if (isCoin) {
        geo = this.coinGeo;
        mat = this.coinMat;
      } else {
        geo = this.getPotionGeo(colorIndex);
        mat = this.potionGeosReady ? this.potionMat : this.potionMatFallback;
      }

      const mesh = new THREE.Mesh(geo, mat);
      const terrainY = this.terrain.getFloorY(s.x, s.z);
      mesh.position.set(s.x, terrainY + 0.04, s.z);
      mesh.castShadow = true;
      this.scene.add(mesh);

      const entity = new Entity(mesh, {
        layer: Layer.Collectible,
        radius: 0.04,
      });

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
        hungerValue: s.hungerValue ?? 0,
      };
      // Restored potions get sparkles + label immediately
      if (s.type === 'potion') {
        this.spawnSparkles(item);
        this.addPotionLabel(item);
      } else if (isGem) {
        const label = createPotionLabel('GEM', '#44ffcc');
        mesh.add(label);
        item.label = label;
      } else if (isFood) {
        const label = createPotionLabel('FOOD', '#ff8844');
        mesh.add(label);
        item.label = label;
      }
      this.items.push(item);
    }
  }

  /** Spawn sparkle particles as children of the potion mesh, colored to match potion tint. */
  private spawnSparkles(item: LootItem): void {
    const count = 3;
    item.sparkles = [];
    item.sparklePhase = Math.random() * Math.PI * 2;
    const potionColor =
      POTION_COLORS[item.colorIndex] ?? new THREE.Color(0xffffff);
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
    this.gemGeo.dispose();
    this.potionGeoFallback.dispose();
    if (this.potionBaseGeo) this.potionBaseGeo.dispose();
    if (this.bottleBaseGeo) this.bottleBaseGeo.dispose();
    for (const geo of this.tintedGeos) {
      if (geo) geo.dispose();
    }
    this.coinMat.dispose();
    this.potionMat.dispose();
    this.potionMatFallback.dispose();
    this.sparkleGeo.dispose();
  }
}
