/**
 * BoxPlacer — box-based debris and ramp placement.
 *
 * Only used by the `basic` terrain preset (boxy mode).
 * Not used by `heightmap` or dungeon presets.
 *
 * Responsibilities:
 *  - createScatteredDebris()  Place random boxes (150 by default) with 20% tall
 *                             walls, then add smart ramps to bridge drops.
 *  - placeBox()               Place a single axis-aligned box with z-fight
 *                             detection, grid overlay, and entity registration.
 *  - placeSmartRamps()        Scan existing boxes for elevation drops and place
 *                             wedge ramps (~45 deg) to make them navigable.
 *
 * Contains PRESET_CONFIGS (per-preset box generation rules) and wedge/ramp
 * geometry helpers (createWedgeGeometry, createSlopeGrid, createBoxGrid).
 *
 * Used by TerrainBuilder facade; not called directly by consumers.
 */

import * as THREE from 'three';
import { Entity, Layer } from '../core/Entity';
import type { SlopeDir } from '../pathfinding';
import { EnvironmentContext, type TerrainPreset } from '../environment/EnvironmentContext';
import { HALF, snapHalf, snapPos } from './TerrainBuilder';

// ── Private types/constants ──────────────────────────────────────────

interface TerrainPresetConfig {
  count: number;
  /** Generate width, depth, height for a single box. Receives index and total count. */
  generateBox(i: number, count: number): { w: number; d: number; h: number };
  /** Generate position. Receives box dims and half-ground extent. Return null to skip. */
  generatePos(w: number, d: number, h: number, halfGround: number, i: number, count: number): { x: number; z: number } | null;
  /** Spawn-area clear radius (boxes inside this radius from origin are skipped) */
  spawnClear: number;
}

const PRESET_CONFIGS: Record<TerrainPreset, TerrainPresetConfig> = {
  /** Basic scattered debris — mostly low rubble with 20% tall walls */
  basic: {
    count: 150,
    spawnClear: 1.5,
    generateBox() {
      const w = snapHalf(0.2 + Math.random() * 0.9);
      const d = snapHalf(0.2 + Math.random() * 0.9);
      const isTall = Math.random() < 0.2;
      const h = snapHalf(isTall ? 1 + Math.random() * 1.75 : 0.15 + Math.random() * 0.4);
      return { w, d, h };
    },
    generatePos(w, _d, _h, halfGround) {
      const x = snapPos((Math.random() - 0.5) * halfGround * 2, w / 2);
      const z = snapPos((Math.random() - 0.5) * halfGround * 2, w / 2);
      return { x, z };
    },
  },

  /** Noise-based heightmap terrain — real mesh via TerrainNoise */
  heightmap: {
    count: 0,
    spawnClear: 4,
    generateBox() { return { w: 1, d: 1, h: 0.5 }; },
    generatePos() { return null; },
  },

  /** Blocky VOX dungeon with full-cube wall tiles */
  voxelDungeon: {
    count: 0,
    spawnClear: 0,
    generateBox() { return { w: 1, d: 1, h: 0.5 }; },
    generatePos() { return null; },
  },

  /** Overworld — no scattered debris (tiles are built by OverworldMap) */
  overworld: {
    count: 0,
    spawnClear: 0,
    generateBox() { return { w: 1, d: 1, h: 0.5 }; },
    generatePos() { return null; },
  },
};

// ── BoxPlacer ────────────────────────────────────────────────────────

export class BoxPlacer {
  private ctx: EnvironmentContext;
  private getTerrainY: (x: number, z: number, radius?: number) => number;

  constructor(ctx: EnvironmentContext, getTerrainY: (x: number, z: number, radius?: number) => number) {
    this.ctx = ctx;
    this.getTerrainY = getTerrainY;
  }

  createScatteredDebris(): void {
    const config = PRESET_CONFIGS[this.ctx.preset];
    const { count, spawnClear } = config;
    const halfGround = this.ctx.groundSize / 2 - 2;

    for (let i = 0; i < count; i++) {
      const { w, d, h } = config.generateBox(i, count);
      const pos = config.generatePos(w, d, h, halfGround, i, count);
      if (!pos) continue;
      if (Math.abs(pos.x) < spawnClear && Math.abs(pos.z) < spawnClear) continue;
      this.placeBox(pos.x, pos.z, w, d, h);
    }

    this.placeSmartRamps(halfGround, spawnClear);
  }

