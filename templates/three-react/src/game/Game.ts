import * as THREE from 'three';
import { useGameStore } from '../store';
import { Input } from './Input';
import { Camera } from './Camera';
import { createScene, applyLightPreset } from './Scene';
import type { LightPreset } from '../store';
import { Terrain } from './Terrain';
import { CollectibleSystem } from './Collectible';
import { ChestSystem } from './Chest';
import { LootSystem } from './Loot';
import { SpeechBubbleSystem } from './SpeechBubble';
import { Player } from './Player';
import { NPC } from './NPC';
import { createDustMotes, createRainEffect, createDebrisEffect } from '../utils/particles';
import type { ParticleToggles } from '../store';
import type { ParticleSystem } from '../types';
import { audioSystem } from '../utils/AudioSystem';
import type { GameInstance } from '../types';
import type { CharacterType } from './characters';

export function createGame(canvas: HTMLCanvasElement): GameInstance {
  // Renderer
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Scene
  const { scene, lights: sceneLights } = createScene();
  let currentLightPreset: LightPreset = useGameStore.getState().lightPreset;
  applyLightPreset(sceneLights, currentLightPreset);

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

  // Navigation grid for NPC pathfinding
  const navGrid = terrain.buildNavGrid(0.5, 0.25);

  // Collectibles
  const collectibles = new CollectibleSystem(scene, terrain);

  // Loot + Chests
  const lootSystem = new LootSystem(scene, terrain);
  const chestSystem = new ChestSystem(scene, terrain, lootSystem);

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

  // Player
  let player: Player | null = null;
  let lastSelectedCharacter: CharacterType | null = null;

  // NPCs
  const allCharacterTypes: CharacterType[] = ['boy', 'girl', 'robot', 'dog'];
  let npcs: NPC[] = [];

  function spawnNPCs(excludeType: CharacterType): void {
    for (const npc of npcs) npc.dispose();
    const npcTypes = allCharacterTypes.filter((t) => t !== excludeType);
    npcs = npcTypes.map((type) => {
      const pos = terrain.getRandomPosition();
      return new NPC(scene, terrain, navGrid, type, pos);
    });
  }

  function spawnPlayer(type: CharacterType): void {
    player?.dispose();
    player = new Player(scene, terrain, type, new THREE.Vector3(0, 0, 0));
    speechSystem.setCharacter(type);
    speechSystem.setPlayerMesh(player.mesh);
    useGameStore.getState().setCollectibles(0);
    spawnNPCs(type);
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

    if (phase === 'playing' && player) {
      // Player movement, hop, torch
      player.update(dt, state, cam.getAngleY(), params);

      // Update audio listener position for spatial SFX
      const pp = player.getPosition();
      audioSystem.setPlayerPosition(pp.x, pp.z);

      // Sync light preset
      const preset = useGameStore.getState().lightPreset;
      if (preset !== currentLightPreset) {
        currentLightPreset = preset;
        applyLightPreset(sceneLights, preset);
      }

      // Camera follows player
      const target = player.getCameraTarget();
      cam.setTarget(target.x, target.y, target.z);

      // Collectibles
      const playerPos = player.getPosition();
      const pickedUp = collectibles.update(dt, playerPos);
      if (pickedUp > 0) {
        const total = collectibles.getTotalCollected();
        useGameStore.getState().setCollectibles(total);
        useGameStore.getState().setScore(total);
        audioSystem.sfx('pickup');
      }

      // Chests
      const chestsOpened = chestSystem.update(dt, playerPos, params.stepHeight);
      if (chestsOpened > 0) audioSystem.sfx('chest');

      // Loot
      const loot = lootSystem.update(dt, playerPos);
      if (loot.coins > 0) {
        useGameStore.getState().addCoins(loot.coins);
        useGameStore.getState().setScore(useGameStore.getState().score + loot.coins);
        audioSystem.sfx('coin');
      }
      if (loot.potions > 0) {
        useGameStore.getState().addPotions(loot.potions);
        audioSystem.sfx('potion');
      }

      // NPCs
      for (const npc of npcs) npc.update(dt);

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
      player?.dispose();
      for (const npc of npcs) npc.dispose();
      terrain.dispose();
      collectibles.dispose();
      chestSystem.dispose();
      lootSystem.dispose();
      speechSystem.dispose();
      renderer.dispose();
    },
  };
}
