export const THOUGHT_BUBBLE_LINES: readonly string[] = [
  'Neon never sleeps.', 'Rain tastes electric.', 'Memory feels rented.',
  'Signal is weak.', 'Sky is artificial.', 'I was upgraded.',
  'Am I original?', 'Time is leaking.', 'Battery feels low.',
  'City is watching.', 'I remember tomorrow.', 'Static in my head.',
  'Something feels patched.', 'I want more time.', 'System unstable.',
  'Too many lights.', 'Where did the stars go?', 'Identity pending.',
  'Reality buffering.', 'Is this my voice?', "That wasn't my memory.",
  'I feel synthetic.', 'Was I always here?', 'Sky smells like ozone.',
  'Future feels used.', 'Rain hides everything.', 'I was never young.',
  'Noise in the code.', 'Someone rewrote me.', 'Life is short.',
  'Data feels heavy.', 'I saw something.', 'I forgot something.',
  'The city hums.', 'Nothing feels clean.', 'Eyes in the dark.',
  'I need more life.', 'Is this real?', 'Memory glitch.',
  'Heartbeat lagging.', 'Too much neon.', 'Everything flickers.',
  'Signal lost.', 'Dreams feel injected.', 'I miss the sun.',
  'Who owns tomorrow?', 'I feel observed.', 'Was that a test?',
  'Fear feels programmed.', 'Rain feels warm.', 'Soul not found.',
  'Processing regret.', 'I was replaced.', 'Echo detected.',
  'Cloud cover permanent.', 'Trust is deprecated.', 'Something is off.',
  'Life feels borrowed.', 'Update required.', 'Human, maybe.',
  'Machine, maybe.', 'I remember fire.', 'Do you feel it?',
  'Silence is loud.', 'Hope feels outdated.', 'Shadows move wrong.',
  "Eyes don't blink.", 'Heartbeat artificial.', 'Sky is loading.',
  'Reality unstable.', 'Time expired.', 'System breathing.',
  'I want answers.', 'Am I awake?', 'Night is infinite.',
  'Signal encrypted.', 'Memory corrupted.', 'Data never dies.',
  'Cold light everywhere.', 'This rain remembers.', 'I was different.',
  'Not safe here.', 'Everything feels watched.', 'Future already sold.',
  "I don't age.", "I don't forget.", 'I forget too much.',
  'Life in beta.', 'Emotion detected.', 'Error in empathy.',
  'Stay quiet.', 'Keep moving.', "Don't look back.",
  'Someone listens.', 'Stay online.', 'Stay alive.',
  'Almost human.', 'Almost free.', 'Almost gone.',
];

export const CELEBRATION_LINES: readonly string[] = [
  'Target neutralized.', 'Objective secured.', 'That felt alive.',
  'Energy rising.', 'Signal amplified.', 'We move forward.',
  'That was clean.', 'Momentum acquired.', 'I felt that.',
  'Victory tastes electric.', 'Path cleared.', 'No hesitation.',
  'We ascend.', 'That was precise.', 'Adrenaline engaged.',
  'Status: dominant.', 'We break through.', 'That was flawless.',
  'All systems green.', 'Power surging.', 'Signal confirmed.',
  'We adapt.', 'We override.', 'We prevail.',
];

export function getRandomThought(): string {
  return THOUGHT_BUBBLE_LINES[Math.floor(Math.random() * THOUGHT_BUBBLE_LINES.length)];
}

export function getRandomCelebration(): string {
  return CELEBRATION_LINES[Math.floor(Math.random() * CELEBRATION_LINES.length)];
}
