import * as THREE from 'three';
import type { AABBBox } from './pathfinding/NavGrid';
import { WORLD_SIZE, EARTHY_COLORS } from './GameConstants';
import { patchWorldRevealMaterial } from './shaders/WorldReveal';
import { useGameStore } from '../store';
import { MergedMesh } from './MergedMesh';

export class ObstacleGenerator {
  obstacles: AABBBox[] = [];
  colors: number[] = [];
  meshes: THREE.Mesh[] = [];
  private merged = new MergedMesh();

  constructor(private scene: THREE.Scene) {}

  /** Get the max existing surface height at a world position */
  private getSurfaceAt(wx: number, wz: number): number {
    const EPS = 0.01;
    let h = 0;
    for (const box of this.obstacles) {
      if (
        Math.abs(wx - box.x) < box.halfW + EPS &&
        Math.abs(wz - box.z) < box.halfD + EPS
      ) {
        h = Math.max(h, box.height);
      }
    }
    return h;
  }

  /** Place a box that stacks on existing geometry (Tetris/Lego style).
   *  The mesh only covers the new portion; the AABBBox height is the full column. */
  placeBox(
    x: number,
    z: number,
    halfW: number,
    halfD: number,
    height: number,
    color: number,
  ): void {
    const baseY = this.getSurfaceAt(x, z);
    const totalH = baseY + height;
    const box: AABBBox = { x, z, halfW, halfD, height: totalH };
    this.obstacles.push(box);
    this.colors.push(color);
    // Mesh covers only the new portion (sits on top of existing)
    const geo = new THREE.BoxGeometry(halfW * 2, height, halfD * 2);
    geo.translate(0, baseY + height / 2, 0);
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.85,
      metalness: 0.05,
    });
    patchWorldRevealMaterial(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.meshes.push(mesh);
  }

  /** Random grid position avoiding center clear zone */
  private randGridPos(
    cs: number,
    clearRadius: number,
  ): { gx: number; gz: number } {
    const gridHalf = Math.floor(WORLD_SIZE / cs / 2) - 2;
    let gx: number, gz: number;
    do {
      gx = Math.floor((Math.random() - 0.5) * gridHalf * 2);
      gz = Math.floor((Math.random() - 0.5) * gridHalf * 2);
    } while (
      Math.abs(gx * cs) < clearRadius &&
      Math.abs(gz * cs) < clearRadius
    );
    return { gx, gz };
  }

  generateObstacles(gridCellSize: number): void {
    const store = useGameStore.getState();
    const snap = store.obstacleSnap;
    const stepH = store.charStepUp;
    const cs = gridCellSize;
    const clearRadius = cs * 3;

    // ── Compound shapes: L, U, T, +, corridors ──
    const shapeCount = 4 + Math.floor(Math.random() * 4); // 4-7 compound shapes
    for (let s = 0; s < shapeCount; s++) {
      const color =
        EARTHY_COLORS[Math.floor(Math.random() * EARTHY_COLORS.length)];
      const height = 1.2 + Math.random() * 1.5;
      const shape = Math.floor(Math.random() * 5); // 0=L, 1=U, 2=T, 3=+, 4=corridor
      const { gx: ox, gz: oz } = this.randGridPos(cs, clearRadius);
      const rot = Math.floor(Math.random() * 4);

      let cells: { dx: number; dz: number }[] = [];
      const armLen = 3 + Math.floor(Math.random() * 4);
      const armLen2 = 3 + Math.floor(Math.random() * 3);

      if (shape === 0) {
        for (let i = 0; i < armLen; i++) cells.push({ dx: i, dz: 0 });
        for (let i = 1; i < armLen2; i++) cells.push({ dx: 0, dz: i });
      } else if (shape === 1) {
        for (let i = 0; i < armLen; i++) {
          cells.push({ dx: 0, dz: i });
          cells.push({ dx: 3, dz: i });
        }
        cells.push({ dx: 1, dz: 0 });
        cells.push({ dx: 2, dz: 0 });
      } else if (shape === 2) {
        const barLen = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < barLen; i++) cells.push({ dx: i, dz: 0 });
        const mid = Math.floor(barLen / 2);
        for (let i = 1; i < armLen; i++) cells.push({ dx: mid, dz: i });
      } else if (shape === 3) {
        const arm = 2 + Math.floor(Math.random() * 2);
        for (let i = -arm; i <= arm; i++) {
          cells.push({ dx: i, dz: 0 });
          if (i !== 0) cells.push({ dx: 0, dz: i });
        }
      } else {
        const wallLen = 5 + Math.floor(Math.random() * 6);
        for (let i = 0; i < wallLen; i++) cells.push({ dx: i, dz: 0 });
      }

      if (rot > 0) {
        cells = cells.map(({ dx, dz }) => {
          if (rot === 1) return { dx: -dz, dz: dx };
          if (rot === 2) return { dx: -dx, dz: -dz };
          return { dx: dz, dz: -dx };
        });
      }

      for (const { dx, dz } of cells) {
        const cx = (ox + dx) * cs + cs * 0.5;
        const cz = (oz + dz) * cs + cs * 0.5;
        this.placeBox(cx, cz, cs * 0.5, cs * 0.5, height, color);
      }
    }

    // ── Large solid blocks (rooms/pillars) ──
    const blockCount = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < blockCount; i++) {
      const color =
        EARTHY_COLORS[Math.floor(Math.random() * EARTHY_COLORS.length)];
      const height = 1 + Math.random() * 2;
      const cellsW = 2 + Math.floor(Math.random() * 4);
      const cellsD = 2 + Math.floor(Math.random() * 4);
      const { gx, gz } = this.randGridPos(cs, clearRadius);

      if (snap) {
        const halfW = cellsW * cs * 0.5;
        const halfD = cellsD * cs * 0.5;
        const x = gx * cs + (cellsW % 2 === 0 ? 0 : cs * 0.5);
        const z = gz * cs + (cellsD % 2 === 0 ? 0 : cs * 0.5);
        this.placeBox(x, z, halfW, halfD, height, color);
      } else {
        const halfW = 1 + Math.random() * 3;
        const halfD = 1 + Math.random() * 3;
        const x = gx * cs;
        const z = gz * cs;
        this.placeBox(x, z, halfW, halfD, height, color);
      }
    }

    // ── Staircases (triangle shape, each row one stepHeight taller) ──
    const stairCells = new Set<string>();
    const stairCount = 3 + Math.floor(Math.random() * 4);
    for (let s = 0; s < stairCount; s++) {
      const color =
        EARTHY_COLORS[Math.floor(Math.random() * EARTHY_COLORS.length)];
      const stairSteps = 3 + Math.floor(Math.random() * 4);
      const { gx: ox, gz: oz } = this.randGridPos(cs, clearRadius);
      const rot = Math.floor(Math.random() * 4);

      for (let row = 0; row < stairSteps; row++) {
        const h = (row + 1) * stepH;
        const width = stairSteps - row;
        for (let col = 0; col < width; col++) {
          let dx = col - Math.floor(width / 2);
          let dz = row;
          if (rot === 1) {
            const tmp = dx;
            dx = -dz;
            dz = tmp;
          } else if (rot === 2) {
            dx = -dx;
            dz = -dz;
          } else if (rot === 3) {
            const tmp = dx;
            dx = dz;
            dz = -tmp;
          }

          const cx = (ox + dx) * cs + cs * 0.5;
          const cz = (oz + dz) * cs + cs * 0.5;
          this.placeBox(cx, cz, cs * 0.5, cs * 0.5, h, color);
          for (let ddx = -2; ddx <= 2; ddx++) {
            for (let ddz = -2; ddz <= 2; ddz++) {
              stairCells.add(`${ox + dx + ddx},${oz + dz + ddz}`);
            }
          }
        }
      }
    }

    // ── Scattered debris (steppable + some blocking) ──
    const debrisCount = 8 + Math.floor(Math.random() * 8);
    for (let i = 0; i < debrisCount; i++) {
      const height =
        Math.random() < 0.6
          ? 0.05 + Math.random() * stepH * 0.9
          : stepH + 0.1 + Math.random() * 0.3;
      const color =
        EARTHY_COLORS[Math.floor(Math.random() * EARTHY_COLORS.length)];

      if (snap) {
        let gx: number, gz: number;
        let attempts = 0;
        do {
          gx = Math.floor((Math.random() - 0.5) * (WORLD_SIZE / cs - 4));
          gz = Math.floor((Math.random() - 0.5) * (WORLD_SIZE / cs - 4));
          attempts++;
        } while (stairCells.has(`${gx},${gz}`) && attempts < 20);
        if (attempts >= 20) continue;
        this.placeBox(
          gx * cs + cs * 0.5,
          gz * cs + cs * 0.5,
          cs * 0.5,
          cs * 0.5,
          height,
          color,
        );
      } else {
        const x = (Math.random() - 0.5) * (WORLD_SIZE - 4);
        const z = (Math.random() - 0.5) * (WORLD_SIZE - 4);
        this.placeBox(
          x,
          z,
          0.2 + Math.random() * 0.4,
          0.2 + Math.random() * 0.4,
          height,
          color,
        );
      }
    }
  }

  generateTerrain(gridCellSize: number): void {
    const store = useGameStore.getState();
    const stepH = store.charStepUp;
    const cs = gridCellSize;
    const gridHalf = Math.floor(WORLD_SIZE / cs / 2) - 1;

    // Height map on grid cells — seed from existing obstacles
    const heightMap = new Map<string, number>();
    const key = (gx: number, gz: number) => `${gx},${gz}`;

    for (const box of this.obstacles) {
      const gx = Math.round((box.x - cs * 0.5) / cs);
      const gz = Math.round((box.z - cs * 0.5) / cs);
      const existing = heightMap.get(key(gx, gz)) ?? 0;
      heightMap.set(key(gx, gz), Math.max(existing, box.height));
    }

    // ── 1. Generate platforms at various elevations (additive — on top of existing) ──
    const platformCount = 5 + Math.floor(Math.random() * 5);
    interface Platform {
      cx: number;
      cz: number;
      w: number;
      d: number;
      h: number;
    }
    const platforms: Platform[] = [];

    for (let i = 0; i < platformCount; i++) {
      const w = 3 + Math.floor(Math.random() * 5);
      const d = 3 + Math.floor(Math.random() * 5);
      const cx = Math.floor((Math.random() - 0.5) * (gridHalf * 2 - w));
      const cz = Math.floor((Math.random() - 0.5) * (gridHalf * 2 - d));
      const levels = 1 + Math.floor(Math.random() * 5);
      const h = levels * stepH;

      // Find the max existing height under this platform footprint
      let maxBase = 0;
      for (let gx = cx; gx < cx + w; gx++) {
        for (let gz = cz; gz < cz + d; gz++) {
          if (Math.abs(gx) > gridHalf || Math.abs(gz) > gridHalf) continue;
          maxBase = Math.max(maxBase, heightMap.get(key(gx, gz)) ?? 0);
        }
      }
      // Stack on top: platform height = base + own height
      const totalH = maxBase + h;
      platforms.push({ cx, cz, w, d, h: totalH });

      for (let gx = cx; gx < cx + w; gx++) {
        for (let gz = cz; gz < cz + d; gz++) {
          if (Math.abs(gx) > gridHalf || Math.abs(gz) > gridHalf) continue;
          const existing = heightMap.get(key(gx, gz)) ?? 0;
          heightMap.set(key(gx, gz), Math.max(existing, totalH));
        }
      }
    }

    // ── 2. Connect platforms with stair ramps ──
    for (let i = 0; i < platforms.length; i++) {
      const a = platforms[i];
      let bestJ = -1;
      let bestDist = Infinity;
      for (let j = 0; j < platforms.length; j++) {
        if (i === j) continue;
        const b = platforms[j];
        if (Math.abs(a.h - b.h) < 0.01) continue;
        const dx = a.cx + a.w / 2 - (b.cx + b.w / 2);
        const dz = a.cz + a.d / 2 - (b.cz + b.d / 2);
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < bestDist) {
          bestDist = dist;
          bestJ = j;
        }
      }
      if (bestJ < 0) continue;

      const b = platforms[bestJ];
      const acx = Math.round(a.cx + a.w / 2);
      const acz = Math.round(a.cz + a.d / 2);
      const bcx = Math.round(b.cx + b.w / 2);
      const bcz = Math.round(b.cz + b.d / 2);

      const lowH = Math.min(a.h, b.h);
      const highH = Math.max(a.h, b.h);
      const steps = Math.round((highH - lowH) / stepH);
      if (steps < 1) continue;

      const fromX = a.h < b.h ? acx : bcx;
      const fromZ = a.h < b.h ? acz : bcz;
      const toX = a.h < b.h ? bcx : acx;
      const toZ = a.h < b.h ? bcz : acz;

      const ddx = toX - fromX;
      const ddz = toZ - fromZ;
      const dist = Math.max(Math.abs(ddx), Math.abs(ddz));
      if (dist < 1) continue;

      const stairLen = Math.max(steps, dist);
      for (let s = 0; s <= stairLen; s++) {
        const t = s / stairLen;
        const gx = Math.round(fromX + ddx * t);
        const gz = Math.round(fromZ + ddz * t);
        if (Math.abs(gx) > gridHalf || Math.abs(gz) > gridHalf) continue;
        const stairH = lowH + (highH - lowH) * t;
        const quantH = Math.round(stairH / stepH) * stepH;
        const existing = heightMap.get(key(gx, gz)) ?? 0;
        heightMap.set(key(gx, gz), Math.max(existing, quantH));
      }
    }

    // ── 3. Entry ramps: every platform gets a staircase down to ground ──
    for (const plat of platforms) {
      const side = Math.floor(Math.random() * 4);
      let startGX: number, startGZ: number, dirGX: number, dirGZ: number;
      if (side === 0) {
        startGX = plat.cx + Math.floor(plat.w / 2);
        startGZ = plat.cz - 1;
        dirGX = 0;
        dirGZ = -1;
      } else if (side === 1) {
        startGX = plat.cx + Math.floor(plat.w / 2);
        startGZ = plat.cz + plat.d;
        dirGX = 0;
        dirGZ = 1;
      } else if (side === 2) {
        startGX = plat.cx - 1;
        startGZ = plat.cz + Math.floor(plat.d / 2);
        dirGX = -1;
        dirGZ = 0;
      } else {
        startGX = plat.cx + plat.w;
        startGZ = plat.cz + Math.floor(plat.d / 2);
        dirGX = 1;
        dirGZ = 0;
      }

      const stepsDown = Math.round(plat.h / stepH);
      for (let s = 0; s < stepsDown; s++) {
        const gx = startGX + dirGX * s;
        const gz = startGZ + dirGZ * s;
        if (Math.abs(gx) > gridHalf || Math.abs(gz) > gridHalf) break;
        const h = plat.h - s * stepH;
        if (h <= 0) break;
        const existing = heightMap.get(key(gx, gz)) ?? 0;
        heightMap.set(key(gx, gz), Math.max(existing, h));
      }
    }

    // ── 4. Add small debris/rubble around platforms for organic feel ──
    for (const plat of platforms) {
      const debrisCount = 2 + Math.floor(Math.random() * 4);
      for (let d = 0; d < debrisCount; d++) {
        const side = Math.floor(Math.random() * 4);
        let gx: number, gz: number;
        if (side === 0) {
          gx = plat.cx - 1 - Math.floor(Math.random() * 2);
          gz = plat.cz + Math.floor(Math.random() * plat.d);
        } else if (side === 1) {
          gx = plat.cx + plat.w + Math.floor(Math.random() * 2);
          gz = plat.cz + Math.floor(Math.random() * plat.d);
        } else if (side === 2) {
          gx = plat.cx + Math.floor(Math.random() * plat.w);
          gz = plat.cz - 1 - Math.floor(Math.random() * 2);
        } else {
          gx = plat.cx + Math.floor(Math.random() * plat.w);
          gz = plat.cz + plat.d + Math.floor(Math.random() * 2);
        }
        if (Math.abs(gx) > gridHalf || Math.abs(gz) > gridHalf) continue;
        const dh = stepH * (1 + Math.floor(Math.random() * 2));
        const h = Math.min(dh, plat.h);
        const existing = heightMap.get(key(gx, gz)) ?? 0;
        if (existing < h) heightMap.set(key(gx, gz), h);
      }
    }

    // ── 5. Place boxes from height map (only new/taller cells) ──
    const existingHeights = new Map<string, number>();
    for (const box of this.obstacles) {
      const gx = Math.round((box.x - cs * 0.5) / cs);
      const gz = Math.round((box.z - cs * 0.5) / cs);
      const k = key(gx, gz);
      existingHeights.set(k, Math.max(existingHeights.get(k) ?? 0, box.height));
    }

    const clearR = 2;
    for (const [k, h] of heightMap) {
      if (h <= 0) continue;
      const [gxStr, gzStr] = k.split(',');
      const gx = parseInt(gxStr);
      const gz = parseInt(gzStr);
      if (Math.abs(gx) <= clearR && Math.abs(gz) <= clearR) continue;
      // Only place if heightMap wants taller than what exists
      const existH = existingHeights.get(k) ?? 0;
      if (existH >= h - 0.01) continue;
      const wx = gx * cs + cs * 0.5;
      const wz = gz * cs + cs * 0.5;
      const tier = Math.round(h / stepH) - 1;
      const color = EARTHY_COLORS[tier % EARTHY_COLORS.length];
      // Place just the delta portion on top (placeBox handles stacking via getSurfaceAt,
      // but here we set the full target height directly since terrain uses absolute heights)
      const baseY = existH;
      const deltaH = h - baseY;
      if (deltaH < 0.01) continue;
      const box: AABBBox = {
        x: wx,
        z: wz,
        halfW: cs * 0.5,
        halfD: cs * 0.5,
        height: h,
      };
      this.obstacles.push(box);
      this.colors.push(color);
      const geo = new THREE.BoxGeometry(cs, deltaH, cs);
      geo.translate(0, baseY + deltaH / 2, 0);
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.85,
        metalness: 0.05,
      });
      patchWorldRevealMaterial(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(wx, 0, wz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  /** Merge all individual box meshes into a single mesh with vertex colors. */
  mergeMeshes(): void {
    const wrapper = this.merged.merge(this.meshes, this.scene, {
      roughness: 0.85, metalness: 0.05, receiveShadow: true,
    });
    this.meshes = wrapper ? [wrapper.children[0] as THREE.Mesh] : [];
  }

  /** Revert from merged state back to individual meshes.
   *  Recreates meshes from obstacles[]/colors[] data (source of truth). */
  unmerge(): void {
    if (!this.merged.isMerged) return;
    // Remove merged wrapper
    this.merged.clear(this.scene);
    // Remove any leftover individual meshes (added post-merge)
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.meshes = [];
    // Recreate individual meshes from data arrays
    for (let i = 0; i < this.obstacles.length; i++) {
      const obs = this.obstacles[i];
      if (obs.height <= 0) continue; // destroyed
      const color = this.colors[i];
      const geo = new THREE.BoxGeometry(obs.halfW * 2, obs.height, obs.halfD * 2);
      geo.translate(0, obs.height / 2, 0);
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.85,
        metalness: 0.05,
      });
      patchWorldRevealMaterial(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(obs.x, 0, obs.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
  }

  get isMerged(): boolean { return this.merged.isMerged; }

  /** Destroy an obstacle by index — zeroes its vertices in the merged buffer. */
  destroyObstacle(index: number): { x: number; z: number; height: number; halfW: number; halfD: number } | null {
    if (!this.merged.destroy(index)) return null;
    const obs = this.obstacles[index];
    return { x: obs.x, z: obs.z, height: obs.height, halfW: obs.halfW, halfD: obs.halfD };
  }

  isDestroyed(index: number): boolean { return this.merged.isDestroyed(index); }

  /** Find obstacle index at a world XZ position (topmost). Returns -1 if none. */
  getObstacleAt(wx: number, wz: number): number {
    const EPS = 0.01;
    let bestIdx = -1;
    let bestH = -1;
    for (let i = 0; i < this.obstacles.length; i++) {
      if (this.merged.isDestroyed(i)) continue;
      const box = this.obstacles[i];
      if (
        Math.abs(wx - box.x) < box.halfW + EPS &&
        Math.abs(wz - box.z) < box.halfD + EPS &&
        box.height > bestH
      ) {
        bestH = box.height;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  /** Dispose all meshes (merged + individual) and reset arrays */
  clear(): void {
    // Remove merged wrapper (if any)
    this.merged.clear(this.scene);
    // Remove any individual meshes (pre-merge or post-merge additions)
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else (mat as THREE.Material).dispose();
    }
    this.meshes = [];
    this.obstacles = [];
    this.colors = [];
  }
}
