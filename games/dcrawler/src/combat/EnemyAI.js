/**
 * Enemy AI ported from battlecards.
 * Simple risk assessment: roll random 1-6 * precaution, if <= remaining room, hit.
 */
export class EnemyAI {
  /**
   * @param {number} currentMeter - Enemy's current meter value
   * @param {number} playerMeter - Player's current meter value
   * @param {boolean} playerResolved - Whether player has stood
   * @param {number} aggression - 0.5=coward, 1=normal, 1.5=aggressive
   * @param {number} maxSteps - Enemy's max steps (5-11)
   * @returns {'hit'|'stand'}
   */
  decide(currentMeter, playerMeter, playerResolved, aggression = 1, maxSteps = 12) {
    const left = maxSteps - currentMeter;

    // Already at or over max — must stand
    if (left <= 0) return 'stand';

    // Battlecards formula: random 1-6 * precaution factor
    const precaution = 1 / Math.max(0.5, aggression); // aggressive = low precaution
    const roll = (1 + Math.floor(Math.random() * 6)) * precaution;

    if (roll <= left) return 'hit';

    return 'stand';
  }
}
