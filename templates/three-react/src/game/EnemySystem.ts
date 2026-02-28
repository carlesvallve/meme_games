import * as THREE from 'three';
import type { Terrain } from './Terrain';
import type { NavGrid } from './NavGrid';
import type { LootSystem } from './Loot';
import type { LadderDef } from './Ladder';
import { Character } from './character';
import { Enemy } from './character';
import { audioSystem } from '../utils/AudioSystem';
import { isRangedHeroId, VOX_ENEMIES } from './character';
import type { GoreSystem } from './GoreSystem';
import { useGameStore } from '../store';
import type { SavedEnemy } from './LevelState';

// ── Character collision constants ────────────────────────────────────

const CHAR_COLLISION_RADIUS = 0.3;
const CHAR_PUSH_STRENGTH = 10; // push-apart speed multiplier

// ── Attack arc helper ────────────────────────────────────────────────

/** Max vertical gap (in units) that a melee swing can bridge */
const MELEE_Y_TOLERANCE = 1.0;

function isInAttackArc(
  attackerX: number, attackerY: number, attackerZ: number, attackerFacing: number,
  targetX: number, targetY: number, targetZ: number,
  reach: number, halfAngle: number,
): boolean {
  const dx = targetX - attackerX;
  const dy = targetY - attackerY;
  const dz = targetZ - attackerZ;

  // Reject targets too far above/below (e.g. different floors)
  if (Math.abs(dy) > MELEE_Y_TOLERANCE) return false;

  // Use 2D (XZ) distance for reach — slope height shouldn't affect melee range
  const dist2D = Math.sqrt(dx * dx + dz * dz);
  if (dist2D > reach) return false;
  if (dist2D < 0.001) return true;

  const fwdX = -Math.sin(attackerFacing);
  const fwdZ = -Math.cos(attackerFacing);
  const dot = fwdX * (dx / dist2D) + fwdZ * (dz / dist2D);
  return dot >= Math.cos(halfAngle);
}

// ── Slash arc visual ─────────────────────────────────────────────────

interface SlashArc {
  mesh: THREE.Mesh;
  parent: THREE.Object3D;
  age: number;
  lifetime: number;
  totalIndices: number;  // total index count for full arc
  segments: number;
}

