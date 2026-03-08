import * as THREE from 'three';
import type { NavGrid } from './pathfinding/NavGrid';
import { PathLineRenderer } from './pathfinding/PathLineRenderer';
import type { AABBBox } from './pathfinding/NavGrid';
import { findPath } from './pathfinding/AStar';
import type { WaypointMeta } from './pathfinding/AStar';
import { resolveCollision, getSurfaceHeight } from './CollisionUtils';
import { audioSystem } from './AudioSystem';
import type { LadderDef } from './LadderSystem';
import {
  DEFAULT_TURN_SPEED,
  WAYPOINT_THRESHOLD,
  HOP_HEIGHT,
  FOOT_SFX_COOLDOWN,
  STEP_UP_RATE,
  GRAVITY,
  MAX_FALL_SPEED,
  CLIMB_SPEED,
  MOUNT_SPEED,
  DISMOUNT_SPEED,
  CLIMB_WALL_OFFSET,
  LADDER_WALL_OFFSET,
  RUNG_PAUSE,
  DISMOUNT_DIST,
  LADDER_RUNG_SPACING,
  LADDER_SEARCH_RADIUS,
  LADDER_DOT_THRESHOLD,
  WALK_SPEED_FACTOR,
} from './GameConstants';
import { CharacterModel } from './CharacterModel';
import { GltfCharacterModel } from './GltfCharacterModel';
import type { CharacterModelOpts } from './CharacterModel';
// CharacterModelOpts.meshUrl is the mesh-only GLB; shared animations loaded automatically

type AnyCharacterModel = CharacterModel | GltfCharacterModel;

interface ClimbState {
  ladder: LadderDef;
  direction: 'up' | 'down';
  phase: 'mount' | 'climb' | 'dismount';
  phaseTime: number;
  mountDuration: number;
  dismountDuration: number;
  startX: number;
  startZ: number;
  targetFacing: number;
  rungCount: number;
  currentRung: number;
  rungPauseTimer: number;
  /** Index of the ladder waypoint in path[] (for path line rendering) */
  ladderWpIndex: number;
}

export class CharacterController {
  readonly root: THREE.Group;
  private navGrid: NavGrid;
  private facingAngle = 0;
  private path: { x: number; z: number }[] = [];
  private pathIndex = 0;
  private moveSpeed = 0;
  private hopEnabled = false;
  private walking = false;
  private _onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private hopPhase = 0;
  private lastHopHalf = 0;
  private footSfxTimer = 0;

  // Movement
  private snapMode: 'free' | '4dir' | '8dir' = 'free';
  private stringPull = true;

  // WASD grid: settle to cell center on key release
  private settleTarget: { x: number; z: number } | null = null;
  private settleSpeed = 0;
  private wasMoving = false;

  // Debug path visualization
  private pathLine = new PathLineRenderer();
  private goalRadius = 0;
  private obstacles: ReadonlyArray<AABBBox> = [];
  private collisionRadius = 0.25;
  private stepUp = 0.5;
  private stepDown = 1.0;

  // Ladder climbing
  private ladderDefs: LadderDef[] = [];
  private climbState: ClimbState | null = null;
  private pathMeta: WaypointMeta[] = [];
  private turnSpeed = DEFAULT_TURN_SPEED;
  private gravity = GRAVITY;
  private maxFallSpeed = MAX_FALL_SPEED;
  private groundY = 0;
  private visualGroundY = 0; // smoothed render height (lerp up, gravity down)
  private velocityY = 0; // fall velocity for gravity-based descent
  private fallStartY = 0; // Y when fall began (for impact detection)
  private isFalling = false;
  private landingStun = 0; // seconds of movement pause after hard landing
  private dropDelay = 0; // brief pause at ledge edge before dropping
  private fallDamping = 1; // horizontal speed multiplier during falls (0-1)
  onLandingImpact: ((fallHeight: number) => void) | null = null; // set by Game.ts for camera shake
  private pathNavHeights: number[] = []; // NavGrid heights per waypoint (for groundY interpolation)
  private prevWaypointNavH = 0; // NavGrid height of the waypoint we just left

  // Character model (GLB with skeleton + animations)
  private model: AnyCharacterModel | null = null;
  private placeholderMesh: THREE.Mesh | null = null;
  /** Called when model finishes loading — passes animation name list */
  onAnimationsLoaded: ((names: string[]) => void) | null = null;

  constructor(navGrid: NavGrid) {
    this.navGrid = navGrid;
    this.root = new THREE.Group();

    // Placeholder box until model loads
    const geo = new THREE.BoxGeometry(0.25, 0.5, 0.25);
    geo.translate(0, 0.25, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x44aaff,
      roughness: 0.6,
    });
    this.placeholderMesh = new THREE.Mesh(geo, mat);
    this.placeholderMesh.castShadow = true;
    this.placeholderMesh.receiveShadow = true;
    this.root.add(this.placeholderMesh);

