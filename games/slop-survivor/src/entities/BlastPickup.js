import Phaser from 'phaser';
import { POWERUP_DROP, PX, PIXEL_SCALE, GAME, UI, VFX } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';
import { blastSfx } from '../audio/sfx.js';

/**
 * Instant blast pickup — red glowing orb on the ground.
 * Touching it triggers an immediate area explosion. No UI, no choice.
 */

const BLAST = {
  RADIUS: 180 * PX,
  DAMAGE: 5,
  COLOR: 0xff3333,
  DROP_CHANCE: 0.025,        // 2.5% per kill (separate from powerup tokens)
  MIN_INTERVAL: 12000,       // at least 12s between blast drops
};

export { BLAST as BLAST_CONFIG };

export class BlastPickup {
  constructor(scene, x, y) {
    this.scene = scene;
    this.collected = false;

    const size = POWERUP_DROP.TOKEN_SIZE;

    // Red halo glow
    const haloRadius = size * 1.5;
    this.halo = scene.add.circle(x, y, haloRadius, BLAST.COLOR, 0.15);
    this.halo.setDepth(3);

    // Red orb texture
    const texKey = 'blast-token';
    if (!scene.textures.exists(texKey)) {
      const gfx = scene.add.graphics();
      const r = Math.round(size * 0.5);
      gfx.fillStyle(BLAST.COLOR, 1);
      gfx.fillCircle(r, r, r);
      gfx.fillStyle(0xffffff, 0.5);
      gfx.fillCircle(r, r, r * 0.35);
      gfx.generateTexture(texKey, r * 2, r * 2);
      gfx.destroy();
    }

    this.sprite = scene.physics.add.sprite(x, y, texKey);
    this.sprite.setScale(PIXEL_SCALE * 0.8);
    this.sprite.setDepth(4);
    this.sprite.body.setSize(size * 1.5 / PIXEL_SCALE, size * 1.5 / PIXEL_SCALE);
    this.sprite.entityRef = this;

    // Pulsing glow
    scene.tweens.add({
      targets: this.sprite,
      scaleX: PIXEL_SCALE * 1.1,
      scaleY: PIXEL_SCALE * 1.1,
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    scene.tweens.add({
      targets: this.halo,
      alpha: 0.3,
      scaleX: 1.6,
      scaleY: 1.6,
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // "Commit" label floating above the orb
    const labelSize = Math.round(UI.BASE * UI.SMALL_RATIO * 0.85);
    this.label = scene.add.text(x, y - size * 1.2, 'COMMIT', {
      fontSize: labelSize + 'px',
      fontFamily: UI.FONT,
      color: '#ff6666',
      fontStyle: 'bold',
      shadow: { offsetX: 0, offsetY: 1, color: 'rgba(0,0,0,0.6)', blur: 4, fill: true },
    }).setOrigin(0.5).setDepth(4);

    // Despawn after 10 seconds
    this.despawnTimer = scene.time.delayedCall(10000, () => {
      if (!this.collected) this.destroy();
    });
  }

  /**
   * Collect and immediately detonate — damages all enemies in range.
   */
  collect(enemies) {
    if (this.collected) return;
    this.collected = true;

    blastSfx();

    const px = this.sprite.x;
    const py = this.sprite.y;

    // --- Multi-phase explosion VFX ---

    // Camera flash + shake
    this.scene.cameras.main.flash(200, 255, 80, 50);
    this.scene.cameras.main.shake(300, VFX.SHAKE_BOSS_INTENSITY);

    // Phase 1: Bright white core flash
    const coreFlash = this.scene.add.circle(px, py, 10 * PX, 0xffffff, 1).setDepth(30);
    this.scene.tweens.add({
      targets: coreFlash,
      scaleX: 5,
      scaleY: 5,
      alpha: 0,
      duration: 350,
      ease: 'Quad.easeOut',
      onComplete: () => coreFlash.destroy(),
    });

    // Phase 2: Expanding shockwave ring showing blast radius
    const ring = this.scene.add.graphics().setDepth(28);
    let ringRadius = 15 * PX;
    const ringMax = BLAST.RADIUS;
    const ringTimer = this.scene.time.addEvent({
      delay: 16,
      repeat: 20,
      callback: () => {
        ringRadius += (ringMax - ringRadius) * 0.18;
        const alpha = 1 - ringRadius / ringMax;
        ring.clear();
        ring.lineStyle(3 * PX * alpha, BLAST.COLOR, alpha * 0.9);
        ring.strokeCircle(px, py, ringRadius);
        ring.lineStyle(1.5 * PX * alpha, 0xffaa44, alpha * 0.5);
        ring.strokeCircle(px, py, ringRadius * 0.65);
      },
    });
    this.scene.time.delayedCall(400, () => {
      ringTimer.destroy();
      ring.destroy();
    });

    // Phase 3: Fire particles
    const fireColors = [0xff3333, 0xff6633, 0xffcc00, 0xff8833, 0xffff66];
    for (let i = 0; i < 24; i++) {
      const angle = (Math.PI * 2 * i) / 24 + (Math.random() - 0.5) * 0.5;
      const vel = (60 + Math.random() * 100) * PX;
      const size = (2 + Math.random() * 4) * PX;
      const color = Phaser.Utils.Array.GetRandom(fireColors);
      const particle = this.scene.add.circle(px, py, size, color, 1).setDepth(26);
      this.scene.tweens.add({
        targets: particle,
        x: px + Math.cos(angle) * vel,
        y: py + Math.sin(angle) * vel,
        alpha: 0,
        scale: 0.1,
        duration: 400 + Math.random() * 300,
        ease: 'Quad.easeOut',
        onComplete: () => particle.destroy(),
      });
    }

    // Phase 4: Delayed smoke wisps
    this.scene.time.delayedCall(120, () => {
      for (let i = 0; i < 5; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * 20 * PX;
        const smoke = this.scene.add.circle(
          px + Math.cos(angle) * dist,
          py + Math.sin(angle) * dist,
          (4 + Math.random() * 7) * PX,
          0x333333, 0.3
        ).setDepth(25);
        this.scene.tweens.add({
          targets: smoke,
          y: smoke.y - (20 + Math.random() * 30) * PX,
          alpha: 0,
          scaleX: 2,
          scaleY: 2,
          duration: 600 + Math.random() * 300,
          ease: 'Sine.easeOut',
          onComplete: () => smoke.destroy(),
        });
      }
    });

    // Damage all enemies in range
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      const dx = enemy.sprite.x - px;
      const dy = enemy.sprite.y - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= BLAST.RADIUS) {
        enemy.takeDamage(BLAST.DAMAGE);
      }
    }

    // Collect animation
    const s = PIXEL_SCALE;
    this.scene.tweens.add({
      targets: this.sprite,
      alpha: 0,
      scaleX: s * 2.5,
      scaleY: s * 2.5,
      duration: 200,
      onComplete: () => this.destroy(),
    });
    if (this.halo && this.halo.active) {
      this.scene.tweens.add({
        targets: this.halo,
        alpha: 0,
        scaleX: 3.5,
        scaleY: 3.5,
        duration: 300,
      });
    }
    if (this.label && this.label.active) {
      this.scene.tweens.add({
        targets: this.label,
        alpha: 0,
        y: this.label.y - 20 * PX,
        duration: 250,
        onComplete: () => { if (this.label) this.label.destroy(); },
      });
    }
  }

  destroy() {
    if (this.despawnTimer) this.despawnTimer.destroy();
    if (this.label && this.label.active) this.label.destroy();
    if (this.halo && this.halo.active) this.halo.destroy();
    if (this.sprite && this.sprite.active) this.sprite.destroy();
  }
}
