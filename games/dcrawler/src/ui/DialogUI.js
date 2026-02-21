import { uiManager } from './UIManager.js';

export class DialogUI {
  constructor() {
    this._injectStyles();
  }

  _injectStyles() {
    if (document.getElementById('dialog-styles')) return;
    const style = document.createElement('style');
    style.id = 'dialog-styles';
    style.textContent = `
      .dialog-overlay {
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,0.7);
      }
      .dialog-box {
        background: transparent;
        padding: 28px 36px;
        text-align: center;
        max-width: 360px;
        border-image-source: url('/images/ui/frames/frame-blackwhite.png');
        border-image-slice: 14 fill;
        border-image-width: 12px;
        border-style: solid;
        image-rendering: pixelated;
      }
      .dialog-title {
        color: #da4;
        font-size: 20px;
        font-family: 'Kong', 'Courier New', monospace;
        font-weight: bold;
        margin-bottom: 12px;
        text-shadow: 2px 2px 4px #000;
      }
      .dialog-text {
        color: #ccc;
        font-size: 12px;
        font-family: 'Kong', 'Courier New', monospace;
        margin-bottom: 18px;
        line-height: 1.6;
        text-shadow: 1px 1px 2px #000;
      }
      /* dialog-btn inherits from .bevel-btn.btn-gold (shared-ui-styles) */
      .dialog-btn { margin: 0 4px; }
    `;
    document.head.appendChild(style);
  }

  show(title, text, buttons = [{ label: 'OK', action: null }]) {
    const buttonHtml = buttons.map((b, i) =>
      `<button class="bevel-btn btn-gold dialog-btn" data-idx="${i}">${b.label}</button>`
    ).join('');

    const panel = uiManager.createPanel('dialog', `
      <div class="dialog-overlay">
        <div class="dialog-box">
          <div class="dialog-title">${title}</div>
          <div class="dialog-text">${text}</div>
          <div>${buttonHtml}</div>
        </div>
      </div>
    `);

    panel.querySelectorAll('.dialog-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        this.hide();
        if (buttons[idx]?.action) buttons[idx].action();
      });
    });
  }

  hide() {
    uiManager.removePanel('dialog');
  }
}
