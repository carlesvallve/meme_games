import * as THREE from 'three';
import { useGameStore } from '../store';
import { Input } from './Input';
import { Camera } from './Camera';
import { createScene } from './Scene';
import { Terrain } from './Terrain';
import { CollectibleSystem } from './Collectible';
import { SpeechBubbleSystem } from './SpeechBubble';
import { createCharacterMesh } from './characters';
import { Entity, Layer } from './Entity';
import { createDustMotes, createRainEffect, createDebrisEffect } from '../utils/particles';
import type { ParticleToggles } from '../store';
import type { ParticleSystem } from '../types';
import { audioSystem } from '../utils/AudioSystem';
import type { GameInstance } from '../types';
import type { CharacterType } from './characters';

function lerpAngle(current: number, target: number, t: number): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * t;
}

export function createGame(canvas: HTMLCanvasElement): GameInstance {
  // Renderer
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Scene
  const scene = createScene();

  // Camera
  const cam = new Camera(window.innerWidth / window.innerHeight, canvas, {
    distance: 12,
    angleX: -35,
    angleY: 45,
  });

  // Input
  const input = new Input();

  // Terrain
  const terrain = new Terrain(scene);

  // Collectibles
  const collectibles = new CollectibleSystem(scene, terrain);

  // Speech bubbles
  const speechSystem = new SpeechBubbleSystem();
  speechSystem.setCamera(cam.camera);

  // Particles — independent toggleable systems
  const particleSystems: Record<keyof ParticleToggles, ParticleSystem | null> = {
    dust: null,
    lightRain: null,
    rain: null,
    debris: null,
  };
  const prevToggles: ParticleToggles = { dust: false, lightRain: false, rain: false, debris: false };

  const terrainHeightAt = (x: number, z: number) => terrain.getTerrainY(x, z);

  function createParticleSystem(key: keyof ParticleToggles): ParticleSystem {
    switch (key) {
      case 'dust': return createDustMotes({ count: 60, area: { x: 16, y: 6, z: 16 } });
      case 'lightRain': return createRainEffect({
        area: { x: 24, y: 30, z: 24 },
        groundHeightAt: terrainHeightAt,
        intensity: 'light',
      });
      case 'rain': return createRainEffect({
        area: { x: 24, y: 30, z: 24 },
        groundHeightAt: terrainHeightAt,
      });
      case 'debris': return createDebrisEffect();
    }
  }

  function syncParticles(toggles: ParticleToggles): void {
    for (const key of Object.keys(toggles) as (keyof ParticleToggles)[]) {
      const want = toggles[key];
      const had = prevToggles[key];
      if (want && !had) {
        const sys = createParticleSystem(key);
        particleSystems[key] = sys;
        scene.add(sys.group);
      } else if (!want && had) {
        const sys = particleSystems[key];
        if (sys) {
          scene.remove(sys.group);
          sys.dispose();
          particleSystems[key] = null;
        }
      }
      prevToggles[key] = want;
    }
  }

  // Initialize with default toggles
  syncParticles(useGameStore.getState().particleToggles);

  // Player state
  let playerMesh: THREE.Mesh | null = null;
  let playerEntity: Entity | null = null;
  let playerLight: THREE.PointLight | null = null;
  let playerLightEntity: Entity | null = null;
  let playerY = 0;
  let playerFacing = 0;
  let moveTime = 0;
  let lastHopHalf = 0; // track which half of the sin cycle we're in for step sfx
  const hopFrequency = 4; // hop cycles per second (spaced out steps)

  // Character selection listener
  let lastSelectedCharacter: CharacterType | null = null;

  function spawnPlayer(type: CharacterType): void {
    // Remove existing
    if (playerEntity) { playerEntity.destroy(); playerEntity = null; }
    if (playerMesh) {
      scene.remove(playerMesh);
      (playerMesh.material as THREE.Material).dispose();
    }
    if (playerLightEntity) { playerLightEntity.destroy(); playerLightEntity = null; }
    if (playerLight) {
      scene.remove(playerLight);
    }

    playerMesh = createCharacterMesh(type);
    playerMesh.position.set(0, 0, 0);
    scene.add(playerMesh);
    playerEntity = new Entity(playerMesh, { layer: Layer.Character, radius: 0.25 });

    // Point light above player
    playerLight = new THREE.PointLight(0xffcc88, 1.5, 10);
    playerLight.position.set(0, 3, 0);
    playerLight.castShadow = false;
    scene.add(playerLight);
    playerLightEntity = new Entity(playerLight, { layer: Layer.Light, radius: 5 });

    speechSystem.setCharacter(type);
    speechSystem.setPlayerMesh(playerMesh);

    playerY = 0;
    playerFacing = 0;
    moveTime = 0;

    useGameStore.getState().setCollectibles(0);
  }

  // Store callbacks
  useGameStore.setState({
    onStartGame: () => {
      useGameStore.getState().setPhase('select');
      audioSystem.init();
    },
    onPauseToggle: () => {
      const phase = useGameStore.getState().phase;
      if (phase === 'playing') {
        useGameStore.getState().setPhase('paused');
      } else if (phase === 'paused') {
        useGameStore.getState().setPhase('playing');
      }
    },
    onRestart: () => {
      useGameStore.getState().onStartGame?.();
    },
  });

  // Resize handler
  const onResize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    cam.resize(window.innerWidth / window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  // Game loop
  let rafId = 0;
  let lastTime = 0;

  function update(dt: number): void {
    const state = input.update();
    const { phase, playerParams: params, cameraParams } = useGameStore.getState();
    cam.setParams(cameraParams);

    // Check for character selection
    const selected = useGameStore.getState().selectedCharacter;
    if (selected && selected !== lastSelectedCharacter) {
      lastSelectedCharacter = selected;
      spawnPlayer(selected);
    }

    if (phase === 'playing' && playerMesh) {
      // Camera-relative movement
      const cameraAngleY = cam.getAngleY();
      let mx = 0;
      let mz = 0;

      if (state.forward) { mx -= Math.sin(cameraAngleY); mz -= Math.cos(cameraAngleY); }
      if (state.backward) { mx += Math.sin(cameraAngleY); mz += Math.cos(cameraAngleY); }
      if (state.left) { mx -= Math.cos(cameraAngleY); mz += Math.sin(cameraAngleY); }
      if (state.right) { mx += Math.cos(cameraAngleY); mz -= Math.sin(cameraAngleY); }

      const moveLen = Math.sqrt(mx * mx + mz * mz);
      if (moveLen > 0.001) {
        mx /= moveLen;
        mz /= moveLen;

        const newX = playerMesh.position.x + mx * params.speed * dt;
        const newZ = playerMesh.position.z + mz * params.speed * dt;

        // Capsule collider: move then resolve penetration
        const resolved = terrain.resolveMovement(newX, newZ, playerY, params.stepHeight, params.capsuleRadius);
        playerMesh.position.x = resolved.x;
        playerMesh.position.z = resolved.z;
        playerY = resolved.y;

        // Face movement direction (add PI because voxel model front is -Z)
        const targetAngle = Math.atan2(mx, mz) + Math.PI;
        playerFacing = lerpAngle(playerFacing, targetAngle, 1 - Math.exp(-12 * dt));
        playerMesh.rotation.y = playerFacing;

        // Hop animation — sinusoidal arc like Ziggurat
        moveTime += dt * hopFrequency;
        const hopSin = Math.sin(moveTime * Math.PI);
        const hop = Math.abs(hopSin) * params.hopHeight;

        // Step SFX on each half-cycle (foot lands)
        const currentHopHalf = Math.floor(moveTime) % 2;
        if (currentHopHalf !== lastHopHalf) {
          lastHopHalf = currentHopHalf;
          audioSystem.sfx('step');
        }

        playerMesh.position.y = playerY + hop;
      } else {
        if (moveTime > 0) {
          // Was moving, now stopped — snap to ground
          moveTime = 0;
          lastHopHalf = 0;
        }
        playerMesh.position.y = THREE.MathUtils.lerp(
          playerMesh.position.y,
          playerY,
          1 - Math.exp(-15 * dt),
        );
      }

      // Update player light position
      if (playerLight) {
        playerLight.position.set(
          playerMesh.position.x,
          playerMesh.position.y + 3,
          playerMesh.position.z,
        );
      }

      // Camera follows player — use terrain Y, not mesh Y (ignores hop)
      cam.setTarget(
        playerMesh.position.x,
        playerY + 0.5,
        playerMesh.position.z,
      );

      // Collectibles
      const pickedUp = collectibles.update(dt, playerMesh.position);
      if (pickedUp > 0) {
        const total = collectibles.getTotalCollected();
        useGameStore.getState().setCollectibles(total);
        useGameStore.getState().setScore(total);
        audioSystem.sfx('pickup');
      }

      // Speech bubbles
      speechSystem.update(dt);

      // Pause on Escape
      if (state.cancel) {
        useGameStore.getState().onPauseToggle?.();
      }
    } else if (phase === 'playing') {
      // No player yet, still update collectibles visually
      collectibles.update(dt, new THREE.Vector3(9999, 0, 9999));
    }

    // Sync particle toggles
    syncParticles(useGameStore.getState().particleToggles);

    // Always update camera and particles
    cam.updatePosition(dt);
    for (const sys of Object.values(particleSystems)) {
      if (sys) sys.update(dt);
    }
    input.consume();
  }

  function loop(time: number): void {
    rafId = requestAnimationFrame(loop);
    const dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;

    update(dt);
    renderer.render(scene, cam.camera);
  }

  rafId = requestAnimationFrame(loop);

  return {
    destroy() {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      input.destroy();
      cam.destroy();
      for (const sys of Object.values(particleSystems)) {
        if (sys) sys.dispose();
      }
      if (playerEntity) playerEntity.destroy();
      if (playerLightEntity) playerLightEntity.destroy();
      terrain.dispose();
      collectibles.dispose();
      speechSystem.dispose();
      renderer.dispose();
    },
  };
}
