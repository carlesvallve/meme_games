import Phaser from 'phaser';
import { GAME, COLORS, UI, PX, PIXEL_SCALE, POWERUP_TYPES } from '../core/Constants.js';
import { eventBus, Events } from '../core/EventBus.js';
import { playClickSfx, playNavSfx } from '../audio/AudioBridge.js';
import { renderPixelArt } from '../core/PixelRenderer.js';
import { PALETTE } from '../sprites/palette.js';
import {
  POWERUP_CODE_REVIEW, POWERUP_GITIGNORE, POWERUP_LINTER,
} from '../sprites/items.js';
import {
  MINE_SPRITE, ICON_TRIPLE, ICON_HOMING,
} from '../sprites/projectiles.js';
import { POWERUP_QUOTES } from '../ui/PowerupQuotes.js';

// Map powerup type to sprite data for icon rendering
const POWERUP_ICON_MAP = {
  CODE_REVIEW: { pixels: POWERUP_CODE_REVIEW, key: 'powerup-code-review' },
  GITIGNORE: { pixels: POWERUP_GITIGNORE, key: 'powerup-gitignore' },
  LINTER: { pixels: POWERUP_LINTER, key: 'powerup-linter' },
  MINES: { pixels: MINE_SPRITE, key: 'powerup-mines' },
  TRIPLE_SHOT: { pixels: ICON_TRIPLE, key: 'powerup-triple-shot' },
  HOMING: { pixels: ICON_HOMING, key: 'powerup-homing' },
};

/**
 * Shows a powerup choice overlay in the given scene (UIScene).
 * Player picks 1 of 2 powerups. Emits POWERUP_CHOSEN with the selected type.
 * Supports mouse/touch AND keyboard (A/D or Left/Right to navigate, Space to confirm).
 */
