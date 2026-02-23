import * as THREE from 'three';
import { useGameStore } from '../store';
import { createCharacterMesh, voxRoster } from './characters';
import type { CharacterType } from './characters';
import { loadVoxCharacter } from '../utils/VoxModelLoader';
import type { VoxCharacterData, VoxAnimFrames } from '../utils/VoxModelLoader';
import type { VoxCharEntry } from './VoxCharacterDB';
import { Entity, Layer } from './Entity';
import type { Terrain } from './Terrain';
import type { NavGrid } from './NavGrid';
import { Behavior, type BehaviorAgent, type BehaviorStatus } from './behaviors/Behavior';
import { Roaming } from './behaviors/Roaming';
import { GoToPoint } from './behaviors/GoToPoint';
import { IdleBehavior } from './behaviors/IdleBehavior';
import { PlayerControl, type PlayerControlDeps } from './behaviors/PlayerControl';
import { audioSystem } from '../utils/AudioSystem';
import type { LadderDef } from './Ladder';

export interface MovementParams {
  speed: number;
  stepHeight: number;
  slopeHeight: number;
  capsuleRadius: number;
  arrivalReach: number;
  hopHeight: number;
}

export function lerpAngle(current: number, target: number, t: number): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * t;
}

/** Gravity acceleration for falling (units/s²) */
const GRAVITY = 18;
/** Max fall speed (units/s) */
const MAX_FALL_SPEED = 12;
/** Smoothing speed for stepping up (exponential lerp rate) */
const STEP_UP_RATE = 12;
/** Minimum time between any foot sounds (step or land) per character */
const FOOT_SFX_COOLDOWN = 0.12;

// ── Climbing constants ──────────────────────────────────────────────
const CLIMB_SPEED = 2.5;       // m/s along ladder
const MOUNT_SPEED = 4.0;       // m/s walking to ladder entry
const DISMOUNT_SPEED = 3.0;    // m/s stepping off ladder
/** How far the character stands in front of the cliff during climbing (along facing normal) */
const CLIMB_WALL_OFFSET = 0.35;

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

// ── Debug visualization constants ───────────────────────────────────
const DEBUG_PATH = true;
const DEBUG_LINE_COLOR = 0x00ffaa;
const DEBUG_NODE_COLOR = 0x00ffaa;
const DEBUG_GOAL_COLOR = 0xff4466;
const DEBUG_NODE_RADIUS = 0.08;
const DEBUG_GOAL_RADIUS = 0.14;
const DEBUG_Y_OFFSET = 0;

let _nodeGeo: THREE.SphereGeometry | null = null;
let _goalGeo: THREE.SphereGeometry | null = null;
function getNodeGeo(): THREE.SphereGeometry {
  if (!_nodeGeo) _nodeGeo = new THREE.SphereGeometry(DEBUG_NODE_RADIUS, 6, 4);
  return _nodeGeo;
}
function getGoalGeo(): THREE.SphereGeometry {
  if (!_goalGeo) _goalGeo = new THREE.SphereGeometry(DEBUG_GOAL_RADIUS, 8, 6);
  return _goalGeo;
}

export class Character implements BehaviorAgent {
  readonly mesh: THREE.Mesh;
  readonly characterType: CharacterType;
  entity: Entity;
  facing = 0;
  groundY = 0;
  protected visualGroundY = 0;
  private velocityY = 0;
  moveTime = 0;
  lastHopHalf = 0;
  hopFrequency = 4;
  protected footSfxTimer = 0;
  private climbState: ClimbState | null = null;

  // ── VOX animation ──────────────────────────────────────────────
  /** Currently applied VOX skin entry (for personality data) */
  voxEntry: VoxCharEntry | null = null;
  private voxData: VoxCharacterData | null = null;
  private voxAnimState: 'idle' | 'walk' | 'action' = 'idle';
  private voxFrameIndex = 0;
  private voxFrameTimer = 0;
  private voxLoaded = false;
  /** Frame rates per animation type */
  private static readonly VOX_FPS: Record<string, number> = { idle: 3, walk: 8, action: 6 };

  /** Per-character movement parameters (mutable, shared by reference with behaviors) */
  params: MovementParams;

