import { COMBAT } from '../core/Constants.js';

export class CardDeck {
  constructor() {
    this.cards = [];
    this.discardPile = [];
    this.reset();
  }

  reset() {
    this.cards = [];
    this.discardPile = [];
    // Create deck: 4 copies of each value 1-6 = 24 cards
    for (let value = COMBAT.CARD_MIN; value <= COMBAT.CARD_MAX; value++) {
      for (let i = 0; i < COMBAT.CARD_COPIES; i++) {
        this.cards.push(value);
      }
    }
    this.shuffle();
  }

  shuffle() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }

  draw() {
    if (this.cards.length === 0) {
      if (this.discardPile.length === 0) {
        // All cards drawn — reshuffle a fresh deck
        this.reset();
      } else {
        this.cards = this.discardPile.splice(0);
        this.shuffle();
      }
    }
    return this.cards.pop();
  }

  discard(value) {
    this.discardPile.push(value);
  }

  get remaining() {
    return this.cards.length;
  }

  get totalRemaining() {
    return this.cards.length + this.discardPile.length;
  }
}
