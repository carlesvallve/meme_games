import * as THREE from 'three';
import type { Character } from '../character';

// ── Gore chunk (flying body parts + blood droplets) ─────────────────

interface GoreChunk {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  groundY: number;
  age: number;
  lifetime: number;
  bounced: boolean;
  size: number; // avg scale for sound volume
  noWallStick?: boolean; // bounce off walls instead of sticking (for prop debris)
}

// ── Blood stain (parented to a character mesh, moves with them) ─────

interface BloodStain {
  mesh: THREE.Mesh;
  parent: THREE.Mesh;     // the character mesh (geometry swaps on anim frames)
  vertexIndex: number;     // which vertex to stick to
  normalOffset: number;    // distance along normal
  age: number;
  lifetime: number;
}

// ── Floor splat (tiny puddles on the ground) ────────────────────────

interface FloorSplat {
  mesh: THREE.Mesh;
  age: number;
  lifetime: number;
  startOpacity: number;
}

// ── Wall splat (blood smeared on walls) ─────────────────────────────

interface WallSplat {
  mesh: THREE.Mesh;
  age: number;
  lifetime: number;
  startOpacity: number;
}

// ── Constants ───────────────────────────────────────────────────────

const MAX_CHUNKS = 60;
const MAX_STAINS = 120;
const MAX_FLOOR_SPLATS = 50;
const MAX_WALL_SPLATS = 40;

/** Random lifetime for any gore element (chunks, splats, cubes) so nothing consistently outlasts the rest. */
function randGoreLifetime(): number {
  return 4 + Math.random() * 14; // 4–18s
}

const CHUNK_GRAVITY = 12;
const CHUNK_DRAG = 1.5;
const CHUNK_BOUNCE_Y = -0.3;
const CHUNK_BOUNCE_XZ = 0.4;

const BLOOD_RED = new THREE.Color(0x8b0000);
const BLOOD_DARK = new THREE.Color(0x4a0000);
const BLOOD_MAROON = new THREE.Color(0x660000);
const BLOOD_BRIGHT = new THREE.Color(0xcc1111);

// ── Helpers ─────────────────────────────────────────────────────────

export function sampleVertexColors(
  geometry: THREE.BufferGeometry,
  yMin: number,
  yMax: number,
  lerpColor?: THREE.Color,
  lerpAmount = 0.5,
): THREE.Color {
  const posAttr = geometry.getAttribute('position');
  const colAttr = geometry.getAttribute('color');
  if (!posAttr || !colAttr) return (lerpColor ?? BLOOD_RED).clone();

  const count = posAttr.count;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < count; i++) {
    const y = posAttr.getY(i);
    if (y >= yMin && y < yMax) {
      r += colAttr.getX(i);
      g += colAttr.getY(i);
      b += colAttr.getZ(i);
      n++;
    }
  }
  if (n === 0) return (lerpColor ?? BLOOD_RED).clone();
  const avg = new THREE.Color(r / n, g / n, b / n);
  if (lerpColor !== undefined) {
    avg.lerp(lerpColor, lerpAmount);
  } else {
    avg.lerp(BLOOD_RED, 0.5);
  }
  return avg;
}

export function getGeometryYBounds(geometry: THREE.BufferGeometry): { minY: number; maxY: number } {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr) return { minY: 0, maxY: 0.5 };
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minY, maxY };
}

/** Position a stain mesh at a vertex + normal offset from a geometry */
function positionStainFromGeometry(
  stainMesh: THREE.Mesh,
  posAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  nrmAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null,
  idx: number,
  normalOffset: number,
): void {
  // Clamp index to current geometry's vertex count (frames may differ slightly)
  const safeIdx = idx % posAttr.count;
  const vx = posAttr.getX(safeIdx);
  const vy = posAttr.getY(safeIdx);
  const vz = posAttr.getZ(safeIdx);

  let nx = 0, ny = 0, nz = 0;
  if (nrmAttr && safeIdx < nrmAttr.count) {
    nx = nrmAttr.getX(safeIdx);
    ny = nrmAttr.getY(safeIdx);
    nz = nrmAttr.getZ(safeIdx);
  }

  stainMesh.position.set(vx + nx * normalOffset, vy + ny * normalOffset, vz + nz * normalOffset);
}