  torchLight: THREE.PointLight;
  torchLightEntity: Entity;
  fillLight: THREE.PointLight;
  torchTime = 0;

  protected scene: THREE.Scene;
  protected terrain: Terrain;
  private navGrid: NavGrid;
  private ladderDefs: ReadonlyArray<LadderDef>;

  // ── Behavior system ─────────────────────────────────────────────
  private behavior: Behavior;
  private defaultBehavior: Roaming;
  private playerControl: PlayerControl | null = null;
  private _selected = false;

  // ── Debug visualization ─────────────────────────────────────────
  private debugLine: THREE.Line | null = null;
  private debugNodes: THREE.Mesh[] = [];
  private debugGoal: THREE.Mesh | null = null;
  private debugLineMat: THREE.LineBasicMaterial | null = null;
  private debugNodeMat: THREE.MeshBasicMaterial | null = null;
  private debugGoalMat: THREE.MeshBasicMaterial | null = null;
  private lastDebugWaypointCount = 0;

  constructor(scene: THREE.Scene, terrain: Terrain, navGrid: NavGrid, type: CharacterType, position: THREE.Vector3, ladderDefs: ReadonlyArray<LadderDef> = []) {
    this.scene = scene;
    this.terrain = terrain;
    this.navGrid = navGrid;
    this.characterType = type;
    this.ladderDefs = ladderDefs;

    // Mesh (placeholder — replaced by VOX skin below)
    this.mesh = createCharacterMesh();
    this.mesh.position.copy(position);
    this.groundY = position.y;
    this.visualGroundY = position.y;
    scene.add(this.mesh);
    this.entity = new Entity(this.mesh, { layer: Layer.Character, radius: 0.25 });

    // Torch light
    const torch = useGameStore.getState().torchParams;
    this.torchLight = new THREE.PointLight(
      new THREE.Color(torch.color),
      torch.intensity,
      torch.distance,
    );
    this.torchLight.position.set(position.x, position.y + torch.offsetUp, position.z);
    this.torchLight.castShadow = false;
    scene.add(this.torchLight);
    this.torchLightEntity = new Entity(this.torchLight, { layer: Layer.Light, radius: torch.distance });

    // Fill light
    this.fillLight = new THREE.PointLight(new THREE.Color(torch.color), torch.intensity * 0.4, 3);
    this.fillLight.castShadow = false;
    scene.add(this.fillLight);

    // Initialize movement params from store defaults
    const pp = useGameStore.getState().playerParams;
    this.params = {
      speed: pp.speed,
      stepHeight: pp.stepHeight,
      slopeHeight: pp.slopeHeight,
      capsuleRadius: pp.capsuleRadius,
      arrivalReach: pp.arrivalReach,
      hopHeight: pp.hopHeight,
    };

    // Default behavior: roaming (receives shared reference to this.params)
    this.defaultBehavior = new Roaming({ navGrid, ladderDefs }, this.params);
    this.behavior = this.defaultBehavior;

    // Debug materials
    if (DEBUG_PATH) {
      this.debugLineMat = new THREE.LineBasicMaterial({ color: DEBUG_LINE_COLOR, transparent: true, opacity: 0.6 });
      this.debugNodeMat = new THREE.MeshBasicMaterial({ color: DEBUG_NODE_COLOR, transparent: true, opacity: 0.7 });
      this.debugGoalMat = new THREE.MeshBasicMaterial({ color: DEBUG_GOAL_COLOR, transparent: true, opacity: 0.8 });
    }

    // Auto-apply VOX skin from the roster
    const rosterEntry = voxRoster[type];
    if (rosterEntry) {
      this.applyVoxSkin(rosterEntry);
    }
  }

  // ── BehaviorAgent interface ──────────────────────────────────────

  getX(): number { return this.mesh.position.x; }
  getZ(): number { return this.mesh.position.z; }

  /** Override applyHop to emit spatial step SFX */
  applyHop(hopHeight: number): number {
    const hopSin = Math.sin(this.moveTime * Math.PI);
    const hop = Math.abs(hopSin) * hopHeight;
    this.mesh.position.y = this.visualGroundY + hop;
    const currentHopHalf = Math.floor(this.moveTime) % 2;

    if (currentHopHalf !== this.lastHopHalf && this.footSfxTimer >= 0.12) {
      this.lastHopHalf = currentHopHalf;
      this.footSfxTimer = 0;
      if (this._selected) {
        audioSystem.sfx('step');
      } else {
        audioSystem.sfxAt('step', this.mesh.position.x, this.mesh.position.z);
      }
    }

    return currentHopHalf;
  }

