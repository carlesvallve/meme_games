/**
 * Procedural space-invader sprite generator.
 *
 * Generates unique horizontally-symmetric pixel creatures with:
 * - Randomized body shape via density profiles
 * - Configurable grid size (small/simple to large/complex)
 * - Eyes (forced gaps in the face zone)
 * - Antennae/horns on top
 * - Legs/tentacles on bottom (animated between 2 frames)
 * - Color shading (shadow pixels on edges for depth)
 * - Humanoid body template (head, torso, arms, legs)
 * - Spaceship template (pointed nose, swept wings, engine pods)
 * - Per-type color palettes
 *
 * Pixel values: 0=transparent, 1=body, 2=highlight, 3=eye/cockpit, 4=shadow
 *
 * Usage:
 *   const gen = new InvaderGenerator(seed);
 *   const { frame1, frame2, width, height } = gen.generate();
 *   // Small simple creature:
 *   gen.generate({ rows: 7, halfW: 3 });
 *   // Large complex boss with shading:
 *   gen.generate({ rows: 13, halfW: 7, shading: true });
 *   // Humanoid player character:
 *   gen.generate({ humanoid: true, shading: true });
 *   // Spaceship:
 *   gen.generate({ spaceship: true, shading: true });
 */

// Simple seeded PRNG (mulberry32)
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface BodyShape {
  rows: number;
  halfW: number;
  profile: number[];
}

// Body shape templates — define fill probability per row
const BODY_SHAPES: BodyShape[] = [
  // Classic crab — wide body, thin top, legs
  { rows: 9, halfW: 6, profile: [0.2, 0.3, 0.7, 0.9, 1.0, 0.9, 0.8, 0.5, 0.3] },
  // Squid — tall narrow, tentacles
  { rows: 10, halfW: 5, profile: [0.15, 0.3, 0.5, 0.8, 0.9, 1.0, 0.9, 0.6, 0.4, 0.2] },
  // Beetle — round, compact
  { rows: 8, halfW: 6, profile: [0.3, 0.6, 0.9, 1.0, 1.0, 0.9, 0.6, 0.3] },
  // Tall alien — skinny, big head
  { rows: 11, halfW: 5, profile: [0.2, 0.4, 0.7, 0.9, 0.8, 0.6, 0.7, 0.8, 0.5, 0.3, 0.15] },
  // Wide crab — very wide, short
  { rows: 7, halfW: 7, profile: [0.25, 0.5, 0.85, 1.0, 0.9, 0.6, 0.3] },
  // Mushroom — big round top, thin stem/legs
  { rows: 9, halfW: 6, profile: [0.4, 0.8, 1.0, 1.0, 0.9, 0.5, 0.4, 0.3, 0.2] },
];

// Humanoid body shape templates — head, neck, torso, arms, legs
const HUMANOID_SHAPES: BodyShape[] = [
  // Standard humanoid — clear head/body/legs separation
  { rows: 13, halfW: 5, profile: [0.2, 0.55, 0.75, 0.65, 0.15, 0.55, 0.9, 0.85, 0.65, 0.35, 0.3, 0.3, 0.2] },
  // Stocky humanoid — wider, compact
  { rows: 11, halfW: 6, profile: [0.3, 0.65, 0.8, 0.6, 0.2, 0.7, 0.95, 0.85, 0.45, 0.35, 0.25] },
  // Tall thin humanoid — elongated
  { rows: 13, halfW: 4, profile: [0.2, 0.5, 0.7, 0.55, 0.15, 0.5, 0.8, 0.75, 0.6, 0.3, 0.25, 0.25, 0.15] },
  // Broad-shouldered — heroic proportions
  { rows: 13, halfW: 6, profile: [0.25, 0.6, 0.8, 0.7, 0.15, 0.65, 0.95, 0.9, 0.7, 0.35, 0.3, 0.3, 0.2] },
];

