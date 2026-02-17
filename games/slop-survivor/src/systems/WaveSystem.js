import Phaser from 'phaser';
import { WAVES, ENEMY_TYPES, BOSS, ARENA, GAME, PX } from '../core/Constants.js';
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
  }

  start() {
    this.waveNumber = 0;
    this.spawnRate = WAVES.INITIAL_SPAWN_RATE;
    this.elapsed = 0;
    this.lastBossTime = 0;

    // Start spawning
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
      // Gradually increase difficulty
      this.waveNumber++;
      this.spawnRate = Math.max(
        WAVES.MIN_SPAWN_RATE,
        WAVES.INITIAL_SPAWN_RATE - this.waveNumber * WAVES.SPAWN_RATE_DECREASE
      );
      this.scheduleNextSpawn();
    });
  }

  spawnWave() {
    // Don't exceed max enemies
    const activeCount = this.enemies.filter(e => !e.dead).length;
    if (activeCount >= WAVES.MAX_ENEMIES) return;

    const count = Math.min(
      WAVES.ENEMIES_PER_WAVE,
      WAVES.MAX_ENEMIES - activeCount
    );

    for (let i = 0; i < count; i++) {
      this.spawnEnemy();
    }

    eventBus.emit(Events.WAVE_START, { wave: this.waveNumber });
  }

  spawnEnemy() {
    const pos = this.getSpawnPosition();
    const typeName = this.pickEnemyType();

    const enemy = new Enemy(this.scene, pos.x, pos.y, typeName, false);
    this.enemies.push(enemy);
    return enemy;
  }

  spawnBoss() {
    const pos = this.getSpawnPosition();
    const enemy = new Enemy(this.scene, pos.x, pos.y, 'COPILOT', true);
    this.enemies.push(enemy);
    eventBus.emit(Events.BOSS_SPAWN, { x: pos.x, y: pos.y });
    return enemy;
  }

  pickEnemyType() {
    // Weighted random: more copilots early, mix in PRs and suggestions later
    const r = Math.random();
    const waveBonus = Math.min(this.waveNumber * 0.02, 0.4);

    if (r < 0.6 - waveBonus) return 'COPILOT';
    if (r < 0.85 - waveBonus * 0.5) return 'PR';
    return 'SUGGESTION';
  }

  getSpawnPosition() {
    // Spawn just outside the visible camera rect
    const cam = this.scene.cameras.main;
    const camX = cam.scrollX;
    const camY = cam.scrollY;
    const margin = ARENA.SPAWN_MARGIN;

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
