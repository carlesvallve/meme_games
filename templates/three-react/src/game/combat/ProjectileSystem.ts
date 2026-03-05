import * as THREE from 'three';
import type { ProjectileConfig } from '../character';
import type { Enemy } from '../character';
import { Entity, entityRegistry, Layer } from '../core/Entity';
import { audioSystem } from '../../utils/AudioSystem';

// ── Constants ────────────────────────────────────────────────────────

const MAX_ACTIVE = 12;
const HIT_RADIUS = 0.5;
const FLY_Y_OFFSET = 0.2; // height above ground (fallback when muzzleUp not provided)
const TERRAIN_HIT_SLOPE = 0.8; // slope threshold: above this, projectile impacts terrain
const MAX_RANGE = 12;

// ── Arrow stick & gravity ─────────────────────────────────────────────
// const ARROW_GRAVITY = 14;               // m/s² downward after gravity kicks in
// const ARROW_GRAVITY_START_DIST = 6;     // start applying gravity after this travel distance
const STUCK_ARROW_LIFETIME = 5;         // seconds before stuck arrow is removed
const FLOOR_STICK_Y_OFFSET = 0.02;      // arrow tip slightly above ground when stuck to floor
/** Local +X distance to arrow tip (shaft 0.3 + cone, tip at ~0.23); used to place tip at hit point */
const ARROW_TIP_OFFSET = 0.25;
/** When stuck to character: push tip this far along arrow direction so it penetrates the mesh */
const ARROW_PENETRATION_OFFSET = 0.15;

// ── Homing constants ─────────────────────────────────────────────────
const HOMING_SEEK_RADIUS = 6;     // max distance to start tracking a target
const HOMING_TURN_RATE = 3.5;     // radians/sec — how fast the projectile steers
const HOMING_MIN_AGE = 0.05;      // don't home during initial launch burst
const HOMING_MAX_ANGLE = Math.PI / 3; // ~60° — only home on enemies roughly ahead

// ── Auto-target constants ────────────────────────────────────────────
const AUTO_TARGET_RANGE = 10;          // max distance to auto-target an enemy
const AUTO_TARGET_MIN_DOT = 0.5;       // cos(60°) — forward cone for target selection
const AUTO_TARGET_SPREAD = 0.1;        // ±~3° random deviation

/** When sticking on architecture/props, ignore hits closer than this (meters) so we don't stick on geometry right at the muzzle. Kept small now that terrain no longer overrides — 0.5 was rejecting valid cube hits. */
const MIN_STICK_DISTANCE = 0.1;
/** Minimum distance from spawn before a projectile can stick to architecture (prevents wall-clip on spawn) */
const MIN_TRAVEL_FROM_SPAWN = 0.25;

/** Max distance from stick point to hit object's AABB — if further, the hit point is bogus (wrong space / wrong object), skip this hit. */
const MAX_STICK_TO_OBJECT_DISTANCE = 2;

/** If point is inside the box, push it to the nearest face so the arrow sticks on the surface instead of floating inside. */
function clampPointToBoxSurface(point: THREE.Vector3, box: THREE.Box3, out: THREE.Vector3): void {
  out.copy(point);
  const eps = 0.001;
  const inside =
    point.x > box.min.x + eps && point.x < box.max.x - eps &&
    point.y > box.min.y + eps && point.y < box.max.y - eps &&
    point.z > box.min.z + eps && point.z < box.max.z - eps;
  if (!inside) return;
  const dxMin = point.x - box.min.x;
  const dxMax = box.max.x - point.x;
  const dyMin = point.y - box.min.y;
  const dyMax = box.max.y - point.y;
  const dzMin = point.z - box.min.z;
  const dzMax = box.max.z - point.z;
  const dMin = Math.min(dxMin, dxMax, dyMin, dyMax, dzMin, dzMax);
  if (dMin === dxMin) out.x = box.min.x;
  else if (dMin === dxMax) out.x = box.max.x;
  else if (dMin === dyMin) out.y = box.min.y;
  else if (dMin === dyMax) out.y = box.max.y;
  else if (dMin === dzMin) out.z = box.min.z;
  else out.z = box.max.z;
}

const TRAIL_MAX_POINTS = 18;
const TRAIL_MAX_POINTS_ARROW = 10;
const TRAIL_HEAD_WIDTH_ARROW = 0.06;
const TRAIL_HEAD_WIDTH_FIREBALL = 0.18;
const TRAIL_TAIL_WIDTH = 0.008;

/** Toggle to enable console logs AND visual debug markers (red sphere at stick point, green wireframe AABB of hit object) for projectile stick events. */
let DEBUG_PROJECTILE_STICK = false;

/** Enable/disable projectile stick debug (logs + visual markers). */
export function setDebugProjectileStick(on: boolean): void { DEBUG_PROJECTILE_STICK = on; }
/** Current state of projectile stick debug. */
export function getDebugProjectileStick(): boolean { return DEBUG_PROJECTILE_STICK; }

function isDescendantOf(node: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = node.parent;
  while (p) {
    if (p === ancestor) return true;
    p = p.parent;
  }
  return false;
}

function isExcludedFromRaycast(obj: THREE.Object3D, excludeList: THREE.Object3D[]): boolean {
  return excludeList.some(ex => ex === obj || isDescendantOf(obj, ex));
}

/** Voxel dungeon invisible collision boxes (userData.collisionOnly); projectiles should only hit visible geometry. */
function isCollisionOnly(obj: THREE.Object3D): boolean {
  return (obj as THREE.Object3D & { userData?: { collisionOnly?: boolean } }).userData?.collisionOnly === true;
}

/** Wall visual groups marked noProjectileStick — arrows pass through, only collision boxes handle blocking. */
function isNoProjectileStick(obj: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = obj;
  while (p) {
    if (p.userData.noProjectileStick) return true;
    p = p.parent;
  }
  return false;
}

/** Only raycast for stick against objects that are visible and have renderable geometry. Excludes invisible collision boxes (heightmap has none; non-heightmap had invisible hits). */
function isVisibleForStick(obj: THREE.Object3D): boolean {
  if (!obj.visible) return false;
  if (obj instanceof THREE.Mesh) return !!obj.geometry;
  let found = false;
  obj.traverse((c) => {
    if (found) return;
    if (c instanceof THREE.Mesh && c.visible && c.geometry) found = true;
  });
  return found;
}

// ── Energy impact (mini explosion when non-arrow projectiles hit) ─────
const IMPACT_DURATION = 0.18;
const IMPACT_MAX_SCALE = 0.75;
const IMPACT_LIGHT_RADIUS = 2;
const IMPACT_LIGHT_INTENSITY = 1.4;

interface EnergyImpact {
  mesh: THREE.Mesh;
  light: THREE.PointLight | null;
  age: number;
  duration: number;
  parent: THREE.Object3D | null; // when set, explosion is parented to character
}

// ── Projectile data ──────────────────────────────────────────────────

