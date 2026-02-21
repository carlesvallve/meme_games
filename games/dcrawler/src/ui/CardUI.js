/**
 * Shared card rendering — used by CombatUI (hand cards) and LootUI (reward card).
 * Cards have two visual states: 'sm' (hand) and 'lg' (preview/reward).
 * The same element transitions between them via CSS class swap + tween.
 */

let _stylesInjected = false;

function injectCardStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;

  const style = document.createElement('style');
  style.id = 'card-ui-styles';
  style.textContent = `
    /* ==== SHARED CARD ==== */
    .game-card {
      background: transparent; text-align: center;
      position: relative; overflow: hidden;
      border-image-source: url('/images/ui/buttons/btn_blue.png');
      border-image-slice: 16 fill;
      border-image-width: 8px;
      border-style: solid;
      image-rendering: pixelated;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }
    .game-card.weapon {
      border-image-source: url('/images/ui/buttons/btn_gold.png');
    }
    .game-card.shield {
      border-image-source: url('/images/ui/buttons/btn_blue.png');
    }
    .game-card.potion {
      border-image-source: url('/images/ui/buttons/btn_green.png');
    }
    .game-card.spell {
      border-image-source: url('/images/ui/buttons/btn_blue.png');
      filter: hue-rotate(240deg) saturate(1.3);
    }
    .game-card.ability {
      border-image-source: url('/images/ui/buttons/btn_blue.png');
    }
    .game-card.modifier {
      border-image-source: url('/images/ui/buttons/btn_grey_down.png');
    }

    .game-card-img {
      background-size: contain; background-repeat: no-repeat;
      background-position: center;
      image-rendering: pixelated;
      filter: brightness(1.1);
    }
    .game-card-name {
      color: #fff;
      white-space: nowrap; overflow: hidden;
      transition: font-size 0.2s;
    }
    .game-card-cost {
      position: absolute; top: 2px; right: 2px;
      font-size: 7px; color: #6af; background: rgba(0,0,0,0.7);
      padding: 1px 3px; border-radius: 2px;
      font-weight: 700;
      transition: all 0.2s;
    }
    .game-card-cost.free { color: #5c5; }
    .game-card-desc {
      color: #222; line-height: 1.2;
      transition: all 0.2s;
    }
    .game-card-symbol {
      transition: font-size 0.2s, line-height 0.2s;
    }

    /* ==== SMALL STATE (combat hand) ==== */
    .game-card.card-sm {
      width: 72px; padding: 4px 5px 16px;
      cursor: pointer; transition: filter 0.15s;
    }
    .game-card.card-sm:hover:not(.disabled) {
      filter: brightness(1.2);
    }
    .game-card.card-sm.spell:hover:not(.disabled) {
      filter: hue-rotate(240deg) saturate(1.3) brightness(1.2);
    }
    .game-card.card-sm.disabled { opacity: 0.6; filter: saturate(0.3) brightness(0.8); cursor: default; }
    .game-card.card-sm .game-card-symbol { font-size: 30px; line-height: 56px; }
    .game-card.card-sm .game-card-name {
      font-size: 7px; font-weight: 700;
      text-shadow: 0 1px 2px rgba(0,0,0,0.8);
    }
    .game-card.card-sm .game-card-desc {
      font-size: 0px; color: #aaa; line-height: 0;
      max-height: 0; overflow: hidden; margin: 0; padding: 0;
    }
    .game-card.card-sm .game-card-cost {
      font-size: 7px; font-weight: 700;
    }

    /* ==== LARGE STATE (preview / loot reward) ==== */
    .game-card.card-lg {
      width: 200px; padding: 12px 14px 42px;
      filter: drop-shadow(0 0 16px rgba(218,170,68,0.4));
    }
    .game-card.card-lg.spell {
      filter: hue-rotate(240deg) saturate(1.3) drop-shadow(0 0 16px rgba(218,170,68,0.4));
    }
    .game-card.card-lg .game-card-symbol { font-size: 72px; line-height: 155px; }
    .game-card.card-lg .game-card-name {
      font-size: 16px; font-weight: 700;
      margin-bottom: 4px;
      text-shadow: 0 1px 3px rgba(0,0,0,0.8);
      white-space: normal;
    }
    .game-card.card-lg .game-card-desc {
      font-size: 12px; color: #222; margin-bottom: 6px;
      max-height: 60px; overflow: visible;
      line-height: 1.3;
    }
    .game-card.card-lg .game-card-cost {
      font-size: 12px; font-weight: 700;
      top: 6px; right: 6px; padding: 3px 7px;
    }

    /* Loot reward specific (has pop animation) */
    .game-card.card-lg.loot-reward {
      animation: lootCardPop 0.4s ease;
    }

    /* ==== PREVIEW OVERLAY ==== */
    .card-preview-backdrop {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.6);
      z-index: 99;
      pointer-events: auto;
    }
    /* card-preview-use-btn inherits from .bevel-btn (shared-ui-styles) */
    .card-preview-use-btn {
      position: absolute;
      z-index: 101;
      left: 0; right: 0;
      margin: 0 auto;
      width: fit-content;
      opacity: 0;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Create card HTML string.
 * @param {object} card - Card definition (name, type, symbol, image, cost, desc)
 * @param {'sm'|'lg'} size - 'sm' for hand cards, 'lg' for loot/reward
 * @param {object} opts - { disabled: bool }
 */
export function createCardHTML(card, size = 'sm', opts = {}) {
  injectCardStyles();

  const visual = card.image
    ? `<div class="game-card-img" style="background-image:url('${card.image}')"></div>`
    : `<div class="game-card-symbol">${card.symbol}</div>`;

  const costLabel = card.cost > 0 ? `${card.cost}EP` : 'Free';
  const costClass = card.cost === 0 ? 'free' : '';
  const disabledClass = opts.disabled ? 'disabled' : '';

  return `<div class="game-card card-${size} ${card.type} ${disabledClass}">
    ${visual}
    <div class="game-card-name">${card.name}</div>
    <span class="game-card-cost ${costClass}">${costLabel}</span>
    <div class="game-card-desc">${card.desc}</div>
  </div>`;
}

/**
 * Create a card DOM element.
 */
export function createCardElement(card, size = 'sm', opts = {}) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = createCardHTML(card, size, opts);
  return wrapper.firstElementChild;
}
