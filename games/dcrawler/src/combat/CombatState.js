import { eventBus, Events } from '../core/EventBus.js';
import { COMBAT } from '../core/Constants.js';
import { CardDeck } from './CardDeck.js';
import { HandCards } from './HandCards.js';
import { EnemyAI } from './EnemyAI.js';
import { PLAY_TYPE, CARD_TYPE } from './CardDefinitions.js';
import { StatusTracker } from './StatusEffects.js';

const PHASE = {
  IDLE: 'idle',
  PLAYER_TURN: 'playerTurn',
  ENEMY_TURN: 'enemyTurn',
  RESOLVING: 'resolving',
  APPLYING_WEAPONS: 'applyingWeapons',
  APPLYING_SHIELDS: 'applyingShields',
  ATTACKING: 'attacking',
  VICTORY: 'victory',
  DEFEAT: 'defeat',
};

export class CombatState {
  constructor(player) {
    this.player = player;
    this.enemy = null;
    this.phase = PHASE.IDLE;

    // Number decks (separate per combatant, like battlecards)
    this.playerDeck = new CardDeck();
    this.enemyDeck = new CardDeck();

    // Hand card systems
    this.playerHand = new HandCards(COMBAT.BASE_HAND_SIZE);
    this.enemyHand = new HandCards(COMBAT.BASE_HAND_SIZE);

    this.enemyAI = new EnemyAI();

    // Round state
    this.playerMeter = 0;
    this.enemyMeter = 0;
    this.playerMaxSteps = COMBAT.TARGET; // always 12 for player
    this.enemyMaxSteps = 10; // randomized per combat (5-11)
    this.playerBusted = false;
    this.enemyBusted = false;
    this.playerCritical = false;
    this.enemyCritical = false;
    this.playerResolved = false;
    this.enemyResolved = false;
    this.playerCards = []; // number cards drawn this round
    this.enemyCards = [];
    this.round = 0;

    // Resolution state
    this.attackCount = 0;
    this.attackerIsPlayer = false;

    // Status effects
    this.playerStatus = new StatusTracker();
    this.enemyStatus = new StatusTracker();
  }

  startCombat(enemy) {
    this.enemy = enemy;
    this.round = 0;

    // Use enemy's defined max steps (varies by enemy type)
    this.enemyMaxSteps = enemy.maxSteps || 10;

    // Reset decks
    this.playerDeck.reset();
    this.enemyDeck.reset();

    // Reset hand cards
    this.playerHand.reset();
    this.enemyHand.reset();

    // Clear status effects
    this.playerStatus.clear();
    this.enemyStatus.clear();

    // Apply enemy innate traits as status effects
    if (enemy.regenPerRound > 0) {
      this.enemyStatus.apply('regen', { healPerRound: enemy.regenPerRound, duration: 99 });
    }
    if (enemy.dotPerRound > 0) {
      this.enemyStatus.apply('bleeding', { damagePerRound: enemy.dotPerRound, duration: 99 });
    }

    // Give both starting energy
    this.player.energy = Math.min(this.player.maxEnergy, this.player.energy + 5);

    this.phase = PHASE.PLAYER_TURN;
    this._newRound();
    eventBus.emit(Events.COMBAT_START, { enemy, enemyMaxSteps: this.enemyMaxSteps });
  }

