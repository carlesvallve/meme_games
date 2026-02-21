import { eventBus, Events } from '../core/EventBus.js';
import { uiManager } from './UIManager.js';

export class HUD {
  constructor(player, dungeonMap, combatState) {
    this.player = player;
    this.map = dungeonMap;
    this.combat = combatState;
    this.minimapVisible = false;
    this._inCombat = false;
    this._createHUD();
    this._bindEvents();
  }

  _createHUD() {
    uiManager.createPanel('hud', `
      <div class="hud-info-bar">
        <span class="floor-label">F1</span>
        <span class="gold-label">0g</span>
      </div>
      <canvas id="minimap" width="120" height="120"></canvas>

      <!-- PERSISTENT BOTTOM BAR -->
      <div class="player-bar">
        <button class="player-deck-btn draw-btn" disabled>
          <span class="deck-count"></span>
          <span class="deck-label"></span>
        </button>
        <div class="player-stats-col">
          <div class="stat-bar-row">
            <span class="stat-bar-icon hp">\u2764</span>
            <div class="stat-bar"><div class="stat-bar-fill hp player-hp-fill" style="width:100%"></div></div>
            <span class="stat-bar-text player-hp-text"></span>
          </div>
          <div class="stat-bar-row">
            <span class="stat-bar-icon ep">\u26A1</span>
            <div class="stat-bar"><div class="stat-bar-fill ep player-ep-fill" style="width:0%"></div></div>
            <span class="stat-bar-text player-ep-text"></span>
          </div>
        </div>
        <button class="player-stand-btn stand-btn" disabled>
          <span class="stand-icon"></span>
          <span class="stand-label"></span>
        </button>
      </div>
    `, {
      position: 'absolute',
      top: '0', left: '0', right: '0', bottom: '0',
      pointerEvents: 'none',
    });

    this._injectStyles();
    this._updatePlayerStats();
    this._setExploreMode();
  }