/** Random blood color — varies between dark red, maroon, and brighter red */
function randBloodColor(): THREE.Color {
  const base = Math.random();
  if (base < 0.4) return BLOOD_RED.clone().lerp(BLOOD_DARK, Math.random() * 0.5);
  if (base < 0.7) return BLOOD_MAROON.clone().lerp(BLOOD_RED, Math.random() * 0.5);
  return BLOOD_BRIGHT.clone().lerp(BLOOD_RED, 0.3 + Math.random() * 0.4);
}

// ── GoreSystem ──────────────────────────────────────────────────────

/** Optional: (x, z) => floor normal at that point; used to align blood splats to terrain. */
export type GetFloorNormal = (x: number, z: number) => THREE.Vector3;
/** Optional: (x, z) => terrain height; used so falling gore lands on actual terrain. */
export type GetTerrainY = (x: number, z: number) => number;

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const CHUNK_REST_SKIN = 0.02;

export class GoreSystem {
  private chunks: GoreChunk[] = [];
  private stains: BloodStain[] = [];
  private floorSplats: FloorSplat[] = [];
  private wallSplats: WallSplat[] = [];
  private readonly scene: THREE.Scene;
  private readonly getFloorNormal: GetFloorNormal | null;
  private readonly getTerrainY: GetTerrainY | null;
  private isOpenCell: ((wx: number, wz: number) => boolean) | null = null;
  private readonly chunkGeo = new THREE.BoxGeometry(1, 1, 1);
  private readonly splatGeo: THREE.PlaneGeometry;

  constructor(
    scene: THREE.Scene,
    getFloorNormal?: GetFloorNormal | null,
    getTerrainY?: GetTerrainY | null,
  ) {
    this.scene = scene;
    this.getFloorNormal = getFloorNormal ?? null;
    this.getTerrainY = getTerrainY ?? null;
    this.splatGeo = new THREE.PlaneGeometry(1, 1);
    this.splatGeo.rotateX(-Math.PI / 2);
  }

  setOpenCellCheck(fn: (wx: number, wz: number) => boolean): void {
    this.isOpenCell = fn;
  }

  // ── Death gore (full explosion on kill) ───────────────────────────

  spawnGore(
    mesh: THREE.Mesh,
    groundY: number,
    nearbyCharacters?: Character[],
    knockbackDirX = 0,
    knockbackDirZ = 0,
  ): void {
    const pos = mesh.position;
    const geometry = mesh.geometry;
    const { minY, maxY } = getGeometryYBounds(geometry);
    const height = maxY - minY;
    if (height < 0.01) return;

    // Body part chunks (slightly larger for visibility)
    const bands: Array<[number, number, number, number, number]> = [
      [0.80, 1.00, 1, 0.032, 0.058],
      [0.40, 0.80, 1, 0.045, 0.082],
      [0.50, 0.80, Math.random() < 0.6 ? 1 : 2, 0.026, 0.052],
      [0.00, 0.35, 1 + Math.floor(Math.random() * 2), 0.032, 0.065],
    ];

    for (const [startFrac, endFrac, count, sizeMin, sizeMax] of bands) {
      const yMin = minY + height * startFrac;
      const yMax = minY + height * endFrac;
      const color = sampleVertexColors(geometry, yMin, yMax);
      for (let i = 0; i < count; i++) {
        this.spawnChunk(
          pos.x, pos.y + (yMin + yMax) * 0.5, pos.z,
          groundY, color,
          sizeMin, sizeMax, 1.3 + Math.random() * 1.5, 3.0 + Math.random() * 1.0,
          knockbackDirX, knockbackDirZ,
        );
      }
    }

    // Blood droplets — slightly fewer, less ejection speed
    const bloodCount = 8 + Math.floor(Math.random() * 6);
    for (let i = 0; i < bloodCount; i++) {
      this.spawnChunk(
        pos.x, pos.y + height * (0.1 + Math.random() * 0.5), pos.z,
        groundY, randBloodColor(),
        0.01, 0.032, 1.2 + Math.random() * 2.2, 1.0 + Math.random() * 0.8,
        knockbackDirX, knockbackDirZ,
      );
    }

    // Floor splats — biased toward knockback direction
    const splatCount = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < splatCount; i++) {
      const dist = Math.random() * 0.35;
      const angle = Math.random() * Math.PI * 2;
      this.spawnFloorSplat(
        pos.x + Math.cos(angle) * dist + knockbackDirX * dist * 0.8,
        groundY + 0.005,
        pos.z + Math.sin(angle) * dist + knockbackDirZ * dist * 0.8,
      );
    }

