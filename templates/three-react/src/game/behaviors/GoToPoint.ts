import { Behavior, type BehaviorAgent, type BehaviorContext, type BehaviorStatus } from './Behavior';
import type { WaypointMeta } from '../pathfinding';
import type { MovementParams } from '../character';

export interface GoToPointBehaviorOptions {
  waypointReach?: number;
}

const STUCK_TIME_LIMIT = 0.8;
const STUCK_MIN_PROGRESS = 0.08;

/**
 * Move to a specific world point via A* pathfinding, then report 'done'.
 * Used for point-and-click NPC control.
 */
export class GoToPoint extends Behavior {
  private movementParams: MovementParams;
  private waypointReach: number;
  private waypoints: { x: number; z: number }[] = [];
  private rawWaypoints: { x: number; z: number }[] = [];
  private waypointMeta: WaypointMeta[] = [];
  private waypointIndex = 0;
  private stuckTimer = 0;
  private isOnLadder = false;
  private lastProgressX = 0;
  private lastProgressZ = 0;
  private arrived = false;
  private tweening = false;

  constructor(ctx: BehaviorContext, movementParams: MovementParams, private goalX: number, private goalZ: number, options?: GoToPointBehaviorOptions) {
    super(ctx);
    this.movementParams = movementParams;
    this.waypointReach = options?.waypointReach ?? 0.3;
  }

  update(agent: BehaviorAgent, dt: number): BehaviorStatus {
    if (this.arrived) {
      agent.updateIdle(dt);
      return 'done';
    }

    // Tween to exact goal position after reaching arrival threshold
    if (this.tweening) {
      const dx = this.goalX - agent.getX();
      const dz = this.goalZ - agent.getZ();
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 0.01) {
        this.arrived = true;
        agent.updateIdle(dt);
        return 'done';
      }
      const mp = this.movementParams;
      const nx = dx / dist;
      const nz = dz / dist;
      // Slow approach speed so it looks like a smooth settle
      const tweenSpeed = Math.min(mp.speed * 0.5, dist / dt);
      agent.move(nx, nz, tweenSpeed, mp.stepHeight, mp.capsuleRadius, dt, mp.slopeHeight);
      return 'running';
    }

    // Lazy path computation on first update
    if (this.waypoints.length === 0 && this.waypointIndex === 0) {
      const result = this.findPath(agent, this.goalX, this.goalZ);
      if (!result.found || result.path.length < 2) {
        this.arrived = true;
        agent.updateIdle(dt);
        return 'done';
      }
      this.waypoints = result.path.slice(1);
      this.rawWaypoints = result.rawPath.slice(1);
      this.waypointMeta = result.meta.slice(1);
      this.waypointIndex = 0;
      this.lastProgressX = agent.getX();
      this.lastProgressZ = agent.getZ();
    }

    // Handle active climbing
    if (this.isOnLadder) {
      if (agent.updateClimb(dt)) {
        return 'running'; // still climbing
      }
      // Climb finished — advance past ladder waypoint
      this.isOnLadder = false;
      this.waypointIndex++;
      this.resetStuck(agent);
      if (this.waypointIndex >= this.waypoints.length) {
        this.arrived = true;
        agent.updateIdle(dt);
        return 'done';
      }
      return 'running';
    }

    // Follow waypoints
    if (this.waypointIndex >= this.waypoints.length) {
      this.arrived = true;
      agent.updateIdle(dt);
      return 'done';
    }

    const target = this.waypoints[this.waypointIndex];
    const dx = target.x - agent.getX();
    const dz = target.z - agent.getZ();
    const dist = Math.sqrt(dx * dx + dz * dz);
    const isLast = this.waypointIndex === this.waypoints.length - 1;

    const mp = this.movementParams;
    const reach = isLast ? mp.arrivalReach : this.waypointReach;

    if (dist < reach) {
      this.waypointIndex++;
      this.resetStuck(agent);
      if (this.waypointIndex >= this.waypoints.length) {
        // Skip tweening if the goal cell is adjacent to any blocked cell —
        // tweening toward the exact position would fight wall/debris collision.
        const navGrid = this.ctx.navGrid;
        const { gx: goalGx, gz: goalGz } = navGrid.worldToGrid(this.goalX, this.goalZ);
        const perfectFit = navGrid.hasBlockedNeighbor(goalGx, goalGz);
        if (perfectFit) {
          this.arrived = true;
          agent.updateIdle(dt);
          return 'done';
        }
        // Enter tween phase to settle on exact goal position
        this.tweening = true;
        return 'running';
      }

      // After arriving at a waypoint, check if the NEXT waypoint is a ladder arrival cell.
      // If so, trigger the climb immediately from here (the departure cell).
      const newMeta = this.waypointMeta[this.waypointIndex];
      if (newMeta && newMeta.ladderIndex !== null) {
        const ladder = this.ctx.ladderDefs[newMeta.ladderIndex];
        if (ladder) {
          agent.startClimb(ladder, newMeta.climbDirection ?? 'up');
          this.isOnLadder = true;
          return 'running';
        }
      }

      return 'running';
    }

    // Stuck detection: check progress TOWARD target, not total movement.
    // Sliding along a cliff contour shouldn't count as progress.
    const curDistToTarget = dist;
    const prevDx = target.x - this.lastProgressX;
    const prevDz = target.z - this.lastProgressZ;
    const prevDistToTarget = Math.sqrt(prevDx * prevDx + prevDz * prevDz);
    const progressToward = prevDistToTarget - curDistToTarget;
    if (progressToward > STUCK_MIN_PROGRESS) {
      this.resetStuck(agent);
    } else {
      this.stuckTimer += dt;
      if (this.stuckTimer > STUCK_TIME_LIMIT) {
        this.arrived = true;
        agent.updateIdle(dt);
        return 'done';
      }
    }

    const nx = dx / dist;
    const nz = dz / dist;
    // Clamp speed so the character decelerates into the final waypoint
    // and never overshoots it
    let speed = mp.speed;
    if (isLast) {
      const maxStep = dist / dt; // speed that would land exactly on target this frame
      speed = Math.min(speed, Math.max(0.5, maxStep));
    }
    agent.move(nx, nz, speed, mp.stepHeight, mp.capsuleRadius, dt, mp.slopeHeight);
    agent.applyHop(mp.hopHeight);

    return 'running';
  }

  getWaypoints(): ReadonlyArray<{ x: number; z: number }> {
    return this.waypoints;
  }

  getWaypointIndex(): number {
    return this.waypointIndex;
  }

  getRawWaypoints(): ReadonlyArray<{ x: number; z: number }> {
    return this.rawWaypoints;
  }

  private resetStuck(agent: BehaviorAgent): void {
    this.stuckTimer = 0;
    this.lastProgressX = agent.getX();
    this.lastProgressZ = agent.getZ();
  }
}
