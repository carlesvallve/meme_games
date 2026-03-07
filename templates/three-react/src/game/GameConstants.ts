/**
 * GameConstants — centralized magic numbers for the 3D game template.
 * Import from here instead of scattering literals across files.
 */

// ── World ────────────────────────────────────────────────────────────
export const WORLD_SIZE = 41; // odd so there's always a center cell
export const GROUND_COLOR = 0x9B8B75;
export const EARTHY_COLORS = [0x8B7355, 0x6B5B45, 0x7A6B55, 0x9B8B75, 0x5C4D3C, 0x8B8070, 0x6E6355];
export const CAPSULE_RADIUS = 0.25;

// ── Character (DummyCharacter.ts) ────────────────────────────────────
export const DEFAULT_TURN_SPEED = 12;
export const WAYPOINT_THRESHOLD = 0.3;
export const HOP_HEIGHT = 0.06;
export const FOOT_SFX_COOLDOWN = 0.12;
export const STEP_UP_RATE = 20; // exponential lerp rate for stepping up
export const GRAVITY = 60; // fall acceleration
export const MAX_FALL_SPEED = 30; // terminal velocity

// ── Pathfinding (AStar.ts) ───────────────────────────────────────────
/** Cost multiplier for climbing up (ascending stairs). */
export const CLIMB_PENALTY = 2;
/** Cost multiplier for any descent — strongly discourages leaving elevated paths. */
export const DESCENT_PENALTY = 12;
/** Base cost for traversing a ladder nav-link. Strongly prefers ramps/flat but uses ladders when needed. */
export const LADDER_COST = 8;

// ── UI / Markers (Game.ts) ───────────────────────────────────────────
export const RING_STROKE = 0.05;
export const MARKER_SNAP_SPEED = 16;
export const GOAL_DRAG_THRESHOLD = 8;
export const MARKER_FADE_DURATION = 0.4;
