import * as THREE from 'three';
import { useGameStore, DEFAULT_PLAYER_PARAMS, DEFAULT_CAMERA_PARAMS, DEFAULT_LIGHT_PRESET, DEFAULT_TORCH_PARAMS, DEFAULT_PARTICLE_TOGGLES, DEFAULT_SCENE_SETTINGS, saveCharacterParams, clearCharacterParams } from '../store';
import { Input } from './Input';
import { Camera } from './Camera';
import { createScene, applyLightPreset } from './Scene';
import type { LightPreset } from '../store';
import { Terrain } from './Terrain';
import { randomPalette } from './ColorPalettes';
import { CollectibleSystem } from './Collectible';
import { ChestSystem } from './Chest';
import { LootSystem } from './Loot';
import { SpeechBubbleSystem } from './SpeechBubble';
import { Character } from './Character';
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
  let currentGridOpacity = useGameStore.getState().gridOpacity;
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
  const { terrainPreset: initPreset, heightmapStyle: initStyle, paletteName: initPalette } = useGameStore.getState();
  let terrain = new Terrain(scene, initPreset, initStyle, initPalette);
  useGameStore.getState().setPaletteActive(terrain.getPaletteName());
  const { playerParams: initParams } = useGameStore.getState();
  let navGrid = terrain.buildNavGrid(initParams.stepHeight, initParams.capsuleRadius, 0.5, initParams.slopeHeight);
  terrain.setGridOpacity(useGameStore.getState().gridOpacity);
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
    activeCharacter = null;
    debugLadderIndex = -1;

    // Dispose old systems
    for (const char of characters) char.dispose();
    characters = [];
    chestSystem.dispose();
    lootSystem.dispose();
    collectibles.dispose();
    terrain.dispose();
    scene.remove(terrain.group);

    // Read current settings from store
    const { terrainPreset, heightmapStyle, playerParams: pp, paletteName: palPick } = useGameStore.getState();

    // Rebuild
    terrain = new Terrain(scene, terrainPreset, heightmapStyle, palPick);
    useGameStore.getState().setPaletteActive(terrain.getPaletteName());
    navGrid = terrain.buildNavGrid(pp.stepHeight, pp.capsuleRadius, 0.5, pp.slopeHeight);
    terrain.setGridOpacity(useGameStore.getState().gridOpacity);
    collectibles = new CollectibleSystem(scene, terrain);
    lootSystem = new LootSystem(scene, terrain);
    chestSystem = new ChestSystem(scene, terrain, lootSystem);

    // Re-spawn characters if a character was selected
    if (lastSelectedCharacter) {
      spawnCharacters(lastSelectedCharacter);
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

  // ── Unified character system ──────────────────────────────────────
  const allCharacterTypes: CharacterType[] = ['boy', 'girl', 'robot', 'dog'];
  let characters: Character[] = [];
  let activeCharacter: Character | null = null;
  let lastSelectedCharacter: CharacterType | null = null;

  // Cached input state for PlayerControl deps
  let cachedInputState = input.update();

  // Per-character inventory
  interface CharInventory { collectibles: number; coins: number; potions: number; }
  const inventories = new Map<string, CharInventory>();

  function getInventoryKey(): string {
    return activeCharacter ? `char:${activeCharacter.characterType}` : 'unknown';
  }

  function getInventory(): CharInventory {
    const key = getInventoryKey();
    if (!inventories.has(key)) inventories.set(key, { collectibles: 0, coins: 0, potions: 0 });
    return inventories.get(key)!;
  }

  function saveActiveInventory(): void {
    const inv = getInventory();
    const s = useGameStore.getState();
    inv.collectibles = s.collectibles;
    inv.coins = s.coins;
    inv.potions = s.potions;
  }

  function loadActiveInventory(): void {
    const inv = getInventory();
    useGameStore.getState().setCollectibles(inv.collectibles);
    useGameStore.setState({ coins: inv.coins, potions: inv.potions });
  }

  function updateActiveCharacterUI(): void {
    if (activeCharacter) {
      useGameStore.getState().setActiveCharacter(activeCharacter.characterType, CHARACTER_TEAM_COLORS[activeCharacter.characterType]);
    }
  }

  // Raycasting for character selection & terrain clicks
  const raycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();
  const _planeHit = new THREE.Vector3();

  // Click marker (visual feedback on terrain click)
  const markerGeo = new THREE.RingGeometry(0.08, 0.2, 16);
  markerGeo.rotateX(-Math.PI / 2);
  const markerMat = new THREE.MeshBasicMaterial({ color: 0x00ffaa, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
  const clickMarker = new THREE.Mesh(markerGeo, markerMat);
  clickMarker.visible = false;
  scene.add(clickMarker);
  let markerLife = 0;

  /** PlayerControl dependency injection — reads from cached per-frame state */
  function makePlayerControlDeps() {
    return {
      getInput: () => cachedInputState,
      getCameraAngleY: () => cam.getAngleY(),
      getParams: () => activeCharacter!.params,
    };
  }

  /** Sync the active character's movement params from the store (for settings sliders). */
  let lastSyncedPlayerParams: ReturnType<typeof useGameStore.getState>['playerParams'] | null = null;
  function syncActiveCharacterParams(): void {
    if (!activeCharacter) return;
    const pp = useGameStore.getState().playerParams;
    // Only sync + save when the store's playerParams object actually changed (slider moved)
    if (pp === lastSyncedPlayerParams) return;
    lastSyncedPlayerParams = pp;
    const p = activeCharacter.params;
    p.speed = pp.speed;
    p.stepHeight = pp.stepHeight;
    p.slopeHeight = pp.slopeHeight;
    p.capsuleRadius = pp.capsuleRadius;
    p.arrivalReach = pp.arrivalReach;
    p.hopHeight = pp.hopHeight;
    saveCharacterParams(activeCharacter.characterType, p);
  }

  function selectCharacter(char: Character | null): void {
    if (char === activeCharacter) return;

    // Save current character's inventory before switching
    saveActiveInventory();

    // Revert old active to AI
    if (activeCharacter) {
      activeCharacter.setAIControlled();
    }

    activeCharacter = char;

    // Set new one to player-controlled
    if (char) {
      char.setPlayerControlled(makePlayerControlDeps());
      speechSystem.setCharacter(char.characterType);
      speechSystem.setPlayerMesh(char.mesh);

      // Load this character's movement params into the store so sliders reflect them
      const p = char.params;
      const store = useGameStore.getState();
      store.setPlayerParam('speed', p.speed);
      store.setPlayerParam('stepHeight', p.stepHeight);
      store.setPlayerParam('slopeHeight', p.slopeHeight);
      store.setPlayerParam('capsuleRadius', p.capsuleRadius);
      store.setPlayerParam('arrivalReach', p.arrivalReach);
      store.setPlayerParam('hopHeight', p.hopHeight);
    }

    // Load new character's inventory
    loadActiveInventory();
    updateActiveCharacterUI();
  }

  /** Raycast terrain at screen coords, return snapped world position or null */
  function raycastTerrain(clientX: number, clientY: number): { x: number; z: number; y: number } | null {
    pointerNDC.x = (clientX / window.innerWidth) * 2 - 1;
    pointerNDC.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, cam.camera);

    const terrainMesh = terrain.getTerrainMesh();
    let hitPoint: THREE.Vector3 | null = null;

    if (terrainMesh) {
      const hits = raycaster.intersectObject(terrainMesh, false);
      if (hits.length > 0) hitPoint = hits[0].point;
    }

    if (!hitPoint) {
      const flatPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      if (raycaster.ray.intersectPlane(flatPlane, _planeHit)) {
        hitPoint = _planeHit;
      }
    }

    if (!hitPoint) return null;
    const snapped = navGrid.snapToGrid(hitPoint.x, hitPoint.z);
    return { x: snapped.x, z: snapped.z, y: terrain.getTerrainY(snapped.x, snapped.z) };
  }

  /** Send the active character to a terrain position and show click marker */
  function sendActiveCharTo(tx: number, tz: number, ty: number): void {
    if (!activeCharacter) return;
    activeCharacter.goTo(tx, tz);
    clickMarker.position.set(tx, ty + 0.05, tz);
    clickMarker.visible = true;
    markerLife = 0.6;
  }

  function handleClick(clientX: number, clientY: number): void {
    if (useGameStore.getState().phase !== 'playing') return;

    pointerNDC.x = (clientX / window.innerWidth) * 2 - 1;
    pointerNDC.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, cam.camera);

    // 1) Check character meshes (exclude active character)
    const otherChars = characters.filter(c => c !== activeCharacter);
    const charMeshes = otherChars.map(c => c.mesh);
    const charHits = raycaster.intersectObjects(charMeshes, true);
    if (charHits.length > 0) {
      const hitObj = charHits[0].object;
      const char = otherChars.find(c => c.mesh === hitObj || hitObj.parent === c.mesh || c.mesh === hitObj.parent);
      if (char) {
        selectCharacter(char);
        return;
      }
    }

    // 2) Clicking terrain sends the active character there (click-to-move)
    const hit = raycastTerrain(clientX, clientY);
    if (hit) {
      sendActiveCharTo(hit.x, hit.z, hit.y);
    }
  }

  // Cycle selected character with left/right arrows
  function cycleCharacter(dir: 1 | -1): void {
    if (characters.length === 0) return;
    const curIdx = activeCharacter ? characters.indexOf(activeCharacter) : -1;
    const nextIdx = ((curIdx + dir) % characters.length + characters.length) % characters.length;
    selectCharacter(characters[nextIdx]);
  }

  // Debug: cycle through ladders with L key
  let debugLadderIndex = -1; // -1 = follow character (normal mode)

  const onCycleKey = (e: KeyboardEvent) => {
    if (useGameStore.getState().phase !== 'playing') return;
    if (e.code === 'ArrowLeft') { cycleCharacter(-1); e.preventDefault(); }
    else if (e.code === 'ArrowRight') { cycleCharacter(1); e.preventDefault(); }
    else if (e.code === 'KeyL') {
      const ladders = terrain.getLadderDefs();
      if (ladders.length === 0) return;
      debugLadderIndex++;
      if (debugLadderIndex >= ladders.length) debugLadderIndex = -1;
      if (debugLadderIndex >= 0) {
        const l = ladders[debugLadderIndex];
        console.log(`[Debug] Ladder ${debugLadderIndex}/${ladders.length - 1}: h=${(l.topY - l.bottomY).toFixed(1)}m at (${l.bottomX.toFixed(1)}, ${l.bottomZ.toFixed(1)})`);
      } else {
        console.log('[Debug] Camera back to character');
      }
      e.preventDefault();
    }
  };
  window.addEventListener('keydown', onCycleKey);

  // Pointer drag for continuous click-to-move: hold and drag to update path
  const DRAG_REPATH_ENABLED = false;
  let pointerDragActive = false;
  let lastDragX = 0;
  let lastDragZ = 0;
  const DRAG_REPATH_DIST = 0.5; // min world distance between repath updates

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    pointerDragActive = false; // reset, will be set true on first drag move
  };
  canvas.addEventListener('pointerdown', onPointerDown);

  const onPointerMove = (e: PointerEvent) => {
    if (!DRAG_REPATH_ENABLED) return;
    if (!(e.buttons & 1)) { pointerDragActive = false; return; }
    if (useGameStore.getState().phase !== 'playing') return;
    if (!activeCharacter) return;

    // Only start drag-pathing once camera confirms a drag (not just a click)
    if (!cam.wasDrag()) return;

    const hit = raycastTerrain(e.clientX, e.clientY);
    if (!hit) return;

    // Throttle: only repath if target moved enough
    if (pointerDragActive) {
      const dx = hit.x - lastDragX;
      const dz = hit.z - lastDragZ;
      if (dx * dx + dz * dz < DRAG_REPATH_DIST * DRAG_REPATH_DIST) return;
    }

    pointerDragActive = true;
    lastDragX = hit.x;
    lastDragZ = hit.z;
    sendActiveCharTo(hit.x, hit.z, hit.y);
  };
  canvas.addEventListener('pointermove', onPointerMove);

  const onPointerUp = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (pointerDragActive) {
      // Final path update on release
      const hit = raycastTerrain(e.clientX, e.clientY);
      if (hit) sendActiveCharTo(hit.x, hit.z, hit.y);
      pointerDragActive = false;
    } else if (!cam.wasDrag()) {
      handleClick(e.clientX, e.clientY);
    }
  };
  canvas.addEventListener('pointerup', onPointerUp);

  function spawnCharacters(controlledType: CharacterType): void {
    // Dispose old characters
    for (const char of characters) char.dispose();
    characters = [];
    activeCharacter = null;
    inventories.clear();

    const ladderDefs = terrain.getLadderDefs();

    for (const type of allCharacterTypes) {
      // Spawn position: validate (0,0) for the controlled character, random for others
      let pos: THREE.Vector3;
      if (type === controlledType) {
        // Use (0,0) if walkable, otherwise fallback to random
        const spawnY = terrain.getTerrainY(0, 0);
        if (navGrid.isWalkable(0, 0)) {
          pos = new THREE.Vector3(0, spawnY, 0);
        } else {
          pos = terrain.getRandomPosition();
        }
      } else {
        pos = terrain.getRandomPosition();
      }

      const char = new Character(scene, terrain, navGrid, type, pos, ladderDefs);
      characters.push(char);

      if (type === controlledType) {
        char.setPlayerControlled(makePlayerControlDeps());
        activeCharacter = char;
      }
    }

    if (activeCharacter) {
      speechSystem.setCharacter(controlledType);
      speechSystem.setPlayerMesh(activeCharacter.mesh);
      useGameStore.getState().setCollectibles(0);
      useGameStore.getState().setActiveCharacter(controlledType, CHARACTER_TEAM_COLORS[controlledType]);
    }
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
    onRemesh: () => {
      terrain.remesh();
    },
    onRandomizePalette: () => {
      const { name, palette } = randomPalette();
      terrain.applyPalette(palette, name);
      useGameStore.getState().setPaletteActive(name);
    },
    onResetPlayerParams: () => {
      if (!activeCharacter) return;
      const d = DEFAULT_PLAYER_PARAMS;
      activeCharacter.params.speed = d.speed;
      activeCharacter.params.stepHeight = d.stepHeight;
      activeCharacter.params.slopeHeight = d.slopeHeight;
      activeCharacter.params.capsuleRadius = d.capsuleRadius;
      activeCharacter.params.arrivalReach = d.arrivalReach;
      activeCharacter.params.hopHeight = d.hopHeight;
      clearCharacterParams(activeCharacter.characterType);
      const store = useGameStore.getState();
      store.setPlayerParam('speed', d.speed);
      store.setPlayerParam('stepHeight', d.stepHeight);
      store.setPlayerParam('slopeHeight', d.slopeHeight);
      store.setPlayerParam('capsuleRadius', d.capsuleRadius);
      store.setPlayerParam('arrivalReach', d.arrivalReach);
      store.setPlayerParam('hopHeight', d.hopHeight);
      store.setPlayerParam('magnetRadius', d.magnetRadius);
      store.setPlayerParam('magnetSpeed', d.magnetSpeed);
    },
    onResetCameraParams: () => {
      const d = DEFAULT_CAMERA_PARAMS;
      const store = useGameStore.getState();
      for (const key of Object.keys(d) as (keyof typeof d)[]) {
        store.setCameraParam(key, d[key]);
      }
    },
    onResetLightParams: () => {
      const store = useGameStore.getState();
      store.setLightPreset(DEFAULT_LIGHT_PRESET);
      if (!store.torchEnabled !== !true) store.toggleTorch(); // ensure torch is on
      const td = DEFAULT_TORCH_PARAMS;
      for (const key of Object.keys(td) as (keyof typeof td)[]) {
        store.setTorchParam(key, td[key]);
      }
    },
    onResetSceneParams: () => {
      const d = DEFAULT_SCENE_SETTINGS;
      const store = useGameStore.getState();
      store.setTerrainPreset(d.terrainPreset);
      store.setHeightmapStyle(d.heightmapStyle);
      store.setPaletteName(d.paletteName);
      store.setWallGap(d.wallGap);
      store.setGridOpacity(d.gridOpacity);
      store.setResolutionScale(d.resolutionScale);
      const dp = DEFAULT_PARTICLE_TOGGLES;
      for (const key of Object.keys(dp) as (keyof typeof dp)[]) {
        if (store.particleToggles[key] !== dp[key]) store.toggleParticle(key);
      }
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
    cachedInputState = input.update();
    const { phase, cameraParams } = useGameStore.getState();
    cam.setParams(cameraParams);

    // Check for character selection
    const selected = useGameStore.getState().selectedCharacter;
    if (selected && selected !== lastSelectedCharacter) {
      lastSelectedCharacter = selected;
      spawnCharacters(selected);
    }

    if (phase === 'playing' && activeCharacter) {
      // Sync active character's movement params from settings sliders
      syncActiveCharacterParams();

      // Update all characters uniformly
      for (const char of characters) {
        char.update(dt);
      }

      // Update audio listener position for spatial SFX
      const pp = activeCharacter.getPosition();
      audioSystem.setPlayerPosition(pp.x, pp.z);

      // Sync light preset
      const preset = useGameStore.getState().lightPreset;
      if (preset !== currentLightPreset) {
        currentLightPreset = preset;
        applyLightPreset(sceneLights, preset);
      }

      // Sync grid opacity
      const gridOp = useGameStore.getState().gridOpacity;
      if (gridOp !== currentGridOpacity) {
        currentGridOpacity = gridOp;
        terrain.setGridOpacity(gridOp);
      }

      // Camera follows active character (or debug ladder)
      if (debugLadderIndex >= 0) {
        const ladders = terrain.getLadderDefs();
        const l = ladders[debugLadderIndex];
        if (l) {
          const midY = (l.bottomY + l.topY) / 2;
          cam.setTarget(l.bottomX, midY, l.bottomZ);
        }
      } else {
        const camTarget = activeCharacter.getCameraTarget();
        cam.setTarget(camTarget.x, camTarget.y, camTarget.z);
      }

      // Active character position (for collectibles, chests, loot)
      const activePos = activeCharacter.getPosition();
      const params = useGameStore.getState().playerParams;

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

      // Doors — all characters can interact
      const doorSystem = terrain.getDoorSystem();
      if (doorSystem) {
        const charPositions = characters.map(c => c.getPosition());
        doorSystem.update(dt, charPositions, params.stepHeight);
      }

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
      if (cachedInputState.cancel) {
        useGameStore.getState().onPauseToggle?.();
      }
    } else if (phase === 'playing') {
      // No characters yet, still update collectibles visually
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
    terrain.updateWater(dt, renderer, scene, cam.camera);
    renderer.render(scene, cam.camera);
  }

  rafId = requestAnimationFrame(loop);

  return {
    destroy() {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onCycleKey);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      input.destroy();
      cam.destroy();
      scene.remove(clickMarker);
      markerGeo.dispose();
      markerMat.dispose();
      for (const sys of Object.values(particleSystems)) {
        if (sys) sys.dispose();
      }
      for (const char of characters) char.dispose();
      terrain.dispose();
      collectibles.dispose();
      chestSystem.dispose();
      lootSystem.dispose();
      speechSystem.dispose();
      renderer.dispose();
    },
  };
}
