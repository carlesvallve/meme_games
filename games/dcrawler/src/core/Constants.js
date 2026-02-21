import { createDisplayConfig } from '@sttg/game-base';

const { DPR, PX, GAME } = createDisplayConfig();
export { DPR, PX, GAME };

// Dungeon
export const DUNGEON = {
  WIDTH: 24,
  HEIGHT: 24,
  MIN_ROOM_SIZE: 3,
  MAX_ROOM_SIZE: 7,
  MAX_ROOMS: 8,
  CELL_SIZE: 4, // world units per grid cell
};

// Cell types
export const CELL = {
  VOID: 0,
  WALL: 1,
  FLOOR: 2,
  DOOR: 3,
  STAIRS: 4,
  CHEST: 5,
  TRAP: 6,
  SHOP: 7,
  ENEMY: 8,
  TORCH: 9,
};

// Camera / rendering
export const CAMERA = {
  FOV: 60,
  NEAR: 0.1,
  FAR: 100,
  EXPLORE_HEIGHT: 1.5,
  EXPLORE_TILT: 0,
  COMBAT_HEIGHT: 1.8,
  COMBAT_TILT: -0.22,
};

// Colors (B&W comic palette)
export const COLORS = {
  VOID: 0x0a0a0a,
  WALL: 0xe8e0d8,
  WALL_DARK: 0xc8c0b8,
  FLOOR: 0xd0c8c0,
  CEILING: 0xb8b0a8,
  DOOR: 0xd8d0c8,
  AMBIENT: 0x887766,
  FOG: 0x1a1510,
  PLAYER_LIGHT: 0xffe8cc,
  TORCH_LIGHT: 0xffcc77,
  ACCENT: 0xddaa44,
  ACCENT_RED: 0xcc4444,
  ACCENT_GREEN: 0x44cc44,
  ACCENT_BLUE: 0x4488cc,
  INK: 0x1a1a1a,
};

// Movement
export const MOVEMENT = {
  TWEEN_DURATION: 200, // ms
  TURN_DURATION: 150, // ms
};

// Combat
export const COMBAT = {
  DECK_SIZE: 24,
  CARD_COPIES: 4,
  CARD_MIN: 1,
  CARD_MAX: 6,
  TARGET: 12,
  ENERGY_PER_HIT: 5,
  CRITICAL_BONUS: 2,
  BASE_HAND_SIZE: 5,
};

// Player defaults
export const PLAYER_DEFAULTS = {
  HP: 50,
  MAX_HP: 50,
  ENERGY: 0,
  MAX_ENERGY: 100,
  ATTACK: 5,
  DEFENSE: 2,  // base armor — reduces damage per hit (VT: damage = enemy.attack - your.armor)
};

// Directions (grid-based, clockwise from north)
export const DIR = {
  NORTH: { x: 0, z: -1 },
  EAST: { x: 1, z: 0 },
  SOUTH: { x: 0, z: 1 },
  WEST: { x: -1, z: 0 },
};
export const DIRECTIONS = [DIR.NORTH, DIR.EAST, DIR.SOUTH, DIR.WEST];

// Themes — visual identity per floor
export const THEMES = {
  dungeon: {
    name: 'Dungeon',
    wall: { base: '#f8f4f0', stroke: '#1a1a1a', style: 'brick' },
    floor: { base: '#ece6e0', stroke: '#1a1a1a', style: 'stone' },
    ceiling: { base: '#e0d8d0', stroke: '#1a1a1a', style: 'beams' },
    fog: 0x1a1510,
    ambient: 0x887766,
    ambientIntensity: 0.35,
    playerLight: 0xffe8cc,
    torchLight: 0xffcc77,
    ink: 0x1a1a1a,
    accent: 0xddaa44,
    decorations: { spiderWebs: true, torches: true },
  },
  office: {
    name: 'Office',
    wall: { base: '#e8e8e0', stroke: '#888888', style: 'panels' },
    floor: { base: '#8090a0', stroke: '#667080', style: 'carpet' },
    ceiling: { base: '#f0f0e8', stroke: '#cccccc', style: 'tiles' },
    fog: 0x202830,
    ambient: 0x99aabb,
    ambientIntensity: 0.5,
    playerLight: 0xddeeff,
    torchLight: 0xeeeeff,
    ink: 0x556666,
    accent: 0x4488cc,
    decorations: { spiderWebs: false, torches: true },
  },
};

export function getThemeForFloor(floor) {
  return floor === 1 ? THEMES.office : THEMES.dungeon;
}
