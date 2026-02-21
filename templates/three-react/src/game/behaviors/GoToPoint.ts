import { Behavior, type BehaviorAgent, type BehaviorContext, type BehaviorStatus } from './Behavior';

export interface GoToPointOptions {
  speed?: number;
  stepHeight?: number;
  slopeHeight?: number;
  capsuleRadius?: number;
  hopHeight?: number;
  waypointReach?: number;
}

const DEFAULTS: Required<GoToPointOptions> = {
  speed: 4,
  stepHeight: 0.5,
  slopeHeight: 1.0,
  capsuleRadius: 0.25,
  hopHeight: 0.1,
  waypointReach: 0.3,
};

const STUCK_TIME_LIMIT = 1.5;
const STUCK_MIN_DISTANCE = 0.15;

/**
 * Move to a specific world point via A* pathfinding, then report 'done'.
 * Used for point-and-click NPC control.
 */
export class GoToPoint extends Behavior {
  private opts: Required<GoToPointOptions>;
  private waypoints: { x: number; z: number }[] = [];
  private rawWaypoints: { x: number; z: number }[] = [];
  private waypointIndex = 0;
  private stuckTimer = 0;
  private lastProgressX = 0;
  private lastProgressZ = 0;
  private arrived = false;

  constructor(ctx: BehaviorContext, private goalX: number, private goalZ: number, options?: GoToPointOptions) {
    super(ctx);
    this.opts = { ...DEFAULTS, ...options };
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
      this.waypointIndex = 0;
      this.lastProgressX = agent.getX();
      this.lastProgressZ = agent.getZ();
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

    const reach = isLast ? 0.02 : this.opts.waypointReach;

    if (dist < reach) {
      this.waypointIndex++;
      this.resetStuck(agent);
      if (this.waypointIndex >= this.waypoints.length) {
        this.arrived = true;
        agent.updateIdle(dt);
        return 'done';
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
    let speed = this.opts.speed;
    if (isLast) {
      const maxStep = dist / dt; // speed that would land exactly on target this frame
      speed = Math.min(speed, Math.max(0.5, maxStep));
    }
    agent.move(nx, nz, speed, this.opts.stepHeight, this.opts.capsuleRadius, dt, this.opts.slopeHeight);
    agent.applyHop(this.opts.hopHeight);

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
