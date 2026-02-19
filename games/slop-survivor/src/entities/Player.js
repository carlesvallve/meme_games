import Phaser from 'phaser';
import { PLAYER, CONTROLS_MODE, GAME, ARENA, PX, VFX } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';

const SPRITE_SCALE = PX;

export class Player {
  constructor(scene) {
    this.scene = scene;
    this.invulnerable = false;
    this.invulnTimer = null;
    this.blinkTimer = null;
    this.shieldActive = false;

    // Ship physics state
    this.angle = -Math.PI / 2; // pointing up
    this.vx = 0;
    this.vy = 0;
    this.isThrusting = false;

    // Thruster particle pool
    this.thrusterParticles = [];

    // Create ship sprite (textures pre-rendered in BootScene)
    this.sprite = scene.physics.add.sprite(PLAYER.START_X, PLAYER.START_Y, 'ship-sheet', 0);
    this.sprite.setScale(SPRITE_SCALE);
    this.sprite.body.setSize(20, 20); // slightly smaller hitbox than sprite
    this.sprite.body.setOffset(2, 2);
    this.sprite.body.setCollideWorldBounds(false); // we handle wrapping
    this.sprite.body.setDrag(0);
    this.sprite.setDepth(10);

    // Facing direction for weapon targeting
    this.facingX = 0;
    this.facingY = -1; // pointing up
  }

  update(rotateInput, thrustInput, delta) {
    const dt = delta / 1000; // seconds

    // Rotation
    this.angle += rotateInput * PLAYER.ROTATION_SPEED * dt;

    // Facing direction (unit vector from angle)
    this.facingX = Math.cos(this.angle);
    this.facingY = Math.sin(this.angle);

    // Thrust (forward or reverse)
    this.isThrusting = thrustInput > 0;
    this.isReversing = thrustInput < 0;
    if (this.isThrusting) {
      this.vx += this.facingX * PLAYER.THRUST_FORCE * dt;
      this.vy += this.facingY * PLAYER.THRUST_FORCE * dt;
    } else if (this.isReversing) {
      // Reverse is slower than forward
      const reverseForce = PLAYER.THRUST_FORCE * PLAYER.REVERSE_RATIO;
      this.vx -= this.facingX * reverseForce * dt;
      this.vy -= this.facingY * reverseForce * dt;
    }

    this._applyPhysics(delta);
  }

  /** Direct control mode: ship turns toward input direction and auto-thrusts */
  updateDirect(dirX, dirY, magnitude, delta, turnSpeed) {
    const dt = delta / 1000;
    const tSpeed = turnSpeed || PLAYER.TURN_SPEED;

    if (magnitude > 0.01) {
      // Target angle from input direction
      const targetAngle = Math.atan2(dirY, dirX);

      // Shortest rotation to target
      let rotDiff = targetAngle - this.angle;
      while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
      while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;

      const absDiff = Math.abs(rotDiff);

      // Snap if very close, otherwise turn quickly
      if (absDiff < 0.05) {
        this.angle = targetAngle;
      } else {
        this.angle += Math.sign(rotDiff) * Math.min(absDiff, tSpeed * dt);
      }

      // Facing direction from current angle
      this.facingX = Math.cos(this.angle);
      this.facingY = Math.sin(this.angle);

      // Only thrust when roughly aligned with target (< ~45°)
      // Scale thrust down as angle difference increases
      const alignFactor = Math.max(0, 1 - absDiff / (Math.PI / 3));
      if (alignFactor > 0) {
        this.isThrusting = true;
        this.isReversing = false;
        this.vx += this.facingX * PLAYER.THRUST_FORCE * magnitude * alignFactor * dt;
        this.vy += this.facingY * PLAYER.THRUST_FORCE * magnitude * alignFactor * dt;
      } else {
        this.isThrusting = false;
        this.isReversing = false;
      }
    } else {
      // No input — coast
      this.facingX = Math.cos(this.angle);
      this.facingY = Math.sin(this.angle);
      this.isThrusting = false;
      this.isReversing = false;
    }

    this._applyPhysics(delta);
  }

