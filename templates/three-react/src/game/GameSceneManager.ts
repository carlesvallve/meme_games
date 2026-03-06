import * as THREE from 'three';
import { useGameStore, DEFAULT_SCENE_SETTINGS } from '../store';
import type { ParticleToggles } from '../store';
import type { ParticleSystem } from '../types';
import { entityRegistry } from './core/Entity';
import { Environment } from './environment';
import type { TerrainPreset } from './terrain';
import type { OverworldState } from './overworld';
import { generateWorldName, generateDungeonFloorSubtitle } from './overworld';
import { getSkyColors } from './rendering';
import { CollectibleSystem, ChestSystem } from './props';
import {
  LootSystem,
  GoreSystem,
  PotionEffectSystem,
  PotionVFX,
} from './combat';
import { findPath } from './pathfinding';
import {
  createDustMotes,
  createRainEffect,
  createDebrisEffect,
} from '../utils/particles';
import {
  buildFloorEnemyPool,
  getFloorConfig,
  getThemedFloor,
  getHeightmapEnemyPool,
  setActiveRecipe,
  getActiveRecipe,
} from './dungeon';
import type { LevelSnapshot } from './dungeon';
import type { GameContext } from './GameContext';
import { rerollRoster, type CharacterType, VOX_ENEMIES, getFilteredEnemies } from './character';
import type { Character } from './character';

export interface RegenerateOpts {
  seed?: number;
  snapshot?: LevelSnapshot;
  spawnAt?: 'entrance' | 'exit';
  presetOverride?: TerrainPreset;
  themeOverride?: string;
  character?: CharacterType;
}

/** Nav cell size: 0.25m for all presets. */
function navCellForPreset(_preset: string): number {
  return 0.25;
}

export interface GameSceneManager {
  regenerateScene(opts?: RegenerateOpts): void;
  changeFloor(direction: 'down' | 'up'): void;
  syncParticles(toggles: ParticleToggles): void;
  serializeLevel(): LevelSnapshot;
  applyFloorConfig(floor: number, announce?: boolean, targetPreset?: TerrainPreset): void;
}

