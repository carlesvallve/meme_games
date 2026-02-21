import * as THREE from 'three';
import { CAMERA, COLORS, DUNGEON, CELL, DIRECTIONS, getThemeForFloor } from './core/Constants.js';
import { eventBus, Events } from './core/EventBus.js';
import { gameState } from './core/GameState.js';
import { inputManager } from './core/InputManager.js';
import { DungeonGenerator } from './dungeon/DungeonGenerator.js';
import { DungeonRenderer } from './dungeon/DungeonRenderer.js';
import { PlayerController } from './dungeon/PlayerController.js';
import { SpriteRenderer } from './sprites/SpriteRenderer.js';
import { FloorMeterDisplay } from './sprites/FloorMeterDisplay.js';
import { Player } from './entities/Player.js';
import { Enemy } from './entities/Enemy.js';
import { getEnemyForFloor, ENEMY_TYPES } from './entities/EnemyDatabase.js';
import { CombatState } from './combat/CombatState.js';
import { CombatUI } from './ui/CombatUI.js';
import { HUD } from './ui/HUD.js';
import { DialogUI } from './ui/DialogUI.js';
import { LootUI } from './ui/LootUI.js';
import { getRandomRewardCard } from './combat/CardDefinitions.js';
import { audioManager } from './audio/AudioManager.js';
import { tween, ease } from './core/Tween.js';

// ---- Three.js setup ----
const container = document.getElementById('game-container');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.insertBefore(renderer.domElement, container.firstChild);

const camera = new THREE.PerspectiveCamera(
  CAMERA.FOV,
  window.innerWidth / window.innerHeight,
  CAMERA.NEAR,
  CAMERA.FAR
);
camera.rotation.order = 'YXZ'; // Y=turn first, then X=pitch (combat tilt)

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.FOG);
scene.fog = new THREE.Fog(COLORS.FOG, 1, DUNGEON.CELL_SIZE * 6);

// Lighting — dim ambient so torches and player light create contrast
const ambient = new THREE.AmbientLight(COLORS.AMBIENT, 0.35);
scene.add(ambient);

const playerLight = new THREE.PointLight(COLORS.PLAYER_LIGHT, 1.4, DUNGEON.CELL_SIZE * 5);
playerLight.position.set(0, CAMERA.EXPLORE_HEIGHT, 0);
playerLight.castShadow = true;
scene.add(playerLight);

// ---- Game systems ----
const generator = new DungeonGenerator();
const dungeonRenderer = new DungeonRenderer(scene);
const spriteRenderer = new SpriteRenderer(scene, camera);
const player = new Player();
const combatState = new CombatState(player);
const combatUI = new CombatUI(combatState);
const floorMeters = new FloorMeterDisplay(scene);
const dialogUI = new DialogUI();
const lootUI = new LootUI();

let dungeonMap = null;
let playerController = null;
let hud = null;

// Combat camera
let combatCameraTiltTarget = 0;
let combatCameraTiltCurrent = 0;
let combatCameraHeightTarget = CAMERA.EXPLORE_HEIGHT;
let combatCameraHeightCurrent = CAMERA.EXPLORE_HEIGHT;

// ---- Game flow ----
function startGame() {
  gameState.reset();
  player.reset();
  generateFloor(1);
  audioManager.init();
  showTitleScreen();
}

function showTitleScreen() {
  dialogUI.show('DCRAWLER', 'A dungeon awaits...<br>Navigate with WASD, turn with QE<br>Press M for minimap', [
    { label: 'ENTER', action: () => beginExploring() },
  ]);
}

function beginExploring() {
  gameState.exploring = true;
  gameState.inCombat = false;
  inputManager.enabled = true;
  floorMeters.hide();

  combatCameraTiltTarget = CAMERA.EXPLORE_TILT;
  combatCameraHeightTarget = CAMERA.EXPLORE_HEIGHT;

  if (hud) {
    hud.show();
    hud.beginExploring();
  }
}

