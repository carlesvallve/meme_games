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
import type { PropDestructionSystem } from './PropDestructionSystem';
import { useGameStore } from '../store';
import type { SavedEnemy } from './LevelState';
import type { PotionEffectSystem } from './PotionEffectSystem';

// ── Character collision constants ────────────────────────────────────

// Character collision now uses actual entity radii from vox mesh bounds (see Character.applyVoxSkin)
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
  startX: number;
  startZ: number;
  dirX: number;
  dirZ: number;
  baseScaleX: number;
  baseScaleY: number;
}

function createDamageNumber(scene: THREE.Scene, x: number, y: number, z: number, amount: number, dirX = 0, dirZ = 0, isCrit = false): DamageNumber {
  const canvas = document.createElement('canvas');
  canvas.width = isCrit ? 128 : 64;
  canvas.height = isCrit ? 48 : 32;
  const ctx = canvas.getContext('2d')!;
  if (isCrit) {
    // Crit: larger, yellow-orange text with "CRIT" label
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
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(x, y + 0.5, z);
  const scaleX = isCrit ? 0.6 : 0.4;
  const scaleY = isCrit ? 0.3 : 0.2;
  sprite.scale.set(scaleX, scaleY, 1);
  sprite.renderOrder = 1002;
  scene.add(sprite);

  return { sprite, age: 0, lifetime: isCrit ? 2.0 : 1.6, startY: y + 0.5, startX: x, startZ: z, dirX, dirZ, baseScaleX: scaleX, baseScaleY: scaleY };
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
  private propDestructionSystem: PropDestructionSystem | null = null;

  // Player attack damage (read from store each frame)
  private get playerDamage(): number {
    return useGameStore.getState().enemyParams.playerDamage;
  }

  /** Optional list of allied characters (non-enemies) for collision */
  private allyCharacters: Character[] = [];

  /** Impact callbacks for hitstop + camera shake */
  impactCallbacks: HitImpactCallbacks | null = null;


  /** Enemies that have been hit — chase regardless of range, with countdown */
  private aggroTimers = new Map<Enemy, number>();
  private static readonly AGGRO_DURATION = 8.0; // seconds

  /** Wave spawning: periodically spawn new enemies up to a cap */
  private spawnTimer = 0;
  private spawnInterval = 0; // 0 = disabled
  private maxEnemies = 0;

  /** Staggered spawn queue: enemies spawn one-by-one with cooldowns */
  private pendingSpawns = 0;
  private staggerCooldown = 0;
  private static readonly STAGGER_MIN = 2.0; // min seconds between spawns
  private static readonly STAGGER_MAX = 5.0; // max seconds between spawns

  /** Level transition exclusion zones (stairs + ladders world positions) */
  private transitionExclusions: { x: number; z: number }[] = [];

  // ── Crit chain dash state ──
  private static readonly CRIT_CHANCE = 0.20; // 20% chance
  private static readonly CRIT_RANGE_SQ = 4 * 4; // max range to find chain targets
  private static readonly CRIT_CHAIN_MAX = 3; // max hits per chain
  private static readonly CRIT_DASH_SPEED = 16; // world units/s dash speed
  private static readonly CRIT_DASH_STOP_DIST = 0.4; // stop this far from enemy
  private critChain: { targets: Enemy[]; index: number; dashing: boolean } | null = null;

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

  /** Set the prop destruction system for melee hits on destroyable props */
  setPropDestructionSystem(pds: PropDestructionSystem): void {
    this.propDestructionSystem = pds;
  }

  private potionSystem: PotionEffectSystem | null = null;

  /** Set the potion effect system for shadow/frenzy overrides */
  setPotionSystem(ps: PotionEffectSystem): void {
    this.potionSystem = ps;
  }

  /** Queue enemies for staggered spawning (one-by-one with cooldowns) */
  spawnEnemies(count: number): void {
    this.pendingSpawns += count;
    // Spawn the very first enemy immediately so the level isn't empty
    if (this.enemies.length === 0 && this.pendingSpawns > 0) {
      this.spawnOneEnemy();
      this.pendingSpawns--;
      this.staggerCooldown = EnemySystem.STAGGER_MIN + Math.random() * (EnemySystem.STAGGER_MAX - EnemySystem.STAGGER_MIN);
    }
  }

  /** Configure wave spawning: enemies trickle in over time up to maxEnemies */
  enableWaveSpawning(maxEnemies: number, interval = 12): void {
    this.maxEnemies = maxEnemies;
    this.spawnInterval = interval;
    this.spawnTimer = interval * 0.5; // first wave arrives sooner
  }

  /** Set level transition exclusion zones (stairs + ladders) so enemies don't spawn near them */
  setTransitionExclusions(positions: { x: number; z: number }[]): void {
    this.transitionExclusions = positions;
  }

  private static readonly MIN_ENTRANCE_DIST_SQ = 5 * 5; // min distance from entrance
  private static readonly MIN_TRANSITION_DIST_SQ = 3 * 3; // min distance from stairs/ladders
  private playerExcludeX = 0;
  private playerExcludeZ = 0;
  private playerExcludeDistSq = 0;

  /** Set an exclusion zone around the player spawn so enemies don't appear within chase range */
  setPlayerExclusionZone(x: number, z: number, radius: number): void {
    this.playerExcludeX = x;
    this.playerExcludeZ = z;
    this.playerExcludeDistSq = radius * radius;
  }

  /** Check if a position is too close to any level transition (stairs/ladders) */
  private isNearTransition(x: number, z: number): boolean {
    for (const t of this.transitionExclusions) {
      const dx = x - t.x, dz = z - t.z;
      if (dx * dx + dz * dz < EnemySystem.MIN_TRANSITION_DIST_SQ) return true;
    }
    return false;
  }

  /** Count living enemies per visibility area */
  private countEnemiesPerArea(roomVis: import('./RoomVisibility').RoomVisibility): Map<number, number> {
    const counts = new Map<number, number>();
    for (const enemy of this.enemies) {
      if (!enemy.isAlive) continue;
      const rid = roomVis.getRoomAtWorld(enemy.mesh.position.x, enemy.mesh.position.z);
      if (rid !== -1) counts.set(rid, (counts.get(rid) ?? 0) + 1);
    }
    return counts;
  }

  /** Max enemies allowed in a visibility area based on its cell count and enemyDensity */
  private getAreaEnemyCap(roomVis: import('./RoomVisibility').RoomVisibility, areaId: number): number {
    const cellCount = roomVis.cellsPerArea.get(areaId) ?? 0;
    const density = useGameStore.getState().enemyParams.enemyDensity;
    // At least 1 enemy per area, cap proportional to cell count
    return Math.max(1, Math.round(cellCount * density));
  }

  private spawnOneEnemy(): void {
    const roomVis = this.terrain.getRoomVisibility();
    const entrance = this.terrain.getEntrancePosition();
    const ex = entrance?.x ?? 0, ez = entrance?.z ?? 0;
    const hasEntrance = entrance !== null;

    // Pre-compute enemy counts per area for density cap check
    const areaCounts = roomVis ? this.countEnemiesPerArea(roomVis) : null;

    // Try to spawn away from player's active area, entrance, and level transitions
    for (let attempt = 0; attempt < 20; attempt++) {
      const pos = this.terrain.getRandomPosition(5);
      if (roomVis && roomVis.isPositionActive(pos.x, pos.z)) continue;
      if (hasEntrance) {
        const dx = pos.x - ex, dz = pos.z - ez;
        if (dx * dx + dz * dz < EnemySystem.MIN_ENTRANCE_DIST_SQ) continue;
      }
      // Non-dungeon: keep enemies outside chase range of player spawn
      if (this.playerExcludeDistSq > 0) {
        const dx = pos.x - this.playerExcludeX, dz = pos.z - this.playerExcludeZ;
        if (dx * dx + dz * dz < this.playerExcludeDistSq) continue;
      }
      // Avoid spawning near stairs/ladders so player doesn't face enemies on level change
      if (this.isNearTransition(pos.x, pos.z)) continue;
      // Per-area density cap: don't overpopulate any single visibility area
      if (roomVis && areaCounts) {
        const rid = roomVis.getRoomAtWorld(pos.x, pos.z);
        if (rid !== -1) {
          const current = areaCounts.get(rid) ?? 0;
          const cap = this.getAreaEnemyCap(roomVis, rid);
          if (current >= cap) continue;
        }
      }
      const enemy = new Enemy(this.scene, this.terrain, this.navGrid, pos, this.ladderDefs);
      enemy.initChaseBehavior(this.navGrid, this.ladderDefs, !!roomVis);
      if (roomVis) enemy.mesh.visible = false; // hidden until room visibility processes it
      this.enemies.push(enemy);
      // Update area counts for subsequent spawns in same frame
      if (roomVis && areaCounts) {
        const rid = roomVis.getRoomAtWorld(pos.x, pos.z);
        if (rid !== -1) areaCounts.set(rid, (areaCounts.get(rid) ?? 0) + 1);
      }
      return;
    }
    // Fallback: spawn anywhere (skip if all areas are at capacity)
    const pos = this.terrain.getRandomPosition(5);
    if (roomVis) {
      const rid = roomVis.getRoomAtWorld(pos.x, pos.z);
      if (rid !== -1 && areaCounts) {
        const current = areaCounts.get(rid) ?? 0;
        const cap = this.getAreaEnemyCap(roomVis, rid);
        if (current >= cap) return; // all areas full, skip this spawn
      }
    }
    const enemy = new Enemy(this.scene, this.terrain, this.navGrid, pos, this.ladderDefs);
    enemy.initChaseBehavior(this.navGrid, this.ladderDefs, !!roomVis);
    if (roomVis) enemy.mesh.visible = false;
    this.enemies.push(enemy);
  }

  /** Check if crit chain is currently active */
  get isCritChainActive(): boolean { return this.critChain !== null; }

  /** Try to start a crit chain (called on melee attack start). Returns true if crit triggers. */
  tryCritChain(playerChar: Character): boolean {
    if (this.critChain) return false; // already in chain
    if (Math.random() >= EnemySystem.CRIT_CHANCE) return false;

    const px = playerChar.mesh.position.x;
    const pz = playerChar.mesh.position.z;

    // Find nearby visible alive enemies, sorted by distance
    const candidates: { enemy: Enemy; distSq: number }[] = [];
    for (const enemy of this.enemies) {
      if (!enemy.isAlive || !enemy.mesh.visible) continue;
      const dx = enemy.mesh.position.x - px, dz = enemy.mesh.position.z - pz;
      const distSq = dx * dx + dz * dz;
      if (distSq < EnemySystem.CRIT_RANGE_SQ) {
        candidates.push({ enemy, distSq });
      }
    }
    if (candidates.length === 0) return false;

    candidates.sort((a, b) => a.distSq - b.distSq);

    // Build target list: up to 3 hits, reuse closest if not enough enemies
    const targets: Enemy[] = [];
    for (let i = 0; i < EnemySystem.CRIT_CHAIN_MAX; i++) {
      targets.push(candidates[i % candidates.length].enemy);
    }

    this.critChain = { targets, index: 0, dashing: true };
    return true;
  }

  /** Update crit chain dash — moves player toward each target, applies hit, moves to next.
   *  Returns true while chain is active (caller should skip normal movement). */
  updateCritChain(dt: number, playerChar: Character, onEnemyDied: () => void, showSlashEffect: boolean): boolean {
    if (!this.critChain) return false;
    const chain = this.critChain;

    if (chain.index >= chain.targets.length) {
      this.critChain = null;
      return false;
    }

    const target = chain.targets[chain.index];
    const px = playerChar.mesh.position.x;
    const pz = playerChar.mesh.position.z;
    const tx = target.mesh.position.x;
    const tz = target.mesh.position.z;

    // If target died (from earlier chain hit), skip to next
    if (!target.isAlive) {
      chain.index++;
      chain.dashing = true;
      return true;
    }

    if (chain.dashing) {
      const dx = tx - px, dz = tz - pz;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist <= EnemySystem.CRIT_DASH_STOP_DIST) {
        // Arrived — apply hit
        chain.dashing = false;
      } else {
        // Dash toward target
        const step = EnemySystem.CRIT_DASH_SPEED * dt;
        const move = Math.min(step, dist - EnemySystem.CRIT_DASH_STOP_DIST * 0.5);
        const nx = dx / dist, nz = dz / dist;
        playerChar.mesh.position.x += nx * move;
        playerChar.mesh.position.z += nz * move;
        // Face target
        playerChar.facing = Math.atan2(-nx, -nz);
        playerChar.mesh.rotation.y = playerChar.facing;
        // Update ground Y
        playerChar.groundY = this.terrain.getTerrainY(playerChar.mesh.position.x, playerChar.mesh.position.z);
        playerChar.mesh.position.y = playerChar.groundY;
        return true;
      }
    }

    // Apply guaranteed crit hit
    const damage = this.playerDamage;
    const ex = target.mesh.position.x;
    const ey = target.mesh.position.y;
    const ez = target.mesh.position.z;
    const hdx = ex - playerChar.mesh.position.x;
    const hdz = ez - playerChar.mesh.position.z;
    const hdist = Math.sqrt(hdx * hdx + hdz * hdz) || 1;
    const hitDirX = hdx / hdist, hitDirZ = hdz / hdist;

    // Face target
    playerChar.facing = Math.atan2(-hitDirX, -hitDirZ);
    playerChar.mesh.rotation.y = playerChar.facing;

    // Play attack animation + slash
    playerChar.startAttack(false);
    audioSystem.sfx('slash');
    if (showSlashEffect) this.slashArcs.push(createSlashArc(playerChar.mesh));

    // Guaranteed hit (skip arc check)
    const hit = target.takeDamage(damage, playerChar.mesh.position.x, playerChar.mesh.position.z, playerChar.params.melee.knockback * 1.5);
    if (hit) {
      this.aggroTimers.set(target, EnemySystem.AGGRO_DURATION);
      this.damageNumbers.push(createDamageNumber(this.scene, ex, ey + 0.3, ez, damage, hitDirX, hitDirZ, true));
      audioSystem.sfxAt('fleshHit', ex, ez);
      this.hitSparks.push(createHitSparks(this.scene, ex, ey, ez, hitDirX, hitDirZ));
      if (this.goreSystem) {
        this.goreSystem.spawnBloodSplash(ex, ey, ez, target.groundY, this.getAllCharacters(playerChar));
      }
      if (this.impactCallbacks) {
        const isKill = !target.isAlive;
        this.impactCallbacks.onHitstop(isKill ? 0.12 : 0.08);
        this.impactCallbacks.onCameraShake(isKill ? 0.25 : 0.15, isKill ? 0.25 : 0.15, hitDirX, hitDirZ);
      }

      // Handle death
      if (!target.isAlive) {
        const pos = target.mesh.position;
        if (this.goreSystem) {
          this.goreSystem.spawnGore(target.mesh, target.groundY, this.getAllCharacters(playerChar), target.lastHitDirX, target.lastHitDirZ);
        }
        this.lootSystem.spawnLoot(pos.clone());
        audioSystem.sfxAt('death', pos.x, pos.z);
        this.aggroTimers.delete(target);
        target.dispose();
        const idx = this.enemies.indexOf(target);
        if (idx >= 0) this.enemies.splice(idx, 1);
        onEnemyDied();
      }
    }

    // Move to next target
    chain.index++;
    chain.dashing = true;
    return true;
  }

  update(
    dt: number,
    playerChar: Character,
    onPlayerHit: (damage: number) => void,
    onEnemyDied: () => void,
    showSlashEffect = true,
  ): void {
    // ── Staggered spawn queue: spawn pending enemies one-by-one with cooldowns ──
    if (this.pendingSpawns > 0) {
      this.staggerCooldown -= dt;
      if (this.staggerCooldown <= 0) {
        this.spawnOneEnemy();
        this.pendingSpawns--;
        this.staggerCooldown = EnemySystem.STAGGER_MIN + Math.random() * (EnemySystem.STAGGER_MAX - EnemySystem.STAGGER_MIN);
      }
    }

    // ── Wave spawning: trickle in new enemies up to cap ──
    if (this.spawnInterval > 0 && this.pendingSpawns === 0 && this.enemies.length < this.maxEnemies) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = this.spawnInterval * (0.7 + Math.random() * 0.6);
        this.spawnOneEnemy();
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
        let hitEnemy = false;
        for (const enemy of this.enemies) {
          if (!enemy.isAlive || !enemy.mesh.visible || hitThisFrame.has(enemy)) continue;
          if (isInAttackArc(px, playerChar.groundY, pz, playerChar.facing, enemy.mesh.position.x, enemy.groundY, enemy.mesh.position.z, playerChar.params.attackReach, playerChar.params.attackArcHalf)) {
            const hit = enemy.takeDamage(this.playerDamage, px, pz, playerChar.params.melee.knockback);
            if (hit) {
              hitEnemy = true;
              this.aggroTimers.set(enemy, EnemySystem.AGGRO_DURATION);
              playerChar.markAttackHitApplied();
              hitThisFrame.add(enemy);
              const ex = enemy.mesh.position.x;
              const ey = enemy.mesh.position.y;
              const ez = enemy.mesh.position.z;
              const hdx = ex - px, hdz = ez - pz;
              const hdist = Math.sqrt(hdx * hdx + hdz * hdz) || 1;
              const hitDirX = hdx / hdist, hitDirZ = hdz / hdist;
              this.damageNumbers.push(createDamageNumber(this.scene, ex, ey + 0.3, ez, this.playerDamage, hitDirX, hitDirZ));
              audioSystem.sfxAt('fleshHit', ex, ez);

              this.hitSparks.push(createHitSparks(this.scene, ex, ey, ez, hitDirX, hitDirZ));

              if (this.goreSystem) {
                const nearby = this.getAllCharacters(playerChar);
                this.goreSystem.spawnBloodSplash(ex, ey, ez, enemy.groundY, nearby);
              }

              if (this.impactCallbacks) {
                const isKill = !enemy.isAlive;
                this.impactCallbacks.onHitstop(isKill ? 0.1 : 0.06);
                this.impactCallbacks.onCameraShake(isKill ? 0.2 : 0.12, isKill ? 0.2 : 0.12, hitDirX, hitDirZ);
                // Shadow breaks on hit without kill
                if (!isKill && this.potionSystem?.isShadow) {
                  this.potionSystem.breakShadow();
                }
              }
            }
          }
        }

        // If no enemy was hit, check destroyable props
        if (!hitEnemy && playerChar.canApplyAttackHit() && this.propDestructionSystem) {
          const propHit = this.propDestructionSystem.checkMeleeHit(
            px, playerChar.groundY, pz,
            playerChar.facing, playerChar.params.attackReach, playerChar.params.attackArcHalf,
          );
          if (propHit) {
            playerChar.markAttackHitApplied();
            if (this.impactCallbacks) {
              this.impactCallbacks.onHitstop(0.04);
              this.impactCallbacks.onCameraShake(0.1, 0.1, 0, 0);
            }
            // Shadow breaks on prop destruction near enemies
            if (this.potionSystem?.isShadow) {
              for (const enemy of this.enemies) {
                if (!enemy.isAlive) continue;
                const edx = enemy.mesh.position.x - px;
                const edz = enemy.mesh.position.z - pz;
                if (edx * edx + edz * edz < 9) { // ~3 unit radius
                  this.potionSystem.breakShadow();
                  break;
                }
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
          this.goreSystem.spawnGore(enemy.mesh, enemy.groundY, this.getAllCharacters(playerChar), enemy.lastHitDirX, enemy.lastHitDirZ);
        }
        this.lootSystem.spawnLoot(pos.clone());
        audioSystem.sfxAt('death', pos.x, pos.z);
        this.aggroTimers.delete(enemy);
        enemy.dispose();
        this.enemies.splice(i, 1);
        onEnemyDied();
        continue;
      }

      // Determine whether this enemy should actively chase the player
      const roomVis = this.terrain.getRoomVisibility();

      const ex = enemy.mesh.position.x;
      const ez = enemy.mesh.position.z;
      const px = playerChar.mesh.position.x;
      const pz = playerChar.mesh.position.z;

      // In dungeons, skip ALL processing for enemies outside the active flood-fill area
      // UNLESS they are currently chasing (chase memory timer still running)
      const isChasing = enemy.isCurrentlyChasing();
      if (roomVis && !roomVis.isPositionActive(ex, ez) && !isChasing) {
        enemy.mesh.visible = false;
        continue;
      }
      if (roomVis && !enemy.mesh.visible) {
        enemy.mesh.visible = true;
      }

      let shouldChase = false;
      const dx = ex - px, dz = ez - pz;
      const distSq = dx * dx + dz * dz;

      if (this.potionSystem?.isShadow) {
        // Shadow: enemies don't initiate chase
        shouldChase = false;
      } else if (roomVis) {
        // Dungeon: chase if both in active area AND within leash distance (~6 world units)
        // This prevents enemies from chasing across large multi-room active areas
        const DUNGEON_LEASH_SQ = 6 * 6;
        shouldChase = roomVis.isPositionActive(px, pz) && distSq < DUNGEON_LEASH_SQ;
      } else {
        // Open maps: chase if within range
        const chaseRange = useGameStore.getState().enemyParams.chaseRange * 0.25;
        shouldChase = distSq < chaseRange * chaseRange;
      }

      // Frenzy: force-aggro enemies (dungeon: already in active area; open: distance-based)
      if (this.potionSystem?.isFrenzy) {
        if (roomVis) {
          shouldChase = true;
        } else {
          if (distSq < 64) shouldChase = true; // ~8 unit radius
        }
      }

      // Hit-aggro: enemies that were hit chase with a countdown
      const aggroTime = this.aggroTimers.get(enemy);
      if (aggroTime !== undefined) {
        shouldChase = true;
        // Clear aggro if timer expires or enemy reaches normal chase conditions
        const remaining = aggroTime - dt;
        let clearAggro = remaining <= 0;
        if (!clearAggro) {
          if (roomVis) {
            clearAggro = roomVis.isPositionActive(px, pz);
          } else {
            const chaseRange = useGameStore.getState().enemyParams.chaseRange * 0.25;
            clearAggro = distSq < chaseRange * chaseRange;
          }
        }
        if (clearAggro) {
          this.aggroTimers.delete(enemy);
        } else {
          this.aggroTimers.set(enemy, remaining);
        }
      }

      enemy.setChaseTarget(shouldChase ? playerChar : null, dt);
      enemy.update(dt);

      // Awareness fog: fade enemies based on distance on open maps
      if (!roomVis) {
        const dist = Math.sqrt(distSq);
        const chaseRange = useGameStore.getState().enemyParams.chaseRange * 0.25;
        const visRange = chaseRange * 1.5;
        // Fully visible within chase range, fade out between chase and vis range, invisible beyond
        const targetOpacity = dist <= chaseRange ? 1.0
          : dist >= visRange ? 0.0
          : 1.0 - (dist - chaseRange) / (visRange - chaseRange);
        const mat = enemy.mesh.material as THREE.MeshStandardMaterial;
        const current = mat.opacity ?? 1;
        const speed = 3.0;
        const newOpacity = current < targetOpacity
          ? Math.min(targetOpacity, current + speed * dt)
          : Math.max(targetOpacity, current - speed * dt);
        if (newOpacity < 0.99) {
          if (!mat.transparent) { mat.transparent = true; mat.needsUpdate = true; }
          mat.opacity = newOpacity;
          enemy.mesh.visible = newOpacity > 0.01;
        } else {
          if (mat.transparent) { mat.transparent = false; mat.needsUpdate = true; }
          mat.opacity = 1;
          enemy.mesh.visible = true;
        }
      }

      // Enemy melee: start on wantsToAttack (wind-up), evaluate hit only at climax
      if (enemy.mesh.visible && enemy.wantsToAttack() && enemy.stunTimer <= 0) {
        const started = enemy.startAttack();
        if (started) {
          audioSystem.sfxAt('slash', enemy.mesh.position.x, enemy.mesh.position.z);
          if (showSlashEffect) this.slashArcs.push(createSlashArc(enemy.mesh));
        }
      }
      if (enemy.mesh.visible && enemy.isAttacking && enemy.canApplyAttackHit()) {
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

    const characterPushEnabled = useGameStore.getState().characterPushEnabled;

    // O(n^2) pair-wise push apart — fine for < 50 characters
    for (let i = 0; i < allChars.length; i++) {
      for (let j = i + 1; j < allChars.length; j++) {
        const a = allChars[i];
        const b = allChars[j];
        const dx = b.mesh.position.x - a.mesh.position.x;
        const dz = b.mesh.position.z - a.mesh.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        // Use actual entity radii so small characters can get closer
        const minDist = a.entity.radius + b.entity.radius;
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
      const t = dn.age / dn.lifetime;

      // Phase 1 (0-0.15): pop scale — grow to 1.6x then shrink back
      // Phase 2 (0.15-1): drift up slowly + fade out in last 40%
      const popEnd = 0.15;
      let scale: number;
      if (t < popEnd) {
        const pt = t / popEnd;
        // Quick elastic-ish pop: sin curve peaks at 0.5
        scale = 1 + 0.6 * Math.sin(pt * Math.PI);
      } else {
        scale = 1;
      }
      dn.sprite.scale.set(dn.baseScaleX * scale, dn.baseScaleY * scale, 1);

      // Drift: hold still during pop, then drift up + along knockback direction
      const driftT = Math.max(0, t - popEnd) / (1 - popEnd);
      const ease = 1 - (1 - driftT) * (1 - driftT); // ease-out
      dn.sprite.position.y = dn.startY + driftT * 0.35;
      dn.sprite.position.x = dn.startX + dn.dirX * ease * 0.3;
      dn.sprite.position.z = dn.startZ + dn.dirZ * ease * 0.3;

      // Fade: fully visible until 60%, then fade to 0
      const fadeStart = 0.6;
      (dn.sprite.material as THREE.SpriteMaterial).opacity =
        t < fadeStart ? 1 : 1 - ((t - fadeStart) / (1 - fadeStart));
    }
  }

  /** Spawn a floating damage number at a world position (used by ProjectileSystem) */
  spawnDamageNumber(x: number, y: number, z: number, amount: number, dirX = 0, dirZ = 0): void {
    this.damageNumbers.push(createDamageNumber(this.scene, x, y + 0.3, z, amount, dirX, dirZ));
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

  /** Mark an enemy as aggro'd (e.g. hit by projectile) — will chase regardless of range */
  aggroEnemy(enemy: Enemy): void {
    this.aggroTimers.set(enemy, EnemySystem.AGGRO_DURATION);
  }

  getEnemies(): ReadonlyArray<Enemy> {
    return this.enemies;
  }

  /** Get only visible enemies (for combat, targeting, projectiles) */
  getVisibleEnemies(): ReadonlyArray<Enemy> {
    return this.enemies.filter(e => e.mesh.visible);
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
    const isDungeon = !!this.terrain.getRoomVisibility();
    for (const s of saved) {
      const y = this.terrain.getTerrainY(s.x, s.z);
      const pos = new THREE.Vector3(s.x, y, s.z);
      const enemy = new Enemy(this.scene, this.terrain, this.navGrid, pos, this.ladderDefs);
      enemy.initChaseBehavior(this.navGrid, this.ladderDefs, isDungeon);
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
    this.pendingSpawns = 0;
    this.staggerCooldown = 0;
    for (const enemy of this.enemies) enemy.dispose();
    this.enemies = [];

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
