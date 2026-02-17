// AudioBridge.js — Wires EventBus events to audio playback
// BGM uses Strudel (via AudioManager), SFX use Web Audio API

import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';
import { audioManager } from './AudioManager.js';
import { menuTheme, gameplayBGM, gameOverTheme } from './music.js';
import {
  attackSfx,
  laserSfx,
  enemyDeathSfx,
  enemyHitSfx,
  xpPickupSfx,
  powerUpSfx,
  playerHitSfx,
  bossSpawnSfx,
  levelUpSfx,
  clickSfx,
  explosionSfx,
  deathSfx,
  enginesOnSfx,
  startEngine,
  updateEngine,
  stopEngine,
  pauseEngine,
  resumeEngine,
  typeBlipSfx,
  footstepSfx,
  missileSfx,
  mineDropSfx,
  smallExplosionSfx,
} from './sfx.js';

export function initAudioBridge() {
  // Init Strudel on first user interaction (browser autoplay policy)
  eventBus.on(Events.AUDIO_INIT, () => {
    audioManager.init();
  });

  // --- BGM transitions (Strudel) ---
  eventBus.on(Events.MUSIC_MENU, () => audioManager.playMusic(menuTheme));
  eventBus.on(Events.MUSIC_GAMEPLAY, () => audioManager.playAdaptive(gameplayBGM, 1));
  eventBus.on(Events.MUSIC_GAMEOVER, () => audioManager.playMusic(gameOverTheme));
  eventBus.on(Events.MUSIC_STOP, () => audioManager.stopMusic());

  // --- Adaptive music intensity ---
  eventBus.on(Events.MUSIC_INTENSITY, ({ tier }) => {
    audioManager.setIntensityTier(tier);
  });

  // --- SFX (Web Audio API — one-shot) ---

  // Player auto-attack fires projectile
  eventBus.on(Events.SCORE_CHANGED, () => {
    // Score changes on enemy kill — the enemy death sfx handles this
  });

  // Enemy killed — splat
  eventBus.on(Events.ENEMY_KILLED, (data) => {
    enemyDeathSfx();
  });

  // XP gem collected — sparkle chime
  eventBus.on(Events.XP_COLLECTED, () => {
    xpPickupSfx();
  });

  // Power-up collected — whoosh
  eventBus.on(Events.POWERUP_COLLECTED, () => {
    powerUpSfx();
  });

  // Player hit — crunch
  eventBus.on(Events.PLAYER_HIT, () => {
    playerHitSfx();
  });

  // Player died — explosion boom, then ominous descending tones
  eventBus.on(Events.PLAYER_DIED, () => {
    explosionSfx();
    // Delay the ominous notes to play after the explosion
    setTimeout(() => deathSfx(), 500);
  });

  // Boss spawn — deep horn
  eventBus.on(Events.BOSS_SPAWN, () => {
    bossSpawnSfx();
  });

  // Level up — fanfare
  eventBus.on(Events.LEVEL_UP, () => {
    levelUpSfx();
  });

  // Ship board — engines on
  eventBus.on(Events.SHIP_BOARD, () => {
    enginesOnSfx();
  });

  // --- Mute toggle ---
  eventBus.on(Events.AUDIO_TOGGLE_MUTE, () => {
    gameState.isMuted = !gameState.isMuted;

    // Persist preference
    try {
      localStorage.setItem('slop-survivor-muted', gameState.isMuted ? 'true' : 'false');
    } catch (e) { /* localStorage not available */ }

    if (gameState.isMuted) {
      audioManager.stopMusic();
    } else {
      audioManager.resumeMusic();
    }
  });
}

// Hook for weapon system to play attack SFX directly (called per-projectile)
export function playAttackSfx() {
  attackSfx();
}

// Hook for manual laser fire
export function playLaserSfx() {
  laserSfx();
}

// Hook for button clicks in scenes
export function playClickSfx() {
  clickSfx();
}

// Engine sound — always-on hum after boarding, velocity-based pitch
export function playStartEngine() {
  startEngine();
}
export function playUpdateEngine(speedRatio) {
  updateEngine(speedRatio);
}
export function playStopEngine() {
  stopEngine();
}

export function playPauseEngine() {
  pauseEngine();
}
export function playResumeEngine() {
  resumeEngine();
}

export function playTypeBlip() {
  typeBlipSfx();
}

let _footstepInterval = null;
export function startFootsteps(intervalMs = 220) {
  stopFootsteps();
  footstepSfx();
  _footstepInterval = setInterval(() => footstepSfx(), intervalMs);
}
export function stopFootsteps() {
  if (_footstepInterval) {
    clearInterval(_footstepInterval);
    _footstepInterval = null;
  }
}

export function playMissileSfx() {
  missileSfx();
}
export function playMineDropSfx() {
  mineDropSfx();
}
export function playSmallExplosionSfx() {
  smallExplosionSfx();
}
export function playEnemyHitSfx() {
  enemyHitSfx();
}

export function duckMusic() {
  audioManager.duck();
}
export function unduckMusic() {
  audioManager.unduck();
}
