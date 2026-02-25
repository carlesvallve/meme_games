import * as THREE from 'three';
import { useGameStore, DEFAULT_PLAYER_PARAMS, DEFAULT_CAMERA_PARAMS, DEFAULT_LIGHT_PRESET, DEFAULT_TORCH_PARAMS, DEFAULT_PARTICLE_TOGGLES, DEFAULT_SCENE_SETTINGS } from '../store';
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
import { EnemySystem, type HitImpactCallbacks } from './EnemySystem';
import { ProjectileSystem } from './ProjectileSystem';
import { GoreSystem } from './GoreSystem';
import { getProjectileConfig, getMuzzleOffset, isRangedHeroId } from './CombatConfig';
import { createDustMotes, createRainEffect, createDebrisEffect } from '../utils/particles';
import type { ParticleToggles } from '../store';
import type { ParticleSystem } from '../types';
import { audioSystem } from '../utils/AudioSystem';
import { updateReveal, patchSceneArchitecture } from './RevealShader';
import type { GameInstance } from '../types';
import { CHARACTER_TEAM_COLORS, getSlots, getCharacterName, rerollRoster, type CharacterType } from './characters';
import { VOX_HEROES, VOX_ENEMIES } from './VoxCharacterDB';

/** Nav cell size: 0.25m for all presets. */
function navCellForPreset(_preset: string): number {
  return 0.25;
}

