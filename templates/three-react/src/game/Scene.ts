import * as THREE from 'three';

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const bgColor = 0x0a0a14;
  scene.background = new THREE.Color(bgColor);
  scene.fog = new THREE.Fog(bgColor, 20, 50);

  // Ambient light
  const ambient = new THREE.AmbientLight(0x7070a0, 1.0);
  scene.add(ambient);

  // Primary directional (with shadows)
  const dirPrimary = new THREE.DirectionalLight(0xffffff, 2.0);
  dirPrimary.position.set(10, 20, 10);
  dirPrimary.castShadow = true;
  dirPrimary.shadow.mapSize.set(2048, 2048);
  dirPrimary.shadow.camera.near = 0.5;
  dirPrimary.shadow.camera.far = 60;
  const d = 20;
  dirPrimary.shadow.camera.left = -d;
  dirPrimary.shadow.camera.right = d;
  dirPrimary.shadow.camera.top = d;
  dirPrimary.shadow.camera.bottom = -d;
  scene.add(dirPrimary);

  // Fill directional
  const dirFill = new THREE.DirectionalLight(0x6a6a8a, 1.0);
  dirFill.position.set(-12, 15, -8);
  scene.add(dirFill);

  // Rim directional
  const dirRim = new THREE.DirectionalLight(0x8888aa, 0.7);
  dirRim.position.set(5, 8, -15);
  scene.add(dirRim);

  // Hemisphere
  const hemi = new THREE.HemisphereLight(0x8080b0, 0x2a2a45, 0.8);
  scene.add(hemi);

  return scene;
}
