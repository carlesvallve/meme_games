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
import { CHARACTER_TEAM_COLORS, type CharacterType } from './characters';

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

  // Terrain + dependent systems (mutable for regeneration)
  const { terrainPreset: initPreset, heightmapStyle: initStyle } = useGameStore.getState();
  let terrain = new Terrain(scene, initPreset, initStyle);
  const { playerParams: initParams } = useGameStore.getState();
  let navGrid = terrain.buildNavGrid(initParams.stepHeight, initParams.capsuleRadius, 0.5, initParams.slopeHeight);
  let collectibles = new CollectibleSystem(scene, terrain);
  let lootSystem = new LootSystem(scene, terrain);
  let chestSystem = new ChestSystem(scene, terrain, lootSystem);

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

  /** Wipe terrain + all dependent systems and rebuild from current store settings */
  function regenerateScene(): void {
    // Clear NPC selection
    selectedNPC = null;

    // Dispose old systems
    for (const npc of npcs) npc.dispose();
    npcs = [];
    player?.dispose();
    player = null;
    chestSystem.dispose();
    lootSystem.dispose();
    collectibles.dispose();
    terrain.dispose();
    scene.remove(terrain.group);

    // Read current settings from store
    const { terrainPreset, heightmapStyle, playerParams: pp } = useGameStore.getState();

    // Rebuild
    terrain = new Terrain(scene, terrainPreset, heightmapStyle);
    navGrid = terrain.buildNavGrid(pp.stepHeight, pp.capsuleRadius, 0.5, pp.slopeHeight);
    collectibles = new CollectibleSystem(scene, terrain);
    lootSystem = new LootSystem(scene, terrain);
    chestSystem = new ChestSystem(scene, terrain, lootSystem);

    // Re-spawn player + NPCs if a character was selected
    if (lastSelectedCharacter) {
      spawnPlayer(lastSelectedCharacter);
    }
  }

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
  let selectedNPC: NPC | null = null;

  // Per-character inventory: key is CharacterType name, stores collectibles/coins/potions
  interface CharInventory { collectibles: number; coins: number; potions: number; }
  const inventories = new Map<string, CharInventory>();

  function getInventoryKey(): string {
    if (selectedNPC) return `npc:${selectedNPC.characterType}`;
    return `player:${lastSelectedCharacter ?? 'unknown'}`;
  }

  function getInventory(): CharInventory {
    const key = getInventoryKey();
    if (!inventories.has(key)) inventories.set(key, { collectibles: 0, coins: 0, potions: 0 });
    return inventories.get(key)!;
  }

  /** Save current store stats into the active character's inventory */
  function saveActiveInventory(): void {
    const inv = getInventory();
    const s = useGameStore.getState();
    inv.collectibles = s.collectibles;
    inv.coins = s.coins;
    inv.potions = s.potions;
  }

  /** Load a character's inventory into the store */
  function loadActiveInventory(): void {
    const inv = getInventory();
    useGameStore.getState().setCollectibles(inv.collectibles);
    useGameStore.setState({ coins: inv.coins, potions: inv.potions });
  }

  function updateActiveCharacter(): void {
    const type = selectedNPC ? selectedNPC.characterType : lastSelectedCharacter;
    if (type) {
      useGameStore.getState().setActiveCharacter(type, CHARACTER_TEAM_COLORS[type]);
    }
  }

  // Raycasting for NPC selection & terrain clicks
  const raycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();
  const _planeHit = new THREE.Vector3();

  // Click marker (visual feedback on terrain click)
  const markerGeo = new THREE.RingGeometry(0.15, 0.3, 16);
  markerGeo.rotateX(-Math.PI / 2);
  const markerMat = new THREE.MeshBasicMaterial({ color: 0x00ffaa, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
  const clickMarker = new THREE.Mesh(markerGeo, markerMat);
  clickMarker.visible = false;
  scene.add(clickMarker);
  let markerLife = 0;

  function selectNPC(npc: NPC | null): void {
    // Save current character's inventory before switching
    saveActiveInventory();
    if (selectedNPC) selectedNPC.deselect();
    selectedNPC = npc;
    if (npc) npc.select();
    // Load new character's inventory
    loadActiveInventory();
    updateActiveCharacter();
  }

  /** Handle a click (non-drag) at screen coordinates */
  function handleClick(clientX: number, clientY: number): void {
    if (useGameStore.getState().phase !== 'playing') return;

    pointerNDC.x = (clientX / window.innerWidth) * 2 - 1;
    pointerNDC.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, cam.camera);

    // 1) Check NPC meshes first
    const npcMeshes = npcs.map(n => n.mesh);
    const npcHits = raycaster.intersectObjects(npcMeshes, true);
    if (npcHits.length > 0) {
      // Find which NPC owns this mesh
      const hitObj = npcHits[0].object;
      const npc = npcs.find(n => n.mesh === hitObj || hitObj.parent === n.mesh || n.mesh === hitObj.parent);
      if (npc) {
        if (npc === selectedNPC) {
          // Click same NPC again — deselect
          selectNPC(null);
        } else {
          selectNPC(npc);
        }
        return;
      }
    }

    // 2) If an NPC is selected, clicking terrain sets movement goal.
    //    Raycast directly against the terrain mesh for accurate hit position.
    if (selectedNPC) {
      const terrainMesh = terrain.getTerrainMesh();
      let hitPoint: THREE.Vector3 | null = null;

      if (terrainMesh) {
        const hits = raycaster.intersectObject(terrainMesh, false);
        if (hits.length > 0) hitPoint = hits[0].point;
      }

      // Fallback: flat ground plane at y=0 (for non-heightmap presets)
      if (!hitPoint) {
        const flatPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        if (raycaster.ray.intersectPlane(flatPlane, _planeHit)) {
          hitPoint = _planeHit;
        }
      }

      if (hitPoint) {
        const snapped = navGrid.snapToGrid(hitPoint.x, hitPoint.z);
        const tx = snapped.x;
        const tz = snapped.z;
        const ty = terrain.getTerrainY(tx, tz);
        selectedNPC.goTo(tx, tz);

        // Show click marker at terrain surface
        clickMarker.position.set(tx, ty + 0.05, tz);
        clickMarker.visible = true;
        markerLife = 0.6;
        return;
      }
    }

    // 3) Click on empty space — deselect
    if (selectedNPC) {
      selectNPC(null);
    }
  }

  // Cycle selected character with left/right arrows.
  // Order: player (null) → npc[0] → npc[1] → … → npc[last] → player
  function cycleCharacter(dir: 1 | -1): void {
    if (npcs.length === 0) return;
    // Current index: -1 = player, 0..n-1 = NPC
    const curIdx = selectedNPC ? npcs.indexOf(selectedNPC) : -1;
    const total = npcs.length + 1; // +1 for player
    // Step: player is slot 0, NPCs are slots 1..n
    const curSlot = curIdx + 1;
    const nextSlot = ((curSlot + dir) % total + total) % total;
    selectNPC(nextSlot === 0 ? null : npcs[nextSlot - 1]);
  }

  const onCycleKey = (e: KeyboardEvent) => {
    if (useGameStore.getState().phase !== 'playing') return;
    if (e.code === 'ArrowLeft') { cycleCharacter(-1); e.preventDefault(); }
    else if (e.code === 'ArrowRight') { cycleCharacter(1); e.preventDefault(); }
  };
  window.addEventListener('keydown', onCycleKey);

  // Listen for pointerup on canvas to detect clicks (non-drags).
  // Canvas listener fires before Camera's window listener resets dragConfirmed,
  // so we can read wasDrag() synchronously here.
  const onPointerUp = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (!cam.wasDrag()) {
      handleClick(e.clientX, e.clientY);
    }
  };
  canvas.addEventListener('pointerup', onPointerUp);

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
    const spawnY = terrain.getTerrainY(0, 0);
    player = new Player(scene, terrain, type, new THREE.Vector3(0, spawnY, 0));
    speechSystem.setCharacter(type);
    speechSystem.setPlayerMesh(player.mesh);
    useGameStore.getState().setCollectibles(0);
    useGameStore.getState().setActiveCharacter(type, CHARACTER_TEAM_COLORS[type]);
    inventories.clear(); // Reset all inventories on respawn
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
    onRegenerateScene: () => {
      regenerateScene();
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
      // Player movement, hop, torch — skip movement input when an NPC is selected
      // (arrows are used for character cycling in that mode)
      if (selectedNPC) {
        player.updateIdle(dt);
        player.updateTorch(dt);
      } else {
        player.update(dt, state, cam.getAngleY(), params);
      }

      // Update audio listener position for spatial SFX
      const pp = player.getPosition();
      audioSystem.setPlayerPosition(pp.x, pp.z);

      // Sync light preset
      const preset = useGameStore.getState().lightPreset;
      if (preset !== currentLightPreset) {
        currentLightPreset = preset;
        applyLightPreset(sceneLights, preset);
      }

      // Camera follows selected NPC or player
      const camTarget = selectedNPC ? selectedNPC.getCameraTarget() : player.getCameraTarget();
      cam.setTarget(camTarget.x, camTarget.y, camTarget.z);

      // Active character position (for collectibles, chests, loot)
      const activePos = selectedNPC ? selectedNPC.getPosition() : player.getPosition();

      // Collectibles
      const pickedUp = collectibles.update(dt, activePos);
      if (pickedUp > 0) {
        const total = collectibles.getTotalCollected();
        useGameStore.getState().setCollectibles(total);
        useGameStore.getState().setScore(total);
        audioSystem.sfx('pickup');
      }

      // Chests
      const chestsOpened = chestSystem.update(dt, activePos, params.stepHeight);
      if (chestsOpened > 0) audioSystem.sfx('chest');

      // Loot
      const loot = lootSystem.update(dt, activePos);
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

      // Click marker fade
      if (clickMarker.visible) {
        markerLife -= dt;
        if (markerLife <= 0) {
          clickMarker.visible = false;
        } else {
          markerMat.opacity = Math.min(0.8, markerLife * 2);
          clickMarker.scale.setScalar(1 + (0.6 - markerLife) * 0.5);
        }
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
      window.removeEventListener('keydown', onCycleKey);
      canvas.removeEventListener('pointerup', onPointerUp);
      input.destroy();
      cam.destroy();
      scene.remove(clickMarker);
      markerGeo.dispose();
      markerMat.dispose();
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