/** Melee auto-aim: find nearest enemy within reach+margin and a wide cone, return snap facing or null. */
function findMeleeAimTarget(
  px: number, pz: number, currentFacing: number,
  enemies: ReadonlyArray<{ isAlive: boolean; mesh: { position: THREE.Vector3 } }>,
): number | null {
  const maxRange = 1.8;       // slightly beyond melee reach so you snap before closing gap
  const maxAngle = Math.PI * 0.6; // 108 deg cone (generous)

  let bestAngleDiff = maxAngle;
  let bestFacing: number | null = null;

  const fwdX = -Math.sin(currentFacing);
  const fwdZ = -Math.cos(currentFacing);

  for (const enemy of enemies) {
    if (!enemy.isAlive) continue;
    const dx = enemy.mesh.position.x - px;
    const dz = enemy.mesh.position.z - pz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > maxRange || dist < 0.01) continue;

    // Angle between current facing and direction to enemy
    const dot = fwdX * (dx / dist) + fwdZ * (dz / dist);
    const angleDiff = Math.acos(Math.min(1, Math.max(-1, dot)));
    if (angleDiff < bestAngleDiff) {
      bestAngleDiff = angleDiff;
      bestFacing = Math.atan2(-dx, -dz);
    }
  }

  return bestFacing;
}

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
  let currentRoomLabels = useGameStore.getState().roomLabels;
  applyLightPreset(sceneLights, currentLightPreset);

  // Camera (initial distance from store so zoom syncs with settings)
  const initialCamParams = useGameStore.getState().cameraParams;
  const cam = new Camera(window.innerWidth / window.innerHeight, canvas, {
    fov: initialCamParams.fov ?? 60,
    distance: initialCamParams.distance,
    angleX: -35,
    angleY: 45,
    onDistanceChange: (d) => useGameStore.getState().setCameraParam('distance', d),
    onPointerUpAfterDrag: () => useGameStore.getState().setLastPointerUpWasAfterDrag(true),
  });

  // Input
  const input = new Input();

  // Terrain + dependent systems (mutable for regeneration)
  const { terrainPreset: initPreset, heightmapStyle: initStyle, paletteName: initPalette } = useGameStore.getState();
  let terrain = new Terrain(scene, initPreset, initStyle, initPalette);
  useGameStore.getState().setPaletteActive(terrain.getPaletteName());
  const { playerParams: initParams } = useGameStore.getState();
  let navGrid = terrain.buildNavGrid(initParams.stepHeight, initParams.capsuleRadius, navCellForPreset(initPreset), initParams.slopeHeight);
  terrain.setGridOpacity(useGameStore.getState().gridOpacity);
  let collectibles = new CollectibleSystem(scene, terrain);
  let lootSystem = new LootSystem(scene, terrain);
  const usePropChestsOnly = initPreset === 'voxelDungeon';
  let chestSystem = new ChestSystem(scene, terrain, lootSystem, usePropChestsOnly);
  let enemySystem: EnemySystem | null = null;
  let projectileSystem: ProjectileSystem | null = null;
  let goreSystem = new GoreSystem(
    scene,
    (x, z) => terrain.getTerrainNormal(x, z),
    (x, z) => terrain.getTerrainY(x, z),
  );
  if (usePropChestsOnly) {
    terrain.setPropChestRegistrar((list) => list.forEach(({ position, mesh, entity, openGeo }) => chestSystem.registerPropChest(position, mesh, entity, openGeo)));
  }

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
    rerollRoster();

    // Dispose old systems
    for (const char of characters) char.dispose();
    characters = [];
    if (enemySystem) { enemySystem.dispose(); enemySystem = null; }
    if (projectileSystem) { projectileSystem.dispose(); projectileSystem = null; }
    goreSystem.dispose();
    goreSystem = new GoreSystem(
      scene,
      (x, z) => terrain.getTerrainNormal(x, z),
      (x, z) => terrain.getTerrainY(x, z),
    );
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
    navGrid = terrain.buildNavGrid(pp.stepHeight, pp.capsuleRadius, navCellForPreset(terrainPreset), pp.slopeHeight);
    terrain.setGridOpacity(useGameStore.getState().gridOpacity);
    collectibles = new CollectibleSystem(scene, terrain);
    lootSystem = new LootSystem(scene, terrain);
    const usePropChestsOnlyRegen = terrainPreset === 'voxelDungeon';
    chestSystem = new ChestSystem(scene, terrain, lootSystem, usePropChestsOnlyRegen);
    if (usePropChestsOnlyRegen) {
      terrain.setPropChestRegistrar((list) => list.forEach(({ position, mesh, entity, openGeo }) => chestSystem.registerPropChest(position, mesh, entity, openGeo)));
    }

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
  const allCharacterTypes = getSlots();
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
      useGameStore.getState().setActiveCharacter(getCharacterName(activeCharacter.characterType), CHARACTER_TEAM_COLORS[activeCharacter.characterType]);
    }
  }

  // Raycasting for character selection & terrain clicks
  const raycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();
  const _planeHit = new THREE.Vector3();

  // Click marker (visual feedback on terrain click)
  const markerGeo = new THREE.RingGeometry(0.04, 0.12, 16);
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

  /** Sync movement params from the store to all characters (for settings sliders). */
  let lastSyncedPlayerParams: ReturnType<typeof useGameStore.getState>['playerParams'] | null = null;
  function syncAllCharacterParams(): void {
    const pp = useGameStore.getState().playerParams;
    if (pp === lastSyncedPlayerParams) return;
    lastSyncedPlayerParams = pp;
    for (const char of characters) {
      const p = char.params;
      p.speed = pp.speed;
      p.stepHeight = pp.stepHeight;
      p.slopeHeight = pp.slopeHeight;
      p.capsuleRadius = pp.capsuleRadius;
      p.arrivalReach = pp.arrivalReach;
      p.hopHeight = pp.hopHeight;
      p.movementMode = pp.movementMode;
      p.showPathDebug = pp.showPathDebug;
      p.attackReach = pp.attackReach;
      p.attackArcHalf = pp.attackArcHalf;
      p.attackDamage = pp.attackDamage;
      p.attackCooldown = pp.attackCooldown;
      p.chaseRange = pp.chaseRange;
      p.knockbackSpeed = pp.knockbackSpeed;
      p.knockbackDecay = pp.knockbackDecay;
      p.invulnDuration = pp.invulnDuration;
      p.flashDuration = pp.flashDuration;
      p.stunDuration = pp.stunDuration;
      p.attackDuration = pp.attackDuration;
      p.exhaustDuration = pp.exhaustDuration;
    }
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

    let hitPoint: THREE.Vector3 | null = null;

    // Box meshes first (scattered/terraced) — single recursive call on the group
    const boxGroup = terrain.getBoxGroup();
    if (boxGroup.children.length > 0) {
      const boxHits = raycaster.intersectObject(boxGroup, true);
      // Skip LineSegments (grid overlays), only accept Mesh hits
      for (const h of boxHits) {
        if ((h.object as THREE.Mesh).isMesh && h.object.type === 'Mesh') {
          hitPoint = h.point;
          break;
        }
      }
    }

    // Terrain surface mesh (heightmap or floor plane) — only if no box hit
    if (!hitPoint) {
      const terrainMesh = terrain.getTerrainMesh();
      if (terrainMesh) {
        const hits = raycaster.intersectObject(terrainMesh, false);
        if (hits.length > 0) hitPoint = hits[0].point;
      }
    }

    // Fallback: flat y=0 plane
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
    else if (e.code === 'KeyR') {
      if (activeCharacter) {
        const pool = e.shiftKey ? VOX_ENEMIES : VOX_HEROES;
        const entry = pool[Math.floor(Math.random() * pool.length)];
        console.log(`[Game] Random ${e.shiftKey ? 'enemy' : 'hero'} skin: ${entry.name}`);
        speechSystem.onSkinChanged(activeCharacter);
        activeCharacter.applyVoxSkin(entry);
      }
      e.preventDefault();
    }
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

    // Spawn only the controlled hero
    {
      const spawnY = terrain.getTerrainY(0, 0);
      const pos = navGrid.isWalkable(0, 0)
        ? new THREE.Vector3(0, spawnY, 0)
        : terrain.getRandomPosition();

      const char = new Character(scene, terrain, navGrid, controlledType, pos, ladderDefs);
      char.setPlayerControlled(makePlayerControlDeps());
      characters.push(char);
      activeCharacter = char;
    }

    // Register all characters for speech bubbles
    speechSystem.setCharacters(characters);

    if (activeCharacter) {
      useGameStore.getState().setCollectibles(0);
      useGameStore.getState().setHP(10, 10);
      useGameStore.getState().setActiveCharacter(getCharacterName(controlledType), CHARACTER_TEAM_COLORS[controlledType]);
    }

    // Spawn enemies + projectile system
    if (enemySystem) enemySystem.dispose();
    if (projectileSystem) projectileSystem.dispose();
    enemySystem = new EnemySystem(scene, terrain, navGrid, lootSystem, ladderDefs);
    enemySystem.setGoreSystem(goreSystem);
    projectileSystem = new ProjectileSystem(scene);
    enemySystem.setAllyCharacters(characters);
    enemySystem.impactCallbacks = {
      onHitstop: (duration) => triggerHitstop(duration),
      onCameraShake: (intensity, duration, dirX, dirZ) => cam.shake(intensity, duration, dirX, dirZ),
    };
    enemySystem.spawnEnemies(0);
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
      const d = DEFAULT_PLAYER_PARAMS;
      const store = useGameStore.getState();
      store.setPlayerParam('speed', d.speed);
      store.setPlayerParam('stepHeight', d.stepHeight);
      store.setPlayerParam('slopeHeight', d.slopeHeight);
      store.setPlayerParam('capsuleRadius', d.capsuleRadius);
      store.setPlayerParam('arrivalReach', d.arrivalReach);
      store.setPlayerParam('hopHeight', d.hopHeight);
      store.setPlayerParam('magnetRadius', d.magnetRadius);
      store.setPlayerParam('magnetSpeed', d.magnetSpeed);
      // syncAllCharacterParams will pick up the changes next frame
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
      store.setRoomLabels(d.roomLabels);
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
  let hitstopTimer = 0;

  /** Trigger a hitstop (freeze gameplay for a duration). */
  function triggerHitstop(duration: number): void {
    hitstopTimer = Math.max(hitstopTimer, duration);
  }

  function update(dt: number): void {
    // Hitstop: freeze gameplay but keep rendering
    if (hitstopTimer > 0) {
      hitstopTimer -= dt;
      // Still update camera (shake plays during hitstop)
      cam.updatePosition(dt);
      // Don't call input.update() — queued actions survive until gameplay resumes
      return;
    }
    cachedInputState = input.update();
    const { phase, cameraParams, settingsPanelOpen } = useGameStore.getState();
    cam.setParams(cameraParams);

    // Check for character selection
    const selected = useGameStore.getState().selectedCharacter;
    if (selected && selected !== lastSelectedCharacter) {
      lastSelectedCharacter = selected;
      spawnCharacters(selected);
    }

    if ((phase === 'playing' || phase === 'player_dead') && activeCharacter && !settingsPanelOpen) {
      const playerChar = activeCharacter;
      // Sync active character's movement params from settings sliders
      syncAllCharacterParams();

      // Player attack on Space only while alive (before character update so attack state is set for this frame)
      if (phase === 'playing' && cachedInputState.action) {
        const heroId = playerChar.voxEntry?.id ?? '';
        const projConfig = getProjectileConfig(heroId);
        if (projConfig && projectileSystem) {
          // Ranged: play attack anim + fire from muzzle (spawn point)
          playerChar.startAttack();
          const pos = playerChar.getPosition();
          const facing = playerChar.facing;
          const muzzle = getMuzzleOffset(heroId);
          const faceDirX = -Math.sin(facing);
          const faceDirZ = -Math.cos(facing);
          const spawnX = pos.x + faceDirX * muzzle.forward;
          const spawnY = playerChar.groundY + muzzle.up;
          const spawnZ = pos.z + faceDirZ * muzzle.forward;
          projectileSystem.fireProjectile(
            heroId,
            projConfig,
            spawnX, spawnY, spawnZ,
            facing,
            enemySystem ? enemySystem.getEnemies() : [],
            [
              terrain.getBoxGroup(),
              ...(terrain.getTerrainMesh() ? [terrain.getTerrainMesh()!] : []),
            ],
          );
        } else {
          // Melee: auto-aim snap toward nearest enemy, then attack
          if (enemySystem) {
            const pos = playerChar.getPosition();
            const aimTarget = findMeleeAimTarget(pos.x, pos.z, playerChar.facing, enemySystem.getEnemies());
            if (aimTarget !== null) {
              playerChar.facing = aimTarget;
              playerChar.mesh.rotation.y = aimTarget;
            }
          }
          playerChar.startAttack();
        }
      }

      // Update all characters uniformly
      for (const char of characters) {
        char.update(dt);
      }

      // Gore system (body chunks + blood decals)
      goreSystem.update(dt);

      // Enemy system
      if (enemySystem) {
        const showSlashEffect = useGameStore.getState().playerParams.showSlashEffect;
        enemySystem.update(dt, playerChar,
          (damage) => {
            const s = useGameStore.getState();
            const newHp = Math.max(0, s.hp - damage);
            s.setHP(newHp, s.maxHp);
            if (newHp <= 0) {
              s.setPhase('player_dead');
              const pos = playerChar.mesh.position.clone();
              goreSystem.spawnGore(playerChar.mesh, playerChar.groundY, []);
              lootSystem.spawnLoot(pos);
              audioSystem.sfxAt('death', pos.x, pos.z);
              playerChar.hideBody();
            }
          },
          () => {
            const s = useGameStore.getState();
            s.setScore(s.score + 10);
          },
          showSlashEffect,
        );
      }

      // Projectile system
      if (projectileSystem && enemySystem) {
        projectileSystem.update(dt, enemySystem.getEnemies(), (info) => {
          // VFX: damage number + hit sparks
          enemySystem!.spawnDamageNumber(info.x, info.y, info.z, info.damage);
          enemySystem!.spawnHitSparks(info.x, info.y, info.z, info.dirX, info.dirZ);
          enemySystem!.spawnBloodSplash(info.x, info.y, info.z, info.enemy.groundY);
          audioSystem.sfxAt('fleshHit', info.x, info.z);

          // Impact feel
          const isKill = !info.enemy.isAlive;
          if (enemySystem!.impactCallbacks) {
            enemySystem!.impactCallbacks.onHitstop(isKill ? 0.1 : 0.06);
            enemySystem!.impactCallbacks.onCameraShake(
              isKill ? 0.2 : 0.12, isKill ? 0.2 : 0.12, info.dirX, info.dirZ,
            );
          }

          // Score on kill
          if (isKill) {
            const s = useGameStore.getState();
            s.setScore(s.score + 10);
          }
        }, {
          getGroundY: terrainHeightAt,
          terrainColliders: [
            terrain.getBoxGroup(),
            ...(terrain.getTerrainMesh() ? [terrain.getTerrainMesh()!] : []),
          ],
        });
      }

      // Update audio listener position for spatial SFX
      const pp = activeCharacter.getPosition();
      audioSystem.setPlayerPosition(pp.x, pp.z);

      // Auto-patch any new Architecture-layer materials (e.g. async-loaded vox doors)
      patchSceneArchitecture();

      // X-ray reveal: always on for dungeons, raycast-gated for heightmap
      const playerWorldPos = new THREE.Vector3(pp.x, activeCharacter.mesh.position.y + 0.5, pp.z);
      const isDungeonPreset = terrain.preset === 'dungeon' || terrain.preset === 'rooms' || terrain.preset === 'voxelDungeon';
      let isOccluded = isDungeonPreset;
      if (!isDungeonPreset) {
        const revealRayDir = new THREE.Vector3().subVectors(playerWorldPos, cam.camera.position).normalize();
        const revealRay = new THREE.Raycaster(cam.camera.position.clone(), revealRayDir);
        const camToPlayerDist = cam.camera.position.distanceTo(playerWorldPos);
        const terrainMesh = terrain.getTerrainMesh();
        if (terrainMesh) {
          const hits = revealRay.intersectObject(terrainMesh);
          isOccluded = hits.some(h => h.distance < camToPlayerDist - 0.5);
        }
      }
      updateReveal(playerWorldPos, cam.camera.position, isOccluded, terrain.preset);

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

      // Sync room labels (voxel dungeon)
      const roomLabels = useGameStore.getState().roomLabels;
      if (roomLabels !== currentRoomLabels) {
        currentRoomLabels = roomLabels;
        terrain.setRoomLabelsVisible(roomLabels);
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

      // Doors — all characters + enemies can interact
      const doorSystem = terrain.getDoorSystem();
      if (doorSystem) {
        const charPositions = characters.map(c => c.getPosition());
        if (enemySystem) {
          charPositions.push(...enemySystem.getEnemyPositions());
        }
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

      // HP bars (billboard, face camera)
      for (const char of characters) {
        char.updateHpBar(cam.camera);
      }
      if (enemySystem) {
        for (const enemy of enemySystem.getEnemies()) {
          enemy.updateHpBar(cam.camera);
        }
      }

      // Speech bubbles
      speechSystem.update(dt);

      // Pause on Escape (only while playing, not during death sequence)
      if (phase === 'playing' && cachedInputState.cancel) {
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
      if (enemySystem) enemySystem.dispose();
      if (projectileSystem) projectileSystem.dispose();
      goreSystem.dispose();
      terrain.dispose();
      collectibles.dispose();
      chestSystem.dispose();
      lootSystem.dispose();
      speechSystem.dispose();
      renderer.dispose();
    },
  };
}