    // Blood stains on nearby characters (player gets bloody)
    if (nearbyCharacters) {
      for (const char of nearbyCharacters) {
        if (!char.isAlive) continue;
        const dx = char.mesh.position.x - pos.x;
        const dz = char.mesh.position.z - pos.z;
        const distSq = dx * dx + dz * dz;
        if (distSq > 2.5 * 2.5) continue; // within 2.5m
        // More stains the closer you are
        const proximity = 1 - Math.sqrt(distSq) / 2.5;
        const stainCount = 5 + Math.floor(proximity * 12);
        this.spawnStainsOnCharacter(char.mesh, stainCount);
      }
    }
  }

  // ── On-hit blood splash (smaller, on each melee/projectile hit) ───

  spawnBloodSplash(
    x: number, y: number, z: number,
    groundY: number,
    nearbyCharacters?: Character[],
  ): void {
    // Small blood droplets flying from impact point (slightly larger)
    const count = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      this.spawnChunk(
        x, y + 0.1 + Math.random() * 0.2, z,
        groundY, randBloodColor(),
        0.008, 0.024, 1.5 + Math.random() * 2.5, 0.6 + Math.random() * 0.5,
      );
    }

    // 1-2 tiny floor splats at impact
    const splatCount = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < splatCount; i++) {
      this.spawnFloorSplat(
        x + (Math.random() - 0.5) * 0.2,
        groundY + 0.005,
        z + (Math.random() - 0.5) * 0.2,
      );
    }

    // Stain nearby characters
    if (nearbyCharacters) {
      const SPLASH_RADIUS = 1.5;
      for (const char of nearbyCharacters) {
        const cx = char.mesh.position.x, cz = char.mesh.position.z;
        const dx = cx - x, dz = cz - z;
        if (dx * dx + dz * dz < SPLASH_RADIUS * SPLASH_RADIUS) {
          const stainCount = 1 + Math.floor(Math.random() * 2);
          this.spawnStainsOnCharacter(char.mesh, stainCount);
        }
      }
    }
  }

  // ── Blood stains on character meshes ──────────────────────────────

  private spawnStainsOnCharacter(parentMesh: THREE.Mesh, count: number): void {
    const geo = parentMesh.geometry;
    const posAttr = geo.getAttribute('position');
    const nrmAttr = geo.getAttribute('normal');
    if (!posAttr || posAttr.count === 0) return;

    for (let i = 0; i < count; i++) {
      this.spawnStainAtVertex(parentMesh, posAttr, nrmAttr);
    }
  }

  private spawnStainAtVertex(
    parent: THREE.Mesh,
    posAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    nrmAttr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null,
  ): void {
    // Enforce cap
    while (this.stains.length >= MAX_STAINS) {
      const old = this.stains.shift()!;
      old.parent.remove(old.mesh);
      (old.mesh.material as THREE.Material).dispose();
    }

    // Pick a random vertex from the actual geometry
    const idx = Math.floor(Math.random() * posAttr.count);
    const normalOffset = 0.003 + Math.random() * 0.004;

    // Tiny blood cube
    const size = 0.008 + Math.random() * 0.016;
    const mat = new THREE.MeshStandardMaterial({
      color: randBloodColor(),
      roughness: 0.6,
      metalness: 0.2,
      transparent: true,
      opacity: 0.7 + Math.random() * 0.3,
    });

    const mesh = new THREE.Mesh(this.chunkGeo, mat);
    mesh.scale.set(size, size * (0.3 + Math.random() * 0.7), size);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

    // Position from current geometry
    positionStainFromGeometry(mesh, posAttr, nrmAttr, idx, normalOffset);

    parent.add(mesh);
    const lifetime = randGoreLifetime();
    this.stains.push({
      mesh, parent, vertexIndex: idx, normalOffset,
      age: 0,
      lifetime,
    });
  }

  // ── Flying gore chunks ────────────────────────────────────────────

  spawnChunk(
    x: number, y: number, z: number,
    groundY: number,
    color: THREE.Color,
    sizeMin: number, sizeMax: number,
    ejectSpeed: number,
    _lifetimeHint: number,
    knockbackDirX = 0,
    knockbackDirZ = 0,
    noWallStick = false,
  ): void {
    while (this.chunks.length >= MAX_CHUNKS) {
      const old = this.chunks.shift()!;
      this.scene.remove(old.mesh);
      (old.mesh.material as THREE.Material).dispose();
    }

    const sx = sizeMin + Math.random() * (sizeMax - sizeMin);
    const sy = sizeMin + Math.random() * (sizeMax - sizeMin);
    const sz = sizeMin + Math.random() * (sizeMax - sizeMin);

    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.15,
      transparent: true,
      opacity: 1,
    });

    const mesh = new THREE.Mesh(this.chunkGeo, mat);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, y, z);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    mesh.castShadow = true;
    this.scene.add(mesh);

    // Radial ejection — biased toward knockback direction
    const angle = Math.random() * Math.PI * 2;
    let vx = Math.cos(angle) * ejectSpeed;
    let vz = Math.sin(angle) * ejectSpeed;
    // Gentle bias toward knockback direction
    const kbStrength = ejectSpeed * 0.9;
    vx += knockbackDirX * kbStrength;
    vz += knockbackDirZ * kbStrength;
    const vel = new THREE.Vector3(
      vx,
      1.5 + Math.random() * 2.5,
      vz,
    );

    const avgSize = (sx + sy + sz) / 3;
    const lifetime = randGoreLifetime();
    this.chunks.push({ mesh, vel, groundY, age: 0, lifetime, bounced: false, size: avgSize, noWallStick });
  }

  // ── Floor splats (tiny puddles) ───────────────────────────────────

  private spawnFloorSplat(x: number, y: number, z: number): void {
    while (this.floorSplats.length >= MAX_FLOOR_SPLATS) {
      const old = this.floorSplats.shift()!;
      this.scene.remove(old.mesh);
      (old.mesh.material as THREE.Material).dispose();
    }

    const size = 0.06 + Math.random() * 0.12;
    const opacity = 0.5 + Math.random() * 0.3;

    // Flat sprite overlay
    const mat = new THREE.MeshBasicMaterial({
      color: randBloodColor(),
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(this.splatGeo, mat);
    const scaleX = size * (0.6 + Math.random() * 0.8);
    const scaleZ = size * (0.6 + Math.random() * 0.8);
    mesh.scale.set(scaleX, 1, scaleZ);
    mesh.position.set(x, y, z);
    if (this.getFloorNormal) {
      const normal = this.getFloorNormal(x, z).clone().normalize();
      mesh.quaternion.setFromUnitVectors(WORLD_UP, normal);
    }
    mesh.rotateY(Math.random() * Math.PI * 2);
    this.scene.add(mesh);

    this.floorSplats.push({ mesh, age: 0, lifetime: randGoreLifetime(), startOpacity: opacity });

    // 1-3 tiny blood cubes flattened on the floor next to the splat
    const cubeCount = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < cubeCount; i++) {
      this.spawnFloorCube(
        x + (Math.random() - 0.5) * size * 1.2,
        y + 0.003,
        z + (Math.random() - 0.5) * size * 1.2,
      );
    }
  }

  private spawnFloorCube(x: number, y: number, z: number): void {
    while (this.floorSplats.length >= MAX_FLOOR_SPLATS) {
      const old = this.floorSplats.shift()!;
      this.scene.remove(old.mesh);
      (old.mesh.material as THREE.Material).dispose();
    }

    const w = 0.008 + Math.random() * 0.02;
    const h = 0.003 + Math.random() * 0.006; // very flat
    const d = 0.008 + Math.random() * 0.02;

    const mat = new THREE.MeshStandardMaterial({
      color: randBloodColor(),
      roughness: 0.5,
      metalness: 0.2,
      transparent: true,
      opacity: 0.7 + Math.random() * 0.3,
    });

    const mesh = new THREE.Mesh(this.chunkGeo, mat);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    if (this.getFloorNormal) {
      const normal = this.getFloorNormal(x, z).clone().normalize();
      mesh.quaternion.setFromUnitVectors(WORLD_UP, normal);
    }
    mesh.rotateY(Math.random() * Math.PI * 2);
    this.scene.add(mesh);

    this.floorSplats.push({ mesh, age: 0, lifetime: randGoreLifetime(), startOpacity: (mat as THREE.MeshStandardMaterial).opacity });
  }

  // ── Wall splats (blood stuck to walls) ───────────────────────────

  private spawnWallSplat(x: number, y: number, z: number, normalX: number, normalZ: number, color: THREE.Color, size: number): void {
    while (this.wallSplats.length >= MAX_WALL_SPLATS) {
      const old = this.wallSplats.shift()!;
      this.scene.remove(old.mesh);
      (old.mesh.material as THREE.Material).dispose();
    }

    const opacity = 0.5 + Math.random() * 0.4;
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(this.splatGeo, mat);
    const scaleX = size * (0.5 + Math.random() * 0.8);
    const scaleY = size * (0.8 + Math.random() * 1.2); // drip tendency
    mesh.scale.set(scaleX, 1, scaleY);

    // Position slightly off the wall surface
    mesh.position.set(x + normalX * 0.005, y, z + normalZ * 0.005);

    // Orient to face outward from wall
    const wallNormal = new THREE.Vector3(normalX, 0, normalZ).normalize();
    mesh.quaternion.setFromUnitVectors(WORLD_UP, wallNormal);
    mesh.rotateOnAxis(wallNormal, Math.random() * Math.PI * 2);

    this.scene.add(mesh);
    this.wallSplats.push({ mesh, age: 0, lifetime: randGoreLifetime(), startOpacity: opacity });

    // 1-2 tiny blood cubes stuck to the wall
    const cubeCount = 1 + Math.floor(Math.random() * 2);
    for (let c = 0; c < cubeCount; c++) {
      this.spawnWallCube(
        x + normalX * 0.006 + (Math.random() - 0.5) * size * 0.5,
        y + (Math.random() - 0.5) * size * 0.8,
        z + normalZ * 0.006 + (Math.random() - 0.5) * size * 0.5,
      );
    }
  }

  private spawnWallCube(x: number, y: number, z: number): void {
    while (this.wallSplats.length >= MAX_WALL_SPLATS) {
      const old = this.wallSplats.shift()!;
      this.scene.remove(old.mesh);
      (old.mesh.material as THREE.Material).dispose();
    }

    const w = 0.006 + Math.random() * 0.016;
    const h = 0.006 + Math.random() * 0.016;
    const d = 0.003 + Math.random() * 0.005;

    const mat = new THREE.MeshStandardMaterial({
      color: randBloodColor(),
      roughness: 0.5,
      metalness: 0.2,
      transparent: true,
      opacity: 0.7 + Math.random() * 0.3,
    });

    const mesh = new THREE.Mesh(this.chunkGeo, mat);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    this.scene.add(mesh);

    this.wallSplats.push({ mesh, age: 0, lifetime: randGoreLifetime(), startOpacity: (mat as THREE.MeshStandardMaterial).opacity });
  }

  // ── Update ────────────────────────────────────────────────────────

  update(dt: number): void {
    this.updateChunks(dt);
    this.updateStains(dt);
    this.updateFloorSplats(dt);
    this.updateWallSplats(dt);
  }

  private updateChunks(dt: number): void {
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const chunk = this.chunks[i];
      chunk.age += dt;

      if (chunk.age >= chunk.lifetime) {
        this.scene.remove(chunk.mesh);
        (chunk.mesh.material as THREE.Material).dispose();
        this.chunks.splice(i, 1);
        continue;
      }

      const dragFactor = Math.exp(-CHUNK_DRAG * dt);
      chunk.vel.x *= dragFactor;
      chunk.vel.z *= dragFactor;
      chunk.vel.y -= CHUNK_GRAVITY * dt;

      const oldX = chunk.mesh.position.x;
      const oldZ = chunk.mesh.position.z;
      chunk.mesh.position.x += chunk.vel.x * dt;
      chunk.mesh.position.y += chunk.vel.y * dt;
      chunk.mesh.position.z += chunk.vel.z * dt;

      // Wall collision — stick to wall as a splat (gore) or bounce off (prop debris)
      if (this.isOpenCell && chunk.vel.lengthSq() > 0.1) {
        const newX = chunk.mesh.position.x;
        const newZ = chunk.mesh.position.z;
        if (!this.isOpenCell(newX, newZ)) {
          const xBlocked = !this.isOpenCell(newX, oldZ);
          const zBlocked = !this.isOpenCell(oldX, newZ);

          if (chunk.noWallStick) {
            // Bounce off wall instead of sticking
            if (xBlocked && !zBlocked) {
              chunk.mesh.position.x = oldX;
              chunk.vel.x *= -0.3;
            } else if (zBlocked && !xBlocked) {
              chunk.mesh.position.z = oldZ;
              chunk.vel.z *= -0.3;
            } else {
              chunk.mesh.position.x = oldX;
              chunk.mesh.position.z = oldZ;
              chunk.vel.x *= -0.3;
              chunk.vel.z *= -0.3;
            }
          } else {
            // Determine which axis hit the wall for splat orientation
            let normalX = 0, normalZ = 0;
            if (xBlocked && !zBlocked) {
              normalX = chunk.vel.x > 0 ? -1 : 1;
              chunk.mesh.position.x = oldX;
            } else if (zBlocked && !xBlocked) {
              normalZ = chunk.vel.z > 0 ? -1 : 1;
              chunk.mesh.position.z = oldZ;
            } else {
              normalX = chunk.vel.x > 0 ? -1 : 1;
              chunk.mesh.position.x = oldX;
              chunk.mesh.position.z = oldZ;
            }

            // Spawn wall splat at impact point
            const color = ((chunk.mesh.material as THREE.MeshStandardMaterial).color ?? BLOOD_RED).clone();
            const splatSize = 0.04 + chunk.size * 2.5;
            this.spawnWallSplat(
              chunk.mesh.position.x, chunk.mesh.position.y, chunk.mesh.position.z,
              normalX, normalZ, color, splatSize,
            );

            // Remove the chunk — it became a wall splat
            this.scene.remove(chunk.mesh);
            (chunk.mesh.material as THREE.Material).dispose();
            this.chunks.splice(i, 1);
            continue;
          }
        }
      }

      chunk.mesh.rotation.x += chunk.vel.x * dt * 4;
      chunk.mesh.rotation.z += chunk.vel.z * dt * 4;

      const x = chunk.mesh.position.x;
      const z = chunk.mesh.position.z;
      let groundY = this.getTerrainY ? this.getTerrainY(x, z) : chunk.groundY;
      // Box terrain (e.g. voxel dungeon) returns wall *tops* when (x,z) is in a wall footprint, causing gore to float. Cap to spawn floor + margin.
      const maxGroundY = chunk.groundY + 0.4;
      if (groundY > maxGroundY) groundY = chunk.groundY;
      const restY = groundY + CHUNK_REST_SKIN;

      if (chunk.mesh.position.y <= restY) {
        chunk.mesh.position.y = restY;
        const impactSpeed = Math.abs(chunk.vel.y);
        if (!chunk.bounced) {
          chunk.bounced = true;
          chunk.vel.y *= CHUNK_BOUNCE_Y;
          chunk.vel.x *= CHUNK_BOUNCE_XZ;
          chunk.vel.z *= CHUNK_BOUNCE_XZ;
        } else {
          chunk.vel.set(0, 0, 0);
        }
      }
      // Keep landed chunks snapped to terrain (slopes, stairs, etc.); use same cap so we don't push to wall tops
      if (chunk.bounced && chunk.vel.lengthSq() < 1e-6 && this.getTerrainY) {
        let snapY = this.getTerrainY(x, z);
        if (snapY > maxGroundY) snapY = chunk.groundY;
        chunk.mesh.position.y = snapY + CHUNK_REST_SKIN;
      }

      const fadeStart = chunk.lifetime * 0.6;
      if (chunk.age > fadeStart) {
        const fadeT = (chunk.age - fadeStart) / (chunk.lifetime - fadeStart);
        (chunk.mesh.material as THREE.MeshStandardMaterial).opacity = 1 - fadeT;
      }
    }
  }

  private updateStains(dt: number): void {
    for (let i = this.stains.length - 1; i >= 0; i--) {
      const stain = this.stains[i];
      stain.age += dt;

      // Remove if parent was disposed or lifetime expired
      if (stain.age >= stain.lifetime || !stain.parent.parent) {
        if (stain.parent.parent) stain.parent.remove(stain.mesh);
        (stain.mesh.material as THREE.Material).dispose();
        this.stains.splice(i, 1);
        continue;
      }

      // Re-read vertex position from the current geometry frame
      try {
        const geo = stain.parent.geometry;
        if (geo) {
          const posAttr = geo.getAttribute('position');
          const nrmAttr = geo.getAttribute('normal');
          if (posAttr && posAttr.count > 0) {
            positionStainFromGeometry(stain.mesh, posAttr, nrmAttr, stain.vertexIndex, stain.normalOffset);
          }
        }
      } catch {
        // Geometry was disposed or swapped — just keep stain at last position
      }

      // Fade in last 30% of lifetime
      const fadeStart = stain.lifetime * 0.7;
      if (stain.age > fadeStart) {
        const fadeT = (stain.age - fadeStart) / (stain.lifetime - fadeStart);
        (stain.mesh.material as THREE.MeshStandardMaterial).opacity = 0.75 * (1 - fadeT);
      }
    }
  }

  private updateFloorSplats(dt: number): void {
    for (let i = this.floorSplats.length - 1; i >= 0; i--) {
      const splat = this.floorSplats[i];
      splat.age += dt;

      if (splat.age >= splat.lifetime) {
        this.scene.remove(splat.mesh);
        (splat.mesh.material as THREE.Material).dispose();
        this.floorSplats.splice(i, 1);
        continue;
      }

      const fadeStart = splat.lifetime * 0.6;
      if (splat.age > fadeStart) {
        const fadeT = (splat.age - fadeStart) / (splat.lifetime - fadeStart);
        (splat.mesh.material as THREE.MeshBasicMaterial).opacity = splat.startOpacity * (1 - fadeT);
      }
    }
  }

  private updateWallSplats(dt: number): void {
    for (let i = this.wallSplats.length - 1; i >= 0; i--) {
      const splat = this.wallSplats[i];
      splat.age += dt;

      if (splat.age >= splat.lifetime) {
        this.scene.remove(splat.mesh);
        (splat.mesh.material as THREE.Material).dispose();
        this.wallSplats.splice(i, 1);
        continue;
      }

      const fadeStart = splat.lifetime * 0.6;
      if (splat.age > fadeStart) {
        const fadeT = (splat.age - fadeStart) / (splat.lifetime - fadeStart);
        (splat.mesh.material as THREE.MeshBasicMaterial).opacity = splat.startOpacity * (1 - fadeT);
      }
    }
  }

  // ── Dispose ───────────────────────────────────────────────────────

  dispose(): void {
    for (const chunk of this.chunks) {
      this.scene.remove(chunk.mesh);
      (chunk.mesh.material as THREE.Material).dispose();
    }
    this.chunks = [];

    for (const stain of this.stains) {
      stain.parent.remove(stain.mesh);
      (stain.mesh.material as THREE.Material).dispose();
    }
    this.stains = [];

    for (const splat of this.floorSplats) {
      this.scene.remove(splat.mesh);
      (splat.mesh.material as THREE.Material).dispose();
    }
    this.floorSplats = [];

    for (const splat of this.wallSplats) {
      this.scene.remove(splat.mesh);
      (splat.mesh.material as THREE.Material).dispose();
    }
    this.wallSplats = [];

    this.chunkGeo.dispose();
    this.splatGeo.dispose();
  }
}
