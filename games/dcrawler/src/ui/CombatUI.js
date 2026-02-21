import { eventBus, Events } from '../core/EventBus.js';
import { COMBAT } from '../core/Constants.js';
import { uiManager } from './UIManager.js';
import { PLAY_TYPE, CARD_TYPE } from '../combat/CardDefinitions.js';
import { createCardElement } from './CardUI.js';
import { tween, ease, ANIM_DUR } from '../core/Tween.js';
import { audioManager } from '../audio/AudioManager.js';

export class CombatUI {
  constructor(combatState) {
    this.combat = combatState;
    this._panel = null;
    this._previewActive = false;
    this._injectStyles();
  }

  _injectStyles() {
    if (document.getElementById('combat-styles')) return;
    const style = document.createElement('style');
    style.id = 'combat-styles';
    style.textContent = `
      @font-face {
        font-family: 'Kong';
        src: url('/fonts/kong.ttf') format('truetype');
      }
      #combat-panel {
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 76px;
        display: flex; flex-direction: column;
        pointer-events: none;
        font-family: 'Kong', 'Courier New', monospace;
      }
      #combat-panel * { pointer-events: auto; }

      /* ==== TOP: ENEMY STATS ==== */
      .enemy-stats-bar {
        padding: 8px 16px 6px;
        display: flex; flex-direction: column; gap: 0px;
        align-items: center;
        background: linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.0) 100%);
      }
      /* HP bar row */
      .enemy-bars {
        display: flex; flex-direction: column; gap: 2px; width: 240px;
        padding: 5px 10px 4px;
        border-image-source: url('/images/ui/frames/frame-blackwhite.png');
        border-image-slice: 14 fill;
        border-image-width: 6px;
        border-style: solid;
        image-rendering: pixelated;
      }
      .enemy-bars .stat-bar-row {
        display: flex; align-items: center; gap: 4px;
      }
      .enemy-bars .stat-bar-icon { font-size: 12px; width: 14px; text-align: center; }
      .enemy-bars .stat-bar-icon.hp { color: #f66; }
      .enemy-bars .stat-bar {
        flex: 1; height: 8px; background: #0a0a0a;
        border-radius: 4px; overflow: hidden;
      }
      .enemy-bars .stat-bar-fill { height: 100%; transition: width 0.3s; border-radius: 4px; }
      .enemy-bars .stat-bar-fill.hp { background: linear-gradient(180deg, #e55, #a22); }
      .enemy-bars .stat-bar-text {
        font-size: 9px; color: #999; width: 50px; text-align: right;
        text-shadow: 1px 1px 1px #000;
      }
      /* Name row with armor/attack flanks */
      .enemy-name-row {
        display: flex; align-items: stretch; justify-content: center;
        width: 240px;
        margin-top: -2px;
      }
      .enemy-stat-box {
        width: 36px;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        border-image-source: url('/images/ui/frames/frame-blackwhite.png');
        border-image-slice: 14 fill;
        border-image-width: 6px;
        border-style: solid;
        image-rendering: pixelated;
      }
      .enemy-stat-box .stat-value {
        font-size: 12px; color: #fff;
        text-shadow: 1px 1px 2px #000;
      }
      .enemy-stat-box .stat-icon {
        font-size: 9px; color: #888;
      }
      .enemy-name-center {
        flex: 1;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        padding: 3px 8px;
        margin: 0 -2px;
        border-image-source: url('/images/ui/frames/frame-blackwhite.png');
        border-image-slice: 14 fill;
        border-image-width: 6px;
        border-style: solid;
        image-rendering: pixelated;
      }
      .enemy-name {
        color: #fff; font-size: 11px;
        text-transform: uppercase; letter-spacing: 1px;
        text-shadow: 1px 1px 2px #000;
      }
      .enemy-traits {
        color: #a88; font-size: 8px;
        text-shadow: 1px 1px 1px #000;
      }
      /* Enemy hand cards row */
      .enemy-hand-row {
        display: flex; gap: 3px; justify-content: center;
        margin-top: 4px; min-height: 20px;
      }
      .enemy-hand-card {
        width: 22px; height: 28px;
        border-image-source: url('/images/ui/buttons/btn_grey_down.png');
        border-image-slice: 16 fill;
        border-image-width: 6px;
        border-style: solid;
        image-rendering: pixelated;
        display: flex; align-items: center; justify-content: center;
      }
      .enemy-hand-card .card-back-icon {
        font-size: 10px; color: #666;
      }
      .enemy-equip {
        display: flex; gap: 4px; justify-content: center;
        min-height: 16px; margin-top: 2px;
      }

      /* ==== MIDDLE: 3D viewport (transparent pass-through) ==== */
      .combat-viewport {
        flex: 1;
        pointer-events: none;
        position: relative;
      }
      .combat-result-overlay {
        position: absolute;
        top: 10%; left: 0; right: 0;
        font-size: 20px; font-weight: bold; color: #da4;
        text-shadow: 2px 2px 4px #000, 0 0 10px rgba(0,0,0,0.8);
        text-align: center; min-height: 28px;
        pointer-events: none;
      }
      .turn-indicator-float {
        position: absolute;
        top: 2%; left: 0; right: 0;
        font-size: 11px; text-transform: uppercase;
        letter-spacing: 2px;
        text-shadow: 1px 1px 3px #000;
        text-align: center;
        pointer-events: none;
      }
      .attack-icons-float {
        position: absolute;
        top: 50%; left: 0; right: 0;
        display: flex; gap: 4px; justify-content: center;
        pointer-events: none;
      }
      .attack-icon {
        font-size: 22px;
        opacity: 0; /* start hidden, tween will animate in */
      }
      .attack-icon.player-atk { color: #48c; }
      .attack-icon.enemy-atk { color: #c44; }

      /* ==== CARD HAND ==== */
      .card-hand-area {
        padding: 6px 12px 4px;
      }
      .hand-cards {
        display: flex; gap: 5px; justify-content: center;
        margin-bottom: 4px;
      }

      /* Active equipment chips on the meter area */
      .active-equip-row {
        display: flex; gap: 3px; justify-content: center; margin-top: 3px;
      }
      .equip-chip {
        padding: 1px 6px; border-radius: 3px;
        font-size: 8px; display: flex; align-items: center; gap: 2px;
      }
      .equip-chip.weapon { background: #3a2510; color: #da4; border: 1px solid #a64; }
      .equip-chip.shield { background: #102030; color: #48c; border: 1px solid #468; }

      /* Damage floaters — animated by tween, not CSS keyframes */
      .damage-number {
        position: absolute; font-size: 26px; font-weight: bold;
        pointer-events: none;
        font-family: 'Kong', monospace;
        text-shadow: 2px 2px 4px #000;
        left: 0; right: 0; text-align: center;
        opacity: 0;
      }
      .damage-number.to-enemy { color: #ff6; top: 20%; }
      .damage-number.to-player { color: #f44; bottom: 30%; }

      /* ==== STATUS EFFECT ICONS ==== */
      .status-icons-row {
        display: flex; gap: 3px; justify-content: center;
        min-height: 18px;
      }
      .status-icon {
        width: 20px; height: 20px;
        display: flex; align-items: center; justify-content: center;
        font-size: 12px;
        border-radius: 3px;
        background: rgba(0,0,0,0.6);
        border: 1px solid rgba(255,255,255,0.15);
        position: relative;
        animation: cardPop 0.2s ease;
      }
      .status-icon .status-stacks {
        position: absolute; bottom: -2px; right: -2px;
        font-size: 7px; color: #fff;
        background: #333; border-radius: 2px;
        padding: 0 2px; line-height: 1.2;
      }
      .status-icon .status-duration {
        position: absolute; top: -2px; right: -2px;
        font-size: 6px; color: #aaa;
        background: rgba(0,0,0,0.8); border-radius: 2px;
        padding: 0 2px; line-height: 1.2;
      }

      @keyframes cardPop {
        0% { transform: scale(0); }
        60% { transform: scale(1.15); }
        100% { transform: scale(1); }
      }
    `;
    document.head.appendChild(style);
  }

