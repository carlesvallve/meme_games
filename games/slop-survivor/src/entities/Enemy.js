import Phaser from 'phaser';
import { ENEMY_TYPES, BOSS, ENEMY, ARENA, PX, PIXEL_SCALE, ENEMY_BEHAVIORS, ELITE } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';
import { InvaderGenerator, INVADER_PALETTES } from '../sprites/InvaderGenerator.js';

// Map enemy types to invader palettes
const TYPE_PALETTES = {
  COPILOT: INVADER_PALETTES.GREEN,
  PR: INVADER_PALETTES.ORANGE,
  SUGGESTION: INVADER_PALETTES.PURPLE,
  BOSS: INVADER_PALETTES.RED,
};

// Boss palette pool — random color each spawn for variety
const BOSS_PALETTE_POOL = [
  INVADER_PALETTES.RED,
  INVADER_PALETTES.ORANGE,
  INVADER_PALETTES.PURPLE,
  INVADER_PALETTES.CYAN,
  INVADER_PALETTES.MAGENTA,
  INVADER_PALETTES.YELLOW,
  INVADER_PALETTES.WHITE,
];

// Per-type generation options: small critters are simple, bosses are large and complex
const TYPE_GEN_OPTIONS = {
  COPILOT: { rows: 5, halfW: 2 },                          // 5×5
  PR: { rows: 6, halfW: 3, shading: true },                // 6×7
  SUGGESTION: { rows: 7, halfW: 3, shading: true },        // 7×7
  BOSS: { rows: 9, halfW: 4, shading: true },              // 9×9
};

// Global counter for unique seeds — each enemy gets a distinct sprite
let _invaderSeedCounter = 0;

// Boss AI phases
const BOSS_PHASE = {
  CHASE: 'chase',        // standard pursuit
  TELEGRAPH: 'telegraph', // building charge power (flashing, growing)
  APPROACH: 'approach',   // fully charged, closing distance to min charge range
  CHARGE: 'charge',       // bull-rush in locked direction through player
  ORBIT: 'orbit',         // circle-strafe around the player
};

// Dasher phases (for behavior variant)
const DASHER_PHASE = {
  CHASE: 'chase',
  TELEGRAPH: 'telegraph',
  DASH: 'dash',
  COOLDOWN: 'cooldown',
};