export function createSceneManager(
  ctx: GameContext,
  spawnCharactersFn: (controlledType: CharacterType, spawnAt?: 'entrance' | 'exit') => void,
): GameSceneManager {

  function terrainHeightAt(x: number, z: number): number {
    return ctx.terrain.getTerrainY(x, z);
  }

  function serializeLevel(): LevelSnapshot {
    const store = useGameStore.getState();
    const propSystem = ctx.terrain.getPropSystem();
    return {
      seed: store.getFloorSeed(store.floor),
      floor: store.floor,
      theme: store.currentTheme,
      enemies: ctx.enemySystem ? ctx.enemySystem.serialize() : [],
      chests: ctx.chestSystem.serialize(),
      collectibles: ctx.collectibles.serialize(),
      loot: ctx.lootSystem.serialize(),
      destroyedProps: propSystem ? propSystem.serializeDestroyed() : [],
    };
  }

  function applyFloorConfig(floor: number, announce = false, targetPreset?: TerrainPreset): void {
    const recipeName = useGameStore.getState().progressionRecipe;
    const isStoryRecipe = recipeName.startsWith('Story:');
    if (getActiveRecipe().name !== recipeName) setActiveRecipe(recipeName);

    const cfg = getFloorConfig(floor);
    const pool = buildFloorEnemyPool(floor);
    const store = useGameStore.getState();
    store.setEnemyParam('allowedTypes', pool);

    // Heightmap overworld uses a curated early-game pool (low-tier + rare mid)
    const effectivePresetForPool = targetPreset ?? store.terrainPreset;
    if (effectivePresetForPool === 'heightmap') {
      const hmPool = getHeightmapEnemyPool();
      store.setEnemyParam('allowedTypes', hmPool);
    }

    store.setZoneName(cfg.zoneName);

    // Apply dungeon layout from recipe (only for voxelDungeon preset).
    // Story recipes always force layout; others respect progressiveLayout toggle.
    // Skip for heightmap/overworld — they use their own ground size.
    const effectivePreset = targetPreset ?? store.terrainPreset;
    const isDungeon = effectivePreset === 'voxelDungeon' || isStoryRecipe;
    if (isDungeon) {
      if (store.progressiveLayout || isStoryRecipe) {
        if (cfg.dungeonSize != null) store.setDungeonSize(cfg.dungeonSize);
        if (cfg.roomSpacing != null) {
          store.setRoomSpacing(cfg.roomSpacing);
          store.setRoomSpacingMax(cfg.roomSpacing + 1);
        }
        if (cfg.doorChance != null) store.setDoorChance(cfg.doorChance);
        if (cfg.heightChance != null) store.setHeightChance(cfg.heightChance);
        if (cfg.loopChance != null) store.setLoopChance(cfg.loopChance);
      } else {
        const d = DEFAULT_SCENE_SETTINGS;
        store.setDungeonSize(d.dungeonSize);
        store.setRoomSpacing(d.roomSpacing);
        store.setRoomSpacingMax(d.roomSpacingMax);
        store.setDoorChance(d.doorChance);
        store.setHeightChance(d.heightChance);
        store.setLoopChance(d.loopChance);
      }
    }

    if (announce) {
      const themed = getThemedFloor(floor);
      if (themed) {
        store.setZoneAnnouncement({
          title: themed.title,
          subtitle: themed.subtitle,
        });
      } else {
        store.setZoneAnnouncement({
          title: cfg.zoneName,
          subtitle: `Floor ${floor}`,
        });
      }
    }
  }

  function regenerateScene(opts: RegenerateOpts = {}): void {
    // Clear speech bubbles on any transition
    ctx.speechSystem.dismissAll();
    const effectivePreset = opts.presetOverride ?? useGameStore.getState().terrainPreset;
    applyFloorConfig(useGameStore.getState().floor, false, effectivePreset as TerrainPreset);
    ctx.activeCharacter = null;
    ctx.debugLadderIndex = -1;
    ctx.needsFullRegen = false;
    ctx.exitTriggered = false;
    ctx.portalCooldown = 0;
    ctx.pendingSnapshot = opts.snapshot ?? null;
    if (ctx.dungeonEnterPrompt) {
      ctx.scene.remove(ctx.dungeonEnterPrompt);
      ctx.dungeonEnterPrompt = null;
      ctx.dungeonEnterPromptTarget = null;
    }

    // Dispose old systems
    for (const char of ctx.characters) char.dispose();
    ctx.characters = [];
    if (ctx.enemySystem) {
      ctx.enemySystem.dispose();
      ctx.enemySystem = null;
    }
    if (ctx.projectileSystem) {
      ctx.projectileSystem.dispose();
      ctx.projectileSystem = null;
    }
    ctx.goreSystem.dispose();
    ctx.goreSystem = new GoreSystem(
      ctx.scene,
      (x, z) => ctx.terrain.getTerrainNormal(x, z),
      (x, z) => ctx.terrain.getTerrainY(x, z),
    );
    ctx.goreSystem.setOpenCellCheck((wx, wz) => ctx.terrain.isOpenCell(wx, wz));
    ctx.chestSystem.dispose();
    ctx.lootSystem.dispose();
    for (const kp of ctx.kickedPotions) ctx.scene.remove(kp.mesh);
    ctx.kickedPotions = [];
    const isFloorTransition = !!opts.spawnAt;
    if (!isFloorTransition) {
      ctx.potionSystem.dispose();
    }
    ctx.potionVFX.dispose();
    ctx.collectibles.dispose();
    ctx.terrain.dispose();
    ctx.scene.remove(ctx.terrain.group);
    entityRegistry.clear();

    // Read current settings from store
    const {
      heightmapStyle,
      characterParams: pp,
      paletteName: palPick,
    } = useGameStore.getState();
    const terrainPreset =
      opts.presetOverride ?? useGameStore.getState().terrainPreset;

    // Reset time of day for exterior maps (dungeons use static lighting)
    if (terrainPreset !== 'voxelDungeon' && terrainPreset !== 'overworld') {
      useGameStore.getState().setTimeOfDay(DEFAULT_SCENE_SETTINGS.timeOfDay);
    }

    // Set zone name for non-dungeon presets (dungeons handled by applyFloorConfig)
    if (terrainPreset === 'overworld') {
      const owName = useGameStore.getState().overworldState?.worldName || 'Overworld';
      useGameStore.getState().setZoneName(owName);
      // Tile announcement handled by GameLoop tile-enter detection
    } else if (terrainPreset === 'heightmap' || terrainPreset === 'basic') {
      // Zone name for heightmap tiles is set in GameLoop before regenerateScene
      // For standalone heightmap (settings panel), use palette name as fallback
      const curZone = useGameStore.getState().zoneName;
      const owWorldName = useGameStore.getState().overworldState?.worldName;
      if (curZone === 'Upper Cellars' || curZone === 'Overworld' || curZone === owWorldName) {
        useGameStore.getState().setZoneName(palPick.charAt(0).toUpperCase() + palPick.slice(1));
      }
    }

    if (opts.themeOverride) {
      useGameStore.getState().setCurrentTheme(opts.themeOverride);
    }

    // Rebuild with optional seed — dungeons validate entrance→exit path, retry if unsolvable
    const MAX_DUNGEON_RETRIES = 10;
    let retrySeed = opts.seed;
    for (let attempt = 0; attempt <= MAX_DUNGEON_RETRIES; attempt++) {
      if (attempt > 0) {
        ctx.terrain.dispose();
        ctx.scene.remove(ctx.terrain.group);
        entityRegistry.clear();
        useGameStore.getState().setCurrentTheme('');
        retrySeed = undefined;
      }
      ctx.terrain = new Environment(
        ctx.scene,
        terrainPreset,
        heightmapStyle,
        palPick,
        retrySeed,
      );
      ctx.currentDebugDebris = false; // force re-show on new terrain
      ctx.navGrid = ctx.terrain.buildNavGrid(
        pp.stepHeight,
        pp.capsuleRadius,
        navCellForPreset(terrainPreset),
        pp.slopeHeight,
      );

      if (terrainPreset === 'voxelDungeon') {
        const entrance = ctx.terrain.getEntrancePosition();
        const exit = ctx.terrain.getExitPosition();
        if (entrance && exit) {
          const result = findPath(
            ctx.navGrid,
            entrance.x,
            entrance.z,
            exit.x,
            exit.z,
          );
          if (!result.found) {
            continue;
          }
        }
      }
      break;
    }

    ctx.cam.terrainMesh = ctx.terrain.getTerrainMesh();

    // Overworld: store overworld state (camera uses default params, follows player)
    if (terrainPreset === 'overworld') {
      // Initialize overworld state with tile defs
      const owMap = ctx.terrain.getOverworldMap();
      if (owMap) {
        const s = useGameStore.getState();
        const existingState = s.overworldState;
        const owBaseSeed = retrySeed ?? s.getFloorSeed(s.floor);
        const owState: OverworldState = {
          activeTileIndex: null,
          savedPlayerPos: existingState?.savedPlayerPos ?? null,
          zoomSpawnNorm: null,
          zoomSpawnFacing: null,
          tiles: owMap.getTileDefs(),
          baseSeed: owBaseSeed,
          worldName: existingState?.worldName ?? generateWorldName(owBaseSeed),
          clearedDungeons: existingState?.clearedDungeons ?? [],
          pendingPoiDungeon: null,
        };
        s.setOverworldState(owState);
      }
    }

    const newPalette = ctx.terrain.getPaletteName();
    useGameStore.getState().setPaletteActive(newPalette);
    // Overworld starts with a neutral sky — tile crossfade kicks in on first frame
    const skyPalette = terrainPreset === 'overworld' ? 'highlands' : newPalette;
    ctx.sceneSky.setPalette(skyPalette);
    ctx.baseSkyColors = getSkyColors(skyPalette);
    ctx.skyCrossfade = null;
    useGameStore.getState().setWalkableCells(ctx.navGrid.getWalkableCellCount());
    ctx.terrain.setGridOpacity(useGameStore.getState().gridOpacity);

    // Overworld: skip collectibles, chests, potions — no combat/loot
    const isOverworld = terrainPreset === 'overworld';

    const spawnExclude =
      opts.spawnAt === 'exit'
        ? ctx.terrain.getExitPosition()
        : ctx.terrain.getEntrancePosition();
    const gemCount = isOverworld
      ? 0
      : terrainPreset === 'voxelDungeon'
        ? Math.max(1, Math.ceil(ctx.terrain.getRoomCount() / 6))
        : undefined;
    ctx.collectibles = new CollectibleSystem(
      ctx.scene,
      ctx.terrain,
      spawnExclude ? { x: spawnExclude.x, z: spawnExclude.z } : undefined,
      gemCount,
    );
    ctx.lootSystem = new LootSystem(ctx.scene, ctx.terrain);
    if (!isFloorTransition) {
      ctx.potionSystem = new PotionEffectSystem(
        useGameStore.getState().dungeonBaseSeed,
      );
    }
    ctx.potionVFX = new PotionVFX(ctx.scene);
    (window as any).__potionEffectSystem = ctx.potionSystem;
    ctx.lootSystem.setPotionSystem(ctx.potionSystem);
    ctx.deathSequence.updateDeps({
      potionSystem: ctx.potionSystem,
      potionVFX: ctx.potionVFX,
      goreSystem: ctx.goreSystem,
      lootSystem: ctx.lootSystem,
    });
    const usePropChestsOnlyRegen = terrainPreset === 'voxelDungeon';
    const heightmapChestCap = terrainPreset === 'heightmap' ? 3 : undefined;
    ctx.chestSystem = new ChestSystem(
      ctx.scene,
      ctx.terrain,
      ctx.lootSystem,
      isOverworld ? true : usePropChestsOnlyRegen, // skip free-standing chests on overworld
      heightmapChestCap,
    );
    // Wire mimic spawn: when a mimic chest is opened, spawn a mimic enemy at that position
    ctx.chestSystem.setMimicSpawnCallback((position, variant) => {
      if (!ctx.enemySystem || !ctx.activeCharacter) return;
      const mimicIds = VOX_ENEMIES.filter(e => e.id.startsWith('mimic'));
      let entry = mimicIds[Math.floor(Math.random() * mimicIds.length)];
      if (variant) {
        const match = mimicIds.find(e => e.id.startsWith(`mimic_${variant}`));
        if (match) entry = match;
      }
      const filtered = getFilteredEnemies([entry.id]);
      const mimicEntry = filtered.length > 0 ? filtered[0] : entry;
      const enemy = ctx.enemySystem.spawnEnemyAt(
        position.x, position.z,
        ctx.activeCharacter, false, mimicEntry,
      );
      // Override Y to chest's known floor position (getTerrainY may sample wall tops)
      enemy.mesh.position.y = position.y;
      enemy.groundY = position.y;
      enemy.visualGroundY = position.y;
    });

    if (usePropChestsOnlyRegen) {
      for (const mesh of ctx.collectibles.getMeshes()) mesh.visible = false;
      for (const mesh of ctx.lootSystem.getMeshes()) mesh.visible = false;
      for (const group of ctx.chestSystem.getGroups()) group.visible = false;
    }
    if (usePropChestsOnlyRegen) {
      ctx.terrain.setPropChestRegistrar((list) => {
        list.forEach(({ position, mesh, entity, openGeo, variantId }) =>
          ctx.chestSystem.registerPropChest(position, mesh, entity, openGeo, variantId),
        );
        if (ctx.pendingSnapshot) {
          ctx.chestSystem.restoreState(ctx.pendingSnapshot.chests);
          ctx.collectibles.restoreState(ctx.pendingSnapshot.collectibles);
          ctx.lootSystem.restoreLoot(ctx.pendingSnapshot.loot);
          if (ctx.pendingSnapshot.destroyedProps?.length) {
            const ps = ctx.terrain.getPropSystem();
            if (ps) {
              ps.restoreDestroyed(ctx.pendingSnapshot.destroyedProps);
              for (const dp of ctx.pendingSnapshot.destroyedProps) {
                ctx.terrain.unblockPropAt(dp.x, dp.z);
              }
            }
          }
          ctx.pendingSnapshot = null;
        }
      });
    }

    // When props finish loading, reposition character to precise entrance/exit
    const spawnAtCapture = opts.spawnAt;
    if (usePropChestsOnlyRegen) {
      ctx.terrain.setOnDungeonReady(() => {
        if (!ctx.activeCharacter) return;

        if (spawnAtCapture) {
          const pos =
            spawnAtCapture === 'exit'
              ? ctx.terrain.getExitPosition()
              : ctx.terrain.getEntrancePosition();
          if (pos) {
            const y = ctx.terrain.getTerrainY(pos.x, pos.z);
            ctx.activeCharacter.mesh.position.set(pos.x, y, pos.z);
            ctx.activeCharacter.groundY = y;
            ctx.activeCharacter.visualGroundY = y;
            ctx.portalCooldown = 1.0;
          } else {
            const charPos = ctx.activeCharacter.getPosition();
            const y = ctx.terrain.getTerrainY(charPos.x, charPos.z);
            ctx.activeCharacter.mesh.position.y = y;
            ctx.activeCharacter.groundY = y;
            ctx.activeCharacter.visualGroundY = y;
          }

          if (spawnAtCapture === 'exit') {
            const exitWallDir = ctx.terrain.getExitWallDir();
            ctx.activeCharacter.setFacing(
              Math.atan2(-exitWallDir[0], -exitWallDir[1]),
            );
          } else {
            const entranceFacing = ctx.terrain.getEntranceFacing();
            if (entranceFacing) ctx.activeCharacter.setFacing(entranceFacing);
          }
        }

        const roomVis = ctx.terrain.getRoomVisibility();
        const doorSys = ctx.terrain.getDoorSystem();
        if (roomVis) {
          const cp = ctx.activeCharacter.getPosition();
          roomVis.update(cp.x, cp.z, doorSys);

          for (const mesh of ctx.collectibles.getMeshes()) {
            mesh.visible = roomVis.isPositionVisible(mesh.position.x, mesh.position.z);
          }
          for (const mesh of ctx.lootSystem.getMeshes()) {
            mesh.visible = roomVis.isPositionVisible(mesh.position.x, mesh.position.z);
          }
          for (const group of ctx.chestSystem.getGroups()) {
            group.visible = roomVis.isPositionVisible(group.position.x, group.position.z);
          }
          if (ctx.enemySystem) {
            for (const enemy of ctx.enemySystem.getEnemies()) {
              const epos = enemy.getPosition();
              enemy.mesh.visible = roomVis.isPositionActive(epos.x, epos.z);
            }
          }
        }

        if (isFloorTransition) {
          const activeEffects = ctx.potionSystem.getActiveEffects();
          if (activeEffects.length > 0) {
            ctx.potionVFX.restoreActiveEffects(
              activeEffects,
              ctx.activeCharacter,
              ctx.potionSystem.armorHitsRemaining,
            );
          }
        }

        ctx.terrain.getGroup().visible = true;
        ctx.activeCharacter.mesh.visible = true;
        const camTarget = ctx.activeCharacter.getCameraTarget();
        ctx.cam.setTarget(camTarget.x, camTarget.y, camTarget.z);
        ctx.cam.snapToTarget();
        ctx.postProcess.releaseFade();
      });
    }

    // Keep current character on floor transition; on full regen use provided or previously selected character
    if (!opts.spawnAt) {
      if (opts.character) {
        ctx.lastSelectedCharacter = opts.character;
      }
      if (!ctx.lastSelectedCharacter) {
        rerollRoster();
        useGameStore.getState().setPhase('select');
        return;
      }
      useGameStore.getState().selectCharacter(ctx.lastSelectedCharacter);
    }
    spawnCharactersFn(ctx.lastSelectedCharacter!, opts.spawnAt);

    // activeCharacter is set by spawnCharactersFn above (TS can't track closure mutation)
    const spawnedChar = ctx.activeCharacter as Character | null;

    if (spawnedChar) {
      spawnedChar.mesh.visible = false;
    }

    // Overworld: restore player position from saved state
    // Heightmap uses zoomSpawnNorm (handled in spawnCharacters) or savedPlayerPos from dungeon return
    if ((isOverworld || terrainPreset === 'heightmap') && spawnedChar) {
      const owSaved = useGameStore.getState().overworldState?.savedPlayerPos;
      if (owSaved) {
        const y = ctx.terrain.getTerrainY(owSaved.x, owSaved.z);
        spawnedChar.mesh.position.set(owSaved.x, y, owSaved.z);
        spawnedChar.groundY = y;
        spawnedChar.visualGroundY = y;
        // Clear saved pos after restoring for heightmap (overworld keeps it)
        if (terrainPreset === 'heightmap') {
          const curOw = useGameStore.getState().overworldState;
          if (curOw) {
            useGameStore.getState().setOverworldState({
              ...curOw,
              savedPlayerPos: null,
            });
          }
        }
      }
    }

    if (spawnedChar) {
      const p = spawnedChar.mesh.position;
      ctx.cam.setTarget(p.x, p.y, p.z);
      ctx.cam.snapToTarget();
    }

    if (!usePropChestsOnlyRegen) {
      ctx.postProcess.releaseFade();
      if (spawnedChar) {
        const charToShow = spawnedChar;
        requestAnimationFrame(() => {
          charToShow.mesh.visible = true;
        });
      }
    }
  }

  function changeFloor(direction: 'down' | 'up'): void {
    ctx.speechSystem.dismissAll();

    // Pre-compute announcement for the target floor
    const store0 = useGameStore.getState();
    const currentFloor = store0.floor;
    const owState = store0.overworldState;
    const pending = owState?.pendingPoiDungeon;
    const newFloor = direction === 'down' ? currentFloor + 1 : currentFloor - 1;
    const isRetreat = direction === 'up' && currentFloor === 1 && pending;
    const isConquest = direction === 'down' && pending && currentFloor >= pending.floorCount;

    if ((isRetreat || isConquest) && pending) {
      // No centered announcement — bottom-left will scramble in after fade
      store0.beginZoneTransition(null);
    } else if (pending) {
      const skullPrefix = '\u2620'.repeat(pending.skulls) + ' ';
      store0.beginZoneTransition({
        title: skullPrefix + pending.name,
        subtitle: generateDungeonFloorSubtitle(pending.poiSeed, newFloor, pending.floorCount),
      });
    } else {
      store0.beginZoneTransition(null);
    }

    ctx.postProcess.fadeTransition(() => {
      const store = useGameStore.getState();

      // ── POI dungeon: retreat from floor 1 entrance ──
      if (isRetreat) {
        returnToHeightmapFromDungeon(store, owState!, pending!, false);
        return;
      }

      // ── POI dungeon: completed last floor → conquered ──
      if (isConquest) {
        returnToHeightmapFromDungeon(store, owState!, pending!, true);
        return;
      }

      // ── Normal floor transition ──
      const snapshot = serializeLevel();
      store.saveLevelSnapshot(currentFloor, snapshot);

      store.setFloor(newFloor);
      // POI dungeons already set announcement via beginZoneTransition; non-POI still need it
      applyFloorConfig(newFloor, !pending);

      const cached = store.getLevelSnapshot(newFloor);
      const seed = store.getFloorSeed(newFloor);

      if (!cached) store.setCurrentTheme('');

      regenerateScene({
        seed,
        snapshot: cached,
        spawnAt: direction === 'down' ? 'entrance' : 'exit',
        themeOverride: cached?.theme,
      });
    }, 4.0);
  }

  /** Return from a POI dungeon to the heightmap tile. */
  function returnToHeightmapFromDungeon(
    store: ReturnType<typeof useGameStore.getState>,
    owState: OverworldState,
    pending: NonNullable<OverworldState['pendingPoiDungeon']>,
    conquered: boolean,
  ): void {
    const tileDef = owState.tiles[pending.tileIndex];

    // Update overworld state
    const updatedOw: OverworldState = {
      ...owState,
      pendingPoiDungeon: null,
      savedPlayerPos: (() => {
        // Heightmap ground size = dungeonSize - 4 (2m margin each side)
        const hmGround = DEFAULT_SCENE_SETTINGS.dungeonSize - 4;
        const px = pending.returnNorm.nx * hmGround;
        const pz = pending.returnNorm.nz * hmGround;
        // Offset ~1 cell toward map center so player doesn't land on the door
        const cx = hmGround / 2, cz = hmGround / 2;
        const dx = cx - px, dz = cz - pz;
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        return { x: px + (dx / len) * 1.0, z: pz + (dz / len) * 1.0, y: 0 };
      })(),
      ...(conquered
        ? { clearedDungeons: [...owState.clearedDungeons, pending.poiSeed] }
        : {}),
    };
    store.setOverworldState(updatedOw);

    // Reset to default recipe & floor
    store.setProgressionRecipe('Classic');
    store.setFloor(1);
    store.clearLevelCache();

    // Delay labels so they scramble in during fade-in
    const regionName = tileDef.label || 'Unknown Lands';
    const styleName = tileDef.heightmapStyle.charAt(0).toUpperCase() + tileDef.heightmapStyle.slice(1);
    const palName = tileDef.paletteName.charAt(0).toUpperCase() + tileDef.paletteName.slice(1);
    setTimeout(() => {
      const s = useGameStore.getState();
      s.setZoneName(regionName);
      s.setZoneSubtitle(`${palName} ${styleName}`);
    }, 500);

    // Restore heightmap settings and terrain preset
    store.setTerrainPreset('heightmap');
    store.setPaletteName(tileDef.paletteName);
    store.setHeightmapStyle(tileDef.heightmapStyle);
    // Restore default dungeon size (heightmap uses it as ground size)
    store.setDungeonSize(DEFAULT_SCENE_SETTINGS.dungeonSize);
    store.setRoomSpacing(DEFAULT_SCENE_SETTINGS.roomSpacing);
    store.setRoomSpacingMax(DEFAULT_SCENE_SETTINGS.roomSpacingMax);

    regenerateScene({
      presetOverride: 'heightmap',
      seed: tileDef.seed,
    });
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
      const had = ctx.prevToggles[key];
      if (want && !had) {
        const sys = createParticleSystem(key);
        ctx.particleSystems[key] = sys;
        ctx.scene.add(sys.group);
      } else if (!want && had) {
        const sys = ctx.particleSystems[key];
        if (sys) {
          ctx.scene.remove(sys.group);
          sys.dispose();
          ctx.particleSystems[key] = null;
        }
      }
      ctx.prevToggles[key] = want;
    }
  }

  return {
    regenerateScene,
    changeFloor,
    syncParticles,
    serializeLevel,
    applyFloorConfig,
  };
}