  _newRound() {
    this.round++;
    this.playerMeter = 0;
    this.enemyMeter = 0;
    this.playerBusted = false;
    this.enemyBusted = false;
    this.playerCritical = false;
    this.enemyCritical = false;
    this.playerResolved = false;
    this.enemyResolved = false;
    this.playerCards = [];
    this.enemyCards = [];
    this.attackCount = 0;

    // Process status effects at start of round (after round 1)
    if (this.round > 1) {
      this._processStatusEffects();
      // Check for deaths from DoTs
      if (this.enemy.hp <= 0) {
        this.phase = PHASE.VICTORY;
        eventBus.emit(Events.COMBAT_END, { result: 'victory', enemy: this.enemy });
        return;
      }
      if (this.player.hp <= 0) {
        this.phase = PHASE.DEFEAT;
        eventBus.emit(Events.COMBAT_END, { result: 'defeat' });
        return;
      }
    }

    // Apply stat mods from status effects to effective max steps
    const playerMods = this.playerStatus.getStatMods();
    const enemyMods = this.enemyStatus.getStatMods();
    this.playerMaxSteps = Math.max(6, COMBAT.TARGET + playerMods.maxSteps);
    this.enemyMaxSteps = Math.max(6, (this.enemy.maxSteps || 10) + enemyMods.maxSteps);

    // Refill hands
    this.playerHand.refillHand();
    this.enemyHand.refillHand();

    // +5 EP to both per round
    this.player.energy = Math.min(this.player.maxEnergy, this.player.energy + 5);

    this.phase = PHASE.PLAYER_TURN;

    // Check if player is stunned
    if (this.playerStatus.has('stun')) {
      this.playerResolved = true;
      eventBus.emit(Events.COMBAT_NEW_ROUND, {
        round: this.round,
        playerMaxSteps: this.playerMaxSteps,
        enemyMaxSteps: this.enemyMaxSteps,
      });
      eventBus.emit('combat:statusApplied', { target: 'player', status: 'stun', message: 'Stunned!' });
      this._afterPlayerAction();
      return;
    }

    eventBus.emit(Events.COMBAT_NEW_ROUND, {
      round: this.round,
      playerMaxSteps: this.playerMaxSteps,
      enemyMaxSteps: this.enemyMaxSteps,
    });
    eventBus.emit(Events.COMBAT_PLAYER_TURN);
    eventBus.emit(Events.UI_UPDATE_ENERGY, { energy: this.player.energy, maxEnergy: this.player.maxEnergy });
    this._emitStatusUpdate();
  }

  // ---- PLAYER ACTIONS ----

  /** Player draws a number card from their deck */
  playerDrawCard() {
    if (this.phase !== PHASE.PLAYER_TURN || this.playerResolved) return;

    const card = this.playerDeck.draw();
    this._advanceMeter('player', card);
  }

  /** Player stands (stops drawing) */
  playerStand() {
    if (this.phase !== PHASE.PLAYER_TURN || this.playerResolved) return;

    this.playerResolved = true;
    eventBus.emit(Events.COMBAT_STAND, { target: 'player', meter: this.playerMeter });
    this._afterPlayerAction();
  }

  /** Player plays a hand card */
  playerPlayCard(index) {
    if (this.phase !== PHASE.PLAYER_TURN) return false;

    if (!this.playerHand.canPlay(index, this.player.energy)) return false;

    const { card, value } = this.playerHand.play(index);
    if (!card) return false;

    this.player.energy -= card.cost;
    eventBus.emit(Events.UI_UPDATE_ENERGY, { energy: this.player.energy, maxEnergy: this.player.maxEnergy });
    eventBus.emit(Events.HAND_CARD_PLAY, { card, value, target: 'player' });

    // Apply effect based on play type
    if (card.playType === PLAY_TYPE.MODIFIER) {
      this._advanceMeter('player', value);
      return true;
    }

    if (card.playType === PLAY_TYPE.OFFENSIVE || card.playType === PLAY_TYPE.DEFENSIVE) {
      // Equipment — stays active, no immediate meter effect
      eventBus.emit('combat:equipCard', { card, target: 'player' });
      return true;
    }

    if (card.playType === PLAY_TYPE.INSTANT) {
      if (card.type === CARD_TYPE.POTION) {
        this._applyPotion(card, 'player');
      } else if (card.type === CARD_TYPE.SPELL || card.type === CARD_TYPE.ABILITY) {
        this._applySpell(card);
        // Enemy died from the instant effect — don't continue turn flow
        if (this.enemy.hp <= 0) return true;
      }
      return true;
    }

    return true;
  }

  // ---- METER ADVANCEMENT ----

