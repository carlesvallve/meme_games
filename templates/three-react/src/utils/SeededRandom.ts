// ── Seedable PRNG (mulberry32) ──────────────────────────────────────

export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  /** Returns [0, 1) like Math.random() */
  next(): number {
    this.state |= 0;
    this.state = this.state + 0x6D2B79F5 | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max) */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min));
  }

  /** Pick a random element from an array */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length)];
  }

  /** Shuffle an array in-place (Fisher-Yates) */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** Deterministic seed for a given floor number */
export function floorSeed(baseSeed: number, floor: number): number {
  // Mix floor into the base seed with a simple hash
  let h = baseSeed ^ (floor * 2654435761);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}