interface Projectile {
  mesh: THREE.Object3D;
  vx: number;
  vz: number;
  vy: number;
  speed: number;
  damage: number;
  age: number;
  lifetime: number;
  startX: number;
  startY: number;
  startZ: number;
  ownerKey: string;
  light: THREE.PointLight | null;
  isArrow: boolean;
  /** Arrow only: gravity applied after traveling this far */
  gravityActive: boolean;
  /** Arrow only: stuck to something, remove after stuckAt + STUCK_ARROW_LIFETIME */
  stuck: boolean;
  stuckAt: number;
  /** When stuck to a character mesh: follow that vertex each frame (like gore stains). */
  stuckToMesh?: THREE.Mesh;
  stuckVertexIndex?: number;
  stuckNormalOffset?: number;
  /** When true, only move arrow to voxel each frame; do not change orientation (arrow is parented so it rotates with mesh). */
  stuckPositionOnly?: boolean;
  trailMesh: THREE.Mesh | null;
  trailPositions: THREE.Vector3[];
  /** Height above ground for terrain-follow (derived from muzzle.up) */
  flyYOffset: number;
  /** Knockback impulse speed to apply on hit (attacker's rangedKnockback). */
  knockback: number;
}

// ── Mesh factories ───────────────────────────────────────────────────

function createArrowMesh(color: number): THREE.Group {
  const group = new THREE.Group();

  // Shaft
  const shaftGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.3, 4);
  shaftGeo.rotateZ(Math.PI / 2); // lay along X axis
  const shaftMat = new THREE.MeshStandardMaterial({ color: 0x886644 });
  group.add(new THREE.Mesh(shaftGeo, shaftMat));

  // Tip
  const tipGeo = new THREE.ConeGeometry(0.03, 0.08, 4);
  tipGeo.rotateZ(-Math.PI / 2); // point along +X
  tipGeo.translate(0.19, 0, 0);
  const tipMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 });
  group.add(new THREE.Mesh(tipGeo, tipMat));

  // Tail / fletching (white, at back of shaft)
  const tailGeo = new THREE.ConeGeometry(0.025, 0.06, 4);
  tailGeo.rotateZ(-Math.PI / 2); // apex was +Y, now points along -X
  tailGeo.translate(-0.15, 0, 0); // base at shaft end -0.15, apex at -0.21
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  group.add(new THREE.Mesh(tailGeo, tailMat));

  // Small light at the arrow tip so the arrow is visible in dark dungeons
  const light = new THREE.PointLight(0xffffee, 0.5, 2.5);
  light.position.set(ARROW_TIP_OFFSET, 0, 0);
  group.add(light);

  return group;
}

/** Remove the arrow tip mesh when sticking (shaft + fletching only). Group order: 0=shaft, 1=tip, 2=tail, 3=light. */
function removeArrowTip(arrowMesh: THREE.Object3D): void {
  if (!(arrowMesh instanceof THREE.Group) || arrowMesh.children.length < 2) return;
  const tipMesh = arrowMesh.children[1];
  if (tipMesh instanceof THREE.Mesh) {
    arrowMesh.remove(tipMesh);
    tipMesh.geometry?.dispose();
    (tipMesh.material as THREE.Material)?.dispose();
  }
}

const _trailUp = new THREE.Vector3(0, 1, 0);
const _trailDir = new THREE.Vector3();
const _trailPerp = new THREE.Vector3();

