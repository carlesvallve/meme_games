import * as THREE from 'three';
import type { DungeonPropSystem, PlacedProp } from '../dungeon';
import type { LootSystem } from './Loot';
import type { GoreSystem } from './GoreSystem';
import { sampleVertexColors, getGeometryYBounds } from './GoreSystem';
import { Entity } from '../core/Entity';
import { audioSystem } from '../../utils/AudioSystem';

/** Max vertical gap for melee prop hits */
const MELEE_Y_TOLERANCE = 1.0;
/** Loot drop chance on destruction */
const LOOT_DROP_CHANCE = 0.55;

// ── Falling item physics (matches Loot.ts constants) ──
const GRAVITY = 20;
const DRAG = 3.5;
const BOUNCE_Y = -0.35;
const BOUNCE_XZ = 0.6;
const SETTLE_THRESHOLD = 0.5;

interface FallingItem {
  prop: PlacedProp;
  vel: THREE.Vector3;
  grounded: boolean;
  bounceCount: number;
}

function isInAttackArc(
  ax: number, ay: number, az: number, facing: number,
  tx: number, ty: number, tz: number,
  reach: number, halfAngle: number,
): boolean {
  const fwdX = -Math.sin(facing);
  const fwdZ = -Math.cos(facing);
  const dx = tx - ax;
  const dy = ty - ay;
  const dz = tz - az;
  if (Math.abs(dy) > MELEE_Y_TOLERANCE) return false;
  const dist2D = Math.sqrt(dx * dx + dz * dz);
  if (dist2D > reach) return false;
  if (dist2D < 0.001) return true;
  const dot = fwdX * (dx / dist2D) + fwdZ * (dz / dist2D);
  return dot >= Math.cos(halfAngle);
}

export class PropDestructionSystem {
  private dungeonProps: DungeonPropSystem;
  private lootSystem: LootSystem;
  private goreSystem: GoreSystem;
  private fallingItems: FallingItem[] = [];
  private getFloorY: ((x: number, z: number) => number) | null = null;
  private onUnblock: ((wx: number, wz: number) => void) | null = null;
  private isOpenCell: ((wx: number, wz: number) => boolean) | null = null;

  constructor(dungeonProps: DungeonPropSystem, lootSystem: LootSystem, goreSystem: GoreSystem) {
    this.dungeonProps = dungeonProps;
    this.lootSystem = lootSystem;
    this.goreSystem = goreSystem;
  }

  /** Set floor height lookup (call after construction) */
  setFloorY(fn: (x: number, z: number) => number): void {
    this.getFloorY = fn;
  }

  /** Set callback to unblock nav cell + remove debris on prop destruction */
  setUnblockCallback(fn: (wx: number, wz: number) => void): void {
    this.onUnblock = fn;
  }

  /** Set wall check for falling tabletop items */
  setIsOpenCell(fn: (wx: number, wz: number) => boolean): void {
    this.isOpenCell = fn;
  }

  /** Get meshes of destroyable props — used to exclude them from stick raycasts */
  getDestroyableMeshes(): Set<THREE.Object3D> {
    return new Set(this.dungeonProps.getDestroyableProps().map(p => p.mesh));
  }

  /** Get destroyable prop collision data for proximity-based projectile hits. */
  getPropColliders(): { x: number; y: number; z: number; radius: number; height: number; entity: Entity }[] {
    return this.dungeonProps.getDestroyableProps().map(p => {
      const { minY, maxY } = getGeometryYBounds(p.mesh.geometry);
      return {
        x: p.mesh.position.x,
        y: p.mesh.position.y + minY,
        z: p.mesh.position.z,
        radius: p.entity.radius,
        height: maxY - minY,
        entity: p.entity,
      };
    });
  }

  /** Check melee attack against destroyable props. Call when player attacks. */
  checkMeleeHit(
    attackerX: number, attackerY: number, attackerZ: number,
    facing: number, reach: number, arcHalf: number,
  ): boolean {
    const props = this.dungeonProps.getDestroyableProps();
    for (const prop of props) {
      const px = prop.mesh.position.x;
      const py = prop.mesh.position.y;
      const pz = prop.mesh.position.z;
      if (isInAttackArc(attackerX, attackerY, attackerZ, facing, px, py, pz, reach + prop.entity.radius, arcHalf)) {
        this.destroyProp(prop);
        return true;
      }
    }
    return false;
  }

  /** Handle a projectile hitting a prop entity */
  handleProjectileHit(entity: Entity): boolean {
    const props = this.dungeonProps.getDestroyableProps();
    const prop = props.find(p => p.entity === entity);
    if (!prop) return false;
    this.destroyProp(prop);
    return true;
  }

