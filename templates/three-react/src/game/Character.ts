import * as THREE from 'three';
import { useGameStore } from '../store';
import { createCharacterMesh } from './characters';
import type { CharacterType } from './characters';
import { Entity, Layer } from './Entity';
import type { Terrain } from './Terrain';
import { audioSystem } from '../utils/AudioSystem';

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

export class Character {
  readonly mesh: THREE.Mesh;
  entity: Entity;
  facing = 0;
  groundY = 0;
  /** Smoothed visual Y — lags behind groundY for smooth transitions */
  protected visualGroundY = 0;
  /** Vertical velocity for gravity-based falling */
  private velocityY = 0;
  moveTime = 0;
  lastHopHalf = 0;
  hopFrequency = 4;
  /** Time since last foot sound (step or land) */
  protected footSfxTimer = 0;

  torchLight: THREE.PointLight;
  torchLightEntity: Entity;
  fillLight: THREE.PointLight;
  torchTime = 0;

  protected scene: THREE.Scene;
  protected terrain: Terrain;

  constructor(scene: THREE.Scene, terrain: Terrain, type: CharacterType, position: THREE.Vector3) {
    this.scene = scene;
    this.terrain = terrain;

    // Mesh
    this.mesh = createCharacterMesh(type);
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
  }

  /**
   * Move character by direction vector. Does NOT read input — receives normalized dx/dz.
   * Returns true if character moved.
   */
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

    // Smooth vertical transitions
    this.updateVisualY(dt);

    // Face movement direction (add PI because voxel model front is -Z)
    const targetAngle = Math.atan2(dx, dz) + Math.PI;
    this.facing = lerpAngle(this.facing, targetAngle, 1 - Math.exp(-12 * dt));
    this.mesh.rotation.y = this.facing;

    // Hop animation
    this.moveTime += dt * this.hopFrequency;

    return true;
  }

  /** Smooth vertical transitions:
   *  - Stepping up: exponential lerp (smooth climb)
   *  - Falling down: gravity-based (natural drop) */
  private updateVisualY(dt: number): void {
    if (this.groundY > this.visualGroundY) {
      // Stepping up — smooth lerp
      this.visualGroundY = THREE.MathUtils.lerp(
        this.visualGroundY,
        this.groundY,
        1 - Math.exp(-STEP_UP_RATE * dt),
      );
      this.velocityY = 0;
    } else if (this.groundY < this.visualGroundY) {
      // Falling — gravity
      this.velocityY = Math.min(this.velocityY + GRAVITY * dt, MAX_FALL_SPEED);
      this.visualGroundY -= this.velocityY * dt;
      // Clamp to ground — land with thud
      if (this.visualGroundY <= this.groundY) {
        const impactSpeed = this.velocityY;
        this.visualGroundY = this.groundY;
        this.velocityY = 0;
        // Thud intensity based on how fast we were falling (normalized to max)
        if (impactSpeed > 1 && this.footSfxTimer >= FOOT_SFX_COOLDOWN) {
          audioSystem.sfxAt('land', this.mesh.position.x, this.mesh.position.z);
          this.footSfxTimer = 0;
        }
      }
    } else {
      this.velocityY = 0;
    }
  }

  /** Apply hop to mesh Y position. Returns the current hop half for SFX detection. */
  applyHop(hopHeight: number): number {
    const hopSin = Math.sin(this.moveTime * Math.PI);
    const hop = Math.abs(hopSin) * hopHeight;
    this.mesh.position.y = this.visualGroundY + hop;
    return Math.floor(this.moveTime) % 2;
  }

  /** Lerp mesh Y to groundY when not moving */
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
  }

  /** Update torch and fill lights */
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

    // Flicker
    this.torchTime += dt * 12;
    const flickerAmount = torch.flicker;
    const flicker = 1 + (
      Math.sin(this.torchTime) * 0.5 +
      Math.sin(this.torchTime * 2.3) * 0.3 +
      Math.sin(this.torchTime * 5.7) * 0.2
    ) * flickerAmount;
    this.torchLight.intensity = torch.intensity * flicker;

    // Main torch — centered above character
    this.torchLight.position.set(
      this.mesh.position.x,
      this.mesh.position.y + torch.offsetUp,
      this.mesh.position.z,
    );

    // Fill light — offset to front-right to illuminate the character mesh
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

  getPosition(): THREE.Vector3 {
    return this.mesh.position;
  }

  dispose(): void {
    this.entity.destroy();
    this.torchLightEntity.destroy();
    this.scene.remove(this.mesh);
    (this.mesh.material as THREE.Material).dispose();
    this.scene.remove(this.torchLight);
    this.scene.remove(this.fillLight);
  }
}
