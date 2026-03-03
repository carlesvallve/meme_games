import * as THREE from 'three';
import { useGameStore, DEFAULT_CAMERA_PARAMS, DEFAULT_LIGHT_PRESET, DEFAULT_TORCH_PARAMS, DEFAULT_PARTICLE_TOGGLES, DEFAULT_SCENE_SETTINGS, DEFAULT_ENEMY_PARAMS } from '../store';
import { DEFAULT_CHARACTER_PARAMS } from './character';
import { randomPalette, palettes } from './terrain';
import { getSkyColors } from './rendering';
import { audioSystem } from '../utils/AudioSystem';
import { POTION_COLORS, EFFECT_META } from './combat';
import { rerollRoster, VOX_HEROES, VOX_ENEMIES, voxRoster, getCharacterName, getArchetype, getCharacterStats, randomInRange, CHARACTER_TEAM_COLORS } from './character';
import type { Character } from './character';
import type { GameContext } from './GameContext';
import type { GameSceneManager } from './GameSceneManager';

/** Apply per-archetype stats after a skin change and sync HP/name to the store. */
export function applyCharacterStats(ctx: GameContext, char: Character): void {
  const entry = voxRoster[char.characterType];
  if (!entry) return;
  const stats = getCharacterStats(getArchetype(entry.name));
  const hpRatio = char.maxHp > 0 ? char.hp / char.maxHp : 1;
  const newMaxHp = Math.round(randomInRange(stats.hp));
  char.maxHp = newMaxHp;
  char.hp = Math.max(1, Math.round(newMaxHp * hpRatio));
  char.params.speed = randomInRange(stats.movSpeed);
  // Boost player-controlled monsters so they feel responsive
  if (!char.isEnemy && entry.category === 'enemy') {
    char.params.speed = Math.max(char.params.speed * 1.25, 2.0);
  }
  char.params.attackDamage = Math.floor(randomInRange(stats.damage));
  char.params.attackCooldown = 1 / randomInRange(stats.atkSpeed);
  char.critChance = stats.critChance;
  char.armour = stats.armour;
  useGameStore.getState().setHP(char.hp, char.maxHp);
  useGameStore.getState().setActiveCharacter(
    getCharacterName(char.characterType),
    CHARACTER_TEAM_COLORS[char.characterType],
  );
}

export function createCallbacks(
  ctx: GameContext,
  sceneManager: GameSceneManager,
): void {
  useGameStore.setState({
    onStartGame: () => {
      const wasPlayerDead =
        useGameStore.getState().phase === 'player_dead' ||
        (ctx.activeCharacter && !ctx.activeCharacter.isAlive);
      ctx.speechSystem.dismissAll();
      rerollRoster();
      useGameStore.getState().setPhase('select');
      audioSystem.init();
      if (wasPlayerDead) {
        ctx.lastSelectedCharacter = null;
        ctx.needsFullRegen = true;
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
      if (!ctx.activeCharacter || !ctx.activeCharacter.isAlive) return;
      const result = ctx.potionSystem.drink(colorIndex);
      audioSystem.sfx('drink');
      useGameStore.getState().removePotionFromInventory(colorIndex);

      if (result.effect === 'heal') {
        const s = useGameStore.getState();
        const healAmount = 1 + Math.floor(Math.random() * 4);
        const newHp = Math.min(s.hp + healAmount, s.maxHp);
        s.setHP(newHp, s.maxHp);
        ctx.activeCharacter.hp = newHp;
        ctx.potionVFX.spawnHealNumber(ctx.activeCharacter, healAmount);
      }

      ctx.potionVFX.onDrink(
        result.effect,
        ctx.activeCharacter,
        result.effect === 'armor' ? ctx.potionSystem.armorHitsRemaining : undefined,
      );

      if (result.effect === 'frenzy' && ctx.enemySystem) {
        ctx.enemySystem.triggerFrenzySpawn(
          ctx.activeCharacter,
          ctx.terrain.getDoorCenters(),
          ctx.terrain.getRoomVisibility(),
        );
      }
    },
    onRegenerateScene: () => {
      ctx.speechSystem.dismissAll();
      ctx.postProcess.fadeTransition(
        () => {
          useGameStore.getState().clearLevelCache();
          useGameStore.getState().setCurrentTheme('');
          useGameStore.getState().setFloor(1);
          const seed = useGameStore.getState().getFloorSeed(1);
          sceneManager.regenerateScene({ seed });
        },
        9999,
        3.0,
      );
    },
    onRemesh: () => {
      ctx.terrain.remesh();
    },
    onRandomizePalette: () => {
      const { name, palette } = randomPalette();
      ctx.terrain.applyPalette(palette, name);
      useGameStore.getState().setPaletteActive(name);
      ctx.sceneSky.setPalette(name);
      ctx.baseSkyColors = getSkyColors(name);
    },
    onApplyPalette: (name: string) => {
      if (name === 'random') {
        useGameStore.getState().onRandomizePalette?.();
        return;
      }
      const pal = palettes[name];
      if (!pal) return;
      ctx.terrain.applyPalette(pal, name);
      useGameStore.getState().setPaletteActive(name);
      ctx.sceneSky.setPalette(name);
      ctx.baseSkyColors = getSkyColors(name);
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
      if (!store.torchEnabled !== !true) store.toggleTorch();
      const td = DEFAULT_TORCH_PARAMS;
      for (const key of Object.keys(td) as (keyof typeof td)[]) {
        store.setTorchParam(key, td[key]);
      }
      store.setTimeOfDay(DEFAULT_SCENE_SETTINGS.timeOfDay);
      store.setDayCycleEnabled(DEFAULT_SCENE_SETTINGS.dayCycleEnabled);
      store.setDayCycleSpeed(DEFAULT_SCENE_SETTINGS.dayCycleSpeed);
      store.setFastNights(DEFAULT_SCENE_SETTINGS.fastNights);
      store.setSunDebug(DEFAULT_SCENE_SETTINGS.sunDebug);
    },
    onSpawnEnemy: () => {
      if (ctx.enemySystem) ctx.enemySystem.spawnEnemies(1);
    },
    onTestFrenzyDrink: () => {
      if (!ctx.enemySystem || !ctx.activeCharacter) return;
      ctx.enemySystem.triggerFrenzySpawn(
        ctx.activeCharacter,
        ctx.terrain.getDoorCenters(),
        ctx.terrain.getRoomVisibility(),
      );
      ctx.potionVFX.onDrink('frenzy', ctx.activeCharacter);
    },
    onTestFrenzyKick: () => {
      if (!ctx.enemySystem) return;
      const visible = ctx.enemySystem.getVisibleEnemies();
      if (visible.length === 0) return;
      const target = visible[Math.floor(Math.random() * visible.length)];
      ctx.enemySystem.setTauntTarget(target);
      ctx.enemySystem.applyStatusEffect(target, 'frenzy', 25);
      ctx.enemySystem.spawnPickupLabel(
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
}
