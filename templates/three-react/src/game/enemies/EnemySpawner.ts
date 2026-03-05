import * as THREE from 'three';
import type { Environment } from '../environment';
import type { NavGrid } from '../pathfinding';
import type { LadderDef } from '../dungeon';
import { Character, Enemy } from '../character';
import { VOX_ENEMIES, getFilteredEnemies } from '../character';
import type { VoxCharEntry } from '../character';
import { audioSystem } from '../../utils/AudioSystem';
import { buildRoomEnemyPool } from '../dungeon';
import { useGameStore } from '../../store';
import { createSvgIconSprite } from '../combat';

// ── Constants ──

const FRENZY_SPEED_MULT = 1.25;
const FRENZY_ALERT_Y = 0.75;
const STAGGER_MIN = 2.0;
const STAGGER_MAX = 5.0;
const MIN_ENTRANCE_DIST_SQ = 5 * 5;
const MIN_TRANSITION_DIST_SQ = 3 * 3;

/** Effects that get persistent icons above enemies */
const STATUS_ICON_EFFECTS = new Set(['poison', 'slow', 'fragile', 'confusion', 'frenzy']);

export { FRENZY_ALERT_Y };

export class EnemySpawner {
  private readonly scene: THREE.Scene;
  private readonly terrain: Environment;
  private readonly navGrid: NavGrid;
  private readonly ladderDefs: ReadonlyArray<LadderDef>;
  private readonly enemies: Enemy[];

  // ── Staggered / wave spawn state ──
  private pendingSpawns = 0;
  private staggerCooldown = 0;
  private spawnTimer = 0;
  private spawnInterval = 0;
  private maxEnemies = 0;

  // ── Exclusion zones ──
  private transitionExclusions: { x: number; z: number }[] = [];
  private playerExcludeX = 0;
  private playerExcludeZ = 0;
  private playerExcludeDistSq = 0;

  // ── Frenzy tracking ──
  readonly frenzyEnemies = new Set<Enemy>();
  readonly frenzyAlertIcons = new Map<Enemy, THREE.Sprite>();
  readonly statusIcons = new Map<Enemy, Map<string, THREE.Sprite>>();

  // ── Taunt state ──
  tauntTarget: Enemy | null = null;
  tauntTimer = 0;
  tauntAlertIcon: THREE.Sprite | null = null;

  constructor(
    scene: THREE.Scene,
    terrain: Environment,
    navGrid: NavGrid,
    ladderDefs: ReadonlyArray<LadderDef>,
    enemies: Enemy[],
  ) {
    this.scene = scene;
    this.terrain = terrain;
    this.navGrid = navGrid;
    this.ladderDefs = ladderDefs;
    this.enemies = enemies;
  }

  // ── Spawn API ──

  spawnEnemies(count: number): void {
    this.pendingSpawns += count;
    if (this.enemies.length === 0 && this.pendingSpawns > 0) {
      this.spawnOneEnemy();
      this.pendingSpawns--;
      this.staggerCooldown =
        STAGGER_MIN + Math.random() * (STAGGER_MAX - STAGGER_MIN);
    }
  }

  enableWaveSpawning(maxEnemies: number, interval = 12): void {
    this.maxEnemies = maxEnemies;
    this.spawnInterval = interval;
    this.spawnTimer = interval * 0.5;
  }

  setTransitionExclusions(positions: { x: number; z: number }[]): void {
    this.transitionExclusions = positions;
  }

  setPlayerExclusionZone(x: number, z: number, radius: number): void {
    this.playerExcludeX = x;
    this.playerExcludeZ = z;
    this.playerExcludeDistSq = radius * radius;
  }

