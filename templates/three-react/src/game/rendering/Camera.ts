import * as THREE from 'three';
import { smoothLerpVec3 } from '../../utils/cameraUtils';
import type { CameraParams } from '../../store';
import { entityRegistry, Layer } from '../core/Entity';
import { lerpAngle } from '../../utils/math';

export interface CameraOptions {
  fov?: number;
  near?: number;
  far?: number;
  distance?: number;
  angleX?: number;
  angleY?: number;
  followSpeed?: number;
  /** Called when distance changes (scroll/pinch) so store can stay in sync */
  onDistanceChange?: (distance: number) => void;
  /** Called when pointer up after a confirmed drag (so UI can ignore the following click as "tap") */
  onPointerUpAfterDrag?: () => void;
}

const DRAG_THRESHOLD = 8; // px before considering it a real drag (fixes mobile)
const DEFAULT_COLLISION_SKIN = 0.1;
/** Position eases toward orbit target; higher = snappier (less float, less tilt). Orbit center uses followSpeed. */
const POSITION_FOLLOW_SPEED_MULT = 2;

export class Camera {
  readonly camera: THREE.PerspectiveCamera;
  private target = new THREE.Vector3(0, 0, 0);
  /** Smoothed orbit center — camera orbits around this and looks at it (avoids tilt when character moves) */
  private smoothedTarget = new THREE.Vector3(0, 0, 0);
  private currentPos = new THREE.Vector3();
  private hasInitialTarget = false;
  private distance: number;
  private angleX: number;
  private angleY: number;
  private followSpeed: number;

  // Orbit state
  private isDragging = false;
  private dragConfirmed = false;
  private pointerDownPos = { x: 0, y: 0 };
  private lastPointerX = 0;
  private lastPointerY = 0;
  private activePointers = 0;
  private minDistance = 5;
  private maxDistance = 25;
  private pitchMin = -80 * (Math.PI / 180);
  private pitchMax = 0;
  private rotationSpeed = 0.005;
  private zoomSpeed = 0.01;

  // Pinch zoom state
  private lastPinchDist: number | null = null;
  private lastTwoFingerY: number | null = null;

  // Collision
  collisionLayers: number = Layer.None;
  private raycaster = new THREE.Raycaster();
  private _dir = new THREE.Vector3();
  private _hitPos = new THREE.Vector3();
  private collisionDist = 0; // 0 = no collision active
  private collisionCooldown = 0;

  /** How far to push camera off collision surfaces */
  collisionSkin = DEFAULT_COLLISION_SKIN;
  /** Optional: query terrain height at (x,z) — camera stays above ground */
  terrainHeightAt: ((x: number, z: number) => number) | null = null;
  /** Optional: heightmap mesh for cliff collision (separate from Architecture raycast) */
  terrainMesh: THREE.Object3D | null = null;

  // Snap-behind
  private snapAngleY: number | null = null;
  private readonly snapSpeed = 12; // exponential lerp speed

  // Target Y override (for death transitions — camera drifts upward)
  private targetYOverride: number | null = null;

  // Screen shake
  private shakeX = 0;
  private shakeZ = 0;
  private shakeIntensity = 0;
  private shakeDecay = 0;

  private canvas: HTMLCanvasElement;
  private onDistanceChange?: (distance: number) => void;
  private onPointerDown: (e: PointerEvent) => void;
  private onPointerMove: (e: PointerEvent) => void;
  private onPointerUp: (e: PointerEvent) => void;
  private onWheel: (e: WheelEvent) => void;
  private onTouchStart: (e: TouchEvent) => void;
  private onTouchMove: (e: TouchEvent) => void;
  private onTouchEnd: () => void;