  _advanceMeter(target, value) {
    if (target === 'player') {
      const prevMeter = this.playerMeter;
      this.playerMeter += value;
      this.playerCards.push(value);

      if (this.playerMeter > this.playerMaxSteps) {
        // VT Overcharge: reset gauge to pre-bust value, mark as busted (auto-lose)
        this.playerBusted = true;
        this.playerMeter = prevMeter; // reset to value before the bust card
        this.playerResolved = true;
        eventBus.emit(Events.COMBAT_DRAW_CARD, { target: 'player', value, meter: prevMeter + value });
        eventBus.emit(Events.COMBAT_BUST, { target: 'player', meter: this.playerMeter, overhead: value });
        this._afterPlayerAction();
        return;
      }

      eventBus.emit(Events.COMBAT_DRAW_CARD, { target: 'player', value, meter: this.playerMeter });

      // VT Critical: exactly 12 = critical hit, auto-stand
      if (this.playerMeter === COMBAT.TARGET) {
        this.playerCritical = true;
        this.playerResolved = true;
        eventBus.emit(Events.COMBAT_STAND, { target: 'player', meter: this.playerMeter, critical: true });
      } else if (this.playerMeter === this.playerMaxSteps) {
        this.playerResolved = true;
        eventBus.emit(Events.COMBAT_STAND, { target: 'player', meter: this.playerMeter });
      }

      this._afterPlayerAction();
    } else {
      const prevMeter = this.enemyMeter;
      this.enemyMeter += value;
      this.enemyCards.push(value);

      if (this.enemyMeter > this.enemyMaxSteps) {
        // VT Overcharge: reset gauge to pre-bust value, mark as busted (auto-lose)
        this.enemyBusted = true;
        this.enemyMeter = prevMeter;
        this.enemyResolved = true;
        eventBus.emit(Events.COMBAT_DRAW_CARD, { target: 'enemy', value, meter: prevMeter + value });
        eventBus.emit(Events.COMBAT_BUST, { target: 'enemy', meter: this.enemyMeter, overhead: value });
        this._afterEnemyAction();
        return;
      }

      eventBus.emit(Events.COMBAT_DRAW_CARD, { target: 'enemy', value, meter: this.enemyMeter });

      if (this.enemyMeter === this.enemyMaxSteps) {
        this.enemyResolved = true;
        eventBus.emit(Events.COMBAT_STAND, { target: 'enemy', meter: this.enemyMeter });
      }

      this._afterEnemyAction();
    }
  }

  // ---- TURN FLOW (alternating, like battlecards) ----

  _afterPlayerAction() {
    // After player acts, check if both resolved
    if (this.playerResolved && this.enemyResolved) {
      this._checkResolution();
      return;
    }

    // Switch to enemy turn
    if (!this.enemyResolved) {
      this.phase = PHASE.ENEMY_TURN;
      eventBus.emit(Events.COMBAT_ENEMY_TURN);
      setTimeout(() => this._doEnemyAction(), 600);
    } else {
      // Enemy already resolved, player keeps going
      this.phase = PHASE.PLAYER_TURN;
      eventBus.emit(Events.COMBAT_PLAYER_TURN);
    }
  }

  _afterEnemyAction() {
    if (this.playerResolved && this.enemyResolved) {
      this._checkResolution();
      return;
    }

    // Switch to player turn
    if (!this.playerResolved) {
      this.phase = PHASE.PLAYER_TURN;
      eventBus.emit(Events.COMBAT_PLAYER_TURN);
    } else {
      // Player already resolved, enemy keeps going
      this.phase = PHASE.ENEMY_TURN;
      eventBus.emit(Events.COMBAT_ENEMY_TURN);
      setTimeout(() => this._doEnemyAction(), 600);
    }
  }

  // ---- ENEMY AI ----

  _doEnemyAction() {
    if (this.enemyResolved) return;

    // AI may play a hand card first (simple: sometimes play equipment)
    this._enemyMayPlayCard();

    // Then decide hit or stand
    const decision = this.enemyAI.decide(
      this.enemyMeter, this.playerMeter, this.playerResolved,
      this.enemy.aggression || 1, this.enemyMaxSteps
    );

    if (decision === 'stand') {
      this.enemyResolved = true;
      eventBus.emit(Events.COMBAT_STAND, { target: 'enemy', meter: this.enemyMeter });
      this._afterEnemyAction();
    } else {
      // Draw a number card
      const card = this.enemyDeck.draw();
      this._advanceMeter('enemy', card);
    }
  }

