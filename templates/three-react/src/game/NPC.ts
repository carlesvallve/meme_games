import * as THREE from 'three';
import { Character } from './Character';
import type { CharacterType } from './characters';
import type { Terrain } from './Terrain';
import type { NavGrid } from './NavGrid';
import { Behavior, type BehaviorAgent, type BehaviorStatus } from './behaviors/Behavior';
import { Roaming } from './behaviors/Roaming';
import { GoToPoint } from './behaviors/GoToPoint';
import { audioSystem } from '../utils/AudioSystem';

/** Simple behavior that just idles in place. */
class IdleBehavior extends Behavior {
  update(agent: BehaviorAgent, dt: number): BehaviorStatus {
    agent.updateIdle(dt);
    return 'running';
  }
}

// Debug vis
const DEBUG_PATH = true;
const DEBUG_LINE_COLOR = 0x00ffaa;
const DEBUG_NODE_COLOR = 0x00ffaa;
const DEBUG_GOAL_COLOR = 0xff4466;
const DEBUG_NODE_RADIUS = 0.08;
const DEBUG_GOAL_RADIUS = 0.14;
const DEBUG_Y_OFFSET = 0.15;

// Shared geometries for debug spheres (created lazily)
let _nodeGeo: THREE.SphereGeometry | null = null;
let _goalGeo: THREE.SphereGeometry | null = null;
function getNodeGeo(): THREE.SphereGeometry {
  if (!_nodeGeo) _nodeGeo = new THREE.SphereGeometry(DEBUG_NODE_RADIUS, 6, 4);
  return _nodeGeo;
}
function getGoalGeo(): THREE.SphereGeometry {
  if (!_goalGeo) _goalGeo = new THREE.SphereGeometry(DEBUG_GOAL_RADIUS, 8, 6);
  return _goalGeo;
}

export class NPC extends Character implements BehaviorAgent {
  readonly characterType: CharacterType;
  private behavior: Behavior;
  private roaming: Roaming;
  private navGrid: NavGrid;
  private _selected = false;

  // Debug visualization
  private debugLine: THREE.Line | null = null;
  private debugNodes: THREE.Mesh[] = [];
  private debugGoal: THREE.Mesh | null = null;
  private debugLineMat: THREE.LineBasicMaterial | null = null;
  private debugNodeMat: THREE.MeshBasicMaterial | null = null;
  private debugGoalMat: THREE.MeshBasicMaterial | null = null;
  private lastDebugWaypointCount = 0;

  constructor(scene: THREE.Scene, terrain: Terrain, navGrid: NavGrid, type: CharacterType, position: THREE.Vector3) {
    super(scene, terrain, type, position);
    this.characterType = type;
    this.navGrid = navGrid;

    this.roaming = new Roaming({ navGrid });
    this.behavior = this.roaming;

    if (DEBUG_PATH) {
      this.debugLineMat = new THREE.LineBasicMaterial({ color: DEBUG_LINE_COLOR, transparent: true, opacity: 0.6 });
      this.debugNodeMat = new THREE.MeshBasicMaterial({ color: DEBUG_NODE_COLOR, transparent: true, opacity: 0.7 });
      this.debugGoalMat = new THREE.MeshBasicMaterial({ color: DEBUG_GOAL_COLOR, transparent: true, opacity: 0.8 });
    }
  }

  // ── BehaviorAgent interface ──────────────────────────────────────

  getX(): number { return this.mesh.position.x; }
  getZ(): number { return this.mesh.position.z; }

  // move(), updateIdle() inherited from Character

  /** Override applyHop to emit spatial step SFX (respects foot sound cooldown) */
  applyHop(hopHeight: number): number {
    const currentHopHalf = super.applyHop(hopHeight);
    if (currentHopHalf !== this.lastHopHalf && this.footSfxTimer >= 0.12) {
      this.lastHopHalf = currentHopHalf;
      this.footSfxTimer = 0;
      audioSystem.sfxAt('step', this.mesh.position.x, this.mesh.position.z);
    }
    return currentHopHalf;
  }

  // ── Selection & point-and-click ─────────────────────────────────

  get selected(): boolean { return this._selected; }

  select(): void {
    this._selected = true;
    // Stop roaming — idle until player gives a click target
    this.behavior = new IdleBehavior({ navGrid: this.navGrid });
  }

  deselect(): void {
    this._selected = false;
    this.behavior = this.roaming;
  }

