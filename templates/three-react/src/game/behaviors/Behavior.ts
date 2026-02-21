import type { NavGrid } from '../NavGrid';
import type { PathResult } from '../AStar';
import { findPath } from '../AStar';

/** Minimal interface a behavior needs from its owner */
export interface BehaviorAgent {
  getX(): number;
  getZ(): number;
  /** Move toward direction. Returns true if actually moved. */
  move(dx: number, dz: number, speed: number, stepHeight: number, capsuleRadius: number, dt: number): boolean;
  applyHop(hopHeight: number): number;
  updateIdle(dt: number): void;
}

export interface BehaviorContext {
  navGrid: NavGrid;
}

export type BehaviorStatus = 'running' | 'done';

export abstract class Behavior {
  protected ctx: BehaviorContext;

  constructor(ctx: BehaviorContext) {
    this.ctx = ctx;
  }

  abstract update(agent: BehaviorAgent, dt: number): BehaviorStatus;

  /** Get the current waypoints for debug visualization (if any) */
  getWaypoints(): ReadonlyArray<{ x: number; z: number }> { return []; }
  getWaypointIndex(): number { return 0; }

  /** Helper: find a path from agent to target */
  protected findPath(agent: BehaviorAgent, goalX: number, goalZ: number): PathResult {
    return findPath(this.ctx.navGrid, agent.getX(), agent.getZ(), goalX, goalZ);
  }
}