function generateFloor(floor) {
  gameState.floor = floor;

  // Determine theme for this floor
  const theme = getThemeForFloor(floor);

  // Apply theme to scene lighting
  scene.background.set(theme.fog);
  scene.fog.color.set(theme.fog);
  ambient.color.set(theme.ambient);
  ambient.intensity = theme.ambientIntensity;
  playerLight.color.set(theme.playerLight);

  // Clean up old sprites
  spriteRenderer.dispose();

  // Generate dungeon
  dungeonMap = generator.generate(floor);
  dungeonRenderer.render(dungeonMap, theme);

  // Player controller
  if (playerController) playerController.destroy();
  playerController = new PlayerController(camera, dungeonMap);
  playerController.setPosition(dungeonMap.playerStart.x, dungeonMap.playerStart.z);

  // HUD
  if (hud) hud.hide();
  hud = new HUD(player, dungeonMap, combatState);
  hud.setFloor(floor);
  hud.setPlayerPos(dungeonMap.playerStart.x, dungeonMap.playerStart.z);

  // Spawn enemy sprites
  for (let z = 0; z < dungeonMap.height; z++) {
    for (let x = 0; x < dungeonMap.width; x++) {
      const cell = dungeonMap.getCell(x, z);
      if (cell === CELL.ENEMY) {
        const def = getEnemyForFloor(floor);
        const key = `enemy_${x}_${z}`;
        spriteRenderer.createSprite(key, {
          x, z, color: def.color, symbol: def.symbol,
        });
        dungeonMap.setEntity(x, z, { type: 'enemy', definition: def, key });
      } else if (cell === CELL.CHEST) {
        const key = `chest_${x}_${z}`;
        spriteRenderer.createSprite(key, {
          x, z, color: COLORS.ACCENT, symbol: '$',
          width: 1.5, height: 1.5,
        });
        dungeonMap.setEntity(x, z, { type: 'chest', key });
      } else if (cell === CELL.STAIRS) {
        const key = `stairs_${x}_${z}`;
        spriteRenderer.createSprite(key, {
          x, z, color: COLORS.ACCENT, symbol: '>',
          width: 1.5, height: 1.5,
        });
      }
    }
  }

  // DEBUG: spawn a test rat directly in front of the player
  {
    const sx = dungeonMap.playerStart.x;
    const sz = dungeonMap.playerStart.z - 1; // one cell north
    const def = ENEMY_TYPES.RAT;
    const key = `enemy_${sx}_${sz}`;
    dungeonMap.setCell(sx, sz, CELL.ENEMY);
    spriteRenderer.createSprite(key, { x: sx, z: sz, color: def.color, symbol: def.symbol });
    dungeonMap.setEntity(sx, sz, { type: 'enemy', definition: def, key });
  }

  eventBus.emit(Events.DUNGEON_GENERATED, { floor });
}

// ---- Event handlers ----
eventBus.on('player:step', ({ x, z, moveDir }) => {
  if (!gameState.exploring) return;

  audioManager.sfxStep();
  hud.setPlayerPos(x, z);

  // Update light position
  playerLight.position.set(
    x * DUNGEON.CELL_SIZE,
    CAMERA.EXPLORE_HEIGHT,
    z * DUNGEON.CELL_SIZE
  );

  // Check for encounters
  const entity = dungeonMap.getEntity(x, z);
  if (!entity) {
    // Check for stairs
    if (dungeonMap.getCell(x, z) === CELL.STAIRS) {
      handleStairs();
    }
    return;
  }

  if (entity.type === 'enemy') {
    // Snap player to face the enemy (important for lateral/backward encounters)
    if (moveDir !== undefined && moveDir !== playerController.facingIndex) {
      playerController.snapFacing(moveDir);
    }
    handleEnemyEncounter(x, z, entity);
  } else if (entity.type === 'chest') {
    handleChest(x, z, entity);
  }
});

function handleEnemyEncounter(x, z, entity) {
  gameState.exploring = false;
  gameState.inCombat = true;
  inputManager.enabled = false;

  // Store pre-combat position (cell we came from) for escape retreat
  const dir = DIRECTIONS[playerController.facingIndex];
  gameState.preCombatPos = { x: x - dir.x, z: z - dir.z };

  // Tilt camera down and raise height for combat view
  combatCameraTiltTarget = CAMERA.COMBAT_TILT;
  combatCameraHeightTarget = CAMERA.COMBAT_HEIGHT;

  const enemy = new Enemy(entity.definition, gameState.floor);
  gameState.currentEnemy = enemy;

  // Show 3D floor meters
  const px = playerController.gridX;
  const pz = playerController.gridZ;
  floorMeters.show(px, pz, combatState.playerMaxSteps, enemy.maxSteps || 10);
  floorMeters.positionBetween(px, pz, playerController.facingIndex);

  combatUI.show(enemy, floorMeters);
  combatState.startCombat(enemy);
  if (hud) hud.setCombatMode();
}

function handleChest(x, z, entity) {
  audioManager.sfxChest();
  const gold = 5 + Math.floor(Math.random() * 10 * gameState.floor);
  const heal = Math.floor(player.maxHp * 0.2);
  player.gold += gold;
  player.hp = Math.min(player.maxHp, player.hp + heal);

  spriteRenderer.removeSprite(entity.key);
  dungeonMap.removeEntity(x, z);
  dungeonMap.setCell(x, z, CELL.FLOOR);

  if (hud) hud.update();

  dialogUI.show('TREASURE!', `Found ${gold} gold!<br>Restored ${heal} HP`, [
    { label: 'NICE', action: () => {} },
  ]);
}

