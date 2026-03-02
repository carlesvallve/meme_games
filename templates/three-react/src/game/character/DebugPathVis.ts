import * as THREE from 'three';
import type { Environment } from '../environment';
import type { Behavior } from '../behaviors/Behavior';

const DEBUG_LINE_COLOR = 0x00ffaa;
const DEBUG_NODE_COLOR = 0x00ffaa;
const DEBUG_GOAL_COLOR = 0xff4466;
const DEBUG_NODE_RADIUS = 0.08;
const DEBUG_GOAL_RADIUS = 0.14;
const DEBUG_Y_OFFSET = 0;

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

export class DebugPathVis {
  private scene: THREE.Scene;
  private terrain: Environment;
  private debugLine: THREE.Line | null = null;
  private debugNodes: THREE.Mesh[] = [];
  private debugGoal: THREE.Mesh | null = null;
  private debugLineMat: THREE.LineBasicMaterial;
  private debugNodeMat: THREE.MeshBasicMaterial;
  private debugGoalMat: THREE.MeshBasicMaterial;
  private lastDebugWaypointCount = 0;

  constructor(scene: THREE.Scene, terrain: Environment) {
    this.scene = scene;
    this.terrain = terrain;
    this.debugLineMat = new THREE.LineBasicMaterial({
      color: DEBUG_LINE_COLOR,
      transparent: true,
      opacity: 0.6,
    });
    this.debugNodeMat = new THREE.MeshBasicMaterial({
      color: DEBUG_NODE_COLOR,
      transparent: true,
      opacity: 0.7,
    });
    this.debugGoalMat = new THREE.MeshBasicMaterial({
      color: DEBUG_GOAL_COLOR,
      transparent: true,
      opacity: 0.8,
    });
  }

  sync(behavior: Behavior, meshPosition: THREE.Vector3): void {
    const waypoints = behavior.getWaypoints();
    const idx = behavior.getWaypointIndex();
    const remaining = waypoints.slice(idx);

    if (remaining.length === 0) {
      if (this.debugLine) this.clear();
      this.lastDebugWaypointCount = 0;
      return;
    }

    if (!this.debugLine) {
      this.build(remaining, meshPosition);
      this.lastDebugWaypointCount = remaining.length;
      return;
    }

    this.updateLine(remaining, meshPosition);

    while (this.debugNodes.length > Math.max(0, remaining.length - 1)) {
      const node = this.debugNodes.shift()!;
      this.scene.remove(node);
    }

    this.lastDebugWaypointCount = remaining.length;
  }

  private build(
    remaining: ReadonlyArray<{ x: number; z: number }>,
    meshPosition: THREE.Vector3,
  ): void {
    this.clear();
    if (remaining.length === 0) return;

    const points = this.buildLinePoints(remaining, meshPosition);
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    this.debugLine = new THREE.Line(lineGeo, this.debugLineMat);
    this.scene.add(this.debugLine);

    for (let i = 0; i < remaining.length - 1; i++) {
      const wp = remaining[i];
      const wy = this.terrain.getTerrainY(wp.x, wp.z) + DEBUG_Y_OFFSET;
      const sphere = new THREE.Mesh(getNodeGeo(), this.debugNodeMat);
      sphere.position.set(wp.x, wy, wp.z);
      sphere.scale.set(0.5, 0.5, 0.5);
      this.scene.add(sphere);
      this.debugNodes.push(sphere);
    }

    const goal = remaining[remaining.length - 1];
    const goalY = this.terrain.getTerrainY(goal.x, goal.z) + DEBUG_Y_OFFSET;
    this.debugGoal = new THREE.Mesh(getGoalGeo(), this.debugGoalMat);
    this.debugGoal.position.set(goal.x, goalY, goal.z);
    this.debugGoal.scale.set(0.5, 0.5, 0.5);
    this.scene.add(this.debugGoal);
  }

  private updateLine(
    remaining: ReadonlyArray<{ x: number; z: number }>,
    meshPosition: THREE.Vector3,
  ): void {
    if (!this.debugLine) return;
    const points = this.buildLinePoints(remaining, meshPosition);
    const geo = this.debugLine.geometry as THREE.BufferGeometry;
    geo.setFromPoints(points);
  }

  private buildLinePoints(
    remaining: ReadonlyArray<{ x: number; z: number }>,
    meshPosition: THREE.Vector3,
  ): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    points.push(
      new THREE.Vector3(
        meshPosition.x,
        meshPosition.y + DEBUG_Y_OFFSET,
        meshPosition.z,
      ),
    );
    for (const wp of remaining) {
      const wy = this.terrain.getTerrainY(wp.x, wp.z) + DEBUG_Y_OFFSET;
      points.push(new THREE.Vector3(wp.x, wy, wp.z));
    }
    return points;
  }

  clear(): void {
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
    this.clear();
    this.debugLineMat.dispose();
    this.debugNodeMat.dispose();
    this.debugGoalMat.dispose();
  }
}