  show(enemy, floorMeters) {
    this.floorMeters = floorMeters || null;

    this._panel = uiManager.createPanel('combat-panel', `
      <!-- TOP: Enemy stats -->
      <div class="enemy-stats-bar">
        <div class="enemy-bars">
          <div class="stat-bar-row">
            <span class="stat-bar-icon hp">\u2764</span>
            <div class="stat-bar"><div class="stat-bar-fill hp enemy-hp-fill" style="width:100%"></div></div>
            <span class="stat-bar-text enemy-hp-text">${enemy.hp}/${enemy.maxHp}</span>
          </div>
        </div>
        <div class="enemy-name-row">
          <div class="enemy-stat-box">
            <span class="stat-value">${enemy.defense}</span>
            <span class="stat-icon">\u26E8</span>
          </div>
          <div class="enemy-name-center">
            <span class="enemy-name">${enemy.name}</span>
            ${enemy.traits && enemy.traits.length > 0
              ? `<span class="enemy-traits">${enemy.traits.map(t => t.name).join(', ')}</span>`
              : ''}
          </div>
          <div class="enemy-stat-box">
            <span class="stat-value">${enemy.attack}</span>
            <span class="stat-icon">\u2694</span>
          </div>
        </div>
        <div class="status-icons-row enemy-status-icons"></div>
        <div class="enemy-hand-row"></div>
        <div class="enemy-equip enemy-active-cards"></div>
      </div>

      <!-- MIDDLE: 3D viewport pass-through -->
      <div class="combat-viewport">
        <div class="turn-indicator-float" style="color:#48c">Your turn</div>
        <div class="combat-result-overlay"></div>
        <div class="attack-icons-float"></div>
      </div>

      <!-- CARD HAND -->
      <div class="card-hand-area">
        <div class="status-icons-row player-status-icons"></div>
        <div class="hand-cards"></div>
        <div class="active-equip-row player-active-cards"></div>
      </div>
    `);

    this._bindEvents();
    this._updateHandCards();
    this._updateEnemyHand();
    this._updateButtons();
    this._updatePlayerStats();
  }