  /** Place a single box into the world. Skips z-fighting overlaps unless skipZFight is set. */
  placeBox(x: number, z: number, w: number, d: number, h: number, skipZFight = false): boolean {
    const colors = [0x2a2a3e, 0x33334a, 0x252538, 0x1e1e30, 0x3a3a50];
    const hw = w / 2, hd = d / 2;

    if (!skipZFight) {
      const zFight = this.ctx.debris.some(b =>
        Math.abs(h - b.height) < 0.01 &&
        Math.abs(x - b.x) < hw + b.halfW &&
        Math.abs(z - b.z) < hd + b.halfD
      );
      if (zFight) return false;
    }

    const geo = new THREE.BoxGeometry(w, h, d);
    const color = colors[Math.floor(Math.random() * colors.length)];
    const variation = 0.85 + Math.random() * 0.3;
    const baseColor = new THREE.Color(color).multiplyScalar(variation);

    const mat = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.85,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    // Reveal shader is auto-applied via Architecture entity layer

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.ctx.boxGroup.add(mesh);

    const isWall = h > 0.2;
    const entity = new Entity(mesh, {
      layer: isWall ? Layer.Architecture : Layer.Prop,
      radius: Math.max(hw, hd),
      weight: Infinity,
    });
    this.ctx.debrisEntities.push(entity);

    const gridLines = this.createBoxGrid(w, h, d, baseColor);
    gridLines.position.copy(mesh.position);
    this.ctx.boxGroup.add(gridLines);

    this.ctx.debris.push({ x, z, halfW: hw, halfD: hd, height: h });
    return true;
  }

  // ── Private methods ────────────────────────────────────────────────