  constructor(aspect: number, canvas: HTMLCanvasElement, opts: CameraOptions = {}) {
    const {
      fov = 60,
      near = 0.1,
      far = 200,
      distance = 12,
      angleX = -35,
      angleY = 45,
      followSpeed = 8,
      onDistanceChange,
      onPointerUpAfterDrag,
    } = opts;

    this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    this.distance = distance;
    this.angleX = angleX * (Math.PI / 180);
    this.angleY = angleY * (Math.PI / 180);
    this.followSpeed = followSpeed;
    this.canvas = canvas;
    this.onDistanceChange = onDistanceChange;

    // Prevent browser from hijacking touch for scroll/zoom
    canvas.style.touchAction = 'none';

    // Pointer down on canvas — start drag tracking
    this.onPointerDown = (e: PointerEvent) => {
      this.activePointers++;
      if (this.activePointers === 1) {
        this.isDragging = true;
        this.dragConfirmed = false;
        this.pointerDownPos = { x: e.clientX, y: e.clientY };
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
      } else {
        this.isDragging = false; // multi-touch — stop rotation
      }
    };

    // Pointer move on window — track even if finger moves off canvas
    this.onPointerMove = (e: PointerEvent) => {
      if (!this.isDragging || this.activePointers !== 1) return;

      // Check drag threshold before considering it a real drag
      if (!this.dragConfirmed) {
        const distX = e.clientX - this.pointerDownPos.x;
        const distY = e.clientY - this.pointerDownPos.y;
        const dist = Math.sqrt(distX * distX + distY * distY);
        if (dist < DRAG_THRESHOLD) return;
        this.dragConfirmed = true;
        // Update last position to prevent a "jump"
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
      }

      const dx = e.clientX - this.lastPointerX;
      const dy = e.clientY - this.lastPointerY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;

      this.snapAngleY = null; // cancel snap on manual drag
      this.angleY -= dx * this.rotationSpeed;
      this.angleX = Math.max(
        this.pitchMin,
        Math.min(this.pitchMax, this.angleX - dy * this.rotationSpeed),
      );
    };

    this.onPointerUp = () => {
      this.activePointers = Math.max(0, this.activePointers - 1);
      if (this.activePointers === 0) {
        if (this.dragConfirmed) onPointerUpAfterDrag?.();
        this.isDragging = false;
        this.dragConfirmed = false;
      }
    };

    this.onWheel = (e: WheelEvent) => {
      this.distance = Math.max(
        this.minDistance,
        Math.min(this.maxDistance, this.distance + e.deltaY * this.zoomSpeed),
      );
      this.onDistanceChange?.(this.distance);
    };

    // Touch pinch zoom (two-finger only)
    this.onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        this.isDragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this.lastPinchDist = Math.sqrt(dx * dx + dy * dy);
        this.lastTwoFingerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      }
    };

    this.onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        this.isDragging = false;

        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const pinchDist = Math.sqrt(dx * dx + dy * dy);
        const avgY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

        // Pinch zoom
        if (this.lastPinchDist !== null) {
          const delta = this.lastPinchDist - pinchDist;
          this.distance += delta * 0.1;
        }

        // Two-finger vertical drag zoom
        if (this.lastTwoFingerY !== null) {
          const dyAvg = avgY - this.lastTwoFingerY;
          this.distance += dyAvg * 0.06;
        }

        this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));
        this.onDistanceChange?.(this.distance);
        this.lastPinchDist = pinchDist;
        this.lastTwoFingerY = avgY;
      }
    };

    this.onTouchEnd = () => {
      this.lastPinchDist = null;
      this.lastTwoFingerY = null;
    };

    // Down on canvas, move/up on window (so we track even outside canvas)
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
    canvas.addEventListener('touchstart', this.onTouchStart, { passive: true });
    canvas.addEventListener('touchmove', this.onTouchMove, { passive: true });
    canvas.addEventListener('touchend', this.onTouchEnd);

    this.updatePosition(1000); // snap to initial position
  }

  getAngleX(): number { return this.angleX; }
  getAngleY(): number { return this.angleY; }
  getDistance(): number { return this.distance; }

  setOrbit(angleX: number, angleY: number, distance: number): void {
    this.angleX = angleX;
    this.angleY = angleY;
    this.distance = distance;
  }

  /** Smoothly rotate the camera orbit to the given yaw angle. */
  snapBehind(targetAngleY: number): void {
    this.snapAngleY = targetAngleY;
  }

  /** Override camera target Y (e.g. soul ascend drift). Pass null to clear. */
  setTargetYOverride(y: number | null): void {
    this.targetYOverride = y;
  }

  /** Returns true if the most recent pointer interaction was a confirmed drag (not a click). */
  wasDrag(): boolean {
    return this.dragConfirmed;
  }

  setTarget(x: number, y: number, z: number): void {
    this.target.set(x, y, z);
    if (!this.hasInitialTarget) {
      this.smoothedTarget.copy(this.target);
      this.hasInitialTarget = true;
    }
  }

  /** Instantly snap camera to current target — no lerp/smoothing/collision. */
  snapToTarget(): void {
    this.smoothedTarget.copy(this.target);
    this.hasInitialTarget = true;
    this.snapAngleY = null;
    this.collisionDist = 0;
    this.collisionCooldown = 0;

    // Compute orbit position directly — bypass collision raycasts
    const cosAx = Math.cos(this.angleX);
    const sinAx = Math.sin(-this.angleX);
    const sinAy = Math.sin(this.angleY);
    const cosAy = Math.cos(this.angleY);
    this.currentPos.set(
      this.smoothedTarget.x + this.distance * cosAx * sinAy,
      this.smoothedTarget.y + this.distance * sinAx,
      this.smoothedTarget.z + this.distance * cosAx * cosAy,
    );
    this.camera.position.copy(this.currentPos);
    this.camera.lookAt(this.smoothedTarget);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  updatePosition(dt: number): void {
    if (!this.hasInitialTarget) return;

    // Snap-behind lerp
    if (this.snapAngleY !== null) {
      const t = 1 - Math.exp(-this.snapSpeed * dt);
      this.angleY = lerpAngle(this.angleY, this.snapAngleY, t);
      // Finish when close enough
      let diff = this.snapAngleY - this.angleY;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < 0.01) {
        this.angleY = this.snapAngleY;
        this.snapAngleY = null;
      }
    }

    // Apply target Y override (death transition camera drift)
    if (this.targetYOverride !== null) {
      this.target.y = this.targetYOverride;
    }

    // Smooth the orbit center (follow target), not the camera — so we can lookAt it without tilt
    smoothLerpVec3(this.smoothedTarget, this.target, this.followSpeed, dt);

    const cosAx = Math.cos(this.angleX);
    const sinAx = Math.sin(-this.angleX);
    const sinAy = Math.sin(this.angleY);
    const cosAy = Math.cos(this.angleY);

    const desiredX = this.smoothedTarget.x + this.distance * cosAx * sinAy;
    const desiredY = this.smoothedTarget.y + this.distance * sinAx;
    const desiredZ = this.smoothedTarget.z + this.distance * cosAx * cosAy;
    const desired = new THREE.Vector3(desiredX, desiredY, desiredZ);

    // --- Collision: raycast from orbit center toward camera ---
    let finalDesired = desired;
    let occluded = false;

    if (this.collisionLayers !== 0) {
      this._dir.copy(desired).sub(this.smoothedTarget).normalize();
      this.raycaster.set(this.smoothedTarget, this._dir);
      this.raycaster.near = 0.1;
      this.raycaster.far = this.distance;

      const occluders = entityRegistry.getByLayer(this.collisionLayers).map(e => e.object3D);
      const hits = this.raycaster.intersectObjects(occluders, true);

      for (const hit of hits) {
        if (!hit.face) continue;
        const worldNormal = hit.face.normal.clone()
          .transformDirection(hit.object.matrixWorld);
        this._hitPos.copy(hit.point).addScaledVector(worldNormal, this.collisionSkin);
        finalDesired = this._hitPos.clone();
        occluded = true;
        break;
      }
    }

    // Terrain cliff collision: separate raycast with larger near to skip ground at feet
    if (!occluded && this.terrainMesh) {
      this._dir.copy(desired).sub(this.smoothedTarget).normalize();
      this.raycaster.set(this.smoothedTarget, this._dir);
      this.raycaster.near = 0.5;
      this.raycaster.far = this.distance;

      const hits = this.raycaster.intersectObject(this.terrainMesh, true);
      for (const hit of hits) {
        if (!hit.face) continue;
        const wn = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        if (wn.y > 0.5) continue; // skip ground/gentle slopes
        this._hitPos.copy(hit.point).addScaledVector(wn, this.collisionSkin);
        finalDesired = this._hitPos.clone();
        occluded = true;
        break;
      }
    }


    // Terrain height: pull camera forward until above ground (Unity-style)
    if (!occluded && this.terrainHeightAt) {
      const dir = new THREE.Vector3().subVectors(desired, this.smoothedTarget);
      const fullDist = dir.length();
      dir.normalize();

      const groundY = this.terrainHeightAt(desired.x, desired.z) + this.collisionSkin;
      if (desired.y < groundY) {
        // Step backward from full distance toward player until above ground
        let safeDist = fullDist;
        const steps = 10;
        for (let i = steps; i >= 0; i--) {
          const t = i / steps;
          const d = fullDist * t;
          const p = this.smoothedTarget.clone().addScaledVector(dir, d);
          const gy = this.terrainHeightAt(p.x, p.z) + this.collisionSkin;
          if (p.y >= gy) {
            safeDist = d;
            break;
          }
          safeDist = d;
        }
        finalDesired = this.smoothedTarget.clone().addScaledVector(dir, safeDist);
        occluded = true;
      }
    }

    // Visibility check: is terrain between camera and player?
    if (!occluded && this.terrainMesh) {
      const camToTarget = new THREE.Vector3().subVectors(this.smoothedTarget, this.currentPos);
      const viewDist = camToTarget.length();
      if (viewDist > 0.5) {
        camToTarget.normalize();
        this.raycaster.set(this.currentPos, camToTarget);
        this.raycaster.near = 0.3;
        this.raycaster.far = viewDist;
        const hits = this.raycaster.intersectObject(this.terrainMesh, true);
        if (hits.length > 0) {
          // Terrain blocks the view — pull camera to just before the hit
          const hitDist = hits[0].distance;
          const orbitDir = new THREE.Vector3().subVectors(desired, this.smoothedTarget).normalize();
          const safeDist = Math.max(1.5, viewDist - hitDist);
          finalDesired = this.smoothedTarget.clone().addScaledVector(orbitDir, safeDist);
          occluded = true;
        }
      }
    }

    // --- Orbit follow: always at full speed (rotation/zoom unaffected) ---
    smoothLerpVec3(this.currentPos, desired, this.followSpeed * POSITION_FOLLOW_SPEED_MULT, dt);

    // --- Collision distance: independent from orbit speed ---
    const hitDist = occluded ? finalDesired.distanceTo(this.smoothedTarget) : this.distance;

    const MIN_COLLISION_DIST = 1.5;

    if (occluded) {
      const clampedHit = Math.max(MIN_COLLISION_DIST, hitDist);
      if (this.collisionDist <= 0) {
        this.collisionDist = clampedHit;
      } else {
        this.collisionDist += (clampedHit - this.collisionDist) * Math.min(1, 15 * dt);
      }
      this.collisionCooldown = 0.2;
    } else if (this.collisionCooldown > 0) {
      this.collisionCooldown -= dt;
    } else if (this.collisionDist > 0) {
      this.collisionDist += (this.distance - this.collisionDist) * 2.0 * dt;
      if (this.distance - this.collisionDist < 0.05) this.collisionDist = 0;
    }

    // Clamp camera to collision distance (post-process, doesn't affect orbit)
    if (this.collisionDist > 0) {
      const fromTarget = new THREE.Vector3().subVectors(this.currentPos, this.smoothedTarget);
      const currentDist = fromTarget.length();
      if (currentDist > this.collisionDist) {
        fromTarget.multiplyScalar(this.collisionDist / currentDist);
        this.currentPos.copy(this.smoothedTarget).add(fromTarget);
      }
    }

    this.camera.position.copy(this.currentPos);

    // Minimum height above terrain so floor doesn't clip through near plane
    if (this.terrainHeightAt) {
      const groundAtCam = this.terrainHeightAt(this.camera.position.x, this.camera.position.z);
      const minY = groundAtCam + this.collisionSkin * 0.1;
      if (this.camera.position.y < minY) this.camera.position.y = minY;
    }

    if (this.shakeIntensity > 0.001) {
      this.shakeX += (Math.random() - 0.5) * this.shakeIntensity * 2;
      this.shakeZ += (Math.random() - 0.5) * this.shakeIntensity * 2;
      this.shakeX *= 0.5;
      this.shakeZ *= 0.5;
      this.camera.position.x += this.shakeX;
      this.camera.position.z += this.shakeZ;
      this.shakeIntensity = Math.max(0, this.shakeIntensity - this.shakeDecay * dt);
    }

    this.camera.lookAt(this.smoothedTarget);
  }

  /** Trigger a screen shake. dirX/dirZ is the hit direction (normalized). */
  shake(intensity = 0.15, duration = 0.15, dirX = 0, dirZ = 0): void {
    this.shakeIntensity = intensity;
    this.shakeDecay = intensity / Math.max(0.01, duration);
    // Bias shake toward the hit direction
    if (Math.abs(dirX) > 0.01 || Math.abs(dirZ) > 0.01) {
      this.shakeX = dirX * intensity * 0.5;
      this.shakeZ = dirZ * intensity * 0.5;
    }
  }

  setParams(p: CameraParams): void {
    if (p.fov != null) {
      this.camera.fov = p.fov;
      this.camera.updateProjectionMatrix();
    }
    this.minDistance = p.minDistance;
    this.maxDistance = p.maxDistance;
    this.pitchMin = p.pitchMin * (Math.PI / 180);
    this.pitchMax = p.pitchMax * (Math.PI / 180);
    this.rotationSpeed = p.rotationSpeed;
    this.zoomSpeed = p.zoomSpeed;
    this.collisionLayers = p.collisionLayers;
    this.collisionSkin = p.collisionSkin;
    // Sync distance from store (e.g. from settings slider); clamp to min/max
    const nextDistance = Math.max(this.minDistance, Math.min(this.maxDistance, p.distance));
    this.distance = nextDistance;
    this.angleX = Math.max(this.pitchMin, Math.min(this.pitchMax, this.angleX));
  }

  destroy(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('touchstart', this.onTouchStart);
    this.canvas.removeEventListener('touchmove', this.onTouchMove);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
  }
}
