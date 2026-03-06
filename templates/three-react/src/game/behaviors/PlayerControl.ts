import { Behavior, type BehaviorAgent, type BehaviorStatus } from './Behavior';
import type { InputState } from '../core/Input';
import type { MovementParams } from '../character';
import { audioSystem } from '../../utils/AudioSystem';

/** Dependencies injected at construction (not per-frame). */
export interface PlayerControlDeps {
  getInput: () => InputState;
  getCameraAngleY: () => number;
  getParams: () => MovementParams;
  isConfused?: () => boolean;
}

/**
 * WASD input handling as a behavior.
 * Camera-relative movement, ladder auto-trigger, hop animation + step SFX.
 * Returns 'running' always (never finishes).
 */
/** How fast current speed ramps toward target speed (units/s²) */
const ACCEL_RATE = 20;
const DECEL_RATE = 14;

export class PlayerControl extends Behavior {
  private deps: PlayerControlDeps;
  /** Grid-settle target when keys released in grid mode */
  private settleTarget: { x: number; z: number } | null = null;
  private settleSpeed = 0;
  /** Current movement speed (smoothed) */
  private currentSpeed = 0;

  constructor(ctx: ConstructorParameters<typeof Behavior>[0], deps: PlayerControlDeps) {
    super(ctx);
    this.deps = deps;
  }

  update(agent: BehaviorAgent, dt: number): BehaviorStatus {
    // Stop all input when dead
    if (!agent.isAlive) return 'running';

    // Clear movement state when player just took damage so we don't walk (e.g. grid settle) after hit
    if (agent.consumeJustTookDamage?.()) {
      this.settleTarget = null;
      this.currentSpeed = 0;
    }

    // If climbing, bypass WASD movement
    if (agent.isClimbing()) {
      agent.updateClimb(dt);
      return 'running';
    }

    const inputState = this.deps.getInput();
    const cameraAngleY = this.deps.getCameraAngleY();
    const params = this.deps.getParams();

    // Camera-relative movement
    let mx = 0;
    let mz = 0;

    if (inputState.forward) { mx -= Math.sin(cameraAngleY); mz -= Math.cos(cameraAngleY); }
    if (inputState.backward) { mx += Math.sin(cameraAngleY); mz += Math.cos(cameraAngleY); }
    if (inputState.left) { mx -= Math.cos(cameraAngleY); mz += Math.sin(cameraAngleY); }
    if (inputState.right) { mx += Math.cos(cameraAngleY); mz -= Math.sin(cameraAngleY); }

    // Confusion: invert movement controls (forward ↔ backward, left ↔ right)
    const confused = this.deps.isConfused?.() ?? false;
    if (confused && (mx !== 0 || mz !== 0)) {
      mx = -mx;
      mz = -mz;
    }

    const moveLen = Math.sqrt(mx * mx + mz * mz);
    if (moveLen > 0.001) {
      mx /= moveLen;
      mz /= moveLen;

      // Grid mode: snap direction to nearest 45° (8 directions)
      if (params.movementMode === 'grid') {
        const angle = Math.atan2(mx, mz);
        const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        mx = Math.sin(snapped);
        mz = Math.cos(snapped);
      }

      // Cancel any settle — player is actively moving
      this.settleTarget = null;

      // Accelerate toward target speed
      this.currentSpeed = Math.min(params.speed, this.currentSpeed + ACCEL_RATE * dt);

      // Slow down while attacking — heavy attacks lose more momentum
      if (agent.isAttacking) {
        const holdTime = params.actionHoldTime;
        // Map holdTime to speed reduction: fast chars (0.03) keep ~90% speed, slow chars (0.35) keep ~30%
        const keepFraction = 1 - Math.min(0.2, holdTime * 0.5);
        this.currentSpeed *= keepFraction;
      }

      const beforeX = agent.getX();
      const beforeZ = agent.getZ();
      agent.move(mx, mz, this.currentSpeed, params.stepHeight, params.capsuleRadius, dt, params.slopeHeight);

      // Ladder trigger: if movement was blocked (cliff prevention), check for ladder in that direction.
      // Search nearby navGrid cells (not just the exact one) because cliff blocking stops the player
      // at the dungeon cell edge, while nav-links are at the dungeon cell center.
      const navGrid = this.ctx.navGrid;
      const ladderDefs = this.ctx.ladderDefs;
      if (ladderDefs.length > 0) {
        const movedDist = Math.sqrt((agent.getX() - beforeX) ** 2 + (agent.getZ() - beforeZ) ** 2);
        if (movedDist < 0.001) {
          // Movement was blocked — search nearby cells for ladder nav-links
          const { gx: cgx, gz: cgz } = navGrid.worldToGrid(agent.getX(), agent.getZ());
          const SEARCH_R = 2; // search radius in navGrid cells (~0.5m)
          let bestDot = 0.3; // minimum threshold
          let bestLadder: typeof ladderDefs[0] | null = null;
          let bestDir: 'up' | 'down' = 'up';
          for (let dz = -SEARCH_R; dz <= SEARCH_R; dz++) {
            for (let dx = -SEARCH_R; dx <= SEARCH_R; dx++) {
              const sx = cgx + dx, sz = cgz + dz;
              const links = navGrid.getNavLinks(sx, sz);
              if (!links) continue;
              for (const link of links) {
                const ladder = ladderDefs[link.ladderIndex];
                if (!ladder) continue;
                // Direction from player's actual cell to the link target
                const linkDirX = link.toGX - cgx;
                const linkDirZ = link.toGZ - cgz;
                const linkLen = Math.sqrt(linkDirX * linkDirX + linkDirZ * linkDirZ);
                if (linkLen < 0.001) continue;
                const dot = mx * (linkDirX / linkLen) + mz * (linkDirZ / linkLen);
                if (dot > bestDot) {
                  const cell = navGrid.getCell(sx, sz);
                  const targetCell = navGrid.getCell(link.toGX, link.toGZ);
                  if (cell && targetCell) {
                    bestDot = dot;
                    bestLadder = ladder;
                    bestDir = targetCell.surfaceHeight > cell.surfaceHeight ? 'up' : 'down';
                  }
                }
              }
            }
          }
          if (bestLadder) {
            agent.startClimb(bestLadder, bestDir);
            return 'running';
          }
        }
      }

      // Hop + step SFX
      const currentHopHalf = agent.applyHop(params.hopHeight);
      // applyHop emits SFX for player-controlled via the Character's overridden method
    } else if (params.movementMode === 'grid' && this.updateSettle(agent, dt, params)) {
      // Settling to grid center (only when we were moving with intent — not when pushed)
    } else if (this.currentSpeed > 0.1) {
      // Decelerate to stop (free mode or grid mode without settle target)
      this.currentSpeed = Math.max(0, this.currentSpeed - DECEL_RATE * dt);
      // Keep moving in last direction with decaying speed — handled by idle with visual decay
      agent.updateIdle(dt);
    } else {
      this.currentSpeed = 0;
      this.settleTarget = null;
      agent.updateIdle(dt);
    }

    return 'running';
  }

