import Phaser from 'phaser';
import { GAME, COLORS, UI, PX, PIXEL_SCALE } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';
import { playClickSfx } from '../audio/AudioBridge.js';
import { renderPixelArt } from '../core/PixelRenderer.js';
import { PALETTE } from '../sprites/palette.js';
import {
  ICON_ATTACK_SPEED, ICON_DAMAGE, ICON_RANGE, ICON_PROJ_SPEED,
  ICON_MULTI_SHOT, ICON_AREA, ICON_HOMING, ICON_GUIDED,
  ICON_TRIPLE, ICON_MINES,
} from '../sprites/projectiles.js';

// Map upgrade icon keys to sprite data
const ICON_MAP = {
  'icon-attack-speed': ICON_ATTACK_SPEED,
  'icon-damage': ICON_DAMAGE,
  'icon-range': ICON_RANGE,
  'icon-proj-speed': ICON_PROJ_SPEED,
  'icon-multi-shot': ICON_MULTI_SHOT,
  'icon-area': ICON_AREA,
  'icon-homing': ICON_HOMING,
  'icon-guided': ICON_GUIDED,
  'icon-triple': ICON_TRIPLE,
  'icon-mines': ICON_MINES,
};

/**
 * Creates and shows the level-up overlay directly inside the given scene.
 * No separate Phaser Scene — just a container pinned to the camera.
 * Returns a cleanup function to remove it.
 */
export function showLevelUpOverlay(scene, levelData) {
  const cam = scene.cameras.main;
  const w = GAME.WIDTH;
  const h = GAME.HEIGHT;
  const cx = w / 2;

  // Root container — rendered in UIScene (no scrolling)
  const root = scene.add.container(0, 0);
  root.setDepth(1000); // above everything

  // Semi-transparent dark overlay
  const overlay = scene.add.graphics();
  overlay.fillStyle(0x000000, 0.6);
  overlay.fillRect(0, 0, w, h);
  overlay.setAlpha(0);
  root.add(overlay);

  scene.tweens.add({
    targets: overlay,
    alpha: 1,
    duration: 200,
  });

  // Gold particle burst
  const burstColors = [0xffcc00, 0xffe866, 0x9944ff, 0xffffff];
  for (let i = 0; i < 12; i++) {
    const angle = (Math.PI * 2 * i) / 12;
    const speed = 80 * PX + Math.random() * 40 * PX;
    const size = 2 * PX + Math.random() * 3 * PX;
    const color = Phaser.Utils.Array.GetRandom(burstColors);
    const particle = scene.add.circle(cx, h * 0.18, size, color, 1);
    root.add(particle);
    scene.tweens.add({
      targets: particle,
      x: cx + Math.cos(angle) * speed,
      y: h * 0.18 + Math.sin(angle) * speed,
      alpha: 0,
      scale: 0.2,
      duration: 500 + Math.random() * 300,
      ease: 'Quad.easeOut',
      onComplete: () => particle.destroy(),
    });
  }

  // Title
  const titleSize = Math.round(h * UI.HEADING_RATIO);
  const title = scene.add.text(cx, h * 0.18, `LEVEL ${levelData.level}!`, {
    fontSize: titleSize + 'px',
    fontFamily: UI.FONT,
    color: '#ffcc00',
    fontStyle: 'bold',
    shadow: { offsetX: 0, offsetY: 3, color: 'rgba(0,0,0,0.5)', blur: 8, fill: true },
  }).setOrigin(0.5);
  root.add(title);

  const subSize = Math.round(h * UI.BODY_RATIO);
  const subtitle = scene.add.text(cx, h * 0.25, 'Choose an upgrade:', {
    fontSize: subSize + 'px',
    fontFamily: UI.FONT,
    color: COLORS.UI_TEXT,
  }).setOrigin(0.5);
  root.add(subtitle);

  // Upgrade cards — square, responsive
  const options = levelData.options || [];
  const gap = 16 * PX;
  const maxCardSize = Math.min(w * 0.28, h * 0.35);
  const totalNeeded = options.length * maxCardSize + (options.length - 1) * gap;
  const cardSize = totalNeeded > w * 0.9
    ? (w * 0.9 - (options.length - 1) * gap) / options.length
    : maxCardSize;

  const startX = cx - (options.length - 1) * (cardSize + gap) / 2;

  options.forEach((opt, i) => {
    const cardX = startX + i * (cardSize + gap);
    const cardY = h * 0.52;
    createCard(scene, root, cardX, cardY, cardSize, cardSize, opt, () => {
      // On select: emit upgrade, destroy overlay
      playClickSfx();
      eventBus.emit(Events.WEAPON_UPGRADE, { upgrade: opt });
      gameState.upgrades.push(opt.id);
      root.destroy();
    });
  });
}