  /** Shared physics: drag, speed cap, velocity apply, visuals, wrapping, particles */
  _applyPhysics(delta) {
    // Drag (frame-rate independent)
    const dragFactor = Math.pow(PLAYER.DRAG, delta / 16.67);
    this.vx *= dragFactor;
    this.vy *= dragFactor;

    // Speed cap
    const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
    if (speed > PLAYER.MAX_SPEED) {
      const scale = PLAYER.MAX_SPEED / speed;
      this.vx *= scale;
      this.vy *= scale;
    } else if (speed < PLAYER.DEAD_STOP) {
      this.vx = 0;
      this.vy = 0;
    }

    // Apply velocity
    this.sprite.body.setVelocity(this.vx, this.vy);

    // Visual rotation (sprite nose points up, so offset by PI/2)
    this.sprite.setRotation(this.angle + Math.PI / 2);

    // Sprite frame: 0=idle, 1=thrusting
    this.sprite.setFrame(this.isThrusting ? 1 : 0);

    // Screen edge wrapping
    this.wrapPosition();

    // Thruster particles
    if (this.isThrusting) {
      this.emitThrusterParticles();
    }
    this.updateThrusterParticles(delta);
  }

  wrapPosition() {
    const push = PLAYER.WIDTH * 0.5; // push inward after wrapping
    const x = this.sprite.x;
    const y = this.sprite.y;

    if (x < 0) this.sprite.x = ARENA.WIDTH - push;
    else if (x > ARENA.WIDTH) this.sprite.x = push;

    if (y < 0) this.sprite.y = ARENA.HEIGHT - push;
    else if (y > ARENA.HEIGHT) this.sprite.y = push;
  }

  emitThrusterParticles() {
    const cfg = VFX;
    // Emit from behind the ship (opposite of facing direction)
    const ex = this.sprite.x - this.facingX * PLAYER.WIDTH * 0.5;
    const ey = this.sprite.y - this.facingY * PLAYER.HEIGHT * 0.5;

    for (let i = 0; i < cfg.THRUSTER_COUNT; i++) {
      const size = cfg.THRUSTER_SIZE.min + Math.random() * (cfg.THRUSTER_SIZE.max - cfg.THRUSTER_SIZE.min);
      const color = Phaser.Utils.Array.GetRandom(cfg.THRUSTER_COLORS);
      const spread = (Math.random() - 0.5) * 0.8;
      const pVx = (-this.facingX + spread * -this.facingY) * cfg.THRUSTER_SPEED * (0.5 + Math.random());
      const pVy = (-this.facingY + spread * this.facingX) * cfg.THRUSTER_SPEED * (0.5 + Math.random());

      const p = this.scene.add.circle(ex, ey, size, color, 1);
      p.setDepth(9);
      p._vx = pVx + this.vx * 0.3;
      p._vy = pVy + this.vy * 0.3;
      p._life = cfg.THRUSTER_LIFETIME;
      p._maxLife = cfg.THRUSTER_LIFETIME;
      this.thrusterParticles.push(p);
    }
  }

  updateThrusterParticles(delta) {
    const dt = delta / 1000;
    for (let i = this.thrusterParticles.length - 1; i >= 0; i--) {
      const p = this.thrusterParticles[i];
      p._life -= delta;
      if (p._life <= 0) {
        p.destroy();
        this.thrusterParticles.splice(i, 1);
        continue;
      }
      p.x += p._vx * dt;
      p.y += p._vy * dt;
      p.alpha = p._life / p._maxLife;
      p.setScale(p._life / p._maxLife);
    }
  }

