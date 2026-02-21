import { rollTraits, applyTraits } from './TraitDatabase.js';

export class Enemy {
  constructor(definition, floor = 1) {
    this.name = definition.name;
    this.type = definition.type;
    this.symbol = definition.symbol;
    this.color = definition.color;

    // Scale stats by floor
    const scale = 1 + (floor - 1) * 0.2;
    this.hp = Math.floor(definition.hp * scale);
    this.maxHp = this.hp;
    this.attack = Math.floor(definition.attack * scale);
    this.defense = Math.floor(definition.defense * scale);
    this.aggression = definition.aggression || 1;
    this.maxSteps = definition.maxSteps || 10;
    this.xpReward = Math.floor(definition.xpReward * scale);
    this.goldReward = Math.floor(definition.goldReward * scale);

    // Trait defaults
    this.traits = [];
    this.onStrike = null;
    this.regenPerRound = 0;
    this.dotPerRound = 0;
    this.standThreshold = 0;
    this.startsFullEP = false;
    this.extraCards = null;

    // Roll and apply random traits based on floor
    const traitKeys = definition.traits || rollTraits(floor);
    if (traitKeys.length > 0) {
      applyTraits(this, traitKeys);
    }
  }
}