function handleStairs() {
  dialogUI.show('STAIRS DOWN', `Descend to floor ${gameState.floor + 1}?`, [
    { label: 'DESCEND', action: () => {
      gameState.floorsCleared++;
      generateFloor(gameState.floor + 1);
      beginExploring();
    }},
    { label: 'NOT YET', action: () => {} },
  ]);
}

// Combat end
eventBus.on(Events.COMBAT_END, ({ result }) => {
  if (result === 'victory') {
    audioManager.sfxVictory();
    const enemy = gameState.currentEnemy;
    const xpGained = enemy.xpReward;
    const goldGained = enemy.goldReward;
    player.gold += goldGained;
    const leveledUp = player.addXP(xpGained);

    gameState.enemiesDefeated++;
    gameState.score = gameState.enemiesDefeated;

    // Remove enemy from dungeon
    const px = playerController.gridX;
    const pz = playerController.gridZ;
    const entity = dungeonMap.getEntity(px, pz);
    if (entity && entity.key) {
      spriteRenderer.removeSprite(entity.key);
    }
    dungeonMap.removeEntity(px, pz);
    dungeonMap.setCell(px, pz, CELL.FLOOR);

    if (hud) hud.update();

    // Spawn loot bag quickly after enemy dies
    setTimeout(() => {
      const lootKey = `loot_${px}_${pz}`;
      const lootBag = spriteRenderer.createLootBag(lootKey, px, pz);

      lootBag.userData.onClick = () => {
        lootBag.userData.clickable = false; // prevent double-click
        audioManager.sfxChest();

        spriteRenderer.animateLootPickup(lootKey, () => {
          // 50/50 card or coin reward
          if (Math.random() < 0.5) {
            // Card reward
            const rewardCard = getRandomRewardCard();
            lootUI.showReward(rewardCard, xpGained, goldGained, leveledUp, () => {
              combatState.playerHand.addCardToDeck(rewardCard);
              setTimeout(() => beginExploring(), 400);
            });
          } else {
            // Coin reward — bonus gold on top of base gold
            const bonusGold = Math.floor(goldGained * (1 + Math.random() * 2));
            player.gold += bonusGold;
            if (hud) hud.update();
            lootUI.showCoinReward(bonusGold, xpGained, goldGained, leveledUp, () => {
              setTimeout(() => beginExploring(), 400);
            });
          }
        });
      };
    }, 600);
  } else {
    audioManager.sfxDefeat();
    setTimeout(() => {
      dialogUI.show('GAME OVER', `Defeated on floor ${gameState.floor}<br>Enemies slain: ${gameState.enemiesDefeated}`, [
        { label: 'TRY AGAIN', action: () => {
          startGame();
          beginExploring();
        }},
      ]);
    }, 2100);
  }
});

// Debug: Escape to flee combat and return to previous cell
eventBus.on('input:cancel', () => {
  if (!gameState.inCombat) return;

  combatUI.hide();
  combatState.phase = 'idle';

  // Stop any in-progress movement tween before repositioning
  playerController.isMoving = false;
  playerController.isRotating = false;

  // Return player to the cell they entered combat from, keeping current facing
  const ret = gameState.preCombatPos;
  if (ret) {
    playerController.setPosition(ret.x, ret.z);
  }

  audioManager.sfxStep();
  beginExploring();
});

// Cheat: press N to skip to next floor
eventBus.on('input:cheatDescend', () => {
  if (gameState.inCombat) return;
  gameState.floorsCleared++;
  generateFloor(gameState.floor + 1);
  beginExploring();
});

// Combat audio hooks
eventBus.on(Events.COMBAT_DRAW_CARD, () => audioManager.sfxCard());
eventBus.on(Events.COMBAT_BUST, () => audioManager.sfxBust());
eventBus.on(Events.COMBAT_ATTACK, ({ attacker }) => {
  if (attacker === 'player') audioManager.sfxHit();
  else audioManager.sfxDamage();
});

// ---- Resize handler ----
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---- Render loop ----
let lastTime = 0;

function animate(time) {
  requestAnimationFrame(animate);
  const dt = Math.min(time - lastTime, 50); // cap at 50ms
  lastTime = time;

  if (playerController && gameState.exploring) {
    playerController.update(dt);
  }

  // Smooth combat camera tilt + height
  combatCameraTiltCurrent += (combatCameraTiltTarget - combatCameraTiltCurrent) * 0.08;
  combatCameraHeightCurrent += (combatCameraHeightTarget - combatCameraHeightCurrent) * 0.08;
  camera.rotation.x = combatCameraTiltCurrent;
  camera.position.y = combatCameraHeightCurrent;

  dungeonRenderer.updateTorches(dt);
  spriteRenderer.update(dt);
  renderer.render(scene, camera);
}

// ---- Init ----
inputManager.init();
startGame();
requestAnimationFrame(animate);