    // Shift = toggle walk/run
    this._onKeyDown = (e: KeyboardEvent) => {
      if (e.type === 'keydown' && (e.code === 'ShiftLeft' || e.code === 'ShiftRight')) {
        this.walking = !this.walking;
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
  }

  /** Load a GLB character model to replace the placeholder box.
   *  loaderType: 'imminence' = CharacterModel (mesh+shared anims), 'gltf' = GltfCharacterModel (self-contained) */
  loadModel(opts: CharacterModelOpts, loaderType: 'imminence' | 'gltf' = 'imminence'): void {
    // Clean up previous model if any
    this.clearModel();
    const origOnLoaded = opts.onLoaded;
    const ModelClass = loaderType === 'gltf' ? GltfCharacterModel : CharacterModel;
    this.model = new ModelClass({
      ...opts,
      onMeshReady: () => {
        // Show model immediately when mesh loads (before animations)
        if (this.placeholderMesh) {
          this.root.remove(this.placeholderMesh);
          this.placeholderMesh.geometry.dispose();
          (this.placeholderMesh.material as THREE.Material).dispose();
          this.placeholderMesh = null;
        }
        this.root.add(this.model!.group);
        // Debug: verify hierarchy
        const rootPos = this.root.position;
        const grpPos = this.model!.group.position;
        console.log(`[CharController] Model group added to root. root pos=(${rootPos.x.toFixed(2)}, ${rootPos.y.toFixed(2)}, ${rootPos.z.toFixed(2)}), group pos=(${grpPos.x.toFixed(2)}, ${grpPos.y.toFixed(2)}, ${grpPos.z.toFixed(2)}), root.children=${this.root.children.length}`);
      },
      onLoaded: (names) => {
        origOnLoaded?.(names);
        this.onAnimationsLoaded?.(names);
      },
    });
  }

  /** Remove current model and restore placeholder box. */
  clearModel(): void {
    if (this.model) {
      this.root.remove(this.model.group);
      this.model.dispose();
      this.model = null;
    }
    if (!this.placeholderMesh) {
      const geo = new THREE.BoxGeometry(0.25, 0.5, 0.25);
      geo.translate(0, 0.25, 0);
      const mat = new THREE.MeshStandardMaterial({ color: 0x44aaff, roughness: 0.6 });
      this.placeholderMesh = new THREE.Mesh(geo, mat);
      this.placeholderMesh.castShadow = true;
      this.placeholderMesh.receiveShadow = true;
      this.root.add(this.placeholderMesh);
    }
  }

  /** Get the character model (if loaded). */
  getModel(): AnyCharacterModel | null {
    return this.model;
  }

  /** Call once after adding root to scene */
  setScene(scene: THREE.Scene): void {
    this.pathLine.setScene(scene);
  }

  setObstacles(obs: ReadonlyArray<AABBBox>): void {
    this.obstacles = obs;
  }

  setStepUp(v: number): void {
    this.stepUp = v;
  }
  setStepDown(v: number): void {
    this.stepDown = v;
  }
  setTurnSpeed(v: number): void {
    this.turnSpeed = v;
  }
  setHopEnabled(v: boolean): void {
    this.hopEnabled = v;
  }

  setGravity(v: number): void {
    this.gravity = v;
    this.maxFallSpeed = v * 0.5; // terminal velocity scales with gravity
  }

  setNavGrid(navGrid: NavGrid): void {
    this.navGrid = navGrid;
    this.path.length = 0;
    this.settleTarget = null;
    this.pathLine.clear();
  }

  setStringPull(v: boolean): void {
    this.stringPull = v;
  }

  setSnapMode(mode: 'free' | '4dir' | '8dir'): void {
    if (mode === this.snapMode) return;
    this.snapMode = mode;
    if (mode === '4dir' || mode === '8dir') {
      const pos = this.root.position;
      this.settleTarget = this.navGrid.snapToGrid(pos.x, pos.z);
      this.settleSpeed = 5;
    } else {
      this.settleTarget = null;
    }
  }

  setDebugPath(enabled: boolean): void {
    this.pathLine.setEnabled(enabled);
  }

  setLadderDefs(defs: LadderDef[]): void {
    this.ladderDefs = defs;
  }

  isClimbing(): boolean {
    return this.climbState !== null;
  }

  /** Start climbing a ladder. Called automatically when path has a ladder waypoint. */
  private startClimb(ladder: LadderDef, direction: 'up' | 'down'): void {
    const pos = this.root.position;

    // facingDX/DZ points from low cell INTO the wall (toward high cell).
    // The ladder mesh sits on the low cell side, against the wall.
    // Mount position: on the low cell side, offset slightly from the wall face.
    // For climbing UP: mount at low side (stand in front of wall, face the wall)
    // For climbing DOWN: mount at high side (stand on top, face away from edge)
    const wallX = (ladder.lowWorldX + ladder.highWorldX) * 0.5;
    const wallZ = (ladder.lowWorldZ + ladder.highWorldZ) * 0.5;
    // Stand offset from wall toward the low side
    const climbX = wallX - ladder.facingDX * CLIMB_WALL_OFFSET;
    const climbZ = wallZ - ladder.facingDZ * CLIMB_WALL_OFFSET;

    const mountDist = Math.sqrt((climbX - pos.x) ** 2 + (climbZ - pos.z) ** 2);

    // Always face the wall (into the ladder) while climbing — both up and down
    const targetFacing = Math.atan2(ladder.facingDX, ladder.facingDZ);

    const dy = ladder.topY - ladder.bottomY;
    const rungCount = Math.max(1, Math.floor(dy / LADDER_RUNG_SPACING));

    this.climbState = {
      ladder,
      direction,
      phase: 'mount',
      phaseTime: 0,
      mountDuration: Math.max(0.05, mountDist / MOUNT_SPEED),
      dismountDuration: Math.max(0.05, DISMOUNT_DIST / DISMOUNT_SPEED),
      startX: pos.x,
      startZ: pos.z,
      targetFacing,
      rungCount,
      currentRung: direction === 'up' ? 0 : rungCount,
      rungPauseTimer: 0,
      ladderWpIndex: -1, // set by caller
    };

    this.moveSpeed = 0;
  }

  /** Try to find a ladder aligned with WASD movement direction when blocked. */
  private tryAutoLadder(
    moveDX: number,
    moveDZ: number,
    gx: number,
    gz: number,
  ): void {
    if (this.ladderDefs.length === 0) return;

    const links = this.navGrid.getNavLinks(gx, gz);
    if (!links) return;

    let bestDot = LADDER_DOT_THRESHOLD;
    let bestLadder: LadderDef | null = null;
    let bestDir: 'up' | 'down' = 'up';

    for (const link of links) {
      if (link.ladderIndex < 0 || link.ladderIndex >= this.ladderDefs.length)
        continue;
      const ladder = this.ladderDefs[link.ladderIndex];

      // Direction from current cell to link target
      const toWorld = this.navGrid.gridToWorld(link.toGX, link.toGZ);
      const fromWorld = this.navGrid.gridToWorld(gx, gz);
      const dx = toWorld.x - fromWorld.x;
      const dz = toWorld.z - fromWorld.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.01) continue;

      // Dot product with movement direction
      const dot = (moveDX * dx + moveDZ * dz) / len;
      if (dot > bestDot) {
        bestDot = dot;
        bestLadder = ladder;
        // Determine direction based on height comparison
        const fromCell = this.navGrid.getCell(gx, gz);
        const toCell = this.navGrid.getCell(link.toGX, link.toGZ);
        bestDir =
          toCell && fromCell && toCell.surfaceHeight > fromCell.surfaceHeight
            ? 'up'
            : 'down';
      }
    }

    if (bestLadder) {
      this.startClimb(bestLadder, bestDir);
    }
  }