// Spaceship body shape templates — pointed nose, swept wings, engine pods
const SPACESHIP_SHAPES: BodyShape[] = [
  // Classic fighter — sharp nose, wide wings, narrow waist, engine pods
  { rows: 13, halfW: 5, profile: [0.05, 0.15, 0.25, 0.35, 0.5, 0.7, 0.95, 1.0, 0.6, 0.35, 0.55, 0.65, 0.45] },
  // Sleek interceptor — very narrow nose, dramatic wing sweep
  { rows: 13, halfW: 6, profile: [0.03, 0.1, 0.2, 0.3, 0.45, 0.65, 0.9, 1.0, 0.55, 0.3, 0.5, 0.6, 0.4] },
  // Heavy bomber — wider body, stubby wings
  { rows: 11, halfW: 5, profile: [0.08, 0.2, 0.4, 0.55, 0.75, 0.95, 1.0, 0.65, 0.5, 0.6, 0.45] },
  // Arrow fighter — thin and pointed
  { rows: 13, halfW: 4, profile: [0.05, 0.12, 0.22, 0.35, 0.5, 0.7, 0.9, 1.0, 0.55, 0.3, 0.45, 0.55, 0.35] },
];

export interface GenerateOptions {
  /** Override grid rows (height) */
  rows?: number;
  /** Override grid halfW (half width, total width = halfW * 2 + 1) */
  halfW?: number;
  /** Add shadow pixels (value 4) for depth on edges */
  shading?: boolean;
  /** Use humanoid body template (head, torso, arms, legs) */
  humanoid?: boolean;
  /** Use spaceship template (pointed nose, swept wings, engine pods) */
  spaceship?: boolean;
}

export interface InvaderResult {
  frame1: number[][];
  frame2: number[][];
  width: number;
  height: number;
}

export interface InvaderPalette {
  1: number; // body color
  2: number; // highlight color
  3: number; // eye color
  [key: number]: number;
}

export class InvaderGenerator {
  private rng: () => number;

  /**
   * @param seed — integer seed for deterministic generation
   */
  constructor(seed: number) {
    this.rng = mulberry32(seed);
  }

