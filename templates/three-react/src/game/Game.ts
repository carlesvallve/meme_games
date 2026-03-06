import * as THREE from 'three';
import { useGameStore } from '../store';
import { Input } from './core/Input';
import { entityRegistry } from './core/Entity';
import {
  Camera,
  createScene,
  applyLightPreset,
  PostProcessStack,
  DeathSequence,
  getSkyColors,
} from './rendering';
import { Environment } from './environment';
import { CollectibleSystem, ChestSystem, SpeechBubbleSystem } from './props';
import {
  LootSystem,
  GoreSystem,
  PotionEffectSystem,
  PotionVFX,
} from './combat';
import { audioSystem } from '../utils/AudioSystem';
import type { GameInstance } from '../types';
import type { GameContext } from './GameContext';
import { createSceneManager } from './GameSceneManager';
import { createCharacterManager } from './GameCharacters';
import { createInputManager } from './GameInput';
import { createCallbacks } from './GameCallbacks';
import { createGameLoop } from './GameLoop';
import { generateWorldName } from './overworld';
import type { OverworldState } from './overworld';
// ── HMR terrain cache ─────────────────────────────────────────────
interface TerrainCache {
  terrain: Environment;
  navGrid: ReturnType<Environment['buildNavGrid']>;
  paramsKey: string;
}
interface HmrCache {
  __terrainCache?: TerrainCache | null;
  __hmrCharPos?: { x: number; y: number; z: number };
  __hmrCharFacing?: number;
  __hmrCharType?: string;
  __hmrCamAngleX?: number;
  __hmrCamAngleY?: number;
  __hmrCamDistance?: number;
}
const _hc = window as unknown as HmrCache;
function getTerrainCache(): TerrainCache | null {
  return _hc.__terrainCache ?? null;
}
function setTerrainCache(v: TerrainCache | null): void {
  _hc.__terrainCache = v;
}

/** Build a stable key from the store params that drive terrain generation. */
function terrainParamsKey(): string {
  const s = useGameStore.getState();
  return JSON.stringify({
    terrainPreset: s.terrainPreset,
    heightmapStyle: s.heightmapStyle,
    paletteName: s.paletteName,
    roomSpacing: s.roomSpacing,
    tileSize: s.tileSize,
    doorChance: s.doorChance,
    dungeonSize: s.dungeonSize,
    resolutionScale: s.resolutionScale,
    natureEnabled: s.natureEnabled,
    useBiomes: s.useBiomes,
  });
}

/** Nav cell size: 0.25m for all presets. */
function navCellForPreset(_preset: string): number {
  return 0.25;
}