export class Enemy {
  /**
   * @param {Phaser.Scene} scene
   * @param {number} x
   * @param {number} y
   * @param {string} typeName
   * @param {boolean} isBoss
   * @param {object} [scaledStats] - Optional difficulty-scaled overrides { health, speed, damage, chargeCooldown, chargeDuration }
   */
  constructor(scene, x, y, typeName, isBoss = false, scaledStats = null) {
    this.scene = scene;
    this.typeName = typeName;
    this.isBoss = isBoss;
    this.isElite = !!(scaledStats && scaledStats.isElite);

    const config = isBoss ? BOSS : ENEMY_TYPES[typeName];
    this.config = config;

    // Apply difficulty-scaled stats if provided, otherwise use base config
    this.health = scaledStats ? scaledStats.health : config.health;
    this.maxHealth = this.health;
    this.damage = scaledStats ? scaledStats.damage : config.damage;
    this.speed = scaledStats ? scaledStats.speed : config.speed;
    this.scoreValue = this.isElite ? config.score * ELITE.SCORE_MULT : config.score;
    this.xpDrop = this.isElite ? config.xpDrop * ELITE.XP_MULT : config.xpDrop;
    this.dead = false;

    // Behavior variant (set by WaveSystem after construction)
    this.behavior = null;

    // Zigzag state for PR type
    this.spawnTime = scene.time.now;

    // Wander state for proximity tracking
    this.wanderAngle = Math.random() * Math.PI * 2;
    this.wanderTimer = 0;
    this.isChasing = false;

    // Rally state (set by nearby boss)
    this.rallied = false;

    // Boss AI state
    if (isBoss) {
      this.bossPhase = BOSS_PHASE.CHASE;
      this.bossPhaseTimer = 0;
      const chargeCd = scaledStats?.chargeCooldown || BOSS.CHARGE_COOLDOWN;
      this.bossChargeCooldown = chargeCd * 0.5;
      this.bossChargeCooldownBase = chargeCd;
      this.bossChargeSpeed = scaledStats?.chargeSpeed || BOSS.CHARGE_SPEED;
      this.bossApproachSpeedMult = scaledStats?.approachSpeedMult || BOSS.CHARGE_APPROACH_SPEED || 1.8;
      this.bossChargeMinRange = scaledStats?.chargeMinRange || BOSS.CHARGE_MIN_RANGE;
      this.isCharging = false; // true during CHARGE phase — for extra knockback
      this.chargeTargetX = 0;
      this.chargeTargetY = 0;
      this.orbitAngle = 0;
      this.orbitTimer = 0;
      this.telegraphGfx = scene.add.graphics();
      this.telegraphGfx.setDepth(4);
      this.telegraphGfx.setAlpha(0);
    }

    // Generate unique procedural invader sprite
    const seed = _invaderSeedCounter++;
    const texKey = `invader-${typeName}-${this.isElite ? 'elite-' : ''}${seed}`;
    const animKey = `${texKey}-anim`;
    const palette = isBoss
      ? Phaser.Utils.Array.GetRandom(BOSS_PALETTE_POOL)
      : (TYPE_PALETTES[typeName] || INVADER_PALETTES.GREEN);
    // Store boss body color for lighting
    if (isBoss) this.bossBodyColor = palette[1];
    const genOpts = isBoss ? TYPE_GEN_OPTIONS.BOSS : (TYPE_GEN_OPTIONS[typeName] || {});

    const gen = new InvaderGenerator(seed * 7 + typeName.length * 31);
    const { frame1, frame2, width: gridW, height: gridH } = gen.generate(genOpts);

    // Consistent pixel size: every grid cell renders as PX×PX on canvas (matches COPILOT)
    // sprScale then sizes the sprite to config.width
    const scale = PX;
    const frameW = gridW * scale;
    const frameH = gridH * scale;

    if (!scene.textures.exists(texKey)) {
      const canvasTex = scene.textures.createCanvas(texKey, frameW * 2, frameH);
      const ctx = canvasTex.getContext();

      [frame1, frame2].forEach((pixels, fi) => {
        const offsetX = fi * frameW;
        for (let py = 0; py < gridH; py++) {
          for (let px = 0; px < gridW; px++) {
            const val = pixels[py][px];
            if (val === 0) continue;
            const color = palette[val] || palette[1];
            const r = (color >> 16) & 0xff;
            const g = (color >> 8) & 0xff;
            const b = color & 0xff;
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(offsetX + px * scale, py * scale, scale, scale);
          }
        }
      });

      canvasTex.refresh();
      const tex = scene.textures.get(texKey);
      tex.add(0, 0, 0, 0, frameW, frameH);
      tex.add(1, 0, frameW, 0, frameW, frameH);
    }

    if (!scene.anims.exists(animKey)) {
      scene.anims.create({
        key: animKey,
        frames: scene.anims.generateFrameNumbers(texKey, { start: 0, end: 1 }),
        frameRate: 4,
        repeat: -1,
      });
    }

    this.sprite = scene.physics.add.sprite(x, y, texKey, 0);
    const renderedW = gridW * scale;
    const sizeMult = this.isElite ? ELITE.SIZE_MULT : 1;
    const sprScale = (config.width * sizeMult) / renderedW;
    this.spriteScale = sprScale;
    this.sprite.setScale(sprScale);
    this.sprite.play(animKey);
    this.sprite.setDepth(isBoss ? 6 : 5);

    this.sprite.body.setSize(renderedW * 0.8, gridH * scale * 0.8);
    this.sprite.entityRef = this;

    // Glowing eyes + trail particles for elites and bosses
    this._eliteEyeGfx = null;
    this._eliteTrailTimer = 0;
    this._eyeColor = 0; // 0 = no eyes
    if (this.isElite || isBoss) {
      this._eliteEyeGfx = scene.add.graphics();
      this._eliteEyeGfx.setDepth(isBoss ? 7 : 6);

      // If boss body color is near red, use white eyes for contrast
      const useWhiteEyes = isBoss && this.bossBodyColor && (() => {
        const r = (this.bossBodyColor >> 16) & 0xff;
        const g = (this.bossBodyColor >> 8) & 0xff;
        const b = this.bossBodyColor & 0xff;
        return r > 180 && g < 120 && b < 120;
      })();

      if (useWhiteEyes) {
        this._eyeColor = 0xffffff;
        this._eyeGlowColor = 0xcccccc;
        this._eyeCenterColor = 0xffffff;
        this._trailColors = [0xffffff, 0xdddddd, 0xeeeeee, 0xcccccc];
      } else {
        this._eyeColor = 0xff2222;
        this._eyeGlowColor = 0xff0000;
        this._eyeCenterColor = 0xffdddd;
        this._trailColors = [0xff4444, 0xff6622, 0xff2222, 0xffaa33];
      }
    }

    // Health bar for tanky enemies and all elites
    if (this.maxHealth > 2 || isBoss || this.isElite) {
      this.healthBar = scene.add.graphics();
      this.healthBar.setDepth(15);
      this.updateHealthBar();
    }
  }

