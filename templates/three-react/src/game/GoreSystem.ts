import * as THREE from 'three';
import type { Character } from './character';

// ── Gore chunk (flying body parts + blood droplets) ─────────────────

interface GoreChunk {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  groundY: number;
  age: number;
  lifetime: number;
  bounced: boolean;
  size: number; // avg scale for sound volume
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

// ── Constants ───────────────────────────────────────────────────────

const MAX_CHUNKS = 60;
const MAX_STAINS = 120;
const MAX_FLOOR_SPLATS = 50;

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

function sampleVertexColors(
  geometry: THREE.BufferGeometry,
  yMin: number,
  yMax: number,
): THREE.Color {
  const posAttr = geometry.getAttribute('position');
  const colAttr = geometry.getAttribute('color');
  if (!posAttr || !colAttr) return BLOOD_RED.clone();

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
  if (n === 0) return BLOOD_RED.clone();
  const avg = new THREE.Color(r / n, g / n, b / n);
  avg.lerp(BLOOD_RED, 0.5);
  return avg;
}

function getGeometryYBounds(geometry: THREE.BufferGeometry): { minY: number; maxY: number } {
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
  private readonly scene: THREE.Scene;
  private readonly getFloorNormal: GetFloorNormal | null;
  private readonly getTerrainY: GetTerrainY | null;
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

  // ── Death gore (full explosion on kill) ───────────────────────────

  spawnGore(
    mesh: THREE.Mesh,
    groundY: number,
    nearbyCharacters?: Character[],
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
      );
    }

    // Floor splats — smaller radial spread
    const splatCount = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < splatCount; i++) {
      const dist = Math.random() * 0.35;
      const angle = Math.random() * Math.PI * 2;
      this.spawnFloorSplat(
        pos.x + Math.cos(angle) * dist,
        groundY + 0.005,
        pos.z + Math.sin(angle) * dist,
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
    attacker?: THREE.Mesh,
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

    // Stain the attacker (blood splashes back on you)
    if (attacker) {
      const stainCount = 2 + Math.floor(Math.random() * 3);
      this.spawnStainsOnCharacter(attacker, stainCount);
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

  private spawnChunk(
    x: number, y: number, z: number,
    groundY: number,
    color: THREE.Color,
    sizeMin: number, sizeMax: number,
    ejectSpeed: number,
    _lifetimeHint: number,
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

    // Radial ejection — random direction outward, no knockback bias
    const angle = Math.random() * Math.PI * 2;
    const vel = new THREE.Vector3(
      Math.cos(angle) * ejectSpeed,
      1.5 + Math.random() * 2.5,
      Math.sin(angle) * ejectSpeed,
    );

    const avgSize = (sx + sy + sz) / 3;
    const lifetime = randGoreLifetime();
    this.chunks.push({ mesh, vel, groundY, age: 0, lifetime, bounced: false, size: avgSize });
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

  // ── Update ────────────────────────────────────────────────────────

  update(dt: number): void {
    this.updateChunks(dt);
    this.updateStains(dt);
    this.updateFloorSplats(dt);
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

      chunk.mesh.position.x += chunk.vel.x * dt;
      chunk.mesh.position.y += chunk.vel.y * dt;
      chunk.mesh.position.z += chunk.vel.z * dt;

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

    this.chunkGeo.dispose();
    this.splatGeo.dispose();
  }
}
