import * as THREE from 'three';
import type { Environment } from '../environment';
import type { NavGrid } from '../pathfinding';
import type { LootSystem } from '../combat/Loot';
import type { LadderDef } from '../dungeon';
import { Character } from '../character';
import { Enemy } from '../character';
import { audioSystem } from '../../utils/AudioSystem';
import { isRangedHeroId, VOX_ENEMIES, getArchetype, getSlashStyle } from '../character';
import type { GoreSystem } from '../combat/GoreSystem';
import type { PropDestructionSystem } from '../combat/PropDestructionSystem';
import { useGameStore } from '../../store';
import type { SavedEnemy } from '../dungeon';
import type { PotionEffectSystem } from '../combat/PotionEffectSystem';

import { EnemyVFX } from './EnemyVFX';
import { EnemySpawner } from './EnemySpawner';
import { EnemyStatusEffects } from './EnemyStatusEffects';
import { EnemyCombat, isInAttackArc } from './EnemyCombat';
import type { HitImpactCallbacks } from './EnemyCombat';

export type { HitImpactCallbacks };

// ── Character collision constants ────────────────────────────────────

const CHAR_PUSH_STRENGTH = 10;
const AGGRO_DURATION = 8.0;

// ── EnemySystem ──────────────────────────────────────────────────────

export class EnemySystem {
  private enemies: Enemy[] = [];

  private readonly scene: THREE.Scene;
  private readonly terrain: Environment;
  private readonly navGrid: NavGrid;
  private readonly lootSystem: LootSystem;
  private readonly ladderDefs: ReadonlyArray<LadderDef>;
  private goreSystem: GoreSystem | null = null;
  private propDestructionSystem: PropDestructionSystem | null = null;
  private potionSystem: PotionEffectSystem | null = null;

  private allyCharacters: Character[] = [];
  impactCallbacks: HitImpactCallbacks | null = null;
  private aggroTimers = new Map<Enemy, number>();

  // ── Sub-modules ──
  readonly vfx: EnemyVFX;
  private readonly spawner: EnemySpawner;
  private readonly statusEffects: EnemyStatusEffects;
  private readonly combat: EnemyCombat;

  constructor(
    scene: THREE.Scene,
    terrain: Environment,
    navGrid: NavGrid,
    lootSystem: LootSystem,
    ladderDefs: ReadonlyArray<LadderDef>,
  ) {
    this.scene = scene;
    this.terrain = terrain;
    this.navGrid = navGrid;
    this.lootSystem = lootSystem;
    this.ladderDefs = ladderDefs;

    this.vfx = new EnemyVFX(scene);
    this.spawner = new EnemySpawner(
      scene,
      terrain,
      navGrid,
      ladderDefs,
      this.enemies,
    );
    this.statusEffects = new EnemyStatusEffects(
      {
        spawnStatusIcon: (e, name) => this.spawner.spawnStatusIcon(e, name),
        cleanupStatusIcon: (e, name) => this.spawner.cleanupStatusIcon(e, name),
      },
      this.vfx,
    );
    this.combat = new EnemyCombat(
      this.enemies,
      terrain,
      navGrid,
      this.vfx,
      lootSystem,
      this.aggroTimers,
      () => this.goreSystem,
      () => this.potionSystem,
      () => this.impactCallbacks,
      () => this.getAllCharacters(),
      (enemy) => this.cleanupEnemy(enemy),
    );
  }

  // ── Injection setters ──

  setAllyCharacters(chars: Character[]): void {
    this.allyCharacters = chars;
  }

  setGoreSystem(gore: GoreSystem): void {
    this.goreSystem = gore;
    this.vfx.setGoreSystem(gore);
  }

  setPropDestructionSystem(pds: PropDestructionSystem): void {
    this.propDestructionSystem = pds;
  }

  setPotionSystem(ps: PotionEffectSystem): void {
    this.potionSystem = ps;
  }

  // ── Forwarded spawn API ──

