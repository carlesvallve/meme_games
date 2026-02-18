import Phaser from 'phaser';
import { GAME, COLORS, UI, PX, PIXEL_SCALE } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';
import { playClickSfx, playNavSfx } from '../audio/AudioBridge.js';
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
 * Supports mouse/touch AND keyboard (A/D or Left/Right to navigate, Space to confirm).
 */
export function showLevelUpOverlay(scene, levelData) {
  const w = GAME.WIDTH;
  const h = GAME.HEIGHT;
  const cx = w / 2;

  // Root container — rendered in UIScene (no scrolling)
  const root = scene.add.container(0, 0);
  root.setDepth(1000); // above everything

  // Semi-transparent dark overlay — slight purple tint
  const overlay = scene.add.graphics();
  overlay.fillStyle(0x0a0018, 0.65);
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

  // Title — big and celebratory
  const titleSize = Math.round(h * UI.HEADING_RATIO * 1.15);
  const title = scene.add.text(cx, h * 0.12, 'LEVEL UP!', {
    fontSize: titleSize + 'px',
    fontFamily: UI.FONT,
    color: '#ffcc00',
    fontStyle: 'bold',
    shadow: { offsetX: 0, offsetY: 4, color: 'rgba(0,0,0,0.6)', blur: 10, fill: true },
  }).setOrigin(0.5);
  root.add(title);

  // Level number badge
  const lvlSize = Math.round(h * UI.BODY_RATIO * 1.1);
  const lvlText = scene.add.text(cx, h * 0.20, `Level ${levelData.level}`, {
    fontSize: lvlSize + 'px',
    fontFamily: UI.FONT,
    color: '#ffee88',
    fontStyle: 'bold',
  }).setOrigin(0.5);
  root.add(lvlText);

  // Subtitle — dev themed
  const subSize = Math.round(h * UI.BODY_RATIO * 0.85);
  const subtitle = scene.add.text(cx, h * 0.26, "Upgrade the codebase — it's permanent!", {
    fontSize: subSize + 'px',
    fontFamily: UI.FONT,
    color: '#cc99ff',
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

  // Track cards for keyboard navigation
  const cards = [];
  let selectedIndex = 0;
  let confirmed = false;
  let inputReady = false;

  // Grace period — ignore space/enter for 400ms so frantic shooting doesn't auto-confirm
  scene.time.delayedCall(400, () => { inputReady = true; });

  const confirmSelection = () => {
    if (confirmed || !inputReady) return;
    confirmed = true;
    playClickSfx();
    eventBus.emit(Events.WEAPON_UPGRADE, { upgrade: options[selectedIndex] });
    gameState.upgrades.push(options[selectedIndex].id);
    cleanup();
    root.destroy();
  };

  const setSelected = (idx) => {
    if (idx === selectedIndex) return;
    playNavSfx();
    selectedIndex = idx;
    updateHighlight();
  };

  const updateHighlight = () => {
    cards.forEach((card, i) => {
      card.bg.clear();
      drawCardBg(card.bg, cardSize, cardSize, i === selectedIndex);
      scene.tweens.add({
        targets: card.container,
        scaleX: i === selectedIndex ? 1.05 : 1,
        scaleY: i === selectedIndex ? 1.05 : 1,
        duration: 80,
      });
    });
  };

  options.forEach((opt, i) => {
    const cardX = startX + i * (cardSize + gap);
    const cardY = h * 0.52;
    const card = createCard(scene, root, cardX, cardY, cardSize, cardSize, opt, () => {
      selectedIndex = i;
      confirmSelection();
    }, (idx) => {
      setSelected(idx);
    }, i);
    cards.push(card);
  });

  // Keyboard navigation
  const keyA = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
  const keyD = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
  const keyLeft = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
  const keyRight = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
  const keySpace = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
  const keyEnter = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

  const onKeyDown = (event) => {
    if (confirmed) return;
    const code = event.keyCode;
    if (code === keyA.keyCode || code === keyLeft.keyCode) {
      setSelected(Math.max(0, selectedIndex - 1));
    } else if (code === keyD.keyCode || code === keyRight.keyCode) {
      setSelected(Math.min(options.length - 1, selectedIndex + 1));
    } else if (code === keySpace.keyCode || code === keyEnter.keyCode) {
      confirmSelection();
    }
  };

  scene.input.keyboard.on('keydown', onKeyDown);

  // Initial highlight on first card
  updateHighlight();

  // Cleanup function to remove keyboard listeners
  const cleanup = () => {
    scene.input.keyboard.off('keydown', onKeyDown);
    scene.input.keyboard.removeKey(keyA);
    scene.input.keyboard.removeKey(keyD);
    scene.input.keyboard.removeKey(keyLeft);
    scene.input.keyboard.removeKey(keyRight);
    scene.input.keyboard.removeKey(keySpace);
    scene.input.keyboard.removeKey(keyEnter);
  };
}

function createCard(scene, root, x, y, w, h, upgrade, onSelect, onHover, index) {
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

  // "NEW WEAPON" badge for unique unlocks, otherwise "PERMANENT"
  const badgeY = h * 0.42;
  const badgeSize = Math.round(GAME.HEIGHT * UI.SMALL_RATIO * 0.7);
  if (upgrade.unique) {
    const badge = scene.add.text(0, badgeY, '★ NEW WEAPON', {
      fontSize: badgeSize + 'px',
      fontFamily: UI.FONT,
      color: '#ff6633',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(badge);
  } else {
    const badge = scene.add.text(0, badgeY, 'PERMANENT', {
      fontSize: badgeSize + 'px',
      fontFamily: UI.FONT,
      color: '#cc99ff',
      fontStyle: 'bold',
    }).setOrigin(0.5);
    container.add(badge);
  }

  // Interactive
  container.setSize(w, h);
  container.setInteractive({ useHandCursor: true });

  container.on('pointerover', () => {
    onHover(index);
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

  return { container, bg };
}

function drawCardBg(bg, w, h, hovered) {
  const r = 8 * PX;
  if (hovered) {
    bg.fillStyle(0x1a1030, 0.9);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    bg.lineStyle(3, 0xffcc00, 1);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
  } else {
    bg.fillStyle(0x140c28, 0.82);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    bg.lineStyle(2, 0x9955dd, 0.5);
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
