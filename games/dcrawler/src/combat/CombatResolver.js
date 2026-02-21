import { COMBAT } from '../core/Constants.js';

export class CombatResolver {
  resolve(playerMeter, enemyMeter, playerBusted, enemyBusted) {
    // Both busted
    if (playerBusted && enemyBusted) {
      return { winner: 'draw', attacks: 0, critical: false };
    }

    // One side busted
    if (playerBusted) {
      const overhead = playerMeter - COMBAT.TARGET;
      return { winner: 'enemy', attacks: overhead, critical: false, busted: true };
    }
    if (enemyBusted) {
      const overhead = enemyMeter - COMBAT.TARGET;
      return { winner: 'player', attacks: overhead, critical: false, busted: true };
    }

    // Both stood — compare meters
    if (playerMeter === enemyMeter) {
      return { winner: 'draw', attacks: 0, critical: false };
    }

    const winner = playerMeter > enemyMeter ? 'player' : 'enemy';
    const diff = Math.abs(playerMeter - enemyMeter);
    const critical = (winner === 'player' && playerMeter === COMBAT.TARGET) ||
                     (winner === 'enemy' && enemyMeter === COMBAT.TARGET);

    return { winner, attacks: diff, critical };
  }

  calculateDamage(attackerAtk, defenderDef, critical) {
    const base = Math.max(1, attackerAtk - defenderDef);
    return critical ? base * COMBAT.CRITICAL_BONUS : base;
  }
}
