import { uiManager } from './UIManager.js';
import { createCardHTML } from './CardUI.js';
import { tween, ease } from '../core/Tween.js';
import { audioManager } from '../audio/AudioManager.js';

export class LootUI {
  constructor() {
    this._injectStyles();
  }

  _injectStyles() {
    if (document.getElementById('loot-styles')) return;
    const style = document.createElement('style');
    style.id = 'loot-styles';
    style.textContent = `
      .loot-overlay {
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        display: flex; align-items: center; justify-content: center;
        pointer-events: none;
        animation: lootFadeIn 0.3s ease;
      }
      .loot-card-reveal {
        display: flex; flex-direction: column; align-items: center;
        gap: 12px;
        pointer-events: auto;
      }
      .loot-label {
        font-family: 'Kong', 'Courier New', monospace;
        font-size: 14px; color: #da4;
        text-shadow: 2px 2px 4px #000;
        text-transform: uppercase; letter-spacing: 2px;
      }
      .loot-xp-gold {
        font-family: 'Kong', monospace;
        font-size: 11px; color: #aaa;
        text-shadow: 1px 1px 2px #000;
      }
      /* loot-add-btn inherits from .bevel-btn (shared-ui-styles) */
      /* Coin reward display */
      .loot-coins {
        font-size: 48px;
        animation: lootCardPop 0.4s ease;
        filter: drop-shadow(0 0 16px rgba(218,170,68,0.4));
      }
      .loot-coin-amount {
        font-family: 'Kong', monospace;
        font-size: 22px; color: #da4;
        text-shadow: 2px 2px 4px #000;
      }
      /* Flying coin animation */
      .flying-coin {
        position: fixed;
        font-size: 16px;
        pointer-events: none;
        z-index: 9999;
        animation: coinFly var(--fly-duration) ease-in forwards;
      }
      @keyframes lootFadeIn {
        0% { opacity: 0; }
        100% { opacity: 1; }
      }
      @keyframes lootCardPop {
        0% { transform: scale(0) rotate(-10deg); opacity: 0; }
        60% { transform: scale(1.1) rotate(2deg); }
        100% { transform: scale(1) rotate(0); opacity: 1; }
      }
      @keyframes coinFly {
        0% { opacity: 1; transform: scale(1); }
        80% { opacity: 1; }
        100% { opacity: 0; transform: scale(0.5); }
      }
    `;
    document.head.appendChild(style);
  }

  showReward(card, xp, gold, leveledUp, onContinue) {
    const lvlText = leveledUp ? ' <span style="color:#5f5">LEVEL UP!</span>' : '';
    const cardHTML = createCardHTML(card, 'lg');

    const panel = uiManager.createPanel('loot-panel', `
      <div class="loot-overlay">
        <div class="loot-card-reveal">
          <div class="loot-label">New Card!</div>
          ${cardHTML}
          <div class="loot-xp-gold">+${xp} XP &nbsp; +${gold} Gold${lvlText}</div>
          <button class="bevel-btn">Add to deck</button>
        </div>
      </div>
    `);

    panel.querySelector('.bevel-btn').addEventListener('click', () => {
      audioManager.sfxCardAdd();
      const cardEl = panel.querySelector('.game-card');
      const btn = panel.querySelector('.bevel-btn');
      // Animate card shrinking down and fading
      tween(cardEl).clear()
        .to({ scale: 1.05 }, 80, ease.easeOut)
        .to({ scale: 0, opacity: 0, y: 60 }, 250, ease.easeIn);
      // Fade out button and label
      tween(btn).clear()
        .to({ opacity: 0 }, 150, ease.easeIn);
      const label = panel.querySelector('.loot-label');
      if (label) tween(label).clear().to({ opacity: 0 }, 150, ease.easeIn);
      const xpGold = panel.querySelector('.loot-xp-gold');
      if (xpGold) tween(xpGold).clear().to({ opacity: 0 }, 150, ease.easeIn);

      setTimeout(() => {
        this.hide();
        onContinue?.();
      }, 350);
    });
  }

  showCoinReward(coinAmount, xp, gold, leveledUp, onContinue) {
    const lvlText = leveledUp ? ' <span style="color:#5f5">LEVEL UP!</span>' : '';

    const panel = uiManager.createPanel('loot-panel', `
      <div class="loot-overlay">
        <div class="loot-card-reveal">
          <div class="loot-label">Coins!</div>
          <div class="loot-coins">\uD83D\uDCB0</div>
          <div class="loot-coin-amount">+${coinAmount}g</div>
          <div class="loot-xp-gold">+${xp} XP &nbsp; +${gold} Gold${lvlText}</div>
          <button class="bevel-btn">Collect</button>
        </div>
      </div>
    `);

    panel.querySelector('.bevel-btn').addEventListener('click', () => {
      // Find the gold label target in HUD
      const goldLabel = document.querySelector('.gold-label');
      const bagEl = panel.querySelector('.loot-coins');

      if (goldLabel && bagEl) {
        const bagRect = bagEl.getBoundingClientRect();
        const targetRect = goldLabel.getBoundingClientRect();
        this._spawnFlyingCoins(bagRect, targetRect, 8);
      }

      this.hide();
      onContinue?.();
    });
  }

  _spawnFlyingCoins(fromRect, toRect, count) {
    const startX = fromRect.left + fromRect.width / 2;
    const startY = fromRect.top + fromRect.height / 2;
    const endX = toRect.left + toRect.width / 2;
    const endY = toRect.top + toRect.height / 2;

    for (let i = 0; i < count; i++) {
      const coin = document.createElement('div');
      coin.className = 'flying-coin';
      coin.textContent = '\uD83E\uDE99';

      // Randomize start position slightly
      const ox = (Math.random() - 0.5) * 40;
      const oy = (Math.random() - 0.5) * 40;
      const duration = 400 + Math.random() * 300;
      const delay = i * 60;

      coin.style.setProperty('--fly-duration', `${duration}ms`);
      coin.style.left = `${startX + ox}px`;
      coin.style.top = `${startY + oy}px`;

      document.body.appendChild(coin);

      // Animate position with JS (CSS animation handles opacity/scale)
      setTimeout(() => {
        coin.style.transition = `left ${duration}ms ease-in, top ${duration}ms ease-in`;
        coin.style.left = `${endX}px`;
        coin.style.top = `${endY}px`;
      }, 10);

      setTimeout(() => coin.remove(), delay + duration + 50);

      // Apply delay
      if (delay > 0) {
        coin.style.opacity = '0';
        setTimeout(() => { coin.style.opacity = ''; }, delay);
        // Re-trigger animation
        setTimeout(() => {
          coin.style.left = `${startX + ox}px`;
          coin.style.top = `${startY + oy}px`;
          // Force reflow
          void coin.offsetWidth;
          coin.style.transition = `left ${duration}ms ease-in, top ${duration}ms ease-in`;
          coin.style.left = `${endX}px`;
          coin.style.top = `${endY}px`;
        }, delay);
      }
    }
  }

  hide() {
    uiManager.removePanel('loot-panel');
  }
}
