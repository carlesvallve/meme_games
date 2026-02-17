import Phaser from 'phaser';
import { ENEMY_TYPES, BOSS, ENEMY, ARENA, PX, PIXEL_SCALE } from '../core/Constants.js';
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

// Per-type generation options: small critters are simple, bosses are large and complex
const TYPE_GEN_OPTIONS = {
  COPILOT: { rows: 7, halfW: 3 },                          // 7×7
  PR: { rows: 9, halfW: 4, shading: true },                // 9×9
  SUGGESTION: { rows: 11, halfW: 5, shading: true },       // 11×11
  BOSS: { rows: 13, halfW: 6, shading: true },             // 13×13
};

// Global counter for unique seeds — each enemy gets a distinct sprite
let _invaderSeedCounter = 0;

// Boss AI phases
const BOSS_PHASE = {
  CHASE: 'chase',        // standard pursuit
  TELEGRAPH: 'telegraph', // winding up a charge (flashing, growing)
  CHARGE: 'charge',       // fast dash toward player's last position
  ORBIT: 'orbit',         // circle-strafe around the player
};

export class Enemy {
  constructor(scene, x, y, typeName, isBoss = false) {
    this.scene = scene;
    this.typeName = typeName;
    this.isBoss = isBoss;

    const config = isBoss ? BOSS : ENEMY_TYPES[typeName];
    this.config = config;
    this.health = config.health;
    this.maxHealth = config.health;
    this.damage = config.damage;
    this.speed = config.speed;
    this.scoreValue = config.score;
    this.xpDrop = config.xpDrop;
    this.dead = false;

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
      this.bossChargeCooldown = BOSS.CHARGE_COOLDOWN * 0.5; // first charge comes sooner
      this.chargeTargetX = 0;
      this.chargeTargetY = 0;
      this.orbitAngle = 0;
      this.orbitTimer = 0;
      // Telegraph warning ring
      this.telegraphGfx = scene.add.graphics();
      this.telegraphGfx.setDepth(4);
      this.telegraphGfx.setAlpha(0);
    }

    // Generate unique procedural invader sprite
    const seed = _invaderSeedCounter++;
    const texKey = `invader-${typeName}-${seed}`;
    const animKey = `${texKey}-anim`;
    const palette = TYPE_PALETTES[isBoss ? 'BOSS' : typeName] || INVADER_PALETTES.GREEN;
    const genOpts = isBoss ? TYPE_GEN_OPTIONS.BOSS : (TYPE_GEN_OPTIONS[typeName] || {});

    const gen = new InvaderGenerator(seed * 7 + typeName.length * 31);
    const { frame1, frame2, width: gridW, height: gridH } = gen.generate(genOpts);

    // Render the 2-frame spritesheet
    const scale = PIXEL_SCALE;
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
    // Scale sprite so visual size matches the config width
    const renderedW = gridW * scale;
    const renderedH = gridH * scale;
    const sprScale = config.width / renderedW;
    this.spriteScale = sprScale;
    this.sprite.setScale(sprScale);
    this.sprite.play(animKey);
    this.sprite.setDepth(isBoss ? 6 : 5);

    // Set physics body to match config dimensions
    this.sprite.body.setSize(renderedW * 0.8, renderedH * 0.8);

    // Store reference on the sprite for collision callbacks
    this.sprite.entityRef = this;

