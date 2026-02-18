import Phaser from 'phaser';
import { POWERUP_DROP, PX, PIXEL_SCALE, GAME, UI } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';

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

    const px = this.sprite.x;
    const py = this.sprite.y;

    // Visual blast effect — expanding red ring
    const blast = this.scene.add.graphics();
    blast.setPosition(px, py);
    blast.fillStyle(BLAST.COLOR, 0.25);
    blast.fillCircle(0, 0, BLAST.RADIUS);
    blast.lineStyle(4 * PX, BLAST.COLOR, 0.9);
    blast.strokeCircle(0, 0, BLAST.RADIUS);
    blast.lineStyle(2 * PX, 0xffffff, 0.4);
    blast.strokeCircle(0, 0, BLAST.RADIUS * 0.6);

    this.scene.tweens.add({
      targets: blast,
      alpha: 0,
      scaleX: 1.8,
      scaleY: 1.8,
      duration: 500,
      ease: 'Quad.easeOut',
      onComplete: () => blast.destroy(),
    });

    // Camera flash
    this.scene.cameras.main.flash(120, 255, 60, 60);
    this.scene.cameras.main.shake(200, 0.01);

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
