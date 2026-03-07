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
/** Cost multiplier for climbing up (ascending stairs). Keep low so stairs ≈ 1 cell cost. */
export const CLIMB_PENALTY = 0.5;
/** Cost multiplier for descent — slight preference for staying elevated. */
export const DESCENT_PENALTY = 0.5;
/** Per-vertical-cell cost multiplier for ladder nav-links. Slightly above 1 so A* prefers stairs when both exist. */
export const LADDER_COST = 1.2;

// ── Ladder / Climbing ────────────────────────────────────────────────
export const LADDER_COLOR = 0x8B6914; // wood brown
export const LADDER_RUNG_SPACING = 0.5; // meters between rungs (matches cell size)
export const LADDER_RAIL_WIDTH = 0.25; // side-to-side between rails
export const LADDER_RAIL_THICKNESS = 0.04;
export const LADDER_RUNG_THICKNESS = 0.03;
export const LADDER_WALL_OFFSET = 0.06; // distance from cliff face
export const CLIMB_SPEED = 3.0; // m/s up the ladder
export const MOUNT_SPEED = 3.0; // m/s toward ladder entry
export const DISMOUNT_SPEED = 3.0; // m/s away from ladder
export const CLIMB_WALL_OFFSET = 0.15; // character offset from cliff face
export const RUNG_PAUSE = 0.04; // seconds pause at each rung
export const DISMOUNT_DIST = 0.3; // how far to walk off the ladder
export const LADDER_SEARCH_RADIUS = 2; // navgrid cells to search for ladders
export const LADDER_DOT_THRESHOLD = 0.3; // min alignment with movement direction

// ── UI / Markers (Game.ts) ───────────────────────────────────────────
export const RING_STROKE = 0.05;
export const MARKER_SNAP_SPEED = 16;
export const GOAL_DRAG_THRESHOLD = 8;
export const MARKER_FADE_DURATION = 0.4;