export function createGame(canvas: HTMLCanvasElement): GameInstance {
  // Renderer
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Scene
  const { scene, lights: sceneLights, sceneSky } = createScene();
  const initialLightPreset = useGameStore.getState().lightPreset;
  const initialIsExterior = useGameStore.getState().terrainPreset === 'heightmap';
  applyLightPreset(sceneLights, initialLightPreset, initialIsExterior);

  // Camera
  const initialCamParams = useGameStore.getState().cameraParams;
  const cam = new Camera(window.innerWidth / window.innerHeight, canvas, {
    fov: initialCamParams.fov ?? 60,
    distance: initialCamParams.distance,
    angleX: -35,
    angleY: 45,
    onDistanceChange: (d) =>
      useGameStore.getState().setCameraParam('distance', d),
    onPointerUpAfterDrag: () =>
      useGameStore.getState().setLastPointerUpWasAfterDrag(true),
  });

  // Post-processing
  const postProcess = new PostProcessStack(renderer, scene, cam.camera);
  postProcess.sync(useGameStore.getState().postProcess);

  // Input
  const input = new Input();

  // ── Terrain + dependent systems ─────────────────────────────────
  const {
    terrainPreset: initPreset,
    heightmapStyle: initStyle,
    paletteName: initPalette,
  } = useGameStore.getState();
  const currentParamsKey = terrainParamsKey();
  let terrain: Environment;
  let navGrid: ReturnType<Environment['buildNavGrid']>;
  let hmrReused = false;
  let initSeed = 0;

  const hmrCacheEnabled = useGameStore.getState().hmrCacheEnabled;
  const cached = hmrCacheEnabled ? getTerrainCache() : null;
  if (cached && cached.paramsKey === currentParamsKey) {
    terrain = cached.terrain;
    navGrid = cached.navGrid;
    scene.add(terrain.group);
    terrain.reregisterEntities();
    hmrReused = true;
    if (_hc.__hmrCamAngleX != null) {
      cam.setOrbit(_hc.__hmrCamAngleX, _hc.__hmrCamAngleY!, _hc.__hmrCamDistance!);
    }
    if (_hc.__hmrCharPos) {
      const cp = _hc.__hmrCharPos;
      cam.setTarget(cp.x, cp.y, cp.z);
      cam.updatePosition(1000);
    }
  } else {
    if (cached) {
      cached.terrain.dispose();
      setTerrainCache(null);
    }
    initSeed = useGameStore.getState().getFloorSeed(useGameStore.getState().floor);
    terrain = new Environment(scene, initPreset, initStyle, initPalette, initSeed);
    const { characterParams: initParams } = useGameStore.getState();
    navGrid = terrain.buildNavGrid(
      initParams.stepHeight,
      initParams.capsuleRadius,
      navCellForPreset(initPreset),
      initParams.slopeHeight,
    );
    useGameStore.getState().setWalkableCells(navGrid.getWalkableCellCount());
  }

  cam.terrainHeightAt = (x, z) => terrain.getFloorY(x, z);
  cam.terrainMesh = terrain.getTerrainMesh();
  useGameStore.getState().setPaletteActive(terrain.getPaletteName());
  sceneSky.setPalette(terrain.getPaletteName());
  terrain.setGridOpacity(useGameStore.getState().gridOpacity);

  // Initialize overworld state on app start (so world name is ready before char selection)
  // Use initSeed (the actual seed passed to Environment) not dungeonBaseSeed (they differ via floorSeed hash)
  if (initPreset === 'overworld' && !hmrReused) {
    const owMap = terrain.getOverworldMap();
    if (owMap) {
      const owState: OverworldState = {
        activeTileIndex: null,
        savedPlayerPos: null,
        zoomSpawnNorm: null,
        zoomSpawnFacing: null,
        tiles: owMap.getTileDefs(),
        baseSeed: initSeed,
        worldName: generateWorldName(initSeed),
        clearedDungeons: [],
        pendingPoiDungeon: null,
      };
      useGameStore.getState().setOverworldState(owState);
      useGameStore.getState().setZoneName(owState.worldName);
    }
  }
  const initSpawn = terrain.getEntrancePosition();
  const initGemCount =
    initPreset === 'voxelDungeon'
      ? Math.max(2, Math.ceil(terrain.getRoomCount() / 2))
      : undefined;
  let collectibles = new CollectibleSystem(
    scene, terrain,
    initSpawn ? { x: initSpawn.x, z: initSpawn.z } : undefined,
    initGemCount,
  );
  let lootSystem = new LootSystem(scene, terrain);
  let potionSystem = new PotionEffectSystem(useGameStore.getState().dungeonBaseSeed);
  let potionVFX = new PotionVFX(scene);
  (window as any).__potionEffectSystem = potionSystem;
  lootSystem.setPotionSystem(potionSystem);
  const usePropChestsOnly = initPreset === 'voxelDungeon';
  const initChestCap = initPreset === 'heightmap' ? 3 : undefined;
  let chestSystem = new ChestSystem(scene, terrain, lootSystem, usePropChestsOnly, initChestCap);
  let goreSystem = new GoreSystem(
    scene,
    (x, z) => terrain.getTerrainNormal(x, z),
    (x, z) => terrain.getTerrainY(x, z),
  );
  goreSystem.setOpenCellCheck((wx, wz) => terrain.isOpenCell(wx, wz));
  const deathSequence = new DeathSequence(postProcess, cam, {
    potionSystem, potionVFX, goreSystem, lootSystem, audioSystem,
  });
  if (usePropChestsOnly) {
    terrain.setPropChestRegistrar((list) =>
      list.forEach(({ position, mesh, entity, openGeo, variantId }) =>
        chestSystem.registerPropChest(position, mesh, entity, openGeo, variantId),
      ),
    );
    if (hmrReused) terrain.reregisterPropChests();
  }

  // Speech bubbles
  const speechSystem = new SpeechBubbleSystem();
  speechSystem.setCamera(cam.camera);
  // Wire fade transitions to auto-clear speech bubbles
  postProcess._onFadeStart = () => speechSystem.dismissAll();

  // Click marker
  const markerGeo = new THREE.RingGeometry(0.04, 0.12, 16);
  markerGeo.rotateX(-Math.PI / 2);
  const markerMat = new THREE.MeshBasicMaterial({
    color: 0x00ffaa, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
  });
  const clickMarker = new THREE.Mesh(markerGeo, markerMat);
  clickMarker.visible = false;
  scene.add(clickMarker);

  // ── Build GameContext ─────────────────────────────────────────────
  const ctx: GameContext = {
    renderer, scene, cam, postProcess, input, sceneLights, sceneSky,
    terrain, navGrid,
    characters: [], activeCharacter: null, lastSelectedCharacter: null,
    enemySystem: null, projectileSystem: null, propDestructionSystem: null,
    collectibles, lootSystem, potionSystem, potionVFX, chestSystem,
    goreSystem, deathSequence, speechSystem,
    particleSystems: { dust: null, lightRain: null, rain: null, debris: null },
    prevToggles: { dust: false, lightRain: false, rain: false, debris: false },
    kickedPotions: [],
    needsFullRegen: !hmrReused, exitTriggered: false, portalCooldown: 0,
    potionHudTimer: 0, hmrReused,
    hitstopTimer: 0,
    currentLightPreset: initialLightPreset,
    lastIsExterior: initialIsExterior,
    currentGridOpacity: useGameStore.getState().gridOpacity,
    currentRoomLabels: useGameStore.getState().roomLabels,
    currentDebugDebris: false,
    cachedInputState: input.update(),
    inventories: new Map(),
    clickMarker, markerMat, markerLife: 0,
    raycaster: new THREE.Raycaster(),
    pointerNDC: new THREE.Vector2(),
    _planeHit: new THREE.Vector3(),
    sunDebugHelper: null,
    baseSkyColors: getSkyColors(useGameStore.getState().paletteActive || 'meadow'),
    skyCrossfade: null,
    debugLadderIndex: -1,
    pointerDragActive: false, lastDragX: 0, lastDragZ: 0,
    rafId: 0, lastTime: 0,
    pendingSnapshot: null,
    gameStarted: false,
    dungeonEnterPrompt: null,
    dungeonEnterPromptTarget: null,
    lastOverworldTile: null,
    edgeTravelPrompt: null,
    edgeTravelEnterPrompt: null,
  };

  // Hide terrain until a character is selected (avoid showing dungeon under menu/select screen)
  if (!hmrReused) {
    terrain.getGroup().visible = false;
  }

  // ── Wire up sub-modules ───────────────────────────────────────────
  const characters = createCharacterManager(ctx);
  const sceneManager = createSceneManager(ctx, characters.spawnCharacters);
  const inputManager = createInputManager(ctx, characters, sceneManager);
  const gameLoop = createGameLoop(ctx, sceneManager, characters, inputManager);
  createCallbacks(ctx, sceneManager);

  // Initialize particles
  sceneManager.syncParticles(useGameStore.getState().particleToggles);

  // ── Event listeners ───────────────────────────────────────────────
  window.addEventListener('keydown', inputManager.onCycleKey);
  canvas.addEventListener('pointerdown', inputManager.onPointerDown);
  canvas.addEventListener('pointermove', inputManager.onPointerMove);
  canvas.addEventListener('pointerup', inputManager.onPointerUp);
  window.addEventListener('resize', inputManager.onResize);

  // Start game loop
  gameLoop.start();

  return {
    destroy() {
      cancelAnimationFrame(ctx.rafId);
      window.removeEventListener('resize', inputManager.onResize);
      window.removeEventListener('keydown', inputManager.onCycleKey);
      canvas.removeEventListener('pointerdown', inputManager.onPointerDown);
      canvas.removeEventListener('pointermove', inputManager.onPointerMove);
      canvas.removeEventListener('pointerup', inputManager.onPointerUp);
      input.destroy();
      cam.destroy();
      postProcess.dispose();
      scene.remove(clickMarker);
      markerGeo.dispose();
      markerMat.dispose();
      if (ctx.dungeonEnterPrompt) {
        scene.remove(ctx.dungeonEnterPrompt);
        ctx.dungeonEnterPrompt = null;
      }
      for (const sys of Object.values(ctx.particleSystems)) {
        if (sys) sys.dispose();
      }
      for (const char of ctx.characters) char.dispose();
      if (ctx.enemySystem) ctx.enemySystem.dispose();
      if (ctx.projectileSystem) ctx.projectileSystem.dispose();
      ctx.goreSystem.dispose();
      scene.remove(ctx.terrain.group);
      entityRegistry.clear();
      if (useGameStore.getState().hmrCacheEnabled) {
        setTerrainCache({
          terrain: ctx.terrain,
          navGrid: ctx.navGrid,
          paramsKey: terrainParamsKey(),
        });
        if (ctx.activeCharacter) {
          const p = ctx.activeCharacter.getPosition();
          _hc.__hmrCharPos = { x: p.x, y: p.y, z: p.z };
          _hc.__hmrCharFacing = ctx.activeCharacter.facing;
          _hc.__hmrCharType = ctx.lastSelectedCharacter ?? undefined;
        }
        _hc.__hmrCamAngleX = cam.getAngleX();
        _hc.__hmrCamAngleY = cam.getAngleY();
        _hc.__hmrCamDistance = cam.getDistance();
      } else {
        setTerrainCache(null);
        ctx.terrain.dispose();
      }
      ctx.collectibles.dispose();
      ctx.chestSystem.dispose();
      ctx.lootSystem.dispose();
      for (const kp of ctx.kickedPotions) scene.remove(kp.mesh);
      ctx.kickedPotions = [];
      ctx.potionSystem.dispose();
      ctx.potionVFX.dispose();
      (window as any).__potionEffectSystem = null;
      ctx.speechSystem.dispose();
      renderer.dispose();
    },
  };
}