  /** Update the climbing state machine each frame. Returns true while climbing. */
  private updateClimb(dt: number): boolean {
    const cs = this.climbState;
    if (!cs) return false;

    const pos = this.root.position;
    const ladder = cs.ladder;
    cs.phaseTime += dt;

    // Smoothly face the ladder throughout all phases
    this.facingAngle = lerpAngle(
      this.facingAngle,
      cs.targetFacing,
      1 - Math.exp(-12 * dt),
    );
    this.root.rotation.y = this.facingAngle;

    // Climb XZ: midpoint between low/high cells, offset toward low side
    const wallX = (ladder.lowWorldX + ladder.highWorldX) * 0.5;
    const wallZ = (ladder.lowWorldZ + ladder.highWorldZ) * 0.5;
    const climbX = wallX - ladder.facingDX * CLIMB_WALL_OFFSET;
    const climbZ = wallZ - ladder.facingDZ * CLIMB_WALL_OFFSET;

    if (cs.phase === 'mount') {
      // Walk toward the ladder climb position
      const t = Math.min(cs.phaseTime / cs.mountDuration, 1);
      pos.x = cs.startX + (climbX - cs.startX) * t;
      pos.z = cs.startZ + (climbZ - cs.startZ) * t;

      if (t >= 1) {
        cs.phase = 'climb';
        cs.phaseTime = 0;
      }
    } else if (cs.phase === 'climb') {
      // Keep character locked to ladder XZ
      pos.x = climbX;
      pos.z = climbZ;

      // Rung pause
      if (cs.rungPauseTimer > 0) {
        cs.rungPauseTimer -= dt;
        pos.y = this.visualGroundY;
        return true;
      }

      // Continuous vertical movement toward next rung
      const targetRung =
        cs.direction === 'up' ? cs.currentRung + 1 : cs.currentRung - 1;
      const rungT = cs.rungCount > 0 ? targetRung / cs.rungCount : 1;
      const totalDY = ladder.topY - ladder.bottomY;
      const targetY = ladder.bottomY + totalDY * rungT;

      const diff = targetY - this.groundY;
      const step = CLIMB_SPEED * dt;

      if (Math.abs(diff) <= step) {
        // Reached the rung — play step SFX
        this.groundY = targetY;
        this.visualGroundY = targetY;
        cs.currentRung = targetRung;
        cs.rungPauseTimer = RUNG_PAUSE;
        audioSystem.playStep(0.6);

        // Check if done
        const done =
          cs.direction === 'up'
            ? cs.currentRung >= cs.rungCount
            : cs.currentRung <= 0;
        if (done) {
          cs.phase = 'dismount';
          cs.phaseTime = 0;
          cs.startX = pos.x;
          cs.startZ = pos.z;
          // Turn 180 on dismount only when going down (face away from wall)
          if (cs.direction === 'down') {
            cs.targetFacing = Math.atan2(-ladder.facingDX, -ladder.facingDZ);
          }
        }
      } else {
        // Move toward target rung
        this.groundY += (diff > 0 ? 1 : -1) * step;
        this.visualGroundY = this.groundY;
      }

      pos.y = this.visualGroundY;
      return true;
    } else if (cs.phase === 'dismount') {
      // Walk from ladder onto the destination cell
      const exitX =
        cs.direction === 'up' ? ladder.highWorldX : ladder.lowWorldX;
      const exitZ =
        cs.direction === 'up' ? ladder.highWorldZ : ladder.lowWorldZ;

      const t = Math.min(cs.phaseTime / cs.dismountDuration, 1);
      pos.x = cs.startX + (exitX - cs.startX) * t;
      pos.z = cs.startZ + (exitZ - cs.startZ) * t;

      if (t >= 1) {
        pos.x = exitX;
        pos.z = exitZ;
        this.groundY = cs.direction === 'up' ? ladder.topY : ladder.bottomY;
        this.visualGroundY = this.groundY;
        this.velocityY = 0;
        this.climbState = null;
        this.pathLine.clearFrozen();
        this.pathLine.clear();
        return false;
      }
    }

    pos.y = this.visualGroundY;
    return true;
  }

