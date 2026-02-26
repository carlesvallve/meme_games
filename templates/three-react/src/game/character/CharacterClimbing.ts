import * as THREE from 'three';
import type { LadderDef } from '../Ladder';
import type { Terrain } from '../Terrain';
import { lerpAngle } from '../../utils/math';
import { CLIMB_SPEED, MOUNT_SPEED, DISMOUNT_SPEED, CLIMB_WALL_OFFSET, STEP_UP_RATE } from './CharacterSettings';

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
  cLowX: number; cLowZ: number; cLowY: number;
  cHighX: number; cHighZ: number; cHighY: number;
  /** Cliff-derived facing direction */
  cfDX: number; cfDZ: number;
}

/** Owner interface — fields the climbing module reads/writes on the character. */
export interface ClimbOwner {
  mesh: THREE.Mesh;
  facing: number;
  groundY: number;
  visualGroundY: number;
  velocityY: number;
  terrain: Terrain;
  updateTorch(dt: number): void;
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
    if (cfLen > 0.001) { cfDX /= cfLen; cfDZ /= cfLen; }
    else { cfDX = ladder.facingDX; cfDZ = ladder.facingDZ; }

    const targetFacing = Math.atan2(cfDX, cfDZ);

    const offX = cfDX * CLIMB_WALL_OFFSET;
    const offZ = cfDZ * CLIMB_WALL_OFFSET;
    const entryX = (direction === 'up' ? cLowX : cHighX) + offX;
    const entryZ = (direction === 'up' ? cLowZ : cHighZ) + offZ;
    const mountDist = Math.sqrt(
      (owner.mesh.position.x - entryX) ** 2 + (owner.mesh.position.z - entryZ) ** 2,
    );
    const mountDuration = Math.max(0.05, mountDist / MOUNT_SPEED);
    const dismountDuration = Math.max(0.05, 0.4 / DISMOUNT_SPEED);

    const cLowY = ladder.cliffLowY ?? ladder.bottomY;
    const cHighY = ladder.cliffHighY ?? ladder.topY;
    const leanAngle = -(ladder.leanAngle ?? Math.atan2(
      Math.sqrt((cHighX - cLowX) ** 2 + (cHighZ - cLowZ) ** 2),
      cHighY - cLowY,
    ));

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
      cLowX, cLowZ, cLowY,
      cHighX, cHighZ, cHighY,
      cfDX, cfDZ,
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
        owner.facing = lerpAngle(owner.facing, cs.targetFacing, 1 - Math.exp(-8 * dt));
        owner.mesh.rotation.order = 'YXZ';
        owner.mesh.rotation.y = owner.facing;
        owner.mesh.rotation.x = THREE.MathUtils.lerp(0, cs.leanAngle, t);
        if (cs.phaseTime >= cs.mountDuration) {
          owner.facing = cs.targetFacing;
          owner.mesh.rotation.y = owner.facing;
          owner.mesh.rotation.x = cs.leanAngle;
          cs.phase = 'climb';
          cs.phaseTime = 0;
        }
        break;
      }

      case 'climb': {
        const dy = Math.abs(cs.cHighY - cs.cLowY);
        const dxW = cs.cHighX - cs.cLowX;
        const dzW = cs.cHighZ - cs.cLowZ;
        const horizDist = Math.sqrt(dxW * dxW + dzW * dzW);
        const totalLen = Math.sqrt(horizDist * horizDist + dy * dy);
        const climbDuration = totalLen / CLIMB_SPEED;
        const t = Math.min(1, cs.phaseTime / climbDuration);
        const oX = cs.cfDX * CLIMB_WALL_OFFSET;
        const oZ = cs.cfDZ * CLIMB_WALL_OFFSET;

        if (cs.direction === 'up') {
          owner.mesh.position.x = cs.cLowX + dxW * t + oX;
          owner.mesh.position.z = cs.cLowZ + dzW * t + oZ;
          const y = cs.cLowY + dy * t;
          owner.groundY = y;
          owner.visualGroundY = y;
          owner.mesh.position.y = y;
        } else {
          owner.mesh.position.x = cs.cHighX - dxW * t + oX;
          owner.mesh.position.z = cs.cHighZ - dzW * t + oZ;
          const y = cs.cHighY - dy * t;
          owner.groundY = y;
          owner.visualGroundY = y;
          owner.mesh.position.y = y;
        }

        owner.facing = lerpAngle(owner.facing, cs.targetFacing, 1 - Math.exp(-20 * dt));
        owner.mesh.rotation.order = 'YXZ';
        owner.mesh.rotation.y = owner.facing;
        owner.mesh.rotation.x = cs.leanAngle;

        if (cs.phaseTime >= climbDuration) {
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

        const terrainY = owner.terrain.getTerrainY(curX, curZ);
        owner.groundY = terrainY;
        owner.visualGroundY = THREE.MathUtils.lerp(
          owner.visualGroundY, terrainY, 1 - Math.exp(-STEP_UP_RATE * dt),
        );
        owner.mesh.position.y = owner.visualGroundY;

        owner.facing = cs.targetFacing;
        owner.mesh.rotation.order = 'YXZ';
        owner.mesh.rotation.y = owner.facing;
        owner.mesh.rotation.x = cs.leanAngle * (1 - t);

        if (cs.phaseTime >= cs.dismountDuration) {
          owner.velocityY = 0;
          owner.mesh.rotation.order = 'XYZ';
          owner.mesh.rotation.x = 0;
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