  _enemyMayPlayCard() {
    // Simple AI: play equipment cards early in the round if available
    const hand = this.enemyHand.getHand();
    if (this.round <= 1 || Math.random() < 0.3) {
      for (let i = 0; i < hand.length; i++) {
        const card = hand[i];
        if ((card.playType === PLAY_TYPE.OFFENSIVE || card.playType === PLAY_TYPE.DEFENSIVE) &&
            card.cost <= 20) { // enemy has no energy tracking for simplicity
          this.enemyHand.play(i);
          eventBus.emit('combat:equipCard', { card, target: 'enemy' });
          break;
        }
      }
    }
  }

  // ---- RESOLUTION ----

  _checkResolution() {
    // Bust check — if one side busted, force resolution once the other side is also resolved
    if (this.playerBusted || this.enemyBusted) {
      // If one busted, the other still needs to finish (unless also busted)
      if (!this.playerResolved || !this.enemyResolved) return;
      setTimeout(() => this._resolveRound(), 500);
      return;
    }

    // Both must be resolved
    if (!this.playerResolved || !this.enemyResolved) return;

    setTimeout(() => this._resolveRound(), 500);
  }

  _resolveRound() {
    this.phase = PHASE.RESOLVING;

    let winner, loser, attacks;
    let isSuperAttack = false;

    // VT Bust: buster loses, meter was reset to pre-bust value
    if (this.playerBusted && this.enemyBusted) {
      // Both busted — draw, both get +5 EP
      this.player.energy = Math.min(this.player.maxEnergy, this.player.energy + COMBAT.ENERGY_PER_HIT);
      eventBus.emit(Events.UI_UPDATE_ENERGY, { energy: this.player.energy, maxEnergy: this.player.maxEnergy });
      eventBus.emit(Events.COMBAT_RESOLVE, { result: { winner: 'draw' }, playerMeter: this.playerMeter, enemyMeter: this.enemyMeter });
      this.playerHand.returnActiveCards(null);
      this.enemyHand.returnActiveCards(null);
      setTimeout(() => this._newRound(), 800);
      return;
    }

    if (this.playerBusted) {
      // Player busted — enemy wins. Attacks = enemy meter vs player's reset meter
      winner = 'enemy'; loser = 'player';
      attacks = Math.max(1, this.enemyMeter - this.playerMeter);
      // VT Super Attack: if enemy is at exactly 12 and player busts
      if (this.enemyCritical) isSuperAttack = true;
    } else if (this.enemyBusted) {
      // Enemy busted — player wins
      winner = 'player'; loser = 'enemy';
      attacks = Math.max(1, this.playerMeter - this.enemyMeter);
      // VT Super Attack: if player is at exactly 12 and enemy busts
      if (this.playerCritical) isSuperAttack = true;
    } else if (this.playerMeter === this.enemyMeter) {
      // VT Tie: both get +5 EP bonus, no attacks
      this.player.energy = Math.min(this.player.maxEnergy, this.player.energy + COMBAT.ENERGY_PER_HIT);
      eventBus.emit(Events.UI_UPDATE_ENERGY, { energy: this.player.energy, maxEnergy: this.player.maxEnergy });
      eventBus.emit(Events.COMBAT_RESOLVE, { result: { winner: 'tie', epBonus: COMBAT.ENERGY_PER_HIT }, playerMeter: this.playerMeter, enemyMeter: this.enemyMeter });
      this.playerHand.returnActiveCards(null);
      this.enemyHand.returnActiveCards(null);
      setTimeout(() => this._newRound(), 800);
      return;
    } else {
      // Normal resolution — higher meter wins
      if (this.playerMeter > this.enemyMeter) {
        winner = 'player'; loser = 'enemy';
      } else {
        winner = 'enemy'; loser = 'player';
      }
      attacks = Math.abs(this.playerMeter - this.enemyMeter);
    }

    this.attackerIsPlayer = winner === 'player';
    this.attackCount = attacks;

    const result = {
      winner, attacks,
      playerMeter: this.playerMeter,
      enemyMeter: this.enemyMeter,
      isBust: this.playerBusted || this.enemyBusted,
      isCritical: (winner === 'player' && this.playerCritical) || (winner === 'enemy' && this.enemyCritical),
      isSuperAttack,
    };

    eventBus.emit(Events.COMBAT_RESOLVE, { result, playerMeter: this.playerMeter, enemyMeter: this.enemyMeter });

    // Phase 2: Apply weapons (winner's offensive cards add attacks)
    setTimeout(() => this._applyWeapons(winner, loser), 600);
  }