  spawnEnemies(count: number): void {
    this.spawner.spawnEnemies(count);
  }
  enableWaveSpawning(maxEnemies: number, interval = 12): void {
    this.spawner.enableWaveSpawning(maxEnemies, interval);
  }
  setTransitionExclusions(positions: { x: number; z: number }[]): void {
    this.spawner.setTransitionExclusions(positions);
  }
  setPlayerExclusionZone(x: number, z: number, radius: number): void {
    this.spawner.setPlayerExclusionZone(x, z, radius);
  }
  spawnEnemyAt(
    x: number,
    z: number,
    chaseTarget?: Character,
    isFrenzy?: boolean,
    entry?: import('../character').VoxCharEntry,
  ): Enemy {
    return this.spawner.spawnEnemyAt(x, z, chaseTarget, isFrenzy, entry);
  }
  triggerFrenzySpawn(
    playerChar: Character,
    doorCenters: { x: number; z: number }[],
    roomVis: import('../dungeon').RoomVisibility | null,
    count?: number,
  ): void {
    this.spawner.triggerFrenzySpawn(playerChar, doorCenters, roomVis, count);
  }
  spawnBossEnemies(
    archetype: string,
    count: number,
    nearX: number,
    nearZ: number,
  ): void {
    this.spawner.spawnBossEnemies(archetype, count, nearX, nearZ);
  }
  setTauntTarget(enemy: Enemy): void {
    this.spawner.setTauntTarget(enemy);
  }

  // ── Forwarded VFX API ──

  spawnDamageNumber(
    x: number,
    y: number,
    z: number,
    amount: number,
    dirX = 0,
    dirZ = 0,
    isCrit = false,
  ): void {
    this.vfx.spawnDamageNumber(x, y, z, amount, dirX, dirZ, isCrit);
  }
  spawnPickupLabel(
    x: number,
    y: number,
    z: number,
    text: string,
    color = '#ffffff',
    size: 'sm' | 'md' = 'sm',
  ): void {
    this.vfx.spawnPickupLabel(x, y, z, text, color, size);
  }
  spawnHitSparks(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
  ): void {
    this.vfx.spawnHitSparks(x, y, z, dirX, dirZ);
  }
  spawnBloodSplash(
    x: number,
    y: number,
    z: number,
    groundY: number,
    playerChar?: Character,
  ): void {
    this.vfx.spawnBloodSplash(
      x,
      y,
      z,
      groundY,
      playerChar ? this.getAllCharacters(playerChar) : undefined,
    );
  }
  spawnDeflectVFX(
    x: number,
    y: number,
    z: number,
    dirX: number,
    dirZ: number,
  ): void {
    this.vfx.spawnDeflectVFX(x, y, z, dirX, dirZ);
  }

  // ── Forwarded status effect API ──

  applyStatusEffect(enemy: Enemy, effectName: string, duration: number): void {
    this.statusEffects.applyStatusEffect(enemy, effectName, duration);
  }
  hasFragile(enemy: Enemy): boolean {
    return this.statusEffects.hasFragile(enemy);
  }
  hasConfusion(enemy: Enemy): boolean {
    return this.statusEffects.hasConfusion(enemy);
  }

  // ── Forwarded combat API ──

  get isCritChainActive(): boolean {
    return this.combat.isCritChainActive;
  }
  updateCritChain(
    dt: number,
    playerChar: Character,
    onEnemyDied: () => void,
    showSlashEffect: boolean,
  ): boolean {
    return this.combat.updateCritChain(
      dt,
      playerChar,
      onEnemyDied,
      showSlashEffect,
    );
  }

  // ── Player damage helper ──

  private getPlayerDamage(playerChar: Character): number {
    return Math.round(playerChar.params.attackDamage * playerChar.comboDamageMultiplier);
  }

  private get hitstopEnabled(): boolean {
    return useGameStore.getState().characterParams.melee.hitstopEnabled;
  }

  // ── Cleanup helper for enemy death (used by combat + update loop) ──

