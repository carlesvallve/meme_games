import * as THREE from 'three';
import { smoothLerpVec3 } from '../utils/cameraUtils';
import type { CameraParams } from '../store';
import { entityRegistry, Layer } from './Entity';

export interface CameraOptions {
  fov?: number;
  near?: number;
  far?: number;
  distance?: number;
  angleX?: number;
  angleY?: number;
  followSpeed?: number;
}

const DRAG_THRESHOLD = 8; // px before considering it a real drag (fixes mobile)
const COLLISION_SKIN = 0.4; // how far to push camera off the hit surface
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
  private pitchMax = -10 * (Math.PI / 180);
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
  private wasOccluded = false;

  // Screen shake
  private shakeX = 0;
  private shakeZ = 0;
  private shakeIntensity = 0;
  private shakeDecay = 0;

  private canvas: HTMLCanvasElement;
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
    } = opts;

    this.camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    this.distance = distance;
    this.angleX = angleX * (Math.PI / 180);
    this.angleY = angleY * (Math.PI / 180);
    this.followSpeed = followSpeed;
    this.canvas = canvas;

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

      this.angleY -= dx * this.rotationSpeed;
      this.angleX = Math.max(
        this.pitchMin,
        Math.min(this.pitchMax, this.angleX - dy * this.rotationSpeed),
      );
    };

    this.onPointerUp = () => {
      this.activePointers = Math.max(0, this.activePointers - 1);
      if (this.activePointers === 0) {
        this.isDragging = false;
        this.dragConfirmed = false;
      }
    };

    this.onWheel = (e: WheelEvent) => {
      this.distance = Math.max(
        this.minDistance,
        Math.min(this.maxDistance, this.distance + e.deltaY * this.zoomSpeed),
      );
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

  getAngleY(): number {
    return this.angleY;
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

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  updatePosition(dt: number): void {
    if (!this.hasInitialTarget) return;

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
        this._hitPos.copy(hit.point).addScaledVector(worldNormal, COLLISION_SKIN);
        finalDesired = this._hitPos.clone();
        occluded = true;
        break;
      }
    }

    if (occluded) {
      this.currentPos.copy(finalDesired);
      this.wasOccluded = true;
    } else if (this.wasOccluded) {
      this.wasOccluded = false;
      smoothLerpVec3(this.currentPos, finalDesired, this.followSpeed, dt);
    } else {
      // Light position smoothing — eases toward orbit position for a bit of follow feel without noticeable tilt
      smoothLerpVec3(this.currentPos, finalDesired, this.followSpeed * POSITION_FOLLOW_SPEED_MULT, dt);
    }

    this.camera.position.copy(this.currentPos);

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
    this.minDistance = p.minDistance;
    this.maxDistance = p.maxDistance;
    this.pitchMin = p.pitchMin * (Math.PI / 180);
    this.pitchMax = p.pitchMax * (Math.PI / 180);
    this.rotationSpeed = p.rotationSpeed;
    this.zoomSpeed = p.zoomSpeed;
    this.collisionLayers = p.collisionLayers;
    // Clamp current values to new ranges
    this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));
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