  _applyWeapons(winner, loser) {
    this.phase = PHASE.APPLYING_WEAPONS;
    const winnerHand = winner === 'player' ? this.playerHand : this.enemyHand;
    const weapons = winnerHand.getActiveByPlayType(PLAY_TYPE.OFFENSIVE);

    if (weapons.length === 0) {
      this._applyShields(winner, loser);
      return;
    }

    let i = 0;
    const applyNext = () => {
      if (i >= weapons.length) {
        this._applyShields(winner, loser);
        return;
      }
      const weapon = weapons[i];
      this.attackCount += weapon.value.min;
      // Weapon status effects
      const defenderStatus = loser === 'player' ? this.playerStatus : this.enemyStatus;
      if (weapon.name === 'Knife') {
        defenderStatus.apply('bleeding');
        eventBus.emit('combat:statusApplied', { target: loser, status: 'bleeding', message: 'Bleeding!' });
      }
      if (weapon.name === 'Hammer') {
        defenderStatus.apply('stun');
        eventBus.emit('combat:statusApplied', { target: loser, status: 'stun', message: 'Stunned!' });
      }
      this._emitStatusUpdate();
      eventBus.emit('combat:weaponApplied', {
        card: weapon, attacks: this.attackCount, added: weapon.value.min, winner,
      });
      i++;
      setTimeout(applyNext, 400);
    };
    applyNext();
  }

  _applyShields(winner, loser) {
    this.phase = PHASE.APPLYING_SHIELDS;
    const loserHand = loser === 'player' ? this.playerHand : this.enemyHand;
    const shields = loserHand.getActiveByPlayType(PLAY_TYPE.DEFENSIVE);

    if (shields.length === 0) {
      this._startAttacks(winner, loser);
      return;
    }

    let i = 0;
    const applyNext = () => {
      if (i >= shields.length) {
        this._startAttacks(winner, loser);
        return;
      }
      const shield = shields[i];
      const blocked = Math.min(shield.value.min, this.attackCount);
      this.attackCount = Math.max(0, this.attackCount - shield.value.min);
      eventBus.emit('combat:shieldApplied', {
        card: shield, attacks: this.attackCount, blocked, loser,
      });
      i++;
      setTimeout(applyNext, 400);
    };
    applyNext();
  }

  _startAttacks(winner, loser) {
    // Return active cards appropriately
    const winnerHand = winner === 'player' ? this.playerHand : this.enemyHand;
    const loserHand = loser === 'player' ? this.playerHand : this.enemyHand;
    winnerHand.returnActiveCards(true);
    loserHand.returnActiveCards(false);

    if (this.attackCount <= 0) {
      // All attacks blocked!
      eventBus.emit('combat:allBlocked', { loser });
      setTimeout(() => this._newRound(), 800);
      return;
    }

    this.phase = PHASE.ATTACKING;
    this._executeAttacks(winner, loser, 0);
  }

