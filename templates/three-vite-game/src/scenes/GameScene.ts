import * as THREE from "three";
import { COLORS } from "../Constants";

/** Creates and populates a THREE.Scene with lights, ground plane, and a rotating cube. */
export function createGameScene(): {
  scene: THREE.Scene;
  cube: THREE.Mesh;
} {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);

  // Lighting
  const ambient = new THREE.AmbientLight(COLORS.ambientLight, 0.5);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(COLORS.directionalLight, 1);
  directional.position.set(5, 10, 7);
  directional.castShadow = true;
  scene.add(directional);

  // Ground plane
  const groundGeometry = new THREE.PlaneGeometry(20, 20);
  const groundMaterial = new THREE.MeshStandardMaterial({ color: COLORS.ground });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Rotating cube
  const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
  const cubeMaterial = new THREE.MeshStandardMaterial({ color: COLORS.cube });
  const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
  cube.position.y = 1;
  cube.castShadow = true;
  scene.add(cube);

  return { scene, cube };
}