  // ── VOX skin loading ─────────────────────────────────────────────

  /** Apply a VOX skin from the character database. Disposes previous VOX geometries. */
  async applyVoxSkin(entry: VoxCharEntry): Promise<void> {
    this.voxEntry = entry;
    // Dispose previous VOX data if any
    if (this.voxData) {
      this.voxData.base.dispose();
      for (const frames of Object.values(this.voxData.frames)) {
        for (const geo of frames) {
          if (geo && geo !== this.voxData.base) geo.dispose();
        }
      }
      this.voxData = null;
      this.voxLoaded = false;
    }

    try {
      const data = await loadVoxCharacter(entry.folderPath, entry.prefix);
      this.voxData = data;
      this.voxLoaded = true;
      this.voxAnimState = 'idle';
      this.voxFrameIndex = 0;
      this.voxFrameTimer = 0;
      // Swap geometry
      this.mesh.geometry.dispose();
      this.mesh.geometry = data.base;
      console.log(`[Character] VOX skin applied: '${entry.name}' (${entry.category})`);
    } catch (err) {
      console.error(`[Character] Failed to apply VOX skin '${entry.name}':`, err);
    }
  }

  /** Update VOX frame-swap animation */
  private updateVoxAnimation(dt: number, isMoving: boolean): void {
    if (!this.voxData || !this.voxLoaded) return;

    const newState = isMoving ? 'walk' : 'idle';
    if (newState !== this.voxAnimState) {
      this.voxAnimState = newState;
      this.voxFrameIndex = 0;
      this.voxFrameTimer = 0;
    }

    const frames = this.voxData.frames[this.voxAnimState];
    if (frames.length === 0) return;

    const fps = Character.VOX_FPS[this.voxAnimState] ?? 4;
    this.voxFrameTimer += dt;

    if (this.voxFrameTimer >= 1 / fps) {
      this.voxFrameTimer -= 1 / fps;
      this.voxFrameIndex = (this.voxFrameIndex + 1) % frames.length;
      const newGeo = frames[this.voxFrameIndex];
      if (newGeo && newGeo !== this.mesh.geometry) {
        this.mesh.geometry = newGeo;
      }
    }
  }

  // ── Selection & control switching ────────────────────────────────

  get selected(): boolean { return this._selected; }

  /** Switch this character to player (WASD) control. */
  setPlayerControlled(deps: PlayerControlDeps): void {
    this._selected = true;
    this.playerControl = new PlayerControl({ navGrid: this.navGrid, ladderDefs: this.ladderDefs }, deps);
    this.behavior = this.playerControl;
  }

  /** Revert this character to AI (roaming) control. */
  setAIControlled(): void {
    this._selected = false;
    this.playerControl = null;
    this.behavior = this.defaultBehavior;
  }

  /** Set a click-to-move goal via A* pathfinding. */
  goTo(worldX: number, worldZ: number): void {
    this.clearDebugVis();
    this.behavior = new GoToPoint({ navGrid: this.navGrid, ladderDefs: this.ladderDefs }, this.params, worldX, worldZ);
  }

  getCameraTarget(): { x: number; y: number; z: number } {
    return {
      x: this.mesh.position.x,
      y: this.visualGroundY + 0.5,
      z: this.mesh.position.z,
    };
  }

  // ── Update ───────────────────────────────────────────────────────

  update(dt: number): void {
    // WASD interrupts GoToPoint for player-controlled characters
    if (this._selected && this.playerControl && this.behavior instanceof GoToPoint) {
      if (this.playerControl.hasInput()) {
        this.behavior = this.playerControl;
      }
    }

    const status = this.behavior.update(this, dt);

    // If GoToPoint finished, revert to appropriate behavior
    if (status === 'done') {
      if (this._selected && this.playerControl) {
        this.behavior = this.playerControl;
      } else {
        this.behavior = this.defaultBehavior;
      }
    }

    if (DEBUG_PATH) this.syncDebugVis();
    this.updateTorch(dt);
  }

