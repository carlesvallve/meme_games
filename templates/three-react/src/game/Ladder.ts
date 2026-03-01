/**
 * Ladder — Pure data types for ladder nav-links between elevation levels.
 * No Three.js dependency.
 */

export interface LadderDef {
  /** Ladder mesh position (midpoint of cliff edge) */
  bottomX: number; bottomZ: number; bottomY: number;
  topY: number;
  /** Unit normal: cliff face toward open space (low side). */
  facingDX: number; facingDZ: number;
  /** World position of the low-side vertex */
  lowWorldX: number; lowWorldZ: number;
  /** World position of the high-side vertex */
  highWorldX: number; highWorldZ: number;
  /** Nav-grid cell coordinates (set by Terrain.ts after NavGrid is built) */
  bottomCellGX: number; bottomCellGZ: number;
  topCellGX: number; topCellGZ: number;
  /** Lean angle matching the cliff face slope (set by Terrain mesh creation).
   *  0 = vertical cliff, positive = tilted. Negative for character (tilt forward). */
  leanAngle?: number;
  /** Actual cliff surface positions (set by Terrain mesh creation).
   *  These are where the terrain transitions, not cell centers. */
  cliffLowX?: number; cliffLowZ?: number; cliffLowY?: number;
  cliffHighX?: number; cliffHighZ?: number; cliffHighY?: number;
  /** If true, ladder is perfectly vertical (dungeon hint ladders against cliff walls) */
  isVertical?: boolean;
}

export interface NavLink {
  toGX: number; toGZ: number;
  cost: number;
  ladderIndex: number;
}