    // Health bar for tanky enemies
    if (config.health > 2 || isBoss) {
      this.healthBar = scene.add.graphics();
      this.healthBar.setDepth(15);
      this.updateHealthBar();
    }
  }

  updateHealthBar() {
    if (!this.healthBar) return;
    this.healthBar.clear();
    const barW = this.config.width * 0.8;
    const barH = 4 * PX;
    const x = this.sprite.x;
    const y = this.sprite.y - this.config.height / 2 - 8 * PX;

    // Background
    this.healthBar.fillStyle(0x333333, 0.8);
    this.healthBar.fillRect(x - barW / 2, y, barW, barH);

    // Health fill
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
    } else {
      this._updateNormalAI(playerX, playerY, dx, dy, dist, dt);
    }

    // Wrap at arena edges (same as player)
    this._wrapPosition();

    // Update health bar position
    if (this.healthBar) {
      this.updateHealthBar();
    }
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

  /**
   * Normal enemy AI: wander when far, chase when near.
   */
  _updateNormalAI(playerX, playerY, dx, dy, dist, dt) {
    let vx, vy;
    const trackRange = this.rallied ? BOSS.RALLY_TRACK_RANGE : ENEMY.TRACK_RANGE;
    const speedMult = this.rallied ? BOSS.RALLY_SPEED_MULT : 1;

    if (dist <= trackRange) {
      // Chase mode
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
      // Wander mode
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

    // Flip sprite based on horizontal movement
    if (vx < 0) this.sprite.setFlipX(true);
    else if (vx > 0) this.sprite.setFlipX(false);

    // Smooth transition: lerp toward target velocity
    const currentVx = this.sprite.body.velocity.x;
    const currentVy = this.sprite.body.velocity.y;
    const lerpFactor = 0.1;
    this.sprite.body.setVelocity(
      currentVx + (vx - currentVx) * lerpFactor,
      currentVy + (vy - currentVy) * lerpFactor
    );
  }

  /**
   * Boss AI with distinct phases: chase → telegraph → charge → orbit → repeat
   */
  _updateBossAI(playerX, playerY, dx, dy, dist, dt, delta) {
    this.isChasing = true;
    this.bossChargeCooldown -= delta;

    switch (this.bossPhase) {
      case BOSS_PHASE.CHASE: {
        // Standard pursuit (slower, menacing)
        const vx = (dx / dist) * this.speed;
        const vy = (dy / dist) * this.speed;
        this._applyBossVelocity(vx, vy, 0.08);

        // Pulsing scale for visual presence
        const pulse = 1 + Math.sin(this.scene.time.now * 0.003) * 0.05;
        this.sprite.setScale(this.spriteScale * pulse);

        // Transition to telegraph when cooldown is up
        if (this.bossChargeCooldown <= 0) {
          this._startTelegraph(playerX, playerY);
        }
        break;
      }

      case BOSS_PHASE.TELEGRAPH: {
        // Stop moving, flash red, grow, draw warning
        this.sprite.body.setVelocity(0, 0);
        this.bossPhaseTimer -= delta;

        // Pulsing red flash
        const flashRate = Math.max(60, 200 - (BOSS.CHARGE_TELEGRAPH - this.bossPhaseTimer) * 0.15);
        if (Math.floor(this.scene.time.now / flashRate) % 2 === 0) {
          this.sprite.setTint(0xff2222);
        } else {
          this.sprite.clearTint();
        }

        // Growing scale
        const progress = 1 - (this.bossPhaseTimer / BOSS.CHARGE_TELEGRAPH);
        this.sprite.setScale(this.spriteScale * (1 + progress * 0.3));

        // Telegraph warning ring
        this._drawTelegraphRing(progress);

        if (this.bossPhaseTimer <= 0) {
          this._startCharge(playerX, playerY);
        }
        break;
      }

      case BOSS_PHASE.CHARGE: {
        // Dash toward the locked target position
        this.bossPhaseTimer -= delta;
        const cdx = this.chargeTargetX - this.sprite.x;
        const cdy = this.chargeTargetY - this.sprite.y;
        const cdist = Math.sqrt(cdx * cdx + cdy * cdy);

        if (cdist > 10 * PX && this.bossPhaseTimer > 0) {
          const cvx = (cdx / cdist) * BOSS.CHARGE_SPEED;
          const cvy = (cdy / cdist) * BOSS.CHARGE_SPEED;
          this.sprite.body.setVelocity(cvx, cvy);
        } else {
          // Charge ended — brief pause then orbit
          this.sprite.body.setVelocity(0, 0);
          this.sprite.clearTint();
          this.sprite.setScale(this.spriteScale);
          this._clearTelegraph();

          // Screen shake on charge impact
          this.scene.cameras.main.shake(200, 0.01);

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
        // Circle-strafe around the player
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
          this.bossChargeCooldown = BOSS.CHARGE_COOLDOWN;
        }
        break;
      }
    }

    // Flip sprite
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
    // Lock target position at start of telegraph
    this.chargeTargetX = playerX;
    this.chargeTargetY = playerY;
  }

  _startCharge(playerX, playerY) {
    this.bossPhase = BOSS_PHASE.CHARGE;
    this.bossPhaseTimer = BOSS.CHARGE_DURATION;
    // Update target to latest player position
    this.chargeTargetX = playerX;
    this.chargeTargetY = playerY;
    this.sprite.clearTint();
    this.sprite.setScale(this.spriteScale * 1.1);
    this._clearTelegraph();
  }

  _drawTelegraphRing(progress) {
    if (!this.telegraphGfx) return;
    this.telegraphGfx.clear();
    this.telegraphGfx.setAlpha(0.3 + progress * 0.5);

    // Warning ring expanding outward
    const radius = this.config.width * 0.6 + progress * this.config.width * 0.8;
    this.telegraphGfx.lineStyle(2 * PX, 0xff2222, 0.6 + progress * 0.4);
    this.telegraphGfx.strokeCircle(this.sprite.x, this.sprite.y, radius);

    // Direction line toward charge target
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

  takeDamage(amount) {
    if (this.dead) return false;

    this.health -= amount;
    this.updateHealthBar();

    // Floating damage number
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
      xpDrop: this.xpDrop,
      config: this.config,
    });

    if (this.isBoss) {
      eventBus.emit(Events.BOSS_KILLED, { x: this.sprite.x, y: this.sprite.y });
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
    if (this.sprite && this.sprite.active) {
      this.sprite.destroy();
    }
  }
}