  /** Get navgrid surface height at a world position */
  private getSurfaceAt = (wx: number, wz: number): number => {
    const grid = this.navGrid.worldToGrid(wx, wz);
    const cell = this.navGrid.getCell(grid.gx, grid.gz);
    return cell ? cell.surfaceHeight + 0.05 : 0.05;
  };

  private updatePathLine(): void {
    this.pathLine.update({
      charPos: this.root.position,
      groundY: this.groundY,
      path: this.path,
      pathIndex: this.pathIndex,
      pathMeta: this.pathMeta,
      goalRadius: this.goalRadius,
      cellSize: this.navGrid.cellSize,
      climbState: this.climbState,
      getSurfaceAt: this.getSurfaceAt,
    });
  }

  /** Camera-relative WASD movement.
   *  Free mode: continuous movement with collision.
   *  Grid modes: continuous movement with direction snapping + settle to cell center. */
  moveDirectional(
    dx: number,
    dz: number,
    cameraAngleY: number,
    dt: number,
    baseSpeed: number,
  ): void {
    const speed = this.walking ? baseSpeed * WALK_SPEED_FACTOR : baseSpeed;
    // Don't allow movement while climbing, stunned, or pausing at ledge edge
    if (this.climbState) return;
    if (this.landingStun > 0) return;
    if (this.dropDelay > 0) return;

    if (dx === 0 && dz === 0) {
      if (this.moveSpeed > 0 && this.path.length === 0) {
        const isGrid = this.snapMode === '4dir' || this.snapMode === '8dir';
        if (isGrid && this.wasMoving && !this.settleTarget) {
          this.settleTarget = this.navGrid.snapToGrid(
            this.root.position.x,
            this.root.position.z,
          );
          this.settleSpeed = baseSpeed;
        }
        this.moveSpeed = 0;
        this.wasMoving = false;
      }
      return;
    }

    // Cancel settle + A* path
    this.settleTarget = null;
    if (this.path.length > 0) {
      this.path.length = 0;
      this.pathLine.clear();
    }

    // Rotate input by camera Y angle
    const cos = Math.cos(cameraAngleY);
    const sin = Math.sin(cameraAngleY);
    let nx = dx * cos + dz * sin;
    let nz = -dx * sin + dz * cos;
    const len = Math.sqrt(nx * nx + nz * nz);
    nx /= len;
    nz /= len;

    // Grid modes: snap direction to 4 or 8 directions
    if (this.snapMode === '4dir') {
      if (Math.abs(nx) >= Math.abs(nz)) {
        nx = nx > 0 ? 1 : -1;
        nz = 0;
      } else {
        nz = nz > 0 ? 1 : -1;
        nx = 0;
      }
    } else if (this.snapMode === '8dir') {
      const angle = Math.atan2(nx, nz);
      const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      nx = Math.sin(snapped);
      nz = Math.cos(snapped);
    }

    this.moveSpeed = speed;
    this.wasMoving = true;
    const pos = this.root.position;
    const oldX = pos.x;
    const oldZ = pos.z;
    // Apply fall damping to direct movement (computed in update())
    const effSpeed = speed * this.fallDamping;
    pos.x += nx * effSpeed * dt;
    pos.z += nz * effSpeed * dt;

    // Clamp to navGrid bounds
    const half = this.navGrid.getHalfSize();
    pos.x = Math.max(-half, Math.min(half, pos.x));
    pos.z = Math.max(-half, Math.min(half, pos.z));

    // Ledge guard: prevent dropping more than stepDown (NavGrid cell-based, like voxel engine)
    {
      const oldG = this.navGrid.worldToGrid(oldX, oldZ);
      const newG = this.navGrid.worldToGrid(pos.x, pos.z);
      const cellChanged = oldG.gx !== newG.gx || oldG.gz !== newG.gz;
      // If blocked by wall (same cell), check for ladders in movement direction
      if (!cellChanged && this.moveSpeed > 0 && !this.climbState) {
        // Check the adjacent cell in movement direction for a wall
        const adjGX = oldG.gx + Math.round(nx);
        const adjGZ = oldG.gz + Math.round(nz);
        const adjCell = this.navGrid.getCell(adjGX, adjGZ);
        const oldCell = this.navGrid.getCell(oldG.gx, oldG.gz);
        const oldH = oldCell ? oldCell.surfaceHeight : 0;
        const adjH = adjCell ? adjCell.surfaceHeight : 0;
        // Only try ladder if the adjacent cell is actually a wall (too high to step up)
        if (adjH - oldH > this.stepUp) {
          this.tryAutoLadder(nx, nz, oldG.gx, oldG.gz);
        }
      }
      if (cellChanged) {
        const oldCell = this.navGrid.getCell(oldG.gx, oldG.gz);
        const newCell = this.navGrid.getCell(newG.gx, newG.gz);
        const oldH = oldCell ? oldCell.surfaceHeight : 0;
        const newH = newCell ? newCell.surfaceHeight : 0;
        const heightDiff = newH - oldH;
        const blocked = oldH - newH > this.stepDown || heightDiff > this.stepUp;
        if (blocked) {
          pos.x = oldX;
          pos.z = oldZ;
          // Auto-trigger ladder: search nearby nav-links aligned with movement
          this.tryAutoLadder(nx, nz, oldG.gx, oldG.gz);
        }
      }
    }

    // Smooth facing
    const targetAngle = Math.atan2(nx, nz);
    this.facingAngle = lerpAngle(
      this.facingAngle,
      targetAngle,
      1 - Math.exp(-this.turnSpeed * dt),
    );
    this.root.rotation.y = this.facingAngle;
  }