  _bindEvents() {
    this._listeners = [
      [Events.COMBAT_DRAW_CARD, (d) => this._onDrawCard(d)],
      [Events.COMBAT_STAND, (d) => this._onStand(d)],
      [Events.COMBAT_BUST, (d) => this._onBust(d)],
      [Events.COMBAT_RESOLVE, (d) => this._onResolve(d)],
      [Events.COMBAT_ATTACK, (d) => this._onAttack(d)],
      [Events.COMBAT_NEW_ROUND, (d) => this._onNewRound(d)],
      [Events.COMBAT_PLAYER_TURN, () => this._onPlayerTurn()],
      [Events.COMBAT_ENEMY_TURN, () => this._onEnemyTurn()],
      [Events.COMBAT_END, (d) => this._onCombatEnd(d)],
      [Events.HAND_CARD_PLAY, (d) => this._onHandCardPlay(d)],
      [Events.UI_UPDATE_HP, (d) => this._onUpdateHP(d)],
      [Events.UI_UPDATE_ENERGY, () => this._updatePlayerStats()],
      ['combat:equipCard', (d) => this._onEquipCard(d)],
      ['combat:weaponApplied', (d) => this._onWeaponApplied(d)],
      ['combat:shieldApplied', (d) => this._onShieldApplied(d)],
      ['combat:allBlocked', () => this._onAllBlocked()],
      ['combat:spellCast', (d) => this._onSpellCast(d)],
      ['combat:potionUsed', (d) => this._onPotionUsed(d)],
      ['combat:statusUpdate', (d) => this._onStatusUpdate(d)],
      ['combat:statusApplied', (d) => this._onStatusApplied(d)],
    ];
    this._listeners.forEach(([e, fn]) => eventBus.on(e, fn));
  }

  _onDrawCard({ target, value, meter }) {
    const maxSteps = target === 'player' ? this.combat.playerMaxSteps : this.combat.enemyMaxSteps;
    const busted = meter > maxSteps;

    // Update 3D floor meters
    if (this.floorMeters) {
      this.floorMeters.addCard(target, value);
      this.floorMeters.updateMeter(target, meter, busted);
    }

    this._updateDeckCount();
    this._updateButtons();
  }

  _onStand({ target, meter }) {
    if (this.floorMeters) this.floorMeters.setStood(target);
    this._updateButtons();
  }

  _onBust({ target, meter }) {
    // Already handled by updateMeter with busted=true
  }

  _onPlayerTurn() {
    const ti = this._panel.querySelector('.turn-indicator-float');
    if (ti) {
      ti.textContent = 'Your turn';
      ti.style.color = '#5af';
      tween(ti).clear()
        .to({ scale: 0.8, opacity: 0 }, 0)
        .to({ scale: 1.1, opacity: 1 }, 150, ease.easeOut)
        .to({ scale: 1 }, 100, ease.easeOutBack);
    }
    this._updateButtons();
    this._updateHandCards();
  }