  /**
   * Apply a behavior variant to this enemy. Called by WaveSystem after construction.
   */
  setBehavior(behaviorName) {
    this.behavior = behaviorName;
    const cfg = ENEMY_BEHAVIORS[behaviorName];
    if (!cfg) return;

    switch (behaviorName) {
      case 'DASHER':
        this._dasherPhase = DASHER_PHASE.CHASE;
        this._dasherCooldown = cfg.dashCooldown * (0.5 + Math.random() * 0.5); // stagger initial
        this._dasherTimer = 0;
        this._dasherTargetX = 0;
        this._dasherTargetY = 0;
        // Visual indicator: slight red tint
        this.sprite.setTint(0xffcccc);
        break;

      case 'SHOOTER':
        this._shootCooldown = cfg.fireCooldown * (0.3 + Math.random() * 0.7); // stagger
        this._shootTelegraphing = false;
        this._shootTelegraphTimer = 0;
        // Visual indicator: orange glow outline
        break;

      case 'SPLITTER':
        // No special state needed — handled on death
        // Visual indicator: pulsing scale
        this.scene.tweens.add({
          targets: this.sprite,
          scaleX: this.spriteScale * 1.1,
          scaleY: this.spriteScale * 1.1,
          duration: 800,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
        break;

      case 'MINE_LAYER':
        this._mineCooldown = cfg.mineCooldown * (0.3 + Math.random() * 0.7);
        // Visual indicator: pinkish tint
        this.sprite.setTint(0xffccdd);
        break;
    }
  }

  updateHealthBar() {
    if (!this.healthBar) return;
    this.healthBar.clear();
    const barW = this.config.width * 0.8;
    const barH = 4 * PX;
    const x = this.sprite.x;
    const y = this.sprite.y - this.config.height / 2 - 8 * PX;

    this.healthBar.fillStyle(0x333333, 0.8);
    this.healthBar.fillRect(x - barW / 2, y, barW, barH);

    const ratio = this.health / this.maxHealth;
    const fillColor = ratio > 0.5 ? 0x44ff44 : ratio > 0.25 ? 0xffcc00 : 0xff4444;
    this.healthBar.fillStyle(fillColor, 1);
    this.healthBar.fillRect(x - barW / 2, y, barW * ratio, barH);
  }

  update(playerX, playerY, delta) {
    if (this.dead) return;

    const dx = playerX - this.sprite.x;
    const dy = playerY - this.sprite.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 1) return;

    const dt = (delta || 16.67) / 1000;

    // Boss uses special AI
    if (this.isBoss) {
      this._updateBossAI(playerX, playerY, dx, dy, dist, dt, delta);
    } else if (this.behavior === 'DASHER') {
      this._updateDasherAI(playerX, playerY, dx, dy, dist, dt, delta);
    } else {
      this._updateNormalAI(playerX, playerY, dx, dy, dist, dt);
    }

    // Behavior-specific timers (shooter, mine layer)
    if (this.behavior === 'SHOOTER') {
      this._updateShooterBehavior(playerX, playerY, dist, delta);
    } else if (this.behavior === 'MINE_LAYER') {
      this._updateMineLayerBehavior(delta);
    }

    this._wrapPosition();

    if (this.healthBar) {
      this.updateHealthBar();
    }

    // Glowing eyes + trail (elites and bosses)
    if (this._eliteEyeGfx) {
      this._updateGlowingEyes(delta);
    }
  }

  // ===================== BEHAVIOR: DASHER =====================

  _updateDasherAI(playerX, playerY, dx, dy, dist, dt, delta) {
    const cfg = ENEMY_BEHAVIORS.DASHER;

    switch (this._dasherPhase) {
      case DASHER_PHASE.CHASE: {
        // Normal chase, but count down to dash
        this._updateNormalAI(playerX, playerY, dx, dy, dist, dt);
        this._dasherCooldown -= delta;

        // Only start telegraph when chasing and cooldown is up
        if (this._dasherCooldown <= 0 && this.isChasing && dist < ENEMY.TRACK_RANGE * 1.5) {
          this._dasherPhase = DASHER_PHASE.TELEGRAPH;
          this._dasherTimer = cfg.telegraphDuration;
          this._dasherTargetX = playerX;
          this._dasherTargetY = playerY;
          // Stop moving during telegraph
          this.sprite.body.setVelocity(0, 0);
        }
        break;
      }

      case DASHER_PHASE.TELEGRAPH: {
        // Flash red and grow — warning the player
        this._dasherTimer -= delta;
        this.sprite.body.setVelocity(0, 0);

        const progress = 1 - (this._dasherTimer / cfg.telegraphDuration);
        const flashRate = Math.max(50, 150 - progress * 100);
        if (Math.floor(this.scene.time.now / flashRate) % 2 === 0) {
          this.sprite.setTint(cfg.dashColor);
        } else {
          this.sprite.setTint(0xffcccc);
        }
        this.sprite.setScale(this.spriteScale * (1 + progress * 0.25));

        if (this._dasherTimer <= 0) {
          // Lock target and start dash
          this._dasherTargetX = playerX;
          this._dasherTargetY = playerY;
          this._dasherPhase = DASHER_PHASE.DASH;
          this._dasherTimer = cfg.dashDuration;
          this.sprite.setTint(cfg.dashColor);
        }
        break;
      }

      case DASHER_PHASE.DASH: {
        // Dash toward locked target position at high speed
        this._dasherTimer -= delta;
        const ddx = this._dasherTargetX - this.sprite.x;
        const ddy = this._dasherTargetY - this.sprite.y;
        const ddist = Math.sqrt(ddx * ddx + ddy * ddy);

        if (ddist > 5 * PX && this._dasherTimer > 0) {
          this.sprite.body.setVelocity(
            (ddx / ddist) * cfg.dashSpeed,
            (ddy / ddist) * cfg.dashSpeed
          );
        } else {
          // Dash ended
          this._dasherPhase = DASHER_PHASE.COOLDOWN;
          this._dasherCooldown = cfg.dashCooldown;
          this.sprite.body.setVelocity(0, 0);
          this.sprite.setTint(0xffcccc);
          this.sprite.setScale(this.spriteScale);
        }
        break;
      }

      case DASHER_PHASE.COOLDOWN: {
        // Brief stun after dash, then back to chase
        this._dasherCooldown -= delta;
        // Slow recovery movement
        const recoverySpeed = this.speed * 0.3;
        const rvx = (dx / dist) * recoverySpeed;
        const rvy = (dy / dist) * recoverySpeed;
        this.sprite.body.setVelocity(rvx, rvy);

        if (this._dasherCooldown <= 0) {
          this._dasherPhase = DASHER_PHASE.CHASE;
          this._dasherCooldown = cfg.dashCooldown;
        }
        break;
      }
    }

    // Flip sprite
    if (this.sprite.body.velocity.x < 0) this.sprite.setFlipX(true);
    else if (this.sprite.body.velocity.x > 0) this.sprite.setFlipX(false);
  }

  // ===================== BEHAVIOR: SHOOTER =====================

  /**
   * Shooter behavior update. Returns fire info when ready to shoot.
   * GameScene polls `enemy.pendingShot` to create EnemyProjectile.
   */
  _updateShooterBehavior(playerX, playerY, dist, delta) {
    const cfg = ENEMY_BEHAVIORS.SHOOTER;
    this.pendingShot = null;

    if (this._shootTelegraphing) {
      this._shootTelegraphTimer -= delta;

      // Visual telegraph: flash orange
      const flashRate = Math.max(40, 120 - (cfg.telegraphDuration - this._shootTelegraphTimer) * 0.1);
      if (Math.floor(this.scene.time.now / flashRate) % 2 === 0) {
        this.sprite.setTint(cfg.projectileColor);
      } else {
        this.sprite.clearTint();
      }

      // Scale up slightly during telegraph
      const progress = 1 - (this._shootTelegraphTimer / cfg.telegraphDuration);
      this.sprite.setScale(this.spriteScale * (1 + progress * 0.15));

      // Slow down while telegraphing
      this.sprite.body.velocity.x *= 0.95;
      this.sprite.body.velocity.y *= 0.95;

      if (this._shootTelegraphTimer <= 0) {
        // Fire!
        this._shootTelegraphing = false;
        this._shootCooldown = cfg.fireCooldown;
        this.sprite.clearTint();
        this.sprite.setScale(this.spriteScale);

        // Signal to GameScene to create projectile
        this.pendingShot = {
          x: this.sprite.x,
          y: this.sprite.y,
          targetX: playerX,
          targetY: playerY,
        };
      }
    } else {
      this._shootCooldown -= delta;

      if (this._shootCooldown <= 0 && dist < cfg.fireRange && this.isChasing) {
        // Start telegraph
        this._shootTelegraphing = true;
        this._shootTelegraphTimer = cfg.telegraphDuration;
      }
    }
  }

  // ===================== BEHAVIOR: MINE LAYER =====================

  /**
   * Mine layer behavior. Sets `enemy.pendingMine` when it's time to drop one.
   */
  _updateMineLayerBehavior(delta) {
    this.pendingMine = null;
    this._mineCooldown -= delta;

    if (this._mineCooldown <= 0 && this.isChasing) {
      this._mineCooldown = ENEMY_BEHAVIORS.MINE_LAYER.mineCooldown;
      this.pendingMine = {
        x: this.sprite.x,
        y: this.sprite.y,
      };
    }
  }

  // ===================== NORMAL AI =====================

  _updateNormalAI(playerX, playerY, dx, dy, dist, dt) {
    let vx, vy;
    const trackRange = this.rallied ? BOSS.RALLY_TRACK_RANGE : ENEMY.TRACK_RANGE;
    const speedMult = this.rallied ? BOSS.RALLY_SPEED_MULT : 1;

    if (dist <= trackRange) {
      this.isChasing = true;
      vx = (dx / dist) * this.speed * speedMult;
      vy = (dy / dist) * this.speed * speedMult;

      // PR type: zigzag movement while chasing
      if (this.typeName === 'PR') {
        const cfg = ENEMY_TYPES.PR;
        const elapsed = this.scene.time.now - this.spawnTime;
        const perpX = -dy / dist;
        const perpY = dx / dist;
        const offset = Math.sin(elapsed * cfg.zigzagFrequency) * cfg.zigzagAmplitude * 0.01;
        vx += perpX * offset * this.speed;
        vy += perpY * offset * this.speed;
      }
    } else {
      this.isChasing = false;
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderAngle = Math.random() * Math.PI * 2;
        this.wanderTimer = 1.5 + Math.random() * 1.5;
      }
      const wanderSpeed = this.speed * ENEMY.WANDER_SPEED_RATIO;
      vx = Math.cos(this.wanderAngle) * wanderSpeed;
      vy = Math.sin(this.wanderAngle) * wanderSpeed;
    }

    if (vx < 0) this.sprite.setFlipX(true);
    else if (vx > 0) this.sprite.setFlipX(false);

    const currentVx = this.sprite.body.velocity.x;
    const currentVy = this.sprite.body.velocity.y;
    const lerpFactor = 0.1;
    this.sprite.body.setVelocity(
      currentVx + (vx - currentVx) * lerpFactor,
      currentVy + (vy - currentVy) * lerpFactor
    );
  }

