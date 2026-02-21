import { Behavior, type BehaviorAgent, type BehaviorContext, type BehaviorStatus } from './Behavior';

export interface RoamingOptions {
  /** Movement speed */
  speed?: number;
  /** Step height for terrain traversal */
  stepHeight?: number;
  /** Capsule radius for collision */
  capsuleRadius?: number;
  /** Hop height while walking */
  hopHeight?: number;
  /** Min radius for random destination */
  radiusMin?: number;
  /** Max radius for random destination */
  radiusMax?: number;
  /** Min idle time between walks */
  idleMin?: number;
  /** Max idle time between walks */
  idleMax?: number;
  /** Distance to consider a waypoint reached */
  waypointReach?: number;
  /** Max attempts to find a walkable destination */
  maxAttempts?: number;
  /** Margin from world edge */
  worldMargin?: number;
}

const DEFAULTS: Required<RoamingOptions> = {
  speed: 4,
  stepHeight: 0.5,
  capsuleRadius: 0.25,
  hopHeight: 0.1,
  radiusMin: 3,
  radiusMax: 8,
  idleMin: 1,
  idleMax: 4,
  waypointReach: 0.3,
  maxAttempts: 8,
  worldMargin: 2,
};

type RoamState = 'idle' | 'walking';

const STUCK_TIME_LIMIT = 1.0;   // seconds without progress before giving up
const STUCK_MIN_DISTANCE = 0.15; // must move at least this far to count as progress

export class Roaming extends Behavior {
  private opts: Required<RoamingOptions>;
  private state: RoamState = 'idle';
  private idleTimer = 0;
  private waypoints: { x: number; z: number }[] = [];
  private waypointIndex = 0;
  private stuckTimer = 0;
  private lastProgressX = 0;
  private lastProgressZ = 0;

  constructor(ctx: BehaviorContext, options?: RoamingOptions) {
    super(ctx);
    this.opts = { ...DEFAULTS, ...options };
    this.idleTimer = this.randomIdle();
  }

  update(agent: BehaviorAgent, dt: number): BehaviorStatus {
    switch (this.state) {
      case 'idle':
        agent.updateIdle(dt);
        this.idleTimer -= dt;
        if (this.idleTimer <= 0) {
          this.pickDestination(agent);
        }
        break;

      case 'walking':
        this.followPath(agent, dt);
        break;
    }

    return 'running'; // Roaming never finishes on its own
  }

  getWaypoints(): ReadonlyArray<{ x: number; z: number }> {
    return this.waypoints;
  }

  getWaypointIndex(): number {
    return this.waypointIndex;
  }

  private pickDestination(agent: BehaviorAgent): void {
    const { radiusMin, radiusMax, maxAttempts, worldMargin } = this.opts;
    const halfBound = this.ctx.navGrid.getHalfSize() - worldMargin;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = radiusMin + Math.random() * (radiusMax - radiusMin);
      const tx = Math.max(-halfBound, Math.min(halfBound, agent.getX() + Math.cos(angle) * dist));
      const tz = Math.max(-halfBound, Math.min(halfBound, agent.getZ() + Math.sin(angle) * dist));

      // Check destination cell is walkable before running A*
      if (!this.ctx.navGrid.isWalkable(tx, tz)) continue;

      const result = this.findPath(agent, tx, tz);
      if (!result.found || result.path.length < 2) continue;

      this.waypoints = result.path.slice(1);
      this.waypointIndex = 0;
      this.stuckTimer = 0;
      this.lastProgressX = agent.getX();
      this.lastProgressZ = agent.getZ();
      this.state = 'walking';
      return;
    }

    // All attempts failed — wait a bit and try again
    this.idleTimer = 0.5 + Math.random() * 0.5;
  }

  private followPath(agent: BehaviorAgent, dt: number): void {
    if (this.waypointIndex >= this.waypoints.length) {
      this.enterIdle();
      return;
    }

    const target = this.waypoints[this.waypointIndex];
    const dx = target.x - agent.getX();
    const dz = target.z - agent.getZ();
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < this.opts.waypointReach) {
      this.waypointIndex++;
      this.resetStuck(agent);
      if (this.waypointIndex >= this.waypoints.length) {
        this.enterIdle();
      }
      return;
    }

    // Stuck detection: if no meaningful progress for too long, abandon path
    const movedX = agent.getX() - this.lastProgressX;
    const movedZ = agent.getZ() - this.lastProgressZ;
    const movedDist = Math.sqrt(movedX * movedX + movedZ * movedZ);
    if (movedDist > STUCK_MIN_DISTANCE) {
      this.resetStuck(agent);
    } else {
      this.stuckTimer += dt;
      if (this.stuckTimer > STUCK_TIME_LIMIT) {
        this.enterIdle();
        return;
      }
    }

    const nx = dx / dist;
    const nz = dz / dist;
    agent.move(nx, nz, this.opts.speed, this.opts.stepHeight, this.opts.capsuleRadius, dt);
    agent.applyHop(this.opts.hopHeight);
  }

  private resetStuck(agent: BehaviorAgent): void {
    this.stuckTimer = 0;
    this.lastProgressX = agent.getX();
    this.lastProgressZ = agent.getZ();
  }

  private enterIdle(): void {
    this.state = 'idle';
    this.waypoints = [];
    this.waypointIndex = 0;
    this.idleTimer = this.randomIdle();
  }

  private randomIdle(): number {
    return this.opts.idleMin + Math.random() * (this.opts.idleMax - this.opts.idleMin);
  }
}
