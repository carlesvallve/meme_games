import { createDisplayConfig } from '@sttg/game-base';

const { DPR, PX, GAME } = createDisplayConfig();

export { DPR, PX, GAME };

// --- Player ---

export const PLAYER = {
  START_X: GAME.WIDTH * 0.25,
  START_Y: GAME.HEIGHT * 0.65,
  WIDTH: 40 * PX,
  HEIGHT: 40 * PX,
  SPEED: 200 * PX,
  JUMP_VELOCITY: -400 * PX,
  COLOR: 0x44aaff,
};

// --- Colors ---

export const COLORS = {
  // Gameplay
  SKY: 0x87ceeb,
  GROUND: 0x4a7c2e,
  GROUND_DARK: 0x3a6320,
  PLAYER: 0x44aaff,

  // UI text
  UI_TEXT: '#ffffff',
  UI_SHADOW: '#000000',
  MUTED_TEXT: '#8888aa',
  SCORE_GOLD: '#ffd700',

  // Menu / GameOver gradient backgrounds
  BG_TOP: 0x0f0c29,
  BG_BOTTOM: 0x302b63,

  // Buttons
  BTN_PRIMARY: 0x6c63ff,
  BTN_PRIMARY_HOVER: 0x857dff,
  BTN_PRIMARY_PRESS: 0x5a52d5,
  BTN_TEXT: '#ffffff',
};

// --- UI sizing (proportional to game dimensions) ---

export const UI = {
  FONT: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  TITLE_RATIO: 0.08,          // title font size as % of GAME.HEIGHT
  HEADING_RATIO: 0.05,        // heading font size
  BODY_RATIO: 0.035,          // body/button font size
  SMALL_RATIO: 0.025,         // hint/caption font size
  BTN_W_RATIO: 0.45,          // button width as % of GAME.WIDTH
  BTN_H_RATIO: 0.075,         // button height as % of GAME.HEIGHT
  BTN_RADIUS: 12 * PX,        // button corner radius
  MIN_TOUCH: 44 * PX,         // minimum touch target
  SCORE_SIZE_RATIO: 0.04,     // HUD score font size
  SCORE_STROKE: 4 * PX,       // HUD score stroke thickness
};

// --- Transitions ---

export const TRANSITION = {
  FADE_DURATION: 350,
  SCORE_POP_SCALE: 1.3,
  SCORE_POP_DURATION: 150,
};