  _executeAttacks(winner, loser, index) {
    if (index >= this.attackCount) {
      this._afterAttacks();
      return;
    }

    const attacker = winner === 'player' ? this.player : this.enemy;
    const defender = winner === 'player' ? this.enemy : this.player;
    const attackerStatus = winner === 'player' ? this.playerStatus : this.enemyStatus;
    const isLastHit = index === this.attackCount - 1;
    const winnerCritical = (winner === 'player' && this.playerCritical) || (winner === 'enemy' && this.enemyCritical);
    const isSuperAttack = (winner === 'player' && this.playerCritical && this.enemyBusted) ||
                          (winner === 'enemy' && this.enemyCritical && this.playerBusted);

    // Include stat mods from status effects
    const atkMods = attackerStatus.getStatMods();
    const effectiveAttack = attacker.attack + atkMods.attack;

    // VT Armor: damage = attacker.attack - defender.armor (defense)
    // Super Attack ignores armor entirely
    let damage;
    if (isSuperAttack) {
      damage = effectiveAttack;
    } else {
      damage = Math.max(1, effectiveAttack - defender.defense);
    }

    // VT Critical: last strike deals bonus damage
    const isCriticalHit = winnerCritical && isLastHit;
    if (isCriticalHit) {
      damage += COMBAT.CRITICAL_BONUS;
    }

    defender.hp = Math.max(0, defender.hp - damage);

    // Winner gains +5 EP per hit
    if (winner === 'player') {
      this.player.energy = Math.min(this.player.maxEnergy, this.player.energy + COMBAT.ENERGY_PER_HIT);
      eventBus.emit(Events.UI_UPDATE_ENERGY, { energy: this.player.energy, maxEnergy: this.player.maxEnergy });
    }

    // Process on-strike effects (enemy poison/infection traits, weapon status)
    this._processOnStrike(attacker, defender, winner);

    eventBus.emit(Events.COMBAT_ATTACK, {
      attacker: winner,
      damage,
      attackIndex: index,
      totalAttacks: this.attackCount,
      critical: isCriticalHit,
      superAttack: isSuperAttack,
    });

    eventBus.emit(Events.UI_UPDATE_HP, {
      target: loser,
      hp: defender.hp,
      maxHp: defender.maxHp,
    });

    // Stop early if defender died
    if (defender.hp <= 0) {
      setTimeout(() => this._afterAttacks(), 400);
      return;
    }

    setTimeout(() => this._executeAttacks(winner, loser, index + 1), 300);
  }

  _afterAttacks() {
    if (this.enemy.hp <= 0) {
      this.phase = PHASE.VICTORY;
      eventBus.emit(Events.COMBAT_END, { result: 'victory', enemy: this.enemy });
      return;
    }
    if (this.player.hp <= 0) {
      this.phase = PHASE.DEFEAT;
      eventBus.emit(Events.COMBAT_END, { result: 'defeat' });
      return;
    }

    // Continue with new round
    setTimeout(() => this._newRound(), 600);
  }

  // ---- INSTANT CARD EFFECTS ----

