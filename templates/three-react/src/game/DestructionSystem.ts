import * as THREE from 'three';
import { createTextLabel } from './rendering/TextLabel';
import { DestructionDebris } from './DestructionDebris';
import { audioSystem } from '../utils/AudioSystem';
import type { ObstacleGenerator } from './ObstacleGenerator';
import type { LadderSystem } from './LadderSystem';
import type { Camera } from './rendering';

/**
 * DestructionSystem — handles the two-press destroy flow:
 *   1. tryTarget(): probe cell ahead, highlight obstacle + floating "DESTROY" label
 *   2. confirmDestroy(): destroy obstacle + attached ladders with debris, rebuild nav
 *   cancelTarget(): clear highlight/label if character moves
 *   update(dt): animate highlight pulse, label bob, debris physics
 */
export class DestructionSystem {
  private targetIdx = -1;
  private highlight: THREE.LineSegments | null = null;
  private label: THREE.Sprite | null = null;
  private labelBaseY = 0;
  private labelTime = 0;
  private debris: DestructionDebris;

  constructor(private scene: THREE.Scene) {
    this.debris = new DestructionDebris(scene);
  }

  /** Whether we have a highlighted target waiting for confirmation. */
  get hasTarget(): boolean { return this.targetIdx >= 0; }

  /** First SPACE: probe for an obstacle at (probeX, probeZ) and highlight it. */
  tryTarget(obstacleGen: ObstacleGenerator, probeX: number, probeZ: number): boolean {
    const idx = obstacleGen.getObstacleAt(probeX, probeZ);
    if (idx < 0) return false;

    this.targetIdx = idx;
    this.labelTime = 0;
    const obs = obstacleGen.obstacles[idx];

    // Wireframe highlight box
    const hw = obs.halfW + 0.02;
    const hd = obs.halfD + 0.02;
    const h = obs.height + 0.02;
    const hlGeo = new THREE.BoxGeometry(hw * 2, h, hd * 2);
    const hlMat = new THREE.LineBasicMaterial({
      color: 0xff4444, linewidth: 2, transparent: true, opacity: 0.9,
    });
    const edges = new THREE.EdgesGeometry(hlGeo);
    hlGeo.dispose();
    this.highlight = new THREE.LineSegments(edges, hlMat);
    this.highlight.position.set(obs.x, h / 2, obs.z);
    this.scene.add(this.highlight);

    // Floating label
    this.labelBaseY = obs.height + 0.5;
    this.label = createTextLabel('DESTROY', {
      color: '#ff4444',
      outlineColor: 'rgba(0,0,0,0.9)',
      outlineWidth: 4,
      fontSize: 36,
      height: 0.35,
    });
    this.label.position.set(obs.x, this.labelBaseY, obs.z);
    this.scene.add(this.label);
    return true;
  }

  /** Second SPACE: destroy the targeted obstacle + attached ladders.
   *  Returns true if destruction happened. Caller should rebuild navgrid. */
  confirmDestroy(
    obstacleGen: ObstacleGenerator,
    ladderSystem: LadderSystem,
    cam: Camera,
  ): boolean {
    if (this.targetIdx < 0) return false;

    const info = obstacleGen.destroyObstacle(this.targetIdx);
    if (!info) { this.cancelTarget(); return false; }

    // SFX — stone break for obstacle
    audioSystem.sfxAt('stoneBreak', info.x, info.z);

    // Gore-style debris burst — count scales with obstacle volume
    const volume = info.halfW * 2 * info.halfD * 2 * info.height;
    const debrisCount = Math.max(8, Math.min(80, Math.round(volume * 20)));
    const burstY = info.height * 0.5;
    const color = obstacleGen.colors[this.targetIdx] ?? 0xffaa00;
    const ejectSpeed = 3 + Math.min(volume, 4) * 1.5;
    this.debris.spawn(info.x, burstY, info.z, color, debrisCount, ejectSpeed, 0.03, 0.12);
    cam.shake(Math.min(0.1 + volume * 0.03, 0.3), Math.min(0.1 + volume * 0.04, 0.4));

    // Destroy any ladders attached to this obstacle
    const ladderIndices = ladderSystem.findLaddersOnObstacle(
      info.x, info.z, info.halfW, info.halfD,
    );
    for (const li of ladderIndices) {
      const ld = ladderSystem.destroyLadder(li);
      if (ld) {
        // SFX — wood break for ladder
        audioSystem.sfxAt('woodBreak', ld.bottomX, ld.bottomZ);
        const ladderH = ld.topY - ld.bottomY;
        const ladderDebris = Math.max(5, Math.min(30, Math.round(ladderH * 8)));
        const midY = (ld.bottomY + ld.topY) * 0.5;
        this.debris.spawn(ld.bottomX, midY, ld.bottomZ, 0x8B6914, ladderDebris, 3, 0.02, 0.06);
      }
    }

    // Zero obstacle height so navGrid treats it as passable
    const old = obstacleGen.obstacles[this.targetIdx];
    obstacleGen.obstacles[this.targetIdx] = { ...old, height: 0 };

    this.cancelTarget();
    return true;
  }

  /** Cancel the current target (e.g. character moved). */
  cancelTarget(): void {
    this.targetIdx = -1;
    if (this.highlight) {
      this.scene.remove(this.highlight);
      this.highlight.geometry.dispose();
      (this.highlight.material as THREE.Material).dispose();
      this.highlight = null;
    }
    if (this.label) {
      this.scene.remove(this.label);
      (this.label.material as THREE.SpriteMaterial).map?.dispose();
      this.label.material.dispose();
      this.label = null;
    }
  }

  /** Per-frame update: debris physics, highlight pulse, label bob. */
  update(dt: number): void {
    this.debris.update(dt);

    if (this.highlight) {
      const pulse = 0.7 + Math.sin(performance.now() * 0.008) * 0.3;
      (this.highlight.material as THREE.LineBasicMaterial).opacity = pulse;
    }
    if (this.label) {
      this.labelTime += dt;
      this.label.position.y = this.labelBaseY + Math.sin(this.labelTime * 2.5) * 0.06;
    }
  }

  dispose(): void {
    this.cancelTarget();
    this.debris.dispose();
  }
}
