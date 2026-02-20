import Phaser from 'phaser';
import { WAVES, ENEMY_TYPES, BOSS, ARENA, GAME, PX, DIFFICULTY, ENEMY_BEHAVIORS, ELITE } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';
import { Enemy } from '../entities/Enemy.js';

export class WaveSystem {
  constructor(scene) {
    this.scene = scene;
    this.enemies = [];
    this.waveNumber = 0;
    this.spawnRate = WAVES.INITIAL_SPAWN_RATE;
    this.spawnTimer = null;
    this.bossTimer = null;
    this.elapsed = 0;
    this.lastBossTime = 0;
    this.bossesSpawned = 0; // tracks how many bosses have spawned for escalation
    this._catchupAccumulator = 0; // ms accumulator for catch-up spawns
  }

  /** Elapsed minutes since game start — drives difficulty scaling */
  get elapsedMinutes() {
    return this.elapsed / 60000;
  }

  /**
   * Get difficulty-scaled stat multiplier.
   * Returns a multiplier (1.0 = base) that grows linearly with time, capped.
   */
  getStatScale(rate, max) {
    return Math.min(1 + rate * this.elapsedMinutes, max);
  }

  /**
   * Get current powerup drop rate multiplier (decreases over time).
   */
  getPowerupDropMult() {
    return Math.max(
      DIFFICULTY.POWERUP_DROP_MIN_MULT,
      1 - DIFFICULTY.POWERUP_DROP_DECAY_RATE * this.elapsedMinutes
    );
  }

  /**
   * Get current max enemies cap (increases over time).
   */
  getMaxEnemies() {
    return Math.min(
      DIFFICULTY.MAX_ENEMIES_CAP,
      Math.floor(WAVES.MAX_ENEMIES + DIFFICULTY.MAX_ENEMIES_RATE * this.elapsedMinutes)
    );
  }

  /**
   * Get current enemies per wave (increases over time).
   */
  getEnemiesPerWave() {
    return Math.min(
      DIFFICULTY.ENEMIES_PER_WAVE_MAX,
      Math.floor(WAVES.ENEMIES_PER_WAVE + DIFFICULTY.ENEMIES_PER_WAVE_RATE * this.elapsedMinutes)
    );
  }

  /**
   * Get minimum enemy floor — if fewer than this, spawn catch-up enemies.
   */
  getMinEnemies() {
    return Math.min(
      WAVES.MIN_ENEMIES_MAX,
      Math.floor(WAVES.MIN_ENEMIES + WAVES.MIN_ENEMIES_RATE * this.elapsedMinutes)
    );
  }

  start() {
    this.waveNumber = 0;
    this.spawnRate = WAVES.INITIAL_SPAWN_RATE;
    this.elapsed = 0;
    this.lastBossTime = 0;
    this.bossesSpawned = 0;
    this._catchupAccumulator = 0;

    // Start spawning waves
    this.scheduleNextSpawn();

    // Boss timer
    this.bossTimer = this.scene.time.addEvent({
      delay: BOSS.SPAWN_INTERVAL,
      callback: () => this.spawnBoss(),
      loop: true,
    });
  }

  scheduleNextSpawn() {
    this.spawnTimer = this.scene.time.delayedCall(this.spawnRate, () => {
      this.spawnWave();
      this.waveNumber++;
      this.spawnRate = Math.max(
        WAVES.MIN_SPAWN_RATE,
        WAVES.INITIAL_SPAWN_RATE - this.waveNumber * WAVES.SPAWN_RATE_DECREASE
      );
      this.scheduleNextSpawn();
    });
  }

  spawnWave() {
    const maxEnemies = this.getMaxEnemies();
    const activeCount = this.enemies.filter(e => !e.dead).length;
    if (activeCount >= maxEnemies) return;

    const perWave = this.getEnemiesPerWave();
    const count = Math.min(perWave, maxEnemies - activeCount);

    for (let i = 0; i < count; i++) {
      this.spawnEnemy();
    }

    eventBus.emit(Events.WAVE_START, { wave: this.waveNumber });
  }

