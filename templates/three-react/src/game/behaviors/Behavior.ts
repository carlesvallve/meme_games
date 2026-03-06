import type { NavGrid } from '../pathfinding';
import type { PathResult } from '../pathfinding';
import { findPath } from '../pathfinding';
import type { LadderDef } from '../dungeon';

/** Minimal interface a behavior needs from its owner */
export interface BehaviorAgent {
  getX(): number;
  getZ(): number;
  /** Move toward direction. Returns true if actually moved. skipFacing=true keeps current orientation. */
  move(dx: number, dz: number, speed: number, stepHeight: number, capsuleRadius: number, dt: number, slopeHeight?: number, skipFacing?: boolean): boolean;
  applyHop(hopHeight: number): number;
  updateIdle(dt: number): void;
  /** Current facing angle (radians) */
  getFacing(): number;
  /** Set facing angle (radians) and sync mesh rotation */
  setFacing(angle: number): void;
  /** Whether the character is alive */
  readonly isAlive: boolean;
  /** If implemented, called once after agent took damage (so behavior can clear settle/speed and avoid walk-after-hit). */
  consumeJustTookDamage?(): boolean;
  /** Start climbing a ladder */
  startClimb(ladder: LadderDef, direction: 'up' | 'down'): void;
  /** Update climbing animation, returns true while climbing */
  updateClimb(dt: number): boolean;
  /** Check if character is currently climbing */
  isClimbing(): boolean;
  /** Whether the character is currently attacking */
  readonly isAttacking?: boolean;
}

export interface BehaviorContext {
  navGrid: NavGrid;
  ladderDefs: ReadonlyArray<LadderDef>;
}

export type BehaviorStatus = 'running' | 'done';

export abstract class Behavior {
  protected ctx: BehaviorContext;

  constructor(ctx: BehaviorContext) {
    this.ctx = ctx;
  }

  abstract update(agent: BehaviorAgent, dt: number): BehaviorStatus;

  /** Get the smoothed waypoints for movement */
  getWaypoints(): ReadonlyArray<{ x: number; z: number }> { return []; }
  getWaypointIndex(): number { return 0; }
  /** Get the full grid-cell path for debug visualization (before string-pulling) */
  getRawWaypoints(): ReadonlyArray<{ x: number; z: number }> { return []; }

  /** Helper: find a path from agent to target */
  protected findPath(agent: BehaviorAgent, goalX: number, goalZ: number): PathResult {
    return findPath(this.ctx.navGrid, agent.getX(), agent.getZ(), goalX, goalZ);
  }
}
