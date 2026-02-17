import { WEAPONS, POWERUP_TYPES, PLAYER, PX, PIXEL_SCALE } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';
import { Projectile } from '../entities/Projectile.js';
import { Laser } from '../entities/Laser.js';
import { HomingMissile } from '../entities/HomingMissile.js';
import { Mine } from '../entities/Mine.js';
import { playAttackSfx, playLaserSfx, playMissileSfx, playMineDropSfx } from '../audio/AudioBridge.js';
import { renderPixelArt } from '../core/PixelRenderer.js';
import { LINTER_ORB } from '../sprites/projectiles.js';
import { PALETTE } from '../sprites/palette.js';

export class WeaponSystem {
  constructor(scene) {
    this.scene = scene;
    this.projectiles = [];
    this.lasers = [];
    this.missiles = [];
    this.mines = [];
    this.lastFireTime = 0;
    this.lastLaserTime = 0;
    this.lastMissileTime = 0;
    this.lastMineTime = 0;

    // Clone weapon stats so upgrades modify a local copy
    this.stats = { ...WEAPONS.AUTO_ATTACK };
    this.stats.projectileCount = 1;

    // Weapon unlock flags (set by upgrade apply functions)
    this.homingUnlocked = false;
    this.guidedUnlocked = true; // guided laser is always active
    this.tripleUnlocked = false;
    this.minesUnlocked = false;

    // Power-up state
    this.linterActive = false;
    this.linterOrbiters = [];
    this.linterTimer = null;
    this.shieldTimer = null;
  }