  private cleanupEnemy(enemy: Enemy): void {
    this.aggroTimers.delete(enemy);
    this.statusEffects.deleteEnemy(enemy);
    this.spawner.cleanupFrenzyEnemy(enemy);
    // Clean up all status icons for this enemy
    const enemyIcons = this.spawner.statusIcons.get(enemy);
    if (enemyIcons) {
      for (const [name] of enemyIcons) this.spawner.cleanupStatusIcon(enemy, name);
    }
  }

  // ── Main update loop ──

  update(
    dt: number,
    playerChar: Character,
    onPlayerHit: (damage: number) => void,
    onEnemyDied: () => void,
    showSlashEffect = true,
    camera?: THREE.Camera,
  ): void {
    // ── Spawn ticks ──
    this.spawner.tickSpawn(dt);

    const hitThisFrame = new Set<Enemy>();

    // ── Player attack arc check (melee only) ──
    const heroId = playerChar.voxEntry?.id ?? '';
    const playerIsRanged = isRangedHeroId(heroId);

    if (!playerIsRanged && playerChar.isAttacking && playerChar.isAlive) {
      const px = playerChar.mesh.position.x;
      const pz = playerChar.mesh.position.z;

      if (playerChar.attackJustStarted) {
        playerChar.attackJustStarted = false;
        audioSystem.sfx('slash');
        if (showSlashEffect) {
          const slashStyle = playerChar.voxEntry
            ? getSlashStyle(getArchetype(playerChar.voxEntry.name))
            : 'horizontal';
          this.vfx.pushSlashArc(playerChar.mesh, slashStyle);
        }
      }

      if (playerChar.canApplyAttackHit()) {
        let hitEnemy = false;
        for (const enemy of this.enemies) {
          if (!enemy.isAlive || !enemy.mesh.visible || hitThisFrame.has(enemy))
            continue;
          if (
            isInAttackArc(
              px,
              playerChar.groundY,
              pz,
              playerChar.facing,
              enemy.mesh.position.x,
              enemy.groundY,
              enemy.mesh.position.z,
              playerChar.params.attackReach,
              playerChar.params.attackArcHalf,
            )
          ) {
            const ex = enemy.mesh.position.x;
            const ey = enemy.mesh.position.y;
            const ez = enemy.mesh.position.z;
            const hdx = ex - px,
              hdz = ez - pz;
            const hdist = Math.sqrt(hdx * hdx + hdz * hdz) || 1;
            const hitDirX = hdx / hdist,
              hitDirZ = hdz / hdist;

            // Armour deflect check
            if (enemy.armour > 0 && Math.random() < enemy.armour) {
              hitEnemy = true;
              playerChar.markAttackHitApplied();
              hitThisFrame.add(enemy);
              this.aggroTimers.set(enemy, AGGRO_DURATION);
              audioSystem.sfxAt('clank', ex, ez);
              this.vfx.pushMetalSparks(ex, ey, ez, hitDirX, hitDirZ);
              this.vfx.pushFloatingLabel(
                ex,
                ey + 0.3,
                ez,
                'CLANK!',
                '#ccddff',
                'md',
              );
              playerChar.mesh.position.x -= hitDirX * 0.15;
              playerChar.mesh.position.z -= hitDirZ * 0.15;
              if (this.impactCallbacks) {
                if (this.hitstopEnabled) this.impactCallbacks.onHitstop(0.08);
                this.impactCallbacks.onCameraShake(
                  0.15,
                  0.12,
                  -hitDirX,
                  -hitDirZ,
                );
              }
            } else {
              const isCrit =
                !this.combat.isCritChainActive && this.combat.rollCrit();
              const baseDmg = this.getPlayerDamage(playerChar);
              const damage = isCrit ? baseDmg * 2 : baseDmg;
              const hit = enemy.takeDamage(
                damage,
                px,
                pz,
                playerChar.params.melee.knockback,
              );
              if (hit) {
                hitEnemy = true;
                this.aggroTimers.set(enemy, AGGRO_DURATION);
                playerChar.markAttackHitApplied();
                hitThisFrame.add(enemy);
                this.vfx.pushDamageNumber(
                  ex,
                  ey + 0.3,
                  ez,
                  damage,
                  hitDirX,
                  hitDirZ,
                  isCrit,
                );
                audioSystem.sfxAt('fleshHit', ex, ez);
                this.vfx.pushHitSparks(ex, ey, ez, hitDirX, hitDirZ);

                if (this.goreSystem) {
                  this.goreSystem.spawnBloodSplash(
                    ex,
                    ey,
                    ez,
                    enemy.groundY,
                    this.getAllCharacters(playerChar),
                  );
                }

                if (this.impactCallbacks) {
                  const isKill = !enemy.isAlive;
                  if (this.hitstopEnabled) this.impactCallbacks.onHitstop(isKill ? 0.1 : 0.06);
                  this.impactCallbacks.onCameraShake(
                    isKill ? 0.2 : 0.12,
                    isKill ? 0.2 : 0.12,
                    hitDirX,
                    hitDirZ,
                  );
                  if (!isKill && this.potionSystem?.isShadow) {
                    this.potionSystem.breakShadow();
                  }
                }

                if (isCrit) this.combat.startCritChain(playerChar);
              }
            }
          }
        }

        // Check destroyable props if no enemy hit
        if (
          !hitEnemy &&
          playerChar.canApplyAttackHit() &&
          this.propDestructionSystem
        ) {
          const propHit = this.propDestructionSystem.checkMeleeHit(
            px,
            playerChar.groundY,
            pz,
            playerChar.facing,
            playerChar.params.attackReach,
            playerChar.params.attackArcHalf,
          );
          if (propHit) {
            playerChar.markAttackHitApplied();
            if (this.impactCallbacks) {
              if (this.hitstopEnabled) this.impactCallbacks.onHitstop(0.04);
              this.impactCallbacks.onCameraShake(0.1, 0.1, 0, 0);
            }
            if (this.potionSystem?.isShadow) {
              for (const enemy of this.enemies) {
                if (!enemy.isAlive) continue;
                const edx = enemy.mesh.position.x - px;
                const edz = enemy.mesh.position.z - pz;
                if (edx * edx + edz * edz < 9) {
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
          this.goreSystem.spawnGore(
            enemy.mesh,
            enemy.groundY,
            this.getAllCharacters(playerChar),
            enemy.lastHitDirX,
            enemy.lastHitDirZ,
          );
        }
        this.lootSystem.spawnLoot(pos.clone());
        if (Math.random() < 0.4) this.lootSystem.spawnFood(pos.clone());
        audioSystem.sfxAt('death', pos.x, pos.z);
        this.cleanupEnemy(enemy);
        enemy.dispose();
        this.enemies.splice(i, 1);
        onEnemyDied();
        continue;
      }

      const roomVis = this.terrain.getRoomVisibility();

      const ex = enemy.mesh.position.x;
      const ez = enemy.mesh.position.z;
      const px = playerChar.mesh.position.x;
      const pz = playerChar.mesh.position.z;

      // Skip processing for enemies outside active area (unless chasing/fleeing/frenzy-spawned)
      const isChasing = enemy.isCurrentlyChasing();
      const isFleeing = enemy.isCurrentlyFleeing();
      const isFrenzyEnemy = this.spawner.frenzyEnemies.has(enemy);

      // Remove frenzy status when enemy starts fleeing (low HP)
      if (isFleeing && isFrenzyEnemy) {
        this.spawner.cleanupFrenzyEnemy(enemy);
      }
      if (
        roomVis &&
        !roomVis.isPositionActive(ex, ez) &&
        !isChasing &&
        !isFleeing &&
        !isFrenzyEnemy
      ) {
        enemy.mesh.visible = false;
        enemy.hideHpBar();
        const fIcon = this.spawner.frenzyAlertIcons.get(enemy);
        if (fIcon) fIcon.visible = false;
        const sIcons = this.spawner.statusIcons.get(enemy);
        if (sIcons) for (const [, s] of sIcons) s.visible = false;
        continue;
      }
      if (roomVis && !enemy.mesh.visible) {
        enemy.mesh.visible = true;
      }

      let shouldChase = false;
      const dx = ex - px,
        dz = ez - pz;
      const distSq = dx * dx + dz * dz;

      if (this.potionSystem?.isShadow) {
        shouldChase = false;
      } else if (roomVis) {
        const DUNGEON_LEASH_SQ = 6 * 6;
        shouldChase =
          roomVis.isPositionActive(px, pz) && distSq < DUNGEON_LEASH_SQ;
      } else {
        const chaseRange =
          useGameStore.getState().enemyParams.chaseRange * 0.25;
        shouldChase = distSq < chaseRange * chaseRange;
      }

      // Frenzy-spawned enemies get a wider leash but not infinite
      if (isFrenzyEnemy) {
        const FRENZY_LEASH_SQ = 12 * 12;
        if (distSq < FRENZY_LEASH_SQ) shouldChase = true;
        else shouldChase = false; // override: frenzy enemies beyond leash disengage
      }

      const aggroTime = this.aggroTimers.get(enemy);
      if (aggroTime !== undefined) {
        shouldChase = true;
        const remaining = aggroTime - dt;
        let clearAggro = remaining <= 0;
        if (!clearAggro) {
          if (roomVis) {
            clearAggro = roomVis.isPositionActive(px, pz);
          } else {
            const chaseRange =
              useGameStore.getState().enemyParams.chaseRange * 0.25;
            clearAggro = distSq < chaseRange * chaseRange;
          }
        }
        if (clearAggro) {
          this.aggroTimers.delete(enemy);
        } else {
          this.aggroTimers.set(enemy, remaining);
        }
      }

      // Taunt override
      let tauntOverride = false;
      if (
        this.spawner.tauntTarget &&
        this.spawner.tauntTarget.isAlive &&
        this.spawner.tauntTimer > 0 &&
        enemy !== this.spawner.tauntTarget
      ) {
        const ttx = this.spawner.tauntTarget.mesh.position.x - ex;
        const ttz = this.spawner.tauntTarget.mesh.position.z - ez;
        const ttDistSq = ttx * ttx + ttz * ttz;
        if (ttDistSq < 36) {
          enemy.setChaseTarget(this.spawner.tauntTarget, dt);
          tauntOverride = true;
        }
      }

      if (!tauntOverride) {
        enemy.setChaseTarget(shouldChase ? playerChar : null, dt);
      }
      enemy.update(dt);

      // Awareness fog (open maps)
      if (!roomVis) {
        const dist = Math.sqrt(distSq);
        const chaseRange =
          useGameStore.getState().enemyParams.chaseRange * 0.25;
        const visRange = chaseRange * 1.5;
        const targetOpacity =
          dist <= chaseRange
            ? 1.0
            : dist >= visRange
              ? 0.0
              : 1.0 - (dist - chaseRange) / (visRange - chaseRange);
        const mat = enemy.mesh.material as THREE.MeshStandardMaterial;
        const current = mat.opacity ?? 1;
        const speed = 3.0;
        const newOpacity =
          current < targetOpacity
            ? Math.min(targetOpacity, current + speed * dt)
            : Math.max(targetOpacity, current - speed * dt);
        if (newOpacity < 0.99) {
          if (!mat.transparent) {
            mat.transparent = true;
            mat.needsUpdate = true;
          }
          mat.opacity = newOpacity;
          enemy.mesh.visible = newOpacity > 0.01;
        } else {
          if (mat.transparent) {
            mat.transparent = false;
            mat.needsUpdate = true;
          }
          mat.opacity = 1;
          enemy.mesh.visible = true;
        }
      }

      // Enemy melee attack
      if (enemy.mesh.visible && enemy.wantsToAttack() && enemy.stunTimer <= 0) {
        const started = enemy.startAttack();
        if (started) {
          audioSystem.sfxAt(
            'slash',
            enemy.mesh.position.x,
            enemy.mesh.position.z,
          );
          if (showSlashEffect) {
            const enemySlashStyle = enemy.voxEntry
              ? getSlashStyle(getArchetype(enemy.voxEntry.name))
              : 'default';
            this.vfx.pushSlashArc(enemy.mesh, enemySlashStyle);
          }
        }
      }
      if (
        enemy.mesh.visible &&
        enemy.isAttacking &&
        enemy.canApplyAttackHit()
      ) {
        const eax = enemy.mesh.position.x;
        const eaz = enemy.mesh.position.z;

        const isCrit = Math.random() < enemy.critChance;
        const attackDamage = isCrit
          ? enemy.params.attackDamage * 2
          : enemy.params.attackDamage;

        if (
          tauntOverride &&
          this.spawner.tauntTarget &&
          this.spawner.tauntTarget.isAlive
        ) {
          const tt = this.spawner.tauntTarget;
          if (
            isInAttackArc(
              eax,
              enemy.groundY,
              eaz,
              enemy.facing,
              tt.mesh.position.x,
              tt.groundY,
              tt.mesh.position.z,
              enemy.params.attackReach,
              enemy.params.attackArcHalf,
            )
          ) {
            const hit = tt.takeDamage(
              attackDamage,
              eax,
              eaz,
              enemy.params.melee.knockback * 0.5,
            );
            if (hit) {
              enemy.markAttackHitApplied();
              const tx = tt.mesh.position.x,
                ty = tt.mesh.position.y,
                tz = tt.mesh.position.z;
              audioSystem.sfxAt('fleshHit', tx, tz);
              this.vfx.pushDamageNumber(
                tx,
                ty + 0.3,
                tz,
                attackDamage,
                0,
                0,
                isCrit,
              );
              const hitDirX = tx - eax,
                hitDirZ = tz - eaz;
              const hitDist =
                Math.sqrt(hitDirX * hitDirX + hitDirZ * hitDirZ) || 1;
              this.vfx.pushHitSparks(
                tx,
                ty,
                tz,
                hitDirX / hitDist,
                hitDirZ / hitDist,
              );
              if (this.goreSystem) {
                this.goreSystem.spawnBloodSplash(
                  tx,
                  ty,
                  tz,
                  tt.groundY,
                  this.getAllCharacters(playerChar),
                );
              }
            }
          }
        } else if (
          this.statusEffects.hasConfusion(enemy) &&
          Math.random() < 0.3 &&
          this.statusEffects.tryConfusionFriendlyFire(
            enemy,
            eax,
            eaz,
            this.enemies,
            this.scene,
            this.goreSystem,
            () => this.getAllCharacters(playerChar),
          )
        ) {
          // Confused enemy redirected attack
        } else if (
          isInAttackArc(
            eax,
            enemy.groundY,
            eaz,
            enemy.facing,
            playerChar.mesh.position.x,
            playerChar.groundY,
            playerChar.mesh.position.z,
            enemy.params.attackReach,
            enemy.params.attackArcHalf,
          )
        ) {
          const hit = playerChar.takeDamage(
            attackDamage,
            eax,
            eaz,
            enemy.params.melee.knockback,
          );
          if (hit) {
            enemy.markAttackHitApplied();
            onPlayerHit(attackDamage);
            const ppx = playerChar.mesh.position.x;
            const ppy = playerChar.mesh.position.y;
            const ppz = playerChar.mesh.position.z;
            audioSystem.sfxAt('fleshHit', ppx, ppz);
            const hitDirX = ppx - eax;
            const hitDirZ = ppz - eaz;
            const hitDist =
              Math.sqrt(hitDirX * hitDirX + hitDirZ * hitDirZ) || 1;
            this.vfx.pushHitSparks(
              ppx,
              ppy,
              ppz,
              hitDirX / hitDist,
              hitDirZ / hitDist,
            );
            if (this.goreSystem) {
              this.goreSystem.spawnBloodSplash(
                ppx,
                ppy,
                ppz,
                playerChar.groundY,
                this.getAllCharacters(playerChar),
              );
            }
            if (this.impactCallbacks) {
              if (this.hitstopEnabled) this.impactCallbacks.onHitstop(0.08);
              this.impactCallbacks.onCameraShake(
                0.18,
                0.15,
                hitDirX / hitDist,
                hitDirZ / hitDist,
              );
            }
          }
        }
      }
    }

    // ── Post-loop updates ──
    this.resolveCharacterCollisions(dt, playerChar);
    this.statusEffects.tick(dt);
    this.spawner.tickTaunt(dt);

    if (camera && this.spawner.hasAnyIcons()) {
      this.spawner.updateAlertIcons(camera);
    }

    this.vfx.update(dt);
  }

  // ── Collision resolution ──

  private resolveCharacterCollisions(dt: number, playerChar: Character): void {
    const allChars: Character[] = [];
    if (playerChar.isAlive) allChars.push(playerChar);
    for (const ally of this.allyCharacters) {
      if (ally !== playerChar && ally.isAlive) allChars.push(ally);
    }
    for (const enemy of this.enemies) {
      if (enemy.isAlive) allChars.push(enemy);
    }

    const characterPushEnabled = useGameStore.getState().characterPushEnabled;

    for (let i = 0; i < allChars.length; i++) {
      for (let j = i + 1; j < allChars.length; j++) {
        const a = allChars[i];
        const b = allChars[j];
        const dx = b.mesh.position.x - a.mesh.position.x;
        const dz = b.mesh.position.z - a.mesh.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        const minDist = a.entity.radius + b.entity.radius;
        if (dist < minDist && dist > 0.001) {
          const overlap = minDist - dist;
          const nx = dx / dist;
          const nz = dz / dist;
          const push = overlap * 0.5 * CHAR_PUSH_STRENGTH * dt;
          const pushClamped = Math.min(push, overlap * 0.5);
          if (characterPushEnabled) {
            a.mesh.position.x -= nx * pushClamped;
            a.mesh.position.z -= nz * pushClamped;
            b.mesh.position.x += nx * pushClamped;
            b.mesh.position.z += nz * pushClamped;
          } else {
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

  // ── Query & utility methods ──

  private getAllCharacters(playerChar?: Character): Character[] {
    const chars: Character[] = [];
    if (playerChar) chars.push(playerChar);
    chars.push(...this.allyCharacters, ...this.enemies);
    return chars;
  }

  aggroEnemy(enemy: Enemy): void {
    this.aggroTimers.set(enemy, AGGRO_DURATION);
  }

  getEnemies(): ReadonlyArray<Enemy> {
    return this.enemies;
  }

  getVisibleEnemies(): ReadonlyArray<Enemy> {
    return this.enemies.filter((e) => e.mesh.visible);
  }

  getEnemyPositions(): THREE.Vector3[] {
    const positions: THREE.Vector3[] = [];
    for (const enemy of this.enemies) {
      if (enemy.isAlive) {
        positions.push(enemy.mesh.position);
      }
    }
    return positions;
  }

  serialize(): SavedEnemy[] {
    return this.enemies
      .filter((e) => e.isAlive)
      .map((e) => ({
        type: e.voxEntry?.id ?? '',
        x: e.mesh.position.x,
        z: e.mesh.position.z,
        hp: e.hp,
        maxHp: e.maxHp,
        facing: e.getFacing(),
      }));
  }

  restoreEnemies(saved: SavedEnemy[]): void {
    const isDungeon = !!this.terrain.getRoomVisibility();
    for (const s of saved) {
      const y = this.terrain.getTerrainY(s.x, s.z);
      const pos = new THREE.Vector3(s.x, y, s.z);
      const enemy = new Enemy(
        this.scene,
        this.terrain,
        this.navGrid,
        pos,
        this.ladderDefs,
      );
      enemy.initChaseBehavior(this.navGrid, this.ladderDefs, isDungeon);
      enemy.hp = s.hp;
      enemy.maxHp = s.maxHp;
      enemy.setFacing(s.facing);
      if (s.type) {
        const entry = VOX_ENEMIES.find((e) => e.id === s.type);
        if (entry) enemy.applyVoxSkin(entry);
      }
      this.enemies.push(enemy);
    }
  }

  dispose(): void {
    this.spawner.dispose();
    this.statusEffects.dispose();
    this.vfx.dispose();
    for (const enemy of this.enemies) enemy.dispose();
    this.enemies = [];
  }
}