  _wrapPosition() {
    const margin = this.config.width;
    const x = this.sprite.x;
    const y = this.sprite.y;

    if (x < -margin) this.sprite.x = ARENA.WIDTH + margin;
    else if (x > ARENA.WIDTH + margin) this.sprite.x = -margin;

    if (y < -margin) this.sprite.y = ARENA.HEIGHT + margin;
    else if (y > ARENA.HEIGHT + margin) this.sprite.y = -margin;
  }

  // ===================== BOSS AI =====================

  _updateBossAI(playerX, playerY, dx, dy, dist, dt, delta) {
    this.isChasing = true;
    this.bossChargeCooldown -= delta;

    switch (this.bossPhase) {
      case BOSS_PHASE.CHASE: {
        const vx = (dx / dist) * this.speed;
        const vy = (dy / dist) * this.speed;
        this._applyBossVelocity(vx, vy, 0.08);

        const pulse = 1 + Math.sin(this.scene.time.now * 0.003) * 0.05;
        this.sprite.setScale(this.spriteScale * pulse);

        if (this.bossChargeCooldown <= 0) {
          this._startTelegraph(playerX, playerY);
        }
        break;
      }

      // --- TELEGRAPH: build charge power (stationary, flashing, growing) ---
      case BOSS_PHASE.TELEGRAPH: {
        this.sprite.body.setVelocity(0, 0);
        this.bossPhaseTimer -= delta;

        // Track player so aiming line updates in real-time
        this.chargeTargetX = playerX;
        this.chargeTargetY = playerY;

        const flashRate = Math.max(60, 200 - (BOSS.CHARGE_TELEGRAPH - this.bossPhaseTimer) * 0.15);
        if (Math.floor(this.scene.time.now / flashRate) % 2 === 0) {
          this.sprite.setTint(0xff2222);
        } else {
          this.sprite.clearTint();
        }

        const progress = 1 - (this.bossPhaseTimer / BOSS.CHARGE_TELEGRAPH);
        this.sprite.setScale(this.spriteScale * (1 + progress * 0.3));
        this._drawTelegraphRing(progress);

        if (this.bossPhaseTimer <= 0) {
          // Fully charged — transition to approach
          this.bossPhase = BOSS_PHASE.APPROACH;
          this.sprite.setTint(0xff4444);
        }
        break;
      }

      // --- APPROACH: fully charged, closing distance to min charge range ---
      case BOSS_PHASE.APPROACH: {
        const adx = playerX - this.sprite.x;
        const ady = playerY - this.sprite.y;
        const adist = Math.sqrt(adx * adx + ady * ady);
        const minRange = this.bossChargeMinRange;

        // Track player position in real-time so direction line follows them
        this.chargeTargetX = playerX;
        this.chargeTargetY = playerY;

        // Maintain charged-up visuals (pulsing + telegraph ring with aiming line)
        const pulse = 1 + Math.sin(this.scene.time.now * 0.012) * 0.08;
        this.sprite.setScale(this.spriteScale * 1.3 * pulse);
        this._drawTelegraphRing(1.0);

        if (adist <= minRange) {
          // In range — unleash the charge
          this._startCharge(playerX, playerY);
        } else {
          // Move toward player at boosted speed
          const approachSpeed = this.speed * this.bossApproachSpeedMult;
          const vx = (adx / adist) * approachSpeed;
          const vy = (ady / adist) * approachSpeed;
          this._applyBossVelocity(vx, vy, 0.15);
        }
        break;
      }

      // --- CHARGE: bull-rush in locked direction through player ---
      case BOSS_PHASE.CHARGE: {
        // Check if boss has passed through the target (dot product flips sign)
        const toTargetX = this.chargeTargetX - this.sprite.x;
        const toTargetY = this.chargeTargetY - this.sprite.y;
        const dot = toTargetX * this._chargeDirX + toTargetY * this._chargeDirY;
        if (dot < 0) this._chargePastTarget = true;

        // Stop after overshooting past the target by CHARGE_OVERSHOOT distance
        const pastTargetDist = Math.sqrt(toTargetX * toTargetX + toTargetY * toTargetY);
        const overshoot = BOSS.CHARGE_OVERSHOOT || 150 * PX;
        const shouldStop = this._chargePastTarget && pastTargetDist > overshoot;

        if (!shouldStop) {
          const spd = this.bossChargeSpeed || BOSS.CHARGE_SPEED;
          this.sprite.body.setVelocity(this._chargeDirX * spd, this._chargeDirY * spd);

          // Big charge trail particles — offset behind the boss
          this._chargeTrailTimer = (this._chargeTrailTimer || 0) + delta;
          if (this._chargeTrailTimer >= 20) {
            this._chargeTrailTimer = 0;
            const trailColors = [0xff4444, 0xff6622, 0xffaa00, 0xff2222, 0xffcc00];
            const w = this.config.width;
            // Perpendicular to charge direction for spread
            const perpX = -this._chargeDirY;
            const perpY = this._chargeDirX;
            // Spawn 2-3 particles behind the boss body
            const count = 2 + Math.floor(Math.random() * 2);
            for (let i = 0; i < count; i++) {
              const behind = (0.4 + Math.random() * 0.6) * w; // offset behind
              const spread = (Math.random() - 0.5) * w * 0.8; // lateral spread
              const sx = this.sprite.x - this._chargeDirX * behind + perpX * spread;
              const sy = this.sprite.y - this._chargeDirY * behind + perpY * spread;
              const size = (5 + Math.random() * 8) * PX;
              const color = Phaser.Utils.Array.GetRandom(trailColors);
              const trail = this.scene.add.circle(sx, sy, size, color, 0.9).setDepth(5);
              this.scene.tweens.add({
                targets: trail,
                alpha: 0,
                scale: 0.05,
                duration: 400 + Math.random() * 300,
                ease: 'Quad.easeOut',
                onComplete: () => trail.destroy(),
              });
            }
          }
        } else {
          // Charge complete — slam stop
          this.sprite.body.setVelocity(0, 0);
          this.sprite.clearTint();
          this.sprite.setScale(this.spriteScale);
          this._clearTelegraph();
          this.isCharging = false;

          this.scene.cameras.main.shake(200, 0.01);
          eventBus.emit(Events.BOSS_CHARGE_END);

          this.bossPhase = BOSS_PHASE.ORBIT;
          this.orbitAngle = Math.atan2(
            this.sprite.y - playerY,
            this.sprite.x - playerX
          );
          this.orbitTimer = BOSS.ORBIT_DURATION;
        }
        break;
      }

      case BOSS_PHASE.ORBIT: {
        this.orbitTimer -= delta;
        this.orbitAngle += BOSS.ORBIT_SPEED * dt;

        const targetX = playerX + Math.cos(this.orbitAngle) * BOSS.ORBIT_RADIUS;
        const targetY = playerY + Math.sin(this.orbitAngle) * BOSS.ORBIT_RADIUS;
        const odx = targetX - this.sprite.x;
        const ody = targetY - this.sprite.y;
        const odist = Math.sqrt(odx * odx + ody * ody);

        if (odist > 1) {
          const speed = this.speed * 2.5;
          this._applyBossVelocity((odx / odist) * speed, (ody / odist) * speed, 0.15);
        }

        if (this.orbitTimer <= 0) {
          this.bossPhase = BOSS_PHASE.CHASE;
          // Randomize cooldown ±40% for unpredictable attack rhythm
          const baseCd = this.bossChargeCooldownBase || BOSS.CHARGE_COOLDOWN;
          this.bossChargeCooldown = baseCd * (0.6 + Math.random() * 0.8);
        }
        break;
      }
    }

    if (this.sprite.body.velocity.x < 0) this.sprite.setFlipX(true);
    else if (this.sprite.body.velocity.x > 0) this.sprite.setFlipX(false);
  }