  _onEnemyTurn() {
    const ti = this._panel.querySelector('.turn-indicator-float');
    if (ti) {
      ti.textContent = 'Enemy turn';
      ti.style.color = '#f66';
      tween(ti).clear()
        .to({ scale: 0.8, opacity: 0 }, 0)
        .to({ scale: 1.1, opacity: 1 }, 150, ease.easeOut)
        .to({ scale: 1 }, 100, ease.easeOutBack);
    }
    this._updateButtons();
  }

  _onResolve({ result }) {
    const resultEl = this._panel.querySelector('.combat-result-overlay');
    const iconsEl = this._panel.querySelector('.attack-icons-float');
    if (!resultEl) return;

    if (result.winner === 'draw' || result.winner === 'tie') {
      resultEl.textContent = result.winner === 'draw' ? 'DRAW!' : 'TIE!';
      resultEl.style.color = '#888';
      // Pulse the text
      this._tweenResultText(resultEl);
    } else {
      const isPlayer = result.winner === 'player';
      const label = result.isSuperAttack ? 'SUPER ATTACK!' : `${result.attacks} attacks!`;
      resultEl.textContent = label;
      resultEl.style.color = isPlayer ? '#5f5' : '#f55';
      this._tweenResultText(resultEl);
      this._showAttackIcons(iconsEl, result.attacks, isPlayer ? 'player-atk' : 'enemy-atk');
    }
    this._disableButtons();
  }

  /** Animate result text: scale up with bounce, then settle */
  _tweenResultText(el) {
    tween(el).clear()
      .to({ scale: 1.4, opacity: 1 }, 150, ease.easeOut)
      .to({ scale: 1 }, 200, ease.easeOutBack);
  }

  /** Result text with bounce then auto-fade after delay */
  _tweenResultTextThenFade(el) {
    tween(el).clear()
      .to({ scale: 1.4, opacity: 1 }, 150, ease.easeOut)
      .to({ scale: 1 }, 200, ease.easeOutBack)
      .wait(600)
      .to({ opacity: 0 }, 200, ease.easeIn)
      .call(() => { el.textContent = ''; });
  }

  /** Spawn attack sword icons one by one with staggered bounce-in */
  _showAttackIcons(container, count, className) {
    if (!container) return;
    container.innerHTML = '';
    const capped = Math.min(count, 15);

    for (let i = 0; i < capped; i++) {
      const icon = document.createElement('span');
      icon.className = `attack-icon ${className}`;
      icon.textContent = '\u2694';
      container.appendChild(icon);

      // Staggered bounce-in: each icon pops in after a delay
      tween(icon).clear()
        .wait(i * 60)
        .to({ scale: 0, opacity: 0 }, 0) // start state (instant)
        .to({ scale: 1.3, opacity: 1 }, 120, ease.easeOut)
        .to({ scale: 1 }, 100, ease.easeOutBack);
    }
  }

  _onWeaponApplied({ card, attacks, added, winner }) {
    const iconsEl = this._panel.querySelector('.attack-icons-float');
    const className = winner === 'player' ? 'player-atk' : 'enemy-atk';

    for (let i = 0; i < added; i++) {
      const icon = document.createElement('span');
      icon.className = `attack-icon ${className}`;
      icon.textContent = '\u2694';
      iconsEl.appendChild(icon);

      // Bounce-in with stagger
      tween(icon).clear()
        .wait(i * 80)
        .to({ scale: 0, opacity: 0 }, 0)
        .to({ scale: 1.4, opacity: 1 }, 120, ease.easeOut)
        .to({ scale: 1 }, 100, ease.easeOutBack);
    }

    const resultEl = this._panel.querySelector('.combat-result-overlay');
    if (resultEl) {
      resultEl.textContent = `${card.symbol} ${card.name} +${added}`;
      this._tweenResultText(resultEl);
    }
  }

  _onShieldApplied({ card, attacks, blocked }) {
    const iconsEl = this._panel.querySelector('.attack-icons-float');

    // Animate each blocked icon out before removing
    for (let i = 0; i < blocked; i++) {
      const icon = iconsEl.lastChild;
      if (!icon) break;
      // Detach from flow immediately to prevent layout shift
      iconsEl.removeChild(icon);

      // Re-add temporarily for swoosh-out animation
      iconsEl.appendChild(icon);
      tween(icon).clear()
        .wait(i * 80)
        .to({ scale: 1.2 }, 60, ease.easeOut)
        .to({ scale: 0, opacity: 0, y: -20 }, 150, ease.easeIn)
        .call(() => icon.remove());
    }

    const resultEl = this._panel.querySelector('.combat-result-overlay');
    if (resultEl) {
      resultEl.textContent = `${card.symbol} ${card.name} blocked ${blocked}`;
      resultEl.style.color = '#5af';
      this._tweenResultText(resultEl);
    }
  }

