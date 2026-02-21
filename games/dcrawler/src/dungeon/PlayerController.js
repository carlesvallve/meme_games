import * as THREE from 'three';
import { eventBus } from '../core/EventBus.js';
import { inputManager } from '../core/InputManager.js';
import { DUNGEON, CAMERA, MOVEMENT, DIRECTIONS } from '../core/Constants.js';

export class PlayerController {
  constructor(camera, dungeonMap) {
    this.camera = camera;
    this.map = dungeonMap;

    // Grid position
    this.gridX = 0;
    this.gridZ = 0;
    this.facingIndex = 0; // 0=N, 1=E, 2=S, 3=W

    // Smooth movement
    this.isMoving = false;
    this.moveStart = new THREE.Vector3();
    this.moveEnd = new THREE.Vector3();
    this.moveProgress = 0;

    // Smooth rotation
    this.isRotating = false;
    this.rotStart = 0;
    this.rotEnd = 0;
    this.rotProgress = 0;

    // Head bob
    this.stepTime = 0;

    // Track whether this step is chained (key held from previous step)
    this._chained = false;

    this._bindEvents();
  }

  _bindEvents() {
    this._listeners = [
      ['input:forward', () => this.move(0)],
      ['input:backward', () => this.move(2)],
      ['input:strafeLeft', () => this.move(3)],
      ['input:strafeRight', () => this.move(1)],
      ['input:turnLeft', () => this.turn(-1)],
      ['input:turnRight', () => this.turn(1)],
    ];
    this._listeners.forEach(([event, fn]) => eventBus.on(event, fn));
  }

  destroy() {
    this._listeners.forEach(([event, fn]) => eventBus.off(event, fn));
  }

  setPosition(gx, gz) {
    this.gridX = gx;
    this.gridZ = gz;
    const world = this._gridToWorld(gx, gz);
    this.camera.position.set(world.x, world.y, world.z);
    this._updateCameraRotation();
    this.map.explore(gx, gz);
  }

  get facing() {
    return DIRECTIONS[this.facingIndex];
  }

  move(relativeDir) {
    if (this.isMoving || this.isRotating) return;

    // relativeDir: 0=forward, 1=right, 2=back, 3=left (relative to facing)
    const absDir = (this.facingIndex + relativeDir) % 4;
    const dir = DIRECTIONS[absDir];
    const nx = this.gridX + dir.x;
    const nz = this.gridZ + dir.z;

    if (!this.map.isWalkable(nx, nz)) return;

    this.isMoving = true;
    this.moveStart.copy(this.camera.position);
    const target = this._gridToWorld(nx, nz);
    this.moveEnd.set(target.x, target.y, target.z);
    this.moveProgress = 0;

    this.gridX = nx;
    this.gridZ = nz;
    this.map.explore(nx, nz);
    eventBus.emit('player:step', { x: nx, z: nz, moveDir: absDir });
  }

  snapFacing(dirIndex) {
    this.facingIndex = dirIndex;
    this._updateCameraRotation();
  }

  turn(direction) {
    if (this.isMoving || this.isRotating) return;

    this.isRotating = true;
    this.rotStart = this._facingToAngle(this.facingIndex);
    this.facingIndex = (this.facingIndex + direction + 4) % 4;
    this.rotEnd = this._facingToAngle(this.facingIndex);

    // Handle wrap-around for smooth rotation
    let diff = this.rotEnd - this.rotStart;
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    this.rotEnd = this.rotStart + diff;

    this.rotProgress = 0;
  }

  update(dt) {
    if (this.isMoving) {
      this.moveProgress += dt / MOVEMENT.TWEEN_DURATION;
      if (this.moveProgress >= 1) {
        this.moveProgress = 1;
        this.isMoving = false;
        this._pollHeldKeys();
      }
      const t = this._chained
        ? this._easeOut(this.moveProgress)
        : this._easeInOut(this.moveProgress);
      this.camera.position.lerpVectors(this.moveStart, this.moveEnd, t);

      // Head bob
      this.stepTime += dt * 0.01;
      this.camera.position.y += Math.sin(this.stepTime * Math.PI) * 0.05;
    }

    if (this.isRotating) {
      this.rotProgress += dt / MOVEMENT.TURN_DURATION;
      if (this.rotProgress >= 1) {
        this.rotProgress = 1;
        this.isRotating = false;
        this._pollHeldKeys();
      }
      const rt = this._chained
        ? this._easeOut(this.rotProgress)
        : this._easeInOut(this.rotProgress);
      const angle = this.rotStart + (this.rotEnd - this.rotStart) * rt;
      this.camera.rotation.y = angle;
    }
  }

  /** When a move/turn finishes, check if keys are still held to chain the next step */
  _pollHeldKeys() {
    if (!inputManager.enabled) return;

    const moveDir = inputManager.getHeldMoveDir();
    if (moveDir >= 0) {
      this._chained = true;
      this.move(moveDir);
      return;
    }

    const turnDir = inputManager.getHeldTurnDir();
    if (turnDir !== 0) {
      this._chained = true;
      this.turn(turnDir);
      return;
    }

    this._chained = false;
  }

  _gridToWorld(gx, gz) {
    return {
      x: gx * DUNGEON.CELL_SIZE,
      y: CAMERA.EXPLORE_HEIGHT,
      z: gz * DUNGEON.CELL_SIZE,
    };
  }

  _facingToAngle(facingIndex) {
    // N=0 → 0 (default -Z), E=1 → -PI/2, S=2 → PI, W=3 → PI/2
    return [0, -Math.PI / 2, Math.PI, Math.PI / 2][facingIndex];
  }

  _updateCameraRotation() {
    this.camera.rotation.y = this._facingToAngle(this.facingIndex);
  }

  _easeIn(t) {
    return t * t;
  }

  _easeOut(t) {
    return 1 - (1 - t) * (1 - t);
  }

  _easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
}