  // ── Movement (BehaviorAgent) ─────────────────────────────────────

  move(dx: number, dz: number, speed: number, stepHeight: number, capsuleRadius: number, dt: number, slopeHeight?: number): boolean {
    if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return false;
    this.footSfxTimer += dt;

    const oldX = this.mesh.position.x;
    const oldZ = this.mesh.position.z;
    const newX = oldX + dx * speed * dt;
    const newZ = oldZ + dz * speed * dt;

    const resolved = this.terrain.resolveMovement(newX, newZ, this.groundY, stepHeight, capsuleRadius, oldX, oldZ, slopeHeight);
    this.mesh.position.x = resolved.x;
    this.mesh.position.z = resolved.z;
    this.groundY = resolved.y;

    this.updateVisualY(dt);

    const targetAngle = Math.atan2(dx, dz) + Math.PI;
    this.facing = lerpAngle(this.facing, targetAngle, 1 - Math.exp(-12 * dt));
    this.mesh.rotation.y = this.facing;

    this.moveTime += dt * this.hopFrequency;
    this.updateVoxAnimation(dt, true);

    return true;
  }

  private updateVisualY(dt: number): void {
    if (this.groundY > this.visualGroundY) {
      this.visualGroundY = THREE.MathUtils.lerp(
        this.visualGroundY,
        this.groundY,
        1 - Math.exp(-STEP_UP_RATE * dt),
      );
      this.velocityY = 0;
    } else if (this.groundY < this.visualGroundY) {
      this.velocityY = Math.min(this.velocityY + GRAVITY * dt, MAX_FALL_SPEED);
      this.visualGroundY -= this.velocityY * dt;
      if (this.visualGroundY <= this.groundY) {
        const impactSpeed = this.velocityY;
        this.visualGroundY = this.groundY;
        this.velocityY = 0;
        if (impactSpeed > 1 && this.footSfxTimer >= FOOT_SFX_COOLDOWN) {
          if (this._selected) {
            audioSystem.sfx('land');
          } else {
            audioSystem.sfxAt('land', this.mesh.position.x, this.mesh.position.z);
          }
          this.footSfxTimer = 0;
        }
      }
    } else {
      this.velocityY = 0;
    }
  }

  updateIdle(dt: number): void {
    this.footSfxTimer += dt;
    if (this.moveTime > 0) {
      this.moveTime = 0;
      this.lastHopHalf = 0;
    }
    this.updateVisualY(dt);
    this.mesh.position.y = THREE.MathUtils.lerp(
      this.mesh.position.y,
      this.visualGroundY,
      1 - Math.exp(-15 * dt),
    );
    this.updateVoxAnimation(dt, false);
  }

  updateTorch(dt: number): void {
    const torchOn = useGameStore.getState().torchEnabled;
    const torch = useGameStore.getState().torchParams;

    if (!torchOn) {
      this.torchLight.intensity = 0;
      this.fillLight.intensity = 0;
      return;
    }

    this.torchLight.color.set(torch.color);
    this.torchLight.distance = torch.distance;

    this.torchTime += dt * 12;
    const flickerAmount = torch.flicker;
    const flicker = 1 + (
      Math.sin(this.torchTime) * 0.5 +
      Math.sin(this.torchTime * 2.3) * 0.3 +
      Math.sin(this.torchTime * 5.7) * 0.2
    ) * flickerAmount;
    this.torchLight.intensity = torch.intensity * flicker;

    this.torchLight.position.set(
      this.mesh.position.x,
      this.mesh.position.y + torch.offsetUp,
      this.mesh.position.z,
    );

    const fwdX = -Math.sin(this.facing);
    const fwdZ = -Math.cos(this.facing);
    const rightX = -fwdZ;
    const rightZ = fwdX;
    this.fillLight.color.set(torch.color);
    this.fillLight.intensity = torch.intensity * 0.4 * flicker;
    this.fillLight.position.set(
      this.mesh.position.x + fwdX * torch.offsetForward + rightX * torch.offsetRight,
      this.mesh.position.y + torch.offsetUp * 0.6,
      this.mesh.position.z + fwdZ * torch.offsetForward + rightZ * torch.offsetRight,
    );
  }