  private autoMove = true;
  private pathPaused = false;
  private clickCount = 0;

  setAutoMove(v: boolean): void {
    this.autoMove = v;
  }

  isPathPaused(): boolean {
    return this.pathPaused;
  }

  /** Click-to-move. Tracks click count per goal — first click generates path, second starts movement.
   *  isDrag=true means this came from a continuous drag — never resumes a paused path. */
  goTo(
    worldX: number,
    worldZ: number,
    speed: number,
    markerRadius = 0,
    isDrag = false,
  ): boolean {
    const pos = this.root.position;
    const isGrid = this.snapMode === '4dir' || this.snapMode === '8dir';
    const cardinalOnly = this.snapMode === '4dir';

    let gx = worldX,
      gz = worldZ;
    if (isGrid) {
      const snapped = this.navGrid.snapToGrid(worldX, worldZ);
      gx = snapped.x;
      gz = snapped.z;
    }

    // Check if clicking on the same goal cell as existing paused path
    if (this.pathPaused && this.path.length > 0) {
      const goal = this.path[this.path.length - 1];
      const cs = this.navGrid.cellSize;
      const sameGoal =
        Math.abs(gx - goal.x) < cs * 0.5 && Math.abs(gz - goal.z) < cs * 0.5;

      if (sameGoal) {
        if (!isDrag) {
          this.clickCount++;
          if (this.clickCount >= 2) {
            // Second click on same goal — start moving
            this.pathPaused = false;
            this.moveSpeed = speed;
            this.clickCount = 0;
            // Check if the current waypoint is a ladder — start climbing immediately
            const meta = this.pathMeta[this.pathIndex];
            if (
              meta &&
              meta.ladderIndex != null &&
              meta.ladderIndex >= 0 &&
              meta.ladderIndex < this.ladderDefs.length
            ) {
              const ladder = this.ladderDefs[meta.ladderIndex];
              const dir = meta.climbDirection ?? 'up';
              const wpIdx = this.pathIndex;
              this.pathIndex++;
              this.startClimb(ladder, dir);
              this.climbState!.ladderWpIndex = wpIdx;
              this.updatePathLine();
            }
            return true;
          }
        }
        return true; // same goal — already showing path (drag or first click)
      }
      // Different cell — fall through to generate new path
    }

    // Generate new path
    const goalGrid = this.navGrid.worldToGrid(gx, gz);
    const goalCell = this.navGrid.getCell(goalGrid.gx, goalGrid.gz);
    const result = findPath(
      this.navGrid,
      pos.x,
      pos.z,
      gx,
      gz,
      10000,
      cardinalOnly,
      this.stringPull,
    );
    if (!result.found || result.path.length < 2) {
      return false;
    }
    this.path = result.path;
    this.pathMeta = result.meta;
    this.pathIndex = 1;

    this.settleTarget = null;
    this.goalRadius = markerRadius;

    // If the first waypoint we're heading to is a ladder, start climbing immediately
    // (handles case where character is already standing on the ladder's low cell)
    // But only if autoMove is enabled — otherwise let the path be shown first
    const firstMeta = this.pathMeta[1];
    if (
      this.autoMove &&
      firstMeta &&
      firstMeta.ladderIndex != null &&
      firstMeta.ladderIndex >= 0 &&
      firstMeta.ladderIndex < this.ladderDefs.length
    ) {
      const ladder = this.ladderDefs[firstMeta.ladderIndex];
      const dir = firstMeta.climbDirection ?? 'up';
      this.pathIndex = 2; // skip past ladder waypoint
      this.startClimb(ladder, dir);
      this.climbState!.ladderWpIndex = 1;
      this.updatePathLine();
      return true;
    }
    this.clickCount = 1;
    // Pre-compute NavGrid heights for each waypoint (used for groundY interpolation)
    this.pathNavHeights = result.path.map((wp) => {
      const g = this.navGrid.worldToGrid(wp.x, wp.z);
      const cell = this.navGrid.getCell(g.gx, g.gz);
      return cell ? cell.surfaceHeight : 0;
    });
    this.prevWaypointNavH = this.pathNavHeights[0];

    if (this.autoMove) {
      this.moveSpeed = speed;
      this.pathPaused = false;
    } else {
      this.moveSpeed = 0;
      this.pathPaused = true;
    }

    this.updatePathLine();
    return true;
  }