  _applyBossVelocity(vx, vy, lerpFactor) {
    const currentVx = this.sprite.body.velocity.x;
    const currentVy = this.sprite.body.velocity.y;
    this.sprite.body.setVelocity(
      currentVx + (vx - currentVx) * lerpFactor,
      currentVy + (vy - currentVy) * lerpFactor
    );
  }

  _startTelegraph(playerX, playerY) {
    this.bossPhase = BOSS_PHASE.TELEGRAPH;
    this.bossPhaseTimer = BOSS.CHARGE_TELEGRAPH;
    this.chargeTargetX = playerX;
    this.chargeTargetY = playerY;
  }

  _startCharge(playerX, playerY) {
    this.bossPhase = BOSS_PHASE.CHARGE;
    this.chargeTargetX = playerX;
    this.chargeTargetY = playerY;
    this.isCharging = true;
    this._chargeTrailTimer = 0;
    this._chargePastTarget = false;
    // Lock charge direction at start (bull-rush: fixed direction, no homing)
    const dx = playerX - this.sprite.x;
    const dy = playerY - this.sprite.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    this._chargeDirX = dx / dist;
    this._chargeDirY = dy / dist;
    this.sprite.setTint(0xff2222);
    this.sprite.setScale(this.spriteScale * 1.15);
    this._clearTelegraph();

    eventBus.emit(Events.BOSS_CHARGE, { x: this.sprite.x, y: this.sprite.y });
  }

