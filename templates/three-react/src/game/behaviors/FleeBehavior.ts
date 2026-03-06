import { Behavior, type BehaviorAgent, type BehaviorContext, type BehaviorStatus } from './Behavior';
import type { WaypointMeta } from '../pathfinding';
import type { MovementParams } from '../character';

type FleeState = 'fleeing' | 'hiding';

const REPATH_INTERVAL = 0.8;
const STUCK_TIME_LIMIT = 1.0;
const STUCK_MIN_DISTANCE = 0.15;
const WAYPOINT_REACH = 0.3;
/** Speed boost while fleeing (panic run). */
const FLEE_SPEED_MULT = 1.3;
/** Safe distance (world units) — once reached, switch to hiding. */
const SAFE_DISTANCE = 6;
/** Max consecutive pathfind failures before giving up fleeing. */
const MAX_PATH_FAILURES = 3;

export class FleeBehavior extends Behavior {
  private movementParams: MovementParams;
  private state: FleeState = 'fleeing';
  private threat: BehaviorAgent | null = null;

  private waypoints: { x: number; z: number }[] = [];
  private waypointMeta: WaypointMeta[] = [];
  private waypointIndex = 0;
  private repathTimer = 0;

  private stuckTimer = 0;
  private lastProgressX = 0;
  private lastProgressZ = 0;
  private isOnLadder = false;
  private pathFailures = 0;

  constructor(ctx: BehaviorContext, movementParams: MovementParams) {
    super(ctx);
    this.movementParams = movementParams;
  }

  setThreat(threat: BehaviorAgent | null): void {
    this.threat = threat;
    this.state = 'fleeing';
    this.waypoints = [];
    this.waypointIndex = 0;
    this.repathTimer = 0;
    this.pathFailures = 0;
  }

  getState(): FleeState {
    return this.state;
  }

  override getWaypoints(): ReadonlyArray<{ x: number; z: number }> {
    return this.waypoints;
  }

  override getWaypointIndex(): number {
    return this.waypointIndex;
  }

  update(agent: BehaviorAgent, dt: number): BehaviorStatus {
    if (!this.threat) {
      agent.updateIdle(dt);
      return 'done';
    }

    const dx = agent.getX() - this.threat.getX();
    const dz = agent.getZ() - this.threat.getZ();
    const distFromThreat = Math.sqrt(dx * dx + dz * dz);

    // If far enough, switch to hiding (idle in place, regen)
    if (distFromThreat >= SAFE_DISTANCE) {
      this.state = 'hiding';
      this.waypoints = [];
      this.waypointIndex = 0;
      agent.updateIdle(dt);
      return 'running';
    }

    this.state = 'fleeing';

    // Handle active climbing
    if (this.isOnLadder) {
      if (agent.updateClimb(dt)) return 'running';
      this.isOnLadder = false;
      this.waypointIndex++;
      this.resetStuck(agent);
      if (this.waypointIndex >= this.waypoints.length) {
        this.waypoints = [];
        this.waypointIndex = 0;
      }
      return 'running';
    }

    // Repath periodically — pick a flee target away from threat
    this.repathTimer -= dt;
    if (this.repathTimer <= 0 || this.waypoints.length === 0) {
      this.repathTimer = REPATH_INTERVAL;
      this.repathAway(agent);
    }

    // Too many path failures — give up fleeing, switch to chase
    if (this.pathFailures >= MAX_PATH_FAILURES) {
      this.state = 'fleeing';
      agent.updateIdle(dt);
      return 'done';
    }

    // Follow waypoints
    if (this.waypointIndex < this.waypoints.length) {
      this.followPath(agent, dt);
    } else {
      // No path — idle until repath finds one (don't walk into walls)
      agent.updateIdle(dt);
    }

    return 'running';
  }

  /** Find a point away from the threat and pathfind to it. */
  private repathAway(agent: BehaviorAgent): void {
    if (!this.threat) return;
    const ax = agent.getX();
    const az = agent.getZ();
    const tx = this.threat.getX();
    const tz = this.threat.getZ();

    // Direction away from threat
    const dx = ax - tx;
    const dz = az - tz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const ndx = dist > 0.01 ? dx / dist : Math.random() - 0.5;
    const ndz = dist > 0.01 ? dz / dist : Math.random() - 0.5;

    // Try a few flee targets at varying angles, pick the one that works
    const fleeDistance = SAFE_DISTANCE + 2;
    const angles = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2];
    for (const angle of angles) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const fdx = ndx * cos - ndz * sin;
      const fdz = ndx * sin + ndz * cos;
      const goalX = ax + fdx * fleeDistance;
      const goalZ = az + fdz * fleeDistance;

      const result = this.findPath(agent, goalX, goalZ);
      if (result.found && result.path.length >= 2) {
        this.waypoints = result.path.slice(1);
        this.waypointMeta = result.meta.slice(1);
        this.waypointIndex = 0;
        this.resetStuck(agent);
        this.pathFailures = 0;
        return;
      }
    }
    // All angles failed
    this.waypoints = [];
    this.waypointIndex = 0;
    this.pathFailures++;
  }

  private followPath(agent: BehaviorAgent, dt: number): void {
    if (this.waypointIndex >= this.waypoints.length) return;

    const target = this.waypoints[this.waypointIndex];
    const dx = target.x - agent.getX();
    const dz = target.z - agent.getZ();
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < WAYPOINT_REACH) {
      this.waypointIndex++;
      this.resetStuck(agent);
      if (this.waypointIndex >= this.waypoints.length) return;

      // Check ladder
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

    // Stuck detection
    const movedX = agent.getX() - this.lastProgressX;
    const movedZ = agent.getZ() - this.lastProgressZ;
    if (Math.sqrt(movedX * movedX + movedZ * movedZ) > STUCK_MIN_DISTANCE) {
      this.resetStuck(agent);
    } else {
      this.stuckTimer += dt;
      if (this.stuckTimer > STUCK_TIME_LIMIT) {
        this.waypoints = [];
        this.waypointIndex = 0;
        this.repathTimer = 0;
        this.pathFailures++;
        return;
      }
    }

    const nx = dx / dist;
    const nz = dz / dist;
    const mp = this.movementParams;
    const speed = mp.speed * FLEE_SPEED_MULT;
    agent.move(nx, nz, speed, mp.stepHeight, mp.capsuleRadius, dt, mp.slopeHeight);
    agent.applyHop(mp.hopHeight);
  }

  private resetStuck(agent: BehaviorAgent): void {
    this.stuckTimer = 0;
    this.lastProgressX = agent.getX();
    this.lastProgressZ = agent.getZ();
  }
}
