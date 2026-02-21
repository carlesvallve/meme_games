import type { NavGrid } from '../NavGrid';
import type { PathResult } from '../AStar';
import { findPath } from '../AStar';
import type { LadderDef } from '../Ladder';

/** Minimal interface a behavior needs from its owner */
export interface BehaviorAgent {
  getX(): number;
  getZ(): number;
  /** Move toward direction. Returns true if actually moved. */
  move(dx: number, dz: number, speed: number, stepHeight: number, capsuleRadius: number, dt: number, slopeHeight?: number): boolean;
  applyHop(hopHeight: number): number;
  updateIdle(dt: number): void;
  /** Start climbing a ladder */
  startClimb(ladder: LadderDef, direction: 'up' | 'down'): void;
  /** Update climbing animation, returns true while climbing */
  updateClimb(dt: number): boolean;
  /** Check if character is currently climbing */
  isClimbing(): boolean;
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