  _drawTelegraphRing(progress) {
    if (!this.telegraphGfx) return;
    this.telegraphGfx.clear();
    this.telegraphGfx.setAlpha(0.3 + progress * 0.5);

    const radius = this.config.width * 0.6 + progress * this.config.width * 0.8;
    this.telegraphGfx.lineStyle(2 * PX, 0xff2222, 0.6 + progress * 0.4);
    this.telegraphGfx.strokeCircle(this.sprite.x, this.sprite.y, radius);

    const angle = Math.atan2(this.chargeTargetY - this.sprite.y, this.chargeTargetX - this.sprite.x);
    const lineLen = radius + 30 * PX * progress;
    this.telegraphGfx.lineStyle(1.5 * PX, 0xff4444, 0.4 + progress * 0.4);
    this.telegraphGfx.lineBetween(
      this.sprite.x, this.sprite.y,
      this.sprite.x + Math.cos(angle) * lineLen,
      this.sprite.y + Math.sin(angle) * lineLen
    );
  }

  _clearTelegraph() {
    if (this.telegraphGfx) {
      this.telegraphGfx.clear();
      this.telegraphGfx.setAlpha(0);
    }
  }

  // ===================== ELITE VISUALS =====================

  _updateGlowingEyes(delta) {
    if (!this._eliteEyeGfx || !this.sprite.active) return;

    const sx = this.sprite.x;
    const sy = this.sprite.y;
    const sizeMult = this.isElite ? ELITE.SIZE_MULT : 1;
    const w = this.config.width * sizeMult;
    const eyeSpacing = w * 0.22;
    const eyeY = sy - w * 0.18;
    const baseEyeSize = Math.max(3 * PX, w * 0.14);

    // Pulsing animation — eyes grow/shrink rhythmically
    const t = this.scene.time.now;
    const breathe = 0.8 + Math.sin(t * 0.006) * 0.2; // slow breathe
    const flicker = 1 + Math.sin(t * 0.025) * 0.08;  // fast subtle flicker
    const eyePulse = breathe * flicker;
    const eyeSize = baseEyeSize * eyePulse;

    const glowMult = this.isBoss ? 2.2 : 2.5;
    const glowSize = eyeSize * glowMult;
    const glowAlpha = this.isBoss ? 0.12 : 0.10;
    const pulse = 0.7 + Math.sin(t * 0.008) * 0.3;

    this._eliteEyeGfx.clear();

    // Large outer glow
    this._eliteEyeGfx.fillStyle(this._eyeGlowColor, glowAlpha * pulse);
    this._eliteEyeGfx.fillCircle(sx - eyeSpacing, eyeY, glowSize);
    this._eliteEyeGfx.fillCircle(sx + eyeSpacing, eyeY, glowSize);

    // Bright eyes
    const eyeAlpha = 0.85 + breathe * 0.15;
    this._eliteEyeGfx.fillStyle(this._eyeColor, eyeAlpha);
    this._eliteEyeGfx.fillCircle(sx - eyeSpacing, eyeY, eyeSize);
    this._eliteEyeGfx.fillCircle(sx + eyeSpacing, eyeY, eyeSize);

    // Hot center
    this._eliteEyeGfx.fillStyle(this._eyeCenterColor, 0.85 * pulse);
    this._eliteEyeGfx.fillCircle(sx - eyeSpacing, eyeY, eyeSize * 0.45);
    this._eliteEyeGfx.fillCircle(sx + eyeSpacing, eyeY, eyeSize * 0.45);

    // Trail particles
    this._eliteTrailTimer += delta;
    if (this._eliteTrailTimer >= 60) {
      this._eliteTrailTimer = 0;
      const trailX = sx + (Math.random() - 0.5) * w * 0.5;
      const trailY = sy + (Math.random() - 0.5) * w * 0.4;
      const trailSize = (2.5 + Math.random() * 3) * PX;
      const trailColor = Phaser.Utils.Array.GetRandom(this._trailColors);
      const trail = this.scene.add.circle(trailX, trailY, trailSize, trailColor, 0.8).setDepth(4);
      this.scene.tweens.add({
        targets: trail,
        alpha: 0,
        scale: 0.15,
        y: trailY - 12 * PX,
        duration: 400 + Math.random() * 250,
        ease: 'Quad.easeOut',
        onComplete: () => trail.destroy(),
      });
    }
  }

