import * as THREE from 'three';
import { useGameStore, DEFAULT_CAMERA_PARAMS } from '../store';
import { getTileAtWorldPos, tileCenterWorld, OW_TILE_SIZE, OW_TOTAL_SIZE, OW_GRID, generateDungeonFloorSubtitle } from './overworld';
import type { POIDef } from './overworld';
import { buildStoryRecipe } from './recipes/story';
import { createTextLabel, updateTextLabel } from './rendering/TextLabel';
import {
  applyLightPreset,
  updateReveal,
  patchSceneArchitecture,
  updateDayCycle,
  applyDungeonLighting,
  createSunDebugHelper,
  updateSunDebug,
  disposeSunDebugHelper,
  computeSunDirection,
} from './rendering';
import { getSkyColors, lerpSkyColors } from './rendering';
import {
  setDebugProjectileStick,
  POTION_COLORS,
  EFFECT_META,
  PropDestructionSystem,
} from './combat';
import {
  rerollRoster,
  getProjectileConfig,
  getMuzzleOffset,
} from './character';
import type { Character, Enemy } from './character';
import { audioSystem } from '../utils/AudioSystem';
import type { GameContext } from './GameContext';
import type { GameSceneManager } from './GameSceneManager';
import type { GameCharacterManager } from './GameCharacters';
import type { GameInputManager } from './GameInput';
import { findMeleeAimTarget } from './GameInput';

export interface GameLoop {
  start(): void;
  triggerHitstop(duration: number): void;
  triggerPlayerDeath(playerChar: Character): void;
}