  /** Set a point-and-click movement goal. Replaces current behavior with GoToPoint. */
  goTo(worldX: number, worldZ: number): void {
    this.behavior = new GoToPoint({ navGrid: this.navGrid }, worldX, worldZ);
  }

  getCameraTarget(): { x: number; y: number; z: number } {
    return {
      x: this.mesh.position.x,
      y: this.visualGroundY + 0.5,
      z: this.mesh.position.z,
    };
  }

  // ── Update ───────────────────────────────────────────────────────

  update(dt: number): void {
    const status = this.behavior.update(this, dt);

    // If a GoToPoint behavior finished, go back to idle (waiting for next click)
    if (this._selected && status === 'done') {
      this.behavior = new IdleBehavior({ navGrid: this.navGrid });
    }

    if (DEBUG_PATH) this.syncDebugVis();
    this.updateTorch(dt);
  }

  // ── Debug visualization ──────────────────────────────────────────

  private syncDebugVis(): void {
    const waypoints = this.behavior.getWaypoints();
    const idx = this.behavior.getWaypointIndex();
    const remaining = waypoints.slice(idx);

    // Path cleared — clean up
    if (remaining.length === 0) {
      if (this.debugLine) this.clearDebugVis();
      this.lastDebugWaypointCount = 0;
      return;
    }

    // New path appeared — build from scratch
    if (!this.debugLine) {
      this.buildDebugVis(remaining);
      this.lastDebugWaypointCount = remaining.length;
      return;
    }

    // Update line to track NPC position
    this.updateDebugLine(remaining);

    // Remove passed waypoint nodes
    while (this.debugNodes.length > Math.max(0, remaining.length - 1)) {
      const node = this.debugNodes.shift()!;
      this.scene.remove(node);
    }

    this.lastDebugWaypointCount = remaining.length;
  }

  private buildDebugVis(remaining: ReadonlyArray<{ x: number; z: number }>): void {
    this.clearDebugVis();
    if (!this.debugLineMat || !this.debugNodeMat || !this.debugGoalMat) return;
    if (remaining.length === 0) return;

    // Line: NPC pos → all remaining waypoints
    const points = this.buildLinePoints(remaining);
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    this.debugLine = new THREE.Line(lineGeo, this.debugLineMat);
    this.scene.add(this.debugLine);

    // Intermediate waypoint spheres (all except the last = goal)
    for (let i = 0; i < remaining.length - 1; i++) {
      const wp = remaining[i];
      const wy = this.terrain.getTerrainY(wp.x, wp.z) + DEBUG_Y_OFFSET;
      const sphere = new THREE.Mesh(getNodeGeo(), this.debugNodeMat);
      sphere.position.set(wp.x, wy, wp.z);
      this.scene.add(sphere);
      this.debugNodes.push(sphere);
    }

    // Goal sphere
    const goal = remaining[remaining.length - 1];
    const goalY = this.terrain.getTerrainY(goal.x, goal.z) + DEBUG_Y_OFFSET;
    this.debugGoal = new THREE.Mesh(getGoalGeo(), this.debugGoalMat);
    this.debugGoal.position.set(goal.x, goalY, goal.z);
    this.scene.add(this.debugGoal);
  }

  private updateDebugLine(remaining: ReadonlyArray<{ x: number; z: number }>): void {
    if (!this.debugLine) return;
    const points = this.buildLinePoints(remaining);
    const geo = this.debugLine.geometry as THREE.BufferGeometry;
    geo.setFromPoints(points);
  }

  private buildLinePoints(remaining: ReadonlyArray<{ x: number; z: number }>): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    points.push(new THREE.Vector3(
      this.mesh.position.x,
      this.mesh.position.y + DEBUG_Y_OFFSET,
      this.mesh.position.z,
    ));
    for (const wp of remaining) {
      const wy = this.terrain.getTerrainY(wp.x, wp.z) + DEBUG_Y_OFFSET;
      points.push(new THREE.Vector3(wp.x, wy, wp.z));
    }
    return points;
  }

  private clearDebugVis(): void {
    if (this.debugLine) {
      this.debugLine.geometry.dispose();
      this.scene.remove(this.debugLine);
      this.debugLine = null;
    }
    for (const node of this.debugNodes) {
      this.scene.remove(node);
    }
    this.debugNodes = [];
    if (this.debugGoal) {
      this.scene.remove(this.debugGoal);
      this.debugGoal = null;
    }
  }

  dispose(): void {
    this.clearDebugVis();
    this.debugLineMat?.dispose();
    this.debugNodeMat?.dispose();
    this.debugGoalMat?.dispose();
    super.dispose();
  }
}