  _onAllBlocked() {
    const resultEl = this._panel.querySelector('.combat-result-overlay');
    if (resultEl) {
      resultEl.textContent = 'ALL BLOCKED!';
      resultEl.style.color = '#5af';
      this._tweenResultText(resultEl);
    }
  }

  _onAttack({ attacker, damage, critical, superAttack }) {
    const iconsEl = this._panel.querySelector('.attack-icons-float');
    const icon = iconsEl?.firstChild;

    if (icon) {
      // Swoosh the icon toward the target before removing
      const targetY = attacker === 'player' ? -40 : 40;
      tween(icon).clear()
        .to({ scale: 1.3 }, 50, ease.easeOut)
        .to({ scale: 0, opacity: 0, y: targetY }, 120, ease.easeIn)
        .call(() => icon.remove());
    }

    this._spawnDamageNumber(damage, attacker === 'player' ? 'to-enemy' : 'to-player', critical || superAttack);
  }

  _onNewRound({ round }) {
    const resultEl = this._panel.querySelector('.combat-result-overlay');
    if (resultEl) {
      // Clear tween and reset
      tween(resultEl).clear().to({ opacity: 0 }, 150, ease.easeIn).call(() => {
        resultEl.textContent = '';
      });
    }
    const iconsEl = this._panel.querySelector('.attack-icons-float');
    if (iconsEl) iconsEl.innerHTML = '';

    // Update 3D floor meters
    if (this.floorMeters) this.floorMeters.newRound(round);

    const pac = this._panel.querySelector('.player-active-cards');
    if (pac) pac.innerHTML = '';
    const eac = this._panel.querySelector('.enemy-active-cards');
    if (eac) eac.innerHTML = '';

    this._updateHandCards();
    this._updateEnemyHand();
    this._updateDeckCount();
    this._updateButtons();
    this._updatePlayerStats();
  }

  _onCombatEnd({ result }) {
    const resultEl = this._panel.querySelector('.combat-result-overlay');
    if (resultEl) {
      resultEl.textContent = result === 'victory' ? 'VICTORY!' : 'DEFEAT...';
      resultEl.style.color = result === 'victory' ? '#5f5' : '#f55';
      resultEl.style.fontSize = '28px';

      // Dramatic scale-in with elastic overshoot
      tween(resultEl).clear()
        .to({ scale: 0, opacity: 0 }, 0)
        .to({ scale: 1.2, opacity: 1 }, 300, ease.easeOutElastic)
        .to({ scale: 1 }, 200, ease.easeOut);
    }

    // Clear attack icons
    const iconsEl = this._panel.querySelector('.attack-icons-float');
    if (iconsEl) iconsEl.innerHTML = '';

    this._disableButtons();
    if (this.floorMeters) this.floorMeters.hide();
    setTimeout(() => this.hide(), 500);
  }

  _onUpdateHP({ target, hp, maxHp }) {
    if (target === 'enemy') {
      const fill = this._panel?.querySelector('.enemy-hp-fill');
      const text = this._panel?.querySelector('.enemy-hp-text');
      if (fill) fill.style.width = `${(hp / maxHp) * 100}%`;
      if (text) text.textContent = `${hp}/${maxHp}`;
    }
    // Player HP is always updated via persistent bar
    this._updatePlayerStats();
  }

  _onHandCardPlay({ target }) {
    if (target === 'player') this._updateHandCards();
  }

  _onEquipCard({ card, target }) {
    const container = this._panel.querySelector(
      target === 'player' ? '.player-active-cards' : '.enemy-active-cards'
    );
    if (!container) return;
    const chip = document.createElement('div');
    chip.className = `equip-chip ${card.type}`;
    chip.textContent = `${card.symbol} ${card.name}`;
    container.appendChild(chip);

    // Bounce-in for equip chip
    tween(chip).clear()
      .to({ scale: 0, opacity: 0 }, 0)
      .to({ scale: 1.15, opacity: 1 }, 120, ease.easeOut)
      .to({ scale: 1 }, 100, ease.easeOutBack);

    if (target === 'player') this._updateHandCards();
    if (target === 'enemy') this._updateEnemyHand();
  }

