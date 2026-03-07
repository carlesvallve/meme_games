import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { createTextLabel, updateTextLabel } from './TextLabel';

export interface PathLineUpdateOpts {
  charPos: THREE.Vector3;
  groundY: number;
  path: { x: number; z: number }[];
  pathIndex: number;
  goalRadius: number;
  cellSize: number;
  climbState: { direction: 'up' | 'down' } | null;
  getSurfaceAt: (x: number, z: number) => number;
}

/**
 * PathLineRenderer — debug path line visualization.
 * Renders a yellow Line2 from character position through remaining waypoints.
 * During ladder climbing, reuses a frozen copy of the pre-climb line with Y-based trimming.
 * Shows a distance label above the goal with remaining waypoint count.
 */
export class PathLineRenderer {
  private scene: THREE.Scene | null = null;
  private line: Line2 | null = null;
  private geo: LineGeometry | null = null;
  private mat: LineMaterial | null = null;
  private frozenPositions: number[] | null = null;
  private enabled = false;

  // Distance label
  private distLabel: THREE.Sprite | null = null;
  private prevDistText = '';

  setScene(scene: THREE.Scene | null): void {
    // Clean up old label from previous scene
    if (this.distLabel && this.scene) {
      this.scene.remove(this.distLabel);
    }
    this.scene = scene;
    if (scene && this.distLabel) {
      scene.add(this.distLabel);
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  hasFrozenPositions(): boolean {
    return this.frozenPositions !== null;
  }

  /** Build/update the path line from character state. */
  update(opts: PathLineUpdateOpts): void {
    if (!this.enabled || !this.scene) return;
    this.clearLine();

    const { charPos, groundY, path, pathIndex, goalRadius, climbState, getSurfaceAt } = opts;

    // Update distance label — walk remaining path segments and sum world distance, then convert to cells
    const cellDist = this.computeCellDistance(charPos, path, pathIndex, opts.cellSize);
    this.updateDistLabel(cellDist, path, getSurfaceAt);

    // During climbing, use the frozen positions from before climbing started
    if (climbState && this.frozenPositions && this.frozenPositions.length >= 6) {
      const positions = [...this.frozenPositions];
      // Trim vertices from the front that the character has already climbed past
      while (positions.length >= 9) {
        const nextY = positions[4]; // Y of second vertex
        const charY = groundY + 0.05;
        const climbing = climbState.direction === 'up';
        // Remove first vertex if we've climbed past it or it's at the same height (horizontal approach)
        const pastIt = climbing ? charY > nextY - 0.01 : charY < nextY + 0.01;
        if (pastIt) {
          positions.splice(0, 3);
        } else {
          break;
        }
      }
      // Update first vertex Y to track climb progress
      if (positions.length >= 3) {
        positions[1] = groundY + 0.05;
      }

      this.createLine(positions);
      return;
    }

    const remainingPath = path.slice(pathIndex);
    if (remainingPath.length < 1) return;

    const waypoints: { x: number; z: number }[] = [{ x: charPos.x, z: charPos.z }];
    for (const wp of remainingPath) {
      waypoints.push({ x: wp.x, z: wp.z });
    }

    // Build positions: insert intermediate vertices at height transitions
    const positions: number[] = [];
    let prevH = groundY + 0.05;
    positions.push(waypoints[0].x, prevH, waypoints[0].z);

    for (let i = 1; i < waypoints.length; i++) {
      const from = waypoints[i - 1];
      const to = waypoints[i];
      const toH = getSurfaceAt(to.x, to.z);
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const segLen = Math.sqrt(dx * dx + dz * dz);

      if (segLen < 0.001) continue;

      if (Math.abs(toH - prevH) > 0.01) {
        // Height change: place step at midpoint between waypoints
        const mx = (from.x + to.x) * 0.5;
        const mz = (from.z + to.z) * 0.5;
        positions.push(mx, prevH, mz);
        positions.push(mx, toH, mz);
      }

      positions.push(to.x, toH, to.z);
      prevH = toH;
    }

    // Trim final endpoint back by goalRadius (visual only — stop line at marker ring edge)
    if (goalRadius > 0 && positions.length >= 6) {
      const n = positions.length;
      const ex = positions[n - 3], ez = positions[n - 1];
      const px = positions[n - 6], pz = positions[n - 4];
      const dx = ex - px, dz = ez - pz;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > goalRadius) {
        positions[n - 3] = ex - (dx / len) * goalRadius;
        positions[n - 1] = ez - (dz / len) * goalRadius;
      }
    }

    // Cache positions so climbing can reuse the perfect line.
    // Only cache when NOT climbing — we want the pre-climb line.
    if (!climbState) {
      this.frozenPositions = [...positions];
    }

    this.createLine(positions);
  }

  /** Update the last vertex to a custom world position (for smooth marker tracking). */
  setEndpoint(x: number, z: number, getSurfaceAt: (x: number, z: number) => number, goalRadius = 0): void {
    if (!this.line || !this.geo) return;
    const attr = this.geo.getAttribute('instanceEnd') as THREE.InterleavedBufferAttribute;
    if (!attr || !attr.data) return;
    const arr = attr.data.array as Float32Array;
    const numSegments = arr.length / 6;
    if (numSegments < 1) return;
    const si = (numSegments - 1) * 6;
    // Trim back from goal center by goalRadius along last segment direction
    let ex = x, ez = z;
    if (goalRadius > 0) {
      const px = arr[si], pz = arr[si + 2];
      const dx = x - px, dz = z - pz;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > goalRadius) {
        ex = x - (dx / len) * goalRadius;
        ez = z - (dz / len) * goalRadius;
      }
    }
    arr[si + 3] = ex;
    arr[si + 4] = getSurfaceAt(x, z);
    arr[si + 5] = ez;
    attr.data.needsUpdate = true;
    this.line.computeLineDistances();
  }