export function createGameLoop(
  ctx: GameContext,
  sceneManager: GameSceneManager,
  characters: GameCharacterManager,
  inputManager: GameInputManager,
): GameLoop {

  function triggerHitstop(duration: number): void {
    ctx.hitstopTimer = Math.max(ctx.hitstopTimer, duration);
  }

  function triggerPlayerDeath(playerChar: Character): void {
    ctx.deathSequence.trigger(playerChar);
  }

  function getKickAutoTarget(px: number, pz: number, faceDirX: number, faceDirZ: number): { x: number; z: number } | null {
    if (!ctx.enemySystem) return null;
    let bestDist = Infinity;
    let bestPos: { x: number; z: number } | null = null;
    for (const enemy of ctx.enemySystem.getVisibleEnemies()) {
      if (!enemy.isAlive) continue;
      const ex = enemy.mesh.position.x;
      const ez = enemy.mesh.position.z;
      const dx = ex - px;
      const dz = ez - pz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 8 || dist < 0.1) continue;
      const nx = dx / dist;
      const nz = dz / dist;
      const dot = faceDirX * nx + faceDirZ * nz;
      if (dot < 0.3) continue;
      if (dist < bestDist) {
        bestDist = dist;
        bestPos = { x: ex, z: ez };
      }
    }
    return bestPos;
  }

  function explodeKickedPotion(kp: typeof ctx.kickedPotions[0]): void {
    const potionColor =
      POTION_COLORS[kp.colorIndex] ?? new THREE.Color(0xffffff);
    const x = kp.mesh.position.x;
    const y = kp.mesh.position.y;
    const z = kp.mesh.position.z;
    const groundY = ctx.terrain.getFloorY(x, z);
    const count = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const c = potionColor.clone();
      c.offsetHSL(0, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.15);
      ctx.goreSystem.spawnChunk(
        x, y + 0.03, z, groundY, c, 0.012, 0.035,
        1.5 + Math.random() * 1.5, 1.5, 0, 0,
      );
    }
    audioSystem.sfxAt('ceramicBreak', x, z);
    ctx.scene.remove(kp.mesh);
  }

  function update(dt: number): void {
    if (ctx.postProcess.isFadingOut) {
      ctx.cam.updatePosition(dt);
      return;
    }

    if (ctx.hitstopTimer > 0) {
      ctx.hitstopTimer -= dt;
      ctx.cam.updatePosition(dt);
      return;
    }

    const { scaledDt: gameDt, active: deathTransitionActive } =
      ctx.deathSequence.update(dt);

    ctx.cachedInputState = ctx.input.update();
    const { phase, cameraParams } = useGameStore.getState();
    ctx.cam.setParams(cameraParams);

    if (ctx.cachedInputState.cameraSnap && ctx.activeCharacter) {
      ctx.cam.snapBehind(ctx.activeCharacter.facing);
    }

    if (ctx.cachedInputState.pause && (phase === 'playing' || phase === 'paused')) {
      useGameStore.getState().onPauseToggle?.();
      return;
    }

    // Check for character selection — regenerate scene on new game after death
    const selected = useGameStore.getState().selectedCharacter;
    if (selected && selected !== ctx.lastSelectedCharacter) {
      ctx.lastSelectedCharacter = selected;
      ctx.speechSystem.dismissAll();
      if (ctx.needsFullRegen) {
        ctx.needsFullRegen = false;
        ctx.postProcess.fadeTransition(
          () => {
            // Reset to overworld on new game with a fresh seed
            const store = useGameStore.getState();
            const newSeed = (Math.random() * 0xffffffff) >>> 0;
            store.setTerrainPreset('overworld');
            store.setProgressionRecipe('Classic');
            store.setFloor(1);
            store.clearLevelCache();
            store.setOverworldState(null);
            ctx.lastOverworldTile = null;
            sceneManager.regenerateScene({
              character: selected,
              presetOverride: 'overworld',
              seed: newSeed,
            });
          },
          9999,
          3.0,
        );
      } else {
        ctx.terrain.getGroup().visible = true;
        characters.spawnCharacters(selected);
        // Show world announcement on first start
        if (!ctx.gameStarted) {
          ctx.gameStarted = true;
          // Show current tile announcement (tile detection will fire on next frame)
          ctx.lastOverworldTile = null;
        }
      }
    }

    if ((phase === 'playing' || phase === 'player_dead') && ctx.activeCharacter) {
      const playerChar = ctx.activeCharacter;

      // ── Overworld zoom in/out ──
      const isOverworld = ctx.terrain.preset === 'overworld';
      const owState = useGameStore.getState().overworldState;

      // Track which overworld tile the player is standing on → show announcement on change
      if (isOverworld && playerChar.isAlive && owState) {
        const pos = playerChar.getPosition();
        // Update player pos for proximity-based label toggling
        const owMap = ctx.terrain.getOverworldMap();
        if (owMap) owMap.playerPos = { x: pos.x, z: pos.z };
        const standingTile = getTileAtWorldPos(pos.x, pos.z);
        if (standingTile !== null && standingTile !== ctx.lastOverworldTile) {
          ctx.lastOverworldTile = standingTile;
          const tileDef = owState.tiles[standingTile];
          const regionName = tileDef.label || 'Unknown Lands';
          const styleName = tileDef.heightmapStyle.charAt(0).toUpperCase() + tileDef.heightmapStyle.slice(1);
          const palName = tileDef.paletteName.charAt(0).toUpperCase() + tileDef.paletteName.slice(1);
          useGameStore.getState().setZoneName(regionName);
          useGameStore.getState().setZoneSubtitle(`${palName} ${styleName}`);
          // Start sky crossfade to this tile's palette
          const targetSky = getSkyColors(tileDef.paletteName);
          ctx.skyCrossfade = {
            from: { ...ctx.baseSkyColors },
            to: targetSky,
            progress: 0,
            duration: 0.5,
            active: true,
          };
        }
        // Tick sky crossfade
        if (ctx.skyCrossfade?.active) {
          ctx.skyCrossfade.progress += dt / ctx.skyCrossfade.duration;
          if (ctx.skyCrossfade.progress >= 1) {
            ctx.skyCrossfade.progress = 1;
            ctx.skyCrossfade.active = false;
          }
          // Smoothstep for nicer easing
          const t = ctx.skyCrossfade.progress;
          const smooth = t * t * (3 - 2 * t);
          ctx.baseSkyColors = lerpSkyColors(ctx.skyCrossfade.from, ctx.skyCrossfade.to, smooth);
        }
      }

      // Clamp character to overworld map bounds
      if (isOverworld && playerChar.isAlive) {
        const half = OW_TOTAL_SIZE / 2;
        const margin = 0.3;
        const p = playerChar.getPosition();
        const cx = Math.max(-half + margin, Math.min(half - margin, p.x));
        const cz = Math.max(-half + margin, Math.min(half - margin, p.z));
        if (cx !== p.x || cz !== p.z) {
          playerChar.mesh.position.x = cx;
          playerChar.mesh.position.z = cz;
        }
      }

      // E or M on overworld → zoom into tile
      if (isOverworld && (ctx.cachedInputState.interact || ctx.cachedInputState.mapKey) && playerChar.isAlive) {
        const pos = playerChar.getPosition();
        const tileIdx = getTileAtWorldPos(pos.x, pos.z);
        if (tileIdx !== null && owState) {
          const tileDef = owState.tiles[tileIdx];
          // Compute normalized position within tile (-0.5..0.5)
          const { cx, cz } = tileCenterWorld(tileDef.row, tileDef.col);
          const nx = (pos.x - cx) / OW_TILE_SIZE;
          const nz = (pos.z - cz) / OW_TILE_SIZE;
          // Save active tile and normalized spawn (don't save overworld pos as savedPlayerPos
          // — it would be misinterpreted as heightmap coords by the scene manager)
          const curOw = useGameStore.getState().overworldState!;
          useGameStore.getState().setOverworldState({
            ...curOw,
            savedPlayerPos: null,
            activeTileIndex: tileIdx,
            zoomSpawnNorm: { nx, nz },
            zoomSpawnFacing: playerChar.getFacing(),
          });
          const regionName = tileDef.label || 'Unknown Lands';
          const styleName = tileDef.heightmapStyle.charAt(0).toUpperCase() + tileDef.heightmapStyle.slice(1);
          const palName = tileDef.paletteName.charAt(0).toUpperCase() + tileDef.paletteName.slice(1);
          useGameStore.getState().beginZoneTransition({ title: regionName, subtitle: `${palName} ${styleName}` });
          // Fade → load full heightmap with tile's seed/palette
          ctx.postProcess.fadeTransition(() => {
            const store = useGameStore.getState();
            store.setCameraParam('distance', DEFAULT_CAMERA_PARAMS.distance);
            store.setCameraParam('pitchMin', DEFAULT_CAMERA_PARAMS.pitchMin);
            store.setCameraParam('pitchMax', DEFAULT_CAMERA_PARAMS.pitchMax);
            store.setCameraParam('minDistance', DEFAULT_CAMERA_PARAMS.minDistance);
            store.setCameraParam('maxDistance', DEFAULT_CAMERA_PARAMS.maxDistance);
            store.setPaletteName(tileDef.paletteName);
            store.setHeightmapStyle(tileDef.heightmapStyle);
            store.setZoneName(regionName);
            sceneManager.regenerateScene({
              presetOverride: 'heightmap',
              seed: tileDef.seed,
            });
          }, 4.0);
          return;
        }
      }

      // M on heightmap → return to overworld (not from inside a dungeon)
      if (
        ctx.terrain.preset === 'heightmap' &&
        ctx.cachedInputState.mapKey &&
        playerChar.isAlive &&
        owState != null &&
        owState.activeTileIndex !== null
      ) {
        // Save tile center as overworld position (heightmap coords don't map to overworld)
        const tileIdx = owState.activeTileIndex!;
        const tileRow = Math.floor(tileIdx / 3);
        const tileCol = tileIdx % 3;
        const { cx, cz } = tileCenterWorld(tileRow, tileCol);
        const curOw = useGameStore.getState().overworldState!;
        useGameStore.getState().setOverworldState({
          ...curOw,
          savedPlayerPos: { x: cx, y: 0, z: cz },
        });
        useGameStore.getState().beginZoneTransition(null);
        ctx.postProcess.fadeTransition(() => {
          const store = useGameStore.getState();
          // Reset camera to a nice overworld distance
          store.setCameraParam('distance', 18);
          store.setCameraParam('minDistance', 10);
          store.setCameraParam('maxDistance', 30);
          store.setCameraParam('pitchMin', DEFAULT_CAMERA_PARAMS.pitchMin);
          store.setCameraParam('pitchMax', DEFAULT_CAMERA_PARAMS.pitchMax);
          store.setTerrainPreset('overworld');
          store.setOverworldActiveTile(null);
          // No announcement for overworld — tile detection will set labels on next frame
          // Reset tile tracking so tile announcement fires on next frame
          ctx.lastOverworldTile = null;
          sceneManager.regenerateScene({
            presetOverride: 'overworld',
            seed: owState.baseSeed,
          });
        }, 4.0);
        return;
      }

      // ── Heightmap dungeon entrance proximity + ENTER prompt ──
      if (
        ctx.terrain.preset === 'heightmap' &&
        owState != null &&
        owState.activeTileIndex !== null &&
        phase === 'playing' &&
        playerChar.isAlive &&
        !ctx.exitTriggered
      ) {
        const activeTile = owState.activeTileIndex;
        const tileDef = owState.tiles[activeTile];
        const groundSize = ctx.terrain.getGroundSize();
        const pPos = playerChar.getPosition();
        const enterRadius = 1.2;

        // Find nearest un-cleared dungeon POI in range
        let nearestPoi: POIDef | null = null;
        let nearestDist = Infinity;
        let nearestWx = 0, nearestWz = 0;
        for (const poi of tileDef.pois) {
          if (poi.type !== 'dungeon') continue;
          if (owState.clearedDungeons.includes(poi.poiSeed)) continue;
          const wx = poi.nx * groundSize;
          const wz = poi.nz * groundSize;
          const dx = pPos.x - wx;
          const dz = pPos.z - wz;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist < enterRadius && dist < nearestDist) {
            nearestPoi = poi;
            nearestDist = dist;
            nearestWx = wx;
            nearestWz = wz;
          }
        }

        if (nearestPoi) {
          // Show/update ENTER prompt
          if (!ctx.dungeonEnterPrompt) {
            ctx.dungeonEnterPrompt = createTextLabel('[ Enter ]', {
              color: '#ffdd66',
              fontSize: 28,
              height: 0.22,
              depthTest: false,
              renderOrder: 950,
            });
            ctx.scene.add(ctx.dungeonEnterPrompt);
          }
          // Position just below the dungeon name label (which is at floorY + 1.25)
          // Offset toward camera same as name label (dungeonOffset = 0.5)
          const promptY = ctx.terrain.getFloorY(nearestWx, nearestWz) + 0.95;
          const camPos = ctx.cam.camera.position;
          const dx = camPos.x - nearestWx;
          const dz = camPos.z - nearestWz;
          const len = Math.sqrt(dx * dx + dz * dz);
          const off = len > 0.01 ? 0.5 / len : 0;
          ctx.dungeonEnterPrompt.position.set(nearestWx + dx * off, promptY, nearestWz + dz * off);
          // Pulse opacity
          const pulse = 0.6 + 0.4 * Math.sin(performance.now() * 0.005);
          (ctx.dungeonEnterPrompt.material as THREE.SpriteMaterial).opacity = pulse;
          ctx.dungeonEnterPrompt.visible = true;
          ctx.dungeonEnterPromptTarget = { x: nearestWx, y: promptY, z: nearestWz };

          // E key → enter dungeon
          if (ctx.cachedInputState.interact) {
            ctx.exitTriggered = true;
            // Hide prompt
            ctx.dungeonEnterPrompt.visible = false;
            // Store pending dungeon info
            const curOw = useGameStore.getState().overworldState!;
            const skulls = nearestPoi.skulls ?? 1;
            const floorCount = nearestPoi.floorCount ?? 1;
            useGameStore.getState().setOverworldState({
              ...curOw,
              pendingPoiDungeon: {
                poiSeed: nearestPoi.poiSeed,
                name: nearestPoi.name,
                skulls,
                floorCount,
                returnNorm: { nx: nearestPoi.nx, nz: nearestPoi.nz },
                tileIndex: activeTile,
              },
            });
            // Build & register story recipe, then enter dungeon
            const recipeName = buildStoryRecipe(nearestPoi.poiSeed, floorCount, nearestPoi.name, skulls);
            const store = useGameStore.getState();
            store.setTerrainPreset('voxelDungeon');
            store.setProgressionRecipe(recipeName);
            store.setFloor(1);
            // Pre-apply floor config so store has correct dungeon layout
            sceneManager.applyFloorConfig(1, false, 'voxelDungeon');
            const skullPrefix = '\u2620'.repeat(skulls) + ' ';
            const dungeonTitle = skullPrefix + nearestPoi.name;
            const dungeonSubtitle = generateDungeonFloorSubtitle(nearestPoi.poiSeed, 1, floorCount);
            store.beginZoneTransition({ title: dungeonTitle, subtitle: dungeonSubtitle });
            ctx.postProcess.fadeTransition(() => {
              ctx.exitTriggered = false;
              useGameStore.getState().setZoneName(dungeonTitle);
              sceneManager.regenerateScene({
                presetOverride: 'voxelDungeon',
                seed: nearestPoi!.poiSeed,
              });
            }, 4.0);
          }
        } else {
          // Out of range — hide prompt
          if (ctx.dungeonEnterPrompt) {
            ctx.dungeonEnterPrompt.visible = false;
            ctx.dungeonEnterPromptTarget = null;
          }
        }
      } else if (ctx.dungeonEnterPrompt) {
        ctx.dungeonEnterPrompt.visible = false;
        ctx.dungeonEnterPromptTarget = null;
      }

      // ── Heightmap edge travel → neighbor tile ──
      // DEBUG: log once per second
      // DEBUG edge travel
      if (ctx.terrain.preset === 'heightmap' && Math.random() < 0.02) {
      }
      if (
        ctx.terrain.preset === 'heightmap' &&
        owState != null &&
        owState.activeTileIndex !== null &&
        phase === 'playing' &&
        playerChar.isAlive &&
        !ctx.exitTriggered
      ) {
        const tileIdx = owState.activeTileIndex;
        const tileDef = owState.tiles[tileIdx];
        const tileRow = Math.floor(tileIdx / OW_GRID);
        const tileCol = tileIdx % OW_GRID;
        // Use heightmap ground size (same as physics clamp)
        const hmGroundSize = ctx.terrain.getGroundSize();
        const playerRadius = 0.3;
        const halfBound = hmGroundSize / 2 - playerRadius;
        const threshold = 0.5;
        const pPos = playerChar.getPosition();

        // Determine which edge the player is near (if any)
        type Edge = 'north' | 'south' | 'east' | 'west';
        let edge: Edge | null = null;
        let neighborRow = tileRow;
        let neighborCol = tileCol;

        if (pPos.z < -halfBound + threshold)      { edge = 'north'; neighborRow = tileRow - 1; }
        else if (pPos.z > halfBound - threshold)   { edge = 'south'; neighborRow = tileRow + 1; }
        else if (pPos.x > halfBound - threshold)   { edge = 'east';  neighborCol = tileCol + 1; }
        else if (pPos.x < -halfBound + threshold)  { edge = 'west';  neighborCol = tileCol - 1; }

        // Check if neighbor exists (within 3×3 grid)
        const hasNeighbor = edge !== null &&
          neighborRow >= 0 && neighborRow < OW_GRID &&
          neighborCol >= 0 && neighborCol < OW_GRID;

        if (hasNeighbor && edge) {
          const neighborIdx = neighborRow * OW_GRID + neighborCol;
          const neighborTile = owState.tiles[neighborIdx];
          const neighborName = neighborTile.label || 'Unknown Lands';
          const arrows: Record<Edge, string> = { east: '→', west: '←', north: '↑', south: '↓' };
          const promptText = `${arrows[edge]} ${neighborName}`;

          // Create or update direction label (only re-render text when it changes)
          if (!ctx.edgeTravelPrompt) {
            ctx.edgeTravelPrompt = createTextLabel(promptText, {
              color: '#ffdd66',
              fontSize: 28,
              height: 0.22,
              depthTest: false,
              renderOrder: 950,
            });
            (ctx.edgeTravelPrompt as any).__lastText = promptText;
            ctx.scene.add(ctx.edgeTravelPrompt);
          } else if ((ctx.edgeTravelPrompt as any).__lastText !== promptText) {
            updateTextLabel(ctx.edgeTravelPrompt, promptText);
            (ctx.edgeTravelPrompt as any).__lastText = promptText;
          }

          // Create [ Enter ] label once
          if (!ctx.edgeTravelEnterPrompt) {
            ctx.edgeTravelEnterPrompt = createTextLabel('[ Enter ]', {
              color: '#ffdd66',
              fontSize: 24,
              height: 0.18,
              depthTest: false,
              renderOrder: 950,
            });
            ctx.scene.add(ctx.edgeTravelEnterPrompt);
          }

          // Position above player head
          const promptY = pPos.y + 1.8;
          ctx.edgeTravelPrompt.position.set(pPos.x, promptY, pPos.z);
          ctx.edgeTravelEnterPrompt.position.set(pPos.x, promptY - 0.25, pPos.z);
          const pulse = 0.6 + 0.4 * Math.sin(performance.now() * 0.005);
          (ctx.edgeTravelPrompt.material as THREE.SpriteMaterial).opacity = pulse;
          (ctx.edgeTravelEnterPrompt.material as THREE.SpriteMaterial).opacity = pulse;
          ctx.edgeTravelPrompt.visible = true;
          ctx.edgeTravelEnterPrompt.visible = true;

          // E key → travel to neighbor
          if (ctx.cachedInputState.interact) {
            ctx.exitTriggered = true;
            ctx.edgeTravelPrompt.visible = false;
            if (ctx.edgeTravelEnterPrompt) ctx.edgeTravelEnterPrompt.visible = false;

            // Compute spawn position on opposite edge
            const spawnMargin = 0.5;
            const dungeonSize = useGameStore.getState().dungeonSize;
            let spawnX = pPos.x;
            let spawnZ = pPos.z;

            switch (edge) {
              case 'east':  spawnX = -halfBound + spawnMargin; break;
              case 'west':  spawnX =  halfBound - spawnMargin; break;
              case 'south': spawnZ = -halfBound + spawnMargin; break;
              case 'north': spawnZ =  halfBound - spawnMargin; break;
            }

            // Normalize to -0.5..0.5 for zoomSpawnNorm
            const nx = spawnX / dungeonSize;
            const nz = spawnZ / dungeonSize;

            // Facing toward center (away from edge)
            const facingAngles: Record<Edge, number> = {
              east: Math.PI / 2,    // face west (toward center)
              west: -Math.PI / 2,   // face east
              south: Math.PI,       // face north
              north: 0,             // face south
            };

            // Update overworld state for neighbor tile
            const curOw = useGameStore.getState().overworldState!;
            useGameStore.getState().setOverworldState({
              ...curOw,
              activeTileIndex: neighborIdx,
              zoomSpawnNorm: { nx, nz },
              zoomSpawnFacing: facingAngles[edge],
              savedPlayerPos: null,
            });

            const regionName = neighborName;
            const styleName = neighborTile.heightmapStyle.charAt(0).toUpperCase() + neighborTile.heightmapStyle.slice(1);
            const palName = neighborTile.paletteName.charAt(0).toUpperCase() + neighborTile.paletteName.slice(1);
            useGameStore.getState().beginZoneTransition({ title: regionName, subtitle: `${palName} ${styleName}` });

            ctx.postProcess.fadeTransition(() => {
              const store = useGameStore.getState();
              store.setPaletteName(neighborTile.paletteName);
              store.setHeightmapStyle(neighborTile.heightmapStyle);
              ctx.lastOverworldTile = null;
              sceneManager.regenerateScene({
                presetOverride: 'heightmap',
                seed: neighborTile.seed,
              });
            }, 4.0);
            return;
          }
        } else {
          // Not near an edge with a neighbor — hide prompts
          if (ctx.edgeTravelPrompt) ctx.edgeTravelPrompt.visible = false;
          if (ctx.edgeTravelEnterPrompt) ctx.edgeTravelEnterPrompt.visible = false;
        }
      } else {
        if (ctx.edgeTravelPrompt) ctx.edgeTravelPrompt.visible = false;
        if (ctx.edgeTravelEnterPrompt) ctx.edgeTravelEnterPrompt.visible = false;
      }

      // Seppuku
      if (ctx.cachedInputState.seppuku && phase === 'playing' && playerChar.isAlive) {
        playerChar.hp = 0;
        playerChar.isAlive = false;
        useGameStore.getState().setHP(0, useGameStore.getState().maxHp);
        triggerPlayerDeath(playerChar);
        return;
      }

      characters.syncAllCharacterParams();

      // Apply potion speed multiplier
      const baseSpeed = playerChar.params.speed;
      if (ctx.potionSystem.speedMultiplier !== 1) {
        playerChar.params.speed = baseSpeed * ctx.potionSystem.speedMultiplier;
      }

      // Update potion effects
      if (phase === 'playing') {
        const potionEvents = ctx.potionSystem.update(dt);
        for (const ev of potionEvents) {
          if (ev.effect === 'poison' && ev.type === 'tick') {
            const s = useGameStore.getState();
            if (s.phase === 'player_dead') continue;
            if (s.hp <= 1) {
              ctx.potionSystem.clearEffect('poison');
              ctx.potionVFX.onExpire('poison');
              continue;
            }
            const newHp = Math.max(1, s.hp - 1);
            s.setHP(newHp, s.maxHp);
            playerChar.hp = newHp;
            ctx.potionVFX.spawnPoisonTick(playerChar);
          }
          if (ev.type === 'expired') {
            ctx.potionVFX.onExpire(ev.effect);
          }
        }
      }

      if (ctx.projectileSystem)
        ctx.projectileSystem.setCritBonus(ctx.potionSystem.critBonus);

      ctx.potionVFX.update(dt, playerChar, ctx.potionSystem.isShadow, ctx.cam.camera);

      ctx.potionHudTimer -= dt;
      if (ctx.potionHudTimer <= 0) {
        ctx.potionHudTimer = 0.25;
        useGameStore.getState().setActivePotionEffects(ctx.potionSystem.getActiveEffects());
      }

      // Player action on Space or E
      const isAttack = ctx.cachedInputState.attack;
      const isInteract = ctx.cachedInputState.interact;
      if (phase === 'playing' && (isAttack || isInteract)) {
        const potionInteractRadius = playerChar.params.attackReach * 1.5;
        const pPos = playerChar.getPosition();
        const pFaceDirX = -Math.sin(playerChar.facing);
        const pFaceDirZ = -Math.cos(playerChar.facing);

        const lootMagnetActivated = ctx.lootSystem.activatePotionMagnet(
          pPos.x, pPos.z, potionInteractRadius,
        );

        let propMagnetActivated = false;
        const propSys = ctx.terrain.getPropSystem();
        if (propSys) {
          const collectibles = propSys.getCollectibleProps();
          for (const prop of collectibles) {
            const ci = prop.colorIndex ?? 0;
            if (ctx.potionSystem.isIdentifiedBad(ci)) continue;
            const pdx = pPos.x - prop.mesh.position.x;
            const pdz = pPos.z - prop.mesh.position.z;
            if (pdx * pdx + pdz * pdz < potionInteractRadius * potionInteractRadius) {
              prop.mesh.userData.magnetActivated = true;
              propMagnetActivated = true;
            }
          }
        }

        let kickedAPotion = false;
        if (!lootMagnetActivated && !propMagnetActivated) {
          const badLoot = ctx.lootSystem.getNearestPotion(
            pPos.x, pPos.z, potionInteractRadius, true,
          );
          if (badLoot) {
            let kdx = badLoot.mesh.position.x - pPos.x;
            let kdz = badLoot.mesh.position.z - pPos.z;
            let kickDirX = kdx / (Math.sqrt(kdx * kdx + kdz * kdz) || 1);
            let kickDirZ = kdz / (Math.sqrt(kdx * kdx + kdz * kdz) || 1);
            const autoTarget = getKickAutoTarget(pPos.x, pPos.z, kickDirX, kickDirZ);
            if (autoTarget) {
              const tdx = autoTarget.x - badLoot.mesh.position.x;
              const tdz = autoTarget.z - badLoot.mesh.position.z;
              const tLen = Math.sqrt(tdx * tdx + tdz * tdz) || 1;
              kickDirX = tdx / tLen;
              kickDirZ = tdz / tLen;
            }
            const proj = ctx.lootSystem.kickPotion(badLoot, kickDirX, kickDirZ);
            if (proj) {
              ctx.kickedPotions.push({
                ...proj, age: 0, bounces: 0, rolling: false, stopped: false,
              });
              audioSystem.sfx('thud');
              kickedAPotion = true;
              if (isAttack) playerChar.startAttack();
            }
          }
          if (!kickedAPotion && propSys) {
            const collectibles = propSys.getCollectibleProps();
            for (const prop of collectibles) {
              const ci = prop.colorIndex ?? 0;
              if (!ctx.potionSystem.isIdentifiedBad(ci)) continue;
              const pdx = prop.mesh.position.x - pPos.x;
              const pdz = prop.mesh.position.z - pPos.z;
              const pDist = Math.sqrt(pdx * pdx + pdz * pdz);
              if (pDist > potionInteractRadius) continue;
              let kickDirX = pdx / (pDist || 1);
              let kickDirZ = pdz / (pDist || 1);
              const propAutoTarget = getKickAutoTarget(pPos.x, pPos.z, kickDirX, kickDirZ);
              if (propAutoTarget) {
                const tdx = propAutoTarget.x - prop.mesh.position.x;
                const tdz = propAutoTarget.z - prop.mesh.position.z;
                const tLen = Math.sqrt(tdx * tdx + tdz * tdz) || 1;
                kickDirX = tdx / tLen;
                kickDirZ = tdz / tLen;
              }
              const srcMesh = prop.mesh as THREE.Mesh;
              const mesh = new THREE.Mesh(srcMesh.geometry, srcMesh.material);
              mesh.scale.copy(srcMesh.scale);
              mesh.quaternion.copy(srcMesh.quaternion);
              mesh.position.copy(srcMesh.position);
              ctx.scene.add(mesh);
              propSys.removeProp(prop);
              ctx.kickedPotions.push({
                mesh, colorIndex: ci,
                vx: kickDirX * 5, vy: 3, vz: kickDirZ * 5,
                age: 0, bounces: 0, rolling: false, stopped: false,
              });
              audioSystem.sfx('thud');
              kickedAPotion = true;
              if (isAttack) playerChar.startAttack();
              break;
            }
          }
          // Re-kick stopped potions on the ground
          if (!kickedAPotion) {
            for (const kp of ctx.kickedPotions) {
              if (!kp.stopped) continue;
              const kdx = kp.mesh.position.x - pPos.x;
              const kdz = kp.mesh.position.z - pPos.z;
              if (kdx * kdx + kdz * kdz > potionInteractRadius * potionInteractRadius) continue;
              let kickDirX = kdx / (Math.sqrt(kdx * kdx + kdz * kdz) || 1);
              let kickDirZ = kdz / (Math.sqrt(kdx * kdx + kdz * kdz) || 1);
              const reTarget = getKickAutoTarget(pPos.x, pPos.z, kickDirX, kickDirZ);
              if (reTarget) {
                const tdx = reTarget.x - kp.mesh.position.x;
                const tdz = reTarget.z - kp.mesh.position.z;
                const tLen = Math.sqrt(tdx * tdx + tdz * tdz) || 1;
                kickDirX = tdx / tLen;
                kickDirZ = tdz / tLen;
              }
              kp.vx = kickDirX * 5;
              kp.vy = 3;
              kp.vz = kickDirZ * 5;
              kp.age = 0;
              kp.bounces = 0;
              kp.rolling = false;
              kp.stopped = false;
              audioSystem.sfx('thud');
              kickedAPotion = true;
              if (isAttack) playerChar.startAttack();
              break;
            }
          }
        }

        if (isAttack && !lootMagnetActivated && !propMagnetActivated && !kickedAPotion) {
          const heroId = playerChar.voxEntry?.id ?? '';
          const projConfig = getProjectileConfig(heroId);
          if (projConfig && ctx.projectileSystem) {
            const pos = playerChar.getPosition();
            const facing = playerChar.facing;
            const muzzle = getMuzzleOffset(heroId);
            const faceDirX = -Math.sin(facing);
            const faceDirZ = -Math.cos(facing);
            const rangedP = useGameStore.getState().characterParams.ranged;
            if (playerChar.startAttack()) {
              const spawnX = pos.x + faceDirX * muzzle.forward;
              const spawnY = playerChar.groundY + muzzle.up;
              const spawnZ = pos.z + faceDirZ * muzzle.forward;
              ctx.projectileSystem.fireProjectile(
                heroId, projConfig, spawnX, spawnY, spawnZ, facing,
                ctx.enemySystem ? ctx.enemySystem.getVisibleEnemies() : [],
                [
                  ctx.terrain.getBoxGroup(),
                  ...(ctx.terrain.getTerrainMesh() ? [ctx.terrain.getTerrainMesh()!] : []),
                ],
                ctx.terrain.getOpenDoorObjects(),
                muzzle.up,
                rangedP.autoTarget,
                rangedP.knockback,
              );
            }
          } else if (!ctx.enemySystem?.isCritChainActive) {
            const meleeP = useGameStore.getState().characterParams;
            if (ctx.enemySystem && meleeP.melee.autoTarget) {
              const pos = playerChar.getPosition();
              const propTargets = ctx.propDestructionSystem
                ? ctx.propDestructionSystem.getPropColliders()
                : undefined;
              const aimTarget = findMeleeAimTarget(
                pos.x, pos.z, playerChar.facing,
                ctx.enemySystem.getVisibleEnemies(),
                propTargets,
              );
              if (aimTarget !== null) {
                playerChar.facing = aimTarget;
                playerChar.mesh.rotation.y =
                  meleeP.movementMode === 'grid'
                    ? Math.round(aimTarget / (Math.PI / 4)) * (Math.PI / 4)
                    : aimTarget;
              }
            }
            const attackStarted = playerChar.startAttack();

            // Cap lunge to not overshoot the nearest target in facing direction
            if (attackStarted) {
              const pos = playerChar.getPosition();
              const facing = playerChar.facing;
              const fwdX = -Math.sin(facing);
              const fwdZ = -Math.cos(facing);
              const stopDist = 0.3;
              const maxLungeCheck = playerChar.params.attackReach + playerChar.params.lungeDistance;
              let nearestTargetX: number | undefined;
              let nearestTargetZ: number | undefined;
              let nearestDot = Infinity;

              // Check enemies
              for (const enemy of (ctx.enemySystem?.getVisibleEnemies() ?? [])) {
                if (!enemy.isAlive) continue;
                const dx = enemy.mesh.position.x - pos.x;
                const dz = enemy.mesh.position.z - pos.z;
                const dot = dx * fwdX + dz * fwdZ;
                if (dot > 0 && dot < maxLungeCheck && dot < nearestDot) {
                  // Check lateral distance (within attack arc)
                  const lateral = Math.abs(dx * fwdZ - dz * fwdX);
                  if (lateral < 0.5) {
                    nearestDot = dot;
                    nearestTargetX = enemy.mesh.position.x;
                    nearestTargetZ = enemy.mesh.position.z;
                  }
                }
              }

              // Check destroyable props
              if (ctx.propDestructionSystem) {
                for (const col of ctx.propDestructionSystem.getPropColliders()) {
                  const dx = col.x - pos.x;
                  const dz = col.z - pos.z;
                  const dot = dx * fwdX + dz * fwdZ;
                  if (dot > 0 && dot < maxLungeCheck && dot < nearestDot) {
                    const lateral = Math.abs(dx * fwdZ - dz * fwdX);
                    if (lateral < 0.5) {
                      nearestDot = dot;
                      nearestTargetX = col.x;
                      nearestTargetZ = col.z;
                    }
                  }
                }
              }

              if (nearestTargetX !== undefined && nearestTargetZ !== undefined) {
                playerChar.capLungeToTarget(nearestTargetX, nearestTargetZ, stopDist);
              }
            }
          }
        }
      }

      // Crit chain
      const showSlashFx =
        useGameStore.getState().characterParams.melee.showSlashEffect;
      if (
        ctx.enemySystem?.updateCritChain(
          dt, playerChar,
          () => {
            const s = useGameStore.getState();
            s.setScore(s.score + 10);
          },
          showSlashFx,
        )
      ) {
        for (const char of ctx.characters) {
          if (char !== playerChar) char.update(dt);
        }
      } else {
        for (const char of ctx.characters) {
          char.update(dt);
        }
      }
      playerChar.params.speed = baseSpeed;

      // Sync HP + hunger
      if (ctx.activeCharacter) {
        const s = useGameStore.getState();
        const charHp = Math.round(ctx.activeCharacter.hp);
        if (charHp !== s.hp || ctx.activeCharacter.maxHp !== s.maxHp) {
          s.setHP(charHp, ctx.activeCharacter.maxHp);
        }
        if (ctx.activeCharacter.hungerEnabled) {
          const charHunger = Math.round(ctx.activeCharacter.hunger * 10) / 10;
          if (charHunger !== s.hunger || ctx.activeCharacter.maxHunger !== s.maxHunger) {
            s.setHunger(charHunger, ctx.activeCharacter.maxHunger);
          }
        }
      }

      // Doors
      const doorSystem = ctx.terrain.getDoorSystem();
      if (doorSystem) {
        const charPositions = ctx.characters.map((c) => c.getPosition());
        if (ctx.enemySystem) {
          charPositions.push(...ctx.enemySystem.getEnemyPositions());
        }
        const stepHeight = useGameStore.getState().characterParams.stepHeight;
        doorSystem.update(dt, charPositions, stepHeight);
      }

      // Room visibility
      const roomVis = ctx.terrain.getRoomVisibility();
      if (roomVis && playerChar) {
        const pp = playerChar.getPosition();
        roomVis.update(pp.x, pp.z, doorSystem, playerChar.getFacing());
      }

      // Gore system
      ctx.goreSystem.update(gameDt);

      // Lazy-init prop destruction system
      if (!ctx.propDestructionSystem) {
        const propSystem = ctx.terrain.getPropSystem();
        if (propSystem) {
          propSystem.setPotionSystem(ctx.potionSystem);
          ctx.propDestructionSystem = new PropDestructionSystem(
            propSystem, ctx.lootSystem, ctx.goreSystem,
          );
          ctx.propDestructionSystem.setFloorY((x, z) => ctx.terrain.getFloorY(x, z));
          ctx.propDestructionSystem.setUnblockCallback((wx, wz) =>
            ctx.terrain.unblockPropAt(wx, wz),
          );
          ctx.propDestructionSystem.setIsOpenCell((wx, wz) =>
            ctx.terrain.isOpenCell(wx, wz),
          );
          if (ctx.enemySystem)
            ctx.enemySystem.setPropDestructionSystem(ctx.propDestructionSystem);
        }
      }

      if (ctx.propDestructionSystem) ctx.propDestructionSystem.update(gameDt);

      // Enemy system
      if (ctx.enemySystem) {
        const enemiesOn = useGameStore.getState().enemiesEnabled;
        // Hide/show all enemies when toggled
        for (const enemy of ctx.enemySystem.getEnemies()) {
          if (!enemiesOn && enemy.mesh.visible) enemy.mesh.visible = false;
        }
        if (!enemiesOn) {
          // Skip update & spawning, but still tick VFX (pickup labels, damage numbers)
          ctx.enemySystem.vfx.update(gameDt);
        } else {
        const showSlashEffect =
          useGameStore.getState().characterParams.melee.showSlashEffect;
        ctx.enemySystem.update(
          gameDt, playerChar,
          (damage) => {
            const s = useGameStore.getState();
            if (s.phase === 'player_dead') return;
            if (ctx.potionSystem.absorbHit()) {
              audioSystem.sfx('thud');
              ctx.potionVFX.onArmorAbsorb(ctx.potionSystem.armorHitsRemaining);
              return;
            }
            const finalDamage = Math.round(damage * ctx.potionSystem.damageTakenMultiplier);
            if (ctx.potionSystem.isShadow) ctx.potionSystem.breakShadow();
            const newHp = Math.max(0, s.hp - finalDamage);
            s.setHP(newHp, s.maxHp);
            playerChar.hp = newHp;
            if (newHp <= 0) {
              playerChar.isAlive = false;
              triggerPlayerDeath(playerChar);
            }
          },
          () => {
            const s = useGameStore.getState();
            s.setScore(s.score + 10);
          },
          showSlashEffect,
          ctx.cam.camera,
        );
        } // end enemiesOn else
      }

      // Kicked potions
      for (let ki = ctx.kickedPotions.length - 1; ki >= 0; ki--) {
        const kp = ctx.kickedPotions[ki];
        if (kp.stopped) continue;
        kp.age += gameDt;

        if (!kp.rolling) {
          kp.vy -= 15 * gameDt;
          const oldX = kp.mesh.position.x;
          const oldZ = kp.mesh.position.z;
          kp.mesh.position.x += kp.vx * gameDt;
          kp.mesh.position.y += kp.vy * gameDt;
          kp.mesh.position.z += kp.vz * gameDt;
          kp.mesh.rotation.x += gameDt * 10;
          kp.mesh.rotation.z += gameDt * 8;

          if (!ctx.terrain.isOpenCell(kp.mesh.position.x, kp.mesh.position.z)) {
            if (kp.bounces < 1) {
              kp.bounces++;
              const openX = ctx.terrain.isOpenCell(kp.mesh.position.x, oldZ);
              const openZ = ctx.terrain.isOpenCell(oldX, kp.mesh.position.z);
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
              audioSystem.sfxAt('thud', kp.mesh.position.x, kp.mesh.position.z, 0.5);
            } else {
              kp.mesh.position.x = oldX;
              kp.mesh.position.z = oldZ;
              kp.vx = 0; kp.vy = 0; kp.vz = 0; kp.stopped = true; kp.age = 0;
              continue;
            }
          }

          const floorY = ctx.terrain.getFloorY(kp.mesh.position.x, kp.mesh.position.z);
          if (kp.mesh.position.y < floorY + 0.04) {
            kp.mesh.position.y = floorY + 0.04;
            kp.vy = 0;
            kp.rolling = true;
          }
        } else {
          const drag = Math.exp(-4 * gameDt);
          kp.vx *= drag;
          kp.vz *= drag;
          const oldX = kp.mesh.position.x;
          const oldZ = kp.mesh.position.z;
          kp.mesh.position.x += kp.vx * gameDt;
          kp.mesh.position.z += kp.vz * gameDt;
          kp.mesh.rotation.x += kp.vx * gameDt * 20;
          kp.mesh.rotation.z += kp.vz * gameDt * 20;

          const floorY = ctx.terrain.getFloorY(kp.mesh.position.x, kp.mesh.position.z);
          kp.mesh.position.y = floorY + 0.04;

          if (!ctx.terrain.isOpenCell(kp.mesh.position.x, kp.mesh.position.z)) {
            if (kp.bounces < 1) {
              kp.bounces++;
              const openX = ctx.terrain.isOpenCell(kp.mesh.position.x, oldZ);
              const openZ = ctx.terrain.isOpenCell(oldX, kp.mesh.position.z);
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
              audioSystem.sfxAt('thud', kp.mesh.position.x, kp.mesh.position.z, 0.3);
            } else {
              kp.mesh.position.x = oldX;
              kp.mesh.position.z = oldZ;
              kp.vx = 0; kp.vz = 0; kp.stopped = true; kp.age = 0;
              continue;
            }
          }

          const speed = Math.sqrt(kp.vx * kp.vx + kp.vz * kp.vz);
          if (speed < 0.3) {
            kp.vx = 0; kp.vz = 0; kp.stopped = true; kp.age = 0;
            continue;
          }
        }

        // Check enemy collision
        let hitEnemy: Enemy | null = null;
        if (ctx.enemySystem) {
          for (const enemy of ctx.enemySystem.getVisibleEnemies()) {
            if (!enemy.isAlive) continue;
            const edx = enemy.mesh.position.x - kp.mesh.position.x;
            const edz = enemy.mesh.position.z - kp.mesh.position.z;
            const edy = enemy.mesh.position.y - kp.mesh.position.y;
            if (edx * edx + edz * edz + edy * edy < 0.15) {
              hitEnemy = enemy as Enemy;
              break;
            }
          }
        }

        if (hitEnemy && ctx.enemySystem) {
          const effect = ctx.potionSystem.colorMapping[kp.colorIndex];
          const effectMeta = EFFECT_META[effect];
          hitEnemy.takeDamage(2, kp.mesh.position.x, kp.mesh.position.z, 0.5);
          ctx.enemySystem.spawnDamageNumber(
            hitEnemy.mesh.position.x, hitEnemy.mesh.position.y, hitEnemy.mesh.position.z,
            2, 0, 0,
          );
          ctx.enemySystem.spawnHitSparks(
            hitEnemy.mesh.position.x, hitEnemy.mesh.position.y, hitEnemy.mesh.position.z,
            0, 0,
          );
          if (effectMeta.duration > 0) {
            ctx.enemySystem.applyStatusEffect(hitEnemy, effect, effectMeta.duration);
            ctx.enemySystem.spawnPickupLabel(
              hitEnemy.mesh.position.x, hitEnemy.mesh.position.y, hitEnemy.mesh.position.z,
              effectMeta.label, '#ff8844', 'md',
            );
          }
          if (effect === 'frenzy') {
            ctx.enemySystem.setTauntTarget(hitEnemy);
          }
          audioSystem.sfxAt('fleshHit', hitEnemy.mesh.position.x, hitEnemy.mesh.position.z);
          explodeKickedPotion(kp);
          ctx.kickedPotions.splice(ki, 1);
          continue;
        }

        if (kp.age > 5 && !kp.stopped) {
          kp.vx = 0; kp.vz = 0; kp.stopped = true; kp.age = 0;
        }
      }

      // Safety net
      if (!playerChar.isAlive && phase === 'playing') {
        triggerPlayerDeath(playerChar);
      }

      // Room visibility for entities
      if (roomVis) {
        if (ctx.enemySystem) {
          for (const enemy of ctx.enemySystem.getEnemies()) {
            const pos = enemy.getPosition();
            const inActiveRoom = roomVis.isPositionActive(pos.x, pos.z);
            enemy.mesh.visible = inActiveRoom || enemy.isCurrentlyChasing();
          }
        }
        for (const mesh of ctx.collectibles.getMeshes()) {
          mesh.visible = roomVis.isPositionVisible(mesh.position.x, mesh.position.z);
        }
        for (const mesh of ctx.lootSystem.getMeshes()) {
          mesh.visible = roomVis.isPositionVisible(mesh.position.x, mesh.position.z);
        }
        for (const group of ctx.chestSystem.getGroups()) {
          group.visible = roomVis.isPositionVisible(group.position.x, group.position.z);
        }
      }

      // Projectiles
      if (ctx.projectileSystem && ctx.enemySystem) {
        ctx.projectileSystem.update(
          gameDt,
          ctx.enemySystem.getVisibleEnemies(),
          (info) => {
            ctx.enemySystem!.aggroEnemy(info.enemy);

            if (info.deflected) {
              ctx.enemySystem!.spawnDeflectVFX(info.x, info.y, info.z, info.dirX, info.dirZ);
              audioSystem.sfxAt('clank', info.x, info.z);
              if (ctx.enemySystem!.impactCallbacks) {
                ctx.enemySystem!.impactCallbacks.onHitstop(0.06);
                ctx.enemySystem!.impactCallbacks.onCameraShake(0.1, 0.1, info.dirX, info.dirZ);
              }
              return;
            }

            ctx.enemySystem!.spawnDamageNumber(info.x, info.y, info.z, info.damage, info.dirX, info.dirZ, info.isCrit);
            ctx.enemySystem!.spawnHitSparks(info.x, info.y, info.z, info.dirX, info.dirZ);
            ctx.enemySystem!.spawnBloodSplash(
              info.x, info.y, info.z, info.enemy.groundY,
              ctx.activeCharacter ?? undefined,
            );
            audioSystem.sfxAt('fleshHit', info.x, info.z);

            const isKill = !info.enemy.isAlive;
            if (ctx.enemySystem!.impactCallbacks) {
              ctx.enemySystem!.impactCallbacks.onHitstop(isKill ? 0.1 : 0.06);
              ctx.enemySystem!.impactCallbacks.onCameraShake(
                isKill ? 0.2 : 0.12, isKill ? 0.2 : 0.12, info.dirX, info.dirZ,
              );
            }

            if (isKill) {
              const s = useGameStore.getState();
              s.setScore(s.score + 10);
            }
          },
          {
            getGroundY: (x: number, z: number) => ctx.terrain.getTerrainYNoProps(x, z),
            terrainColliders: ctx.terrain.getProjectileColliders(),
            excludeObjects: ctx.terrain.getOpenDoorObjects(),
            onPropHit: ctx.propDestructionSystem
              ? (entity, pos) => ctx.propDestructionSystem!.handleProjectileHit(entity)
              : undefined,
            propTargets: ctx.propDestructionSystem
              ? ctx.propDestructionSystem.getPropColliders()
              : undefined,
            destroyableMeshes: ctx.propDestructionSystem
              ? ctx.propDestructionSystem.getDestroyableMeshes()
              : undefined,
          },
        );
      }

      // Audio listener
      const pp = ctx.activeCharacter.getPosition();
      audioSystem.setPlayerPosition(pp.x, pp.z);

      patchSceneArchitecture();

      // X-ray reveal
      const playerWorldPos = new THREE.Vector3(
        pp.x, ctx.activeCharacter.mesh.position.y + 0.5, pp.z,
      );
      const isDungeonPreset = ctx.terrain.preset === 'voxelDungeon';
      updateReveal(playerWorldPos, ctx.cam.camera.position, isDungeonPreset, ctx.terrain.preset);

      // Sync light preset + day cycle
      const preset = useGameStore.getState().lightPreset;
      const isExterior = ctx.terrain.preset === 'heightmap' || ctx.terrain.preset === 'overworld';
      ctx.currentLightPreset = preset;
      ctx.lastIsExterior = isExterior;

      // Lighting: dungeons use static interior lighting, exteriors use day cycle
      const store = useGameStore.getState();
      if (isDungeonPreset) {
        // Static interior lighting — no day cycle, no moon, single shadow pass
        applyDungeonLighting(ctx.sceneLights, preset);

        // Clean up sun debug helper if switching from exterior
        if (ctx.sunDebugHelper) {
          disposeSunDebugHelper(ctx.scene, ctx.sunDebugHelper);
          ctx.sunDebugHelper = null;
        }
      } else {
        // Advance day cycle if enabled (overworld uses fixed daytime)
        let timeOfDay = store.timeOfDay;
        if (isOverworld) {
          timeOfDay = 10;
          useGameStore.setState({ timeOfDay });
        } else if (store.dayCycleEnabled) {
          const isNight = timeOfDay >= 18 || timeOfDay < 6;
          const speedMul = (store.fastNights && isNight) ? 2.0 : 1.0;
          timeOfDay = (timeOfDay + dt * store.dayCycleSpeed * speedMul) % 24;
          useGameStore.setState({ timeOfDay });
        }

        // Update day cycle (handles lights, sky, fog, stars)
        updateDayCycle(
          ctx.sceneLights,
          ctx.sceneSky,
          preset,
          isExterior,
          timeOfDay,
          ctx.baseSkyColors,
          ctx.scene.fog as THREE.Fog | null,
        );

        // Sun debug helper
        const sunDebugWanted = store.sunDebug;
        if (sunDebugWanted && !ctx.sunDebugHelper) {
          ctx.sunDebugHelper = createSunDebugHelper(ctx.scene);
        } else if (!sunDebugWanted && ctx.sunDebugHelper) {
          disposeSunDebugHelper(ctx.scene, ctx.sunDebugHelper);
          ctx.sunDebugHelper = null;
        }
        if (ctx.sunDebugHelper) {
          const sunDir = computeSunDirection(store.timeOfDay);
          const camTarget = ctx.activeCharacter
            ? new THREE.Vector3(pp.x, ctx.activeCharacter.mesh.position.y + 2, pp.z)
            : ctx.cam.camera.position;
          updateSunDebug(ctx.sunDebugHelper, sunDir, camTarget);
        }
      }

      // Sync grid opacity
      const gridOp = useGameStore.getState().gridOpacity;
      if (gridOp !== ctx.currentGridOpacity) {
        ctx.currentGridOpacity = gridOp;
        ctx.terrain.setGridOpacity(gridOp);
      }

      setDebugProjectileStick(useGameStore.getState().debugProjectileStick);

      // Sync debris debug visualization
      const debugDebris = useGameStore.getState().debugDebris;
      if (debugDebris !== ctx.currentDebugDebris) {
        ctx.currentDebugDebris = debugDebris;
        ctx.terrain.showDebrisDebug(debugDebris);
      }

      // Sync room labels
      const roomLabels = useGameStore.getState().roomLabels;
      if (roomLabels !== ctx.currentRoomLabels) {
        ctx.currentRoomLabels = roomLabels;
        ctx.terrain.setRoomLabelsVisible(roomLabels);
      }

      // Camera follow
      if (isOverworld) {
        // Follow character on XZ, fixed Y, clamped so map edges stay in viewport
        const charPos = ctx.activeCharacter.getPosition();
        const cam = ctx.cam.camera;
        const halfMap = OW_TOTAL_SIZE / 2;

        // Compute visible half-extents at ground plane from camera frustum
        const dist = ctx.cam.getDistance();
        const pitch = -ctx.cam.getAngleX(); // angleX is negative (looking down)
        const vFov = (cam.fov * Math.PI) / 180;
        const visibleH = 2 * dist * Math.sin(pitch) * Math.tan(vFov / 2);
        const visibleW = visibleH * cam.aspect;
        // Margin: how far camera center can move before map edge enters viewport
        const marginX = Math.max(0, halfMap - visibleW / 2);
        const marginZ = Math.max(0, halfMap - visibleH / 2);

        const cx = Math.max(-marginX, Math.min(marginX, charPos.x));
        const cz = Math.max(-marginZ, Math.min(marginZ, charPos.z));
        ctx.cam.setTarget(cx, -0.1, cz);
      } else if (ctx.debugLadderIndex >= 0) {
        const ladders = ctx.terrain.getLadderDefs();
        const l = ladders[ctx.debugLadderIndex];
        if (l) {
          const midY = (l.bottomY + l.topY) / 2;
          ctx.cam.setTarget(l.bottomX, midY, l.bottomZ);
        }
      } else {
        const camTarget = ctx.activeCharacter.getCameraTarget();
        ctx.cam.setTarget(camTarget.x, camTarget.y, camTarget.z);
      }

      // Pickups
      const activePos = ctx.activeCharacter.getPosition();
      const params = useGameStore.getState().characterParams;

      const pickedUp = ctx.collectibles.update(dt, activePos);
      if (pickedUp > 0) {
        const total = ctx.collectibles.getTotalCollected();
        useGameStore.getState().setCollectibles(total);
        useGameStore.getState().setScore(total);
        audioSystem.sfx('pickup');
        ctx.enemySystem?.spawnPickupLabel(
          activePos.x, activePos.y, activePos.z,
          `+${pickedUp} Gem`, '#44ffcc', 'md',
        );
      }

      const chestsOpened = ctx.chestSystem.update(dt, activePos, params.stepHeight);
      if (chestsOpened > 0) audioSystem.sfx('chest');

      const loot = ctx.lootSystem.update(dt, activePos);
      if (loot.coins > 0) {
        useGameStore.getState().addCoins(loot.coins);
        useGameStore.getState().setScore(useGameStore.getState().score + loot.coins);
        audioSystem.sfx('coin');
        ctx.enemySystem?.spawnPickupLabel(
          activePos.x, activePos.y, activePos.z,
          `+${loot.coins} Gold`, '#ffd700',
        );
      }
      if (loot.gems > 0) {
        const s = useGameStore.getState();
        s.setCollectibles(s.collectibles + loot.gems);
        s.setScore(s.score + loot.gems * 5);
        audioSystem.sfx('pickup');
        ctx.enemySystem?.spawnPickupLabel(
          activePos.x, activePos.y, activePos.z,
          `+${loot.gems} Gem`, '#44ffcc', 'md',
        );
      }
      if (loot.potions > 0) {
        for (const colorIndex of loot.potionColorIndices) {
          const result = ctx.potionSystem.drink(colorIndex);
          audioSystem.sfx('drink');
          const labelColor = result.positive ? '#44ff66' : '#ff4444';
          const labelText = result.firstTime ? `${result.label}!` : result.label;
          ctx.enemySystem?.spawnPickupLabel(
            activePos.x, activePos.y, activePos.z,
            labelText, labelColor, 'md',
          );

          if (result.effect === 'heal') {
            const s = useGameStore.getState();
            const healAmount = 1 + Math.floor(Math.random() * 4);
            const newHp = Math.min(s.hp + healAmount, s.maxHp);
            s.setHP(newHp, s.maxHp);
            ctx.activeCharacter!.hp = newHp;
            ctx.potionVFX.spawnHealNumber(ctx.activeCharacter!, healAmount);
          }
          ctx.potionVFX.onDrink(
            result.effect,
            ctx.activeCharacter!,
            result.effect === 'armor' ? ctx.potionSystem.armorHitsRemaining : undefined,
          );

          if (result.effect === 'frenzy' && ctx.enemySystem) {
            ctx.enemySystem.triggerFrenzySpawn(
              ctx.activeCharacter!,
              ctx.terrain.getDoorCenters(),
              ctx.terrain.getRoomVisibility(),
            );
          }
        }
      }

      // Food pickup
      if (loot.foodHunger > 0 && ctx.activeCharacter) {
        ctx.activeCharacter.restoreHunger(loot.foodHunger);
        audioSystem.sfx('coin');
        ctx.enemySystem?.spawnPickupLabel(
          activePos.x, activePos.y, activePos.z,
          `+${loot.foodHunger} Food`, '#ff8844',
        );
      }

      // Prop potion pickup
      const propSystem2 = ctx.terrain.getPropSystem();
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
            const colorIndex = prop.colorIndex ?? 0;
            const result = ctx.potionSystem.drink(colorIndex);
            audioSystem.sfx('drink');
            const labelColor = result.positive ? '#44ff66' : '#ff4444';
            const labelText = result.firstTime ? `${result.label}!` : result.label;
            ctx.enemySystem?.spawnPickupLabel(
              activePos.x, activePos.y, activePos.z,
              labelText, labelColor, 'md',
            );

            if (result.effect === 'heal') {
              const s = useGameStore.getState();
              const healAmount = 1 + Math.floor(Math.random() * 4);
              const newHp = Math.min(s.hp + healAmount, s.maxHp);
              s.setHP(newHp, s.maxHp);
              ctx.activeCharacter!.hp = newHp;
              ctx.potionVFX.spawnHealNumber(ctx.activeCharacter!, healAmount);
            }
            ctx.potionVFX.onDrink(
              result.effect,
              ctx.activeCharacter!,
              result.effect === 'armor' ? ctx.potionSystem.armorHitsRemaining : undefined,
            );

            if (result.effect === 'frenzy' && ctx.enemySystem) {
              ctx.enemySystem.triggerFrenzySpawn(
                ctx.activeCharacter!,
                ctx.terrain.getDoorCenters(),
                ctx.terrain.getRoomVisibility(),
              );
            }
            propSystem2.removeProp(prop);
          } else if (propMagnetOn && dist < magnetRadius * 1.5) {
            const speed = (1 - dist / (magnetRadius * 1.5)) * magnetSpeed * dt;
            prop.mesh.position.x += (dx / dist) * speed;
            prop.mesh.position.z += (dz / dist) * speed;
            const dy = activePos.y + 0.15 - prop.mesh.position.y;
            prop.mesh.position.y += dy * 4 * dt;
          }
        }
      }

      // Portal detection
      if (ctx.portalCooldown > 0) {
        ctx.portalCooldown -= dt;
      }

      const exitPortalPos = ctx.terrain.getExitPortalPosition();
      if (exitPortalPos && !ctx.exitTriggered && ctx.portalCooldown <= 0 && ctx.activeCharacter) {
        const dx = activePos.x - exitPortalPos.x;
        const dz = activePos.z - exitPortalPos.z;
        const portalRadius = useGameStore.getState().tileSize * 0.35;
        if (Math.abs(dx) < portalRadius && Math.abs(dz) < portalRadius) {
          const wallDir = ctx.terrain.getExitWallDir();
          const facing = ctx.activeCharacter.getFacing();
          const faceDx = -Math.sin(facing);
          const faceDz = -Math.cos(facing);
          const dot = faceDx * wallDir[0] + faceDz * wallDir[1];
          if (dot > 0.5) {
            ctx.exitTriggered = true;
            sceneManager.changeFloor('down');
          }
        }
      }

      const entrancePortalPos = ctx.terrain.getEntrancePortalPosition();
      const canRetreat = useGameStore.getState().floor > 1 ||
        !!useGameStore.getState().overworldState?.pendingPoiDungeon;
      if (
        entrancePortalPos && !ctx.exitTriggered && ctx.portalCooldown <= 0 &&
        ctx.activeCharacter && canRetreat
      ) {
        const edx = activePos.x - entrancePortalPos.x;
        const edz = activePos.z - entrancePortalPos.z;
        const portalRadius2 = useGameStore.getState().tileSize * 0.35;
        if (Math.abs(edx) < portalRadius2 && Math.abs(edz) < portalRadius2) {
          const entranceFacing = ctx.terrain.getEntranceFacing();
          const facing = ctx.activeCharacter.getFacing();
          const wallDx = Math.sin(entranceFacing);
          const wallDz = Math.cos(entranceFacing);
          const faceDx = -Math.sin(facing);
          const faceDz = -Math.cos(facing);
          const dot = faceDx * wallDx + faceDz * wallDz;
          if (dot > 0.5) {
            ctx.exitTriggered = true;
            sceneManager.changeFloor('up');
          }
        }
      }

      // Click marker fade
      if (ctx.clickMarker.visible) {
        ctx.markerLife -= dt;
        if (ctx.markerLife <= 0) {
          ctx.clickMarker.visible = false;
        } else {
          ctx.markerMat.opacity = Math.min(0.8, ctx.markerLife * 2);
          ctx.clickMarker.scale.setScalar(1 + (0.6 - ctx.markerLife) * 0.5);
        }
      }

      // HP bars
      for (const char of ctx.characters) {
        char.updateHpBar(ctx.cam.camera);
      }
      if (ctx.enemySystem) {
        for (const enemy of ctx.enemySystem.getEnemies()) {
          enemy.updateHpBar(ctx.cam.camera);
        }
      }

      // Speech bubbles
      ctx.speechSystem.update(dt);
    } else if (phase === 'playing') {
      ctx.collectibles.update(dt, new THREE.Vector3(9999, 0, 9999));
    }

    // Sync particle toggles
    sceneManager.syncParticles(useGameStore.getState().particleToggles);

    // Always update camera and particles
    ctx.cam.updatePosition(dt);
    for (const sys of Object.values(ctx.particleSystems)) {
      if (sys) sys.update(gameDt);
    }
  }

  function loop(time: number): void {
    ctx.rafId = requestAnimationFrame(loop);
    const dt = Math.min((time - ctx.lastTime) / 1000, 0.05);
    ctx.lastTime = time;

    update(dt);
    ctx.terrain.updateWater(dt, ctx.renderer, ctx.scene, ctx.cam.camera);
    ctx.terrain.updateProps(dt, ctx.activeCharacter?.mesh.position);

    ctx.postProcess.updateFade(dt);

    const ppSettings = useGameStore.getState().postProcess;
    ctx.postProcess.sync(ppSettings);
    if (ppSettings.enabled || ctx.postProcess.isFading) {
      ctx.postProcess.render();
    } else {
      ctx.renderer.render(ctx.scene, ctx.cam.camera);
    }
  }

  return {
    start() {
      ctx.rafId = requestAnimationFrame(loop);
    },
    triggerHitstop,
    triggerPlayerDeath,
  };
}