  /**
   * Catch-up spawning — if enemy count drops below the minimum floor,
   * spawn one enemy every ~300ms to refill without big bursts.
   */
  tickCatchup(delta) {
    const maxEnemies = this.getMaxEnemies();
    let minEnemies = this.getMinEnemies();

    // While a boss is alive, ensure the screen stays populated
    const hasBoss = this.enemies.some(e => !e.dead && e.isBoss && e.sprite.active);
    if (hasBoss) {
      minEnemies = Math.max(minEnemies, BOSS.ESCORT_COUNT + 4);
    }

    const activeCount = this.enemies.filter(e => !e.dead).length;

    if (activeCount >= minEnemies || activeCount >= maxEnemies) {
      this._catchupAccumulator = 0;
      return;
    }

    // Faster catch-up during boss fights (200ms vs 300ms)
    const catchupInterval = hasBoss ? 200 : 300;
    this._catchupAccumulator += delta;
    if (this._catchupAccumulator >= catchupInterval) {
      this._catchupAccumulator = 0;
      this.spawnEnemy();
    }
  }

  spawnEnemy() {
    const pos = this.getSpawnPosition();
    const typeName = this.pickEnemyType();

    // Calculate difficulty-scaled stats for this enemy
    const scaledStats = this.getScaledEnemyStats(typeName);

    // Roll for elite variant — generous chance that ramps with time
    if (this.elapsedMinutes >= ELITE.UNLOCK_MINUTE) {
      const minutesPast = this.elapsedMinutes - ELITE.UNLOCK_MINUTE;
      const eliteChance = Math.min(ELITE.MAX_CHANCE, ELITE.INITIAL_CHANCE + ELITE.CHANCE_PER_MIN * minutesPast);
      if (Math.random() < eliteChance) {
        scaledStats.health = Math.max(1, Math.round(scaledStats.health * ELITE.HP_MULT));
        scaledStats.speed *= ELITE.SPEED_MULT;
        scaledStats.isElite = true;
      }
    }

    const enemy = new Enemy(this.scene, pos.x, pos.y, typeName, false, scaledStats);

    // Roll for behavior variant
    const behavior = this.rollBehavior(typeName);
    if (behavior) {
      enemy.setBehavior(behavior);
    }

    this.enemies.push(enemy);
    return enemy;
  }

  /**
   * Roll for a behavior variant for the given enemy type.
   * Returns behavior name or null if no special behavior.
   */
  rollBehavior(typeName) {
    const minutes = this.elapsedMinutes;
    const candidates = [];

    for (const [name, cfg] of Object.entries(ENEMY_BEHAVIORS)) {
      if (minutes < cfg.unlockMinute) continue;
      if (!cfg.appliesTo.includes(typeName)) continue;

      const minutesPastUnlock = minutes - cfg.unlockMinute;
      const chance = Math.min(cfg.maxChance, cfg.initialChance + cfg.chancePerMinute * minutesPastUnlock);
      candidates.push({ name, chance });
    }

    // Roll against each candidate (first match wins — order is deterministic from Object.entries)
    for (const { name, chance } of candidates) {
      if (Math.random() < chance) return name;
    }

    return null;
  }