  /** Clear frozen positions (call on ladder dismount). */
  clearFrozen(): void {
    this.frozenPositions = null;
  }

  clear(): void {
    this.clearLine();
    this.hideDistLabel();
  }

  dispose(): void {
    this.clearLine();
    if (this.distLabel && this.scene) {
      this.scene.remove(this.distLabel);
      (this.distLabel.material as THREE.SpriteMaterial).map?.dispose();
      (this.distLabel.material as THREE.SpriteMaterial).dispose();
    }
    this.distLabel = null;
  }

  private clearLine(): void {
    if (this.line && this.scene) {
      this.scene.remove(this.line);
      this.mat?.dispose();
      this.geo?.dispose();
      this.line = null;
      this.geo = null;
      this.mat = null;
    }
  }

  private createLine(positions: number[]): void {
    if (!this.scene || positions.length < 6) return;
    this.geo = new LineGeometry();
    this.geo.setPositions(positions);
    this.mat = new LineMaterial({
      color: 0xffff00,
      linewidth: 3,
      transparent: true,
      opacity: 0.8,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
    });
    this.line = new Line2(this.geo, this.mat);
    this.line.computeLineDistances();
    this.scene.add(this.line);
  }

  private computeCellDistance(charPos: THREE.Vector3, path: { x: number; z: number }[], pathIndex: number, cellSize: number): number {
    if (path.length === 0 || pathIndex >= path.length) return 0;
    let totalDist = 0;
    // From character to first remaining waypoint
    const first = path[pathIndex];
    let px = charPos.x, pz = charPos.z;
    const dx0 = first.x - px, dz0 = first.z - pz;
    totalDist += Math.sqrt(dx0 * dx0 + dz0 * dz0);
    px = first.x; pz = first.z;
    // Walk remaining waypoints
    for (let i = pathIndex + 1; i < path.length; i++) {
      const wp = path[i];
      const dx = wp.x - px, dz = wp.z - pz;
      totalDist += Math.sqrt(dx * dx + dz * dz);
      px = wp.x; pz = wp.z;
    }
    return Math.round(totalDist / cellSize);
  }

  private updateDistLabel(remaining: number, path: { x: number; z: number }[], getSurfaceAt: (x: number, z: number) => number): void {
    if (remaining <= 0) {
      this.hideDistLabel();
      return;
    }

    // Lazy-create label
    if (!this.distLabel) {
      this.distLabel = createTextLabel('', {
        fontSize: 32,
        height: 0.3,
        depthTest: false,
        opacity: 1,
        color: '#ffff44',
      });
      if (this.scene) this.scene.add(this.distLabel);
    }

    const text = `${remaining}`;
    if (text !== this.prevDistText) {
      updateTextLabel(this.distLabel, text);
      this.prevDistText = text;
    }

    // Position above goal
    const goal = path[path.length - 1];
    const goalY = getSurfaceAt(goal.x, goal.z);
    this.distLabel.position.set(goal.x, goalY + 0.3, goal.z);
    (this.distLabel.material as THREE.SpriteMaterial).opacity = 1;
    this.distLabel.visible = true;
  }

  private hideDistLabel(): void {
    if (this.distLabel) {
      this.distLabel.visible = false;
      this.prevDistText = '';
    }
  }
}
