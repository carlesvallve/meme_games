import Phaser from 'phaser';
import { GAME, COLORS, UI, PX, VFX } from '../core/Constants.js';
import { gameState } from '../core/GameState.js';
import { playClickSfx } from '../audio/AudioBridge.js';

/**
 * Shows a game over overlay in GameScene (for lighting).
 * Uses scrollFactor(0) so elements stay fixed on screen despite camera scroll/zoom.
 */
export function showGameOverOverlay(scene, stats, onRestart) {
  const w = GAME.WIDTH;
  const h = GAME.HEIGHT;
  const cx = w / 2;
  const cy = h / 2;
  const DEPTH = 998; // below lighting overlay (999) so MULTIPLY blend affects it

  // All elements go into elements array for cleanup
  const elements = [];
  const add = (el) => { elements.push(el); return el; };

  // Semi-transparent overlay — covers full screen via scrollFactor(0)
  const overlay = scene.add.graphics();
  overlay.fillStyle(0x000000, 0.12);
  // Draw large enough to cover viewport at any zoom
  overlay.fillRect(-w, -h, w * 3, h * 3);
  overlay.setScrollFactor(0).setAlpha(0).setDepth(DEPTH);
  add(overlay);

  scene.tweens.add({
    targets: overlay,
    alpha: 1,
    duration: 300,
  });

  // "GAME OVER" title — center layout
  const titleSize = Math.round(UI.BASE * UI.HEADING_RATIO * 1.2);
  const lift = 30 * PX; // compensate for camera pan downward on game over
  const titleY = cy + UI.BASE * 0.18 - lift;
  const title = add(scene.add.text(cx, titleY, 'GAME OVER', {
    fontSize: titleSize + 'px',
    fontFamily: UI.FONT,
    color: '#44ff44',
    fontStyle: 'bold',
    shadow: { offsetX: 0, offsetY: 3, color: 'rgba(0,80,0,0.5)', blur: 8, fill: true },
  }).setOrigin(0.5).setScrollFactor(0).setAlpha(0).setDepth(DEPTH));

  // Disable roundPixels so slow float tweens aren't choppy
  scene.cameras.main.roundPixels = false;

  scene.tweens.add({
    targets: title,
    alpha: 1,
    y: titleY - 4 * PX,
    duration: 400,
    delay: 100,
    ease: 'Quad.easeOut',
  });

  // Float — match title overlay: 6*PX over 2000ms
  scene.tweens.add({
    targets: title,
    y: titleY - 6 * PX,
    duration: 2000,
    delay: 500,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
  });

  // --- Single-row compact stats ---
  const isMobile = GAME.IS_MOBILE;
  const statY = cy + UI.BASE * 0.06 - lift;
  const labelSize = Math.round(UI.BASE * UI.SMALL_RATIO * 0.7);
  const valueSize = Math.round(UI.BASE * UI.SMALL_RATIO * 1.1);
  const separator = '·';

  const mins = Math.floor(stats.timeSurvived / 60);
  const secs = stats.timeSurvived % 60;
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  const statItems = [
    { value: stats.score, label: 'SCORE', color: COLORS.SCORE_GOLD, animated: true },
    { value: `${stats.enemiesKilled}`, label: 'KILLS', color: '#44ff44' },
    { value: timeStr, label: 'TIME', color: '#ffffff' },
    { value: `${stats.level}`, label: 'LV', color: '#9944ff' },
  ];

  const itemGap = isMobile ? 24 * PX : 36 * PX;

  // Build stat cells
  const cells = [];
  statItems.forEach((item, i) => {
    const vText = add(scene.add.text(0, statY, item.animated ? '0' : `${item.value}`, {
      fontSize: valueSize + 'px',
      fontFamily: UI.FONT,
      color: item.color,
      fontStyle: 'bold',
    }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(DEPTH));

    const lbl = add(scene.add.text(0, statY + 4 * PX, item.label, {
      fontSize: labelSize + 'px',
      fontFamily: UI.FONT,
      color: COLORS.MUTED_TEXT,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(DEPTH));

    if (item.animated) {
      const counter = { val: 0 };
      scene.tweens.add({
        targets: counter,
        val: item.value,
        duration: VFX.SCORE_COUNTER_DURATION,
        delay: 400,
        ease: 'Cubic.easeOut',
        onUpdate: () => vText.setText(`${Math.round(counter.val)}`),
        onComplete: () => {
          vText.setText(`${item.value}`);
          scene.tweens.add({
            targets: vText,
            scaleX: 1.3, scaleY: 1.3,
            duration: 100, yoyo: true,
            ease: 'Quad.easeOut',
          });
        },
      });
    }

    // Scale-in
    vText.setScale(0).setAlpha(0);
    lbl.setScale(0).setAlpha(0);
    scene.tweens.add({
      targets: [vText, lbl],
      scaleX: 1, scaleY: 1, alpha: 1,
      duration: 350,
      delay: 200 + i * 80,
      ease: 'Back.easeOut',
    });

    cells.push({ vText, lbl, width: 0 });
  });

  // Position cells once text is rendered (next frame)
  scene.time.delayedCall(0, () => {
    cells.forEach(c => {
      c.width = Math.max(c.vText.width, c.lbl.width, 30 * PX);
    });

    const totalW = cells.reduce((sum, c) => sum + c.width, 0)
      + (cells.length - 1) * itemGap;
    let x = cx - totalW / 2;

    cells.forEach((c, i) => {
      const cellCX = x + c.width / 2;
      c.vText.setX(cellCX);
      c.lbl.setX(cellCX);
      x += c.width + itemGap;

      if (i < cells.length - 1) {
        const sep = add(scene.add.text(x - itemGap / 2, statY - 2 * PX, separator, {
          fontSize: valueSize + 'px',
          fontFamily: UI.FONT,
          color: COLORS.MUTED_TEXT,
        }).setOrigin(0.5).setScrollFactor(0).setAlpha(0).setDepth(DEPTH));
        scene.tweens.add({
          targets: sep,
          alpha: 0.4,
          duration: 300,
          delay: 300 + i * 80,
        });
      }
    });
  });

  // Best score
  const bestSize = Math.round(UI.BASE * UI.SMALL_RATIO * 0.75);
  const bestText = add(scene.add.text(cx, statY + 30 * PX, `BEST: ${stats.bestScore}`, {
    fontSize: bestSize + 'px',
    fontFamily: UI.FONT,
    color: COLORS.MUTED_TEXT,
  }).setOrigin(0.5).setScrollFactor(0).setAlpha(0).setDepth(DEPTH));

  scene.tweens.add({
    targets: bestText,
    alpha: 0.7,
    duration: 300,
    delay: 600,
  });

  // Input handling with grace period
  let confirmed = false;
  let inputReady = false;

  const doRestart = () => {
    if (confirmed || !inputReady) return;
    confirmed = true;
    playClickSfx();
    scene.cameras.main.roundPixels = true; // restore for gameplay
    if (scene.lighting) scene.lighting.setAmbient(0.75); // restore gameplay ambient
    cleanup();
    elements.forEach(el => el.destroy());
    onRestart();
  };

  scene.time.delayedCall(400, () => { inputReady = true; });

  const onKeyDown = (event) => {
    if (event.keyCode === Phaser.Input.Keyboard.KeyCodes.SPACE) {
      doRestart();
    }
  };

  const onPointerDown = () => {
    doRestart();
  };

  scene.input.keyboard.on('keydown', onKeyDown);
  scene.input.on('pointerdown', onPointerDown);

  const cleanup = () => {
    scene.input.keyboard.off('keydown', onKeyDown);
    scene.input.off('pointerdown', onPointerDown);
  };
}
