import * as THREE from 'three';
import { useGameStore } from '../store';
import {
  Character,
  CHARACTER_TEAM_COLORS,
  getSlots,
  getCharacterName,
  voxRoster,
  VOX_HEROES,
  VOX_ENEMIES,
  getProjectileConfig,
  getMuzzleOffset,
  getArchetype,
  getCharacterStats,
  randomInRange,
} from './character';
import type { CharacterType } from './character';
import { EnemySystem } from './enemies';
import { ProjectileSystem, PropDestructionSystem } from './combat';
import { getThemedFloor } from './dungeon';
import type { GameContext, CharInventory } from './GameContext';
import { applyCharacterStats } from './GameCallbacks';

export interface GameCharacterManager {
  spawnCharacters(controlledType: CharacterType, spawnAt?: 'entrance' | 'exit'): void;
  selectCharacter(char: Character | null): void;
  cycleCharacter(dir: 1 | -1): void;
  syncAllCharacterParams(): void;
  makePlayerControlDeps(): {
    getInput: () => import('./core/Input').InputState;
    getCameraAngleY: () => number;
    getParams: () => import('./character').MovementParams;
    isConfused: () => boolean;
  };
  getInventory(): CharInventory;
  saveActiveInventory(): void;
  loadActiveInventory(): void;
  updateActiveCharacterUI(): void;
}

