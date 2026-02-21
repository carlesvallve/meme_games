export class UIManager {
  constructor() {
    this.overlay = document.getElementById('ui-overlay');
    this.panels = new Map();
    this._injectSharedStyles();
  }

  _injectSharedStyles() {
    if (document.getElementById('shared-ui-styles')) return;
    const style = document.createElement('style');
    style.id = 'shared-ui-styles';
    style.textContent = `
      /* Shared bevel button — pixel font, offset for bottom bevel */
      .bevel-btn {
        padding: 7px 28px 9px;
        font-family: 'Kong', 'Courier New', monospace;
        font-size: 12px; font-weight: bold;
        background: transparent;
        color: #fff;
        cursor: pointer;
        text-transform: uppercase;
        text-shadow: 1px 1px 2px #000;
        border-image-source: url('/images/ui/buttons/btn_green.png');
        border-image-slice: 16 fill;
        border-image-width: 8px;
        border-style: solid;
        image-rendering: pixelated;
        transition: all 0.15s;
      }
      .bevel-btn:hover {
        filter: brightness(1.2);
        transform: scale(1.05);
      }
      .bevel-btn:active {
        border-image-source: url('/images/ui/buttons/btn_green_down.png');
        transform: scale(0.97);
      }
      .bevel-btn.btn-gold {
        border-image-source: url('/images/ui/buttons/btn_gold.png');
      }
      .bevel-btn.btn-gold:active {
        border-image-source: url('/images/ui/buttons/btn_gold_down.png');
      }
      .bevel-btn.btn-blue {
        border-image-source: url('/images/ui/buttons/btn_blue.png');
      }
      .bevel-btn.btn-blue:active {
        border-image-source: url('/images/ui/buttons/btn_blue_down.png');
      }
    `;
    document.head.appendChild(style);
  }

  createPanel(id, html, styles = {}) {
    const panel = document.createElement('div');
    panel.id = id;
    panel.innerHTML = html;
    Object.assign(panel.style, styles);
    this.overlay.appendChild(panel);
    this.panels.set(id, panel);
    return panel;
  }

  getPanel(id) {
    return this.panels.get(id);
  }

  showPanel(id) {
    const panel = this.panels.get(id);
    if (panel) panel.style.display = '';
  }

  hidePanel(id) {
    const panel = this.panels.get(id);
    if (panel) panel.style.display = 'none';
  }

  removePanel(id) {
    const panel = this.panels.get(id);
    if (panel) {
      panel.remove();
      this.panels.delete(id);
    }
  }

  clearAll() {
    for (const [id] of this.panels) {
      this.removePanel(id);
    }
  }
}

export const uiManager = new UIManager();
