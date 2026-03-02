import * as THREE from 'three';
import type { LadderDef } from '../dungeon';
import type { Environment } from '../environment';
import { lerpAngle } from '../../utils/math';
import {
  CLIMB_SPEED,
  MOUNT_SPEED,
  DISMOUNT_SPEED,
  CLIMB_WALL_OFFSET,
  STEP_UP_RATE,
} from './CharacterSettings';

const RUNG_SPACING = 0.4;
/** Pause at each rung (seconds) */
const RUNG_PAUSE = 0.06;

type ClimbPhase = 'face' | 'mount' | 'climb' | 'dismount';

interface ClimbState {
  ladder: LadderDef;
  direction: 'up' | 'down';
  phase: ClimbPhase;
  phaseTime: number;
  mountDuration: number;
  dismountDuration: number;
  startX: number;
  startZ: number;
  startY: number;
  targetFacing: number;
  leanAngle: number;
  /** Actual cliff geometry used for climb path */
  cLowX: number;
  cLowZ: number;
  cLowY: number;
  cHighX: number;
  cHighZ: number;
  cHighY: number;
  /** Cliff-derived facing direction */
  cfDX: number;
  cfDZ: number;
  /** Rung stepping state */
  rungCount: number;
  currentRung: number;
  rungPauseTimer: number;
}

/** Owner interface — fields the climbing module reads/writes on the character. */
export interface ClimbOwner {
  mesh: THREE.Mesh;
  facing: number;
  groundY: number;
  visualGroundY: number;
  velocityY: number;
  terrain: Environment;
  updateTorch(dt: number): void;
  playClimbStep?: () => void;
}

export class CharacterClimbing {
  private climbState: ClimbState | null = null;

  get active(): boolean {
    return this.climbState !== null;
  }

  start(owner: ClimbOwner, ladder: LadderDef, direction: 'up' | 'down'): void {
    if (this.climbState) return;

    const cLowX = ladder.cliffLowX ?? ladder.lowWorldX;
    const cLowZ = ladder.cliffLowZ ?? ladder.lowWorldZ;
    const cHighX = ladder.cliffHighX ?? ladder.highWorldX;
    const cHighZ = ladder.cliffHighZ ?? ladder.highWorldZ;

    let cfDX = cLowX - cHighX;
    let cfDZ = cLowZ - cHighZ;
    const cfLen = Math.sqrt(cfDX * cfDX + cfDZ * cfDZ);
    if (cfLen > 0.001) {
      cfDX /= cfLen;
      cfDZ /= cfLen;
    } else {
      cfDX = ladder.facingDX;
      cfDZ = ladder.facingDZ;
    }

    const targetFacing = Math.atan2(cfDX, cfDZ);

    const offX = cfDX * CLIMB_WALL_OFFSET;
    const offZ = cfDZ * CLIMB_WALL_OFFSET;
    const entryX = (direction === 'up' ? cLowX : cHighX) + offX;
    const entryZ = (direction === 'up' ? cLowZ : cHighZ) + offZ;
    const mountDist = Math.sqrt(
      (owner.mesh.position.x - entryX) ** 2 +
        (owner.mesh.position.z - entryZ) ** 2,
    );
    const mountDuration = Math.max(0.05, mountDist / MOUNT_SPEED);
    const dismountDuration = Math.max(0.05, 0.4 / DISMOUNT_SPEED);

    const cLowY = ladder.cliffLowY ?? ladder.bottomY;
    const cHighY = ladder.cliffHighY ?? ladder.topY;
    const leanAngle = -(
      ladder.leanAngle ??
      Math.atan2(
        Math.sqrt((cHighX - cLowX) ** 2 + (cHighZ - cLowZ) ** 2),
        cHighY - cLowY,
      )
    );

    const dy = Math.abs(cHighY - cLowY);
    const horizDist = Math.sqrt((cHighX - cLowX) ** 2 + (cHighZ - cLowZ) ** 2);
    const totalLen = Math.sqrt(horizDist * horizDist + dy * dy);
    const rungCount = Math.max(1, Math.floor(totalLen / RUNG_SPACING));

    this.climbState = {
      ladder,
      direction,
      phase: 'face',
      phaseTime: 0,
      mountDuration,
      dismountDuration,
      startX: owner.mesh.position.x,
      startZ: owner.mesh.position.z,
      startY: owner.visualGroundY,
      targetFacing,
      leanAngle,
      cLowX,
      cLowZ,
      cLowY,
      cHighX,
      cHighZ,
      cHighY,
      cfDX,
      cfDZ,
      rungCount,
      currentRung: 0,
      rungPauseTimer: 0,
    };
  }