function createSlashArc(parent: THREE.Object3D): SlashArc {
  // Arc geometry in XZ plane. Forward = -Z (facing=0).
  // The sweep animates from right-to-left by revealing segments via drawRange.

  const arcAngle = Math.PI * 0.7; // ~126 degrees
  const innerR = 0.1;
  const outerR = 0.5;
  const segments = 14;
  const vertCount = (segments + 1) * 2;
  const positions = new Float32Array(vertCount * 3);

  // Outer ring vertices, then inner ring vertices
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

  // Quad strip: 2 triangles per segment, 6 indices per segment
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
  // Start with nothing visible — sweep reveals it
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

interface DamageNumber {
  sprite: THREE.Sprite;
  age: number;
  lifetime: number;
  startY: number;
}

function createDamageNumber(scene: THREE.Scene, x: number, y: number, z: number, amount: number): DamageNumber {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 24px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ff4444';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.strokeText(`${amount}`, 32, 16);
  ctx.fillText(`${amount}`, 32, 16);

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(x, y + 0.5, z);
  sprite.scale.set(0.4, 0.2, 1);
  scene.add(sprite);

  return { sprite, age: 0, lifetime: 1.0, startY: y + 0.5 };
}

// ── Hit spark particles ──────────────────────────────────────────────

interface HitSparks {
  points: THREE.Points;
  velocities: Float32Array;
  age: number;
  lifetime: number;
}

function createHitSparks(scene: THREE.Scene, x: number, y: number, z: number, dirX: number, dirZ: number): HitSparks {
  const count = 8;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = x;
    positions[i * 3 + 1] = y + 0.3;
    positions[i * 3 + 2] = z;

    // Spray mostly in hit direction with spread
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

// ── EnemySystem ──────────────────────────────────────────────────────

export interface HitImpactCallbacks {
  onHitstop: (duration: number) => void;
  onCameraShake: (intensity: number, duration: number, dirX: number, dirZ: number) => void;
}

export class EnemySystem {
  private enemies: Enemy[] = [];
  private damageNumbers: DamageNumber[] = [];
  private slashArcs: SlashArc[] = [];
  private hitSparks: HitSparks[] = [];

  private readonly scene: THREE.Scene;
  private readonly terrain: Terrain;
  private readonly navGrid: NavGrid;
  private readonly lootSystem: LootSystem;
  private readonly ladderDefs: ReadonlyArray<LadderDef>;
  private goreSystem: GoreSystem | null = null;

  // Player attack damage (read from store each frame)
  private get playerDamage(): number {
    return useGameStore.getState().enemyParams.playerDamage;
  }

  /** Optional list of allied characters (non-enemies) for collision */
  private allyCharacters: Character[] = [];

  /** Impact callbacks for hitstop + camera shake */
  impactCallbacks: HitImpactCallbacks | null = null;

  /** Per-enemy chase memory: how long to keep chasing after losing visibility */
  private chaseMemory = new Map<Enemy, number>();
  private static readonly CHASE_MEMORY_DURATION = 4.0; // seconds

  /** Wave spawning: periodically spawn new enemies up to a cap */
  private spawnTimer = 0;
  private spawnInterval = 0; // 0 = disabled
  private maxEnemies = 0;

  constructor(
    scene: THREE.Scene,
    terrain: Terrain,
    navGrid: NavGrid,
    lootSystem: LootSystem,
    ladderDefs: ReadonlyArray<LadderDef>,
  ) {
    this.scene = scene;
    this.terrain = terrain;
    this.navGrid = navGrid;
    this.lootSystem = lootSystem;
    this.ladderDefs = ladderDefs;
  }

  /** Register ally characters so they participate in collision */
  setAllyCharacters(chars: Character[]): void {
    this.allyCharacters = chars;
  }

  /** Set the gore system for visceral death effects */
  setGoreSystem(gore: GoreSystem): void {
    this.goreSystem = gore;
  }

  spawnEnemies(count: number): void {
    for (let i = 0; i < count; i++) {
      this.spawnOneEnemy();
    }
  }

  /** Configure wave spawning: enemies trickle in over time up to maxEnemies */
  enableWaveSpawning(maxEnemies: number, interval = 12): void {
    this.maxEnemies = maxEnemies;
    this.spawnInterval = interval;
    this.spawnTimer = interval * 0.5; // first wave arrives sooner
  }

  private static readonly MIN_ENTRANCE_DIST_SQ = 5 * 5; // min distance from entrance

  private spawnOneEnemy(): void {
    const roomVis = this.terrain.getRoomVisibility();
    const entrance = this.terrain.getEntrancePosition();
    const ex = entrance?.x ?? 0, ez = entrance?.z ?? 0;
    const hasEntrance = entrance !== null;

    // Try to spawn away from player's active area and away from entrance
    for (let attempt = 0; attempt < 15; attempt++) {
      const pos = this.terrain.getRandomPosition(5);
      if (roomVis && roomVis.isPositionActive(pos.x, pos.z)) continue;
      if (hasEntrance) {
        const dx = pos.x - ex, dz = pos.z - ez;
        if (dx * dx + dz * dz < EnemySystem.MIN_ENTRANCE_DIST_SQ) continue;
      }
      const enemy = new Enemy(this.scene, this.terrain, this.navGrid, pos, this.ladderDefs);
      enemy.initChaseBehavior(this.navGrid, this.ladderDefs);
      if (roomVis) enemy.mesh.visible = false; // hidden until room visibility processes it
      this.enemies.push(enemy);
      return;
    }
    // Fallback: spawn anywhere (but still respect entrance distance if possible)
    const pos = this.terrain.getRandomPosition(5);
    const enemy = new Enemy(this.scene, this.terrain, this.navGrid, pos, this.ladderDefs);
    enemy.initChaseBehavior(this.navGrid, this.ladderDefs);
    if (roomVis) enemy.mesh.visible = false;
    this.enemies.push(enemy);
  }

  update(
    dt: number,
    playerChar: Character,
    onPlayerHit: (damage: number) => void,
    onEnemyDied: () => void,
    showSlashEffect = true,
  ): void {
    // ── Wave spawning: trickle in new enemies up to cap ──
    if (this.spawnInterval > 0 && this.enemies.length < this.maxEnemies) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = this.spawnInterval * (0.7 + Math.random() * 0.6);
        const count = Math.random() < 0.2 ? 2 : 1; // 20% chance to spawn two
        for (let i = 0; i < count && this.enemies.length < this.maxEnemies; i++) {
          this.spawnOneEnemy();
        }
      }
    }

    const hitThisFrame = new Set<Enemy>();

    // ── Player attack arc check (melee only — ranged heroes use ProjectileSystem) ──
    const heroId = playerChar.voxEntry?.id ?? '';
    const playerIsRanged = isRangedHeroId(heroId);

    if (!playerIsRanged && playerChar.isAttacking && playerChar.isAlive) {
      const px = playerChar.mesh.position.x;
      const pz = playerChar.mesh.position.z;

      // Slash swoosh SFX + visual arc (once per attack, on first frame — wind-up pose)
      if (playerChar.attackJustStarted) {
        playerChar.attackJustStarted = false;
        audioSystem.sfx('slash');
        if (showSlashEffect) this.slashArcs.push(createSlashArc(playerChar.mesh));
      }

      // Melee hit only during climax (second half of attack), one hit per attack
      if (playerChar.canApplyAttackHit()) {
        for (const enemy of this.enemies) {
          if (!enemy.isAlive || hitThisFrame.has(enemy)) continue;
          if (isInAttackArc(px, playerChar.groundY, pz, playerChar.facing, enemy.mesh.position.x, enemy.groundY, enemy.mesh.position.z, playerChar.params.attackReach, playerChar.params.attackArcHalf)) {
            const hit = enemy.takeDamage(this.playerDamage, px, pz, playerChar.params.melee.knockback);
            if (hit) {
              playerChar.markAttackHitApplied();
              hitThisFrame.add(enemy);
              const ex = enemy.mesh.position.x;
              const ey = enemy.mesh.position.y;
              const ez = enemy.mesh.position.z;
              this.damageNumbers.push(createDamageNumber(this.scene, ex, ey + 0.3, ez, this.playerDamage));
              audioSystem.sfxAt('fleshHit', ex, ez);

              const hdx = ex - px, hdz = ez - pz;
              const hdist = Math.sqrt(hdx * hdx + hdz * hdz) || 1;
              const hitDirX = hdx / hdist, hitDirZ = hdz / hdist;

              this.hitSparks.push(createHitSparks(this.scene, ex, ey, ez, hitDirX, hitDirZ));

              if (this.goreSystem) {
                const nearby = this.getAllCharacters(playerChar);
                this.goreSystem.spawnBloodSplash(ex, ey, ez, enemy.groundY, nearby);
              }

              if (this.impactCallbacks) {
                const isKill = !enemy.isAlive;
                this.impactCallbacks.onHitstop(isKill ? 0.1 : 0.06);
                this.impactCallbacks.onCameraShake(isKill ? 0.2 : 0.12, isKill ? 0.2 : 0.12, hitDirX, hitDirZ);
              }
            }
          }
        }
      }
    }

    // ── Update enemies ──
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];

      if (!enemy.isAlive) {
        const pos = enemy.mesh.position;
        if (this.goreSystem) {
          this.goreSystem.spawnGore(enemy.mesh, enemy.groundY, this.getAllCharacters(playerChar));
        }
        this.lootSystem.spawnLoot(pos.clone());
        audioSystem.sfxAt('death', pos.x, pos.z);
        this.chaseMemory.delete(enemy);
        enemy.dispose();
        this.enemies.splice(i, 1);
        onEnemyDied();
        continue;
      }

      // Visibility-based chase: only chase if both enemy and player are in the same active area
      const roomVis = this.terrain.getRoomVisibility();
      let shouldChase = true;
      if (roomVis) {
        const ex = enemy.mesh.position.x;
        const ez = enemy.mesh.position.z;
        const px = playerChar.mesh.position.x;
        const pz = playerChar.mesh.position.z;
        const enemyVisible = roomVis.isPositionActive(ex, ez);
        const playerVisible = roomVis.isPositionActive(px, pz);
        const bothInActiveArea = enemyVisible && playerVisible;

        if (bothInActiveArea) {
          // Both visible — chase and reset memory timer
          this.chaseMemory.set(enemy, EnemySystem.CHASE_MEMORY_DURATION);
        } else {
          // Not in same area — count down memory
          const remaining = (this.chaseMemory.get(enemy) ?? 0) - dt;
          if (remaining > 0) {
            this.chaseMemory.set(enemy, remaining);
          } else {
            this.chaseMemory.delete(enemy);
            shouldChase = false;
          }
        }
      }

      enemy.setChaseTarget(shouldChase ? playerChar : null);
      enemy.update(dt);

      // Enemy melee: start on wantsToAttack (wind-up), evaluate hit only at climax
      if (enemy.wantsToAttack() && enemy.stunTimer <= 0) {
        const started = enemy.startAttack();
        if (started) {
          audioSystem.sfxAt('slash', enemy.mesh.position.x, enemy.mesh.position.z);
          if (showSlashEffect) this.slashArcs.push(createSlashArc(enemy.mesh));
        }
      }
      if (enemy.isAttacking && enemy.canApplyAttackHit()) {
        const ex = enemy.mesh.position.x;
        const ez = enemy.mesh.position.z;
        if (isInAttackArc(ex, enemy.groundY, ez, enemy.facing, playerChar.mesh.position.x, playerChar.groundY, playerChar.mesh.position.z, enemy.params.attackReach, enemy.params.attackArcHalf)) {
          const hit = playerChar.takeDamage(enemy.params.attackDamage, ex, ez, enemy.params.melee.knockback);
          if (hit) {
            enemy.markAttackHitApplied();
            onPlayerHit(enemy.params.attackDamage);
            const px = playerChar.mesh.position.x;
            const py = playerChar.mesh.position.y;
            const pz = playerChar.mesh.position.z;
            audioSystem.sfxAt('fleshHit', px, pz);
            const hitDirX = px - ex;
            const hitDirZ = pz - ez;
            const hitDist = Math.sqrt(hitDirX * hitDirX + hitDirZ * hitDirZ) || 1;
            this.hitSparks.push(createHitSparks(this.scene, px, py, pz, hitDirX / hitDist, hitDirZ / hitDist));
            if (this.goreSystem) {
              this.goreSystem.spawnBloodSplash(px, py, pz, playerChar.groundY, this.getAllCharacters(playerChar));
            }
            if (this.impactCallbacks) {
              this.impactCallbacks.onHitstop(0.08);
              this.impactCallbacks.onCameraShake(0.18, 0.15, hitDirX / hitDist, hitDirZ / hitDist);
            }
          }
        }
      }
    }

    // ── Character-character collision ──
    this.resolveCharacterCollisions(dt, playerChar);

    // ── Update effects ──
    this.updateSlashArcs(dt);
    this.updateHitSparks(dt);
    this.updateDamageNumbers(dt);
  }

  /** Get all enemy positions for door interaction */
  getEnemyPositions(): THREE.Vector3[] {
    const positions: THREE.Vector3[] = [];
    for (const enemy of this.enemies) {
      if (enemy.isAlive) {
        positions.push(enemy.mesh.position);
      }
    }
    return positions;
  }

  // ── Collision resolution ──

  private resolveCharacterCollisions(dt: number, playerChar: Character): void {
    // Build list of all living characters
    const allChars: Character[] = [];
    if (playerChar.isAlive) allChars.push(playerChar);
    for (const ally of this.allyCharacters) {
      if (ally !== playerChar && ally.isAlive) allChars.push(ally);
    }
    for (const enemy of this.enemies) {
      if (enemy.isAlive) allChars.push(enemy);
    }

    const r = CHAR_COLLISION_RADIUS;
    const minDist = r * 2;
    const characterPushEnabled = useGameStore.getState().characterPushEnabled;

    // O(n^2) pair-wise push apart — fine for < 50 characters
    for (let i = 0; i < allChars.length; i++) {
      for (let j = i + 1; j < allChars.length; j++) {
        const a = allChars[i];
        const b = allChars[j];
        const dx = b.mesh.position.x - a.mesh.position.x;
        const dz = b.mesh.position.z - a.mesh.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < minDist && dist > 0.001) {
          const overlap = minDist - dist;
          const nx = dx / dist;
          const nz = dz / dist;
          const push = overlap * 0.5 * CHAR_PUSH_STRENGTH * dt;

          // Push both apart equally (clamped to half overlap for stability)
          const pushClamped = Math.min(push, overlap * 0.5);
          if (characterPushEnabled) {
            a.mesh.position.x -= nx * pushClamped;
            a.mesh.position.z -= nz * pushClamped;
            b.mesh.position.x += nx * pushClamped;
            b.mesh.position.z += nz * pushClamped;
          } else {
            // Only push the non-player so the player is never moved by other characters
            if (a === playerChar) {
              b.mesh.position.x += nx * pushClamped;
              b.mesh.position.z += nz * pushClamped;
            } else {
              a.mesh.position.x -= nx * pushClamped;
              a.mesh.position.z -= nz * pushClamped;
            }
          }
        }
      }
    }
  }

  // ── Effect updates ──

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

      // Sweep: reveal segments progressively (fast sweep in first 60% of lifetime)
      const sweepT = Math.min(t / 0.6, 1);
      // Ease-out for a snappy sweep
      const eased = 1 - (1 - sweepT) * (1 - sweepT);
      const revealedSegments = Math.ceil(eased * arc.segments);
      const indexCount = revealedSegments * 6; // 6 indices per segment
      arc.mesh.geometry.setDrawRange(0, Math.min(indexCount, arc.totalIndices));

      // Scale outward slightly as it sweeps
      const scale = 1 + t * 0.2;
      arc.mesh.scale.set(scale, scale, scale);

      // Fade: gradual from start, like a weapon trail dissipating
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
      dn.sprite.position.y = dn.startY + dn.age * 0.5;
      (dn.sprite.material as THREE.SpriteMaterial).opacity = 1 - (dn.age / dn.lifetime);
    }
  }

  /** Spawn a floating damage number at a world position (used by ProjectileSystem) */
  spawnDamageNumber(x: number, y: number, z: number, amount: number): void {
    this.damageNumbers.push(createDamageNumber(this.scene, x, y + 0.3, z, amount));
  }

  /** Spawn hit sparks at a world position (used by ProjectileSystem) */
  /** Called when something hits an enemy (melee or projectile); always shows hit sparks. */
  spawnHitSparks(x: number, y: number, z: number, dirX: number, dirZ: number): void {
    this.hitSparks.push(createHitSparks(this.scene, x, y, z, dirX, dirZ));
  }

  /** Spawn blood splash at a world position (used by ProjectileSystem) */
  spawnBloodSplash(x: number, y: number, z: number, groundY: number, playerChar?: Character): void {
    if (this.goreSystem) {
      const nearby = playerChar ? this.getAllCharacters(playerChar) : undefined;
      this.goreSystem.spawnBloodSplash(x, y, z, groundY, nearby);
    }
  }

  /** Collect all characters (player, allies, enemies) for blood splash staining */
  private getAllCharacters(playerChar: Character): Character[] {
    return [playerChar, ...this.allyCharacters, ...this.enemies];
  }

  getEnemies(): ReadonlyArray<Enemy> {
    return this.enemies;
  }

  /** Serialize all living enemies for level persistence */
  serialize(): SavedEnemy[] {
    return this.enemies
      .filter(e => e.isAlive)
      .map(e => ({
        type: e.voxEntry?.id ?? '',
        x: e.mesh.position.x,
        z: e.mesh.position.z,
        hp: e.hp,
        maxHp: e.maxHp,
        facing: e.getFacing(),
      }));
  }

  /** Spawn enemies from saved state instead of random placement */
  restoreEnemies(saved: SavedEnemy[]): void {
    for (const s of saved) {
      const y = this.terrain.getTerrainY(s.x, s.z);
      const pos = new THREE.Vector3(s.x, y, s.z);
      const enemy = new Enemy(this.scene, this.terrain, this.navGrid, pos, this.ladderDefs);
      enemy.initChaseBehavior(this.navGrid, this.ladderDefs);
      enemy.hp = s.hp;
      enemy.maxHp = s.maxHp;
      enemy.setFacing(s.facing);
      // Apply saved vox skin if possible
      if (s.type) {
        const entry = VOX_ENEMIES.find(e => e.id === s.type);
        if (entry) enemy.applyVoxSkin(entry);
      }
      this.enemies.push(enemy);
    }
  }

  dispose(): void {
    for (const enemy of this.enemies) enemy.dispose();
    this.enemies = [];
    this.chaseMemory.clear();

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