  /**
   * Generate a unique invader sprite with 2 animation frames.
   * Pixel values: 0=transparent, 1=body, 2=highlight, 3=eye, 4=shadow
   */
  generate(options?: GenerateOptions): InvaderResult {
    const rng = this.rng;
    const isHumanoid = options?.humanoid ?? false;
    const isSpaceship = options?.spaceship ?? false;

    // Pick a body shape from the appropriate pool
    const shapePool = isSpaceship ? SPACESHIP_SHAPES : isHumanoid ? HUMANOID_SHAPES : BODY_SHAPES;
    let shape = shapePool[Math.floor(rng() * shapePool.length)];

    // Override with custom size if specified
    if (options?.rows || options?.halfW) {
      const baseProfile = shape.profile;
      const targetRows = options.rows ?? shape.rows;
      const targetHalfW = options.halfW ?? shape.halfW;

      // Resample the profile to match the target row count
      const newProfile: number[] = [];
      for (let i = 0; i < targetRows; i++) {
        const srcIdx = (i / (targetRows - 1)) * (baseProfile.length - 1);
        const lo = Math.floor(srcIdx);
        const hi = Math.min(lo + 1, baseProfile.length - 1);
        const t = srcIdx - lo;
        newProfile.push(baseProfile[lo] * (1 - t) + baseProfile[hi] * t);
      }

      shape = { rows: targetRows, halfW: targetHalfW, profile: newProfile };
    }

    const { rows, halfW, profile } = shape;
    const width = halfW * 2 + 1; // odd width for center column
    const height = rows;

    // Generate the left half + center column
    const half: number[][] = [];
    for (let y = 0; y < rows; y++) {
      const row: number[] = [];
      const density = profile[y];
      for (let x = 0; x <= halfW; x++) {
        // Edge pixels are less likely
        const edgeFactor = 1 - (x / halfW) * 0.4;
        const filled = rng() < density * edgeFactor;
        row.push(filled ? 1 : 0);
      }
      half.push(row);
    }

    // Ensure body connectivity — fill gaps in the core (center 60%)
    const coreStart = Math.floor(rows * 0.2);
    const coreEnd = Math.ceil(rows * 0.75);
    for (let y = coreStart; y < coreEnd; y++) {
      const minFill = Math.max(2, Math.floor(halfW * 0.5));
      for (let x = 0; x < minFill; x++) {
        if (rng() < 0.85) half[y][x] = 1;
      }
    }

    // Add antennae/horns — top 1-2 rows, sparse isolated pixels at edges
    if (rng() < 0.6) {
      const antennaX = Math.floor(rng() * 2) + halfW - 2;
      if (antennaX >= 0 && antennaX <= halfW) {
        half[0][antennaX] = 1;
        if (rows > 8 && rng() < 0.4) {
          half[0][Math.max(0, antennaX - 1)] = 0;
        }
      }
    }

    // Structural enforcement
    if (isHumanoid) {
      this._enforceHumanoid(half, rows, halfW);
    } else if (isSpaceship) {
      this._enforceSpaceship(half, rows, halfW);
    }

    // Mirror to full grid
    const frame1 = this._mirrorToFull(half, width, halfW, rows);

    // Add eyes / cockpit
    if (isSpaceship) {
      // Cockpit: highlight pixel(s) in the upper-middle area
      const cockpitRow = Math.floor(rows * 0.25) + Math.floor(rng() * 2);
      if (cockpitRow < rows && frame1[cockpitRow][halfW] === 1) {
        frame1[cockpitRow][halfW] = 3; // cockpit canopy
        // Optional wider cockpit
        if (rng() < 0.5 && halfW > 2) {
          if (frame1[cockpitRow][halfW - 1] === 1) frame1[cockpitRow][halfW - 1] = 2;
          if (frame1[cockpitRow][halfW + 1] === 1) frame1[cockpitRow][halfW + 1] = 2;
        }
      }
    } else {
      // Eyes — find the face zone (roughly rows 25-45% from top)
      const eyeRowBase = isHumanoid ? Math.floor(rows * 0.15) : Math.floor(rows * 0.3);
      const eyeRow = eyeRowBase + Math.floor(rng() * 2);
      const eyeSpacing = 1 + Math.floor(rng() * 2);
      if (eyeRow < rows) {
        const eyeL = halfW - eyeSpacing;
        const eyeR = halfW + eyeSpacing;
        if (eyeL >= 0 && eyeR < width) {
          if (frame1[eyeRow][eyeL] === 1) frame1[eyeRow][eyeL] = 3;
          if (frame1[eyeRow][eyeR] === 1) frame1[eyeRow][eyeR] = 3;
        }
      }
    }

    // Add highlights — random body pixels (mirrored)
    const highlightChance = (options?.shading) ? 0.1 : 0.08;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x <= halfW; x++) {
        if (frame1[y][x] === 1 && rng() < highlightChance) {
          frame1[y][x] = 2;
          const mx = width - 1 - x;
          if (frame1[y][mx] === 1) frame1[y][mx] = 2;
        }
      }
    }

    // Generate frame 2 — modify bottom rows (leg/thrust animation)
    const frame2 = frame1.map(row => [...row]);
    if (isSpaceship) {
      // Spaceship: animate engine exhaust — toggle/extend thrust pixels
      this._animateSpaceshipThrust(frame2, rows, halfW, width);
    } else if (isHumanoid) {
      // Humanoid: animate legs by shifting leg pixels
      this._animateHumanoidLegs(frame2, half, rows, halfW, width, profile);
    } else {
      const legRows = Math.min(3, Math.floor(rows * 0.3));
      for (let y = rows - legRows; y < rows; y++) {
        for (let x = 0; x <= halfW; x++) {
          const density = profile[y] * 0.8;
          const filled = rng() < density;
          frame2[y][x] = filled ? 1 : 0;
          frame2[y][width - 1 - x] = frame2[y][x];
        }
      }
    }

    // Apply shading pass (shadow on bottom/right edges of body)
    if (options?.shading) {
      this._applyShading(frame1, width, rows);
      this._applyShading(frame2, width, rows);
    }

    return { frame1, frame2, width, height };
  }

  /**
   * Enforce humanoid structure: clear neck, separate legs, ensure head/torso connectivity.
   */
  private _enforceHumanoid(half: number[][], rows: number, halfW: number): void {
    const rng = this.rng;

    // Zone boundaries
    const headEnd = Math.floor(rows * 0.28);    // ~row 3-4
    const neckRow = headEnd;                      // the neck
    const torsoStart = headEnd + 1;
    const torsoEnd = Math.floor(rows * 0.62);     // ~row 8
    const legStart = torsoEnd + 1;

    // --- Neck: keep only center 1-2 columns ---
    if (neckRow < rows) {
      for (let x = 0; x <= halfW; x++) half[neckRow][x] = 0;
      half[neckRow][0] = 1;
      if (halfW > 3) half[neckRow][1] = rng() < 0.5 ? 1 : 0;
    }

    // --- Head: ensure center is filled, top has character ---
    for (let y = 1; y < headEnd; y++) {
      for (let x = 0; x < Math.min(halfW - 1, 4); x++) {
        if (half[y][x] === 0 && rng() < 0.7) half[y][x] = 1;
      }
    }

    // --- Torso: ensure center filled, arms can extend ---
    for (let y = torsoStart; y <= torsoEnd && y < rows; y++) {
      for (let x = 0; x < Math.min(halfW, 3); x++) {
        if (half[y][x] === 0 && rng() < 0.85) half[y][x] = 1;
      }
    }

    // --- Shoulders: ensure wide fill on first torso row ---
    if (torsoStart + 1 < rows) {
      for (let x = 0; x <= halfW; x++) {
        if (half[torsoStart + 1][x] === 0 && rng() < 0.6) {
          half[torsoStart + 1][x] = 1;
        }
      }
    }

    // --- Legs: clear center gap, fill two leg columns ---
    const legGap = Math.max(1, Math.floor(halfW * 0.25)); // gap from center
    const legOuter = Math.min(halfW, legGap + Math.max(1, Math.floor(halfW * 0.4)));

    for (let y = legStart; y < rows; y++) {
      for (let x = 0; x <= halfW; x++) half[y][x] = 0;
      // Fill leg columns
      for (let x = legGap; x <= legOuter; x++) {
        half[y][x] = 1;
      }
    }

    // --- Feet: slightly wider on last row ---
    if (rows - 1 >= legStart) {
      const footRow = rows - 1;
      const footInner = Math.max(0, legGap - 1);
      const footOuter = Math.min(halfW, legOuter + 1);
      for (let x = footInner; x <= footOuter; x++) {
        half[footRow][x] = 1;
      }
    }
  }

  /**
   * Enforce spaceship structure: pointed nose, swept wings, narrow waist, engine pods.
   * The ship flies "upward" (nose at row 0, engines at bottom).
   */
  private _enforceSpaceship(half: number[][], rows: number, halfW: number): void {
    const rng = this.rng;

    // --- Nose: rows 0-15% — narrow pointed tip, only center 1-2 columns ---
    const noseEnd = Math.floor(rows * 0.15);
    for (let y = 0; y <= noseEnd && y < rows; y++) {
      for (let x = 0; x <= halfW; x++) half[y][x] = 0;
      // Only center column (and maybe +1) at the very tip
      const noseWidth = y === 0 ? 0 : Math.min(y, 1);
      for (let x = 0; x <= noseWidth; x++) {
        half[y][x] = 1;
      }
    }

    // --- Fuselage: rows 15-45% — solid narrow body, growing outward ---
    const fuselageStart = noseEnd + 1;
    const fuselageEnd = Math.floor(rows * 0.45);
    for (let y = fuselageStart; y <= fuselageEnd && y < rows; y++) {
      const t = (y - fuselageStart) / Math.max(1, fuselageEnd - fuselageStart);
      const bodyWidth = Math.floor(1 + t * Math.min(halfW - 1, 3));
      // Ensure center body is filled
      for (let x = 0; x <= bodyWidth; x++) {
        if (half[y][x] === 0) half[y][x] = 1;
      }
    }

    // --- Wings: rows 45-65% — dramatic sweep outward, widest point ---
    const wingStart = fuselageEnd + 1;
    const wingEnd = Math.floor(rows * 0.65);
    for (let y = wingStart; y <= wingEnd && y < rows; y++) {
      const t = (y - wingStart) / Math.max(1, wingEnd - wingStart);
      // Wings extend to full halfW
      const wingExtent = Math.floor(2 + t * (halfW - 2));
      // Fill wing area
      for (let x = 0; x <= wingExtent; x++) {
        half[y][x] = 1;
      }
      // Wing tips: taper slightly
      if (t > 0.7 && wingExtent >= halfW - 1) {
        half[y][halfW] = rng() < 0.5 ? 1 : 0;
      }
      // Ensure center body stays solid
      for (let x = 0; x <= 2; x++) {
        half[y][x] = 1;
      }
    }

    // --- Waist: rows 65-75% — narrow behind wings ---
    const waistStart = wingEnd + 1;
    const waistEnd = Math.floor(rows * 0.75);
    for (let y = waistStart; y <= waistEnd && y < rows; y++) {
      for (let x = 0; x <= halfW; x++) half[y][x] = 0;
      // Keep center body
      const waistWidth = Math.max(1, Math.floor(halfW * 0.35));
      for (let x = 0; x <= waistWidth; x++) {
        half[y][x] = 1;
      }
    }

    // --- Engines: rows 75-100% — two engine pods (center + offset) ---
    const engineStart = waistEnd + 1;
    const engineOffset = Math.max(2, Math.floor(halfW * 0.55));
    const engineWidth = Math.max(1, Math.floor(halfW * 0.25));

    for (let y = engineStart; y < rows; y++) {
      for (let x = 0; x <= halfW; x++) half[y][x] = 0;
      // Center engine pod
      for (let x = 0; x <= Math.min(1, halfW); x++) {
        half[y][x] = 1;
      }
      // Side engine pod
      const podStart = Math.max(0, engineOffset - engineWidth);
      const podEnd = Math.min(halfW, engineOffset);
      for (let x = podStart; x <= podEnd; x++) {
        half[y][x] = 1;
      }
    }

    // --- Connect wings to engines with strut (1px line) ---
    for (let y = waistStart; y < engineStart && y < rows; y++) {
      const strutX = Math.max(0, Math.floor(engineOffset * 0.7));
      if (strutX <= halfW) half[y][strutX] = 1;
    }
  }

  /**
   * Animate spaceship thrust: toggle/extend engine exhaust pixels on frame2.
   */
  private _animateSpaceshipThrust(frame2: number[][], rows: number, halfW: number, width: number): void {
    const rng = this.rng;

    // Find engine rows (bottom ~25%)
    const engineStart = Math.floor(rows * 0.75);
    const lastRow = rows - 1;

    // For each column in the last row that has a body pixel,
    // that's an engine nozzle — extend exhaust below (overwrite last row with highlight)
    for (let x = 0; x < width; x++) {
      if (frame2[lastRow][x] === 1 || frame2[lastRow][x] === 4) {
        // Flicker: replace body with highlight for "glow" effect on frame2
        frame2[lastRow][x] = 2;
      }
    }

    // Shift engine section down by 1 row on frame2 (subtle thrust bob)
    // Work from bottom up to avoid overwriting
    if (engineStart + 1 < rows) {
      for (let y = lastRow; y > engineStart; y--) {
        for (let x = 0; x < width; x++) {
          if (y - 1 >= engineStart) {
            // If the source row had engine pixels, copy them
            const src = frame2[y - 1][x];
            if (src > 0) {
              frame2[y][x] = src;
            }
          }
        }
      }
      // Slightly randomize the thrust nozzle row
      for (let x = 0; x < width; x++) {
        if (frame2[lastRow][x] > 0 && rng() < 0.3) {
          frame2[lastRow][x] = 2; // highlight flicker
        }
      }
    }

    // Add slight wing wobble on frame2 — toggle outermost wing pixels
    const wingRow = Math.floor(rows * 0.55);
    if (wingRow < rows) {
      // Toggle edge pixels
      if (frame2[wingRow][0] === 1) frame2[wingRow][0] = rng() < 0.5 ? 0 : 1;
      if (frame2[wingRow][width - 1] === 1) frame2[wingRow][width - 1] = rng() < 0.5 ? 0 : 1;
    }
  }

  /**
   * Animate humanoid legs: shift leg pixels to create a walking motion.
   */
  private _animateHumanoidLegs(
    frame2: number[][], half: number[][], rows: number, halfW: number,
    width: number, _profile: number[]
  ): void {
    const rng = this.rng;
    const legStart = Math.floor(rows * 0.62) + 1;

    // For frame2: offset one leg down by 1px, other leg up
    for (let y = legStart; y < rows; y++) {
      for (let x = 0; x < width; x++) frame2[y][x] = 0;
    }

    const legGap = Math.max(1, Math.floor(halfW * 0.25));
    const legOuter = Math.min(halfW, legGap + Math.max(1, Math.floor(halfW * 0.4)));

    // Left leg: shifted down by 1
    for (let y = legStart; y < rows; y++) {
      const srcY = y - 1;
      if (srcY < legStart) continue;
      for (let x = legGap; x <= legOuter; x++) {
        const lx = halfW - x;
        if (lx >= 0 && lx < width) frame2[y][lx] = 1;
      }
    }

    // Right leg: shifted up by 1 (or stay)
    for (let y = legStart; y < rows - 1; y++) {
      for (let x = legGap; x <= legOuter; x++) {
        const rx = halfW + x;
        if (rx < width) frame2[y][rx] = 1;
      }
    }

    // Feet follow legs
    if (rows - 1 >= legStart) {
      const footInner = Math.max(0, legGap - 1);
      const footOuter = Math.min(halfW, legOuter + 1);
      // Left foot at bottom
      for (let x = footInner; x <= footOuter; x++) {
        const lx = halfW - x;
        if (lx >= 0 && lx < width && rows - 1 < rows) frame2[rows - 1][lx] = 1;
      }
      // Right foot one row up
      const rightFootY = Math.max(legStart, rows - 2);
      for (let x = footInner; x <= footOuter; x++) {
        const rx = halfW + x;
        if (rx < width) frame2[rightFootY][rx] = 1;
      }
    }

    // Add slight arm swing on frame2: toggle some arm pixels
    const torsoMid = Math.floor(rows * 0.5);
    if (torsoMid < rows) {
      // Clear outermost arm pixel on one side, add on other
      if (frame2[torsoMid][0] === 1 && rng() < 0.5) frame2[torsoMid][0] = 0;
      if (frame2[torsoMid][width - 1] === 1 && rng() < 0.5) frame2[torsoMid][width - 1] = 0;
    }
  }

  /**
   * Apply shading: body pixels adjacent to empty space below or to the right
   * become shadow (value 4). Also adds random interior shadow for texture.
   */
  private _applyShading(grid: number[][], width: number, rows: number): void {
    const rng = this.rng;
    // Work on a copy to avoid cascade effects
    const isBody = (y: number, x: number) =>
      y >= 0 && y < rows && x >= 0 && x < width && grid[y][x] > 0 && grid[y][x] !== 3;
    const isEmpty = (y: number, x: number) =>
      y < 0 || y >= rows || x < 0 || x >= width || grid[y][x] === 0;

    const toShade: [number, number][] = [];

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < width; x++) {
        if (grid[y][x] !== 1) continue;

        const belowEmpty = isEmpty(y + 1, x);
        const rightEmpty = isEmpty(y, x + 1);
        // Also check bottom-right for diagonal edges
        const diagEmpty = isEmpty(y + 1, x + 1);

        if (belowEmpty || rightEmpty) {
          toShade.push([y, x]);
        } else if (diagEmpty && rng() < 0.3) {
          toShade.push([y, x]);
        } else if (rng() < 0.04) {
          // Random interior shadow for texture on larger sprites
          toShade.push([y, x]);
        }
      }
    }

    for (const [y, x] of toShade) {
      grid[y][x] = 4;
    }
  }

  private _mirrorToFull(half: number[][], width: number, halfW: number, rows: number): number[][] {
    const grid: number[][] = [];
    for (let y = 0; y < rows; y++) {
      const row = new Array(width).fill(0);
      for (let x = 0; x <= halfW; x++) {
        row[halfW - x] = half[y][x]; // left side
        row[halfW + x] = half[y][x]; // right side (mirror)
      }
      grid.push(row);
    }
    return grid;
  }
}

/** Built-in color palettes for common enemy types. Index 4 = shadow (darker shade). */
export const INVADER_PALETTES: Record<string, InvaderPalette> = {
  GREEN:   { 1: 0x44ff44, 2: 0x88ff88, 3: 0xffffff, 4: 0x22aa22 },
  ORANGE:  { 1: 0xff8833, 2: 0xffbb66, 3: 0xffffff, 4: 0xcc6622 },
  PURPLE:  { 1: 0x9944ff, 2: 0xcc88ff, 3: 0xffffff, 4: 0x6622cc },
  RED:     { 1: 0xff4444, 2: 0xff8888, 3: 0xffff00, 4: 0xcc2222 },
  CYAN:    { 1: 0x44ddff, 2: 0x88eeff, 3: 0xffffff, 4: 0x2299cc },
  MAGENTA: { 1: 0xff44aa, 2: 0xff88cc, 3: 0xffffff, 4: 0xcc2288 },
  YELLOW:  { 1: 0xdddd22, 2: 0xffff66, 3: 0xff4444, 4: 0xaaaa11 },
  WHITE:   { 1: 0xdddddd, 2: 0xffffff, 3: 0xff4444, 4: 0x999999 },
};