  /** Create 0.5m grid lines on box faces */
  private createBoxGrid(w: number, h: number, d: number, baseColor: THREE.Color): THREE.LineSegments {
    const points: number[] = [];
    const hw = w / 2, hh = h / 2, hd = d / 2;

    // Horizontal lines on +X and -X faces (YZ plane)
    for (let y = -hh; y <= hh + 0.001; y += HALF) {
      for (const fx of [-hw, hw]) {
        points.push(fx, y, -hd, fx, y, hd);
      }
    }
    for (let z = -hd; z <= hd + 0.001; z += HALF) {
      for (const fx of [-hw, hw]) {
        points.push(fx, -hh, z, fx, hh, z);
      }
    }

    // Horizontal lines on +Z and -Z faces (XY plane)
    for (let y = -hh; y <= hh + 0.001; y += HALF) {
      for (const fz of [-hd, hd]) {
        points.push(-hw, y, fz, hw, y, fz);
      }
    }
    for (let x = -hw; x <= hw + 0.001; x += HALF) {
      for (const fz of [-hd, hd]) {
        points.push(x, -hh, fz, x, hh, fz);
      }
    }

    // Grid on top face (+Y, XZ plane)
    for (let x = -hw; x <= hw + 0.001; x += HALF) {
      points.push(x, hh, -hd, x, hh, hd);
    }
    for (let z = -hd; z <= hd + 0.001; z += HALF) {
      points.push(-hw, hh, z, hw, hh, z);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    // Dark lines on light surfaces, light lines on dark surfaces
    const lum = baseColor.r * 0.299 + baseColor.g * 0.587 + baseColor.b * 0.114;
    const gridColor = lum > 0.25
      ? baseColor.clone().multiplyScalar(0.65)
      : baseColor.clone().multiplyScalar(1.4);
    const gridMat = new THREE.LineBasicMaterial({
      color: gridColor,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    return new THREE.LineSegments(geo, gridMat);
  }

  /** Create a wedge (ramp) geometry. slopeDir controls which edge is high. */
  private createWedgeGeometry(w: number, h: number, d: number, slopeDir: SlopeDir): THREE.BufferGeometry {
    const gw = (slopeDir === 1 || slopeDir === 3) ? d : w;
    const gd = (slopeDir === 1 || slopeDir === 3) ? w : d;
    const hw = gw / 2, hd = gd / 2;

    const positions = new Float32Array([
      -hw, 0, -hd,
       hw, 0, -hd,
       hw, 0,  hd,
      -hw, 0,  hd,
      -hw, h,  hd,
       hw, h,  hd,
    ]);

    const indices = [
      0, 2, 1,  0, 3, 2,
      0, 4, 5,  0, 5, 1,
      3, 2, 5,  3, 5, 4,
      0, 3, 4,
      1, 5, 2,
    ];

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);

    if (slopeDir !== 0) {
      const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
      geo.applyMatrix4(new THREE.Matrix4().makeRotationY(angles[slopeDir]));
    }

    geo.computeVertexNormals();
    return geo;
  }

  /** Create grid lines for a slope/ramp surface */
  private createSlopeGrid(w: number, h: number, d: number, slopeDir: SlopeDir, baseColor: THREE.Color): THREE.LineSegments {
    const gw = (slopeDir === 1 || slopeDir === 3) ? d : w;
    const gd = (slopeDir === 1 || slopeDir === 3) ? w : d;
    const hw = gw / 2, hd = gd / 2;
    const points: number[] = [];

    for (let z = -hd; z <= hd + 0.001; z += HALF) {
      const t = (z + hd) / (2 * hd);
      const y = t * h;
      points.push(-hw, y, z, hw, y, z);
    }
    for (let x = -hw; x <= hw + 0.001; x += HALF) {
      points.push(x, 0, -hd, x, h, hd);
    }
    for (let y = 0; y <= h + 0.001; y += HALF) {
      points.push(-hw, y, hd, hw, y, hd);
    }
    for (let x = -hw; x <= hw + 0.001; x += HALF) {
      points.push(x, 0, hd, x, h, hd);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));

    if (slopeDir !== 0) {
      const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
      geo.applyMatrix4(new THREE.Matrix4().makeRotationY(angles[slopeDir]));
    }

    const gridMat = new THREE.LineBasicMaterial({
      color: baseColor.clone().multiplyScalar(1.4),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    return new THREE.LineSegments(geo, gridMat);
  }

  /** Scan all boxes for edges with elevation drops and place ramps to bridge them. */
  private placeSmartRamps(halfGround: number, spawnClear: number): void {
    const probes: { dx: number; dz: number; slopeDir: SlopeDir }[] = [
      { dx:  1, dz:  0, slopeDir: 3 },
      { dx: -1, dz:  0, slopeDir: 1 },
      { dx:  0, dz:  1, slopeDir: 2 },
      { dx:  0, dz: -1, slopeDir: 0 },
    ];

    const boxes = [...this.ctx.debris];
    let rampsPlaced = 0;
    const MAX_RAMPS = 30;

    for (const box of boxes) {
      if (rampsPlaced >= MAX_RAMPS) break;
      if (box.height < 0.25 || box.height > 1.0) continue;
      if (box.slopeDir !== undefined) continue;

      for (const probe of probes) {
        if (rampsPlaced >= MAX_RAMPS) break;
        if (Math.random() > 0.4) continue;

        // Probe ahead to measure the drop first, then size ramp to match (~45°)
        const probeLen = 2.0; // max look-ahead
        const probeX = box.x + probe.dx * (box.halfW + probeLen / 2);
        const probeZ = box.z + probe.dz * (box.halfD + probeLen / 2);
        const probeLowY = this.getTerrainY(
          probeX + probe.dx * probeLen / 2,
          probeZ + probe.dz * probeLen / 2, 0.1);
        const estDrop = box.height - probeLowY;
        if (estDrop < 0.15 || estDrop > 1.25) continue;

        // Ramp length ~ drop for ~45° slope (snap to grid)
        const rampLen = snapHalf(Math.max(HALF, estDrop));
        const rampW = snapHalf(Math.min(
          probe.dx !== 0 ? box.halfD * 2 : box.halfW * 2,
          0.5 + Math.random() * 0.75,
        ));

        let rx: number, rz: number;
        let sizeAlongProbe: number, sizePerpProbe: number;
        if (probe.dx !== 0) {
          rx = box.x + probe.dx * (box.halfW + rampLen / 2);
          rz = box.z;
          sizeAlongProbe = rampLen;
          sizePerpProbe = rampW;
        } else {
          rx = box.x;
          rz = box.z + probe.dz * (box.halfD + rampLen / 2);
          sizeAlongProbe = rampLen;
          sizePerpProbe = rampW;
        }

        rx = snapPos(rx, (probe.dx !== 0 ? sizeAlongProbe : sizePerpProbe) / 2);
        rz = snapPos(rz, (probe.dz !== 0 ? sizeAlongProbe : sizePerpProbe) / 2);

        if (Math.abs(rx) > halfGround || Math.abs(rz) > halfGround) continue;
        if (Math.abs(rx) < spawnClear && Math.abs(rz) < spawnClear) continue;

        const lowEndX = rx + probe.dx * (probe.dx !== 0 ? sizeAlongProbe / 2 : 0);
        const lowEndZ = rz + probe.dz * (probe.dz !== 0 ? sizeAlongProbe / 2 : 0);
        const lowTerrainY = this.getTerrainY(lowEndX, lowEndZ, 0.1);

        const drop = box.height - lowTerrainY;
        if (drop < 0.15 || drop > 1.25) continue;

        const rampHalfW = (probe.dx !== 0 ? sizeAlongProbe : sizePerpProbe) / 2;
        const rampHalfD = (probe.dz !== 0 ? sizeAlongProbe : sizePerpProbe) / 2;
        let obstructed = false;
        for (const other of boxes) {
          if (other === box) continue;
          if (other.height <= lowTerrainY + 0.1) continue;
          if (
            Math.abs(rx - other.x) < rampHalfW + other.halfW + 0.1 &&
            Math.abs(rz - other.z) < rampHalfD + other.halfD + 0.1
          ) {
            obstructed = true;
            break;
          }
        }
        if (obstructed) continue;

        const w = probe.dx !== 0 ? sizeAlongProbe : sizePerpProbe;
        const d = probe.dz !== 0 ? sizeAlongProbe : sizePerpProbe;
        const rh = snapHalf(drop);
        if (rh < 0.25) continue;

        if (this.placeSlopeBox(rx, rz, w, d, rh, probe.slopeDir)) {
          rampsPlaced++;
        }
      }
    }
  }

  /** Place a slope/ramp into the world. slopeDir: which edge is the HIGH side. */
  private placeSlopeBox(x: number, z: number, w: number, d: number, h: number, slopeDir: SlopeDir): boolean {
    const colors = [0x2a2a3e, 0x33334a, 0x252538, 0x1e1e30, 0x3a3a50];
    const hw = w / 2, hd = d / 2;

    const zFight = this.ctx.debris.some(b =>
      Math.abs(h - b.height) < 0.01 &&
      Math.abs(x - b.x) < hw + b.halfW &&
      Math.abs(z - b.z) < hd + b.halfD
    );
    if (zFight) return false;

    const geo = this.createWedgeGeometry(w, h, d, slopeDir);
    const color = colors[Math.floor(Math.random() * colors.length)];
    const variation = 0.85 + Math.random() * 0.3;
    const baseColor = new THREE.Color(color).multiplyScalar(variation);
    const mat = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.85,
      metalness: 0.1,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.ctx.boxGroup.add(mesh);

    const entity = new Entity(mesh, {
      layer: Layer.Architecture,
      radius: Math.max(hw, hd),
      weight: Infinity,
    });
    this.ctx.debrisEntities.push(entity);

    const gridLines = this.createSlopeGrid(w, h, d, slopeDir, baseColor);
    gridLines.position.copy(mesh.position);
    this.ctx.boxGroup.add(gridLines);

    this.ctx.debris.push({ x, z, halfW: hw, halfD: hd, height: h, slopeDir });
    return true;
  }
}