  _onSpellCast({ card, damage }) {
    this._spawnDamageNumber(damage, 'to-enemy');
    const resultEl = this._panel?.querySelector('.combat-result-overlay');
    if (resultEl) {
      resultEl.textContent = `${card.symbol} ${card.name}!`;
      resultEl.style.color = '#a4a';
      this._tweenResultTextThenFade(resultEl);
    }
  }

  _onPotionUsed({ card }) {
    const resultEl = this._panel?.querySelector('.combat-result-overlay');
    if (resultEl) {
      resultEl.textContent = `${card.symbol} ${card.name}!`;
      resultEl.style.color = '#4a4';
      this._tweenResultTextThenFade(resultEl);
    }
  }

  // ---- STATUS EFFECTS ----

  _onStatusUpdate({ player, enemy }) {
    this._renderStatusIcons('.enemy-status-icons', enemy);
    this._renderStatusIcons('.player-status-icons', player);
  }

  _onStatusApplied({ target, status, message }) {
    const resultEl = this._panel?.querySelector('.combat-result-overlay');
    if (resultEl && message) {
      resultEl.textContent = message;
      resultEl.style.color = '#e8e';
      this._tweenResultTextThenFade(resultEl);
    }
  }

  _renderStatusIcons(selector, effects) {
    const container = this._panel?.querySelector(selector);
    if (!container) return;
    container.innerHTML = '';

    for (const effect of effects) {
      const el = document.createElement('div');
      el.className = 'status-icon';
      el.style.borderColor = effect.color;
      el.title = `${effect.name} (${effect.remaining} rounds)`;
      el.innerHTML = effect.icon;

      if (effect.stacks > 1) {
        el.innerHTML += `<span class="status-stacks">x${effect.stacks}</span>`;
      }
      if (effect.remaining < 99) {
        el.innerHTML += `<span class="status-duration">${effect.remaining}</span>`;
      }
      container.appendChild(el);
    }
  }

  // ---- ENEMY HAND CARDS (face-down) ----

  _updateEnemyHand() {
    const container = this._panel?.querySelector('.enemy-hand-row');
    if (!container) return;
    container.innerHTML = '';

    const enemyCards = this.combat.enemyHand.getHand();
    for (let i = 0; i < enemyCards.length; i++) {
      const card = enemyCards[i];
      const el = document.createElement('div');
      el.className = 'enemy-hand-card';
      // Show card type icon face-down (hint at what the enemy has)
      const icon = card.type === 'weapon' ? '\u2694'
        : card.type === 'shield' ? '\u26E8'
        : card.type === 'spell' ? '\uD83D\uDD25'
        : card.type === 'potion' ? '\u2764'
        : card.type === 'ability' ? '\u26A1'
        : '?';
      el.innerHTML = `<span class="card-back-icon">${icon}</span>`;
      container.appendChild(el);
    }
  }

  // ---- HAND CARDS ----

