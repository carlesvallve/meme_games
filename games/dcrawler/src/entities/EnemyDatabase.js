export const ENEMY_TYPES = {
  RAT: {
    name: 'Rat',
    type: 'rat',
    symbol: 'R',
    color: 0x999999,
    hp: 12,
    attack: 3,
    defense: 1,
    aggression: 1.5,
    maxSteps: 7,
    xpReward: 5,
    goldReward: 2,
  },
  SKELETON: {
    name: 'Skeleton',
    type: 'skeleton',
    symbol: 'S',
    color: 0xcccccc,
    hp: 20,
    attack: 4,
    defense: 2,
    aggression: 1,
    maxSteps: 9,
    xpReward: 10,
    goldReward: 5,
  },
  GOBLIN: {
    name: 'Goblin',
    type: 'goblin',
    symbol: 'G',
    color: 0x88aa88,
    hp: 15,
    attack: 5,
    defense: 1,
    aggression: 1.5,
    maxSteps: 8,
    xpReward: 8,
    goldReward: 8,
  },
  GHOST: {
    name: 'Ghost',
    type: 'ghost',
    symbol: 'W',
    color: 0xaaaacc,
    hp: 18,
    attack: 6,
    defense: 0,
    aggression: 0.8,
    maxSteps: 9,
    xpReward: 12,
    goldReward: 3,
  },
  KNIGHT: {
    name: 'Dark Knight',
    type: 'knight',
    symbol: 'K',
    color: 0x666688,
    hp: 30,
    attack: 6,
    defense: 4,
    aggression: 1,
    maxSteps: 11,
    xpReward: 20,
    goldReward: 15,
  },
  DEMON: {
    name: 'Demon',
    type: 'demon',
    symbol: 'D',
    color: 0xcc6666,
    hp: 40,
    attack: 8,
    defense: 3,
    aggression: 1.8,
    maxSteps: 12,
    xpReward: 30,
    goldReward: 20,
  },
};

// Floor-based enemy pools
const FLOOR_POOLS = [
  ['RAT', 'RAT', 'GOBLIN'],                     // Floor 1
  ['RAT', 'SKELETON', 'GOBLIN'],                 // Floor 2
  ['SKELETON', 'GOBLIN', 'GHOST'],               // Floor 3
  ['SKELETON', 'GHOST', 'KNIGHT'],               // Floor 4
  ['GHOST', 'KNIGHT', 'DEMON'],                  // Floor 5+
];

export function getEnemyForFloor(floor) {
  const poolIndex = Math.min(floor - 1, FLOOR_POOLS.length - 1);
  const pool = FLOOR_POOLS[poolIndex];
  const type = pool[Math.floor(Math.random() * pool.length)];
  return ENEMY_TYPES[type];
}
