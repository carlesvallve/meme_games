import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import type { NavGrid } from './pathfinding/NavGrid';
import type { AABBBox } from './pathfinding/NavGrid';
import { findPath } from './pathfinding/AStar';
import { resolveCollision, getSurfaceHeight } from './CollisionUtils';
import { audioSystem } from './AudioSystem';

const DEFAULT_TURN_SPEED = 12;
const WAYPOINT_THRESHOLD = 0.3;
const HOP_HEIGHT = 0.06;
const FOOT_SFX_COOLDOWN = 0.12;
const STEP_UP_RATE = 20; // exponential lerp rate for stepping up
const GRAVITY = 60; // fall acceleration
const MAX_FALL_SPEED = 30; // terminal velocity

export class DummyCharacter {
  readonly root: THREE.Group;
  private navGrid: NavGrid;
  private facingAngle = 0;
  private path: { x: number; z: number }[] = [];
  private pathIndex = 0;
  private moveSpeed = 0;
  private hopEnabled = true;
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
  private debugPath = false;
  private pathLine: Line2 | null = null;
  private pathLineGeo: LineGeometry | null = null;
  private pathLineMat: LineMaterial | null = null;
  private scene: THREE.Scene | null = null;
  private goalRadius = 0;
  private obstacles: ReadonlyArray<AABBBox> = [];
  private collisionRadius = 0.25;
  private stepUp = 0.5;
  private stepDown = 1.0;
  private turnSpeed = DEFAULT_TURN_SPEED;
  private gravity = GRAVITY;
  private maxFallSpeed = MAX_FALL_SPEED;
  private groundY = 0;
  private visualGroundY = 0; // smoothed render height (lerp up, gravity down)
  private velocityY = 0; // fall velocity for gravity-based descent
  private pathNavHeights: number[] = []; // NavGrid heights per waypoint (for groundY interpolation)
  private prevWaypointNavH = 0; // NavGrid height of the waypoint we just left

  constructor(navGrid: NavGrid) {
    this.navGrid = navGrid;
    this.root = new THREE.Group();

    const geo = new THREE.BoxGeometry(0.5, 1, 0.5);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x44aaff, roughness: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  /** Call once after adding root to scene */
  setScene(scene: THREE.Scene): void {
    this.scene = scene;
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
  setGravity(v: number): void {
    this.gravity = v;
    this.maxFallSpeed = v * 0.5; // terminal velocity scales with gravity
  }

  setNavGrid(navGrid: NavGrid): void {
    this.navGrid = navGrid;
    this.path.length = 0;
    this.settleTarget = null;
    this.clearPathLine();
  }

  setStringPull(v: boolean): void { this.stringPull = v; }

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
    this.debugPath = enabled;
    if (!enabled && this.pathLine) {
      this.clearPathLine();
    }
  }

  /** Get navgrid surface height at a world position (for debug line) */
  private getSurfaceAt(wx: number, wz: number): number {
    const grid = this.navGrid.worldToGrid(wx, wz);
    const cell = this.navGrid.getCell(grid.gx, grid.gz);
    return cell ? cell.surfaceHeight + 0.05 : 0.05;
  }

  private updatePathLine(): void {
    if (!this.debugPath || !this.scene) return;
    this.clearPathLine();

    const remaining = this.path.slice(this.pathIndex);
    if (remaining.length < 1) return;

    const pos = this.root.position;
    const BIAS = 0.05;

    // Build untrimmed waypoints (goal radius trim applied to final line, not waypoints)
    const waypoints: { x: number; z: number }[] = [{ x: pos.x, z: pos.z }];
    for (const wp of remaining) {
      waypoints.push({ x: wp.x, z: wp.z });
    }

    // Build positions: for each segment, if waypoints have different heights,
    // walk cell-by-cell to find precise transitions. If same height, draw flat.
    const cs = this.navGrid.cellSize;
    const positions: number[] = [];
    let prevH = this.groundY + 0.05;
    positions.push(waypoints[0].x, prevH, waypoints[0].z);

    for (let i = 1; i < waypoints.length; i++) {
      const from = waypoints[i - 1];
      const to = waypoints[i];
      const toH = this.getSurfaceAt(to.x, to.z);
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const segLen = Math.sqrt(dx * dx + dz * dz);

      if (segLen < 0.001) continue;

      if (Math.abs(toH - prevH) > 0.01) {
        // Height change: place step at midpoint between waypoints
        const mx = (from.x + to.x) * 0.5;
        const mz = (from.z + to.z) * 0.5;
        positions.push(mx, prevH, mz);
        positions.push(mx, toH, mz);
      }

      positions.push(to.x, toH, to.z);
      prevH = toH;
    }

    // Trim final endpoint back by goalRadius (visual only — stop line at marker ring edge)
    if (this.goalRadius > 0 && positions.length >= 6) {
      const n = positions.length;
      const ex = positions[n - 3], ez = positions[n - 1];
      const px = positions[n - 6], pz = positions[n - 4];
      const dx = ex - px, dz = ez - pz;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > this.goalRadius) {
        positions[n - 3] = ex - (dx / len) * this.goalRadius;
        positions[n - 1] = ez - (dz / len) * this.goalRadius;
      }
    }

    this.pathLineGeo = new LineGeometry();
    this.pathLineGeo.setPositions(positions);
    this.pathLineMat = new LineMaterial({
      color: 0xffff00,
      linewidth: 3,
      transparent: true,
      opacity: 0.8,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
    });
    this.pathLine = new Line2(this.pathLineGeo, this.pathLineMat);
    this.pathLine.computeLineDistances();
    this.scene.add(this.pathLine);
  }

