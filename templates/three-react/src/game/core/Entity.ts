import * as THREE from 'three';

// ── Layer bitflags ──────────────────────────────────────────────
export const Layer = {
  None:         0,
  Architecture: 1 << 0,  // walls, debris boxes
  Collectible:  1 << 1,  // gems, pickups
  Character:    1 << 2,  // player, NPCs, enemies
  Prop:         1 << 3,  // decorative, non-blocking
  Light:        1 << 4,  // point lights, etc.
  Particle:     1 << 5,  // effect groups
} as const;

// ── EntityRegistry (singleton) ──────────────────────────────────
export class EntityRegistry {
  readonly entities = new Set<Entity>();

  add(e: Entity): void {
    this.entities.add(e);
  }

  remove(e: Entity): void {
    this.entities.delete(e);
  }

  /** Remove all entities (call on full scene teardown / hot reload). */
  clear(): void {
    for (const e of this.entities) {
      e.object3D.userData.entity = undefined;
    }
    this.entities.clear();
  }

  /** Re-register an existing entity (restores registry entry + userData link after clear). */
  reregister(e: Entity): void {
    this.entities.add(e);
    e.object3D.userData.entity = e;
  }

  getByLayer(mask: number): Entity[] {
    const result: Entity[] = [];
    for (const e of this.entities) {
      if (e.layer & mask) result.push(e);
    }
    return result;
  }

  queryRadius(pos: THREE.Vector3, radius: number, mask?: number): Entity[] {
    const r2 = radius * radius;
    const result: Entity[] = [];
    for (const e of this.entities) {
      if (mask !== undefined && !(e.layer & mask)) continue;
      if (e.position.distanceToSquared(pos) <= r2) result.push(e);
    }
    return result;
  }
}

export const entityRegistry = new EntityRegistry();

// ── Entity ──────────────────────────────────────────────────────
export class Entity {
  readonly object3D: THREE.Object3D;
  layer: number;
  radius: number;
  weight: number;

  constructor(object3D: THREE.Object3D, opts: {
    layer: number;
    radius: number;
    weight?: number;
  }) {
    this.object3D = object3D;
    this.layer = opts.layer;
    this.radius = opts.radius;
    this.weight = opts.weight ?? 1;
    object3D.userData.entity = this;
    entityRegistry.add(this);
  }

  get position(): THREE.Vector3 {
    return this.object3D.position;
  }

  destroy(): void {
    entityRegistry.remove(this);
    this.object3D.userData.entity = undefined;
  }
}
