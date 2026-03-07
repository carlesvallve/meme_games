import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import type { NavGrid } from './pathfinding/NavGrid';
import type { AABBBox } from './pathfinding/NavGrid';
import { findPath } from './pathfinding/AStar';
import { resolveCollision, getSurfaceHeight } from './CollisionUtils';
import { audioSystem } from './AudioSystem';

const TURN_SPEED = 12;
const WAYPOINT_THRESHOLD = 0.3;
const HOP_HEIGHT = 0.06;
const FOOT_SFX_COOLDOWN = 0.12;

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
  private stepHeight = 0.5;
  private groundY = 0;

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

  setStepHeight(v: number): void {
    this.stepHeight = v;
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

    // Build flat list of waypoints with final-goal radius trim
    const waypoints: { x: number; z: number }[] = [{ x: pos.x, z: pos.z }];
    for (let i = 0; i < remaining.length; i++) {
      let wx = remaining[i].x, wz = remaining[i].z;
      if (i === remaining.length - 1 && this.goalRadius > 0) {
        const prevX = i > 0 ? remaining[i - 1].x : pos.x;
        const prevZ = i > 0 ? remaining[i - 1].z : pos.z;
        const dx = wx - prevX;
        const dz = wz - prevZ;
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len > this.goalRadius) {
          wx -= (dx / len) * this.goalRadius;
          wz -= (dz / len) * this.goalRadius;
        }
      }
      waypoints.push({ x: wx, z: wz });
    }

    // Build positions with step-up/step-down at cell edges
    const positions: number[] = [];
    let prevH = this.getSurfaceAt(waypoints[0].x, waypoints[0].z);
    positions.push(waypoints[0].x, prevH, waypoints[0].z);

    for (let i = 1; i < waypoints.length; i++) {
      const wp = waypoints[i];
      const curH = this.getSurfaceAt(wp.x, wp.z);

      if (Math.abs(curH - prevH) > 0.01) {
        // Height change: insert step at the edge between cells
        const prev = waypoints[i - 1];
        const midX = (prev.x + wp.x) * 0.5;
        const midZ = (prev.z + wp.z) * 0.5;
        // Flat to edge at previous height
        positions.push(midX, prevH, midZ);
        // Vertical step to new height
        positions.push(midX, curH, midZ);
      }

      // Continue flat at current height
      positions.push(wp.x, curH, wp.z);
      prevH = curH;
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
    pos.x += nx * speed * dt;
    pos.z += nz * speed * dt;

    // Clamp to navGrid bounds
    const half = this.navGrid.getHalfSize();
    pos.x = Math.max(-half, Math.min(half, pos.x));
    pos.z = Math.max(-half, Math.min(half, pos.z));

    // Smooth facing
    const targetAngle = Math.atan2(nx, nz);
    this.facingAngle = lerpAngle(this.facingAngle, targetAngle, 1 - Math.exp(-TURN_SPEED * dt));
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
        this.pathIndex++;
        if (this.pathIndex >= this.path.length) {
          // Snap to exact goal
          const goal = this.path[this.path.length - 1];
          pos.x = goal.x;
          pos.z = goal.z;
          this.path.length = 0;
          this.moveSpeed = 0;
          this.clearPathLine();
        } else {
          this.updatePathLine();
        }
      } else {
        // Clamp speed on final approach to prevent overshoot (like voxel-engine)
        let moveSpd = speed;
        if (isLast) {
          const maxStep = dist / dt;
          moveSpd = Math.min(speed, Math.max(0.5, maxStep));
        }
        const step = Math.min(moveSpd * dt, dist);
        pos.x += (pdx / dist) * step;
        pos.z += (pdz / dist) * step;

        const targetAngle = Math.atan2(pdx / dist, pdz / dist);
        this.facingAngle = lerpAngle(this.facingAngle, targetAngle, 1 - Math.exp(-TURN_SPEED * dt));
        this.root.rotation.y = this.facingAngle;
        this.moveSpeed = speed;
      }
    }

    // ── Update debug path line start to track character ──
    if (this.pathLine && this.pathLineGeo) {
      const attr = this.pathLineGeo.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute;
      if (attr && attr.data) {
        const arr = attr.data.array as Float32Array;
        arr[0] = pos.x;
        arr[1] = 0.05;
        arr[2] = pos.z;
        attr.data.needsUpdate = true;
        this.pathLine.computeLineDistances();
      }
    }

    // ── Collision: ALWAYS runs (like voxel-engine) ──
    if (this.obstacles.length > 0) {
      const resolved = resolveCollision(
        pos.x, pos.z,
        this.obstacles, this.collisionRadius,
        this.groundY, this.stepHeight,
      );
      pos.x = resolved.x;
      pos.z = resolved.z;

      // Step up/down onto surfaces
      const surfaceY = getSurfaceHeight(pos.x, pos.z, this.obstacles, this.collisionRadius * 0.5);
      this.groundY = surfaceY - this.groundY <= this.stepHeight ? surfaceY : this.groundY;
    } else {
      this.groundY = 0;
    }

    // Clamp to navGrid bounds (after collision)
    const half = this.navGrid.getHalfSize();
    pos.x = Math.max(-half, Math.min(half, pos.x));
    pos.z = Math.max(-half, Math.min(half, pos.z));

    // ── Hop + step SFX ──
    this.footSfxTimer += dt;
    if (this.hopEnabled && this.moveSpeed > 0) {
      this.hopPhase += dt * this.moveSpeed * 2;
      const hop = Math.abs(Math.sin(this.hopPhase)) * HOP_HEIGHT;
      pos.y = this.groundY + hop;

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
      pos.y = this.groundY;
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
