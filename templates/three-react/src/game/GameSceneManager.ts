import * as THREE from 'three';
import { useGameStore, DEFAULT_SCENE_SETTINGS } from '../store';
import type { ParticleToggles } from '../store';
import type { ParticleSystem } from '../types';
import { entityRegistry } from './core/Entity';
import { Environment } from './environment';
import type { TerrainPreset } from './terrain';
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
  setActiveRecipe,
  getActiveRecipe,
} from './dungeon';
import type { LevelSnapshot } from './dungeon';
import type { GameContext } from './GameContext';
import { rerollRoster, type CharacterType } from './character';
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
  applyFloorConfig(floor: number, announce?: boolean): void;
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

  function applyFloorConfig(floor: number, announce = false): void {
    const recipeName = useGameStore.getState().progressionRecipe;
    if (getActiveRecipe().name !== recipeName) setActiveRecipe(recipeName);

    const cfg = getFloorConfig(floor);
    const pool = buildFloorEnemyPool(floor);
    const store = useGameStore.getState();
    store.setEnemyParam('allowedTypes', pool);
    store.setZoneName(cfg.zoneName);

    // Apply dungeon layout progression from recipe, or restore defaults when disabled
    if (store.progressiveLayout) {
      if (cfg.dungeonSize != null) store.setDungeonSize(cfg.dungeonSize);
      if (cfg.roomSpacing != null) store.setRoomSpacing(cfg.roomSpacing);
      if (cfg.doorChance != null) store.setDoorChance(cfg.doorChance);
      if (cfg.heightChance != null) store.setHeightChance(cfg.heightChance);
      if (cfg.loopChance != null) store.setLoopChance(cfg.loopChance);
    } else {
      const d = DEFAULT_SCENE_SETTINGS;
      store.setDungeonSize(d.dungeonSize);
      store.setRoomSpacing(d.roomSpacing);
      store.setDoorChance(d.doorChance);
      store.setHeightChance(d.heightChance);
      store.setLoopChance(d.loopChance);
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
    applyFloorConfig(useGameStore.getState().floor);
    ctx.activeCharacter = null;
    ctx.debugLadderIndex = -1;
    ctx.needsFullRegen = false;
    ctx.exitTriggered = false;
    ctx.portalCooldown = 0;
    ctx.pendingSnapshot = opts.snapshot ?? null;

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
    useGameStore.getState().setPaletteActive(ctx.terrain.getPaletteName());
    ctx.sceneSky.setPalette(ctx.terrain.getPaletteName());
    useGameStore.getState().setWalkableCells(ctx.navGrid.getWalkableCellCount());
    ctx.terrain.setGridOpacity(useGameStore.getState().gridOpacity);

    const spawnExclude =
      opts.spawnAt === 'exit'
        ? ctx.terrain.getExitPosition()
        : ctx.terrain.getEntrancePosition();
    const gemCount =
      terrainPreset === 'voxelDungeon'
        ? Math.max(2, Math.ceil(ctx.terrain.getRoomCount() / 2))
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
    ctx.chestSystem = new ChestSystem(
      ctx.scene,
      ctx.terrain,
      ctx.lootSystem,
      usePropChestsOnlyRegen,
    );

    if (usePropChestsOnlyRegen) {
      for (const mesh of ctx.collectibles.getMeshes()) mesh.visible = false;
      for (const mesh of ctx.lootSystem.getMeshes()) mesh.visible = false;
      for (const group of ctx.chestSystem.getGroups()) group.visible = false;
    }
    if (usePropChestsOnlyRegen) {
      ctx.terrain.setPropChestRegistrar((list) => {
        list.forEach(({ position, mesh, entity, openGeo }) =>
          ctx.chestSystem.registerPropChest(position, mesh, entity, openGeo),
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

    ctx.postProcess.fadeTransition(() => {
      const store = useGameStore.getState();
      const currentFloor = store.floor;

      const snapshot = serializeLevel();
      store.saveLevelSnapshot(currentFloor, snapshot);

      const newFloor =
        direction === 'down' ? currentFloor + 1 : currentFloor - 1;
      store.setFloor(newFloor);
      applyFloorConfig(newFloor, true);

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