  _applyPotion(card, target) {
    if (card.value.type === 'hp') {
      if (target === 'player') {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + card.value.min);
        eventBus.emit(Events.UI_UPDATE_HP, { target: 'player', hp: this.player.hp, maxHp: this.player.maxHp });
      }
    } else if (card.value.type === 'ep') {
      if (target === 'player') {
        this.player.energy = Math.min(this.player.maxEnergy, this.player.energy + card.value.min);
        eventBus.emit(Events.UI_UPDATE_ENERGY, { energy: this.player.energy, maxEnergy: this.player.maxEnergy });
      }
    } else if (card.value.type === 'cleanse') {
      if (target === 'player') {
        this.playerStatus.cleanse();
        this._emitStatusUpdate();
      }
    }
    eventBus.emit('combat:potionUsed', { card, target });
  }

  _applySpell(card) {
    const damage = card.value.min;
    this.enemy.hp = Math.max(0, this.enemy.hp - damage);
    eventBus.emit(Events.COMBAT_DAMAGE, { target: 'enemy', damage });
    eventBus.emit(Events.UI_UPDATE_HP, { target: 'enemy', hp: this.enemy.hp, maxHp: this.enemy.maxHp });

    // Apply status effects from spells/abilities
    if (card.value.dot) {
      this.enemyStatus.apply('poison', {
        damagePerRound: card.value.dot,
        duration: card.value.dotRounds || 3,
      });
    }
    if (card.value.type === 'damageBonus') {
      this.playerStatus.apply('damageBonus', { statMod: { attack: card.value.min } });
    }
    if (card.value.type === 'resetEnemyGauge') {
      this.enemyMeter = 0;
    }
    if (card.value.type === 'reveal') {
      // TODO: reveal next dealer cards
    }
    // Card-specific status effects by name
    if (card.name === 'Icy Mist') {
      this.enemyStatus.apply('slow');
    }
    if (card.name === 'Sucker Punch') {
      this.enemyStatus.apply('daze');
    }

    this._emitStatusUpdate();
    eventBus.emit('combat:spellCast', { card, damage });

    // Check if enemy died from the spell/ability
    if (this.enemy.hp <= 0) {
      this.phase = PHASE.VICTORY;
      setTimeout(() => {
        eventBus.emit(Events.COMBAT_END, { result: 'victory', enemy: this.enemy });
      }, 300);
    }
  }

  // ---- STATUS EFFECTS ----

  _processStatusEffects() {
    // Player effects
    const playerResult = this.playerStatus.processRound();
    if (playerResult.damage > 0) {
      this.player.hp = Math.max(0, this.player.hp - playerResult.damage);
      eventBus.emit(Events.COMBAT_DAMAGE, { target: 'player', damage: playerResult.damage });
      eventBus.emit(Events.UI_UPDATE_HP, { target: 'player', hp: this.player.hp, maxHp: this.player.maxHp });
    }
    if (playerResult.healing > 0) {
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + playerResult.healing);
      eventBus.emit(Events.UI_UPDATE_HP, { target: 'player', hp: this.player.hp, maxHp: this.player.maxHp });
    }

    // Enemy effects
    const enemyResult = this.enemyStatus.processRound();
    if (enemyResult.damage > 0) {
      this.enemy.hp = Math.max(0, this.enemy.hp - enemyResult.damage);
      eventBus.emit(Events.COMBAT_DAMAGE, { target: 'enemy', damage: enemyResult.damage });
      eventBus.emit(Events.UI_UPDATE_HP, { target: 'enemy', hp: this.enemy.hp, maxHp: this.enemy.maxHp });
    }
    if (enemyResult.healing > 0) {
      this.enemy.hp = Math.min(this.enemy.maxHp, this.enemy.hp + enemyResult.healing);
      eventBus.emit(Events.UI_UPDATE_HP, { target: 'enemy', hp: this.enemy.hp, maxHp: this.enemy.maxHp });
    }

    this._emitStatusUpdate();
  }

  /** Apply on-strike effects (e.g. poisonous enemy trait) */
  _processOnStrike(attacker, defender, attackerSide) {
    const entity = attackerSide === 'player' ? this.player : this.enemy;
    const defenderStatus = attackerSide === 'player' ? this.enemyStatus : this.playerStatus;
    const defenderSide = attackerSide === 'player' ? 'enemy' : 'player';

    // Check enemy onStrike trait effects
    if (entity.onStrike) {
      for (const effect of entity.onStrike) {
        if (Math.random() < effect.chance) {
          defenderStatus.apply(effect.effect, {
            damagePerRound: effect.damage,
            duration: effect.rounds,
          });
          eventBus.emit('combat:statusApplied', {
            target: defenderSide,
            status: effect.effect,
            message: `${effect.effect}!`,
          });
        }
      }
    }

    // Weapon status effects
    // Knife: bleeding on hit
    // Hammer: stun on hit
  }

  _emitStatusUpdate() {
    eventBus.emit('combat:statusUpdate', {
      player: this.playerStatus.getDisplay(),
      enemy: this.enemyStatus.getDisplay(),
    });
  }

  // ---- GETTERS ----

  get isActive() {
    return this.phase !== PHASE.IDLE && this.phase !== PHASE.VICTORY && this.phase !== PHASE.DEFEAT;
  }

  get isPlayerTurn() {
    return this.phase === PHASE.PLAYER_TURN && !this.playerResolved;
  }

  get canPlayerAct() {
    return this.phase === PHASE.PLAYER_TURN;
  }
}

export { PHASE };