  spawnBoss() {
    // Limit simultaneous bosses — early game: almost never overlap, late game: more likely
    const activeBosses = this.enemies.filter(e => !e.dead && e.isBoss && e.sprite.active);
    if (activeBosses.length >= (BOSS.MAX_SIMULTANEOUS || 1)) return null;
    if (activeBosses.length > 0) {
      const minutes = this.elapsedMinutes;
      const startMin = DIFFICULTY.BOSS_OVERLAP_START_MIN || 3;
      if (minutes < startMin) return null; // no overlap in early game
      const overlapChance = Math.min(
        DIFFICULTY.BOSS_OVERLAP_CHANCE_MAX,
        (minutes - startMin) * DIFFICULTY.BOSS_OVERLAP_CHANCE_PER_MIN
      );
      if (Math.random() > overlapChance) return null; // roll failed, skip spawn
    }

    this.bossesSpawned++;
    // Spawn boss just barely off-screen so it appears almost immediately
    const pos = this.getSpawnPosition(20 * PX);

    // Boss escalation: each successive boss is harder across all dimensions
    const bossNum = this.bossesSpawned;
    const n = bossNum - 1; // 0-indexed for scaling
    const scaledBossStats = {
      health: BOSS.health + DIFFICULTY.BOSS_HEALTH_PER_SPAWN * n,
      speed: BOSS.speed + DIFFICULTY.BOSS_SPEED_PER_SPAWN * n,
      damage: Math.max(BOSS.damage, Math.floor(BOSS.damage * this.getStatScale(DIFFICULTY.DAMAGE_SCALE_RATE, DIFFICULTY.DAMAGE_SCALE_MAX))),
      chargeCooldown: Math.max(
        DIFFICULTY.BOSS_CHARGE_CD_MIN,
        BOSS.CHARGE_COOLDOWN - DIFFICULTY.BOSS_CHARGE_CD_REDUCTION * n
      ),
      chargeSpeed: Math.min(
        DIFFICULTY.BOSS_CHARGE_SPEED_MAX,
        BOSS.CHARGE_SPEED + DIFFICULTY.BOSS_CHARGE_SPEED_INCREASE * n
      ),
      approachSpeedMult: Math.min(
        DIFFICULTY.BOSS_APPROACH_SPEED_MAX,
        (BOSS.CHARGE_APPROACH_SPEED || 1.8) + DIFFICULTY.BOSS_APPROACH_SPEED_INCREASE * n
      ),
      chargeMinRange: Math.max(
        DIFFICULTY.BOSS_MIN_RANGE_MIN,
        BOSS.CHARGE_MIN_RANGE - DIFFICULTY.BOSS_MIN_RANGE_REDUCTION * n
      ),
    };

    const enemy = new Enemy(this.scene, pos.x, pos.y, 'COPILOT', true, scaledBossStats);
    this.enemies.push(enemy);
    eventBus.emit(Events.BOSS_SPAWN, { x: pos.x, y: pos.y });

    // Spawn escort enemies — count scales with boss number
    const escortCount = Math.min(
      DIFFICULTY.BOSS_ESCORT_MAX,
      (BOSS.ESCORT_COUNT || 4) + DIFFICULTY.BOSS_ESCORT_INCREASE * n
    );
    const spread = BOSS.ESCORT_SPREAD || 80;
    for (let i = 0; i < escortCount; i++) {
      const angle = (Math.PI * 2 * i) / escortCount + (Math.random() - 0.5) * 0.5;
      const dist = spread * PX * (0.6 + Math.random() * 0.4);
      const ex = pos.x + Math.cos(angle) * dist;
      const ey = pos.y + Math.sin(angle) * dist;
      const escortType = this.pickEnemyType();
      const escortStats = this.getScaledEnemyStats(escortType);
      const escort = new Enemy(this.scene, ex, ey, escortType, false, escortStats);
      this.enemies.push(escort);
    }

    return enemy;
  }

  /**
   * Calculate scaled stats for a regular enemy based on elapsed time.
   */
  getScaledEnemyStats(typeName) {
    const base = ENEMY_TYPES[typeName];
    const healthMult = this.getStatScale(DIFFICULTY.HEALTH_SCALE_RATE, DIFFICULTY.HEALTH_SCALE_MAX);
    const speedMult = this.getStatScale(DIFFICULTY.SPEED_SCALE_RATE, DIFFICULTY.SPEED_SCALE_MAX);
    const damageMult = this.getStatScale(DIFFICULTY.DAMAGE_SCALE_RATE, DIFFICULTY.DAMAGE_SCALE_MAX);

    // Per-enemy speed variance (adds unpredictability)
    const varianceRange = Math.min(
      DIFFICULTY.SPEED_VARIANCE_MAX,
      DIFFICULTY.SPEED_VARIANCE_RATE * this.elapsedMinutes
    );
    const speedVariance = 1 + (Math.random() * 2 - 1) * varianceRange;

    // Randomize HP for copilots and PRs between their base values
    let baseHealth = base.health;
    if (typeName === 'COPILOT' || typeName === 'PR') {
      const lo = ENEMY_TYPES.COPILOT.health;
      const hi = ENEMY_TYPES.PR.health;
      baseHealth = lo + Math.floor(Math.random() * (hi - lo + 1));
    }

    return {
      health: Math.max(1, Math.round(baseHealth * healthMult)),
      speed: base.speed * speedMult * speedVariance,
      damage: Math.max(1, Math.round(base.damage * damageMult)),
    };
  }