  private clearPathLine(): void {
    if (this.pathLine && this.scene) {
      this.scene.remove(this.pathLine);
      this.pathLineMat?.dispose();
      this.pathLineGeo?.dispose();
      this.pathLine = null;
      this.pathLineGeo = null;
      this.pathLineMat = null;
    }
  }

  /** Camera-relative WASD movement.
   *  Free mode: continuous movement with collision.
   *  Grid modes: continuous movement with direction snapping + settle to cell center. */
  moveDirectional(dx: number, dz: number, cameraAngleY: number, dt: number, speed: number): void {
    if (dx === 0 && dz === 0) {
      if (this.moveSpeed > 0 && this.path.length === 0) {
        const isGrid = this.snapMode === '4dir' || this.snapMode === '8dir';
        if (isGrid && this.wasMoving && !this.settleTarget) {
          this.settleTarget = this.navGrid.snapToGrid(this.root.position.x, this.root.position.z);
          this.settleSpeed = speed;
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
      this.clearPathLine();
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
      if (Math.abs(nx) >= Math.abs(nz)) { nx = nx > 0 ? 1 : -1; nz = 0; }
      else { nz = nz > 0 ? 1 : -1; nx = 0; }
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
    pos.x += nx * speed * dt;
    pos.z += nz * speed * dt;

    // Clamp to navGrid bounds
    const half = this.navGrid.getHalfSize();
    pos.x = Math.max(-half, Math.min(half, pos.x));
    pos.z = Math.max(-half, Math.min(half, pos.z));

    // Ledge guard: prevent dropping more than stepDown (NavGrid cell-based, like voxel engine)
    {
      const oldG = this.navGrid.worldToGrid(oldX, oldZ);
      const newG = this.navGrid.worldToGrid(pos.x, pos.z);
      if (oldG.gx !== newG.gx || oldG.gz !== newG.gz) {
        const oldCell = this.navGrid.getCell(oldG.gx, oldG.gz);
        const newCell = this.navGrid.getCell(newG.gx, newG.gz);
        const oldH = oldCell ? oldCell.surfaceHeight : 0;
        const newH = newCell ? newCell.surfaceHeight : 0;
        if (oldH - newH > this.stepDown) {
          pos.x = oldX;
          pos.z = oldZ;
        }
      }
    }

    // Smooth facing
    const targetAngle = Math.atan2(nx, nz);
    this.facingAngle = lerpAngle(this.facingAngle, targetAngle, 1 - Math.exp(-this.turnSpeed * dt));
    this.root.rotation.y = this.facingAngle;
  }

  private autoMove = true;
  private pathPaused = false;
  private clickCount = 0;

  setAutoMove(v: boolean): void { this.autoMove = v; }

  isPathPaused(): boolean { return this.pathPaused; }

  /** Click-to-move. Tracks click count per goal — first click generates path, second starts movement.
   *  isDrag=true means this came from a continuous drag — never resumes a paused path. */
  goTo(worldX: number, worldZ: number, speed: number, markerRadius = 0, isDrag = false): boolean {
    const pos = this.root.position;
    const isGrid = this.snapMode === '4dir' || this.snapMode === '8dir';
    const cardinalOnly = this.snapMode === '4dir';

    let gx = worldX, gz = worldZ;
    if (isGrid) {
      const snapped = this.navGrid.snapToGrid(worldX, worldZ);
      gx = snapped.x;
      gz = snapped.z;
    }

    // Check if clicking on the same goal cell as existing paused path
    if (this.pathPaused && this.path.length > 0) {
      const goal = this.path[this.path.length - 1];
      const cs = this.navGrid.cellSize;
      const sameGoal = Math.abs(gx - goal.x) < cs * 0.5 && Math.abs(gz - goal.z) < cs * 0.5;

      if (sameGoal) {
        if (!isDrag) {
          this.clickCount++;
          if (this.clickCount >= 2) {
            // Second click on same goal — start moving
            this.pathPaused = false;
            this.moveSpeed = speed;
            this.clickCount = 0;
            return true;
          }
        }
        return true; // same goal — already showing path (drag or first click)
      }
      // Different cell — fall through to generate new path
    }

    // Generate new path
    const result = findPath(this.navGrid, pos.x, pos.z, gx, gz, 10000, cardinalOnly, this.stringPull);
    if (!result.found || result.path.length < 2) return false;
    this.path = result.path;
    this.pathIndex = 1;
    this.settleTarget = null;
    this.goalRadius = markerRadius;
    this.clickCount = 1;
    // Pre-compute NavGrid heights for each waypoint (used for groundY interpolation)
    this.pathNavHeights = result.path.map(wp => {
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
  update(dt: number, speed: number): void {
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

    // ── A* path following: continuous waypoint movement (all modes) ──
    if (this.path.length > 0 && this.pathIndex < this.path.length && !this.pathPaused) {
      const target = this.path[this.pathIndex];
      const pdx = target.x - pos.x;
      const pdz = target.z - pos.z;
      const dist = Math.sqrt(pdx * pdx + pdz * pdz);

      const isLast = this.pathIndex >= this.path.length - 1;
      const reach = isLast ? 0.05 : WAYPOINT_THRESHOLD;

      if (dist < reach) {

        // Set groundY to this waypoint's NavGrid height (stable, no collision artifacts)
        this.prevWaypointNavH = this.pathNavHeights[this.pathIndex] ?? 0;
        this.groundY = this.prevWaypointNavH;
        this.pathIndex++;
        if (this.pathIndex >= this.path.length) {
          // Snap to exact goal
          const goal = this.path[this.path.length - 1];
          pos.x = goal.x;
          pos.z = goal.z;
          this.path.length = 0;
          this.pathNavHeights.length = 0;
          this.moveSpeed = 0;
          this.clearPathLine();
        } else {
          this.updatePathLine();
        }
      } else {
        // Slow down on stairs: climbing up, or small descent (within stepUp = stair steps).
        // Large drops and flat segments use full speed.
        // Only slow if BOTH the current segment has elevation change AND the target node
        // differs in height from its successor (we're mid-stairs, not on the last step).
        let moveSpd = speed;
        if (this.pathNavHeights.length > 0 && this.pathIndex > 0) {
          const prevH = this.pathNavHeights[this.pathIndex - 1] ?? 0;
          const curH = this.pathNavHeights[this.pathIndex] ?? 0;
          const diff = curH - prevH;
          const isStair = diff > 0.01 || (diff < -0.01 && -diff <= this.stepUp);
          if (isStair) {
            // Check if target node continues to change elevation (mid-stairs)
            // If next segment is flat, we're on the last step — don't slow down
            const nextH = this.pathNavHeights[this.pathIndex + 1];
            if (nextH !== undefined && Math.abs(nextH - curH) > 0.01) {
              moveSpd *= 0.5;
            }
          }
        }
        // Clamp speed on final approach to prevent overshoot (like voxel-engine)
        if (isLast) {
          const maxStep = dist / dt;
          moveSpd = Math.min(speed, Math.max(0.5, maxStep));
        }
        const step = Math.min(moveSpd * dt, dist);
        pos.x += (pdx / dist) * step;
        pos.z += (pdz / dist) * step;

        const targetAngle = Math.atan2(pdx / dist, pdz / dist);
        this.facingAngle = lerpAngle(this.facingAngle, targetAngle, 1 - Math.exp(-this.turnSpeed * dt));
        this.root.rotation.y = this.facingAngle;
        this.moveSpeed = speed;
      }
    }

    // ── Rebuild debug path line each frame to track character smoothly ──
    if (this.debugPath && this.path.length > 0 && this.pathIndex < this.path.length && !this.pathPaused) {
      this.updatePathLine();
    }

    // ── Collision + ground height ──
    if (this.obstacles.length > 0) {
      const resolved = resolveCollision(
        pos.x, pos.z,
        this.obstacles, this.collisionRadius,
        this.groundY, this.stepUp,
      );
      pos.x = resolved.x;
      pos.z = resolved.z;

      // During path following: track NavGrid cell height with stair-ascent protection
      // Free movement: use collision-based surface detection
      if (this.path.length > 0 && this.pathIndex > 0 && this.pathIndex < this.path.length && this.pathNavHeights.length > 0) {
        const targetNavH = this.pathNavHeights[this.pathIndex] ?? 0;
        const g = this.navGrid.worldToGrid(pos.x, pos.z);
        const navCell = this.navGrid.getCell(g.gx, g.gz);
        const cellH = navCell ? navCell.surfaceHeight : 0;
        if (targetNavH > this.prevWaypointNavH) {
          // Ascending: don't drop below prev waypoint height (protects diagonal stair traversal
          // where ground cells between stair steps would cause groundY=0 → collision blocks next step)
          this.groundY = Math.max(cellH, this.prevWaypointNavH);
        } else {
          // Descending/flat: follow NavGrid cell height directly
          this.groundY = cellH;
        }
      } else {
        const surfaceY = getSurfaceHeight(pos.x, pos.z, this.obstacles, this.collisionRadius * 0.5);
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

    // ── Smooth visual Y (lerp up, gravity down — matches voxel-engine) ──
    if (this.groundY > this.visualGroundY) {
      // Stepping up: exponential lerp
      this.visualGroundY = this.visualGroundY + (this.groundY - this.visualGroundY) * (1 - Math.exp(-STEP_UP_RATE * dt));
      this.velocityY = 0;
    } else if (this.groundY < this.visualGroundY) {
      // Stepping down: gravity-based fall
      this.velocityY = Math.min(this.velocityY + this.gravity * dt, this.maxFallSpeed);
      this.visualGroundY -= this.velocityY * dt;
      if (this.visualGroundY <= this.groundY) {
        this.visualGroundY = this.groundY;
        this.velocityY = 0;
      }
    } else {
      this.velocityY = 0;
    }

    // ── Hop + step SFX ──
    this.footSfxTimer += dt;
    if (this.hopEnabled && this.moveSpeed > 0) {
      this.hopPhase += dt * this.moveSpeed * 2;
      const hop = Math.abs(Math.sin(this.hopPhase)) * HOP_HEIGHT;
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
  }

  /** Update the path line's last vertex to a custom world position (for smooth marker tracking) */
  setPathLineEndpoint(x: number, z: number): void {
    if (!this.pathLine || !this.pathLineGeo) return;
    const attr = this.pathLineGeo.getAttribute('instanceEnd') as THREE.InterleavedBufferAttribute;
    if (!attr || !attr.data) return;
    const arr = attr.data.array as Float32Array;
    const numSegments = arr.length / 6;
    if (numSegments < 1) return;
    const si = (numSegments - 1) * 6;
    arr[si + 3] = x;
    arr[si + 4] = this.getSurfaceAt(x, z);
    arr[si + 5] = z;
    attr.data.needsUpdate = true;
    this.pathLine.computeLineDistances();
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

  getPosition(): THREE.Vector3 {
    return this.root.position;
  }

  dispose(): void {
    this.clearPathLine();
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
