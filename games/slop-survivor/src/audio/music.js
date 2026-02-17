// music.js — Strudel BGM patterns for Slop Survivor
// Dark synthwave / Stranger Things 80s vibes with adaptive intensity layers

import { stack, note } from '@strudel/web';

// --- Menu Theme: Dark, glitchy, sinister tech vibes ---
export function menuTheme() {
  return stack(
    // Eerie pad — minor chord drone, long slow progression
    note('<e2,g2,b2> <e2,g2,b2> <e2,g2,b2> <c2,e2,g2> <c2,e2,g2> <c2,e2,g2> <d2,f2,a2> <e2,g2,b2>')
      .s('sine')
      .attack(0.8)
      .release(2.0)
      .gain(0.12)
      .room(0.6)
      .roomsize(5)
      .lpf('<1400 1200 1400 1600>')
      .slow(4),

    // Glitchy melody — sparse, chromatic, bit-crushed, very long phrase
    note('~ e4 ~ ~ ~ ~ eb4 ~ ~ ~ d4 ~ ~ ~ ~ ~ ~ c4 ~ ~ ~ ~ ~ ~ ~ ~ e4 ~ ~ ~ ~ ~')
      .s('square')
      .gain(0.1)
      .lpf(1800)
      .crush(10)
      .decay(0.2)
      .sustain(0)
      .delay(0.3)
      .delaytime(0.5)
      .delayfeedback(0.4)
      .room(0.4)
      .slow(2),

    // Sub bass pulse — very sparse
    note('e1 ~ ~ ~ ~ ~ ~ ~ e1 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ c1 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~')
      .s('sine')
      .gain(0.15)
      .lpf(300)
      .slow(2),

    // Digital glitch texture — rare sparkles
    note('e5 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ g5 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~')
      .s('square')
      .gain(0.04)
      .crush(6)
      .lpf(2000)
      .decay(0.05)
      .sustain(0)
      .delay(0.4)
      .delaytime(0.375)
      .delayfeedback(0.5)
      .slow(2)
  ).cpm(55).play();
}

// ============================================================
// Gameplay BGM — Adaptive intensity layers (tiers 1-5)
// Each tier adds more layers on top of the previous.
// ============================================================

// Layer definitions — each returns a Strudel pattern fragment
// Patterns are deliberately long (16-32 steps) with lots of rests (~)
// so they breathe and don't feel repetitive on short loops.
const layers = {
  // Always present: deep pulsing bass — 32-step pattern with variation
  bass() {
    return note('e1 ~ e1 ~ ~ e1 ~ ~ g1 ~ ~ g1 ~ ~ a1 ~ e1 ~ ~ e1 ~ e1 ~ ~ d1 ~ ~ d1 ~ ~ e1 ~')
      .s('sawtooth')
      .gain(0.18)
      .lpf('<350 400 350 300>')
      .lpq(4)
      .attack(0.01)
      .decay(0.15)
      .sustain(0.6)
      .release(0.05);
  },

  // Tier 1+: Warm pad wash — long slow chords, 8 chords over 4 cycles
  pad() {
    return note('<e3,g3,b3> <e3,g3,b3> <e3,g3,b3> <a2,c3,e3> <a2,c3,e3> <d3,f3,a3> <d3,f3,a3> <e3,g3,b3> <c3,e3,g3> <c3,e3,g3> <a2,c3,e3> <a2,c3,e3> <d3,f3,a3> <d3,f3,a3> <g2,b2,d3> <e3,g3,b3>')
      .add(note('0,.07'))
      .s('sawtooth')
      .gain(0.06)
      .lpf('<1400 1600 1800 1600>')
      .lpq(2)
      .attack(0.3)
      .decay(0.5)
      .sustain(0.4)
      .release(0.8)
      .room(0.35)
      .roomsize(4)
      .slow(4);
  },

  // Tier 2+: Sparse synthwave arpeggio — lots of rests, delay fills the gaps
  arp() {
    return note('e3 ~ ~ b3 ~ ~ ~ ~ e4 ~ ~ ~ ~ ~ ~ ~ a3 ~ ~ ~ e4 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~')
      .s('sawtooth')
      .gain(0.06)
      .lpf('<1200 1600 1200 1400>')
      .lpq(4)
      .decay(0.12)
      .sustain(0.05)
      .release(0.1)
      .delay(0.25)
      .delaytime(0.375)
      .delayfeedback(0.4)
      .room(0.3);
  },

  // Tier 3+: Synthesized electronic drums
  drums() {
    return stack(
      // Kick — low sine thump
      note('<[e1 e1 ~ e1] [e1 ~ e1 ~]>')
        .s('sine')
        .gain(0.3)
        .decay(0.12)
        .sustain(0)
        .lpf(200),
      // Snare — noise burst via high square
      note('<[~ ~ c5 ~] [~ c5 ~ c5]>')
        .s('square')
        .gain(0.08)
        .decay(0.06)
        .sustain(0)
        .crush(4)
        .lpf(3000),
      // Hi-hat — very short high square ticks
      note('[g6*8]')
        .s('square')
        .gain(0.04)
        .decay(0.02)
        .sustain(0)
        .lpf(5000)
        .crush(6)
    );
  },

  // Tier 2+: Haunting lead — very sparse, mostly silence, delay does the work
  lead() {
    return note('~ ~ e4 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ g4 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ b4 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ a4 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~')
      .s('square')
      .gain(0.07)
      .lpf('<1800 1600 2000 1800>')
      .decay(0.3)
      .sustain(0.1)
      .release(0.6)
      .delay(0.3)
      .delaytime(0.5)
      .delayfeedback(0.45)
      .room(0.4)
      .slow(4);
  },

  // Tier 4+: Dark texture pulse — slow, sparse, crushed accents
  arp2() {
    return note('~ ~ b3 ~ ~ ~ ~ ~ ~ ~ e4 ~ ~ ~ ~ ~ ~ ~ ~ ~ g4 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~')
      .s('square')
      .gain(0.04)
      .lpf('<800 1200 1600 1000>')
      .decay(0.15)
      .sustain(0)
      .crush(10)
      .delay(0.3)
      .delaytime(0.5)
      .delayfeedback(0.45)
      .room(0.4)
      .slow(2);
  },

  // Tier 4+: Driving double-time synthesized drums
  drumsHeavy() {
    return stack(
      // Heavy kick — fast double hits
      note('<[e1 e1 ~ e1] [e1 e1 e1 ~]>')
        .s('sine')
        .gain(0.35)
        .decay(0.1)
        .sustain(0)
        .lpf(180)
        .fast(2),
      // Snare — harder, more crushed
      note('<[~ ~ c5 ~] [~ c5 ~ c5]>')
        .s('square')
        .gain(0.1)
        .decay(0.07)
        .sustain(0)
        .crush(3)
        .lpf(4000),
      // Hi-hat — 16th notes
      note('[g6*16]')
        .s('square')
        .gain(0.05)
        .decay(0.015)
        .sustain(0)
        .lpf(6000)
        .crush(5),
      // Open hat accent
      note('<[~ g5 ~ g5] [g5 ~ ~ g5]>')
        .s('square')
        .gain(0.04)
        .decay(0.08)
        .sustain(0)
        .lpf(4000)
        .crush(6)
    );
  },

  // Tier 5: Distorted bass overtone — 16-step with breathing room
  distBass() {
    return note('e2 ~ e2 ~ g2 ~ a2 ~ e2 ~ ~ ~ d2 ~ e2 ~')
      .s('sawtooth')
      .gain(0.12)
      .lpf('<800 900 800 700>')
      .lpq(8)
      .distort(2)
      .decay(0.1)
      .sustain(0.5);
  },

  // Tier 5: High shimmer chaos — 16-step sparse, heavy delay fills the space
  shimmer() {
    return note('e5 ~ ~ b5 ~ ~ ~ g5 ~ ~ e5 ~ ~ ~ b5 ~')
      .s('sine')
      .gain(0.04)
      .delay(0.4)
      .delaytime(0.1875)
      .delayfeedback(0.6)
      .room(0.5)
      .lpf(5000)
      .decay(0.08)
      .sustain(0)
      .slow(2);
  },
};