  /** Snap a world position to grid cell center */
  getSnappedGoal(worldX: number, worldZ: number): { x: number; z: number } {
    return this.navGrid.snapToGrid(worldX, worldZ);
  }

  /** Advance path following + settle + collision + hop. Call every frame. */
  private _baseSpeed = 0;

  update(dt: number, baseSpeed: number): void {
    this._baseSpeed = baseSpeed;
    const speed = this.walking ? baseSpeed * WALK_SPEED_FACTOR : baseSpeed;
    // ── Climbing state machine takes priority ──
    if (this.climbState) {
    }
    if (this.updateClimb(dt)) {
      if (
        this.pathLine.isEnabled() &&
        (this.pathLine.hasFrozenPositions() ||
          (this.path.length > 0 && this.pathIndex < this.path.length))
      ) {
        this.updatePathLine();
      }
      // Still update the model mixer so animations play during climbing
      this.model?.update(dt);
      return;
    }

    const pos = this.root.position;

    // ── Settle: glide to nearest cell center on key release (grid modes) ──
    if (this.settleTarget) {
      const sdx = this.settleTarget.x - pos.x;
      const sdz = this.settleTarget.z - pos.z;
      const sDist = Math.sqrt(sdx * sdx + sdz * sdz);
      if (sDist < 0.01) {
        pos.x = this.settleTarget.x;
        pos.z = this.settleTarget.z;
        this.settleTarget = null;
        this.settleSpeed = 0;
      } else {
        this.settleSpeed = Math.max(speed * 0.15, this.settleSpeed - 14 * dt);
        const step = Math.min(this.settleSpeed * dt, sDist);
        pos.x += (sdx / sDist) * step;
        pos.z += (sdz / sDist) * step;
        this.moveSpeed = this.settleSpeed;
      }
    }

    // ── Drop detection: freeze horizontal movement during drops (> 1 cell) ──
    // Stair steps (≤1 cell) move normally. Drops halt horizontally until landing.
    const isDrop = this.isFalling && (this.visualGroundY - this.groundY) > this.navGrid.cellSize;
    this.fallDamping = isDrop ? 0 : 1;

    // ── A* path following: continuous waypoint movement (all modes) ──
    if (
      this.path.length > 0 &&
      this.pathIndex < this.path.length &&
      !this.pathPaused &&
      this.landingStun <= 0 &&
      this.dropDelay <= 0
    ) {
      const target = this.path[this.pathIndex];
      const pdx = target.x - pos.x;
      const pdz = target.z - pos.z;
      const dist = Math.sqrt(pdx * pdx + pdz * pdz);

      const isLast = this.pathIndex >= this.path.length - 1;
      // Tighter threshold at waypoints with significant height drops to avoid skipping
      let reach = isLast ? 0.15 : WAYPOINT_THRESHOLD;
      if (!isLast && this.pathNavHeights.length > 0) {
        const curH = this.pathNavHeights[this.pathIndex] ?? 0;
        const prevH = this.pathNavHeights[this.pathIndex - 1] ?? curH;
        if (Math.abs(curH - prevH) > this.navGrid.cellSize * 0.5) {
          reach = Math.min(reach, 0.12);
        }
      }

      if (dist < reach) {
        // Set groundY to this waypoint's NavGrid height (stable, no collision artifacts)
        this.prevWaypointNavH = this.pathNavHeights[this.pathIndex] ?? 0;
        this.groundY = this.prevWaypointNavH;

        // Advance to next waypoint
        this.pathIndex++;

        if (this.pathIndex >= this.path.length) {
          // Snap to exact goal
          const goal = this.path[this.path.length - 1];
          pos.x = goal.x;
          pos.z = goal.z;
          this.path.length = 0;
          this.pathNavHeights.length = 0;
          this.pathMeta.length = 0;
          this.moveSpeed = 0;
          this.pathLine.clear();
        } else {
          // Check if the NEW waypoint we're heading toward is a ladder
          const meta = this.pathMeta[this.pathIndex];
          if (
            meta &&
            meta.ladderIndex != null &&
            meta.ladderIndex >= 0 &&
            meta.ladderIndex < this.ladderDefs.length
          ) {
            const ladder = this.ladderDefs[meta.ladderIndex];
            const dir = meta.climbDirection ?? 'up';
            this.startClimb(ladder, dir);
            this.climbState!.ladderWpIndex = this.pathIndex;
            return; // climbing takes over
          }
          this.updatePathLine();
        }
      } else {
        let moveSpd = speed;
        // Clamp speed on final approach to prevent overshoot (like voxel-engine)
        if (isLast) {
          const maxStep = dist / dt;
          moveSpd = Math.min(speed, Math.max(0.5, maxStep));
        }
        // Apply fall damping — slow horizontal movement while airborne
        moveSpd *= this.fallDamping;
        const step = Math.min(moveSpd * dt, dist);
        pos.x += (pdx / dist) * step;
        pos.z += (pdz / dist) * step;

        const targetAngle = Math.atan2(pdx / dist, pdz / dist);
        this.facingAngle = lerpAngle(
          this.facingAngle,
          targetAngle,
          1 - Math.exp(-this.turnSpeed * dt),
        );
        this.root.rotation.y = this.facingAngle;
        this.moveSpeed = speed;
      }
    }

    // ── Rebuild debug path line each frame to track character smoothly ──
    if (
      this.pathLine.isEnabled() &&
      this.path.length > 0 &&
      this.pathIndex < this.path.length &&
      !this.pathPaused
    ) {
      this.updatePathLine();
    }

    // ── Collision + ground height ──
    if (this.obstacles.length > 0) {
      const resolved = resolveCollision(
        pos.x,
        pos.z,
        this.obstacles,
        this.collisionRadius,
        this.groundY,
        this.stepUp,
      );
      pos.x = resolved.x;
      pos.z = resolved.z;

      // During path following: track NavGrid cell height with stair-ascent protection
      // Free movement: use collision-based surface detection
      if (
        this.path.length > 0 &&
        this.pathIndex > 0 &&
        this.pathIndex < this.path.length &&
        this.pathNavHeights.length > 0
      ) {
        const targetNavH = this.pathNavHeights[this.pathIndex] ?? 0;
        const heightDiff = targetNavH - this.prevWaypointNavH;
        // For step-ups (small height increases), lerp groundY based on XZ progress
        // toward the waypoint. This prevents groundY from jumping when the grid cell
        // changes, keeping it in sync with visual movement (like free movement does).
        // For drops and flat segments, use the cell-based approach.
        const g = this.navGrid.worldToGrid(pos.x, pos.z);
        const navCell = this.navGrid.getCell(g.gx, g.gz);
        const cellH = navCell ? navCell.surfaceHeight : 0;
        // Floor: never drop below the minimum of prev/target waypoint heights.
        const minWaypointH = Math.min(this.prevWaypointNavH, targetNavH);
        // Ceiling: only cap when heading DOWN — prevents groundY from rising
        // back above the terrace we just left. Don't cap when heading up.
        if (targetNavH < this.prevWaypointNavH) {
          this.groundY = Math.min(Math.max(cellH, minWaypointH), this.prevWaypointNavH);
        } else {
          this.groundY = Math.max(cellH, minWaypointH);
        }
      } else {
        const surfaceY = getSurfaceHeight(
          pos.x,
          pos.z,
          this.obstacles,
          this.collisionRadius * 0.5,
        );
        if (surfaceY - this.groundY <= this.stepUp) {
          this.groundY = surfaceY;
        }
      }
    } else {
      this.groundY = 0;
    }

    // Clamp to navGrid bounds (after collision)
    const half = this.navGrid.getHalfSize();
    pos.x = Math.max(-half, Math.min(half, pos.x));
    pos.z = Math.max(-half, Math.min(half, pos.z));

    // ── Landing stun (pause after hard drop) ──
    if (this.landingStun > 0) {
      this.landingStun -= dt;
    }

    // ── Smooth visual Y (lerp up, gravity down — matches voxel-engine) ──
    if (this.groundY > this.visualGroundY) {
      // Stepping up: exponential lerp
      const gap = this.groundY - this.visualGroundY;
      this.visualGroundY =
        this.visualGroundY +
        gap * (1 - Math.exp(-STEP_UP_RATE * dt));
      this.velocityY = 0;
      this.isFalling = false;
    } else if (this.groundY < this.visualGroundY) {
      const cellSize = this.navGrid.cellSize;
      // Track fall start
      if (!this.isFalling) {
        this.isFalling = true;
        this.fallStartY = this.visualGroundY;
        // "Drop" = gap > 1 cell → pause at ledge before gravity
        const dropGap = this.visualGroundY - this.groundY;
        if (dropGap > cellSize) {
          this.dropDelay = 0.08;
        }
      }
      // During drop delay: freeze at ledge edge
      if (this.dropDelay > 0) {
        this.dropDelay -= dt;
      } else {
        // Gravity-based fall
        this.velocityY = Math.min(
          this.velocityY + this.gravity * dt,
          this.maxFallSpeed,
        );
        this.visualGroundY -= this.velocityY * dt;
      }
      // Landing
      if (this.visualGroundY <= this.groundY) {
        this.visualGroundY = this.groundY;
        // Landing stun for drops (> 1 cell)
        const fallHeight = this.fallStartY - this.groundY;
        if (fallHeight > cellSize) {
          const cells = fallHeight / cellSize;
          this.landingStun = Math.min(0.08 + cells * 0.04, 0.3);
          audioSystem.playStep(Math.min(0.5 + cells * 0.1, 1.0), 0.6);
          this.onLandingImpact?.(fallHeight);
        }
        this.velocityY = 0;
        this.isFalling = false;
      }
    } else {
      this.velocityY = 0;
      this.isFalling = false;
    }

    // ── Hop + step SFX ──
    this.footSfxTimer += dt;
    if (this.hopEnabled && this.moveSpeed > 0 && this.landingStun <= 0) {
      const hopSpeed = this.walking ? this.moveSpeed * 1.5 : this.moveSpeed;
      this.hopPhase += dt * hopSpeed * 4;
      const hop = Math.abs(Math.sin(this.hopPhase)) * (this.walking ? 0 : HOP_HEIGHT);
      pos.y = this.visualGroundY + hop;

      // Play step SFX each time sin crosses zero (foot landing)
      const currentHopHalf = Math.floor(this.hopPhase / Math.PI) % 2;
      if (currentHopHalf !== this.lastHopHalf) {
        this.lastHopHalf = currentHopHalf;
        if (this.footSfxTimer >= FOOT_SFX_COOLDOWN) {
          this.footSfxTimer = 0;
          audioSystem.playStep(0.7);
        }
      }
    } else {
      // Play arrival step when stopping, if cooldown allows
      if (this.hopPhase > 0 && this.footSfxTimer >= FOOT_SFX_COOLDOWN) {
        this.footSfxTimer = 0;
        audioSystem.playStep(0.7);
      }
      pos.y = this.visualGroundY;
      this.hopPhase = 0;
      this.lastHopHalf = 0;
    }

    // Update character model animation mixer
    this.model?.update(dt);
  }

