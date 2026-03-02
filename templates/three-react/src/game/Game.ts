import * as THREE from 'three';
import {
  useGameStore,
  DEFAULT_CAMERA_PARAMS,
  DEFAULT_LIGHT_PRESET,
  DEFAULT_TORCH_PARAMS,
  DEFAULT_PARTICLE_TOGGLES,
  DEFAULT_SCENE_SETTINGS,
  DEFAULT_ENEMY_PARAMS,
} from '../store';
import { DEFAULT_CHARACTER_PARAMS } from './character';
import { Input } from './Input';
import {
  Camera,
  createScene,
  applyLightPreset,
  PostProcessStack,
  updateReveal,
  patchSceneArchitecture,
  DeathSequence,
} from './rendering';
import type { LightPreset } from '../store';
import { Environment } from './environment';
import { randomPalette } from './terrain';
import type { TerrainPreset } from './terrain';
import { CollectibleSystem, ChestSystem, SpeechBubbleSystem } from './props';
import {
  LootSystem,
  GoreSystem,
  ProjectileSystem,
  setDebugProjectileStick,
  PropDestructionSystem,
  PotionEffectSystem,
  POTION_COLORS,
  EFFECT_META,
  PotionVFX,
} from './combat';
import {
  Character,
  CHARACTER_TEAM_COLORS,
  getSlots,
  getCharacterName,
  rerollRoster,
  voxRoster,
  VOX_HEROES,
  VOX_ENEMIES,
  getProjectileConfig,
  getMuzzleOffset,
  isRangedHeroId,
  getArchetype,
  getCharacterStats,
  randomInRange,
  type CharacterType,
} from './character';
import { EnemySystem, type HitImpactCallbacks } from './enemies';
import {
  buildFloorEnemyPool,
  getFloorConfig,
  getThemedFloor,
  getEnemyIdsByArchetype,
  setActiveRecipe,
  getActiveRecipe,
} from './dungeon';
import { findPath } from './pathfinding';
import {
  createDustMotes,
  createRainEffect,
  createDebrisEffect,
} from '../utils/particles';
import type { ParticleToggles } from '../store';
import type { ParticleSystem } from '../types';
import { audioSystem } from '../utils/AudioSystem';
import { entityRegistry } from './Entity';
import type { GameInstance } from '../types';
import type { LevelSnapshot } from './dungeon';

/** Nav cell size: 0.25m for all presets. */
function navCellForPreset(_preset: string): number {
  return 0.25;
}

// ── HMR terrain cache ─────────────────────────────────────────────
// Survives Vite hot reloads so the scene doesn't regenerate on every code edit.
interface TerrainCache {
  terrain: Environment;
  navGrid: ReturnType<Environment['buildNavGrid']>;
  paramsKey: string;
}
// Stored on window so it survives Vite HMR module re-evaluation
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
    wallGap: s.wallGap,
    roomSpacing: s.roomSpacing,
    tileSize: s.tileSize,
    doorChance: s.doorChance,
    dungeonSize: s.dungeonSize,
    resolutionScale: s.resolutionScale,
    natureEnabled: s.natureEnabled,
    useBiomes: s.useBiomes,
  });
}