// Tier definitions — which layers are active at each intensity level
// NOTE: drums are handled by DrumMachine (Web Audio API) — not Strudel
const TIER_LAYERS = {
  1: ['bass', 'pad'],
  2: ['bass', 'pad', 'lead'],
  3: ['bass', 'pad', 'lead'],
  4: ['bass', 'pad', 'lead', 'distBass'],
  5: ['bass', 'pad', 'lead', 'distBass', 'shimmer'],
};

export const TIER_CPM = {
  1: 110,
  2: 118,
  3: 125,
  4: 132,
  5: 140,
};

/**
 * Build and play the gameplay BGM at a given intensity tier.
 * @param {number} tier - 1 (calm) to 5 (chaos)
 */
export function gameplayBGM(tier = 1) {
  const t = Math.max(1, Math.min(5, tier));
  const layerNames = TIER_LAYERS[t];
  const cpm = TIER_CPM[t];

  const activePatterns = layerNames.map(name => layers[name]());
  return stack(...activePatterns).cpm(cpm).play();
}

// --- Game Over Theme: Slow, melancholy, digital decay ---
export function gameOverTheme() {
  return stack(
    // Descending melody — somber, long phrase with lots of silence
    note('b4 ~ ~ a4 ~ ~ g4 ~ ~ ~ e4 ~ ~ ~ d4 ~ ~ ~ ~ c4 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~')
      .s('triangle')
      .gain(0.16)
      .decay(0.5)
      .sustain(0.1)
      .release(1.0)
      .room(0.6)
      .roomsize(5)
      .lpf(1800)
      .crush(12),

    // Dark minor pad — slow chord changes
    note('<a2,c3,e3> <a2,c3,e3> <a2,c3,e3> <a2,c3,e3> <e2,g2,b2> <e2,g2,b2> <e2,g2,b2> <e2,g2,b2>')
      .s('sine')
      .attack(0.6)
      .release(2.5)
      .gain(0.1)
      .room(0.7)
      .roomsize(6)
      .lpf(1200)
      .slow(4),

    // Distant digital echo — very sparse
    note('~ ~ ~ ~ e5 ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~')
      .s('square')
      .gain(0.03)
      .crush(8)
      .delay(0.5)
      .delaytime(0.6)
      .delayfeedback(0.5)
      .room(0.5)
      .lpf(2000)
      .slow(2)
  ).slow(2).cpm(50).play();
}