export function showPowerupChoiceOverlay(scene, options) {
  const w = GAME.WIDTH;
  const h = GAME.HEIGHT;
  const cx = w / 2;

  const root = scene.add.container(0, 0);
  root.setDepth(1000);

  // Semi-transparent overlay
  const overlay = scene.add.graphics();
  overlay.fillStyle(0x000000, 0.55);
  overlay.fillRect(0, 0, w, h);
  overlay.setAlpha(0);
  root.add(overlay);

  scene.tweens.add({
    targets: overlay,
    alpha: 1,
    duration: 150,
  });

  // Title
  const titleSize = Math.round(h * UI.HEADING_RATIO);
  const title = scene.add.text(cx, h * 0.15, 'POWERUP', {
    fontSize: titleSize + 'px',
    fontFamily: UI.FONT,
    color: '#4488ff',
    fontStyle: 'bold',
    shadow: { offsetX: 0, offsetY: 3, color: 'rgba(0,0,0,0.5)', blur: 8, fill: true },
  }).setOrigin(0.5);
  root.add(title);

  // Subtitle
  const subSize = Math.round(h * UI.BODY_RATIO * 0.85);
  const subtitle = scene.add.text(cx, h * 0.22, 'Equip a temporary boost', {
    fontSize: subSize + 'px',
    fontFamily: UI.FONT,
    color: '#6699cc',
  }).setOrigin(0.5);
  root.add(subtitle);

  // Particle burst
  const burstColors = [0x4488ff, 0x5599ff, 0x3366dd, 0xffffff];
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI * 2 * i) / 10;
    const speed = 60 * PX + Math.random() * 40 * PX;
    const size = 2 * PX + Math.random() * 2 * PX;
    const color = Phaser.Utils.Array.GetRandom(burstColors);
    const particle = scene.add.circle(cx, h * 0.18, size, color, 1);
    root.add(particle);
    scene.tweens.add({
      targets: particle,
      x: cx + Math.cos(angle) * speed,
      y: h * 0.18 + Math.sin(angle) * speed,
      alpha: 0,
      scale: 0.2,
      duration: 400 + Math.random() * 200,
      ease: 'Quad.easeOut',
      onComplete: () => particle.destroy(),
    });
  }

  // Cards
  const gap = 20 * PX;
  const maxCardW = Math.min(w * 0.38, h * 0.42);
  const cardW = maxCardW;
  const cardH = cardW * 1.15;
  const startX = cx - (options.length - 1) * (cardW + gap) / 2;

  // Track cards for keyboard navigation
  const cards = [];
  let selectedIndex = 0;
  let confirmed = false;

  const confirmSelection = () => {
    if (confirmed) return;
    confirmed = true;
    playClickSfx();
    eventBus.emit(Events.POWERUP_CHOSEN, { type: options[selectedIndex].type });
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
      drawPowerupCardBg(card.bg, cardW, cardH, i === selectedIndex, card.accentColor);
      scene.tweens.add({
        targets: card.container,
        scaleX: i === selectedIndex ? 1.05 : 1,
        scaleY: i === selectedIndex ? 1.05 : 1,
        duration: 80,
      });
    });
  };

  options.forEach((opt, i) => {
    const cardX = startX + i * (cardW + gap);
    const cardY = h * 0.52;
    const card = createPowerupCard(scene, root, cardX, cardY, cardW, cardH, opt, () => {
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

function createPowerupCard(scene, root, x, y, w, h, option, onSelect, onHover, index) {
  const container = scene.add.container(x, y);
  root.add(container);

  const config = POWERUP_TYPES[option.type];
  const accentColor = config.color;
  const accentHex = '#' + config.color.toString(16).padStart(6, '0');

  // Card background
  const bg = scene.add.graphics();
  drawPowerupCardBg(bg, w, h, false, accentColor);
  container.add(bg);

  // Icon
  const iconData = POWERUP_ICON_MAP[option.type];
  if (iconData) {
    renderPixelArt(scene, iconData.pixels, PALETTE, iconData.key, PIXEL_SCALE);
    const icon = scene.add.image(0, -h * 0.22, iconData.key);
    icon.setScale(PX * 2.0);
    container.add(icon);
  }

  // Name
  const nameSize = Math.round(GAME.HEIGHT * UI.SMALL_RATIO * 1.2);
  const nameText = scene.add.text(0, h * 0.0, config.name, {
    fontSize: nameSize + 'px',
    fontFamily: UI.FONT,
    color: accentHex,
    fontStyle: 'bold',
    align: 'center',
    wordWrap: { width: w * 0.88 },
  }).setOrigin(0.5);
  container.add(nameText);

  // Description
  const descSize = Math.round(GAME.HEIGHT * UI.SMALL_RATIO * 0.9);
  const descText = scene.add.text(0, h * 0.12, config.desc, {
    fontSize: descSize + 'px',
    fontFamily: UI.FONT,
    color: COLORS.UI_TEXT,
    align: 'center',
    wordWrap: { width: w * 0.85 },
  }).setOrigin(0.5);
  container.add(descText);

  // Duration badge — prominent pill
  const durSec = config.duration > 0 ? Math.round(config.duration / 1000) : 0;
  const durLabel = durSec > 0 ? `⏱ ${durSec}s` : 'INSTANT';
  const durSize = Math.round(GAME.HEIGHT * UI.SMALL_RATIO * 0.9);
  const durText = scene.add.text(0, h * 0.25, durLabel, {
    fontSize: durSize + 'px',
    fontFamily: UI.FONT,
    color: '#ffffff',
    fontStyle: 'bold',
    shadow: { offsetX: 0, offsetY: 1, color: 'rgba(0,0,0,0.4)', blur: 3, fill: true },
  }).setOrigin(0.5);
  container.add(durText);

  // Duration pill background
  const pillW = durText.width + 16 * PX;
  const pillH = durText.height + 6 * PX;
  const pill = scene.add.graphics();
  pill.fillStyle(config.color, 0.3);
  pill.fillRoundedRect(-pillW / 2, h * 0.25 - pillH / 2, pillW, pillH, pillH / 2);
  pill.lineStyle(1.5, config.color, 0.6);
  pill.strokeRoundedRect(-pillW / 2, h * 0.25 - pillH / 2, pillW, pillH, pillH / 2);
  container.add(pill);
  container.moveDown(pill); // behind text

  // Quote (flavor text)
  const quotes = POWERUP_QUOTES[option.type];
  if (quotes && quotes.length > 0) {
    const quote = Phaser.Utils.Array.GetRandom(quotes);
    // Truncate long quotes for card display
    let quoteStr = quote.text;
    if (quoteStr.length > 60) quoteStr = quoteStr.substring(0, 57) + '...';
    const quoteSize = Math.round(GAME.HEIGHT * UI.SMALL_RATIO * 0.65);
    const quoteText = scene.add.text(0, h * 0.36, quoteStr, {
      fontSize: quoteSize + 'px',
      fontFamily: UI.FONT,
      fontStyle: 'italic',
      color: COLORS.MUTED_TEXT,
      align: 'center',
      wordWrap: { width: w * 0.82 },
    }).setOrigin(0.5);
    container.add(quoteText);
  }

  // Interactive
  container.setSize(w, h);
  container.setInteractive({ useHandCursor: true });

  container.on('pointerover', () => {
    onHover(index);
  });

  container.on('pointerout', () => {
    bg.clear();
    drawPowerupCardBg(bg, w, h, false, accentColor);
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
    delay: 80 + 60,
    ease: 'Back.easeOut',
  });

  return { container, bg, accentColor };
}

function drawPowerupCardBg(bg, w, h, hovered, accentColor) {
  const r = 8 * PX;
  if (hovered) {
    bg.fillStyle(0x112233, 0.88);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    bg.lineStyle(3, accentColor, 1);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
  } else {
    bg.fillStyle(0x0a1520, 0.8);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, r);
    bg.lineStyle(2, accentColor, 0.4);
    bg.strokeRoundedRect(-w / 2, -h / 2, w, h, r);
  }
}