  /** Returns true while climbing is still in progress. */
  update(owner: ClimbOwner, dt: number): boolean {
    const cs = this.climbState;
    if (!cs) return false;

    cs.phaseTime += dt;

    switch (cs.phase) {
      case 'face':
        cs.phase = 'mount';
        cs.phaseTime = 0;
      // fallthrough

      case 'mount': {
        const t = Math.min(1, cs.phaseTime / cs.mountDuration);
        const oX = cs.cfDX * CLIMB_WALL_OFFSET;
        const oZ = cs.cfDZ * CLIMB_WALL_OFFSET;
        const targetX = (cs.direction === 'up' ? cs.cLowX : cs.cHighX) + oX;
        const targetZ = (cs.direction === 'up' ? cs.cLowZ : cs.cHighZ) + oZ;
        owner.mesh.position.x = cs.startX + (targetX - cs.startX) * t;
        owner.mesh.position.z = cs.startZ + (targetZ - cs.startZ) * t;
        owner.facing = lerpAngle(
          owner.facing,
          cs.targetFacing,
          1 - Math.exp(-8 * dt),
        );
        owner.mesh.rotation.order = 'YXZ';
        owner.mesh.rotation.y = owner.facing;
        owner.mesh.rotation.x = THREE.MathUtils.lerp(0, cs.leanAngle, t);
        if (cs.phaseTime >= cs.mountDuration) {
          owner.facing = cs.targetFacing;
          owner.mesh.rotation.y = owner.facing;
          owner.mesh.rotation.x = cs.leanAngle;
          cs.phase = 'climb';
          cs.phaseTime = 0;
          cs.currentRung = 0;
          cs.rungPauseTimer = 0;
        }
        break;
      }

      case 'climb': {
        const dy = Math.abs(cs.cHighY - cs.cLowY);
        const dxW = cs.cHighX - cs.cLowX;
        const dzW = cs.cHighZ - cs.cLowZ;
        const oX = cs.cfDX * CLIMB_WALL_OFFSET;
        const oZ = cs.cfDZ * CLIMB_WALL_OFFSET;

        // Time per rung = distance per rung / speed
        const horizDist = Math.sqrt(dxW * dxW + dzW * dzW);
        const totalLen = Math.sqrt(horizDist * horizDist + dy * dy);
        const timePerRung = totalLen / cs.rungCount / CLIMB_SPEED;

        // Handle rung pause
        if (cs.rungPauseTimer > 0) {
          cs.rungPauseTimer -= dt;
          if (cs.rungPauseTimer > 0) break;
          // Consume leftover time
          dt = -cs.rungPauseTimer;
          cs.rungPauseTimer = 0;
        }

        cs.phaseTime += 0; // phaseTime already incremented at top
        const prevRung = cs.currentRung;
        const rungProgress = cs.phaseTime / timePerRung;
        const nextRung = Math.min(cs.rungCount, Math.floor(rungProgress));

        // Crossed a rung boundary — snap to it and pause
        if (nextRung > prevRung && nextRung < cs.rungCount) {
          cs.currentRung = nextRung;
          cs.rungPauseTimer = RUNG_PAUSE;
          owner.playClimbStep?.();
        }

        // Smoothly interpolate Y between rungs using fractional progress
        const t = Math.min(1, rungProgress / cs.rungCount);
        const frac = rungProgress - Math.floor(rungProgress); // 0..1 within current rung
        const smoothFrac =
          frac < 0.5
            ? 4 * frac * frac * frac
            : 1 - Math.pow(-2 * frac + 2, 3) / 2; // easeInOutCubic
        const smoothRungT = Math.min(
          1,
          (Math.floor(rungProgress) + smoothFrac) / cs.rungCount,
        );

        if (cs.direction === 'up') {
          owner.mesh.position.x = cs.cLowX + dxW * t + oX;
          owner.mesh.position.z = cs.cLowZ + dzW * t + oZ;
          const y = cs.cLowY + dy * smoothRungT;
          owner.groundY = y;
          owner.visualGroundY = y;
          owner.mesh.position.y = y;
        } else {
          owner.mesh.position.x = cs.cHighX - dxW * t + oX;
          owner.mesh.position.z = cs.cHighZ - dzW * t + oZ;
          const y = cs.cHighY - dy * smoothRungT;
          owner.groundY = y;
          owner.visualGroundY = y;
          owner.mesh.position.y = y;
        }

        owner.facing = lerpAngle(
          owner.facing,
          cs.targetFacing,
          1 - Math.exp(-20 * dt),
        );
        owner.mesh.rotation.order = 'YXZ';
        owner.mesh.rotation.y = owner.facing;
        owner.mesh.rotation.x = cs.leanAngle;

        if (nextRung >= cs.rungCount) {
          owner.playClimbStep?.();
          cs.phase = 'dismount';
          cs.phaseTime = 0;
        }
        break;
      }

      case 'dismount': {
        const t = Math.min(1, cs.phaseTime / cs.dismountDuration);
        const DISMOUNT_DIST = 0.4;
        const oX = cs.cfDX * CLIMB_WALL_OFFSET;
        const oZ = cs.cfDZ * CLIMB_WALL_OFFSET;

        let exitX: number, exitZ: number;
        if (cs.direction === 'up') {
          exitX = cs.cHighX - cs.cfDX * DISMOUNT_DIST;
          exitZ = cs.cHighZ - cs.cfDZ * DISMOUNT_DIST;
        } else {
          exitX = cs.cLowX + cs.cfDX * DISMOUNT_DIST;
          exitZ = cs.cLowZ + cs.cfDZ * DISMOUNT_DIST;
        }

        const startX = (cs.direction === 'up' ? cs.cHighX : cs.cLowX) + oX;
        const startZ = (cs.direction === 'up' ? cs.cHighZ : cs.cLowZ) + oZ;

        const curX = startX + (exitX - startX) * t;
        const curZ = startZ + (exitZ - startZ) * t;
        owner.mesh.position.x = curX;
        owner.mesh.position.z = curZ;

        // Sample terrain at the EXIT position (not current), so we don't dip
        // into the low corridor floor when dismounting upward on vertical ladders.
        const terrainY = owner.terrain.getTerrainY(exitX, exitZ);
        owner.groundY = terrainY;
        owner.visualGroundY = THREE.MathUtils.lerp(
          owner.visualGroundY,
          terrainY,
          1 - Math.exp(-STEP_UP_RATE * dt),
        );
        owner.mesh.position.y = owner.visualGroundY;

        // When climbing down, smoothly turn 180° during dismount to face away from wall
        if (cs.direction === 'down') {
          const turnTarget = cs.targetFacing + Math.PI;
          owner.facing = lerpAngle(cs.targetFacing, turnTarget, t);
        } else {
          owner.facing = cs.targetFacing;
        }
        owner.mesh.rotation.order = 'YXZ';
        owner.mesh.rotation.y = owner.facing;
        owner.mesh.rotation.x = cs.leanAngle * (1 - t);

        if (cs.phaseTime >= cs.dismountDuration) {
          if (cs.direction === 'down') {
            owner.facing = cs.targetFacing + Math.PI;
            // Normalize to [-PI, PI]
            owner.facing = Math.atan2(
              Math.sin(owner.facing),
              Math.cos(owner.facing),
            );
          }
          owner.velocityY = 0;
          owner.mesh.rotation.order = 'XYZ';
          owner.mesh.rotation.x = 0;
          owner.mesh.rotation.y = owner.facing;
          this.climbState = null;
          return false;
        }
        break;
      }
    }

    owner.updateTorch(dt);
    return true;
  }
}
