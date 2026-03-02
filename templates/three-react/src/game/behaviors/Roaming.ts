import { Behavior, type BehaviorAgent, type BehaviorContext, type BehaviorStatus } from './Behavior';
import type { WaypointMeta } from '../pathfinding';
import type { MovementParams } from '../character';

export interface RoamingBehaviorOptions {
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

const BEHAVIOR_DEFAULTS: Required<RoamingBehaviorOptions> = {
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
  private movementParams: MovementParams;
  private opts: Required<RoamingBehaviorOptions>;
  private state: RoamState = 'idle';

  /** When true, movement directions are randomly scrambled */
  public confusionActive = false;
  private idleTimer = 0;
  private waypoints: { x: number; z: number }[] = [];
  private rawWaypoints: { x: number; z: number }[] = [];
  private waypointMeta: WaypointMeta[] = [];
  private waypointIndex = 0;
  private stuckTimer = 0;
  private lastProgressX = 0;
  private lastProgressZ = 0;
  private isOnLadder = false;

  constructor(ctx: BehaviorContext, movementParams: MovementParams, options?: RoamingBehaviorOptions) {
    super(ctx);
    this.movementParams = movementParams;
    this.opts = { ...BEHAVIOR_DEFAULTS, ...options };
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

  getRawWaypoints(): ReadonlyArray<{ x: number; z: number }> {
    return this.rawWaypoints;
  }

  private pickDestination(agent: BehaviorAgent): void {
    const { radiusMin, radiusMax, maxAttempts, worldMargin } = this.opts;
    const halfBound = this.ctx.navGrid.getHalfSize() - worldMargin;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = radiusMin + Math.random() * (radiusMax - radiusMin);
      const rawX = Math.max(-halfBound, Math.min(halfBound, agent.getX() + Math.cos(angle) * dist));
      const rawZ = Math.max(-halfBound, Math.min(halfBound, agent.getZ() + Math.sin(angle) * dist));

      // Snap to nav grid cell center
      const snapped = this.ctx.navGrid.snapToGrid(rawX, rawZ);
      const tx = snapped.x;
      const tz = snapped.z;

      // Check destination cell is walkable before running A*
      if (!this.ctx.navGrid.isWalkable(tx, tz)) continue;

      const result = this.findPath(agent, tx, tz);
      if (!result.found || result.path.length < 2) continue;

      this.waypoints = result.path.slice(1);
      this.rawWaypoints = result.rawPath.slice(1);
      this.waypointMeta = result.meta.slice(1);
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
    // Handle active climbing
    if (this.isOnLadder) {
      if (agent.updateClimb(dt)) {
        return; // still climbing
      }
      // Climb finished — advance past ladder waypoint
      this.isOnLadder = false;
      this.waypointIndex++;
      this.resetStuck(agent);
      if (this.waypointIndex >= this.waypoints.length) {
        this.enterIdle();
      }
      return;
    }

    if (this.waypointIndex >= this.waypoints.length) {
      this.enterIdle();
      return;
    }

    const target = this.waypoints[this.waypointIndex];
    const dx = target.x - agent.getX();
    const dz = target.z - agent.getZ();
    const dist = Math.sqrt(dx * dx + dz * dz);
    const isLast = this.waypointIndex === this.waypoints.length - 1;

    const mp = this.movementParams;
    const reach = isLast ? mp.arrivalReach : this.opts.waypointReach;

    if (dist < reach) {
      this.waypointIndex++;
      this.resetStuck(agent);
      if (this.waypointIndex >= this.waypoints.length) {
        this.enterIdle();
        return;
      }

      // After arriving at a waypoint, check if the NEXT waypoint is a ladder arrival cell.
      // If so, trigger the climb immediately from here (the departure cell).
      const newMeta = this.waypointMeta[this.waypointIndex];
      if (newMeta && newMeta.ladderIndex !== null) {
        const ladder = this.ctx.ladderDefs[newMeta.ladderIndex];
        if (ladder) {
          agent.startClimb(ladder, newMeta.climbDirection ?? 'up');
          this.isOnLadder = true;
          return;
        }
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

    let nx = dx / dist;
    let nz = dz / dist;
    // Confusion: randomly rotate movement direction
    if (this.confusionActive && Math.random() < 0.15) {
      const angles = [Math.PI / 2, Math.PI, -Math.PI / 2];
      const rot = angles[Math.floor(Math.random() * 3)];
      const c = Math.cos(rot), s = Math.sin(rot);
      const onx = nx;
      nx = onx * c - nz * s;
      nz = onx * s + nz * c;
    }
    // Clamp speed so the character decelerates into the final waypoint
    // and never overshoots it
    let speed = mp.speed;
    if (isLast) {
      const maxStep = dist / dt;
      speed = Math.min(speed, Math.max(0.5, maxStep));
    }
    agent.move(nx, nz, speed, mp.stepHeight, mp.capsuleRadius, dt, mp.slopeHeight);
    agent.applyHop(mp.hopHeight);
  }

  private resetStuck(agent: BehaviorAgent): void {
    this.stuckTimer = 0;
    this.lastProgressX = agent.getX();
    this.lastProgressZ = agent.getZ();
  }

  private enterIdle(): void {
    this.state = 'idle';
    this.waypoints = [];
    this.rawWaypoints = [];
    this.waypointMeta = [];
    this.waypointIndex = 0;
    this.isOnLadder = false;
    this.idleTimer = this.randomIdle();
  }

  private randomIdle(): number {
    return this.opts.idleMin + Math.random() * (this.opts.idleMax - this.opts.idleMin);
  }
}
