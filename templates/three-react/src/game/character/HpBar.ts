import * as THREE from 'three';

const HP_BAR_WIDTH = 0.4;
const HP_BAR_HEIGHT = 0.04;
const HP_BAR_Y_OFFSET = 0.65;

export class HpBar {
  private group: THREE.Group;
  private fill: THREE.Mesh;
  private bg: THREE.Mesh;
  showing = false;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();

    const bgGeo = new THREE.PlaneGeometry(HP_BAR_WIDTH, HP_BAR_HEIGHT);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
    this.bg = new THREE.Mesh(bgGeo, bgMat);
    this.group.add(this.bg);

    const fillGeo = new THREE.PlaneGeometry(HP_BAR_WIDTH, HP_BAR_HEIGHT);
    const fillMat = new THREE.MeshBasicMaterial({ color: 0x44dd66, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
    this.fill = new THREE.Mesh(fillGeo, fillMat);
    this.group.add(this.fill);

    this.group.visible = false;
    this.group.renderOrder = 999;
    this.bg.renderOrder = 999;
    this.fill.renderOrder = 1000;
    scene.add(this.group);
  }

  update(position: THREE.Vector3, hp: number, maxHp: number, isAlive: boolean, camera: THREE.Camera): void {
    const shouldShow = isAlive && hp < maxHp;
    if (shouldShow !== this.showing) {
      this.showing = shouldShow;
      this.group.visible = shouldShow;
    }
    if (!shouldShow) return;

    const ratio = maxHp > 0 ? hp / maxHp : 0;

    const mat = this.fill.material as THREE.MeshBasicMaterial;
    if (ratio > 0.5) mat.color.setHex(0x44dd66);
    else if (ratio > 0.25) mat.color.setHex(0xddaa22);
    else mat.color.setHex(0xdd3333);

    this.fill.scale.x = Math.max(0.01, ratio);
    this.fill.position.x = -(HP_BAR_WIDTH * (1 - ratio)) / 2;

    this.group.position.set(
      position.x,
      position.y + HP_BAR_Y_OFFSET,
      position.z,
    );

    this.group.quaternion.copy(camera.quaternion);
  }

  hide(): void {
    this.group.visible = false;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.bg.geometry.dispose();
    (this.bg.material as THREE.Material).dispose();
    this.fill.geometry.dispose();
    (this.fill.material as THREE.Material).dispose();
  }
}