  /** Update the path line's last vertex to a custom world position (for smooth marker tracking) */
  setPathLineEndpoint(x: number, z: number): void {
    this.pathLine.setEndpoint(x, z, this.getSurfaceAt, this.goalRadius);
  }

  /** Access the path line renderer (for goal marker management). */
  getPathLine(): PathLineRenderer {
    return this.pathLine;
  }

  /** True while following an A* click-to-move path */
  isPathActive(): boolean {
    return this.path.length > 0;
  }

  getFacingAngle(): number {
    return this.facingAngle;
  }

  getIsMoving(): boolean {
    return this.moveSpeed > 0;
  }

  /** Returns the current locomotion state for animation syncing. */
  getAnimState(): { state: 'idle' | 'walk' | 'run' | 'jump' | 'climb'; moveSpeed: number } {
    // Climbing ladder → climb (jump anim per rung)
    if (this.climbState && this.climbState.phase === 'climb') {
      return { state: 'climb', moveSpeed: 0 };
    }
    // Falling more than 1 cell → jump
    const heightDiff = Math.abs(this.visualGroundY - this.groundY);
    if (this.isFalling && heightDiff > this.navGrid.cellSize * 1.1) {
      return { state: 'jump', moveSpeed: this._baseSpeed };
    }
    // Moving horizontally → walk or run
    if (this.moveSpeed > 0 && this.landingStun <= 0) {
      return { state: this.walking ? 'walk' : 'run', moveSpeed: this._baseSpeed };
    }
    return { state: 'idle', moveSpeed: 0 };
  }

  isWalking(): boolean { return this.walking; }

  getPosition(): THREE.Vector3 {
    return this.root.position;
  }

  dispose(): void {
    if (this._onKeyDown) {
      window.removeEventListener('keydown', this._onKeyDown);
    }
    this.pathLine.dispose();
    this.model?.dispose();
    if (this.placeholderMesh) {
      this.placeholderMesh.geometry.dispose();
      (this.placeholderMesh.material as THREE.Material).dispose();
    }
    this.root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else (mat as THREE.Material).dispose();
      }
    });
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