function createCard(scene, root, x, y, w, h, upgrade, onSelect) {
  const container = scene.add.container(x, y);
  root.add(container);

  // Card background
  const bg = scene.add.graphics();
  drawCardBg(bg, w, h, false);
  container.add(bg);

  // Pixel art icon
  const iconKey = upgrade.icon;
  if (iconKey && ICON_MAP[iconKey]) {
    renderPixelArt(scene, ICON_MAP[iconKey], PALETTE, iconKey, PIXEL_SCALE);
    const icon = scene.add.image(0, -h * 0.15, iconKey);
    icon.setScale(PX * 1.8);
    container.add(icon);
  }

  // Name
  const nameSize = Math.round(GAME.HEIGHT * UI.SMALL_RATIO * 1.1);
  const nameText = scene.add.text(0, h * 0.1, upgrade.name, {
    fontSize: nameSize + 'px',
    fontFamily: UI.FONT,
    color: '#ffcc00',
    fontStyle: 'bold',
    align: 'center',
    wordWrap: { width: w * 0.88 },
  }).setOrigin(0.5);
  container.add(nameText);

  // Description
  const descSize = Math.round(GAME.HEIGHT * UI.SMALL_RATIO * 0.85);
  const descText = scene.add.text(0, h * 0.28, upgrade.desc, {
    fontSize: descSize + 'px',
    fontFamily: UI.FONT,
    color: COLORS.MUTED_TEXT,
    align: 'center',
    wordWrap: { width: w * 0.88 },
  }).setOrigin(0.5);
  container.add(descText);

  // "NEW WEAPON" badge for unique unlocks
  if (upgrade.unique) {
    const badgeSize = Math.round(GAME.HEIGHT * UI.SMALL_RATIO * 0.7);
    const badge = scene.add.text(0, h * 0.42, 'NEW WEAPON', {
      fontSize: badgeSize + 'px',
      fontFamily: UI.FONT,
      color: '#ff6633',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(badge);
  }

  // Interactive
  container.setSize(w, h);
  container.setInteractive({ useHandCursor: true });

  container.on('pointerover', () => {
    bg.clear();
    drawCardBg(bg, w, h, true);
    scene.tweens.add({ targets: container, scaleX: 1.05, scaleY: 1.05, duration: 80 });
  });

  container.on('pointerout', () => {
    bg.clear();
    drawCardBg(bg, w, h, false);
    scene.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 80 });
  });

  container.on('pointerup', onSelect);

  // Scale-in animation
  container.setScale(0);
  scene.tweens.add({
    targets: container,
    scaleX: 1,
    scaleY: 1,
    duration: 300,
    delay: 100,
    ease: 'Back.easeOut',
  });
}

function drawCardBg(bg, w, h, hovered) {
  const r = 8 * PX;
  if (hovered) {
    bg.fillStyle(0x222244, 0.85);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    bg.lineStyle(3, 0xffcc00, 1);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
  } else {
    bg.fillStyle(0x111133, 0.75);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    bg.lineStyle(2, 0x6633cc, 0.6);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
  }
}

// Keep the class export for GameConfig scene list (it just won't be used)
export class LevelUpScene extends Phaser.Scene {
  constructor() {
    super('LevelUpScene');
  }
  create() {}
}