  // ===================== DAMAGE & DEATH =====================

  takeDamage(amount) {
    if (this.dead) return false;

    this.health -= amount;
    this.updateHealthBar();

    eventBus.emit(Events.DAMAGE_NUMBER, {
      x: this.sprite.x,
      y: this.sprite.y,
      amount,
      color: this.isBoss ? '#ff6644' : '#ffffff',
    });

    // Flash white + brief scale pop for hit feedback
    this.sprite.setTint(0xffffff);
    this.scene.tweens.add({
      targets: this.sprite,
      scaleX: this.spriteScale * 1.15,
      scaleY: this.spriteScale * 1.15,
      duration: 50,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
    this.scene.time.delayedCall(80, () => {
      if (this.sprite && this.sprite.active && !this.dead) this.sprite.clearTint();
    });

    if (this.health <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.sprite.body.setVelocity(0, 0);
    this._clearTelegraph();
    if (this.isCharging) {
      this.isCharging = false;
      eventBus.emit(Events.BOSS_CHARGE_END);
    }
    if (this.telegraphGfx) {
      this.telegraphGfx.destroy();
      this.telegraphGfx = null;
    }

    gameState.enemiesKilled++;
    gameState.addScore(this.scoreValue);
    eventBus.emit(Events.SCORE_CHANGED, { score: gameState.score });
    eventBus.emit(Events.ENEMY_KILLED, {
      x: this.sprite.x,
      y: this.sprite.y,
      type: this.typeName,
      isBoss: this.isBoss,
      isElite: this.isElite,
      xpDrop: this.xpDrop,
      config: this.config,
      behavior: this.behavior,
    });

    if (this.isBoss) {
      eventBus.emit(Events.BOSS_KILLED, { x: this.sprite.x, y: this.sprite.y });
    }

    // Splitter: emit split event so WaveSystem can spawn children
    if (this.behavior === 'SPLITTER') {
      const cfg = ENEMY_BEHAVIORS.SPLITTER;
      eventBus.emit(Events.ENEMY_SPLIT, {
        x: this.sprite.x,
        y: this.sprite.y,
        count: cfg.splitCount,
        speedMult: cfg.splitSpeedMult,
        healthMult: cfg.splitHealthMult,
        parentType: this.typeName,
      });
    }

    // Clean up elite eye graphics
    if (this._eliteEyeGfx) {
      this._eliteEyeGfx.destroy();
      this._eliteEyeGfx = null;
    }

    // Quick death animation
    this.scene.tweens.add({
      targets: this.sprite,
      alpha: 0,
      scaleX: 0.2,
      scaleY: 0.2,
      duration: 200,
      onComplete: () => {
        this.sprite.destroy();
        if (this.healthBar) this.healthBar.destroy();
      },
    });
  }

  destroy() {
    if (this.healthBar) this.healthBar.destroy();
    if (this.telegraphGfx) this.telegraphGfx.destroy();
    if (this._eliteEyeGfx) this._eliteEyeGfx.destroy();
    if (this.sprite && this.sprite.active) {
      this.sprite.destroy();
    }
  }
}