function createTrailRibbon(isArrow: boolean, color: number): THREE.Mesh {
  const material = isArrow
    ? new THREE.MeshBasicMaterial({
        color: 0xeeeeff,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    : new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  geometry.setIndex([]);
  return new THREE.Mesh(geometry, material);
}

function updateTrailRibbon(
  mesh: THREE.Mesh,
  positions: THREE.Vector3[],
  headWidth: number,
): void {
  const n = positions.length;
  if (n < 2) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  const tailWidth = TRAIL_TAIL_WIDTH;
  const vertices: number[] = [];
  const indices: number[] = [];
  let idx = 0;
  for (let i = 0; i < n - 1; i++) {
    const p0 = positions[i];
    const p1 = positions[i + 1];
    _trailDir.subVectors(p1, p0).normalize();
    _trailPerp.crossVectors(_trailDir, _trailUp);
    const perpLen = _trailPerp.length();
    if (perpLen < 0.001) _trailPerp.set(1, 0, 0);
    else _trailPerp.normalize();
    const t0 = i / (n - 1);
    const t1 = (i + 1) / (n - 1);
    const w0 = tailWidth + (headWidth - tailWidth) * t0;
    const w1 = tailWidth + (headWidth - tailWidth) * t1;
    const h0 = w0 * 0.5;
    const h1 = w1 * 0.5;
    const v0x = p0.x - _trailPerp.x * h0, v0y = p0.y - _trailPerp.y * h0, v0z = p0.z - _trailPerp.z * h0;
    const v1x = p0.x + _trailPerp.x * h0, v1y = p0.y + _trailPerp.y * h0, v1z = p0.z + _trailPerp.z * h0;
    const v2x = p1.x + _trailPerp.x * h1, v2y = p1.y + _trailPerp.y * h1, v2z = p1.z + _trailPerp.z * h1;
    const v3x = p1.x - _trailPerp.x * h1, v3y = p1.y - _trailPerp.y * h1, v3z = p1.z - _trailPerp.z * h1;
    vertices.push(v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z, v3x, v3y, v3z);
    indices.push(idx, idx + 1, idx + 2, idx, idx + 2, idx + 3);
    idx += 4;
  }
  const geom = mesh.geometry as THREE.BufferGeometry;
  geom.dispose();
  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  newGeom.setIndex(indices);
  mesh.geometry = newGeom;
}

function createFireballMesh(color: number): THREE.Group {
  const group = new THREE.Group();

  const geo = new THREE.SphereGeometry(0.08, 8, 6);
  const mat = new THREE.MeshBasicMaterial({
    color,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  group.add(new THREE.Mesh(geo, mat));

  // Point light — mostly white with a tint of the projectile color
  const lightColor = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.7);
  const light = new THREE.PointLight(lightColor, 15, 10);
  light.position.set(0, 0, 0);
  group.add(light);

  return group;
}

// ── Hit callback type ────────────────────────────────────────────────

export interface ProjectileHitInfo {
  enemy: Enemy;
  damage: number;
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirZ: number;
  isCrit: boolean;
  /** True when the hit was deflected by armour (no damage dealt). */
  deflected?: boolean;
}

export interface ProjectileUpdateOptions {
  getGroundY?: (x: number, z: number) => number;
  /** Terrain geometry (box group, heightmap mesh) for arrow stick on cliffs/walls */
  terrainColliders?: THREE.Object3D[];
  /** Exclude from raycast (e.g. open doors) — object or any descendant is skipped */
  excludeObjects?: THREE.Object3D[];
  /** Called when a projectile hits a prop entity — return true if the prop was destroyed */
  onPropHit?: (entity: Entity, position: THREE.Vector3) => boolean;
  /** Destroyable prop collision data for proximity-based hit detection */
  propTargets?: ReadonlyArray<{ x: number; y: number; z: number; radius: number; height: number; entity: Entity }>;
  /** Meshes to exclude from stick raycasts (destroyable props — handled by proximity instead) */
  destroyableMeshes?: Set<THREE.Object3D>;
}

// ── ProjectileSystem ─────────────────────────────────────────────────

export class ProjectileSystem {
  private projectiles: Projectile[] = [];
  private cooldowns = new Map<string, number>();
  private impactEffects: EnergyImpact[] = [];
  private readonly scene: THREE.Scene;

  /** Base crit chance for projectiles (5%) */
  private critChance = 0.05;
  /** Additional crit bonus (from clarity potion) */
  private critBonusValue = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Set the crit bonus (e.g. from clarity potion) */
  setCritBonus(bonus: number): void {
    this.critBonusValue = bonus;
  }

  /** Spawn a short-lived energy explosion at (x,y,z). If dir is provided, offset position by ARROW_PENETRATION_OFFSET * penetrationScale. If parent (e.g. character mesh) is provided, explosion is parented so it follows the character. */
  private spawnEnergyImpact(x: number, y: number, z: number, color: number, dirX?: number, dirY?: number, dirZ?: number, parent?: THREE.Object3D, penetrationScale = 1): void {
    if (dirX !== undefined && dirY !== undefined && dirZ !== undefined) {
      const len = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1;
      const offset = ARROW_PENETRATION_OFFSET * penetrationScale;
      x += (dirX / len) * offset;
      y += (dirY / len) * offset;
      z += (dirZ / len) * offset;
    }
    const geo = new THREE.SphereGeometry(0.15, 12, 8);
    const mat = new THREE.MeshBasicMaterial({
      color,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.setScalar(0.01);

    const light = new THREE.PointLight(color, IMPACT_LIGHT_INTENSITY * 1.5, IMPACT_LIGHT_RADIUS);

    if (parent) {
      const worldPos = new THREE.Vector3(x, y, z);
      parent.worldToLocal(worldPos);
      mesh.position.copy(worldPos);
      light.position.copy(worldPos);
      parent.add(mesh);
      parent.add(light);
    } else {
      mesh.position.set(x, y, z);
      light.position.set(x, y, z);
      this.scene.add(mesh);
      this.scene.add(light);
    }

    this.impactEffects.push({
      mesh,
      light,
      age: 0,
      duration: IMPACT_DURATION,
      parent: parent ?? null,
    });
  }

  private getProjectileColor(p: Projectile): number {
    if (p.mesh instanceof THREE.Group && p.mesh.children[0] instanceof THREE.Mesh) {
      const mat = (p.mesh.children[0] as THREE.Mesh).material;
      if (mat && 'color' in mat && (mat as THREE.MeshBasicMaterial).color) {
        return ((mat as THREE.MeshBasicMaterial).color as THREE.Color).getHex();
      }
    }
    return 0xff6600;
  }

  private updateImpactEffects(dt: number): void {
    for (let i = this.impactEffects.length - 1; i >= 0; i--) {
      const eff = this.impactEffects[i];
      eff.age += dt;
      const t = Math.min(1, eff.age / eff.duration);
      const scale = IMPACT_MAX_SCALE * (1 - (1 - t) * (1 - t) * (1 - t)); // fast burst (cubic ease-out)
      eff.mesh.scale.setScalar(scale);
      (eff.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - t);
      if (eff.light) eff.light.intensity = IMPACT_LIGHT_INTENSITY * (1 - t);

      if (eff.age >= eff.duration) {
        const container = eff.parent ?? this.scene;
        container.remove(eff.mesh);
        eff.mesh.geometry.dispose();
        (eff.mesh.material as THREE.Material).dispose();
        if (eff.light) container.remove(eff.light);
        this.impactEffects.splice(i, 1);
      }
    }
  }

  /** Fire a projectile from the given muzzle (spawn) position, auto-targeting the nearest enemy in a forward cone. Only auto-targets if raycast to enemy reaches the enemy cleanly (no wall/door in the way). Pass terrainColliders when you have them so obstacles = architecture + props + terrain. Pass excludeObjects (e.g. open doors) to skip them in raycasts. */
  fireProjectile(
    ownerKey: string,
    config: ProjectileConfig,
    spawnX: number,
    spawnY: number,
    spawnZ: number,
    facing: number,
    enemies: ReadonlyArray<Enemy>,
    terrainColliders?: THREE.Object3D[],
    excludeObjects?: THREE.Object3D[],
    muzzleUp?: number,
    autoTarget = true,
    knockback = 2.5,
  ): boolean {
    // Cooldown check
    const cd = this.cooldowns.get(ownerKey) ?? 0;
    if (cd > 0) return false;

    // Max active check
    if (this.projectiles.length >= MAX_ACTIVE) return false;

    // Set cooldown
    this.cooldowns.set(ownerKey, config.cooldown);

    // Auto-target: pick nearest enemy within forward cone with clear line of sight (no obstacle between muzzle and enemy)
    const faceDirX = -Math.sin(facing);
    const faceDirZ = -Math.cos(facing);
    let dirX = faceDirX;
    let dirY = 0;
    let dirZ = faceDirZ;
    let targetX = spawnX + faceDirX * 10;
    let targetY = spawnY;
    let targetZ = spawnZ + faceDirZ * 10;

    const raycaster = new THREE.Raycaster();
    const rayOrigin = new THREE.Vector3(spawnX, spawnY, spawnZ);
    const rayDir = new THREE.Vector3();
    const archAndProps = entityRegistry ? entityRegistry.getByLayer(Layer.Architecture | Layer.Prop).map(e => e.object3D) : [];
    const allObstacles = [...archAndProps, ...(terrainColliders ?? [])];
    const obstacles = excludeObjects?.length
      ? allObstacles.filter(o => o.parent && !isExcludedFromRaycast(o, excludeObjects) && !isCollisionOnly(o))
      : allObstacles.filter(o => o.parent && !isCollisionOnly(o));

    let bestDist = AUTO_TARGET_RANGE;
    for (const enemy of (autoTarget ? enemies : [])) {
      if (!enemy.isAlive) continue;
      const ex = enemy.mesh.position.x;
      const ey = enemy.mesh.position.y;
      const ez = enemy.mesh.position.z;
      const edx = ex - spawnX;
      const edy = ey - spawnY;
      const edz = ez - spawnZ;
      const eDist = Math.sqrt(edx * edx + edy * edy + edz * edz);
      if (eDist < 0.1 || eDist > bestDist) continue;

      // Check forward cone: dot product with facing (horizontal)
      const eDistH = Math.sqrt(edx * edx + edz * edz) || 0.001;
      const enx = edx / eDistH;
      const enz = edz / eDistH;
      const dot = faceDirX * enx + faceDirZ * enz;
      if (dot < AUTO_TARGET_MIN_DOT) continue; // outside ~120° cone

      // Line-of-sight: raycast to enemy must not hit an obstacle first
      if (obstacles.length > 0) {
        rayDir.set(edx, edy, edz).normalize();
        raycaster.set(rayOrigin, rayDir);
        raycaster.far = eDist + 0.05;
        raycaster.near = 0.02;
        const hits = raycaster.intersectObjects(obstacles, true);
        if (hits.length > 0 && hits[0].distance < eDist - 0.05) continue; // obstacle in the way
      }

      bestDist = eDist;
      targetX = ex;
      targetY = ey;
      targetZ = ez;
    }

    const toTargetX = targetX - spawnX;
    const toTargetY = targetY - spawnY;
    const toTargetZ = targetZ - spawnZ;
    const toLen = Math.sqrt(toTargetX * toTargetX + toTargetY * toTargetY + toTargetZ * toTargetZ) || 1;
    dirX = toTargetX / toLen;
    dirY = toTargetY / toLen;
    dirZ = toTargetZ / toLen;

    // Add slight random spread (±3°) in horizontal plane
    const spread = (Math.random() - 0.5) * AUTO_TARGET_SPREAD;
    const cos = Math.cos(spread), sin = Math.sin(spread);
    const sdx = dirX * cos - dirZ * sin;
    const sdz = dirX * sin + dirZ * cos;
    dirX = sdx;
    dirZ = sdz;
    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ) || 1;
    dirX /= dirLen;
    dirY /= dirLen;
    dirZ /= dirLen;

    // Wall check: raycast from player body toward muzzle spawn point.
    // If a wall is in the way, pull the spawn point back so the arrow
    // starts just before the wall and the normal collision handles the rest.
    const bodyOrigin = new THREE.Vector3(
      spawnX - faceDirX * 0.6,
      spawnY,
      spawnZ - faceDirZ * 0.6,
    );
    const toMuzzle = new THREE.Vector3(spawnX - bodyOrigin.x, 0, spawnZ - bodyOrigin.z);
    const muzzleDist = toMuzzle.length();
    if (muzzleDist > 0.01 && obstacles.length > 0) {
      toMuzzle.normalize();
      raycaster.set(bodyOrigin, toMuzzle);
      raycaster.far = muzzleDist + 0.1;
      raycaster.near = 0;
      const wallHits = raycaster.intersectObjects(obstacles, true);
      for (const h of wallHits) {
        if (!(h.object as THREE.Mesh).isMesh || !h.object.visible) continue;
        const m = h.object as THREE.Mesh;
        if (m.geometry) {
          m.geometry.computeBoundingBox();
          const bb = m.geometry.boundingBox;
          if (bb && (bb.max.y - bb.min.y) < 0.3) continue;
        }
        // Pull spawn back to just before the wall hit
        const pullback = 0.15;
        spawnX = h.point.x - faceDirX * pullback;
        spawnZ = h.point.z - faceDirZ * pullback;
        break;
      }
    }

    // Create mesh and place at (possibly adjusted) spawn position
    const isArrow = config.kind === 'arrow';
    const mesh = isArrow ? createArrowMesh(config.color) : createFireballMesh(config.color);
    const px = spawnX;
    const py = spawnY;
    const pz = spawnZ;
    mesh.position.set(px, py, pz);

    // Orient: arrow +X = travel direction (3D); fireball uses rotation.y
    if (isArrow) {
      const forward = new THREE.Vector3(dirX, dirY, dirZ);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), forward);
    } else {
      mesh.rotation.y = Math.atan2(dirX, dirZ);
    }

    this.scene.add(mesh);

    const trailMesh = createTrailRibbon(isArrow, config.color);
    const trailStart = isArrow
      ? new THREE.Vector3(-1, 0, 0).applyQuaternion(mesh.quaternion).multiplyScalar(ARROW_TIP_OFFSET).add(new THREE.Vector3(px, py, pz))
      : new THREE.Vector3(px, py, pz);
    const trailPositions: THREE.Vector3[] = [trailStart];
    trailMesh.position.set(0, 0, 0);
    this.scene.add(trailMesh);
    updateTrailRibbon(trailMesh, trailPositions, isArrow ? TRAIL_HEAD_WIDTH_ARROW : TRAIL_HEAD_WIDTH_FIREBALL);

    // Extract light from projectile mesh (both arrows and fireballs have one)
    const light = (mesh.children.find(c => c instanceof THREE.PointLight) as THREE.PointLight | null);

    this.projectiles.push({
      mesh,
      vx: dirX * config.speed,
      vy: dirY * config.speed,
      vz: dirZ * config.speed,
      speed: config.speed,
      damage: config.damage,
      age: 0,
      lifetime: config.lifetime,
      startX: px,
      startY: py,
      startZ: pz,
      ownerKey,
      light,
      isArrow,
      gravityActive: false,
      stuck: false,
      stuckAt: 0,
      trailMesh,
      trailPositions,
      flyYOffset: muzzleUp ?? FLY_Y_OFFSET,
      knockback,
    });

    // SFX — spatial, type-specific
    const sfxType = isArrow ? 'arrow' : 'fireball';
    audioSystem.sfxAt(sfxType, px, pz);

    return true;
  }

  /** Find vertex index in mesh geometry closest to a local-space point (for arrow/gore attachment). */
  private closestVertexIndex(mesh: THREE.Mesh, localPoint: THREE.Vector3): number {
    const geo = mesh.geometry;
    const posAttr = geo.getAttribute('position');
    if (!posAttr || posAttr.count === 0) return 0;
    let bestIdx = 0;
    let bestDistSq = Infinity;
    const _v = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i++) {
      _v.fromBufferAttribute(posAttr, i);
      const dSq = _v.distanceToSquared(localPoint);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  /**
   * On character hit: reposition arrow to nearest voxel and parent to character mesh so it rotates with him.
   * Preserve the arrow's world orientation at collision so it sticks in the direction it hit.
   */
  private stickArrowToCharacterMesh(p: Projectile, mesh: THREE.Mesh): void {
    if (!mesh.geometry?.getAttribute('position')) return;
    // Save world orientation before any reparent so we can restore "collision direction" after.
    const worldQuat = p.mesh.getWorldQuaternion(new THREE.Quaternion()).clone();
    p.stuck = true;
    p.stuckAt = p.age;
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    if (p.light) {
      p.mesh.remove(p.light);
      p.light = null;
    }
    removeArrowTip(p.mesh);
    const tipWorld = new THREE.Vector3(ARROW_TIP_OFFSET, 0, 0).applyMatrix4(p.mesh.matrixWorld);
    const localTip = tipWorld.clone();
    mesh.worldToLocal(localTip);
    p.mesh.removeFromParent();
    mesh.add(p.mesh); // parent to character so arrow rotates with him
    p.stuckToMesh = mesh;
    p.stuckVertexIndex = this.closestVertexIndex(mesh, localTip);
    p.stuckNormalOffset = 0.02; // push tip inwards into mesh
    p.stuckPositionOnly = true; // only update position to vertex each frame, not orientation
    this.updateStuckArrowToMesh(p);
    // Restore collision direction: set local quat so arrow's world quat = worldQuat.
    const meshWorldInv = mesh.getWorldQuaternion(new THREE.Quaternion()).invert();
    p.mesh.quaternion.copy(worldQuat).premultiply(meshWorldInv);
    if (p.trailMesh && p.trailPositions) {
      p.trailPositions.length = 0;
      updateTrailRibbon(p.trailMesh, p.trailPositions, TRAIL_HEAD_WIDTH_ARROW);
    }
  }

  /** Update stuck arrow position/rotation from current mesh geometry (same as gore stains). */
  private updateStuckArrowToMesh(p: Projectile): void {
    const parent = p.mesh.parent;
    if (!parent || !(parent instanceof THREE.Mesh) || p.stuckVertexIndex === undefined) return;
    const mesh = parent as THREE.Mesh;
    try {
      const geo = mesh.geometry;
      const posAttr = geo.getAttribute('position');
      const nrmAttr = geo.getAttribute('normal');
      if (!posAttr || posAttr.count === 0) return;
      const idx = p.stuckVertexIndex % posAttr.count;
      const vx = posAttr.getX(idx);
      const vy = posAttr.getY(idx);
      const vz = posAttr.getZ(idx);
      let nx = 0, ny = 0, nz = 0;
      if (nrmAttr && idx < nrmAttr.count) {
        nx = nrmAttr.getX(idx);
        ny = nrmAttr.getY(idx);
        nz = nrmAttr.getZ(idx);
      }
      const tipOffset = p.stuckNormalOffset ?? 0.02;
      // Tip target in mesh local (same as gore: vertex + normal offset).
      const tipX = vx + nx * tipOffset;
      const tipY = vy + ny * tipOffset;
      const tipZ = vz + nz * tipOffset;

      if (p.stuckPositionOnly) {
        // Arrow keeps collision orientation. Move tip along arrow direction so it penetrates the character.
        const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(p.mesh.quaternion);
        const penX = tipX + localX.x * ARROW_PENETRATION_OFFSET;
        const penY = tipY + localX.y * ARROW_PENETRATION_OFFSET;
        const penZ = tipZ + localX.z * ARROW_PENETRATION_OFFSET;
        p.mesh.position.set(
          penX - localX.x * ARROW_TIP_OFFSET,
          penY - localX.y * ARROW_TIP_OFFSET,
          penZ - localX.z * ARROW_TIP_OFFSET,
        );
      } else {
        // Terrain/walls: align arrow to normal, position so tip is at vertex + normal offset.
        p.mesh.position.set(
          tipX - nx * ARROW_TIP_OFFSET,
          tipY - ny * ARROW_TIP_OFFSET,
          tipZ - nz * ARROW_TIP_OFFSET,
        );
        const normal = new THREE.Vector3(nx, ny, nz);
        if (normal.lengthSq() > 0.0001) {
          normal.normalize();
          p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), normal);
        }
      }
    } catch {
      // Geometry disposed or swapped — keep arrow at last position (same as gore)
    }
  }

  /**
   * Stick arrow to hit point.
   * Terrain/wall/prop: no parent — arrow stays in world space at hit point (just collide, no reparenting).
   * Character: pass character mesh as parent so the arrow reparents and follows the character (stick in flesh).
   */
  private stickArrow(
    p: Projectile,
    hitPoint: THREE.Vector3,
    parentOrAttachMesh?: THREE.Object3D,
  ): void {
    p.stuck = true;
    p.stuckAt = p.age;
    p.vx = 0;
    p.vz = 0;
    p.vy = 0;
    if (p.light) {
      p.mesh.remove(p.light);
      p.light = null;
    }
    removeArrowTip(p.mesh);
    // Flight direction = local +X in world space (arrow tip is along +X).
    // NOTE: getWorldDirection() returns local -Z (camera forward convention),
    // which is PERPENDICULAR to the arrow shaft — that was the old bug causing
    // arrows to float ~10cm beside the hit surface instead of embedding in it.
    const flightDir = new THREE.Vector3(1, 0, 0)
      .applyQuaternion(p.mesh.getWorldQuaternion(new THREE.Quaternion()));
    const desiredWorldPos = hitPoint.clone().addScaledVector(flightDir, ARROW_PENETRATION_OFFSET - ARROW_TIP_OFFSET);

    const parent = parentOrAttachMesh;
    if (parent) {
      // Character: reparent so arrow follows the character
      const arrowWorldQuat = p.mesh.getWorldQuaternion(new THREE.Quaternion());
      p.mesh.removeFromParent();
      parent.add(p.mesh);
      p.stuckToMesh = undefined;
      p.stuckVertexIndex = undefined;
      parent.worldToLocal(desiredWorldPos);
      p.mesh.position.copy(desiredWorldPos);
      const parentWorldQuat = new THREE.Quaternion();
      parent.getWorldQuaternion(parentWorldQuat).invert();
      p.mesh.quaternion.copy(parentWorldQuat).multiply(arrowWorldQuat);
    } else {
      // Terrain/wall/prop: stay in world space, no reparenting
      p.stuckToMesh = undefined;
      p.stuckVertexIndex = undefined;
      p.mesh.position.copy(desiredWorldPos);
    }
    if (p.trailMesh && p.trailPositions) {
      p.trailPositions.length = 0;
      updateTrailRibbon(p.trailMesh, p.trailPositions, TRAIL_HEAD_WIDTH_ARROW);
    }
  }

  /** Update all projectiles: move, collide, stick (arrows), cleanup */
  update(
    dt: number,
    enemies: ReadonlyArray<Enemy>,
    onHit: (info: ProjectileHitInfo) => void,
    options?: ProjectileUpdateOptions,
  ): void {
    const getGroundY = options?.getGroundY;
    const onPropHit = options?.onPropHit;
    const propTargets = options?.propTargets;
    const archAndProps =
      entityRegistry ? entityRegistry.getByLayer(Layer.Architecture | Layer.Prop).map(e => e.object3D) : [];
    const terrainColliders = options?.terrainColliders ?? [];
    const excludeObjects = options?.excludeObjects ?? [];
    // Stick raycast: only architecture + props that are visible (no invisible colliders). Terrain (ground) causes arrows to stick immediately in front of the player; ground hits are already handled by getGroundY/slope above.
    // Destroyable props are excluded — they're handled by proximity detection instead.
    const destroyableMeshes = options?.destroyableMeshes;
    const stickColliders = [
      ...archAndProps.filter(o => {
        if (!o.parent) return false; // detached from scene
        if (isCollisionOnly(o)) return false;
        if (isNoProjectileStick(o)) return false;
        if (!isVisibleForStick(o)) return false;
        if (destroyableMeshes?.has(o)) return false;
        if (excludeObjects.length && isExcludedFromRaycast(o, excludeObjects)) return false;
        return true;
      }),
      // Include terrain colliders (trees, rocks, POIs) for arrow sticking
      ...terrainColliders,
    ];
    const raycaster = new THREE.Raycaster();
    const rayOrigin = new THREE.Vector3();
    const rayDir = new THREE.Vector3();

    for (const [key, cd] of this.cooldowns) {
      const next = cd - dt;
      if (next <= 0) this.cooldowns.delete(key);
      else this.cooldowns.set(key, next);
    }

    this.updateImpactEffects(dt);

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;

      // Stuck arrows: follow mesh geometry (like gore), then remove after cooldown
      if (p.stuck) {
        if (p.stuckToMesh && p.stuckVertexIndex !== undefined) {
          this.updateStuckArrowToMesh(p);
        }
        if (p.age >= p.stuckAt + STUCK_ARROW_LIFETIME) this.removeProjectile(i);
        continue;
      }

      // Arrow gravity after traveling a fair distance (disabled for now)
      // if (p.isArrow) {
      //   const travelDistSq = (p.mesh.position.x - p.startX) ** 2 + (p.mesh.position.z - p.startZ) ** 2;
      //   if (travelDistSq >= ARROW_GRAVITY_START_DIST * ARROW_GRAVITY_START_DIST) p.gravityActive = true;
      //   if (p.gravityActive) {
      //     p.vy -= ARROW_GRAVITY * dt;
      //     p.mesh.position.y += p.vy * dt;
      //   }
      // }

      // Homing (only when not stuck): steer toward nearest enemy in 3D within cone
      if (p.age > HOMING_MIN_AGE) {
        const curDir = new THREE.Vector3(p.vx, p.vy, p.vz);
        const curLen = curDir.length();
        if (curLen < 0.01) curDir.set(1, 0, 0);
        else curDir.normalize();

        let bestAngleDiff = Infinity;
        let targetX = 0, targetY = 0, targetZ = 0;
        let hasTarget = false;

        for (const enemy of enemies) {
          if (!enemy.isAlive) continue;
          const edx = enemy.mesh.position.x - p.mesh.position.x;
          const edy = enemy.mesh.position.y - p.mesh.position.y;
          const edz = enemy.mesh.position.z - p.mesh.position.z;
          const eDistSq = edx * edx + edy * edy + edz * edz;
          if (eDistSq > HOMING_SEEK_RADIUS * HOMING_SEEK_RADIUS || eDistSq < 0.01) continue;

          const toEnemyLen = Math.sqrt(eDistSq);
          const toEnemyX = edx / toEnemyLen;
          const toEnemyY = edy / toEnemyLen;
          const toEnemyZ = edz / toEnemyLen;
          const dot = curDir.x * toEnemyX + curDir.y * toEnemyY + curDir.z * toEnemyZ;
          const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
          if (angle > HOMING_MAX_ANGLE || angle >= bestAngleDiff) continue;

          bestAngleDiff = angle;
          targetX = enemy.mesh.position.x;
          targetY = enemy.mesh.position.y;
          targetZ = enemy.mesh.position.z;
          hasTarget = true;
        }

        if (hasTarget) {
          const tdx = targetX - p.mesh.position.x;
          const tdy = targetY - p.mesh.position.y;
          const tdz = targetZ - p.mesh.position.z;
          const toLen = Math.sqrt(tdx * tdx + tdy * tdy + tdz * tdz) || 1;
          const desiredDir = new THREE.Vector3(tdx / toLen, tdy / toLen, tdz / toLen);
          const dot = curDir.dot(desiredDir);
          const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
          const maxTurn = HOMING_TURN_RATE * dt;
          const t = angle <= 0.001 ? 1 : Math.min(1, maxTurn / angle);
          const newDir = curDir.clone().lerp(desiredDir, t).normalize();
          p.vx = newDir.x * p.speed;
          p.vy = newDir.y * p.speed;
          p.vz = newDir.z * p.speed;

          if (p.isArrow) {
            p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), newDir);
          } else {
            p.mesh.rotation.y = Math.atan2(p.vx, p.vz);
          }
        }
      }

      const lastX = p.mesh.position.x;
      const lastY = p.mesh.position.y;
      const lastZ = p.mesh.position.z;

      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;

      if (!p.stuck && p.trailMesh && p.trailPositions) {
        if (p.isArrow) {
          const tailOffset = new THREE.Vector3(-1, 0, 0).applyQuaternion(p.mesh.quaternion).multiplyScalar(ARROW_TIP_OFFSET);
          p.trailPositions.push(new THREE.Vector3(
            p.mesh.position.x + tailOffset.x,
            p.mesh.position.y + tailOffset.y,
            p.mesh.position.z + tailOffset.z,
          ));
        } else {
          p.trailPositions.push(new THREE.Vector3(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z));
        }
        const maxPoints = p.isArrow ? TRAIL_MAX_POINTS_ARROW : TRAIL_MAX_POINTS;
        if (p.trailPositions.length > maxPoints) p.trailPositions.shift();
        // When arrow slows down, shorten trail; clear when nearly stopped so it doesn't persist
        if (p.isArrow) {
          const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz);
          if (speed < 0.2 * p.speed) p.trailPositions.length = 0;
        }
        const headWidth = p.isArrow ? TRAIL_HEAD_WIDTH_ARROW : TRAIL_HEAD_WIDTH_FIREBALL;
        updateTrailRibbon(p.trailMesh, p.trailPositions, headWidth);
      }

      if (p.light && !p.isArrow) {
        const pulse = 0.7 + 0.3 * Math.sin(p.age * 20);
        const mat = (p.mesh.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial;
        mat.opacity = pulse;
        p.light.intensity = 1.0 + 0.5 * Math.sin(p.age * 20);
      }

      const dx = p.mesh.position.x - p.startX;
      const dy = p.mesh.position.y - p.startY;
      const dz = p.mesh.position.z - p.startZ;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (p.age >= p.lifetime || distSq > MAX_RANGE * MAX_RANGE) {
        if (!p.isArrow) {
          const pos = p.mesh.position;
          this.spawnEnergyImpact(pos.x, pos.y, pos.z, this.getProjectileColor(p));
        }
        this.removeProjectile(i);
        continue;
      }

      let hit = false;
      let staticHitPoint: THREE.Vector3 | null = null; // for energy impact on doors/walls/props

      // Proximity-based destroyable prop hit — checked FIRST so props catch projectiles
      // that would otherwise fly over them. Uses closest-point-on-segment (lastPos→curPos)
      // in XZ, with vertical hit area from prop base to muzzle spawn height.
      if (onPropHit && propTargets && !p.stuck) {
        const cx = p.mesh.position.x;
        const cz = p.mesh.position.z;
        // Segment in XZ: A=last, B=current
        const segDx = cx - lastX;
        const segDz = cz - lastZ;
        const segLenSq = segDx * segDx + segDz * segDz;
        for (const pt of propTargets) {
          // Closest point on segment to prop center (XZ only)
          let closestX: number, closestZ: number;
          if (segLenSq < 0.0001) {
            closestX = cx; closestZ = cz;
          } else {
            const t = Math.max(0, Math.min(1,
              ((pt.x - lastX) * segDx + (pt.z - lastZ) * segDz) / segLenSq));
            closestX = lastX + t * segDx;
            closestZ = lastZ + t * segDz;
          }
          const dx = closestX - pt.x;
          const dz = closestZ - pt.z;
          const distXZSq = dx * dx + dz * dz;
          const hitRadius = pt.radius + 0.2;
          if (distXZSq > hitRadius * hitRadius) continue;
          // Y: interpolate projectile Y at closest point
          const tY = segLenSq > 0.0001
            ? Math.max(0, Math.min(1, ((pt.x - lastX) * segDx + (pt.z - lastZ) * segDz) / segLenSq))
            : 0;
          const closestY = lastY + tY * (p.mesh.position.y - lastY);
          // Hit area: from prop base to projectile muzzle spawn height
          if (closestY < pt.y - 0.1 || closestY > p.startY + 0.1) continue;
          if (onPropHit(pt.entity, new THREE.Vector3(closestX, closestY, closestZ))) {
            this.spawnEnergyImpact(closestX, closestY, closestZ, this.getProjectileColor(p), p.vx, p.vy, p.vz);
            this.removeProjectile(i);
            hit = true;
            break;
          }
        }
        if (hit) continue;
      }

      // Raycast vs architecture/props FIRST — use actual hit point on walls/cubes. If we did terrain first, getGroundY would return top-of-cube and we'd stick there instead of on the hit face.
      if (!hit && stickColliders.length > 0) {
        this.scene.updateMatrixWorld(true);
        rayOrigin.set(lastX, lastY, lastZ);
        rayDir.set(p.mesh.position.x - lastX, p.mesh.position.y - lastY, p.mesh.position.z - lastZ);
        const rayLen = rayDir.length();
        if (rayLen > 0.001) {
          rayDir.normalize();
          raycaster.set(rayOrigin, rayDir);
          raycaster.far = rayLen + 0.2;
          raycaster.near = 0.08;
          const hits = raycaster.intersectObjects(stickColliders, true);
          for (const h of hits) {
            if (!h.face) continue;
            if (h.distance < MIN_STICK_DISTANCE) continue; // avoid sticking on geometry right in front of muzzle
            // // Don't stick if projectile hasn't traveled far enough from spawn (prevents clipping nearby walls)
            // const dsx = h.point.x - p.startX;
            // const dsy = h.point.y - p.startY;
            // const dsz = h.point.z - p.startZ;
            // if (dsx * dsx + dsy * dsy + dsz * dsz < MIN_TRAVEL_FROM_SPAWN * MIN_TRAVEL_FROM_SPAWN) continue;
            h.object.updateMatrixWorld(true);
            // Three.js Raycaster returns intersection point in WORLD space. Do not apply matrixWorld — that would double-transform and place the arrow far away (e.g. 10m in the air).
            const stickPoint = h.point.clone();
            const box = new THREE.Box3().setFromObject(h.object);
            // If point ended up inside the box (raycast can return slightly inside), push to nearest face so arrow sticks on surface
            clampPointToBoxSurface(stickPoint, box, stickPoint);
            // Sanity: stick point must lie on the arrow's path (ray segment). Reject if it's off the segment (catches any bogus point).
            const toStick = stickPoint.x - rayOrigin.x;
            const toStickY = stickPoint.y - rayOrigin.y;
            const toStickZ = stickPoint.z - rayOrigin.z;
            const projectedDist = toStick * rayDir.x + toStickY * rayDir.y + toStickZ * rayDir.z;
            const offSegmentSq = toStick * toStick + toStickY * toStickY + toStickZ * toStickZ - projectedDist * projectedDist;
            if (projectedDist < -0.1 || projectedDist > rayLen + 0.2 || offSegmentSq > 0.25) {
              if (DEBUG_PROJECTILE_STICK) {
                // console.log('[Projectile stick RAYCAST] SKIP hit — stick point off ray segment', { projectedDist: projectedDist.toFixed(2), rayLen: rayLen.toFixed(2), offSegmentM: Math.sqrt(offSegmentSq).toFixed(2) });
              }
              continue;
            }
            // Reject if stick point is far from hit object's AABB (safety net)
            const closestOnBox = new THREE.Vector3(
              Math.max(box.min.x, Math.min(box.max.x, stickPoint.x)),
              Math.max(box.min.y, Math.min(box.max.y, stickPoint.y)),
              Math.max(box.min.z, Math.min(box.max.z, stickPoint.z))
            );
            if (stickPoint.distanceTo(closestOnBox) > MAX_STICK_TO_OBJECT_DISTANCE) {
              if (DEBUG_PROJECTILE_STICK) {
                // console.log('[Projectile stick RAYCAST] SKIP hit — stick point too far from object AABB', stickPoint.distanceTo(closestOnBox).toFixed(2), 'm');
              }
              continue; // try next hit
            }
            if (DEBUG_PROJECTILE_STICK) {
              const objPos = new THREE.Vector3();
              h.object.getWorldPosition(objPos);
              const parentChain: string[] = [];
              let parent: THREE.Object3D | null = h.object.parent;
              while (parent) {
                parentChain.push(`${parent.type}:${(parent as THREE.Object3D & { name?: string }).name ?? '?'}`);
                parent = parent.parent;
              }
              // Detailed info: geometry class, vertex count, material type, AABB size
              const hitMesh = h.object as THREE.Mesh;
              const geoInfo = hitMesh.geometry
                ? `${hitMesh.geometry.type}(${hitMesh.geometry.getAttribute?.('position')?.count ?? '?'} verts)`
                : 'NO_GEO';
              const matInfo = hitMesh.material
                ? `${(hitMesh.material as THREE.Material).type} visible=${(hitMesh.material as THREE.Material).visible}`
                : 'NO_MAT';
              const boxSize = box.getSize(new THREE.Vector3());
              // console.log('[Projectile stick RAYCAST]', {
              //   objectType: h.object.type,
              //   objectName: (h.object as THREE.Object3D & { name?: string }).name,
              //   objectWorldPos: `${objPos.x.toFixed(2)},${objPos.y.toFixed(2)},${objPos.z.toFixed(2)}`,
              //   parentChain: parentChain.slice(0, 5),
              //   geo: geoInfo,
              //   mat: matInfo,
              //   aabb: `${boxSize.x.toFixed(2)}x${boxSize.y.toFixed(2)}x${boxSize.z.toFixed(2)}`,
              //   aabbMin: `${box.min.x.toFixed(2)},${box.min.y.toFixed(2)},${box.min.z.toFixed(2)}`,
              //   aabbMax: `${box.max.x.toFixed(2)},${box.max.y.toFixed(2)},${box.max.z.toFixed(2)}`,
              //   h_point: `${h.point.x.toFixed(3)},${h.point.y.toFixed(3)},${h.point.z.toFixed(3)}`,
              //   h_distance: h.distance.toFixed(3),
              //   stickPoint: `${stickPoint.x.toFixed(3)},${stickPoint.y.toFixed(3)},${stickPoint.z.toFixed(3)}`,
              //   collisionOnly: !!(h.object as any).userData?.collisionOnly,
              //   projectileY: p.mesh.position.y.toFixed(3),
              //   distFromSpawn: Math.sqrt((h.point.x - p.startX) ** 2 + (h.point.y - p.startY) ** 2 + (h.point.z - p.startZ) ** 2).toFixed(3),
              //   spawn: `${p.startX.toFixed(3)},${p.startY.toFixed(3)},${p.startZ.toFixed(3)}`,
              // });
            }
            if (DEBUG_PROJECTILE_STICK) {
              // Visual debug: red sphere at stick point, green wireframe box showing hit object AABB
              const dbgSphere = new THREE.Mesh(
                new THREE.SphereGeometry(0.06, 8, 8),
                new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false }),
              );
              dbgSphere.position.copy(stickPoint);
              dbgSphere.renderOrder = 999;
              this.scene.add(dbgSphere);
              const dbgBox = new THREE.Box3Helper(box, new THREE.Color(0x00ff00));
              dbgBox.renderOrder = 999;
              this.scene.add(dbgBox);
              // Label: show what was hit (parent chain + geometry info)
              const hitMeshDbg = h.object as THREE.Mesh;
              const parentNames: string[] = [];
              let pp: THREE.Object3D | null = h.object;
              while (pp) { parentNames.push(pp.type + (pp.name ? `:${pp.name}` : '')); pp = pp.parent; }
              const boxSz = box.getSize(new THREE.Vector3());
              const meshName = (h.object as any).name || parentNames[0];
              const labelText = `${meshName} [${boxSz.x.toFixed(2)}x${boxSz.y.toFixed(2)}x${boxSz.z.toFixed(2)}]\n${parentNames.slice(1, 3).join(' > ')}`;
              const canvas = document.createElement('canvas');
              canvas.width = 256; canvas.height = 64;
              const ctx2d = canvas.getContext('2d')!;
              ctx2d.fillStyle = 'rgba(0,0,0,0.7)';
              ctx2d.fillRect(0, 0, 256, 64);
              ctx2d.fillStyle = '#0f0';
              ctx2d.font = '13px monospace';
              const lines = labelText.split('\n');
              lines.forEach((line, i) => ctx2d.fillText(line, 4, 16 + i * 18));
              const tex = new THREE.CanvasTexture(canvas);
              const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
              sprite.scale.set(1.2, 0.3, 1);
              sprite.position.copy(box.getCenter(new THREE.Vector3()));
              sprite.position.y = box.max.y + 0.25;
              sprite.renderOrder = 999;
              this.scene.add(sprite);
              // Auto-remove after 5s
              setTimeout(() => {
                this.scene.remove(dbgSphere); this.scene.remove(dbgBox); this.scene.remove(sprite);
                dbgSphere.geometry.dispose(); tex.dispose();
              }, 5000);
            }
            // Check if hit object is a destroyable prop
            const hitEntity = h.object.userData?.entity as Entity | undefined;
            if (onPropHit && hitEntity && hitEntity.layer & Layer.Prop) {
              if (onPropHit(hitEntity, stickPoint)) {
                // Prop was destroyed — remove projectile
                this.spawnEnergyImpact(stickPoint.x, stickPoint.y, stickPoint.z, this.getProjectileColor(p), p.vx, p.vy, p.vz);
                this.removeProjectile(i);
                hit = true;
                break;
              }
            }

            audioSystem.sfxAt('fleshHitHigh', h.point.x, h.point.z);
            if (p.isArrow) {
              this.stickArrow(p, stickPoint);
            } else {
              staticHitPoint = stickPoint;
            }
            hit = true;
            break;
          }
        }
      }

      // Terrain following: glide over gentle slopes, impact on steep ones (cliffs).
      // Also runs as fallback when stickColliders exist but the raycast missed
      // (e.g. arrow aimed at the floor in a dungeon corridor where the floor
      // isn't in stickColliders). The nearSurface guard below already prevents
      // sticking at the top of walls when getGroundY returns wall height.
      if (!hit && getGroundY) {
        const groundHere = getGroundY(p.mesh.position.x, p.mesh.position.z);
        const minY = groundHere + p.flyYOffset;
        if (p.mesh.position.y < minY) {
          // Check slope: how much did the ground rise vs horizontal travel?
          const groundPrev = getGroundY(lastX, lastZ);
          const hDist = Math.sqrt((p.mesh.position.x - lastX) ** 2 + (p.mesh.position.z - lastZ) ** 2);
          const rise = groundHere - groundPrev;
          const slope = hDist > 0.001 ? rise / hDist : 0;

          if (slope > TERRAIN_HIT_SLOPE) {
            // Only stick if projectile is actually near this surface (within ~0.4m). Otherwise getGroundY returned the top of a wall/cube ahead and we're still in mid-air — let raycast handle the wall.
            const nearSurface = p.mesh.position.y >= groundHere - 0.4;
            if (nearSurface) {
            // Steep slope — projectile impacts terrain (cliff/wall). Arrows stick at ground height.
            const hitPoint = new THREE.Vector3(p.mesh.position.x, groundHere + FLOOR_STICK_Y_OFFSET, p.mesh.position.z);
            if (DEBUG_PROJECTILE_STICK) {
              // console.log('[Projectile stick TERRAIN]', {
              //   path: 'getGroundY steep slope',
              //   projectilePos: { x: p.mesh.position.x.toFixed(3), y: p.mesh.position.y.toFixed(3), z: p.mesh.position.z.toFixed(3) },
              //   groundHere,
              //   groundPrev,
              //   slope: slope.toFixed(3),
              //   hitPoint: { x: hitPoint.x.toFixed(3), y: hitPoint.y.toFixed(3), z: hitPoint.z.toFixed(3) },
              // });
            }
            audioSystem.sfxAt('fleshHit', hitPoint.x, hitPoint.z);
            if (p.isArrow) {
              this.stickArrow(p, hitPoint);
              hit = true;
            } else {
              this.spawnEnergyImpact(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z, this.getProjectileColor(p), p.vx, p.vy, p.vz, undefined, 0.5);
              this.removeProjectile(i);
              continue;
            }
            }
          } else {
            // Gentle slope — glide over it
            p.mesh.position.y = minY;
            if (p.vy < 0) p.vy = 0;
            if (p.isArrow) {
              const effDir = new THREE.Vector3(p.vx, Math.max(p.vy, 0), p.vz).normalize();
              p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), effDir);
            }
          }
        }
      }

      // Enemy collision (3D distance so arrow at y=0.5 does not hit enemy at y=8)
      let hitEnemy: Enemy | null = null;
      if (!hit) {
        for (const enemy of enemies) {
          if (!enemy.isAlive) continue;
          const ex = enemy.mesh.position.x;
          const ey = enemy.mesh.position.y;
          const ez = enemy.mesh.position.z;
          const cdx = p.mesh.position.x - ex;
          const cdy = p.mesh.position.y - ey;
          const cdz = p.mesh.position.z - ez;
          const cDistSq = cdx * cdx + cdy * cdy + cdz * cdz;

          if (cDistSq < HIT_RADIUS * HIT_RADIUS) {
            const cDist = Math.sqrt(cDistSq) || 0.01;
            const hitDirX = cdx / cDist;
            const hitDirY = cdy / cDist;
            const hitDirZ = cdz / cDist;

            // Armour deflect — ricochet projectile in a random direction
            if (enemy.armour > 0 && Math.random() < enemy.armour) {
              onHit({
                enemy, damage: 0, x: ex, y: ey, z: ez,
                dirX: -hitDirX, dirZ: -hitDirZ, isCrit: false, deflected: true,
              });
              // Ricochet: randomize velocity direction, reduce speed
              const angle = (Math.random() - 0.5) * Math.PI * 1.2; // ±108° spread
              const cos = Math.cos(angle), sin = Math.sin(angle);
              const oldVx = p.vx, oldVz = p.vz;
              p.vx = oldVx * cos - oldVz * sin;
              p.vz = oldVx * sin + oldVz * cos;
              p.vy = 1.5 + Math.random() * 2; // pop upward
              p.speed *= 0.6;
              p.damage = 0; // no damage after deflect
              p.lifetime = p.age + 0.5; // short remaining life
              break;
            }

            // Roll for crit
            const isCrit = Math.random() < (this.critChance + this.critBonusValue);
            const finalDamage = isCrit ? p.damage * 2 : p.damage;
            const wasHit = enemy.takeDamage(finalDamage, p.mesh.position.x - p.vx * 0.1, p.mesh.position.z - p.vz * 0.1, p.knockback);
            if (wasHit) {
              onHit({
                enemy,
                damage: finalDamage,
                x: ex,
                y: ey,
                z: ez,
                dirX: -hitDirX,
                dirZ: -hitDirZ,
                isCrit,
              });
            }

            if (p.isArrow) {
              if (enemy.mesh instanceof THREE.Mesh && enemy.mesh.geometry?.getAttribute('position')) {
                this.stickArrowToCharacterMesh(p, enemy.mesh);
              } else {
                const fallback = new THREE.Vector3(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z);
                this.stickArrow(p, fallback, enemy.mesh);
              }
            } else {
              hitEnemy = enemy;
            }
            hit = true;
            break;
          }
        }
      }

      if (hit && !p.isArrow) {
        const pos = staticHitPoint ?? p.mesh.position;
        const impactParent = hitEnemy?.mesh && hitEnemy.mesh instanceof THREE.Mesh ? hitEnemy.mesh : undefined;
        this.spawnEnergyImpact(pos.x, pos.y, pos.z, this.getProjectileColor(p), p.vx, p.vy, p.vz, impactParent);
        this.removeProjectile(i);
      }
    }
  }

  private removeProjectile(index: number): void {
    const p = this.projectiles[index];

    if (p.trailMesh) {
      this.scene.remove(p.trailMesh);
      p.trailMesh.geometry.dispose();
      (p.trailMesh.material as THREE.Material).dispose();
    }

    // Dispose mesh children
    p.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });

    p.mesh.removeFromParent();
    this.projectiles.splice(index, 1);
  }

  dispose(): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      this.removeProjectile(i);
    }
    for (const eff of this.impactEffects) {
      const container = eff.parent ?? this.scene;
      container.remove(eff.mesh);
      eff.mesh.geometry.dispose();
      (eff.mesh.material as THREE.Material).dispose();
      if (eff.light) container.remove(eff.light);
    }
    this.impactEffects.length = 0;
    this.cooldowns.clear();
  }
}
