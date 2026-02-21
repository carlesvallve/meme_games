import { createDisplayConfig } from '@sttg/game-base';

const { DPR, PX, GAME } = createDisplayConfig();

export { DPR, PX, GAME };

export const COLORS = {
  background: 0x1a1a2e,
  ground: 0x333344,
  accent: 0xe94560,
  ambient: 0xffffff,
  directional: 0xffffff,
};

export const CAMERA = {
  FOV: 60,
  NEAR: 0.1,
  FAR: 200,
  DISTANCE: 10,
  ANGLE_X: -25,
  ANGLE_Y: 35,
};

export const GAME_ID = 'three-react-game';
