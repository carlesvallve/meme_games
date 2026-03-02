import { Behavior, type BehaviorAgent, type BehaviorContext, type BehaviorStatus } from './Behavior';
import type { WaypointMeta } from '../pathfinding';
import type { MovementParams } from '../character';

type ChaseState = 'idle' | 'chase' | 'attack';

const REPATH_INTERVAL = 0.5;
const STUCK_TIME_LIMIT = 1.0;
const STUCK_MIN_DISTANCE = 0.15;
const WAYPOINT_REACH = 0.3;

export class ChaseBehavior extends Behavior {
  private movementParams: MovementParams;
  private attackRange: number;
  private attackCooldown: number;
  private chaseRange: number;

  /** When true, movement directions are randomly scrambled */
  public confusionActive = false;

  private state: ChaseState = 'idle';
  private target: BehaviorAgent | null = null;
  private targetAlive = true;

  private waypoints: { x: number; z: number }[] = [];
  private waypointMeta: WaypointMeta[] = [];
  private waypointIndex = 0;
  private repathTimer = 0;

  private attackCooldownTimer = 0;
  private stuckTimer = 0;
  private lastProgressX = 0;
  private lastProgressZ = 0;
  private isOnLadder = false;

  constructor(
    ctx: BehaviorContext,
    movementParams: MovementParams,
    attackRange = 0.5,
    attackCooldown = 1.2,
    chaseRange = 8,
  ) {
    super(ctx);
    this.movementParams = movementParams;
    this.attackRange = attackRange;
    this.attackCooldown = attackCooldown;
    this.chaseRange = chaseRange;
  }

  setTarget(char: BehaviorAgent | null, alive = true): void {
    this.target = char;
    this.targetAlive = alive;
  }

  update(agent: BehaviorAgent, dt: number): BehaviorStatus {
    // Tick attack cooldown
    if (this.attackCooldownTimer > 0) {
      this.attackCooldownTimer -= dt;
    }

    // No target or target dead -> idle
    if (!this.target || !this.targetAlive) {
      this.state = 'idle';
      agent.updateIdle(dt);
      return 'running';
    }

    const dx = this.target.getX() - agent.getX();
    const dz = this.target.getZ() - agent.getZ();
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Out of chase range -> idle
    if (dist > this.chaseRange) {
      this.state = 'idle';
      this.waypoints = [];
      this.waypointIndex = 0;
      agent.updateIdle(dt);
      return 'running';
    }

    // Within attack range -> attack when cooldown ready, otherwise hold position
    if (dist <= this.attackRange) {
      if (this.attackCooldownTimer <= 0) {
        this.state = 'attack';
        this.attackCooldownTimer = this.attackCooldown;
      } else {
        this.state = 'idle'; // cooling down — don't signal attack
      }
      this.waypoints = [];
      this.waypointIndex = 0;
      agent.updateIdle(dt);
      return 'running';
    }

    // Chase
    this.state = 'chase';

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

    // Repath periodically
    this.repathTimer -= dt;
    if (this.repathTimer <= 0 || this.waypoints.length === 0) {
      this.repathTimer = REPATH_INTERVAL;
      this.repath(agent);
    }

    // Follow waypoints
    if (this.waypointIndex < this.waypoints.length) {
      this.followPath(agent, dt);
    } else {
      // No path - try direct movement
      if (dist > 0.1) {
        let nx = dx / dist;
        let nz = dz / dist;
        if (this.confusionActive && Math.random() < 0.15) {
          [nx, nz] = ChaseBehavior.scrambleDir(nx, nz);
        }
        agent.move(nx, nz, this.movementParams.speed, this.movementParams.stepHeight, this.movementParams.capsuleRadius, dt, this.movementParams.slopeHeight);
        agent.applyHop(this.movementParams.hopHeight);
      } else {
        agent.updateIdle(dt);
      }
    }

    return 'running';
  }

  getState(): ChaseState {
    return this.state;
  }

  getWaypoints(): ReadonlyArray<{ x: number; z: number }> {
    return this.waypoints;
  }

  getWaypointIndex(): number {
    return this.waypointIndex;
  }

  private repath(agent: BehaviorAgent): void {
    if (!this.target) return;
    const result = this.findPath(agent, this.target.getX(), this.target.getZ());
    if (result.found && result.path.length >= 2) {
      this.waypoints = result.path.slice(1);
      this.waypointMeta = result.meta.slice(1);
      this.waypointIndex = 0;
      this.resetStuck(agent);
    }
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
        this.repathTimer = 0; // force immediate repath
        return;
      }
    }

    let nx = dx / dist;
    let nz = dz / dist;
    if (this.confusionActive && Math.random() < 0.15) {
      [nx, nz] = ChaseBehavior.scrambleDir(nx, nz);
    }
    const mp = this.movementParams;
    agent.move(nx, nz, mp.speed, mp.stepHeight, mp.capsuleRadius, dt, mp.slopeHeight);
    agent.applyHop(mp.hopHeight);
  }

  /** Rotate a direction vector by a random 90/180/270° */
  private static scrambleDir(nx: number, nz: number): [number, number] {
    const angles = [Math.PI / 2, Math.PI, -Math.PI / 2];
    const rot = angles[Math.floor(Math.random() * 3)];
    const c = Math.cos(rot), s = Math.sin(rot);
    return [nx * c - nz * s, nx * s + nz * c];
  }

  private resetStuck(agent: BehaviorAgent): void {
    this.stuckTimer = 0;
    this.lastProgressX = agent.getX();
    this.lastProgressZ = agent.getZ();
  }
}