  /** Tick staggered + wave spawns (called from EnemySystem.update) */
  tickSpawn(dt: number): void {
    if (this.pendingSpawns > 0) {
      this.staggerCooldown -= dt;
      if (this.staggerCooldown <= 0) {
        this.spawnOneEnemy();
        this.pendingSpawns--;
        this.staggerCooldown =
          STAGGER_MIN + Math.random() * (STAGGER_MAX - STAGGER_MIN);
      }
    }

    if (
      this.spawnInterval > 0 &&
      this.pendingSpawns === 0 &&
      this.enemies.length < this.maxEnemies
    ) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = this.spawnInterval * (0.7 + Math.random() * 0.6);
        this.spawnOneEnemy();
      }
    }
  }

  /** Tick taunt timer (called from EnemySystem.update) */
  tickTaunt(dt: number): void {
    if (this.tauntTimer > 0) {
      this.tauntTimer -= dt;
      if (
        this.tauntTimer <= 0 ||
        !this.tauntTarget ||
        !this.tauntTarget.isAlive
      ) {
        this.tauntTarget = null;
        this.tauntTimer = 0;
        this.cleanupTauntIcon();
      }
    }
  }

  // ── Direct spawn ──

  spawnEnemyAt(
    x: number,
    z: number,
    chaseTarget?: Character,
    isFrenzy = false,
    entry?: VoxCharEntry,
  ): Enemy {
    const y = this.terrain.getTerrainY(x, z);
    const pos = new THREE.Vector3(x, y, z);
    const roomVis = this.terrain.getRoomVisibility();
    const enemy = new Enemy(
      this.scene,
      this.terrain,
      this.navGrid,
      pos,
      this.ladderDefs,
      entry,
    );
    enemy.initChaseBehavior(this.navGrid, this.ladderDefs, !!roomVis);
    enemy.mesh.visible = true;
    if (chaseTarget) {
      enemy.setChaseTarget(chaseTarget, 0);
    }
    if (isFrenzy) {
      enemy.params.speed *= FRENZY_SPEED_MULT;
      enemy.baseSpeed = enemy.params.speed;
      this.frenzyEnemies.add(enemy);
      this.spawnAlertIcon(enemy);
    }
    this.enemies.push(enemy);
    return enemy;
  }

  triggerFrenzySpawn(
    playerChar: Character,
    doorCenters: { x: number; z: number }[],
    roomVis: import('../dungeon').RoomVisibility | null,
    count = 4,
  ): void {
    const px = playerChar.mesh.position.x;
    const pz = playerChar.mesh.position.z;

    let candidates: { x: number; z: number }[] = [];

    const doorsWithDist = doorCenters
      .map((d) => {
        const dx = d.x - px,
          dz = d.z - pz;
        return { ...d, distSq: dx * dx + dz * dz };
      })
      .filter((d) => d.distSq < 400)
      .sort((a, b) => a.distSq - b.distSq);

    for (const d of doorsWithDist) {
      const tooClose = candidates.some((c) => {
        const dx = c.x - d.x,
          dz = c.z - d.z;
        return dx * dx + dz * dz < 4;
      });
      if (!tooClose) candidates.push(d);
      if (candidates.length >= count) break;
    }

    if (candidates.length < count) {
      const ringRadius = 6 + Math.random() * 2;
      const needed = count - candidates.length;
      for (let i = 0; i < needed; i++) {
        const angle = (Math.PI * 2 * i) / needed + (Math.random() - 0.5) * 0.5;
        candidates.push({
          x: px + Math.cos(angle) * ringRadius,
          z: pz + Math.sin(angle) * ringRadius,
        });
      }
    }

    for (let i = 0; i < count; i++) {
      const pos = candidates[i % candidates.length];
      const jx = pos.x + (Math.random() - 0.5) * 0.8;
      const jz = pos.z + (Math.random() - 0.5) * 0.8;
      this.spawnEnemyAt(jx, jz, playerChar, true);
    }

    audioSystem.sfx('damage');
  }

  spawnBossEnemies(
    archetype: string,
    count: number,
    nearX: number,
    nearZ: number,
  ): void {
    const ids = getFilteredEnemies(
      VOX_ENEMIES.filter((e) => {
        const arch = e.name
          .replace(/\s*\([^)]*\)\s*/g, '')
          .replace(/\s+[A-H]$/i, '')
          .trim()
          .toLowerCase();
        return arch === archetype;
      }).map((e) => e.id),
    );
    if (ids.length === 0) return;

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const radius = 1.5 + Math.random() * 1.5;
      const x = nearX + Math.cos(angle) * radius;
      const z = nearZ + Math.sin(angle) * radius;
      const entry = ids[Math.floor(Math.random() * ids.length)];
      this.spawnEnemyAt(x, z, undefined, false, entry);
    }
  }

  // ── Alert icon management ──

  createAlertSprite(
    scaleX: number,
    scaleY: number,
    color = '#ff2222',
    char = '!',
  ): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 40px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.strokeText(char, 16, 24);
    ctx.fillText(char, 16, 24);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(scaleX, scaleY, 1);
    sprite.renderOrder = 1001;
    return sprite;
  }

  private spawnAlertIcon(enemy: Enemy): void {
    const sprite = this.createAlertSprite(0.25, 0.35, '#ff2222');
    this.scene.add(sprite);
    this.frenzyAlertIcons.set(enemy, sprite);
  }

  spawnStatusIcon(enemy: Enemy, effectName: string): void {
    if (!STATUS_ICON_EFFECTS.has(effectName)) return;
    let enemyIcons = this.statusIcons.get(enemy);
    if (!enemyIcons) {
      enemyIcons = new Map();
      this.statusIcons.set(enemy, enemyIcons);
    }
    if (enemyIcons.has(effectName)) return;
    const sprite = createSvgIconSprite(effectName, null, 48);
    sprite.scale.set(0.16, 0.16, 1);
    this.scene.add(sprite);
    enemyIcons.set(effectName, sprite);
  }

  cleanupStatusIcon(enemy: Enemy, effectName: string): void {
    const enemyIcons = this.statusIcons.get(enemy);
    if (!enemyIcons) return;
    const icon = enemyIcons.get(effectName);
    if (icon) {
      this.scene.remove(icon);
      (icon.material as THREE.SpriteMaterial).map?.dispose();
      (icon.material as THREE.SpriteMaterial).dispose();
      enemyIcons.delete(effectName);
    }
    if (enemyIcons.size === 0) this.statusIcons.delete(enemy);
  }

  cleanupFrenzyEnemy(enemy: Enemy): void {
    this.frenzyEnemies.delete(enemy);
    const icon = this.frenzyAlertIcons.get(enemy);
    if (icon) {
      this.scene.remove(icon);
      (icon.material as THREE.SpriteMaterial).map?.dispose();
      (icon.material as THREE.SpriteMaterial).dispose();
      this.frenzyAlertIcons.delete(enemy);
    }
  }

  setTauntTarget(enemy: Enemy): void {
    this.cleanupTauntIcon();
    this.tauntTarget = enemy;
    this.tauntTimer = 25;
    this.tauntAlertIcon = this.createAlertSprite(0.18, 0.25, '#44dd66');
    this.scene.add(this.tauntAlertIcon);
  }

  cleanupTauntIcon(): void {
    if (this.tauntAlertIcon) {
      this.scene.remove(this.tauntAlertIcon);
      (this.tauntAlertIcon.material as THREE.SpriteMaterial).map?.dispose();
      (this.tauntAlertIcon.material as THREE.SpriteMaterial).dispose();
      this.tauntAlertIcon = null;
    }
  }

  /** Update all alert icon positions (frenzy !, taunt !, confusion ?) */
  updateAlertIcons(camera: THREE.Camera): void {
    for (const [enemy, sprite] of this.frenzyAlertIcons) {
      if (!enemy.isAlive) {
        this.cleanupFrenzyEnemy(enemy);
        continue;
      }
      sprite.position.set(
        enemy.mesh.position.x,
        enemy.mesh.position.y + FRENZY_ALERT_Y,
        enemy.mesh.position.z,
      );
      sprite.visible = enemy.mesh.visible;
      sprite.quaternion.copy(camera.quaternion);
    }
    if (this.tauntAlertIcon && this.tauntTarget) {
      if (!this.tauntTarget.isAlive) {
        this.cleanupTauntIcon();
      } else {
        this.tauntAlertIcon.position.set(
          this.tauntTarget.mesh.position.x,
          this.tauntTarget.mesh.position.y + FRENZY_ALERT_Y,
          this.tauntTarget.mesh.position.z,
        );
        this.tauntAlertIcon.visible = this.tauntTarget.mesh.visible;
        this.tauntAlertIcon.quaternion.copy(camera.quaternion);
      }
    }
    for (const [enemy, enemyIcons] of this.statusIcons) {
      if (!enemy.isAlive) {
        for (const [name] of enemyIcons) this.cleanupStatusIcon(enemy, name);
        this.statusIcons.delete(enemy);
        continue;
      }
      let idx = 0;
      for (const [, sprite] of enemyIcons) {
        const offsetX = (idx - (enemyIcons.size - 1) * 0.5) * 0.18;
        sprite.position.set(
          enemy.mesh.position.x + offsetX,
          enemy.mesh.position.y + FRENZY_ALERT_Y,
          enemy.mesh.position.z,
        );
        sprite.visible = enemy.mesh.visible;
        sprite.quaternion.copy(camera.quaternion);
        idx++;
      }
    }
  }

  hasAnyIcons(): boolean {
    return (
      this.frenzyAlertIcons.size > 0 ||
      this.tauntAlertIcon !== null ||
      this.statusIcons.size > 0
    );
  }

  // ── Internal spawn positioning ──

  private isNearTransition(x: number, z: number): boolean {
    for (const t of this.transitionExclusions) {
      const dx = x - t.x,
        dz = z - t.z;
      if (dx * dx + dz * dz < MIN_TRANSITION_DIST_SQ) return true;
    }
    return false;
  }

  private countEnemiesPerArea(
    roomVis: import('../dungeon').RoomVisibility,
  ): Map<number, number> {
    const counts = new Map<number, number>();
    for (const enemy of this.enemies) {
      if (!enemy.isAlive) continue;
      const rid = roomVis.getRoomAtWorld(
        enemy.mesh.position.x,
        enemy.mesh.position.z,
      );
      if (rid !== -1) counts.set(rid, (counts.get(rid) ?? 0) + 1);
    }
    return counts;
  }

  private getAreaEnemyCap(
    roomVis: import('../dungeon').RoomVisibility,
    areaId: number,
  ): number {
    const cellCount = roomVis.cellsPerArea.get(areaId) ?? 0;
    const density = useGameStore.getState().enemyParams.enemyDensity;
    return Math.max(1, Math.round(cellCount * density));
  }

  private spawnOneEnemy(): void {
    const roomVis = this.terrain.getRoomVisibility();
    const entrance = this.terrain.getEntrancePosition();
    const ex = entrance?.x ?? 0,
      ez = entrance?.z ?? 0;
    const hasEntrance = entrance !== null;

    const areaCounts = roomVis ? this.countEnemiesPerArea(roomVis) : null;

    for (let attempt = 0; attempt < 20; attempt++) {
      const pos = this.terrain.getRandomPosition(5);
      if (roomVis && roomVis.isPositionActive(pos.x, pos.z)) continue;
      if (hasEntrance) {
        const dx = pos.x - ex,
          dz = pos.z - ez;
        if (dx * dx + dz * dz < MIN_ENTRANCE_DIST_SQ) continue;
      }
      if (this.playerExcludeDistSq > 0) {
        const dx = pos.x - this.playerExcludeX,
          dz = pos.z - this.playerExcludeZ;
        if (dx * dx + dz * dz < this.playerExcludeDistSq) continue;
      }
      if (this.isNearTransition(pos.x, pos.z)) continue;
      if (roomVis && areaCounts) {
        const rid = roomVis.getRoomAtWorld(pos.x, pos.z);
        if (rid !== -1) {
          const current = areaCounts.get(rid) ?? 0;
          const cap = this.getAreaEnemyCap(roomVis, rid);
          if (current >= cap) continue;
        }
      }
      const entry = this.pickRoomAwareEntry(pos, roomVis);
      const enemy = new Enemy(
        this.scene,
        this.terrain,
        this.navGrid,
        pos,
        this.ladderDefs,
        entry,
      );
      enemy.initChaseBehavior(this.navGrid, this.ladderDefs, !!roomVis);
      if (roomVis) enemy.mesh.visible = false;
      this.enemies.push(enemy);
      if (roomVis && areaCounts) {
        const rid = roomVis.getRoomAtWorld(pos.x, pos.z);
        if (rid !== -1) areaCounts.set(rid, (areaCounts.get(rid) ?? 0) + 1);
      }
      return;
    }
    // Fallback
    const pos = this.terrain.getRandomPosition(5);
    if (roomVis) {
      const rid = roomVis.getRoomAtWorld(pos.x, pos.z);
      if (rid !== -1 && areaCounts) {
        const current = areaCounts.get(rid) ?? 0;
        const cap = this.getAreaEnemyCap(roomVis, rid);
        if (current >= cap) return;
      }
    }
    const entry = this.pickRoomAwareEntry(pos, roomVis);
    const enemy = new Enemy(
      this.scene,
      this.terrain,
      this.navGrid,
      pos,
      this.ladderDefs,
      entry,
    );
    enemy.initChaseBehavior(this.navGrid, this.ladderDefs, !!roomVis);
    if (roomVis) enemy.mesh.visible = false;
    this.enemies.push(enemy);
  }

  private pickRoomAwareEntry(
    pos: THREE.Vector3,
    roomVis: import('../dungeon').RoomVisibility | null,
  ): VoxCharEntry | undefined {
    const propSystem = this.terrain.getPropSystem();
    if (!roomVis || !propSystem) return undefined;

    const rid = roomVis.getRoomAtWorld(pos.x, pos.z);
    if (rid < 0) return undefined;

    const templateName = propSystem.getRoomTemplate(rid);
    const floor = useGameStore.getState().floor;
    const pool = buildRoomEnemyPool(floor, templateName);
    if (pool.length === 0) return undefined;

    const id = pool[Math.floor(Math.random() * pool.length)];
    return getFilteredEnemies([id])[0];
  }

  dispose(): void {
    this.pendingSpawns = 0;
    this.staggerCooldown = 0;
    this.tauntTarget = null;
    this.tauntTimer = 0;
    this.cleanupTauntIcon();
    for (const [, icon] of this.frenzyAlertIcons) {
      this.scene.remove(icon);
      (icon.material as THREE.SpriteMaterial).map?.dispose();
      (icon.material as THREE.SpriteMaterial).dispose();
    }
    this.frenzyAlertIcons.clear();
    for (const [, enemyIcons] of this.statusIcons) {
      for (const [, icon] of enemyIcons) {
        this.scene.remove(icon);
        (icon.material as THREE.SpriteMaterial).map?.dispose();
        (icon.material as THREE.SpriteMaterial).dispose();
      }
    }
    this.statusIcons.clear();
    this.frenzyEnemies.clear();
  }
}