  hit(damage = 1) {
    if (this.invulnerable || this.shieldActive || gameState.gameOver) return false;

    const dead = gameState.takeDamage(damage);
    eventBus.emit(Events.PLAYER_HIT, { health: gameState.health, damage });

    // Start invulnerability
    this.invulnerable = true;
    eventBus.emit(Events.PLAYER_INVULNERABLE, { active: true });

    // Blink effect
    this.blinkTimer = this.scene.time.addEvent({
      delay: PLAYER.INVULN_BLINK_RATE,
      callback: () => {
        this.sprite.alpha = this.sprite.alpha < 1 ? 1 : 0.3;
      },
      repeat: Math.floor(PLAYER.INVULN_DURATION / PLAYER.INVULN_BLINK_RATE) - 1,
    });

    // End invulnerability
    this.invulnTimer = this.scene.time.delayedCall(PLAYER.INVULN_DURATION, () => {
      this.invulnerable = false;
      this.sprite.alpha = 1;
      eventBus.emit(Events.PLAYER_INVULNERABLE, { active: false });
    });

    // Flash red tint
    this.sprite.setTint(0xff4444);
    this.scene.time.delayedCall(150, () => {
      if (this.sprite && this.sprite.active) this.sprite.clearTint();
    });

    if (dead) {
      eventBus.emit(Events.PLAYER_DIED);
    }

    return dead;
  }

  setShield(active) {
    this.shieldActive = active;
    if (active) {
      if (!this.shieldGfx) {
        this.shieldGfx = this.scene.add.graphics();
      }
      this.shieldGfx.clear();
      this.shieldGfx.lineStyle(6 * PX, 0xffcc00, 0.15);
      this.shieldGfx.strokeCircle(0, 0, PLAYER.WIDTH * 0.95);
      this.shieldGfx.lineStyle(3 * PX, 0xffcc00, 0.8);
      this.shieldGfx.strokeCircle(0, 0, PLAYER.WIDTH * 0.8);
      this.shieldGfx.lineStyle(1.5 * PX, 0xffe866, 0.4);
      this.shieldGfx.strokeCircle(0, 0, PLAYER.WIDTH * 0.65);
      this.shieldGfx.setDepth(11);
      this._shieldFollow = true;

      if (this._shieldTween) this._shieldTween.stop();
      this._shieldTween = this.scene.tweens.add({
        targets: this.shieldGfx,
        alpha: 0.5,
        duration: 400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    } else {
      this._shieldFollow = false;
      if (this._shieldTween) {
        this._shieldTween.stop();
        this._shieldTween = null;
      }
      if (this.shieldGfx) {
        this.shieldGfx.clear();
        this.shieldGfx.alpha = 1;
      }
    }
  }

  reset() {
    this.sprite.setPosition(PLAYER.START_X, PLAYER.START_Y);
    this.sprite.body.setVelocity(0, 0);
    this.sprite.alpha = 1;
    this.sprite.clearTint();
    this.sprite.setFrame(0);
    this.sprite.setRotation(0);
    this.invulnerable = false;
    this.shieldActive = false;
    this._shieldFollow = false;
    this.angle = -Math.PI / 2;
    this.vx = 0;
    this.vy = 0;
    this.isThrusting = false;
    if (this.invulnTimer) this.invulnTimer.destroy();
    if (this.blinkTimer) this.blinkTimer.destroy();
    if (this._shieldTween) { this._shieldTween.stop(); this._shieldTween = null; }
    if (this.shieldGfx) { this.shieldGfx.clear(); this.shieldGfx.alpha = 1; }
    // Clean up thruster particles
    this.thrusterParticles.forEach(p => p.destroy());
    this.thrusterParticles = [];
  }

  destroy() {
    if (this.invulnTimer) this.invulnTimer.destroy();
    if (this.blinkTimer) this.blinkTimer.destroy();
    if (this._shieldTween) this._shieldTween.stop();
    if (this.shieldGfx) this.shieldGfx.destroy();
    this.thrusterParticles.forEach(p => p.destroy());
    this.thrusterParticles = [];
    this.sprite.destroy();
  }
}