  /** Update falling tabletop items — same physics as loot items */
  update(dt: number): void {
    for (let i = this.fallingItems.length - 1; i >= 0; i--) {
      const item = this.fallingItems[i];
      if (item.grounded) {
        // Slow spin when settled
        item.prop.mesh.rotation.y += dt * 2;
        continue;
      }

      const pos = item.prop.mesh.position;

      // Air drag
      const dragFactor = Math.exp(-DRAG * dt);
      item.vel.x *= dragFactor;
      item.vel.z *= dragFactor;

      // Gravity
      item.vel.y -= GRAVITY * dt;

      // Move
      const oldX = pos.x;
      const oldZ = pos.z;
      pos.x += item.vel.x * dt;
      pos.y += item.vel.y * dt;
      pos.z += item.vel.z * dt;

      // Wall containment — reject movement into structural wall cells
      if (this.isOpenCell) {
        const newX = pos.x;
        const newZ = pos.z;
        if (!this.isOpenCell(newX, newZ)) {
          const openX = this.isOpenCell(newX, oldZ);
          const openZ = this.isOpenCell(oldX, newZ);
          if (openX && !openZ) {
            pos.z = oldZ;
            item.vel.z *= -0.3;
          } else if (openZ && !openX) {
            pos.x = oldX;
            item.vel.x *= -0.3;
          } else {
            pos.x = oldX;
            pos.z = oldZ;
            item.vel.x *= -0.3;
            item.vel.z *= -0.3;
          }
        }
      }

      // Spin while airborne
      item.prop.mesh.rotation.y += dt * 8;
      item.prop.mesh.rotation.x += dt * 5;

      // Floor check
      const terrainY = this.getFloorY ? this.getFloorY(pos.x, pos.z) : 0;
      const floorY = terrainY + 0.02;

      if (pos.y <= floorY) {
        pos.y = floorY;
        const impactSpeed = Math.abs(item.vel.y);

        if (impactSpeed < SETTLE_THRESHOLD && item.vel.length() < 1) {
          // Settle — upright rotation
          item.grounded = true;
          item.vel.set(0, 0, 0);
          item.prop.mesh.rotation.x = 0;
          item.prop.mesh.rotation.z = 0;
          audioSystem.sfxAt('thud', pos.x, pos.z, Math.min(impactSpeed / 8, 1), item.bounceCount);
        } else {
          // Bounce
          item.vel.y *= BOUNCE_Y;
          item.vel.x *= BOUNCE_XZ;
          item.vel.z *= BOUNCE_XZ;
          audioSystem.sfxAt('thud', pos.x, pos.z, Math.min(impactSpeed / 8, 1), item.bounceCount);
          item.bounceCount++;
        }
      }
    }

    // Remove settled items after a short grace period (they just rest on the floor now)
    for (let i = this.fallingItems.length - 1; i >= 0; i--) {
      if (this.fallingItems[i].grounded) {
        this.fallingItems.splice(i, 1);
      }
    }
  }

  private destroyProp(prop: PlacedProp): void {
    const pos = prop.mesh.position.clone();
    const category = prop.entry.category;
    const geometry = prop.mesh.geometry;

    // Sample colors from the prop mesh for debris
    const { minY, maxY } = getGeometryYBounds(geometry);
    const height = maxY - minY;

    // Spawn debris chunks using prop vertex colors (no blood lerp)
    const chunkCount = 6 + Math.floor(Math.random() * 5);
    const groundY = pos.y;
    for (let i = 0; i < chunkCount; i++) {
      const fracLo = Math.random();
      const fracHi = Math.min(fracLo + 0.3, 1);
      const yLo = minY + height * fracLo;
      const yHi = minY + height * fracHi;
      const color = sampleVertexColors(geometry, yLo, yHi, undefined, 0);
      const sizeMin = category === 'pot' ? 0.01 : 0.015;
      const sizeMax = category === 'pot' ? 0.025 : 0.04;
      this.goreSystem.spawnChunk(
        pos.x, pos.y + height * 0.5, pos.z,
        groundY, color,
        sizeMin, sizeMax,
        1.0 + Math.random() * 1.5,
        2.0,
        0, 0, // no knockback direction
        true, // noWallStick — debris bounces off walls
      );
    }

    // Play SFX
    const sfxType = category === 'pot' ? 'ceramicBreak' : 'woodBreak';
    audioSystem.sfxAt(sfxType, pos.x, pos.z);

    // Chance of loot drop
    if (Math.random() < LOOT_DROP_CHANCE) {
      this.lootSystem.spawnLoot(pos);
    }

    // Unblock nav cell and remove debris box so player can walk through
    if (this.onUnblock) {
      this.onUnblock(pos.x, pos.z);
    }

    // Remove prop — also returns orphaned tabletop items
    const result = this.dungeonProps.destroyProp(prop);
    if (result && result.orphans.length > 0) {
      // Eject orphaned tabletop items like loot — pop up and scatter
      for (const orphan of result.orphans) {
        const angle = Math.random() * Math.PI * 2;
        const hSpeed = 1.2 + Math.random() * 1.0;
        this.fallingItems.push({
          prop: orphan,
          vel: new THREE.Vector3(
            Math.cos(angle) * hSpeed,
            2.5 + Math.random() * 1.5,
            Math.sin(angle) * hSpeed,
          ),
          grounded: false,
          bounceCount: 0,
        });
      }
    }
  }
}