  _injectStyles() {
    if (document.getElementById('hud-styles')) return;
    const style = document.createElement('style');
    style.id = 'hud-styles';
    style.textContent = `
      .hud-info-bar {
        position: absolute;
        top: 10px; left: 12px;
        display: flex; gap: 12px;
        pointer-events: none;
      }
      .floor-label, .gold-label {
        color: #da4;
        font-size: 12px;
        font-family: 'Kong', 'Courier New', monospace;
        text-shadow: 1px 1px 3px #000;
      }
      #minimap {
        position: absolute;
        top: 12px; right: 12px;
        border: 1px solid #444;
        background: rgba(0,0,0,0.7);
        image-rendering: pixelated;
        display: none;
        pointer-events: auto;
        cursor: pointer;
      }
      #minimap.visible { display: block; }

      /* ==== 9-SLICE HELPER ==== */
      .nine-slice {
        border-style: solid;
        border-color: transparent;
        image-rendering: pixelated;
        -webkit-image-rendering: pixelated;
      }

      /* ==== PERSISTENT BOTTOM BAR ==== */
      .player-bar {
        position: absolute;
        bottom: 0; left: 0; right: 0;
        padding: 6px 10px 10px;
        display: flex; align-items: center; gap: 8px;
        pointer-events: auto;
        font-family: 'Kong', 'Courier New', monospace;
        background: linear-gradient(0deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.0) 100%);
      }
      .player-deck-btn {
        width: 48px; height: 56px;
        background: transparent;
        border-image-source: url('/images/ui/buttons/btn_blue.png');
        border-image-slice: 16 fill;
        border-image-width: 8px;
        border-style: solid;
        image-rendering: pixelated;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        padding: 0 0 2px;
        cursor: pointer; transition: all 0.15s;
        font-family: 'Kong', monospace;
      }
      .player-deck-btn:hover:not(:disabled):not(.idle) {
        transform: scale(1.05);
        filter: brightness(1.2);
      }
      .player-deck-btn:active:not(:disabled):not(.idle) {
        border-image-source: url('/images/ui/buttons/btn_blue_down.png');
        transform: scale(0.97);
      }
      .player-deck-btn:disabled:not(.idle) { opacity: 0.35; cursor: default; }
      .player-deck-btn.idle {
        border-image-source: url('/images/ui/frames/frame-blackwhite.png');
        border-image-slice: 14 fill;
        border-image-width: 8px;
        height: 52px;
        margin-top: -2px;
        cursor: default;
      }
      .player-deck-btn .deck-count {
        font-size: 18px; color: #fff; font-weight: bold;
        text-shadow: 1px 1px 2px #000;
      }
      .player-deck-btn .deck-label {
        font-size: 7px; color: #cdf; text-transform: uppercase;
        text-shadow: 1px 1px 1px #000;
      }
      .player-stats-col {
        flex: 1; display: flex; flex-direction: column; gap: 0px;
        margin-top: -2px;
        padding: 4px 10px;
        height: 52px; box-sizing: border-box;
        justify-content: center;
        border-image-source: url('/images/ui/frames/frame-blackwhite.png');
        border-image-slice: 14 fill;
        border-image-width: 8px;
        border-style: solid;
        image-rendering: pixelated;
      }
      .stat-bar-row {
        display: flex; align-items: center; gap: 6px;
      }
      .stat-bar-icon { font-size: 14px; width: 16px; text-align: center; }
      .stat-bar-icon.hp { color: #f66; }
      .stat-bar-icon.ep { color: #6af; }
      .stat-bar {
        flex: 1; height: 8px; background: #0a0a0a;
        border-radius: 4px; overflow: hidden;
      }
      .stat-bar-fill { height: 100%; transition: width 0.3s; border-radius: 4px; }
      .stat-bar-fill.hp { background: linear-gradient(180deg, #e55, #a22); }
      .stat-bar-fill.ep { background: linear-gradient(180deg, #5af, #27c); }
      .stat-bar-text {
        font-size: 9px; color: #999; width: 50px; text-align: right;
        text-shadow: 1px 1px 1px #000;
      }
      .player-stand-btn {
        width: 48px; height: 56px;
        background: transparent;
        border-image-source: url('/images/ui/buttons/btn_gold.png');
        border-image-slice: 16 fill;
        border-image-width: 8px;
        border-style: solid;
        image-rendering: pixelated;
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        padding: 0 0 2px;
        cursor: pointer; transition: all 0.15s;
        font-family: 'Kong', monospace;
      }
      .player-stand-btn:hover:not(:disabled):not(.idle) {
        transform: scale(1.05);
        filter: brightness(1.2);
      }
      .player-stand-btn:active:not(:disabled):not(.idle) {
        border-image-source: url('/images/ui/buttons/btn_gold_down.png');
        transform: scale(0.97);
      }
      .player-stand-btn:disabled:not(.idle) { opacity: 0.35; cursor: default; }
      .player-stand-btn.idle {
        border-image-source: url('/images/ui/frames/frame-blackwhite.png');
        border-image-slice: 14 fill;
        border-image-width: 8px;
        height: 52px;
        margin-top: -2px;
        cursor: default;
      }
      .player-stand-btn .stand-icon {
        font-size: 22px;
        text-shadow: 1px 1px 2px #000;
      }
      .player-stand-btn .stand-label {
        font-size: 7px; color: #ffe; text-transform: uppercase;
        text-shadow: 1px 1px 1px #000;
      }
    `;
    document.head.appendChild(style);
  }

  _bindEvents() {
    eventBus.on(Events.UI_UPDATE_HP, (data) => {
      if (data.target === 'player') this._updatePlayerStats();
    });
    eventBus.on(Events.UI_UPDATE_ENERGY, () => this._updatePlayerStats());
    eventBus.on('input:map', () => this.toggleMinimap());
    eventBus.on('player:step', () => {
      this._updatePlayerStats();
      this.updateMinimap();
    });
  }

