import { PLAY_TYPE, createHandDeck, resolveCardValue } from './CardDefinitions.js';

export class HandCards {
  constructor(maxHand = 5) {
    this.maxHand = maxHand;
    this.deck = [];       // draw pile
    this.hand = [];       // cards in hand (up to maxHand)
    this.active = [];     // equipped weapons/shields (stay on field)
    this.discard = [];    // used cards return here
  }

  reset() {
    this.deck = createHandDeck();
    this.hand = [];
    this.active = [];
    this.discard = [];
    this.refillHand();
  }

  refillHand() {
    while (this.hand.length < this.maxHand && this.deck.length > 0) {
      this.hand.push(this.deck.pop());
    }
    // If deck is empty and hand not full, reshuffle discard
    if (this.hand.length < this.maxHand && this.discard.length > 0) {
      this.deck = this.discard.splice(0);
      this._shuffle(this.deck);
      while (this.hand.length < this.maxHand && this.deck.length > 0) {
        this.hand.push(this.deck.pop());
      }
    }
  }

  canPlay(index, energy) {
    if (index < 0 || index >= this.hand.length) return false;
    return energy >= this.hand[index].cost;
  }

  /**
   * Play a card from hand.
   * - Modifier: resolve value, return card to deck bottom
   * - Weapon/Shield: move to active array (stays on field)
   * - Potion/Spell: immediate effect, return card to deck bottom
   * Returns { card, value } or null
   */
  play(index) {
    if (index < 0 || index >= this.hand.length) return null;
    const card = this.hand.splice(index, 1)[0];

    let value = 0;
    if (card.playType === PLAY_TYPE.MODIFIER) {
      value = resolveCardValue(card);
      this._returnToDeck(card);
    } else if (card.playType === PLAY_TYPE.OFFENSIVE || card.playType === PLAY_TYPE.DEFENSIVE) {
      // Equipment — stays active until resolution
      this.active.push(card);
    } else if (card.playType === PLAY_TYPE.INSTANT) {
      value = card.value.min;
      this._returnToDeck(card);
    }

    return { card, value };
  }

  /**
   * Get active cards by play type (offensive/defensive)
   */
  getActiveByPlayType(playType) {
    return this.active.filter(c => c.playType === playType);
  }

  /**
   * After resolution: return active cards appropriately.
   * Winner's defensive cards and loser's offensive cards go back to their hands.
   * If draw: all active cards return.
   */
  returnActiveCards(isWinner) {
    if (isWinner === null) {
      // Draw — all active return to hand
      this.hand.push(...this.active);
      this.active = [];
    } else if (isWinner) {
      // Winner: defensive cards return (shields weren't needed)
      const defensive = this.active.filter(c => c.playType === PLAY_TYPE.DEFENSIVE);
      const offensive = this.active.filter(c => c.playType === PLAY_TYPE.OFFENSIVE);
      this.hand.push(...defensive);
      // Used offensive cards go to discard
      this.discard.push(...offensive);
      this.active = [];
    } else {
      // Loser: offensive cards return (couldn't use them), defensive were used
      const offensive = this.active.filter(c => c.playType === PLAY_TYPE.OFFENSIVE);
      const defensive = this.active.filter(c => c.playType === PLAY_TYPE.DEFENSIVE);
      this.hand.push(...offensive);
      // Used defensive cards go to discard
      this.discard.push(...defensive);
      this.active = [];
    }
  }

  /**
   * Remove an active card after it's been applied during resolution
   */
  consumeActiveCard(card) {
    const idx = this.active.indexOf(card);
    if (idx >= 0) {
      this.active.splice(idx, 1);
      this._returnToDeck(card);
    }
  }

  _returnToDeck(card) {
    // Insert at bottom (beginning) of deck
    this.deck.unshift(card);
  }

  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  addCardToDeck(card) {
    this.deck.push(card);
    this._shuffle(this.deck);
  }

  getHand() { return this.hand; }
  getActive() { return this.active; }
  getDeckSize() { return this.deck.length; }
}