  // ── Climbing ─────────────────────────────────────────────────────

  startClimb(ladder: LadderDef, direction: 'up' | 'down'): void {
    if (this.climbState) return;

    // Use actual cliff geometry positions if available, fallback to cell centers
    const cLowX = ladder.cliffLowX ?? ladder.lowWorldX;
    const cLowZ = ladder.cliffLowZ ?? ladder.lowWorldZ;
    const cHighX = ladder.cliffHighX ?? ladder.highWorldX;
    const cHighZ = ladder.cliffHighZ ?? ladder.highWorldZ;

    // Compute facing from actual cliff geometry direction (high→low = facing direction)
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
      (this.mesh.position.x - entryX) ** 2 + (this.mesh.position.z - entryZ) ** 2,
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
      startX: this.mesh.position.x,
      startZ: this.mesh.position.z,
      startY: this.visualGroundY,
      targetFacing,
      leanAngle,
      cLowX, cLowZ, cLowY,
      cHighX, cHighZ, cHighY,
      cfDX, cfDZ,
    };
  }

  updateClimb(dt: number): boolean {
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
        this.mesh.position.x = cs.startX + (targetX - cs.startX) * t;
        this.mesh.position.z = cs.startZ + (targetZ - cs.startZ) * t;
        this.facing = lerpAngle(this.facing, cs.targetFacing, 1 - Math.exp(-8 * dt));
        this.mesh.rotation.order = 'YXZ';
        this.mesh.rotation.y = this.facing;
        this.mesh.rotation.x = THREE.MathUtils.lerp(0, cs.leanAngle, t);
        if (cs.phaseTime >= cs.mountDuration) {
          this.facing = cs.targetFacing;
          this.mesh.rotation.y = this.facing;
          this.mesh.rotation.x = cs.leanAngle;
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
          this.mesh.position.x = cs.cLowX + dxW * t + oX;
          this.mesh.position.z = cs.cLowZ + dzW * t + oZ;
          const y = cs.cLowY + dy * t;
          this.groundY = y;
          this.visualGroundY = y;
          this.mesh.position.y = y;
        } else {
          this.mesh.position.x = cs.cHighX - dxW * t + oX;
          this.mesh.position.z = cs.cHighZ - dzW * t + oZ;
          const y = cs.cHighY - dy * t;
          this.groundY = y;
          this.visualGroundY = y;
          this.mesh.position.y = y;
        }

        this.facing = lerpAngle(this.facing, cs.targetFacing, 1 - Math.exp(-20 * dt));
        this.mesh.rotation.order = 'YXZ';
        this.mesh.rotation.y = this.facing;
        this.mesh.rotation.x = cs.leanAngle;

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
          // Step away from cliff onto the high plateau
          exitX = cs.cHighX - cs.cfDX * DISMOUNT_DIST;
          exitZ = cs.cHighZ - cs.cfDZ * DISMOUNT_DIST;
        } else {
          // Step away from cliff onto the low ground
          exitX = cs.cLowX + cs.cfDX * DISMOUNT_DIST;
          exitZ = cs.cLowZ + cs.cfDZ * DISMOUNT_DIST;
        }

        const startX = (cs.direction === 'up' ? cs.cHighX : cs.cLowX) + oX;
        const startZ = (cs.direction === 'up' ? cs.cHighZ : cs.cLowZ) + oZ;

        const curX = startX + (exitX - startX) * t;
        const curZ = startZ + (exitZ - startZ) * t;
        this.mesh.position.x = curX;
        this.mesh.position.z = curZ;

        const terrainY = this.terrain.getTerrainY(curX, curZ);
        this.groundY = terrainY;
        this.visualGroundY = THREE.MathUtils.lerp(
          this.visualGroundY, terrainY, 1 - Math.exp(-STEP_UP_RATE * dt),
        );
        this.mesh.position.y = this.visualGroundY;

        this.facing = cs.targetFacing;
        this.mesh.rotation.order = 'YXZ';
        this.mesh.rotation.y = this.facing;
        this.mesh.rotation.x = cs.leanAngle * (1 - t);

        if (cs.phaseTime >= cs.dismountDuration) {
          this.velocityY = 0;
          this.mesh.rotation.order = 'XYZ';
          this.mesh.rotation.x = 0;
          this.climbState = null;
          return false;
        }
        break;
      }
    }

    this.updateTorch(dt);
    return true;
  }

  isClimbing(): boolean {
    return this.climbState !== null;
  }

  getPosition(): THREE.Vector3 {
    return this.mesh.position;
  }

  // ── Debug visualization ──────────────────────────────────────────

  private syncDebugVis(): void {
    const waypoints = this.behavior.getWaypoints();
    const idx = this.behavior.getWaypointIndex();
    const remaining = waypoints.slice(idx);

    if (remaining.length === 0) {
      if (this.debugLine) this.clearDebugVis();
      this.lastDebugWaypointCount = 0;
      return;
    }

    if (!this.debugLine) {
      this.buildDebugVis(remaining);
      this.lastDebugWaypointCount = remaining.length;
      return;
    }

    this.updateDebugLine(remaining);

    while (this.debugNodes.length > Math.max(0, remaining.length - 1)) {
      const node = this.debugNodes.shift()!;
      this.scene.remove(node);
    }

    this.lastDebugWaypointCount = remaining.length;
  }

  private buildDebugVis(remaining: ReadonlyArray<{ x: number; z: number }>): void {
    this.clearDebugVis();
    if (!this.debugLineMat || !this.debugNodeMat || !this.debugGoalMat) return;
    if (remaining.length === 0) return;

    const points = this.buildLinePoints(remaining);
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    this.debugLine = new THREE.Line(lineGeo, this.debugLineMat);
    this.scene.add(this.debugLine);

    for (let i = 0; i < remaining.length - 1; i++) {
      const wp = remaining[i];
      const wy = this.terrain.getTerrainY(wp.x, wp.z) + DEBUG_Y_OFFSET;
      const sphere = new THREE.Mesh(getNodeGeo(), this.debugNodeMat);
      sphere.position.set(wp.x, wy, wp.z);
      sphere.scale.set(0.5, 0.5, 0.5);
      this.scene.add(sphere);
      this.debugNodes.push(sphere);
    }

    const goal = remaining[remaining.length - 1];
    const goalY = this.terrain.getTerrainY(goal.x, goal.z) + DEBUG_Y_OFFSET;
    this.debugGoal = new THREE.Mesh(getGoalGeo(), this.debugGoalMat);
    this.debugGoal.position.set(goal.x, goalY, goal.z);
    this.debugGoal.scale.set(0.5, 0.5, 0.5);
    this.scene.add(this.debugGoal);
  }

  private updateDebugLine(remaining: ReadonlyArray<{ x: number; z: number }>): void {
    if (!this.debugLine) return;
    const points = this.buildLinePoints(remaining);
    const geo = this.debugLine.geometry as THREE.BufferGeometry;
    geo.setFromPoints(points);
  }

  private buildLinePoints(remaining: ReadonlyArray<{ x: number; z: number }>): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    points.push(new THREE.Vector3(
      this.mesh.position.x,
      this.mesh.position.y + DEBUG_Y_OFFSET,
      this.mesh.position.z,
    ));
    for (const wp of remaining) {
      const wy = this.terrain.getTerrainY(wp.x, wp.z) + DEBUG_Y_OFFSET;
      points.push(new THREE.Vector3(wp.x, wy, wp.z));
    }
    return points;
  }

  private clearDebugVis(): void {
    if (this.debugLine) {
      this.debugLine.geometry.dispose();
      this.scene.remove(this.debugLine);
      this.debugLine = null;
    }
    for (const node of this.debugNodes) {
      this.scene.remove(node);
    }
    this.debugNodes = [];
    if (this.debugGoal) {
      this.scene.remove(this.debugGoal);
      this.debugGoal = null;
    }
  }

  dispose(): void {
    this.clearDebugVis();
    this.debugLineMat?.dispose();
    this.debugNodeMat?.dispose();
    this.debugGoalMat?.dispose();
    this.entity.destroy();
    this.torchLightEntity.destroy();
    this.scene.remove(this.mesh);
    (this.mesh.material as THREE.Material).dispose();
    this.scene.remove(this.torchLight);
    this.scene.remove(this.fillLight);
  }
}