  _updatePlayerStats() {
    const p = this.player;
    const hpFill = document.querySelector('.player-hp-fill');
    const hpText = document.querySelector('.player-hp-text');
    const epFill = document.querySelector('.player-ep-fill');
    const epText = document.querySelector('.player-ep-text');
    if (hpFill) hpFill.style.width = `${(p.hp / p.maxHp) * 100}%`;
    if (hpText) hpText.textContent = `${p.hp}/${p.maxHp}`;
    if (epFill) epFill.style.width = `${(p.energy / p.maxEnergy) * 100}%`;
    if (epText) epText.textContent = `${p.energy}/${p.maxEnergy}`;
  }

  setCombatMode() {
    this._inCombat = true;
    const drawBtn = document.querySelector('.draw-btn');
    const standBtn = document.querySelector('.stand-btn');
    if (drawBtn) {
      drawBtn.classList.remove('idle');
      drawBtn.disabled = false;
      drawBtn.querySelector('.deck-count').textContent = this.combat.playerDeck.remaining;
      drawBtn.querySelector('.deck-label').textContent = 'Draw';
      drawBtn.onclick = () => this.combat.playerDrawCard();
    }
    if (standBtn) {
      standBtn.classList.remove('idle');
      standBtn.disabled = false;
      standBtn.querySelector('.stand-icon').textContent = '\u270B';
      standBtn.querySelector('.stand-label').textContent = 'Stand';
      standBtn.onclick = () => this.combat.playerStand();
    }
  }

  _setExploreMode() {
    this._inCombat = false;
    const drawBtn = document.querySelector('.draw-btn');
    const standBtn = document.querySelector('.stand-btn');
    if (drawBtn) {
      drawBtn.classList.add('idle');
      drawBtn.disabled = true;
      drawBtn.querySelector('.deck-count').textContent = '';
      drawBtn.querySelector('.deck-label').textContent = '';
      drawBtn.onclick = null;
    }
    if (standBtn) {
      standBtn.classList.add('idle');
      standBtn.disabled = true;
      standBtn.querySelector('.stand-icon').textContent = '';
      standBtn.querySelector('.stand-label').textContent = '';
      standBtn.onclick = null;
    }
  }

  update() {
    this._updatePlayerStats();
    const floorLabel = document.querySelector('.floor-label');
    const goldLabel = document.querySelector('.gold-label');
    if (floorLabel) floorLabel.textContent = `F${this.floor || 1}`;
    if (goldLabel) goldLabel.textContent = `${this.player.gold}g`;
  }

  setFloor(floor) {
    this.floor = floor;
    this.update();
  }

  toggleMinimap() {
    this.minimapVisible = !this.minimapVisible;
    const canvas = document.getElementById('minimap');
    if (canvas) canvas.classList.toggle('visible', this.minimapVisible);
    if (this.minimapVisible) this.updateMinimap();
  }

  updateMinimap() {
    const canvas = document.getElementById('minimap');
    if (!canvas || !this.minimapVisible) return;

    const ctx = canvas.getContext('2d');
    const scale = 5;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let z = 0; z < this.map.height; z++) {
      for (let x = 0; x < this.map.width; x++) {
        if (!this.map.explored[z][x]) continue;
        const cell = this.map.getCell(x, z);
        if (cell === 0) continue;
        if (cell === 1) ctx.fillStyle = '#666';
        else if (cell === 4) ctx.fillStyle = '#da4';
        else if (cell === 8) ctx.fillStyle = '#c44';
        else ctx.fillStyle = '#333';
        ctx.fillRect(x * scale, z * scale, scale, scale);
      }
    }

    ctx.fillStyle = '#4c4';
    ctx.fillRect(
      this._playerX * scale - 1, this._playerZ * scale - 1,
      scale + 2, scale + 2
    );
  }

  setPlayerPos(x, z) {
    this._playerX = x;
    this._playerZ = z;
    this.updateMinimap();
  }

  beginExploring() {
    this._setExploreMode();
    this._updatePlayerStats();
  }

  show() { uiManager.showPanel('hud'); }
  hide() { uiManager.hidePanel('hud'); }
}
