import { Behavior, type BehaviorAgent, type BehaviorContext, type BehaviorStatus } from './Behavior';
import type { WaypointMeta } from '../AStar';
import type { MovementParams } from '../Character';

export interface GoToPointBehaviorOptions {
  waypointReach?: number;
}

const STUCK_TIME_LIMIT = 1.5;
const STUCK_MIN_DISTANCE = 0.15;

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
        this.arrived = true;
        agent.updateIdle(dt);
        return 'done';
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

    // Stuck detection
    const movedX = agent.getX() - this.lastProgressX;
    const movedZ = agent.getZ() - this.lastProgressZ;
    const movedDist = Math.sqrt(movedX * movedX + movedZ * movedZ);
    if (movedDist > STUCK_MIN_DISTANCE) {
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