  /** Glide to nearest grid cell center with deceleration. Only when we were moving with intent (player released keys), not when pushed. */
  private updateSettle(agent: BehaviorAgent, dt: number, params: MovementParams): boolean {
    const navGrid = this.ctx.navGrid;

    // Only start a settle when we had intentional movement (player released keys after moving). If we're idle and got pushed, don't snap.
    if (!this.settleTarget) {
      if (this.currentSpeed <= 0.1) return false; // wasn't moving with intent — e.g. pushed by monsters — don't walk to grid
      const snapped = navGrid.snapToGrid(agent.getX(), agent.getZ());
      this.settleTarget = snapped;
      this.settleSpeed = this.currentSpeed;
    }

    const dx = this.settleTarget.x - agent.getX();
    const dz = this.settleTarget.z - agent.getZ();
    const dist = Math.sqrt(dx * dx + dz * dz);

    // Close enough — done settling
    if (dist < 0.01) {
      this.settleTarget = null;
      this.currentSpeed = 0;
      // Snap facing to nearest 45°
      const snappedAngle = Math.round(agent.getFacing() / (Math.PI / 4)) * (Math.PI / 4);
      agent.setFacing(snappedAngle);
      agent.updateIdle(dt);
      return false;
    }

    // Decelerate toward target
    this.settleSpeed = Math.max(params.speed * 0.15, this.settleSpeed - DECEL_RATE * dt);
    this.currentSpeed = this.settleSpeed;
    const step = Math.min(this.settleSpeed * dt, dist);
    const nx = dx / dist;
    const nz = dz / dist;

    agent.move(nx, nz, step / dt, params.stepHeight, params.capsuleRadius, dt, params.slopeHeight, true);
    agent.applyHop(params.hopHeight);

    return true;
  }

  /** Check if any WASD key is currently pressed */
  hasInput(): boolean {
    const s = this.deps.getInput();
    return s.forward || s.backward || s.left || s.right;
  }
}
