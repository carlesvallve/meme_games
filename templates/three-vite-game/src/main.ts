import * as THREE from "three";
import { CAMERA_FOV, CAMERA_NEAR, CAMERA_FAR, CAMERA_POSITION } from "./Constants";
import { createGameScene } from "./scenes/GameScene";
import { GameState } from "./GameState";
import { EventBus } from "./EventBus";

const container = document.getElementById("game-container")!;

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
container.appendChild(renderer.domElement);

// Camera
const camera = new THREE.PerspectiveCamera(
  CAMERA_FOV,
  window.innerWidth / window.innerHeight,
  CAMERA_NEAR,
  CAMERA_FAR,
);
camera.position.set(CAMERA_POSITION.x, CAMERA_POSITION.y, CAMERA_POSITION.z);
camera.lookAt(0, 0.5, 0);

// Scene
const { scene, cube } = createGameScene();

GameState.isPlaying = true;
EventBus.emit("game:started");

// Resize handler
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Animate loop
function animate(): void {
  requestAnimationFrame(animate);

  if (GameState.isPlaying) {
    cube.rotation.x += 0.01;
    cube.rotation.y += 0.015;
  }

  renderer.render(scene, camera);
}

animate();
