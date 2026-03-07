import * as THREE from 'three';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { AABBBox } from './pathfinding/NavGrid';
import type { NavGrid } from './pathfinding/NavGrid';

/**
 * Grid overlay that draws cell lines on the ground and on obstacle surfaces.
 * Uses per-vertex colors: white on dark surfaces, black on bright ones.
 * Matches voxel-engine's HeightmapBuilder grid approach.
 */

const BIAS = 0.02; // offset to prevent z-fighting

/** ITU-R BT.601 luminance from an RGB hex color (0xRRGGBB) */
function hexLuminance(hex: number): number {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Grid line color: 0 (black) for bright surfaces, 0.7 (white) for dark */
function contrastColor(lum: number): number {
  return lum > 0.18 ? 0 : 0.7;
}

export class GridOverlay {
  readonly group: THREE.Group;
  private lineMat: THREE.LineBasicMaterial;
  private lineSegments: THREE.LineSegments | null = null;
  private debugMesh: THREE.Mesh | null = null;

  constructor() {
    this.group = new THREE.Group();
    this.lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    });
  }

  setOpacity(opacity: number): void {
    this.lineMat.opacity = opacity;
    this.lineMat.visible = opacity > 0.01;
  }

  /**
   * Rebuild all grid lines: ground plane + obstacle surfaces.
   * @param worldSize  World extent (e.g. 41)
   * @param cellSize   Grid cell size
   * @param groundColor Hex color of the ground material
   * @param obstacles  Array of AABB boxes
   * @param boxColors  Parallel array of hex colors per obstacle
   */
  rebuild(
    worldSize: number,
    cellSize: number,
    groundColor: number,
    obstacles: ReadonlyArray<AABBBox>,
    boxColors: ReadonlyArray<number>,
  ): void {
    // Remove old
    if (this.lineSegments) {
      this.group.remove(this.lineSegments);
      this.lineSegments.geometry.dispose();
      this.lineSegments = null;
    }

    const positions: number[] = [];
    const colors: number[] = [];

    const half = worldSize / 2;
    const groundLum = hexLuminance(groundColor);
    const groundC = contrastColor(groundLum);

    // ── Ground grid lines ──
    // Lines along X axis (varying Z)
    const steps = Math.round(worldSize / cellSize);
    for (let i = 0; i <= steps; i++) {
      const z = -half + i * cellSize;
      positions.push(-half, BIAS, z, half, BIAS, z);
      colors.push(groundC, groundC, groundC, groundC, groundC, groundC);
    }
    // Lines along Z axis (varying X)
    for (let i = 0; i <= steps; i++) {
      const x = -half + i * cellSize;
      positions.push(x, BIAS, -half, x, BIAS, half);
      colors.push(groundC, groundC, groundC, groundC, groundC, groundC);
    }

    // ── Obstacle grid lines ──
    for (let oi = 0; oi < obstacles.length; oi++) {
      const box = obstacles[oi];
      const boxHex = boxColors[oi] ?? 0x888888;
      const boxLum = hexLuminance(boxHex);
      const boxC = contrastColor(boxLum);

      const minX = box.x - box.halfW;
      const maxX = box.x + box.halfW;
      const minZ = box.z - box.halfD;
      const maxZ = box.z + box.halfD;
      const h = box.height;

      // Top face grid lines
      const topY = h + BIAS;

      // Lines along X on top face (varying Z)
      const zStart = Math.ceil(minZ / cellSize) * cellSize;
      for (let z = zStart; z <= maxZ + 0.001; z += cellSize) {
        positions.push(minX, topY, z, maxX, topY, z);
        colors.push(boxC, boxC, boxC, boxC, boxC, boxC);
      }
      // Lines along Z on top face (varying X)
      const xStart = Math.ceil(minX / cellSize) * cellSize;
      for (let x = xStart; x <= maxX + 0.001; x += cellSize) {
        positions.push(x, topY, minZ, x, topY, maxZ);
        colors.push(boxC, boxC, boxC, boxC, boxC, boxC);
      }

      // Side vertical rungs at cellSize intervals
      const groundC2 = groundC; // sides sit against ground-colored backdrop

      // Front face (Z = maxZ) — horizontal rungs at cellSize Y intervals
      const yStart = Math.ceil(0 / cellSize) * cellSize;
      for (let y = yStart; y <= h; y += cellSize) {
        const ly = y + BIAS * (y > 0 && y < h ? 0 : 1);
        positions.push(minX, ly, maxZ + BIAS, maxX, ly, maxZ + BIAS);
        colors.push(groundC2, groundC2, groundC2, groundC2, groundC2, groundC2);
      }
      // Back face (Z = minZ)
      for (let y = yStart; y <= h; y += cellSize) {
        const ly = y + BIAS * (y > 0 && y < h ? 0 : 1);
        positions.push(minX, ly, minZ - BIAS, maxX, ly, minZ - BIAS);
        colors.push(groundC2, groundC2, groundC2, groundC2, groundC2, groundC2);
      }
      // Left face (X = minX)
      for (let y = yStart; y <= h; y += cellSize) {
        const ly = y + BIAS * (y > 0 && y < h ? 0 : 1);
        positions.push(minX - BIAS, ly, minZ, minX - BIAS, ly, maxZ);
        colors.push(groundC2, groundC2, groundC2, groundC2, groundC2, groundC2);
      }
      // Right face (X = maxX)
      for (let y = yStart; y <= h; y += cellSize) {
        const ly = y + BIAS * (y > 0 && y < h ? 0 : 1);
        positions.push(maxX + BIAS, ly, minZ, maxX + BIAS, ly, maxZ);
        colors.push(groundC2, groundC2, groundC2, groundC2, groundC2, groundC2);
      }

      // Vertical lines on sides at cellSize X/Z intervals
      // Front/Back faces — vertical lines at X intervals
      for (let x = xStart; x <= maxX + 0.001; x += cellSize) {
        positions.push(x, 0, maxZ + BIAS, x, h, maxZ + BIAS);
        colors.push(groundC2, groundC2, groundC2, groundC2, groundC2, groundC2);
        positions.push(x, 0, minZ - BIAS, x, h, minZ - BIAS);
        colors.push(groundC2, groundC2, groundC2, groundC2, groundC2, groundC2);
      }
      // Left/Right faces — vertical lines at Z intervals
      for (let z = zStart; z <= maxZ + 0.001; z += cellSize) {
        positions.push(minX - BIAS, 0, z, minX - BIAS, h, z);
        colors.push(groundC2, groundC2, groundC2, groundC2, groundC2, groundC2);
        positions.push(maxX + BIAS, 0, z, maxX + BIAS, h, z);
        colors.push(groundC2, groundC2, groundC2, groundC2, groundC2, groundC2);
      }
    }

    // Build geometry
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    this.lineSegments = new THREE.LineSegments(geo, this.lineMat);
    this.group.add(this.lineSegments);
  }

  /**
   * Show/hide NavGrid debug overlay: green = walkable, red = blocked.
   * Quads are placed at each cell's surface height + small bias.
   */
  setDebugNav(navGrid: NavGrid | null, _obstacles: ReadonlyArray<AABBBox> = []): void {
    // Remove old
    if (this.debugMesh) {
      this.group.remove(this.debugMesh);
      this.debugMesh.geometry.dispose();
      (this.debugMesh.material as THREE.Material).dispose();
      this.debugMesh = null;
    }
    if (!navGrid) return;

    const cells = navGrid.getCells();
    if (!cells || cells.length === 0) return;
    const cs = navGrid.cellSize;

    const positions: number[] = [];
    const inset = cs * 0.15;
    const qh = cs * 0.5 - inset;

    for (const cell of cells) {
      if (!cell.blocked) continue;
      const x = cell.worldX;
      const z = cell.worldZ;
      const y = cell.surfaceHeight + 0.02;

      // X shape: two diagonal line segments
      positions.push(
        x - qh, y, z - qh,  x + qh, y, z + qh,
        x + qh, y, z - qh,  x - qh, y, z + qh,
      );
    }

    if (positions.length === 0) return;

    const geo = new LineSegmentsGeometry();
    geo.setPositions(positions);

    const mat = new LineMaterial({
      color: 0xff3333,
      linewidth: 2,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      depthTest: true,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
    });

    const lines = new LineSegments2(geo, mat);
    lines.computeLineDistances();
    lines.renderOrder = 999;
    this.debugMesh = lines as unknown as THREE.Mesh;
    this.group.add(this.debugMesh);
  }

  dispose(): void {
    if (this.lineSegments) {
      this.lineSegments.geometry.dispose();
    }
    this.lineMat.dispose();
    if (this.debugMesh) {
      this.debugMesh.geometry.dispose();
      (this.debugMesh.material as THREE.Material).dispose();
    }
  }
}
