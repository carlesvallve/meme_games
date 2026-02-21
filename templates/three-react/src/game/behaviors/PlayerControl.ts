import { Behavior, type BehaviorAgent, type BehaviorStatus } from './Behavior';
import type { InputState } from '../Input';
import type { PlayerParams } from '../../store';
import { audioSystem } from '../../utils/AudioSystem';

/** Dependencies injected at construction (not per-frame). */
export interface PlayerControlDeps {
  getInput: () => InputState;
  getCameraAngleY: () => number;
  getParams: () => PlayerParams;
}

/**
 * WASD input handling as a behavior.
 * Camera-relative movement, ladder auto-trigger, hop animation + step SFX.
 * Returns 'running' always (never finishes).
 */
export class PlayerControl extends Behavior {
  private deps: PlayerControlDeps;

  constructor(ctx: ConstructorParameters<typeof Behavior>[0], deps: PlayerControlDeps) {
    super(ctx);
    this.deps = deps;
  }

  update(agent: BehaviorAgent, dt: number): BehaviorStatus {
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

    const moveLen = Math.sqrt(mx * mx + mz * mz);
    if (moveLen > 0.001) {
      mx /= moveLen;
      mz /= moveLen;

      // Check for ladder auto-trigger before moving.
      // Must be on a nav-link cell and moving toward the ladder direction.
      const navGrid = this.ctx.navGrid;
      const ladderDefs = this.ctx.ladderDefs;
      if (ladderDefs.length > 0) {
        const { gx, gz } = navGrid.worldToGrid(agent.getX(), agent.getZ());
        let triggered = false;
        for (let dz = -1; dz <= 1 && !triggered; dz++) {
          for (let dx = -1; dx <= 1 && !triggered; dx++) {
            const cgx = gx + dx;
            const cgz = gz + dz;
            const links = navGrid.getNavLinks(cgx, cgz);
            if (!links) continue;
            // Must be close to this cell's center to trigger
            const cellWorld = navGrid.gridToWorld(cgx, cgz);
            const distToCell = Math.sqrt(
              (agent.getX() - cellWorld.x) ** 2 +
              (agent.getZ() - cellWorld.z) ** 2,
            );
            if (distToCell > 0.7) continue;
            for (const link of links) {
              const ladder = ladderDefs[link.ladderIndex];
              if (!ladder) continue;
              const linkDirX = link.toGX - cgx;
              const linkDirZ = link.toGZ - cgz;
              const linkLen = Math.sqrt(linkDirX * linkDirX + linkDirZ * linkDirZ);
              if (linkLen < 0.001) continue;
              const dot = mx * (linkDirX / linkLen) + mz * (linkDirZ / linkLen);
              if (dot > 0.5) {
                const cell = navGrid.getCell(cgx, cgz);
                const targetCell = navGrid.getCell(link.toGX, link.toGZ);
                if (cell && targetCell) {
                  const dir = targetCell.surfaceHeight > cell.surfaceHeight ? 'up' : 'down';
                  agent.startClimb(ladder, dir);
                  triggered = true;
                  break;
                }
              }
            }
          }
        }
        if (triggered) return 'running';
      }

      agent.move(mx, mz, params.speed, params.stepHeight, params.capsuleRadius, dt, params.slopeHeight);

      // Hop + step SFX
      const currentHopHalf = agent.applyHop(params.hopHeight);
      // applyHop emits SFX for player-controlled via the Character's overridden method
    } else {
      agent.updateIdle(dt);
    }

    return 'running';
  }

  /** Check if any WASD key is currently pressed */
  hasInput(): boolean {
    const s = this.deps.getInput();
    return s.forward || s.backward || s.left || s.right;
  }
}
