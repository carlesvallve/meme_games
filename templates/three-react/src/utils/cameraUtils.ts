import * as THREE from 'three';

export function computeCameraPosition(
  focus: THREE.Vector3,
  distance: number,
  angleY: number,
  angleX: number,
): THREE.Vector3 {
  return new THREE.Vector3(
    focus.x + distance * Math.cos(angleX) * Math.sin(angleY),
    focus.y + distance * Math.sin(-angleX),
    focus.z + distance * Math.cos(angleX) * Math.cos(angleY),
  );
}

export function smoothLerpVec3(
  current: THREE.Vector3,
  target: THREE.Vector3,
  speed: number,
  dt: number,
): void {
  const t = 1 - Math.exp(-speed * dt);
  current.lerp(target, t);
}

export function smoothstep(t: number): number {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}