  pickEnemyType() {
    // Weighted random: more copilots early, mix in PRs and suggestions later
    const r = Math.random();
    const waveBonus = Math.min(this.waveNumber * 0.02, 0.4);

    if (r < 0.72 - waveBonus * 0.5) return 'COPILOT';
    if (r < 0.90 - waveBonus * 0.3) return 'PR';
    return 'SUGGESTION';
  }

  getSpawnPosition(marginOverride) {
    // Spawn just outside the visible camera rect
    const cam = this.scene.cameras.main;
    const camX = cam.scrollX;
    const camY = cam.scrollY;
    const margin = marginOverride !== undefined ? marginOverride : ARENA.SPAWN_MARGIN;

    const side = Math.floor(Math.random() * 4);
    let x, y;

    switch (side) {
      case 0: // Top
        x = camX + Math.random() * GAME.WIDTH;
        y = camY - margin;
        break;
      case 1: // Right
        x = camX + GAME.WIDTH + margin;
        y = camY + Math.random() * GAME.HEIGHT;
        break;
      case 2: // Bottom
        x = camX + Math.random() * GAME.WIDTH;
        y = camY + GAME.HEIGHT + margin;
        break;
      case 3: // Left
        x = camX - margin;
        y = camY + Math.random() * GAME.HEIGHT;
        break;
    }

    // Clamp to arena bounds (with margin)
    x = Phaser.Math.Clamp(x, -margin, ARENA.WIDTH + margin);
    y = Phaser.Math.Clamp(y, -margin, ARENA.HEIGHT + margin);

    return { x, y };
  }

  update(playerX, playerY, delta) {
    // Track elapsed time for difficulty scaling
    this.elapsed += delta;

    // Catch-up spawning if enemy count drops too low
    this.tickCatchup(delta);

    // Find active bosses for rally mechanic
    let hasBoss = false;
    let bossX = 0, bossY = 0;
    for (const enemy of this.enemies) {
      if (!enemy.dead && enemy.isBoss && enemy.sprite.active) {
        hasBoss = true;
        bossX = enemy.sprite.x;
        bossY = enemy.sprite.y;
        break;
      }
    }

    // Update all living enemies
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (enemy.dead || !enemy.sprite.active) {
        this.enemies.splice(i, 1);
        continue;
      }

      // Rally mechanic: non-boss enemies near a boss get enraged
      if (hasBoss && !enemy.isBoss) {
        const dx = enemy.sprite.x - bossX;
        const dy = enemy.sprite.y - bossY;
        const distToBoss = dx * dx + dy * dy;
        const rallyRange = BOSS.RALLY_RANGE;
        enemy.rallied = distToBoss < rallyRange * rallyRange;
      } else if (!hasBoss && enemy.rallied) {
        enemy.rallied = false;
      }

      enemy.update(playerX, playerY, delta);
    }
  }

  /**
   * Spawn child enemies when a splitter dies.
   */
  spawnSplitChildren(x, y, count, speedMult, healthMult) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const spread = 20;
      const cx = x + Math.cos(angle) * spread;
      const cy = y + Math.sin(angle) * spread;

      const baseStats = this.getScaledEnemyStats('COPILOT');
      const childStats = {
        health: Math.max(1, Math.round(baseStats.health * healthMult)),
        speed: baseStats.speed * speedMult,
        damage: baseStats.damage,
      };

      const child = new Enemy(this.scene, cx, cy, 'COPILOT', false, childStats);
      this.enemies.push(child);
    }
  }

  getActiveEnemies() {
    return this.enemies.filter(e => !e.dead && e.sprite.active);
  }

  destroy() {
    if (this.spawnTimer) this.spawnTimer.destroy();
    if (this.bossTimer) this.bossTimer.destroy();
    this.enemies.forEach(e => {
      if (e.sprite && e.sprite.active) e.sprite.destroy();
    });
    this.enemies = [];
  }
}