export function createCharacterManager(ctx: GameContext): GameCharacterManager {

  let lastSyncedCharacterParams:
    | ReturnType<typeof useGameStore.getState>['characterParams']
    | null = null;

  function getInventoryKey(): string {
    return ctx.activeCharacter
      ? `char:${ctx.activeCharacter.characterType}`
      : 'unknown';
  }

  function getInventory(): CharInventory {
    const key = getInventoryKey();
    if (!ctx.inventories.has(key))
      ctx.inventories.set(key, { collectibles: 0, coins: 0, potionInventory: [] });
    return ctx.inventories.get(key)!;
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
    if (ctx.activeCharacter) {
      useGameStore.getState().setActiveCharacter(
        getCharacterName(ctx.activeCharacter.characterType),
        CHARACTER_TEAM_COLORS[ctx.activeCharacter.characterType],
      );
    }
  }

  function makePlayerControlDeps() {
    return {
      getInput: () => ctx.cachedInputState,
      getCameraAngleY: () => ctx.cam.getAngleY(),
      getParams: () => ctx.activeCharacter!.params,
      isConfused: () => ctx.potionSystem.isConfusion,
    };
  }

  function syncAllCharacterParams(): void {
    const pp = useGameStore.getState().characterParams;
    if (pp === lastSyncedCharacterParams) return;
    lastSyncedCharacterParams = pp;
    for (const char of ctx.characters) {
      const p = char.params;
      p.stepHeight = pp.stepHeight;
      p.slopeHeight = pp.slopeHeight;
      p.capsuleRadius = pp.capsuleRadius;
      p.arrivalReach = pp.arrivalReach;
      p.hopHeight = pp.hopHeight;
      p.movementMode = pp.movementMode;
      p.showPathDebug = pp.showPathDebug;
      p.attackReach = pp.attackReach;
      p.attackArcHalf = pp.attackArcHalf;
      p.chaseRange = pp.chaseRange * 0.25;
      p.knockbackDecay = pp.knockbackDecay;
      p.invulnDuration = pp.invulnDuration;
      p.flashDuration = pp.flashDuration;
      p.stunDuration = pp.stunDuration;
      p.actionHoldTime = pp.actionHoldTime;
      p.exhaustDuration = pp.exhaustDuration;
      p.footIKEnabled = pp.footIKEnabled;
    }
  }

  function selectCharacter(char: Character | null): void {
    if (char === ctx.activeCharacter) return;

    saveActiveInventory();

    if (ctx.activeCharacter) {
      ctx.activeCharacter.setAIControlled();
    }

    ctx.activeCharacter = char;

    if (char) {
      char.setPlayerControlled(makePlayerControlDeps());
      ctx.lastSelectedCharacter = char.characterType;
      useGameStore.getState().selectCharacter(char.characterType);
    }

    loadActiveInventory();
    updateActiveCharacterUI();
  }

  function cycleCharacter(dir: 1 | -1): void {
    if (ctx.characters.length === 0) return;
    const curIdx = ctx.activeCharacter ? ctx.characters.indexOf(ctx.activeCharacter) : -1;
    const nextIdx =
      (((curIdx + dir) % ctx.characters.length) + ctx.characters.length) %
      ctx.characters.length;
    selectCharacter(ctx.characters[nextIdx]);
  }

  function spawnCharacters(
    controlledType: CharacterType,
    spawnAt?: 'entrance' | 'exit',
  ): void {
    for (const char of ctx.characters) char.dispose();
    ctx.characters = [];
    ctx.activeCharacter = null;
    ctx.deathSequence.reset();
    ctx.inventories.clear();

    const ladderDefs = ctx.terrain.getLadderDefs();

    // Spawn only the controlled hero
    {
      let pos!: THREE.Vector3;
      const _hc = window as any;
      if (ctx.hmrReused && _hc.__hmrCharPos) {
        const cp = _hc.__hmrCharPos;
        pos = new THREE.Vector3(cp.x, cp.y, cp.z);
        _hc.__hmrCharPos = undefined;
      } else if (spawnAt === 'exit') {
        const exitPos = ctx.terrain.getExitPosition();
        if (exitPos) {
          const ey = ctx.terrain.getTerrainY(exitPos.x, exitPos.z);
          pos = new THREE.Vector3(exitPos.x, ey, exitPos.z);
        } else {
          pos = ctx.terrain.getRandomPosition();
        }
      } else {
        // Check if zooming in from overworld — map tile-local position to heightmap
        const owState = useGameStore.getState().overworldState;
        const zoomNorm = owState?.zoomSpawnNorm;
        let placed = false;
        if (zoomNorm && owState?.activeTileIndex !== null) {
          const hmSize = useGameStore.getState().dungeonSize;
          const targetX = zoomNorm.nx * hmSize;
          const targetZ = zoomNorm.nz * hmSize;
          // Spiral search for nearest walkable cell
          const walkPos = findNearestWalkable(ctx, targetX, targetZ, hmSize);
          if (walkPos) {
            pos = walkPos;
            placed = true;
          }
          // Clear the norm so it doesn't persist (keep facing for use below)
          useGameStore.getState().setOverworldState({ ...owState, zoomSpawnNorm: null });
        }
        if (!placed) {
          const entrancePos = ctx.terrain.getEntrancePosition();
          if (entrancePos) {
            const ey = ctx.terrain.getTerrainY(entrancePos.x, entrancePos.z);
            pos = new THREE.Vector3(entrancePos.x, ey, entrancePos.z);
          } else {
            const spawnY = ctx.terrain.getTerrainY(0, 0);
            pos = ctx.navGrid.isWalkable(0, 0)
              ? new THREE.Vector3(0, spawnY, 0)
              : ctx.terrain.getRandomPosition();
          }
        }
      }

      const char = new Character(
        ctx.scene,
        ctx.terrain,
        ctx.navGrid,
        controlledType,
        pos,
        ladderDefs,
      );
      char.setPlayerControlled(makePlayerControlDeps());
      char.hungerEnabled = true;
      char.regenDelay = 5.0;
      char.regenRate = 0.1;
      // Restore facing from overworld → heightmap transition
      const owFacing = useGameStore.getState().overworldState?.zoomSpawnFacing;
      if (owFacing != null) {
        char.setFacing(owFacing);
        const ow = useGameStore.getState().overworldState!;
        useGameStore.getState().setOverworldState({ ...ow, zoomSpawnFacing: null });
      } else if (ctx.hmrReused && _hc.__hmrCharFacing != null) {
        char.setFacing(_hc.__hmrCharFacing);
        _hc.__hmrCharFacing = undefined;
      } else if (spawnAt === 'exit') {
        const exitWallDir = ctx.terrain.getExitWallDir();
        const facing = Math.atan2(-exitWallDir[0], -exitWallDir[1]);
        char.setFacing(facing);
      } else {
        const entranceFacing = ctx.terrain.getEntranceFacing();
        if (entranceFacing) char.setFacing(entranceFacing);
      }
      // Scale down character on overworld
      if (ctx.terrain.preset === 'overworld') {
        char.mesh.scale.setScalar(0.8);
      }
      ctx.characters.push(char);
      ctx.activeCharacter = char;

      if (spawnAt) {
        ctx.portalCooldown = 1.0;
      }
    }

    ctx.speechSystem.resume();
    ctx.speechSystem.setCharacters(ctx.characters);

    if (ctx.activeCharacter) {
      if (!spawnAt) {
        useGameStore.getState().setCollectibles(0);
        useGameStore.getState().setHP(ctx.activeCharacter.hp, ctx.activeCharacter.maxHp);
        useGameStore.getState().setHunger(ctx.activeCharacter.hunger, ctx.activeCharacter.maxHunger);
      } else {
        const { hp, maxHp, hunger, maxHunger } = useGameStore.getState();
        ctx.activeCharacter.hp = hp;
        ctx.activeCharacter.maxHp = maxHp;
        ctx.activeCharacter.hunger = hunger;
        ctx.activeCharacter.maxHunger = maxHunger;
      }
      useGameStore.getState().setActiveCharacter(
        getCharacterName(controlledType),
        CHARACTER_TEAM_COLORS[controlledType],
      );
    }

    // Spawn enemies + projectile system (skip on overworld — no combat)
    const isOverworld = ctx.terrain.preset === 'overworld';
    if (ctx.enemySystem) ctx.enemySystem.dispose();
    if (ctx.projectileSystem) ctx.projectileSystem.dispose();
    if (isOverworld) {
      ctx.enemySystem = null;
      ctx.projectileSystem = null;
      ctx.propDestructionSystem = null;
      return;
    }
    ctx.enemySystem = new EnemySystem(
      ctx.scene,
      ctx.terrain,
      ctx.navGrid,
      ctx.lootSystem,
      ladderDefs,
    );
    ctx.enemySystem.setGoreSystem(ctx.goreSystem);
    ctx.enemySystem.setPotionSystem(ctx.potionSystem);
    ctx.projectileSystem = new ProjectileSystem(ctx.scene);
    ctx.enemySystem.setAllyCharacters(ctx.characters);
    ctx.enemySystem.impactCallbacks = {
      onHitstop: (duration) => { ctx.hitstopTimer = Math.max(ctx.hitstopTimer, duration); },
      onCameraShake: (intensity, duration, dirX, dirZ) =>
        ctx.cam.shake(intensity, duration, dirX, dirZ),
    };

    ctx.propDestructionSystem = null;

    if (!ctx.terrain.getRoomVisibility() && ctx.activeCharacter) {
      const cp = ctx.activeCharacter.getPosition();
      const chaseRange = useGameStore.getState().enemyParams.chaseRange * 0.25;
      ctx.enemySystem.setPlayerExclusionZone(cp.x, cp.z, chaseRange);
    }

    ctx.enemySystem.setTransitionExclusions(ctx.terrain.getLevelTransitionPositions());

    if (ctx.pendingSnapshot && ctx.pendingSnapshot.enemies.length > 0) {
      ctx.enemySystem.restoreEnemies(ctx.pendingSnapshot.enemies);
    } else {
      const ep = useGameStore.getState().enemyParams;
      const diff = Math.max(0, ep.difficulty); // 0-2, default 1
      const walkableCells = ctx.navGrid.getWalkableCellCount();
      // Heightmaps are open-world areas — use much lower density & cap
      const terrainPreset = useGameStore.getState().terrainPreset;
      const isHeightmap = terrainPreset === 'heightmap';
      const baseDensity = isHeightmap ? ep.enemyDensity * 0.25 : ep.enemyDensity;
      const density = baseDensity * diff;
      const cap = isHeightmap ? Math.min(ep.maxEnemies, 8) : ep.maxEnemies;
      const maxEnemies =
        density <= 0
          ? 0
          : Math.min(
              cap,
              Math.max(1, Math.round(walkableCells * density)),
            );
      if (maxEnemies > 0) {
        ctx.enemySystem.spawnEnemies(maxEnemies);
        // Spawn interval: higher difficulty = faster respawns
        const baseInterval = isHeightmap ? 30 : ep.spawnInterval;
        const interval = diff > 0 ? baseInterval / diff : 999;
        ctx.enemySystem.enableWaveSpawning(maxEnemies, interval);
      }
    }

    // Themed floor: spawn boss enemies near exit
    if (!ctx.pendingSnapshot) {
      const themed = getThemedFloor(useGameStore.getState().floor);
      if (themed) {
        const exitPos = ctx.terrain.getExitPosition();
        if (exitPos) {
          ctx.enemySystem.spawnBossEnemies(
            themed.bossArchetype,
            themed.bossCount,
            exitPos.x,
            exitPos.z,
          );
        }
      }
    }

    if (ctx.terrain.getRoomVisibility()) {
      for (const enemy of ctx.enemySystem.getEnemies()) {
        enemy.mesh.visible = false;
      }
    }
  }

  return {
    spawnCharacters,
    selectCharacter,
    cycleCharacter,
    syncAllCharacterParams,
    makePlayerControlDeps,
    getInventory,
    saveActiveInventory,
    loadActiveInventory,
    updateActiveCharacterUI,
  };
}

/** Spiral search from (targetX, targetZ) to find the nearest walkable cell. */
function findNearestWalkable(
  ctx: GameContext,
  targetX: number,
  targetZ: number,
  maxRadius: number,
): THREE.Vector3 | null {
  const step = ctx.navGrid.cellSize ?? 0.5;
  // Check target first
  if (ctx.navGrid.isWalkable(targetX, targetZ)) {
    const y = ctx.terrain.getTerrainY(targetX, targetZ);
    return new THREE.Vector3(targetX, y, targetZ);
  }
  // Expand in rings
  for (let r = step; r < maxRadius * 0.5; r += step) {
    for (let angle = 0; angle < Math.PI * 2; angle += step / r) {
      const x = targetX + Math.cos(angle) * r;
      const z = targetZ + Math.sin(angle) * r;
      if (ctx.navGrid.isWalkable(x, z)) {
        const y = ctx.terrain.getTerrainY(x, z);
        return new THREE.Vector3(x, y, z);
      }
    }
  }
  return null;
}