/** Melee auto-aim: find nearest enemy within reach+margin and a wide cone, return snap facing or null. */
function findMeleeAimTarget(
  px: number,
  pz: number,
  currentFacing: number,
  enemies: ReadonlyArray<{
    isAlive: boolean;
    mesh: { position: THREE.Vector3 };
  }>,
): number | null {
  const maxRange = 1.8; // slightly beyond melee reach so you snap before closing gap
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
  let currentLightPreset: LightPreset = useGameStore.getState().lightPreset;
  let lastIsExterior = false;
  let currentGridOpacity = useGameStore.getState().gridOpacity;
  let currentRoomLabels = useGameStore.getState().roomLabels;
  lastIsExterior = useGameStore.getState().terrainPreset === 'heightmap';
  applyLightPreset(sceneLights, currentLightPreset, lastIsExterior);

  // Camera (initial distance from store so zoom syncs with settings)
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

  // Terrain + dependent systems (mutable for regeneration)
  // Check HMR cache: reuse terrain if params haven't changed
  const {
    terrainPreset: initPreset,
    heightmapStyle: initStyle,
    paletteName: initPalette,
  } = useGameStore.getState();
  const currentParamsKey = terrainParamsKey();
  let terrain: Environment;
  let navGrid: ReturnType<Environment['buildNavGrid']>;
  let hmrReused = false;

  const hmrCacheEnabled = useGameStore.getState().hmrCacheEnabled;
  const cached = hmrCacheEnabled ? getTerrainCache() : null;
  if (cached && cached.paramsKey === currentParamsKey) {
    // Reuse cached terrain — just re-add its group to the new scene
    terrain = cached.terrain;
    navGrid = cached.navGrid;
    scene.add(terrain.group);
    // Re-register entities that were cleared on previous destroy
    terrain.reregisterEntities();
    hmrReused = true;
    // Restore camera orbit + snap target to cached char position
    if (_hc.__hmrCamAngleX != null) {
      cam.setOrbit(
        _hc.__hmrCamAngleX,
        _hc.__hmrCamAngleY!,
        _hc.__hmrCamDistance!,
      );
    }
    if (_hc.__hmrCharPos) {
      const cp = _hc.__hmrCharPos;
      cam.setTarget(cp.x, cp.y, cp.z);
      cam.updatePosition(1000); // snap camera to position immediately
    }
  } else {
    // Dispose old cache if params changed
    if (cached) {
      cached.terrain.dispose();
      setTerrainCache(null);
    }
    const initSeed = useGameStore
      .getState()
      .getFloorSeed(useGameStore.getState().floor);
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
  const initSpawn = terrain.getEntrancePosition();
  const initGemCount =
    initPreset === 'voxelDungeon'
      ? Math.max(2, Math.ceil(terrain.getRoomCount() / 2))
      : undefined;
  let collectibles = new CollectibleSystem(
    scene,
    terrain,
    initSpawn ? { x: initSpawn.x, z: initSpawn.z } : undefined,
    initGemCount,
  );
  let lootSystem = new LootSystem(scene, terrain);
  let potionSystem = new PotionEffectSystem(
    useGameStore.getState().dungeonBaseSeed,
  );
  let potionVFX = new PotionVFX(scene);
  let potionHudTimer = 0;
  // Expose potionSystem on window so PotionHotbar can check identification
  (window as any).__potionEffectSystem = potionSystem;
  lootSystem.setPotionSystem(potionSystem);
  const usePropChestsOnly = initPreset === 'voxelDungeon';
  let chestSystem = new ChestSystem(
    scene,
    terrain,
    lootSystem,
    usePropChestsOnly,
  );
  let enemySystem: EnemySystem | null = null;
  let projectileSystem: ProjectileSystem | null = null;
  let propDestructionSystem: PropDestructionSystem | null = null;

  // Kicked potion projectiles
  interface KickedPotion {
    mesh: THREE.Mesh;
    colorIndex: number;
    vx: number;
    vy: number;
    vz: number;
    age: number;
    bounces: number; // wall rebounds used (max 1)
    rolling: boolean; // on the ground, decelerating
  }
  let kickedPotions: KickedPotion[] = [];

  /** Explode a kicked potion into colored debris */
  function explodeKickedPotion(kp: KickedPotion): void {
    const potionColor =
      POTION_COLORS[kp.colorIndex] ?? new THREE.Color(0xffffff);
    const x = kp.mesh.position.x;
    const y = kp.mesh.position.y;
    const z = kp.mesh.position.z;
    const groundY = terrain.getFloorY(x, z);
    // Spawn colored debris chunks
    const count = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const c = potionColor.clone();
      c.offsetHSL(0, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.15);
      goreSystem.spawnChunk(
        x,
        y + 0.03,
        z,
        groundY,
        c,
        0.012,
        0.035,
        1.5 + Math.random() * 1.5,
        1.5,
        0,
        0,
      );
    }
    audioSystem.sfxAt('ceramicBreak', x, z);
    scene.remove(kp.mesh);
  }
  let goreSystem = new GoreSystem(
    scene,
    (x, z) => terrain.getTerrainNormal(x, z),
    (x, z) => terrain.getTerrainY(x, z),
  );
  goreSystem.setOpenCellCheck((wx, wz) => terrain.isOpenCell(wx, wz));
  const deathSequence = new DeathSequence(postProcess, cam, {
    potionSystem,
    potionVFX,
    goreSystem,
    lootSystem,
    audioSystem,
  });
  if (usePropChestsOnly) {
    terrain.setPropChestRegistrar((list) =>
      list.forEach(({ position, mesh, entity, openGeo }) =>
        chestSystem.registerPropChest(position, mesh, entity, openGeo),
      ),
    );
    if (hmrReused) terrain.reregisterPropChests();
  }

  // Speech bubbles
  const speechSystem = new SpeechBubbleSystem();
  speechSystem.setCamera(cam.camera);

  // Particles — independent toggleable systems
  const particleSystems: Record<keyof ParticleToggles, ParticleSystem | null> =
    {
      dust: null,
      lightRain: null,
      rain: null,
      debris: null,
    };
  const prevToggles: ParticleToggles = {
    dust: false,
    lightRain: false,
    rain: false,
    debris: false,
  };

  const terrainHeightAt = (x: number, z: number) => terrain.getTerrainY(x, z);

  /** Serialize current level state into a snapshot */
  function serializeLevel(): LevelSnapshot {
    const store = useGameStore.getState();
    const propSystem = terrain.getPropSystem();
    return {
      seed: store.getFloorSeed(store.floor),
      floor: store.floor,
      theme: store.currentTheme,
      enemies: enemySystem ? enemySystem.serialize() : [],
      chests: chestSystem.serialize(),
      collectibles: collectibles.serialize(),
      loot: lootSystem.serialize(),
      destroyedProps: propSystem ? propSystem.serializeDestroyed() : [],
    };
  }

  /** Pending snapshot to apply once async prop loading finishes */
  let pendingSnapshot: LevelSnapshot | null = null;

  interface RegenerateOpts {
    /** Dungeon seed (undefined = random) */
    seed?: number;
    /** Snapshot to restore after generation */
    snapshot?: LevelSnapshot;
    /** Where the player should spawn: 'entrance' (came from above) or 'exit' (came from below) */
    spawnAt?: 'entrance' | 'exit';
    /** Terrain preset override (e.g. 'heightmap' for surface) */
    presetOverride?: TerrainPreset;
    /** Dungeon theme override */
    themeOverride?: string;
    /** Character type to spawn (used on restart after death) */
    character?: CharacterType;
  }

  /** Apply floor-based enemy pool + zone metadata to the store. */
  function applyFloorConfig(floor: number, announce = false): void {
    // Sync active recipe from store (may have changed in settings)
    const recipeName = useGameStore.getState().progressionRecipe;
    if (getActiveRecipe().name !== recipeName) setActiveRecipe(recipeName);

    const cfg = getFloorConfig(floor);
    const pool = buildFloorEnemyPool(floor);
    const store = useGameStore.getState();
    store.setEnemyParam('allowedTypes', pool);
    store.setZoneName(cfg.zoneName);

    // Zone announcement on floor transition
    if (announce) {
      const themed = getThemedFloor(floor);
      if (themed) {
        store.setZoneAnnouncement({
          title: themed.title,
          subtitle: themed.subtitle,
        });
      } else {
        // Announce zone name on every floor change
        store.setZoneAnnouncement({
          title: cfg.zoneName,
          subtitle: `Floor ${floor}`,
        });
      }
    }
  }

  /** Wipe terrain + all dependent systems and rebuild from current store settings */
  function regenerateScene(opts: RegenerateOpts = {}): void {
    // Apply floor-based enemy pool + zone metadata before any enemy spawning
    applyFloorConfig(useGameStore.getState().floor);
    // console.log(`[Game] regen — seed=${opts.seed}, spawnAt=${opts.spawnAt}, snapshot=${!!opts.snapshot}, theme=${opts.themeOverride ?? 'auto'}, preset=${opts.presetOverride ?? useGameStore.getState().terrainPreset}`);
    activeCharacter = null;
    debugLadderIndex = -1;
    needsFullRegen = false;
    // Roster is rerolled in onStartGame when showing the select screen
    exitTriggered = false;
    portalCooldown = 0;
    pendingSnapshot = opts.snapshot ?? null;

    // Dispose old systems
    for (const char of characters) char.dispose();
    characters = [];
    if (enemySystem) {
      enemySystem.dispose();
      enemySystem = null;
    }
    if (projectileSystem) {
      projectileSystem.dispose();
      projectileSystem = null;
    }
    goreSystem.dispose();
    goreSystem = new GoreSystem(
      scene,
      (x, z) => terrain.getTerrainNormal(x, z),
      (x, z) => terrain.getTerrainY(x, z),
    );
    goreSystem.setOpenCellCheck((wx, wz) => terrain.isOpenCell(wx, wz));
    chestSystem.dispose();
    lootSystem.dispose();
    // Clean up kicked potions
    for (const kp of kickedPotions) scene.remove(kp.mesh);
    kickedPotions = [];
    const isFloorTransition = !!opts.spawnAt;
    if (!isFloorTransition) {
      potionSystem.dispose();
    }
    potionVFX.dispose();
    collectibles.dispose();
    terrain.dispose();
    scene.remove(terrain.group);
    entityRegistry.clear(); // purge stale Architecture/Prop entities from previous generation
    setTerrainCache(null); // invalidate HMR cache on explicit regeneration

    // Read current settings from store
    const {
      heightmapStyle,
      characterParams: pp,
      paletteName: palPick,
    } = useGameStore.getState();
    const terrainPreset =
      opts.presetOverride ?? useGameStore.getState().terrainPreset;

    // Apply theme override if provided
    if (opts.themeOverride) {
      useGameStore.getState().setCurrentTheme(opts.themeOverride);
    }

    // Rebuild with optional seed — dungeons validate entrance→exit path, retry if unsolvable
    const MAX_DUNGEON_RETRIES = 10;
    let retrySeed = opts.seed;
    for (let attempt = 0; attempt <= MAX_DUNGEON_RETRIES; attempt++) {
      if (attempt > 0) {
        terrain.dispose();
        scene.remove(terrain.group);
        entityRegistry.clear();
        useGameStore.getState().setCurrentTheme(''); // clear stale theme from failed attempt
        retrySeed = undefined; // random seed on retry
      }
      terrain = new Environment(
        scene,
        terrainPreset,
        heightmapStyle,
        palPick,
        retrySeed,
      );
      navGrid = terrain.buildNavGrid(
        pp.stepHeight,
        pp.capsuleRadius,
        navCellForPreset(terrainPreset),
        pp.slopeHeight,
      );

      // Validate dungeon: entrance must be pathable to exit
      if (terrainPreset === 'voxelDungeon') {
        const entrance = terrain.getEntrancePosition();
        const exit = terrain.getExitPosition();
        if (entrance && exit) {
          const result = findPath(
            navGrid,
            entrance.x,
            entrance.z,
            exit.x,
            exit.z,
          );
          if (!result.found) {
            // console.log(`[Game] dungeon attempt ${attempt + 1} unsolvable — retrying`);
            continue;
          }
        }
      }
      break; // valid or non-dungeon
    }

    cam.terrainMesh = terrain.getTerrainMesh();
    useGameStore.getState().setPaletteActive(terrain.getPaletteName());
    sceneSky.setPalette(terrain.getPaletteName());
    useGameStore.getState().setWalkableCells(navGrid.getWalkableCellCount());
    terrain.setGridOpacity(useGameStore.getState().gridOpacity);
    // Get player spawn position for exclusion zone (avoid spawning collectibles inside magnet radius)
    const spawnExclude =
      opts.spawnAt === 'exit'
        ? terrain.getExitPosition()
        : terrain.getEntrancePosition();
    const gemCount =
      terrainPreset === 'voxelDungeon'
        ? Math.max(2, Math.ceil(terrain.getRoomCount() / 2))
        : undefined;
    collectibles = new CollectibleSystem(
      scene,
      terrain,
      spawnExclude ? { x: spawnExclude.x, z: spawnExclude.z } : undefined,
      gemCount,
    );
    lootSystem = new LootSystem(scene, terrain);
    if (!isFloorTransition) {
      potionSystem = new PotionEffectSystem(
        useGameStore.getState().dungeonBaseSeed,
      );
    }
    potionVFX = new PotionVFX(scene);
    (window as any).__potionEffectSystem = potionSystem;
    lootSystem.setPotionSystem(potionSystem);
    deathSequence.updateDeps({
      potionSystem,
      potionVFX,
      goreSystem,
      lootSystem,
    });
    const usePropChestsOnlyRegen = terrainPreset === 'voxelDungeon';
    chestSystem = new ChestSystem(
      scene,
      terrain,
      lootSystem,
      usePropChestsOnlyRegen,
    );

    // Hide dynamic objects until room visibility can process them
    if (usePropChestsOnlyRegen) {
      for (const mesh of collectibles.getMeshes()) mesh.visible = false;
      for (const mesh of lootSystem.getMeshes()) mesh.visible = false;
      for (const group of chestSystem.getGroups()) group.visible = false;
    }
    if (usePropChestsOnlyRegen) {
      terrain.setPropChestRegistrar((list) => {
        list.forEach(({ position, mesh, entity, openGeo }) =>
          chestSystem.registerPropChest(position, mesh, entity, openGeo),
        );
        // Once prop chests are registered, apply pending snapshot restoration
        if (pendingSnapshot) {
          // console.log(`[Game] restore snapshot: ${pendingSnapshot.chests.length} chests, ${pendingSnapshot.collectibles.length} collectibles, ${pendingSnapshot.loot.length} loot, ${pendingSnapshot.destroyedProps?.length ?? 0} destroyedProps`);
          chestSystem.restoreState(pendingSnapshot.chests);
          collectibles.restoreState(pendingSnapshot.collectibles);
          lootSystem.restoreLoot(pendingSnapshot.loot);
          // Restore destroyed props (remove them + unblock nav cells)
          if (pendingSnapshot.destroyedProps?.length) {
            const ps = terrain.getPropSystem();
            if (ps) {
              ps.restoreDestroyed(pendingSnapshot.destroyedProps);
              // Unblock nav cells for destroyed props
              for (const dp of pendingSnapshot.destroyedProps) {
                terrain.unblockPropAt(dp.x, dp.z);
              }
            }
          }
          pendingSnapshot = null;
        }
      });
    }

    // When props finish loading, reposition character to precise entrance/exit
    const spawnAtCapture = opts.spawnAt;
    if (usePropChestsOnlyRegen) {
      // Dungeon ready (layout + props + portals all placed) — reposition, visibility, fade in
      terrain.setOnDungeonReady(() => {
        if (!activeCharacter) return;
        // console.log('[Game] dungeonReady');

        // Reposition character to portal entrance/exit (floor transitions only)
        if (spawnAtCapture) {
          const pos =
            spawnAtCapture === 'exit'
              ? terrain.getExitPosition()
              : terrain.getEntrancePosition();
          if (pos) {
            // console.log(`[Game] dungeonReady spawn at ${spawnAtCapture} (${pos.x.toFixed(2)}, ${pos.z.toFixed(2)})`);
            const y = terrain.getTerrainY(pos.x, pos.z);
            activeCharacter.mesh.position.set(pos.x, y, pos.z);
            activeCharacter.groundY = y;
            activeCharacter.visualGroundY = y;
            portalCooldown = 1.0;
          } else {
            // Fallback: use current position
            const charPos = activeCharacter.getPosition();
            const y = terrain.getTerrainY(charPos.x, charPos.z);
            activeCharacter.mesh.position.y = y;
            activeCharacter.groundY = y;
            activeCharacter.visualGroundY = y;
          }

          // Update facing from prop system
          if (spawnAtCapture === 'exit') {
            const exitWallDir = terrain.getExitWallDir();
            activeCharacter.setFacing(
              Math.atan2(-exitWallDir[0], -exitWallDir[1]),
            );
          } else {
            const entranceFacing = terrain.getEntranceFacing();
            if (entranceFacing) activeCharacter.setFacing(entranceFacing);
          }
        }

        // Run room visibility so only spawn room is shown
        const roomVis = terrain.getRoomVisibility();
        const doorSys = terrain.getDoorSystem();
        if (roomVis) {
          const cp = activeCharacter.getPosition();
          roomVis.update(cp.x, cp.z, doorSys);

          // Apply visibility to dynamic objects (update loop is frozen during fade)
          for (const mesh of collectibles.getMeshes()) {
            mesh.visible = roomVis.isPositionVisible(
              mesh.position.x,
              mesh.position.z,
            );
          }
          for (const mesh of lootSystem.getMeshes()) {
            mesh.visible = roomVis.isPositionVisible(
              mesh.position.x,
              mesh.position.z,
            );
          }
          for (const group of chestSystem.getGroups()) {
            group.visible = roomVis.isPositionVisible(
              group.position.x,
              group.position.z,
            );
          }
          if (enemySystem) {
            for (const enemy of enemySystem.getEnemies()) {
              const epos = enemy.getPosition();
              enemy.mesh.visible = roomVis.isPositionActive(epos.x, epos.z);
            }
          }
        }

        // Restore potion VFX icons on floor transition (effects persist, but sprites were disposed with old scene)
        if (isFloorTransition) {
          const activeEffects = potionSystem.getActiveEffects();
          if (activeEffects.length > 0) {
            potionVFX.restoreActiveEffects(
              activeEffects,
              activeCharacter,
              potionSystem.armorHitsRemaining,
            );
          }
        }

        // Show terrain (was hidden to prevent flash), show character, snap camera, release fade
        terrain.getGroup().visible = true;
        activeCharacter.mesh.visible = true;
        const camTarget = activeCharacter.getCameraTarget();
        cam.setTarget(camTarget.x, camTarget.y, camTarget.z);
        cam.snapToTarget();
        // console.log('[Game] dungeonReady releasing fade');
        postProcess.releaseFade();
      });
    }

    // Keep current character on floor transition; on full regen use provided or previously selected character
    if (!opts.spawnAt) {
      if (opts.character) {
        // Death restart / explicit selection: use the character the player picked
        lastSelectedCharacter = opts.character;
      }
      // If no character specified and none previously selected, go to select screen
      if (!lastSelectedCharacter) {
        rerollRoster();
        useGameStore.getState().setPhase('select');
        return;
      }
      useGameStore.getState().selectCharacter(lastSelectedCharacter);
    }
    spawnCharacters(lastSelectedCharacter!, opts.spawnAt);

    // activeCharacter is set by spawnCharacters() above (TS can't track closure mutation)
    const spawnedChar = activeCharacter as Character | null;

    // Always hide character until terrain/props are ready
    if (spawnedChar) {
      spawnedChar.mesh.visible = false;
    }

    // Snap camera instantly to new character position — no lerp from old level
    if (spawnedChar) {
      const p = spawnedChar.mesh.position;
      cam.setTarget(p.x, p.y, p.z);
      cam.snapToTarget();
    }

    // voxelDungeon: character + fade handled by onDungeonReady callback
    // Everything else: show character after one frame so terrain renders first
    if (!usePropChestsOnlyRegen) {
      postProcess.releaseFade();
      if (spawnedChar) {
        const charToShow = spawnedChar;
        requestAnimationFrame(() => {
          charToShow.mesh.visible = true;
        });
      }
    }

    // console.log(`[Game] regen done — floor=${useGameStore.getState().floor}, palette=${terrain.getPaletteName()}`);
  }

  /** Change floor: fade out → serialize → regenerate → fade in */
  function changeFloor(direction: 'down' | 'up'): void {
    // console.log(`[Game] changeFloor ${direction}`);

    // Dismiss any active speech bubbles before transition
    speechSystem.dismissAll();

    postProcess.fadeTransition(() => {
      // This runs when screen is fully black
      const store = useGameStore.getState();
      const currentFloor = store.floor;

      // Serialize and cache current level
      const snapshot = serializeLevel();
      // console.log(`[Game] serialize floor ${currentFloor}: ${snapshot.enemies.length} enemies, ${snapshot.chests.length} chests, ${snapshot.collectibles.length} collectibles, ${snapshot.loot.length} loot, ${snapshot.destroyedProps.length} destroyedProps`);
      store.saveLevelSnapshot(currentFloor, snapshot);

      // Compute new floor
      const newFloor =
        direction === 'down' ? currentFloor + 1 : currentFloor - 1;
      store.setFloor(newFloor);
      applyFloorConfig(newFloor, true);

      // Check if we have a cached snapshot for the destination floor
      const cached = store.getLevelSnapshot(newFloor);
      const seed = store.getFloorSeed(newFloor);

      // console.log(`[Game] floor ${currentFloor} → ${newFloor}, seed=${seed}, cached=${!!cached}`);

      // Clear stale theme so new floors get a fresh random theme
      if (!cached) store.setCurrentTheme('');

      regenerateScene({
        seed,
        snapshot: cached,
        spawnAt: direction === 'down' ? 'entrance' : 'exit',
        themeOverride: cached?.theme,
      });
    }, 4.0);
  }

  function createParticleSystem(key: keyof ParticleToggles): ParticleSystem {
    switch (key) {
      case 'dust':
        return createDustMotes({ count: 60, area: { x: 16, y: 6, z: 16 } });
      case 'lightRain':
        return createRainEffect({
          area: { x: 24, y: 30, z: 24 },
          groundHeightAt: terrainHeightAt,
          intensity: 'light',
        });
      case 'rain':
        return createRainEffect({
          area: { x: 24, y: 30, z: 24 },
          groundHeightAt: terrainHeightAt,
        });
      case 'debris':
        return createDebrisEffect();
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
  /** Set after death so next character selection triggers full scene regeneration */
  let needsFullRegen = false;
  let exitTriggered = false;
  /** Guard: track spawn cell so portals are disabled until player moves away */
  let portalCooldown = 0;

  // Cached input state for PlayerControl deps
  let cachedInputState = input.update();

  // Per-character inventory
  interface CharInventory {
    collectibles: number;
    coins: number;
    potionInventory: Array<{ colorIndex: number; count: number }>;
  }
  const inventories = new Map<string, CharInventory>();

  function getInventoryKey(): string {
    return activeCharacter
      ? `char:${activeCharacter.characterType}`
      : 'unknown';
  }

  function getInventory(): CharInventory {
    const key = getInventoryKey();
    if (!inventories.has(key))
      inventories.set(key, { collectibles: 0, coins: 0, potionInventory: [] });
    return inventories.get(key)!;
  }

  function saveActiveInventory(): void {
    const inv = getInventory();
    const s = useGameStore.getState();
    inv.collectibles = s.collectibles;
    inv.coins = s.coins;
    inv.potionInventory = [...s.potionInventory];
  }

  function loadActiveInventory(): void {
    const inv = getInventory();
    useGameStore.getState().setCollectibles(inv.collectibles);
    useGameStore.setState({
      coins: inv.coins,
      potionInventory: [...inv.potionInventory],
    });
  }

  function updateActiveCharacterUI(): void {
    if (activeCharacter) {
      useGameStore
        .getState()
        .setActiveCharacter(
          getCharacterName(activeCharacter.characterType),
          CHARACTER_TEAM_COLORS[activeCharacter.characterType],
        );
    }
  }

  // Raycasting for character selection & terrain clicks
  const raycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();
  const _planeHit = new THREE.Vector3();

  // Click marker (visual feedback on terrain click)
  const markerGeo = new THREE.RingGeometry(0.04, 0.12, 16);
  markerGeo.rotateX(-Math.PI / 2);
  const markerMat = new THREE.MeshBasicMaterial({
    color: 0x00ffaa,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
  });
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
      isConfused: () => potionSystem.isConfusion,
    };
  }

  /** Sync movement params from the store to all characters (for settings sliders). */
  let lastSyncedCharacterParams:
    | ReturnType<typeof useGameStore.getState>['characterParams']
    | null = null;
  function syncAllCharacterParams(): void {
    const pp = useGameStore.getState().characterParams;
    if (pp === lastSyncedCharacterParams) return;
    lastSyncedCharacterParams = pp;
    for (const char of characters) {
      const p = char.params;
      // speed, attackDamage, attackCooldown are per-character (from archetype stats) — don't override
      // p.speed = pp.speed;
      p.stepHeight = pp.stepHeight;
      p.slopeHeight = pp.slopeHeight;
      p.capsuleRadius = pp.capsuleRadius;
      p.arrivalReach = pp.arrivalReach;
      p.hopHeight = pp.hopHeight;
      p.movementMode = pp.movementMode;
      p.showPathDebug = pp.showPathDebug;
      p.attackReach = pp.attackReach;
      p.attackArcHalf = pp.attackArcHalf;
      // p.attackDamage = pp.attackDamage;
      // p.attackCooldown = pp.attackCooldown;
      p.chaseRange = pp.chaseRange * 0.25;
      p.knockbackDecay = pp.knockbackDecay;
      p.invulnDuration = pp.invulnDuration;
      p.flashDuration = pp.flashDuration;
      p.stunDuration = pp.stunDuration;
      p.attackDuration = pp.attackDuration;
      p.exhaustDuration = pp.exhaustDuration;
      p.footIKEnabled = pp.footIKEnabled;
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
      // Sync store so HMR restores the right character
      lastSelectedCharacter = char.characterType;
      useGameStore.getState().selectCharacter(char.characterType);
    }

    // Load new character's inventory
    loadActiveInventory();
    updateActiveCharacterUI();
  }

  /** Raycast terrain at screen coords, return snapped world position or null */
  function raycastTerrain(
    clientX: number,
    clientY: number,
  ): { x: number; z: number; y: number } | null {
    pointerNDC.x = (clientX / window.innerWidth) * 2 - 1;
    pointerNDC.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, cam.camera);

    let hitPoint: THREE.Vector3 | null = null;

    // Box meshes first (scattered/terraced) — single recursive call on the group
    const boxGroup = terrain.getBoxGroup();
    if (boxGroup.children.length > 0) {
      const boxHits = raycaster.intersectObject(boxGroup, true);
      // Skip LineSegments (grid overlays) and invisible collision boxes, only accept visible Mesh hits
      for (const h of boxHits) {
        if (
          (h.object as THREE.Mesh).isMesh &&
          h.object.type === 'Mesh' &&
          !h.object.userData.collisionOnly
        ) {
          hitPoint = h.point;
          break;
        }
      }
    }

    // Voxel dungeon: raycast visible ground/stair meshes in terrain group
    if (!hitPoint) {
      const terrainGroup = terrain.getGroup();
      if (terrainGroup.children.length > 0) {
        const groupHits = raycaster.intersectObject(terrainGroup, true);
        for (const h of groupHits) {
          if (
            (h.object as THREE.Mesh).isMesh &&
            h.object.visible &&
            !h.object.userData.collisionOnly &&
            !h.object.userData.isWall
          ) {
            hitPoint = h.point;
            break;
          }
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
    return {
      x: snapped.x,
      z: snapped.z,
      y: terrain.getTerrainY(snapped.x, snapped.z),
    };
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
    const otherChars = characters.filter((c) => c !== activeCharacter);
    const charMeshes = otherChars.map((c) => c.mesh);
    const charHits = raycaster.intersectObjects(charMeshes, true);
    if (charHits.length > 0) {
      const hitObj = charHits[0].object;
      const char = otherChars.find(
        (c) =>
          c.mesh === hitObj ||
          hitObj.parent === c.mesh ||
          c.mesh === hitObj.parent,
      );
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

  /** Apply per-archetype stats after a skin change and sync HP/name to the store. */
  function applyCharacterStats(char: Character): void {
    const entry = voxRoster[char.characterType];
    if (!entry) return;
    const stats = getCharacterStats(getArchetype(entry.name));
    // Scale HP proportionally: if player was at 60% HP, stay at 60%
    const hpRatio = char.maxHp > 0 ? char.hp / char.maxHp : 1;
    const newMaxHp = Math.round(randomInRange(stats.hp));
    char.maxHp = newMaxHp;
    char.hp = Math.max(1, Math.round(newMaxHp * hpRatio));
    char.params.speed = randomInRange(stats.movSpeed);
    char.params.attackDamage = Math.floor(randomInRange(stats.damage));
    char.params.attackCooldown = 1 / randomInRange(stats.atkSpeed);
    char.critChance = stats.critChance;
    char.armour = stats.armour;
    // Sync to store
    useGameStore.getState().setHP(char.hp, char.maxHp);
    useGameStore
      .getState()
      .setActiveCharacter(
        getCharacterName(char.characterType),
        CHARACTER_TEAM_COLORS[char.characterType],
      );
  }

  // Cycle selected character with left/right arrows
  function cycleCharacter(dir: 1 | -1): void {
    if (characters.length === 0) return;
    const curIdx = activeCharacter ? characters.indexOf(activeCharacter) : -1;
    const nextIdx =
      (((curIdx + dir) % characters.length) + characters.length) %
      characters.length;
    selectCharacter(characters[nextIdx]);
  }

  // Debug: cycle through ladders with L key
  let debugLadderIndex = -1; // -1 = follow character (normal mode)

  const onCycleKey = (e: KeyboardEvent) => {
    if (useGameStore.getState().phase !== 'playing') return;
    if (e.code === 'ArrowLeft') {
      cycleCharacter(-1);
      e.preventDefault();
    } else if (e.code === 'ArrowRight') {
      cycleCharacter(1);
      e.preventDefault();
    } else if (e.code === 'KeyR') {
      if (activeCharacter) {
        const pool = e.shiftKey ? VOX_ENEMIES : VOX_HEROES;
        const entry = pool[Math.floor(Math.random() * pool.length)];
        voxRoster[activeCharacter.characterType] = entry;
        speechSystem.onSkinChanged(activeCharacter);
        activeCharacter.applyVoxSkin(entry);
        applyCharacterStats(activeCharacter);
      }
      e.preventDefault();
    } else if (e.code === 'KeyM') {
      if (activeCharacter) {
        const archer = VOX_HEROES.find((entry) => entry.id === 'archer');
        if (archer) {
          voxRoster[activeCharacter.characterType] = archer;
          speechSystem.onSkinChanged(activeCharacter);
          activeCharacter.applyVoxSkin(archer);
          applyCharacterStats(activeCharacter);
        }
      }
      e.preventDefault();
    } else if (e.code === 'KeyL' && !e.shiftKey) {
      // Toggle player torch light via store (updateTorch reads this each frame)
      const before = useGameStore.getState().torchEnabled;
      useGameStore.getState().toggleTorch();
      const after = useGameStore.getState().torchEnabled;
      // console.log(`[Game] Player torch: ${before} → ${after}`);
      e.preventDefault();
    } else if (e.code === 'KeyL' && e.shiftKey) {
      const ladders = terrain.getLadderDefs();
      if (ladders.length === 0) return;
      debugLadderIndex++;
      if (debugLadderIndex >= ladders.length) debugLadderIndex = -1;
      if (debugLadderIndex >= 0) {
        const l = ladders[debugLadderIndex];
        // console.log(`[Debug] Ladder ${debugLadderIndex}/${ladders.length - 1}: h=${(l.topY - l.bottomY).toFixed(1)}m at (${l.bottomX.toFixed(1)}, ${l.bottomZ.toFixed(1)})`);
      } else {
        // console.log('[Debug] Camera back to character');
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
    if (!(e.buttons & 1)) {
      pointerDragActive = false;
      return;
    }
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

  function spawnCharacters(
    controlledType: CharacterType,
    spawnAt?: 'entrance' | 'exit',
  ): void {
    // Dispose old characters
    for (const char of characters) char.dispose();
    characters = [];
    activeCharacter = null;
    deathSequence.reset();
    inventories.clear();

    const ladderDefs = terrain.getLadderDefs();

    // Spawn only the controlled hero
    {
      let pos: THREE.Vector3;
      if (hmrReused && _hc.__hmrCharPos) {
        const cp = _hc.__hmrCharPos;
        pos = new THREE.Vector3(cp.x, cp.y, cp.z);
        _hc.__hmrCharPos = undefined; // consume so next spawn is fresh
      } else if (spawnAt === 'exit') {
        // Coming from below — spawn at exit position
        const exitPos = terrain.getExitPosition();
        if (exitPos) {
          const ey = terrain.getTerrainY(exitPos.x, exitPos.z);
          pos = new THREE.Vector3(exitPos.x, ey, exitPos.z);
        } else {
          pos = terrain.getRandomPosition();
        }
      } else {
        // Default or 'entrance' — spawn at entrance position
        const entrancePos = terrain.getEntrancePosition();
        if (entrancePos) {
          const ey = terrain.getTerrainY(entrancePos.x, entrancePos.z);
          pos = new THREE.Vector3(entrancePos.x, ey, entrancePos.z);
        } else {
          const spawnY = terrain.getTerrainY(0, 0);
          pos = navGrid.isWalkable(0, 0)
            ? new THREE.Vector3(0, spawnY, 0)
            : terrain.getRandomPosition();
        }
      }

      const char = new Character(
        scene,
        terrain,
        navGrid,
        controlledType,
        pos,
        ladderDefs,
      );
      char.setPlayerControlled(makePlayerControlDeps());
      // Enable hunger + regen for player characters
      char.hungerEnabled = true;
      char.regenDelay = 5.0;
      char.regenRate = 0.1;
      if (hmrReused && _hc.__hmrCharFacing != null) {
        char.setFacing(_hc.__hmrCharFacing);
        _hc.__hmrCharFacing = undefined;
      } else if (spawnAt === 'exit') {
        // Face away from exit wall (toward room interior)
        const exitWallDir = terrain.getExitWallDir();
        // exitWallDir points toward wall; facing is -sin/-cos convention, so negate
        const facing = Math.atan2(-exitWallDir[0], -exitWallDir[1]);
        char.setFacing(facing);
      } else {
        // Face same direction as entrance portal
        const entranceFacing = terrain.getEntranceFacing();
        if (entranceFacing) char.setFacing(entranceFacing);
      }
      characters.push(char);
      activeCharacter = char;
      // console.log(`[Game] spawn ${controlledType} at (${pos.x.toFixed(2)}, ${pos.z.toFixed(2)})${spawnAt ? ` [${spawnAt}]` : ''}`);

      // Set portal cooldown guard when spawning via floor transition
      if (spawnAt) {
        portalCooldown = 1.0;
        // console.log(`[Game] portalCooldown set at (${pos.x.toFixed(2)}, ${pos.z.toFixed(2)})`);
      }
    }

    // Register all characters for speech bubbles and resume if paused
    speechSystem.resume();
    speechSystem.setCharacters(characters);

    if (activeCharacter) {
      if (!spawnAt) {
        // Fresh spawn — use character's stats-based HP
        useGameStore.getState().setCollectibles(0);
        useGameStore
          .getState()
          .setHP(activeCharacter.hp, activeCharacter.maxHp);
        useGameStore
          .getState()
          .setHunger(activeCharacter.hunger, activeCharacter.maxHunger);
      } else {
        // Floor transition — preserve HP + hunger, restore on the new character instance
        const { hp, maxHp, hunger, maxHunger } = useGameStore.getState();
        activeCharacter.hp = hp;
        activeCharacter.maxHp = maxHp;
        activeCharacter.hunger = hunger;
        activeCharacter.maxHunger = maxHunger;
      }
      useGameStore
        .getState()
        .setActiveCharacter(
          getCharacterName(controlledType),
          CHARACTER_TEAM_COLORS[controlledType],
        );
    }

    // Spawn enemies + projectile system
    if (enemySystem) enemySystem.dispose();
    if (projectileSystem) projectileSystem.dispose();
    enemySystem = new EnemySystem(
      scene,
      terrain,
      navGrid,
      lootSystem,
      ladderDefs,
    );
    enemySystem.setGoreSystem(goreSystem);
    enemySystem.setPotionSystem(potionSystem);
    projectileSystem = new ProjectileSystem(scene);
    enemySystem.setAllyCharacters(characters);
    enemySystem.impactCallbacks = {
      onHitstop: (duration) => triggerHitstop(duration),
      onCameraShake: (intensity, duration, dirX, dirZ) =>
        cam.shake(intensity, duration, dirX, dirZ),
    };

    // Prop destruction system — initialized lazily when props are ready (async for voxelDungeon).
    // On first frame where propSystem exists but propDestructionSystem doesn't, we wire it up.
    propDestructionSystem = null;

    // On exterior maps, set exclusion zone around player spawn so enemies don't spawn within chase range
    if (!terrain.getRoomVisibility() && activeCharacter) {
      const cp = activeCharacter.getPosition();
      const chaseRange = useGameStore.getState().enemyParams.chaseRange * 0.25;
      enemySystem.setPlayerExclusionZone(cp.x, cp.z, chaseRange);
    }

    // Set level transition exclusion zones so enemies don't spawn near stairs/ladders
    enemySystem.setTransitionExclusions(terrain.getLevelTransitionPositions());

    // Restore enemies from snapshot or spawn fresh ones
    if (pendingSnapshot && pendingSnapshot.enemies.length > 0) {
      enemySystem.restoreEnemies(pendingSnapshot.enemies);
    } else {
      const ep = useGameStore.getState().enemyParams;
      const walkableCells = navGrid.getWalkableCellCount();
      const maxEnemies =
        ep.enemyDensity <= 0
          ? 0
          : Math.min(
              ep.maxEnemies,
              Math.max(1, Math.round(walkableCells * ep.enemyDensity)),
            );
      // Queue all enemies for staggered spawning (one-by-one with cooldowns)
      if (maxEnemies > 0) {
        enemySystem.spawnEnemies(maxEnemies);
        // Wave spawning kicks in after initial batch is done to replace killed enemies
        enemySystem.enableWaveSpawning(
          maxEnemies,
          useGameStore.getState().enemyParams.spawnInterval,
        );
      }
    }

    // Themed floor: spawn boss enemies near exit (only on fresh generation, not restoring)
    if (!pendingSnapshot) {
      const themed = getThemedFloor(useGameStore.getState().floor);
      if (themed) {
        const exitPos = terrain.getExitPosition();
        if (exitPos) {
          enemySystem.spawnBossEnemies(
            themed.bossArchetype,
            themed.bossCount,
            exitPos.x,
            exitPos.z,
          );
        }
      }
    }

    // Hide enemies until room visibility processes them
    if (terrain.getRoomVisibility()) {
      for (const enemy of enemySystem.getEnemies()) {
        enemy.mesh.visible = false;
      }
    }
  }

  // Store callbacks
  useGameStore.setState({
    onStartGame: () => {
      const wasPlayerDead =
        useGameStore.getState().phase === 'player_dead' ||
        (activeCharacter && !activeCharacter.isAlive);
      // console.log(`[Game] startGame — wasPlayerDead=${wasPlayerDead}`);
      speechSystem.dismissAll();
      rerollRoster();
      useGameStore.getState().setPhase('select');
      audioSystem.init();
      if (wasPlayerDead) {
        // Reset so re-picking the same character triggers spawnCharacters
        lastSelectedCharacter = null;
        needsFullRegen = true;
        useGameStore.setState({ selectedCharacter: null });
        useGameStore.getState().clearLevelCache();
        useGameStore.getState().setCurrentTheme('');
        useGameStore.getState().setFloor(1);
        useGameStore.getState().setScore(0);
        useGameStore.getState().setCollectibles(0);
        useGameStore.setState({ coins: 0 });
        useGameStore.getState().clearPotionInventory();
      }
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
    onDrinkPotion: (colorIndex: number) => {
      if (!activeCharacter || !activeCharacter.isAlive) return;
      const result = potionSystem.drink(colorIndex);
      audioSystem.sfx('drink');
      useGameStore.getState().removePotionFromInventory(colorIndex);

      // Apply instant effects
      if (result.effect === 'heal') {
        const s = useGameStore.getState();
        const healAmount = 1 + Math.floor(Math.random() * 4); // 1-4 HP
        const newHp = Math.min(s.hp + healAmount, s.maxHp);
        s.setHP(newHp, s.maxHp);
        activeCharacter.hp = newHp;
        potionVFX.spawnHealNumber(activeCharacter, healAmount);
      }

      // Spawn VFX for all timed effects
      potionVFX.onDrink(
        result.effect,
        activeCharacter,
        result.effect === 'armor' ? potionSystem.armorHitsRemaining : undefined,
      );

      // Frenzy drink: spawn a wave of enemies that rush the player
      if (result.effect === 'frenzy' && enemySystem) {
        enemySystem.triggerFrenzySpawn(
          activeCharacter,
          terrain.getDoorCenters(),
          terrain.getRoomVisibility(),
        );
      }
      // Confusion drink: no special spawn, just the timed effect (applied via potionSystem.drink)
    },
    onRegenerateScene: () => {
      // Full regeneration: instant black, new seed, clear all cached levels, reset to floor 1
      speechSystem.dismissAll();
      postProcess.fadeTransition(
        () => {
          useGameStore.getState().clearLevelCache();
          useGameStore.getState().setCurrentTheme('');
          useGameStore.getState().setFloor(1);
          const seed = useGameStore.getState().getFloorSeed(1);
          regenerateScene({ seed });
        },
        9999,
        3.0,
      );
    },
    onRemesh: () => {
      terrain.remesh();
    },
    onRandomizePalette: () => {
      const { name, palette } = randomPalette();
      terrain.applyPalette(palette, name);
      useGameStore.getState().setPaletteActive(name);
      sceneSky.setPalette(name);
    },
    onResetCharacterParams: () => {
      const d = DEFAULT_CHARACTER_PARAMS;
      const store = useGameStore.getState();
      store.setCharacterParam('speed', d.speed);
      store.setCharacterParam('stepHeight', d.stepHeight);
      store.setCharacterParam('slopeHeight', d.slopeHeight);
      store.setCharacterParam('capsuleRadius', d.capsuleRadius);
      store.setCharacterParam('arrivalReach', d.arrivalReach);
      store.setCharacterParam('hopHeight', d.hopHeight);
      store.setCharacterParam('magnetRadius', d.magnetRadius);
      store.setCharacterParam('magnetSpeed', d.magnetSpeed);
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
    onSpawnEnemy: () => {
      if (enemySystem) enemySystem.spawnEnemies(1);
    },
    onTestFrenzyDrink: () => {
      if (!enemySystem || !activeCharacter) return;
      enemySystem.triggerFrenzySpawn(
        activeCharacter,
        terrain.getDoorCenters(),
        terrain.getRoomVisibility(),
      );
      potionVFX.onDrink('frenzy', activeCharacter);
    },
    onTestFrenzyKick: () => {
      if (!enemySystem) return;
      const visible = enemySystem.getVisibleEnemies();
      if (visible.length === 0) return;
      const target = visible[Math.floor(Math.random() * visible.length)];
      enemySystem.setTauntTarget(target);
      enemySystem.applyStatusEffect(target, 'frenzy', 25);
      enemySystem.spawnPickupLabel(
        target.mesh.position.x,
        target.mesh.position.y,
        target.mesh.position.z,
        'TAUNT!',
        '#ff8844',
        'md',
      );
    },
    onResetEnemyParams: () => {
      useGameStore.setState({ enemyParams: { ...DEFAULT_ENEMY_PARAMS } });
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
      store.setHmrCacheEnabled(d.hmrCacheEnabled);
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
    postProcess.resize(window.innerWidth, window.innerHeight);
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

  function triggerPlayerDeath(playerChar: Character): void {
    deathSequence.trigger(playerChar);
  }

  function update(dt: number): void {
    // Fade transition: freeze gameplay while screen is black (holding or fading out)
    if (postProcess.isFadingOut) {
      cam.updatePosition(dt);
      return;
    }

    // Hitstop: freeze gameplay but keep rendering
    if (hitstopTimer > 0) {
      hitstopTimer -= dt;
      // Still update camera (shake plays during hitstop)
      cam.updatePosition(dt);
      // Don't call input.update() — queued actions survive until gameplay resumes
      return;
    }
    // Death transition: slow-mo + visual effects
    const { scaledDt: gameDt, active: deathTransitionActive } =
      deathSequence.update(dt);

    cachedInputState = input.update();
    const { phase, cameraParams } = useGameStore.getState();
    cam.setParams(cameraParams);

    // TAB: snap camera behind active character
    if (cachedInputState.cameraSnap && activeCharacter) {
      // Character facing is the direction the mesh looks; camera orbits behind
      cam.snapBehind(activeCharacter.facing);
    }

    if (cachedInputState.pause && (phase === 'playing' || phase === 'paused')) {
      useGameStore.getState().onPauseToggle?.();
      return;
    }

    // Check for character selection — regenerate scene on new game after death
    const selected = useGameStore.getState().selectedCharacter;
    if (selected && selected !== lastSelectedCharacter) {
      lastSelectedCharacter = selected;
      speechSystem.dismissAll();
      if (needsFullRegen) {
        needsFullRegen = false;
        // console.log(`[Game] selectCharacter=${selected} → fullRegen`);
        postProcess.fadeTransition(
          () => {
            regenerateScene({ character: selected });
          },
          9999,
          3.0,
        );
      } else {
        // console.log(`[Game] selectCharacter=${selected} → spawn`);
        spawnCharacters(selected);
      }
    }

    if ((phase === 'playing' || phase === 'player_dead') && activeCharacter) {
      const playerChar = activeCharacter;

      // Seppuku: instant suicide on 0 key
      if (
        cachedInputState.seppuku &&
        phase === 'playing' &&
        playerChar.isAlive
      ) {
        playerChar.hp = 0;
        playerChar.isAlive = false;
        useGameStore.getState().setHP(0, useGameStore.getState().maxHp);
        triggerPlayerDeath(playerChar);
        return;
      }

      // Sync active character's movement params from settings sliders
      syncAllCharacterParams();

      // Apply potion speed multiplier to player character (non-destructive — restore after update)
      const baseSpeed = playerChar.params.speed;
      if (potionSystem.speedMultiplier !== 1) {
        playerChar.params.speed = baseSpeed * potionSystem.speedMultiplier;
      }

      // Update potion effects (timed buffs, poison ticks)
      if (phase === 'playing') {
        const potionEvents = potionSystem.update(dt);
        for (const ev of potionEvents) {
          if (ev.effect === 'poison' && ev.type === 'tick') {
            const s = useGameStore.getState();
            if (s.phase === 'player_dead') continue;
            // Poison stops at 1 HP — never kills you
            if (s.hp <= 1) {
              potionSystem.clearEffect('poison');
              potionVFX.onExpire('poison');
              continue;
            }
            const newHp = Math.max(1, s.hp - 1);
            s.setHP(newHp, s.maxHp);
            playerChar.hp = newHp;
            potionVFX.spawnPoisonTick(playerChar);
          }
          if (ev.type === 'expired') {
            potionVFX.onExpire(ev.effect);
          }
        }
      }

      // Sync projectile crit bonus from clarity potion
      if (projectileSystem)
        projectileSystem.setCritBonus(potionSystem.critBonus);

      // Update potion VFX (floating numbers, status icons, shadow opacity)
      potionVFX.update(dt, playerChar, potionSystem.isShadow, cam.camera);

      // Push active potion effects to store for HUD display (~4 updates/sec)
      potionHudTimer -= dt;
      if (potionHudTimer <= 0) {
        potionHudTimer = 0.25;
        useGameStore
          .getState()
          .setActivePotionEffects(potionSystem.getActiveEffects());
      }

      // Player action on Space — potions first, then attack
      if (phase === 'playing' && cachedInputState.action) {
        // Try to activate potion magnet (good/unidentified) or kick (bad) before attacking
        const potionInteractRadius = playerChar.params.attackReach * 1.5;
        const pPos = playerChar.getPosition();
        const pFaceDirX = -Math.sin(playerChar.facing);
        const pFaceDirZ = -Math.cos(playerChar.facing);

        // Check for nearby good/unidentified loot potions → activate magnet
        const lootMagnetActivated = lootSystem.activatePotionMagnet(
          pPos.x,
          pPos.z,
          potionInteractRadius,
        );

        // Check for nearby good/unidentified prop potions → activate magnet (slide toward player)
        let propMagnetActivated = false;
        const propSys = terrain.getPropSystem();
        if (propSys) {
          const collectibles = propSys.getCollectibleProps();
          for (const prop of collectibles) {
            const ci = prop.colorIndex ?? 0;
            if (potionSystem.isIdentifiedBad(ci)) continue;
            const pdx = pPos.x - prop.mesh.position.x;
            const pdz = pPos.z - prop.mesh.position.z;
            if (
              pdx * pdx + pdz * pdz <
              potionInteractRadius * potionInteractRadius
            ) {
              // Mark prop for magnet attraction (handled below in prop pickup section)
              prop.mesh.userData.magnetActivated = true;
              propMagnetActivated = true;
            }
          }
        }

        // Check for nearby bad potions to kick
        let kickedAPotion = false;
        if (!lootMagnetActivated && !propMagnetActivated) {
          const badLoot = lootSystem.getNearestPotion(
            pPos.x,
            pPos.z,
            potionInteractRadius,
            true,
          );
          if (badLoot) {
            // Face toward the potion
            const kdx = badLoot.mesh.position.x - pPos.x;
            const kdz = badLoot.mesh.position.z - pPos.z;
            const kickDirX = kdx / (Math.sqrt(kdx * kdx + kdz * kdz) || 1);
            const kickDirZ = kdz / (Math.sqrt(kdx * kdx + kdz * kdz) || 1);
            const proj = lootSystem.kickPotion(badLoot, kickDirX, kickDirZ);
            if (proj) {
              kickedPotions.push({
                ...proj,
                age: 0,
                bounces: 0,
                rolling: false,
              });
              audioSystem.sfx('thud');
              kickedAPotion = true;
              playerChar.startAttack(false); // play attack animation for the kick
            }
          }
          // Check prop bad potions too
          if (!kickedAPotion && propSys) {
            const collectibles = propSys.getCollectibleProps();
            for (const prop of collectibles) {
              const ci = prop.colorIndex ?? 0;
              if (!potionSystem.isIdentifiedBad(ci)) continue;
              const pdx = prop.mesh.position.x - pPos.x;
              const pdz = prop.mesh.position.z - pPos.z;
              const pDist = Math.sqrt(pdx * pdx + pdz * pdz);
              if (pDist > potionInteractRadius) continue;
              const kickDirX = pdx / (pDist || 1);
              const kickDirZ = pdz / (pDist || 1);
              const srcMesh = prop.mesh as THREE.Mesh;
              const mesh = new THREE.Mesh(srcMesh.geometry, srcMesh.material);
              mesh.scale.copy(srcMesh.scale);
              mesh.quaternion.copy(srcMesh.quaternion);
              mesh.position.copy(srcMesh.position);
              scene.add(mesh);
              propSys.removeProp(prop);
              kickedPotions.push({
                mesh,
                colorIndex: ci,
                vx: kickDirX * 5,
                vy: 3,
                vz: kickDirZ * 5,
                age: 0,
                bounces: 0,
                rolling: false,
              });
              audioSystem.sfx('thud');
              kickedAPotion = true;
              playerChar.startAttack(false);
              break;
            }
          }
        }

        // If no potion interaction, do normal attack
        if (!lootMagnetActivated && !propMagnetActivated && !kickedAPotion) {
          const heroId = playerChar.voxEntry?.id ?? '';
          const projConfig = getProjectileConfig(heroId);
          if (projConfig && projectileSystem) {
            // Ranged: fire from muzzle (spawn point)
            // NOTE: wall-proximity check was here but disabled — too frustrating blocking shots near walls
            const pos = playerChar.getPosition();
            const facing = playerChar.facing;
            const muzzle = getMuzzleOffset(heroId);
            const faceDirX = -Math.sin(facing);
            const faceDirZ = -Math.cos(facing);
            const rangedP = useGameStore.getState().characterParams.ranged;
            if (playerChar.startAttack(rangedP.exhaustionEnabled)) {
              const spawnX = pos.x + faceDirX * muzzle.forward;
              const spawnY = playerChar.groundY + muzzle.up;
              const spawnZ = pos.z + faceDirZ * muzzle.forward;
              projectileSystem.fireProjectile(
                heroId,
                projConfig,
                spawnX,
                spawnY,
                spawnZ,
                facing,
                enemySystem ? enemySystem.getVisibleEnemies() : [],
                [
                  terrain.getBoxGroup(),
                  ...(terrain.getTerrainMesh()
                    ? [terrain.getTerrainMesh()!]
                    : []),
                ],
                terrain.getOpenDoorObjects(),
                muzzle.up,
                rangedP.autoTarget,
                rangedP.knockback,
              );
            }
          } else if (!enemySystem?.isCritChainActive) {
            // Melee: auto-aim snap toward nearest enemy, then attack
            const meleeP = useGameStore.getState().characterParams;
            if (enemySystem && meleeP.melee.autoTarget) {
              const pos = playerChar.getPosition();
              const aimTarget = findMeleeAimTarget(
                pos.x,
                pos.z,
                playerChar.facing,
                enemySystem.getVisibleEnemies(),
              );
              if (aimTarget !== null) {
                playerChar.facing = aimTarget;
                // Grid mode: snap visual rotation to nearest 8-direction
                playerChar.mesh.rotation.y =
                  meleeP.movementMode === 'grid'
                    ? Math.round(aimTarget / (Math.PI / 4)) * (Math.PI / 4)
                    : aimTarget;
              }
            }
            playerChar.startAttack(meleeP.melee.exhaustionEnabled);
          }
        } // end: no potion interaction → normal attack
      }

      // Update crit chain dash (skips normal movement while active)
      const showSlashFx =
        useGameStore.getState().characterParams.melee.showSlashEffect;
      if (
        enemySystem?.updateCritChain(
          dt,
          playerChar,
          () => {
            const s = useGameStore.getState();
            s.setScore(s.score + 10);
          },
          showSlashFx,
        )
      ) {
        // During crit chain, skip normal character update for player
        for (const char of characters) {
          if (char !== playerChar) char.update(dt);
        }
      } else {
        // Update all characters uniformly
        for (const char of characters) {
          char.update(dt);
        }
      }
      // Restore player speed after update so the multiplier doesn't accumulate
      playerChar.params.speed = baseSpeed;

      // Sync active character HP + hunger to store (drives HUD reactively)
      if (activeCharacter) {
        const s = useGameStore.getState();
        const charHp = Math.round(activeCharacter.hp);
        if (charHp !== s.hp || activeCharacter.maxHp !== s.maxHp) {
          s.setHP(charHp, activeCharacter.maxHp);
        }
        if (activeCharacter.hungerEnabled) {
          const charHunger = Math.round(activeCharacter.hunger * 10) / 10;
          if (
            charHunger !== s.hunger ||
            activeCharacter.maxHunger !== s.maxHunger
          ) {
            s.setHunger(charHunger, activeCharacter.maxHunger);
          }
        }
      }

      // Doors — update before projectiles so open doors are excluded from raycasts this frame
      const doorSystem = terrain.getDoorSystem();
      if (doorSystem) {
        const charPositions = characters.map((c) => c.getPosition());
        if (enemySystem) {
          charPositions.push(...enemySystem.getEnemyPositions());
        }
        const stepHeight = useGameStore.getState().characterParams.stepHeight;
        doorSystem.update(dt, charPositions, stepHeight);
      }

      // Room visibility — flood-fill through open doors from player position
      const roomVis = terrain.getRoomVisibility();
      if (roomVis && playerChar) {
        const pp = playerChar.getPosition();
        roomVis.update(pp.x, pp.z, doorSystem, playerChar.getFacing());
      }

      // Gore system (body chunks + blood decals)
      goreSystem.update(gameDt);

      // Lazy-init prop destruction system once props are loaded (async for voxelDungeon)
      if (!propDestructionSystem) {
        const propSystem = terrain.getPropSystem();
        if (propSystem) {
          propSystem.setPotionSystem(potionSystem);
          propDestructionSystem = new PropDestructionSystem(
            propSystem,
            lootSystem,
            goreSystem,
          );
          propDestructionSystem.setFloorY((x, z) => terrain.getFloorY(x, z));
          propDestructionSystem.setUnblockCallback((wx, wz) =>
            terrain.unblockPropAt(wx, wz),
          );
          propDestructionSystem.setIsOpenCell((wx, wz) =>
            terrain.isOpenCell(wx, wz),
          );
          if (enemySystem)
            enemySystem.setPropDestructionSystem(propDestructionSystem);
        }
      }

      // Prop destruction (falling tabletop items)
      if (propDestructionSystem) propDestructionSystem.update(gameDt);

      // Enemy system
      if (enemySystem) {
        const showSlashEffect =
          useGameStore.getState().characterParams.melee.showSlashEffect;
        enemySystem.update(
          gameDt,
          playerChar,
          (damage) => {
            const s = useGameStore.getState();
            if (s.phase === 'player_dead') return; // already dead
            // Armor absorbs hit completely
            if (potionSystem.absorbHit()) {
              audioSystem.sfx('thud');
              potionVFX.onArmorAbsorb(potionSystem.armorHitsRemaining);
              return;
            }
            // Fragile doubles damage
            const finalDamage = Math.round(
              damage * potionSystem.damageTakenMultiplier,
            );
            // Shadow breaks on taking damage
            if (potionSystem.isShadow) potionSystem.breakShadow();
            const newHp = Math.max(0, s.hp - finalDamage);
            s.setHP(newHp, s.maxHp);
            playerChar.hp = newHp;
            if (newHp <= 0) {
              triggerPlayerDeath(playerChar);
            }
          },
          () => {
            const s = useGameStore.getState();
            s.setScore(s.score + 10);
          },
          showSlashEffect,
          cam.camera,
        );
      }

      // Update kicked potion projectiles
      for (let ki = kickedPotions.length - 1; ki >= 0; ki--) {
        const kp = kickedPotions[ki];
        kp.age += gameDt;

        if (!kp.rolling) {
          // Airborne phase
          kp.vy -= 15 * gameDt; // gravity
          const oldX = kp.mesh.position.x;
          const oldZ = kp.mesh.position.z;
          kp.mesh.position.x += kp.vx * gameDt;
          kp.mesh.position.y += kp.vy * gameDt;
          kp.mesh.position.z += kp.vz * gameDt;
          kp.mesh.rotation.x += gameDt * 10;
          kp.mesh.rotation.z += gameDt * 8;

          // Wall collision — rebound once, then destroy on second hit
          if (!terrain.isOpenCell(kp.mesh.position.x, kp.mesh.position.z)) {
            if (kp.bounces < 1) {
              kp.bounces++;
              // Determine which axis to reflect
              const openX = terrain.isOpenCell(kp.mesh.position.x, oldZ);
              const openZ = terrain.isOpenCell(oldX, kp.mesh.position.z);
              if (openX && !openZ) {
                kp.mesh.position.z = oldZ;
                kp.vz *= -0.6;
                kp.vx *= 0.6;
              } else if (openZ && !openX) {
                kp.mesh.position.x = oldX;
                kp.vx *= -0.6;
                kp.vz *= 0.6;
              } else {
                kp.mesh.position.x = oldX;
                kp.mesh.position.z = oldZ;
                kp.vx *= -0.6;
                kp.vz *= -0.6;
              }
              kp.vy *= 0.5;
              audioSystem.sfxAt(
                'thud',
                kp.mesh.position.x,
                kp.mesh.position.z,
                0.5,
              );
            } else {
              // Second wall hit — explode
              kp.mesh.position.x = oldX;
              kp.mesh.position.z = oldZ;
              explodeKickedPotion(kp);
              kickedPotions.splice(ki, 1);
              continue;
            }
          }

          // Floor collision — transition to rolling
          const floorY = terrain.getFloorY(
            kp.mesh.position.x,
            kp.mesh.position.z,
          );
          if (kp.mesh.position.y < floorY + 0.04) {
            kp.mesh.position.y = floorY + 0.04;
            kp.vy = 0;
            kp.rolling = true;
          }
        } else {
          // Rolling phase — decelerate on ground
          const drag = Math.exp(-4 * gameDt);
          kp.vx *= drag;
          kp.vz *= drag;
          const oldX = kp.mesh.position.x;
          const oldZ = kp.mesh.position.z;
          kp.mesh.position.x += kp.vx * gameDt;
          kp.mesh.position.z += kp.vz * gameDt;
          kp.mesh.rotation.x += kp.vx * gameDt * 20;
          kp.mesh.rotation.z += kp.vz * gameDt * 20;

          // Track floor
          const floorY = terrain.getFloorY(
            kp.mesh.position.x,
            kp.mesh.position.z,
          );
          kp.mesh.position.y = floorY + 0.04;

          // Wall collision while rolling — rebound or explode
          if (!terrain.isOpenCell(kp.mesh.position.x, kp.mesh.position.z)) {
            if (kp.bounces < 1) {
              kp.bounces++;
              const openX = terrain.isOpenCell(kp.mesh.position.x, oldZ);
              const openZ = terrain.isOpenCell(oldX, kp.mesh.position.z);
              if (openX && !openZ) {
                kp.mesh.position.z = oldZ;
                kp.vz *= -0.5;
              } else if (openZ && !openX) {
                kp.mesh.position.x = oldX;
                kp.vx *= -0.5;
              } else {
                kp.mesh.position.x = oldX;
                kp.mesh.position.z = oldZ;
                kp.vx *= -0.5;
                kp.vz *= -0.5;
              }
              audioSystem.sfxAt(
                'thud',
                kp.mesh.position.x,
                kp.mesh.position.z,
                0.3,
              );
            } else {
              kp.mesh.position.x = oldX;
              kp.mesh.position.z = oldZ;
              explodeKickedPotion(kp);
              kickedPotions.splice(ki, 1);
              continue;
            }
          }

          // Stopped rolling — explode with debris
          const speed = Math.sqrt(kp.vx * kp.vx + kp.vz * kp.vz);
          if (speed < 0.3) {
            explodeKickedPotion(kp);
            kickedPotions.splice(ki, 1);
            continue;
          }
        }

        // Check enemy collision (both airborne and rolling)
        let hitEnemy: import('./character').Enemy | null = null;
        if (enemySystem) {
          for (const enemy of enemySystem.getVisibleEnemies()) {
            if (!enemy.isAlive) continue;
            const edx = enemy.mesh.position.x - kp.mesh.position.x;
            const edz = enemy.mesh.position.z - kp.mesh.position.z;
            const edy = enemy.mesh.position.y - kp.mesh.position.y;
            if (edx * edx + edz * edz + edy * edy < 0.15) {
              hitEnemy = enemy as import('./character').Enemy;
              break;
            }
          }
        }

        if (hitEnemy && enemySystem) {
          const effect = potionSystem.colorMapping[kp.colorIndex];
          const effectMeta = EFFECT_META[effect];
          hitEnemy.takeDamage(2, kp.mesh.position.x, kp.mesh.position.z, 0.5);
          enemySystem.spawnDamageNumber(
            hitEnemy.mesh.position.x,
            hitEnemy.mesh.position.y,
            hitEnemy.mesh.position.z,
            2,
            0,
            0,
          );
          enemySystem.spawnHitSparks(
            hitEnemy.mesh.position.x,
            hitEnemy.mesh.position.y,
            hitEnemy.mesh.position.z,
            0,
            0,
          );
          if (effectMeta.duration > 0) {
            enemySystem.applyStatusEffect(
              hitEnemy,
              effect,
              effectMeta.duration,
            );
            enemySystem.spawnPickupLabel(
              hitEnemy.mesh.position.x,
              hitEnemy.mesh.position.y,
              hitEnemy.mesh.position.z,
              effectMeta.label,
              '#ff8844',
              'md',
            );
          }
          // Kicked frenzy: make this enemy a taunt target — nearby monsters attack it
          if (effect === 'frenzy') {
            enemySystem.setTauntTarget(hitEnemy);
          }
          audioSystem.sfxAt(
            'fleshHit',
            hitEnemy.mesh.position.x,
            hitEnemy.mesh.position.z,
          );
          explodeKickedPotion(kp);
          kickedPotions.splice(ki, 1);
          continue;
        }

        // Timeout safety
        if (kp.age > 5) {
          explodeKickedPotion(kp);
          kickedPotions.splice(ki, 1);
        }
      }

      // Safety net: detect player death even if callback didn't fire
      if (!playerChar.isAlive && phase === 'playing') {
        triggerPlayerDeath(playerChar);
      }

      // Hide entities in non-visible rooms
      if (roomVis) {
        if (enemySystem) {
          // Enemies in active rooms are always visible; in dimmed rooms, only visible if chasing
          for (const enemy of enemySystem.getEnemies()) {
            const pos = enemy.getPosition();
            const inActiveRoom = roomVis.isPositionActive(pos.x, pos.z);
            enemy.mesh.visible = inActiveRoom || enemy.isCurrentlyChasing();
          }
        }
        for (const mesh of collectibles.getMeshes()) {
          mesh.visible = roomVis.isPositionVisible(
            mesh.position.x,
            mesh.position.z,
          );
        }
        for (const mesh of lootSystem.getMeshes()) {
          mesh.visible = roomVis.isPositionVisible(
            mesh.position.x,
            mesh.position.z,
          );
        }
        for (const group of chestSystem.getGroups()) {
          group.visible = roomVis.isPositionVisible(
            group.position.x,
            group.position.z,
          );
        }
      }

      // Projectile system
      if (projectileSystem && enemySystem) {
        projectileSystem.update(
          gameDt,
          enemySystem.getVisibleEnemies(),
          (info) => {
            // Hit-aggro: enemy chases back regardless of range
            enemySystem!.aggroEnemy(info.enemy);

            if (info.deflected) {
              // Armour deflect: metallic sparks + clank SFX, no damage/gore
              enemySystem!.spawnDeflectVFX(
                info.x,
                info.y,
                info.z,
                info.dirX,
                info.dirZ,
              );
              audioSystem.sfxAt('clank', info.x, info.z);
              if (enemySystem!.impactCallbacks) {
                enemySystem!.impactCallbacks.onHitstop(0.06);
                enemySystem!.impactCallbacks.onCameraShake(
                  0.1,
                  0.1,
                  info.dirX,
                  info.dirZ,
                );
              }
              return;
            }

            // VFX: damage number + hit sparks (crit uses yellow style)
            enemySystem!.spawnDamageNumber(
              info.x,
              info.y,
              info.z,
              info.damage,
              info.dirX,
              info.dirZ,
              info.isCrit,
            );
            enemySystem!.spawnHitSparks(
              info.x,
              info.y,
              info.z,
              info.dirX,
              info.dirZ,
            );
            enemySystem!.spawnBloodSplash(
              info.x,
              info.y,
              info.z,
              info.enemy.groundY,
              activeCharacter ?? undefined,
            );
            audioSystem.sfxAt('fleshHit', info.x, info.z);

            // Impact feel
            const isKill = !info.enemy.isAlive;
            if (enemySystem!.impactCallbacks) {
              enemySystem!.impactCallbacks.onHitstop(isKill ? 0.1 : 0.06);
              enemySystem!.impactCallbacks.onCameraShake(
                isKill ? 0.2 : 0.12,
                isKill ? 0.2 : 0.12,
                info.dirX,
                info.dirZ,
              );
            }

            // Score on kill
            if (isKill) {
              const s = useGameStore.getState();
              s.setScore(s.score + 10);
            }
          },
          {
            getGroundY: (x: number, z: number) =>
              terrain.getTerrainYNoProps(x, z),
            terrainColliders: [
              terrain.getBoxGroup(),
              ...(terrain.getTerrainMesh() ? [terrain.getTerrainMesh()!] : []),
            ],
            excludeObjects: terrain.getOpenDoorObjects(),
            onPropHit: propDestructionSystem
              ? (entity, pos) =>
                  propDestructionSystem!.handleProjectileHit(entity)
              : undefined,
            propTargets: propDestructionSystem
              ? propDestructionSystem.getPropColliders()
              : undefined,
            destroyableMeshes: propDestructionSystem
              ? propDestructionSystem.getDestroyableMeshes()
              : undefined,
          },
        );
      }

      // Update audio listener position for spatial SFX
      const pp = activeCharacter.getPosition();
      audioSystem.setPlayerPosition(pp.x, pp.z);

      // Auto-patch any new Architecture-layer materials (e.g. async-loaded vox doors)
      patchSceneArchitecture();

      // X-ray reveal: only for dungeon presets (terrain has no useful geometry behind it)
      const playerWorldPos = new THREE.Vector3(
        pp.x,
        activeCharacter.mesh.position.y + 0.5,
        pp.z,
      );
      const isDungeonPreset =
        terrain.preset === 'dungeon' ||
        terrain.preset === 'rooms' ||
        terrain.preset === 'voxelDungeon';
      updateReveal(
        playerWorldPos,
        cam.camera.position,
        isDungeonPreset,
        terrain.preset,
      );

      // Sync light preset (exteriors get a brightness boost to counter vignette)
      const preset = useGameStore.getState().lightPreset;
      const isExterior = terrain.preset === 'heightmap';
      if (preset !== currentLightPreset || isExterior !== lastIsExterior) {
        currentLightPreset = preset;
        lastIsExterior = isExterior;
        applyLightPreset(sceneLights, preset, isExterior);
      }

      // Sync grid opacity
      const gridOp = useGameStore.getState().gridOpacity;
      if (gridOp !== currentGridOpacity) {
        currentGridOpacity = gridOp;
        terrain.setGridOpacity(gridOp);
      }

      // Sync projectile stick debug
      setDebugProjectileStick(useGameStore.getState().debugProjectileStick);

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
      const params = useGameStore.getState().characterParams;

      // Collectibles (gems)
      const pickedUp = collectibles.update(dt, activePos);
      if (pickedUp > 0) {
        const total = collectibles.getTotalCollected();
        useGameStore.getState().setCollectibles(total);
        useGameStore.getState().setScore(total);
        audioSystem.sfx('pickup');
        enemySystem?.spawnPickupLabel(
          activePos.x,
          activePos.y,
          activePos.z,
          `+${pickedUp} Gem`,
          '#44ffcc',
          'md',
        );
      }

      // Chests
      const chestsOpened = chestSystem.update(dt, activePos, params.stepHeight);
      if (chestsOpened > 0) audioSystem.sfx('chest');

      // Loot
      const loot = lootSystem.update(dt, activePos);
      if (loot.coins > 0) {
        useGameStore.getState().addCoins(loot.coins);
        useGameStore
          .getState()
          .setScore(useGameStore.getState().score + loot.coins);
        audioSystem.sfx('coin');
        enemySystem?.spawnPickupLabel(
          activePos.x,
          activePos.y,
          activePos.z,
          `+${loot.coins} Gold`,
          '#ffd700',
        );
      }
      if (loot.potions > 0) {
        // Auto-drink potions on pickup
        for (const colorIndex of loot.potionColorIndices) {
          const result = potionSystem.drink(colorIndex);
          audioSystem.sfx('drink');
          const c = POTION_COLORS[colorIndex] ?? new THREE.Color(0xffffff);
          const labelColor = result.positive ? '#44ff66' : '#ff4444';
          const labelText = result.firstTime
            ? `${result.label}!`
            : result.label;
          enemySystem?.spawnPickupLabel(
            activePos.x,
            activePos.y,
            activePos.z,
            labelText,
            labelColor,
            'md',
          );

          // Apply instant effects
          if (result.effect === 'heal') {
            const s = useGameStore.getState();
            const healAmount = 1 + Math.floor(Math.random() * 4);
            const newHp = Math.min(s.hp + healAmount, s.maxHp);
            s.setHP(newHp, s.maxHp);
            activeCharacter!.hp = newHp;
            potionVFX.spawnHealNumber(activeCharacter!, healAmount);
          }
          potionVFX.onDrink(
            result.effect,
            activeCharacter!,
            result.effect === 'armor'
              ? potionSystem.armorHitsRemaining
              : undefined,
          );

          // Frenzy drink: spawn a wave of enemies that rush the player
          if (result.effect === 'frenzy' && enemySystem) {
            enemySystem.triggerFrenzySpawn(
              activeCharacter!,
              terrain.getDoorCenters(),
              terrain.getRoomVisibility(),
            );
          }
          // Confusion drink: timed effect handled by potionSystem
        }
      }

      // Food pickup — restore hunger
      if (loot.foodHunger > 0 && activeCharacter) {
        activeCharacter.restoreHunger(loot.foodHunger);
        audioSystem.sfx('coin'); // reuse coin sfx for now
        enemySystem?.spawnPickupLabel(
          activePos.x,
          activePos.y,
          activePos.z,
          `+${loot.foodHunger} Food`,
          '#cc8844',
        );
      }

      // Collectible prop potions/bottles — Space-activated magnet pickup from dungeon props
      const propSystem2 = terrain.getPropSystem();
      if (propSystem2) {
        const { magnetRadius, magnetSpeed } = params;
        const collectibles = propSystem2.getCollectibleProps();
        for (let ci = collectibles.length - 1; ci >= 0; ci--) {
          const prop = collectibles[ci];
          const px = prop.mesh.position.x;
          const pz = prop.mesh.position.z;
          const dx = activePos.x - px;
          const dz = activePos.z - pz;
          const dist = Math.sqrt(dx * dx + dz * dz);

          const propMagnetOn = !!prop.mesh.userData.magnetActivated;

          if (propMagnetOn && dist < 0.2) {
            // Auto-drink prop potion on pickup (magnet delivered it)
            const colorIndex = prop.colorIndex ?? 0;
            const result = potionSystem.drink(colorIndex);
            audioSystem.sfx('drink');
            const labelColor = result.positive ? '#44ff66' : '#ff4444';
            const labelText = result.firstTime
              ? `${result.label}!`
              : result.label;
            enemySystem?.spawnPickupLabel(
              activePos.x,
              activePos.y,
              activePos.z,
              labelText,
              labelColor,
              'md',
            );

            if (result.effect === 'heal') {
              const s = useGameStore.getState();
              const healAmount = 1 + Math.floor(Math.random() * 4);
              const newHp = Math.min(s.hp + healAmount, s.maxHp);
              s.setHP(newHp, s.maxHp);
              activeCharacter!.hp = newHp;
              potionVFX.spawnHealNumber(activeCharacter!, healAmount);
            }
            potionVFX.onDrink(
              result.effect,
              activeCharacter!,
              result.effect === 'armor'
                ? potionSystem.armorHitsRemaining
                : undefined,
            );

            // Frenzy drink: spawn a wave of enemies that rush the player
            if (result.effect === 'frenzy' && enemySystem) {
              enemySystem.triggerFrenzySpawn(
                activeCharacter!,
                terrain.getDoorCenters(),
                terrain.getRoomVisibility(),
              );
            }
            // Confusion drink: timed effect handled by potionSystem
            propSystem2.removeProp(prop);
          } else if (propMagnetOn && dist < magnetRadius * 1.5) {
            // Magnet attraction — slide toward player (only when Space-activated)
            const speed = (1 - dist / (magnetRadius * 1.5)) * magnetSpeed * dt;
            prop.mesh.position.x += (dx / dist) * speed;
            prop.mesh.position.z += (dz / dist) * speed;
            const dy = activePos.y + 0.15 - prop.mesh.position.y;
            prop.mesh.position.y += dy * 4 * dt;
          }
        }
      }

      // Portal re-entry cooldown timer
      if (portalCooldown > 0) {
        portalCooldown -= dt;
      }

      // Exit portal detection — must be close to portal wall and moving toward it
      const exitPortalPos = terrain.getExitPortalPosition();
      if (
        exitPortalPos &&
        !exitTriggered &&
        portalCooldown <= 0 &&
        activeCharacter
      ) {
        const dx = activePos.x - exitPortalPos.x;
        const dz = activePos.z - exitPortalPos.z;
        const portalRadius = useGameStore.getState().tileSize * 0.35;
        if (Math.abs(dx) < portalRadius && Math.abs(dz) < portalRadius) {
          // Check if facing toward the exit wall
          const wallDir = terrain.getExitWallDir();
          const facing = activeCharacter.getFacing();
          const faceDx = -Math.sin(facing);
          const faceDz = -Math.cos(facing);
          const dot = faceDx * wallDir[0] + faceDz * wallDir[1];
          if (dot > 0.5) {
            // console.log(`[Portal] EXIT triggered — going down, dot=${dot.toFixed(2)}`);
            exitTriggered = true;
            changeFloor('down');
          }
        }
      }

      // Entrance portal detection — go back up
      const entrancePortalPos = terrain.getEntrancePortalPosition();
      if (
        entrancePortalPos &&
        !exitTriggered &&
        portalCooldown <= 0 &&
        activeCharacter &&
        useGameStore.getState().floor > 1
      ) {
        const edx = activePos.x - entrancePortalPos.x;
        const edz = activePos.z - entrancePortalPos.z;
        const portalRadius2 = useGameStore.getState().tileSize * 0.35;
        if (Math.abs(edx) < portalRadius2 && Math.abs(edz) < portalRadius2) {
          // Check if facing toward the entrance wall (opposite of entrance facing)
          const entranceFacing = terrain.getEntranceFacing();
          const facing = activeCharacter.getFacing();
          // Entrance wall direction is opposite of entrance facing
          const wallDx = Math.sin(entranceFacing);
          const wallDz = Math.cos(entranceFacing);
          const faceDx = -Math.sin(facing);
          const faceDz = -Math.cos(facing);
          const dot = faceDx * wallDx + faceDz * wallDz;
          if (dot > 0.5) {
            // console.log(`[Portal] ENTRANCE triggered — going up, dot=${dot.toFixed(2)}`);
            exitTriggered = true;
            changeFloor('up');
          }
        }
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
    } else if (phase === 'playing') {
      // No characters yet, still update collectibles visually
      collectibles.update(dt, new THREE.Vector3(9999, 0, 9999));
    }

    // Sync particle toggles
    syncParticles(useGameStore.getState().particleToggles);

    // Always update camera and particles (camera uses raw dt, particles use gameDt for slow-mo)
    cam.updatePosition(dt);
    for (const sys of Object.values(particleSystems)) {
      if (sys) sys.update(gameDt);
    }
  }

  function loop(time: number): void {
    rafId = requestAnimationFrame(loop);
    const dt = Math.min((time - lastTime) / 1000, 0.05);
    lastTime = time;

    update(dt);
    terrain.updateWater(dt, renderer, scene, cam.camera);
    terrain.updateProps(dt, activeCharacter?.mesh.position);

    // Update fade animation
    postProcess.updateFade(dt);

    // Sync post-processing settings and render
    const ppSettings = useGameStore.getState().postProcess;
    postProcess.sync(ppSettings);
    if (ppSettings.enabled || postProcess.isFading) {
      postProcess.render();
    } else {
      renderer.render(scene, cam.camera);
    }
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
      postProcess.dispose();
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
      // Cache terrain + player state for HMR reuse (when enabled)
      scene.remove(terrain.group);
      entityRegistry.clear();
      if (useGameStore.getState().hmrCacheEnabled) {
        setTerrainCache({
          terrain,
          navGrid,
          paramsKey: terrainParamsKey(),
        });
        if (activeCharacter) {
          const p = activeCharacter.getPosition();
          _hc.__hmrCharPos = { x: p.x, y: p.y, z: p.z };
          _hc.__hmrCharFacing = activeCharacter.facing;
          _hc.__hmrCharType = lastSelectedCharacter ?? undefined;
        }
        _hc.__hmrCamAngleX = cam.getAngleX();
        _hc.__hmrCamAngleY = cam.getAngleY();
        _hc.__hmrCamDistance = cam.getDistance();
      } else {
        setTerrainCache(null);
        terrain.dispose();
      }
      collectibles.dispose();
      chestSystem.dispose();
      lootSystem.dispose();
      for (const kp of kickedPotions) scene.remove(kp.mesh);
      kickedPotions = [];
      potionSystem.dispose();
      potionVFX.dispose();
      (window as any).__potionEffectSystem = null;
      speechSystem.dispose();
      renderer.dispose();
    },
  };
}