  _updateHandCards() {
    if (this._previewActive) return;

    const container = this._panel?.querySelector('.hand-cards');
    if (!container) return;
    container.innerHTML = '';

    const cards = this.combat.playerHand.getHand();
    cards.forEach((card, i) => {
      const canPlay = this.combat.playerHand.canPlay(i, this.combat.player.energy) && this.combat.canPlayerAct;
      const el = createCardElement(card, 'sm', { disabled: !canPlay });
      el._cardData = card;
      el._cardIndex = i;

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this._showCardPreview(el, card, i, canPlay);
      });
      container.appendChild(el);
    });
  }

  // ---- CARD PREVIEW / PLAY SYSTEM ----
  // The hand card element itself transitions to become the preview.
  // sm → lift out of flow → tween to center as lg → USE button below.

  _showCardPreview(cardEl, card, index, canPlay = true) {
    if (this._previewActive) return;
    this._previewActive = true;

    // Snapshot hand position relative to panel
    const cardRect = cardEl.getBoundingClientRect();
    const panelRect = this._panel.getBoundingClientRect();
    const startX = cardRect.left - panelRect.left;
    const startY = cardRect.top - panelRect.top;
    const startW = cardRect.width;
    const startH = cardRect.height;

    // Create a placeholder to keep hand layout stable
    const placeholder = document.createElement('div');
    placeholder.style.width = `${startW}px`;
    placeholder.style.height = `${startH}px`;
    placeholder.style.opacity = '0.15';
    placeholder.style.flexShrink = '0';
    cardEl.parentNode.insertBefore(placeholder, cardEl);

    // Pull card out of flow into absolute positioning at same spot
    cardEl.style.position = 'absolute';
    cardEl.style.left = `${startX}px`;
    cardEl.style.top = `${startY}px`;
    cardEl.style.width = `${startW}px`;
    cardEl.style.zIndex = '100';
    cardEl.style.transition = 'none';
    this._panel.appendChild(cardEl);

    // Create dark backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'card-preview-backdrop';
    this._panel.appendChild(backdrop);

    // Bring card above backdrop
    cardEl.style.zIndex = '100';

    // Create USE button (only if card is playable)
    let useBtn = null;
    if (canPlay) {
      useBtn = document.createElement('button');
      useBtn.className = 'bevel-btn card-preview-use-btn';
      useBtn.textContent = 'USE';
      this._panel.appendChild(useBtn);
    }

    // Target: center of panel, bigger
    const targetW = 200;
    // Estimate card height: symbol(155) + name(20) + desc(18) + padding(54) + border ≈ 260
    const estCardH = 260;
    const targetX = (panelRect.width - targetW) / 2;
    const targetY = (panelRect.height - estCardH) / 2 * 0.75;
    const btnY = targetY + estCardH + 16;

    // Swap to large class for CSS-driven content sizing
    cardEl.classList.remove('card-sm');
    cardEl.classList.add('card-lg');
    cardEl.style.width = `${targetW}px`;

    // Tween position from hand spot to center
    // We use left/top directly since the card is position:absolute
    tween(cardEl).clear()
      .to({ x: targetX - startX, y: targetY - startY }, 250, ease.easeOutBack);

    // Backdrop fades in
    tween(backdrop).clear()
      .to({ opacity: 0 }, 0)
      .to({ opacity: 1 }, 200, ease.easeOut);

    // USE button slides up from below card
    if (useBtn) {
      useBtn.style.top = `${btnY}px`;
      tween(useBtn).clear()
        .wait(100)
        .to({ opacity: 0, y: 30 }, 0)
        .to({ opacity: 1, y: 0 }, 200, ease.easeOut);

      useBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._playPreviewCard();
      });
    }

    // Store refs for cleanup
    this._preview = { cardEl, card, index, backdrop, useBtn, placeholder, startX, startY, startW };

    // Backdrop tap — cancel
    backdrop.addEventListener('click', () => {
      this._cancelPreview();
    });
  }

  _playPreviewCard() {
    if (!this._previewActive || !this._preview) return;
    const { cardEl, card, index, backdrop, useBtn, placeholder } = this._preview;

    // Play the card through combat system
    audioManager.sfxCardPlay();
    const played = this.combat.playerPlayCard(index);
    if (!played) {
      this._cancelPreview();
      return;
    }

    // Hide USE button (slide down and fade)
    if (useBtn) {
      tween(useBtn).clear()
        .to({ opacity: 0, y: 30 }, 150, ease.easeIn)
        .call(() => useBtn.remove());
    }

    // Fade backdrop
    tween(backdrop).clear()
      .to({ opacity: 0 }, 200, ease.easeIn)
      .call(() => backdrop.remove());

    // Remove placeholder
    placeholder.remove();

    // Animate card based on type
    const onDone = () => {
      cardEl.remove();
      this._preview = null;
      this._previewActive = false;
      this._updateHandCards();
    };

    if (card.playType === 'offensive' || card.playType === 'defensive') {
      // Equipment: shrink and fly to equip row
      const equipRow = this._panel.querySelector('.player-active-cards');
      if (equipRow) {
        const equipRect = equipRow.getBoundingClientRect();
        const panelRect = this._panel.getBoundingClientRect();
        const eqX = equipRect.left - panelRect.left + equipRect.width / 2 - 80;
        const eqY = equipRect.top - panelRect.top;
        const curX = parseFloat(cardEl.style.left);
        const curY = parseFloat(cardEl.style.top);

        tween(cardEl).clear()
          .to({ scale: 0.3, x: eqX - curX, y: eqY - curY }, 250, ease.easeInOut)
          .to({ scale: 0, opacity: 0 }, 100, ease.easeIn)
          .call(onDone);
      } else {
        tween(cardEl).clear()
          .to({ scale: 0, opacity: 0 }, 150, ease.easeIn)
          .call(onDone);
      }
    } else if (card.playType === 'instant') {
      // Spells/potions/abilities: fly upward
      const isOffensive = card.type === 'spell' || card.type === 'ability';
      tween(cardEl).clear()
        .to({ scale: 1.1 }, 80, ease.easeOut)
        .to({ scale: 0.2, opacity: 0, y: isOffensive ? -200 : -50 }, 200, ease.easeIn)
        .call(onDone);
    } else {
      // Modifiers: shrink down into gauge
      tween(cardEl).clear()
        .to({ scale: 1.1 }, 80, ease.easeOut)
        .to({ scale: 0, opacity: 0, y: -100 }, 200, ease.easeIn)
        .call(onDone);
    }
  }

  _cancelPreview() {
    if (!this._previewActive || !this._preview) return;
    const { cardEl, backdrop, useBtn, placeholder, startX, startY, startW } = this._preview;

    // Swap back to small class
    cardEl.classList.remove('card-lg');
    cardEl.classList.add('card-sm');
    cardEl.style.width = `${startW}px`;

    // Tween back to hand position
    tween(cardEl).clear()
      .to({ x: 0, y: 0, scale: 1 }, 200, ease.easeInOut)
      .call(() => {
        // Return card to hand flow
        cardEl.style.position = '';
        cardEl.style.left = '';
        cardEl.style.top = '';
        cardEl.style.width = '';
        cardEl.style.zIndex = '';
        cardEl.style.transition = '';
        // Clear tween transform
        delete cardEl._tweenTransform;
        cardEl.style.transform = '';
        placeholder.replaceWith(cardEl);
        this._preview = null;
        this._previewActive = false;
      });

    // Fade out USE button
    if (useBtn) {
      tween(useBtn).clear()
        .to({ opacity: 0, y: 30 }, 150, ease.easeIn)
        .call(() => useBtn.remove());
    }

    // Fade out backdrop
    tween(backdrop).clear()
      .wait(50)
      .to({ opacity: 0 }, 200, ease.easeOut)
      .call(() => backdrop.remove());
  }

  _updateDeckCount() {
    const count = document.querySelector('.deck-count');
    if (count) count.textContent = this.combat.playerDeck.remaining;
  }

  _updatePlayerStats() {
    const p = this.combat.player;
    const hpFill = document.querySelector('.player-hp-fill');
    const hpText = document.querySelector('.player-hp-text');
    const epFill = document.querySelector('.player-ep-fill');
    const epText = document.querySelector('.player-ep-text');
    if (hpFill) hpFill.style.width = `${(p.hp / p.maxHp) * 100}%`;
    if (hpText) hpText.textContent = `${p.hp}/${p.maxHp}`;
    if (epFill) epFill.style.width = `${(p.energy / p.maxEnergy) * 100}%`;
    if (epText) epText.textContent = `${p.energy}/${p.maxEnergy}`;
  }

  _updateButtons() {
    const canAct = this.combat.isPlayerTurn;
    const drawBtn = document.querySelector('.draw-btn');
    const standBtn = document.querySelector('.stand-btn');
    if (drawBtn) drawBtn.disabled = !canAct;
    if (standBtn) standBtn.disabled = !canAct;
  }

  _disableButtons() {
    const drawBtn = document.querySelector('.draw-btn');
    const standBtn = document.querySelector('.stand-btn');
    if (drawBtn) drawBtn.disabled = true;
    if (standBtn) standBtn.disabled = true;
  }

  _spawnDamageNumber(damage, className, isCritical = false) {
    const el = document.createElement('div');
    el.className = `damage-number ${className}`;
    el.textContent = isCritical ? `-${damage}!` : `-${damage}`;
    if (isCritical) {
      el.style.fontSize = '34px';
      el.style.color = className === 'to-enemy' ? '#ff0' : '#f22';
    }
    const viewport = this._panel.querySelector('.combat-viewport');
    (viewport || this._panel).appendChild(el);

    // Three-phase tween: pop in → hold → float up + fade out
    const popEase = isCritical ? ease.easeOutElastic : ease.easeOutBack;
    tween(el).clear()
      // Phase 1: Pop in with overshoot
      .to({ scale: 0, opacity: 0 }, 0)
      .to({ scale: isCritical ? 1.4 : 1.1, opacity: 1 }, 150, popEase)
      // Phase 2: Brief hold at full size
      .to({ scale: 1 }, 100, ease.easeOut)
      .wait(200)
      // Phase 3: Float up and fade out
      .to({ y: -60, opacity: 0, scale: 1.3 }, 400, ease.easeInOut)
      .call(() => el.remove());
  }

  hide() {
    this._previewActive = false;
    if (this._listeners) {
      this._listeners.forEach(([e, fn]) => eventBus.off(e, fn));
      this._listeners = null;
    }
    uiManager.removePanel('combat-panel');
    this._panel = null;
  }
}
