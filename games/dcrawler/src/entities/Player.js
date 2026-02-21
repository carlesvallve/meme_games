import { PLAYER_DEFAULTS } from '../core/Constants.js';

export class Player {
  constructor() {
    this.hp = PLAYER_DEFAULTS.HP;
    this.maxHp = PLAYER_DEFAULTS.MAX_HP;
    this.energy = PLAYER_DEFAULTS.ENERGY;
    this.maxEnergy = PLAYER_DEFAULTS.MAX_ENERGY;
    this.attack = PLAYER_DEFAULTS.ATTACK;
    this.baseDefense = PLAYER_DEFAULTS.DEFENSE;
    this.level = 1;
    this.xp = 0;
    this.gold = 0;
    this.equipment = {
      weapon: null,
      armor: null,
      accessory: null,
    };
  }

  /** Total armor/defense = base + equipment armor value */
  get defense() {
    const armorBonus = this.equipment.armor ? this.equipment.armor.armorValue : 0;
    return this.baseDefense + armorBonus;
  }

  reset() {
    this.hp = PLAYER_DEFAULTS.HP;
    this.maxHp = PLAYER_DEFAULTS.MAX_HP;
    this.energy = PLAYER_DEFAULTS.ENERGY;
    this.maxEnergy = PLAYER_DEFAULTS.MAX_ENERGY;
    this.attack = PLAYER_DEFAULTS.ATTACK;
    this.baseDefense = PLAYER_DEFAULTS.DEFENSE;
    this.level = 1;
    this.xp = 0;
    this.gold = 0;
    this.equipment = {
      weapon: null,
      armor: null,
      accessory: null,
    };
  }

  addXP(amount) {
    this.xp += amount;
    const xpNeeded = this.level * 20;
    if (this.xp >= xpNeeded) {
      this.xp -= xpNeeded;
      this.level++;
      this.maxHp += 5;
      this.hp = this.maxHp;
      this.attack += 1;
      this.baseDefense += 1;
      return true; // leveled up
    }
    return false;
  }

  /** Equip an armor piece. Returns the previously equipped armor (or null). */
  equipArmor(armorItem) {
    const prev = this.equipment.armor;
    this.equipment.armor = armorItem;
    return prev;
  }
}
