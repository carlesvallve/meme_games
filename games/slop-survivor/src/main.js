import Phaser from 'phaser';
import { GameConfig } from './core/GameConfig.js';
import { GAME, DPR, PX } from './core/Constants.js';
import { eventBus, Events } from './core/EventBus.js';
import { gameState } from './core/GameState.js';
import { initAudioBridge } from './audio/AudioBridge.js';
import { initPlayFun } from './playfun.js';

// Debug: log display config values so we can compare real device vs simulator
console.log('[Display]', JSON.stringify({
  innerWidth: window.innerWidth,
  innerHeight: window.innerHeight,
  devicePixelRatio: window.devicePixelRatio,
  DPR,
  PX: Math.round(PX * 1000) / 1000,
  GAME_WIDTH: GAME.WIDTH,
  GAME_HEIGHT: GAME.HEIGHT,
  IS_MOBILE: GAME.IS_MOBILE,
  IS_PORTRAIT: GAME.IS_PORTRAIT,
  maxTouchPoints: navigator.maxTouchPoints,
  phaserZoom: 1 / DPR,
}));

// Initialize audio bridge (wires EventBus events to audio playback)
initAudioBridge();

const game = new Phaser.Game(GameConfig);

// Initialize Play.fun SDK (non-blocking — game works without it)
initPlayFun().catch(err => console.warn('[PlayFun] init failed:', err));

// Expose for Playwright testing
window.__GAME__ = game;
window.__GAME_STATE__ = gameState;
window.__EVENT_BUS__ = eventBus;
window.__EVENTS__ = Events;

// --- AI-readable game state snapshot ---
window.render_game_to_text = () => {
  if (!game || !gameState) return JSON.stringify({ error: 'not_ready' });

  const activeScenes = game.scene.getScenes(true).map(s => s.scene.key);
  const payload = {
    coords: 'origin:top-left x:right y:down',
    mode: gameState.gameOver ? 'game_over' : gameState.started ? 'playing' : 'menu',
    scene: activeScenes[0] || null,
    scenes: activeScenes,
    score: gameState.score,
    bestScore: gameState.bestScore,
    health: gameState.health,
    maxHealth: gameState.maxHealth,
    level: gameState.level,
    xp: gameState.xp,
    xpToNext: gameState.xpToNext,
    enemiesKilled: gameState.enemiesKilled,
    timeSurvived: gameState.timeSurvived,
    isMuted: gameState.isMuted,
    upgrades: gameState.upgrades,
  };

  // Add player info when in gameplay
  const gameScene = game.scene.getScene('GameScene');
  if (gameState.started && gameScene?.player?.sprite?.body) {
    const s = gameScene.player.sprite;
    const body = s.body;
    payload.player = {
      x: Math.round(s.x),
      y: Math.round(s.y),
      vx: Math.round(body.velocity.x),
      vy: Math.round(body.velocity.y),
      facingX: gameScene.player.facingX,
      facingY: gameScene.player.facingY,
      invulnerable: gameScene.player.invulnerable,
      shieldActive: gameScene.player.shieldActive,
    };

    // Active enemies
    if (gameScene.waveSystem) {
      const enemies = gameScene.waveSystem.getActiveEnemies();
      payload.enemies = enemies.slice(0, 10).map(e => ({
        type: e.typeName,
        isBoss: e.isBoss,
        x: Math.round(e.sprite.x),
        y: Math.round(e.sprite.y),
        health: e.health,
      }));
      payload.totalEnemies = enemies.length;
    }

    // Active XP gems
    if (gameScene.xpGems) {
      payload.xpGems = gameScene.xpGems.filter(g => !g.collected).length;
    }

    // Active power-ups
    if (gameScene.powerUps) {
      payload.powerUps = gameScene.powerUps.filter(p => !p.collected).map(p => ({
        type: p.typeName,
        x: Math.round(p.sprite.x),
        y: Math.round(p.sprite.y),
      }));
    }

    // Weapon stats
    if (gameScene.weaponSystem) {
      const ws = gameScene.weaponSystem.stats;
      payload.weapon = {
        damage: ws.damage,
        cooldown: ws.cooldown,
        range: Math.round(ws.range),
        projectileCount: ws.projectileCount || 1,
      };
    }
  }

  return JSON.stringify(payload);
};

// --- Deterministic time-stepping hook ---
window.advanceTime = (ms) => {
  return new Promise((resolve) => {
    const start = performance.now();
    function step() {
      if (performance.now() - start >= ms) return resolve();
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
};