  update(playerX, playerY, playerFacingX, playerFacingY, enemies, time, playerVx, playerVy) {
    const now = time;

    // Auto-attack: find nearest enemy in range (prefer those in front of ship)
    if (now - this.lastFireTime >= this.stats.cooldown) {
      const target = this.findNearestEnemy(playerX, playerY, playerFacingX, playerFacingY, enemies);
      if (target) {
        this.fireAt(playerX, playerY, target);
        this.lastFireTime = now;
      }
    }

    // Homing missiles: auto-fire at nearest enemy
    if (this.homingUnlocked && now - this.lastMissileTime >= WEAPONS.HOMING_MISSILE.cooldown) {
      const target = this.findNearestEnemy(playerX, playerY, playerFacingX, playerFacingY, enemies);
      if (target) {
        this.fireHomingMissile(playerX, playerY, target, enemies);
        this.lastMissileTime = now;
      }
    }

    // Mines: auto-drop if moving fast enough
    if (this.minesUnlocked && now - this.lastMineTime >= WEAPONS.MINE.cooldown) {
      const speed = Math.sqrt(playerVx * playerVx + playerVy * playerVy);
      if (speed >= WEAPONS.MINE.minSpeed) {
        this.dropMine(playerX, playerY, enemies);
        this.lastMineTime = now;
      }
    }

    // Update homing missiles
    for (const missile of this.missiles) {
      if (!missile.dead) missile.update(this.scene.game.loop.delta);
    }

    // Update mines
    for (const mine of this.mines) {
      if (!mine.dead) mine.update();
    }

    // Update linter orbiters
    if (this.linterActive) {
      this.updateLinterOrbiters(playerX, playerY, time, enemies);
    }

    // Clean up dead projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      if (this.projectiles[i].dead || !this.projectiles[i].sprite.active) {
        this.projectiles.splice(i, 1);
      }
    }

    // Clean up dead lasers
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      if (this.lasers[i].dead || !this.lasers[i].sprite.active) {
        this.lasers.splice(i, 1);
      }
    }

    // Clean up dead missiles
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      if (this.missiles[i].dead || !this.missiles[i].sprite.active) {
        this.missiles.splice(i, 1);
      }
    }

    // Clean up dead mines
    for (let i = this.mines.length - 1; i >= 0; i--) {
      if (this.mines[i].dead || !this.mines[i].sprite.active) {
        this.mines.splice(i, 1);
      }
    }
  }

  /**
   * Fire a manual laser in the ship's facing direction.
   * If guided laser is unlocked, steer toward nearest enemy.
   * If triple shot is unlocked, fire 3 in a narrow cone.
   * Returns true if fired, false if on cooldown.
   */
  fireLaser(playerX, playerY, facingX, facingY, time, enemies) {
    const now = time;
    if (now - this.lastLaserTime < WEAPONS.LASER.cooldown) return false;
    this.lastLaserTime = now;

    playLaserSfx();

    if (this.tripleUnlocked) {
      // Triple shot: 3 lasers in a narrow cone
      const baseAngle = Math.atan2(facingY, facingX);
      const spread = 0.15; // radians between each laser
      for (let i = -1; i <= 1; i++) {
        const a = baseAngle + i * spread;
        let fx = Math.cos(a);
        let fy = Math.sin(a);

        // Only guide the center shot
        if (i === 0 && this.guidedUnlocked && enemies) {
          const guided = this._getGuidedDirection(playerX, playerY, fx, fy, enemies);
          fx = guided.fx;
          fy = guided.fy;
        }

        const laser = new Laser(this.scene, playerX, playerY, fx, fy);
        this.lasers.push(laser);
      }
    } else {
      let fx = facingX;
      let fy = facingY;

      // Guided laser: steer toward nearest enemy
      if (this.guidedUnlocked && enemies) {
        const guided = this._getGuidedDirection(playerX, playerY, fx, fy, enemies);
        fx = guided.fx;
        fy = guided.fy;
      }

      const laser = new Laser(this.scene, playerX, playerY, fx, fy);
      this.lasers.push(laser);
    }

    return true;
  }

  /** Compute guided direction: steer toward nearest enemy within a generous cone */
  _getGuidedDirection(px, py, facingX, facingY, enemies) {
    const facingAngle = Math.atan2(facingY, facingX);
    let bestScore = Infinity;
    let bestEnemy = null;
    const guidedRange = this.stats.range * 1.5; // slightly longer than auto-attack range
    const guidedCone = Math.PI * 0.6; // ~108 degree cone (generous)

    for (const enemy of enemies) {
      if (enemy.dead) continue;
      const dx = enemy.sprite.x - px;
      const dy = enemy.sprite.y - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > guidedRange) continue;

      const enemyAngle = Math.atan2(dy, dx);
      let angleDiff = Math.abs(enemyAngle - facingAngle);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

      if (angleDiff <= guidedCone) {
        const score = dist * (1 + angleDiff); // prefer closer + more aligned
        if (score < bestScore) {
          bestScore = score;
          bestEnemy = enemy;
        }
      }
    }

    if (bestEnemy) {
      const dx = bestEnemy.sprite.x - px;
      const dy = bestEnemy.sprite.y - py;
      const len = Math.sqrt(dx * dx + dy * dy);
      return { fx: dx / len, fy: dy / len };
    }

    return { fx: facingX, fy: facingY };
  }

  fireHomingMissile(px, py, target, enemies) {
    playMissileSfx();
    const missile = new HomingMissile(this.scene, px, py, target, enemies);
    this.missiles.push(missile);
  }

  dropMine(px, py, enemies) {
    playMineDropSfx();
    const mine = new Mine(this.scene, px, py, enemies);
    this.mines.push(mine);
  }

  findNearestEnemy(px, py, facingX, facingY, enemies) {
    let nearest = null;
    let bestScore = this.stats.range;

    const facingAngle = Math.atan2(facingY, facingX);

    for (const enemy of enemies) {
      if (enemy.dead) continue;
      const dx = enemy.sprite.x - px;
      const dy = enemy.sprite.y - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= this.stats.range) continue;

      // Check if enemy is within the aim cone
      const enemyAngle = Math.atan2(dy, dx);
      let angleDiff = Math.abs(enemyAngle - facingAngle);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

      // Enemies in cone score as closer (preference weighting)
      const score = angleDiff <= PLAYER.AIM_CONE_HALF ? dist * PLAYER.AIM_CONE_WEIGHT : dist;

      if (score < bestScore) {
        bestScore = score;
        nearest = enemy;
      }
    }

    return nearest;
  }

  fireAt(px, py, target) {
    playAttackSfx();
    const dx = target.sprite.x - px;
    const dy = target.sprite.y - py;
    const count = this.stats.projectileCount || 1;

    if (count === 1) {
      this.createProjectile(px, py, dx, dy);
    } else {
      // Spread projectiles in a fan
      const baseAngle = Math.atan2(dy, dx);
      const spreadAngle = 0.2; // radians between each projectile
      const startAngle = baseAngle - (spreadAngle * (count - 1)) / 2;

      for (let i = 0; i < count; i++) {
        const angle = startAngle + spreadAngle * i;
        this.createProjectile(px, py, Math.cos(angle), Math.sin(angle));
      }
    }
  }

  createProjectile(px, py, dx, dy) {
    const proj = new Projectile(this.scene, px, py, dx, dy, this.stats);
    this.projectiles.push(proj);
    return proj;
  }

  // Code Review blast: damages all enemies in radius
  activateCodeReview(px, py, enemies) {
    const cfg = POWERUP_TYPES.CODE_REVIEW;

    // Visual blast effect -- expanding ring + fill (position at center, draw at 0,0)
    const blast = this.scene.add.graphics();
    blast.setPosition(px, py);
    blast.fillStyle(cfg.color, 0.25);
    blast.fillCircle(0, 0, cfg.blastRadius);
    blast.lineStyle(4 * PX, cfg.color, 0.9);
    blast.strokeCircle(0, 0, cfg.blastRadius);
    // Inner ring
    blast.lineStyle(2 * PX, 0xffffff, 0.4);
    blast.strokeCircle(0, 0, cfg.blastRadius * 0.6);

    this.scene.tweens.add({
      targets: blast,
      alpha: 0,
      scaleX: 1.8,
      scaleY: 1.8,
      duration: 500,
      ease: 'Quad.easeOut',
      onComplete: () => blast.destroy(),
    });

    // Camera flash for impact
    this.scene.cameras.main.flash(120, 255, 100, 50);

    // Damage all enemies in range
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      const dx = enemy.sprite.x - px;
      const dy = enemy.sprite.y - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= cfg.blastRadius) {
        enemy.takeDamage(cfg.blastDamage);
      }
    }
  }

  // Linter: spinning orbital projectile
  activateLinter(px, py) {
    const cfg = POWERUP_TYPES.LINTER;

    // Clear existing linter
    this.deactivateLinter();

    this.linterActive = true;
    this.linterStartTime = this.scene.time.now;

    // Create orbital with pixel art
    renderPixelArt(this.scene, LINTER_ORB, PALETTE, 'linter-orb', PIXEL_SCALE);

    const orbiter = this.scene.physics.add.sprite(px, py, 'linter-orb');
    orbiter.setScale(PX);
    orbiter.setDepth(9);
    orbiter.body.setSize(16, 16);
    orbiter.body.setCircle(8);
    orbiter.entityRef = { damage: cfg.orbitDamage, isLinter: true };
    this.linterOrbiters.push(orbiter);

    // Auto-deactivate after duration
    this.linterTimer = this.scene.time.delayedCall(cfg.duration, () => {
      this.deactivateLinter();
    });
  }

  updateLinterOrbiters(px, py, time, enemies) {
    const cfg = POWERUP_TYPES.LINTER;
    const elapsed = time - this.linterStartTime;
    const angle = elapsed * cfg.orbitSpeed;

    for (const orbiter of this.linterOrbiters) {
      if (!orbiter.active) continue;
      orbiter.setPosition(
        px + Math.cos(angle) * cfg.orbitRadius,
        py + Math.sin(angle) * cfg.orbitRadius
      );

      // Check collision with enemies
      for (const enemy of enemies) {
        if (enemy.dead) continue;
        const dx = orbiter.x - enemy.sprite.x;
        const dy = orbiter.y - enemy.sprite.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < enemy.config.width * 0.5 + 8 * PX) {
          enemy.takeDamage(cfg.orbitDamage);
        }
      }
    }
  }

  deactivateLinter() {
    this.linterActive = false;
    if (this.linterTimer) {
      this.linterTimer.destroy();
      this.linterTimer = null;
    }
    this.linterOrbiters.forEach(o => {
      if (o.active) o.destroy();
    });
    this.linterOrbiters = [];
  }

  applyUpgrade(upgrade) {
    if (upgrade.apply) {
      upgrade.apply(this.stats, this);
    }
  }

  getActiveProjectiles() {
    // Includes auto-attack projectiles, manual lasers, and homing missiles
    const active = this.projectiles.filter(p => !p.dead && p.sprite.active);
    const activeLasers = this.lasers.filter(l => !l.dead && l.sprite.active);
    const activeMissiles = this.missiles.filter(m => !m.dead && m.sprite.active);
    return active.concat(activeLasers).concat(activeMissiles);
  }

  destroy() {
    this.deactivateLinter();
    if (this.shieldTimer) this.shieldTimer.destroy();
    this.projectiles.forEach(p => p.destroy());
    this.projectiles = [];
    this.lasers.forEach(l => l.destroy());
    this.lasers = [];
    this.missiles.forEach(m => m.destroy());
    this.missiles = [];
    this.mines.forEach(m => m.destroy());
    this.mines = [];
  }
}
