// Developer wisdom & algorithm one-liners shown when picking up powerups.
// Each powerup type has a pool of quotes; one is picked at random.
// Keep quotes short — max ~3 lines on a card.

export const POWERUP_QUOTES = {
  CODE_REVIEW: [
    { speaker: 'PR Reviewer', text: 'Merging all slop into /dev/null. LGTM!' },
    { speaker: 'Senior Dev', text: '"Always code as if the maintainer is a violent psychopath."' },
    { speaker: 'Git Merge', text: 'Resolving conflicts... by force.' },
    { speaker: 'Linus T.', text: '"Talk is cheap. Show me the code."' },
    { speaker: 'PR Comment', text: 'Requested changes: DELETE EVERYTHING.' },
    { speaker: 'CI/CD', text: 'Pipeline triggered. All slop pulled in.' },
  ],
  GITIGNORE: [
    { speaker: '.gitignore', text: 'node_modules/\n*.slop\nShield activated!' },
    { speaker: 'Senior Dev', text: '"The best code is no code at all."' },
    { speaker: 'Grace Hopper', text: '"The most dangerous phrase: we\'ve always done it this way."' },
    { speaker: 'Martin Fowler', text: '"Good programmers write code that humans can understand."' },
    { speaker: '.gitignore', text: '*.ai-generated\ncopilot.suggestions\nInvincibility!' },
    { speaker: 'Ken Thompson', text: '"My most productive day was throwing away 1,000 lines."' },
    { speaker: '.gitignore', text: 'vibe_coded/**\n*.hallucination\nSlop shield online!' },
    { speaker: 'Linus Torvalds', text: '"Good programmers worry about data structures."' },
    { speaker: '.gitignore', text: '# do not commit\nmy_genius_idea.js\nForce field active!' },
  ],
  LINTER: [
    { speaker: 'ESLint', text: 'Warning: unused variable "aiSlop" at line 42.' },
    { speaker: 'Robert C. Martin', text: '"Clean code looks like it was written by someone who cares."' },
    { speaker: 'The Linter', text: 'error: Expected semicolon.\nerror: "slop" is not defined.' },
    { speaker: 'Alan Turing', text: '"We can only see a short distance ahead, but plenty to do."' },
    { speaker: 'Strict Mode', text: '"use strict";\nNo more sloppy code!' },
    { speaker: 'ESLint', text: 'error: no-console (x47)\nfix: delete everything' },
    { speaker: 'Guido van Rossum', text: '"Code is read much more often than it is written."' },
    { speaker: 'TypeScript', text: 'Type "slop" is not assignable to type "quality".' },
    { speaker: 'Rich Hickey', text: '"Simplicity is a prerequisite for reliability."' },
    { speaker: 'Prettier', text: 'Reformatting slop...\n✓ 847 files fixed' },
  ],
  TRIPLE_SHOT: [
    { speaker: 'Triple Shot', text: 'Three times the firepower!' },
    { speaker: 'Multithread', text: 'Running three threads in parallel. What could go wrong?' },
    { speaker: 'Senior Dev', text: '"Why fire one when you can fire three?"' },
    { speaker: 'Fork Bomb', text: ':(){ :|:& };: — but for lasers!' },
    { speaker: 'Load Balancer', text: 'Distributing damage across three lanes.' },
    { speaker: 'Git Branch', text: 'Three branches, zero merge conflicts.' },
  ],
  MINES: [
    { speaker: 'DevOps', text: 'Deploying landmines to production... YOLO!' },
    { speaker: 'Mine Layer', text: 'Every step leaves a surprise for the slop!' },
    { speaker: 'Junior Dev', text: '"I left some TODO bombs in the codebase."' },
    { speaker: 'Git Blame', text: 'These mines are YOUR problem now.' },
    { speaker: 'CI Pipeline', text: 'Build failed. Explosively.' },
    { speaker: 'Tech Debt', text: 'Planting time bombs since 2024.' },
  ],
  HOMING: [
    { speaker: 'Homing Missiles', text: 'Lock on. Fire. Forget. Let missiles debug.' },
    { speaker: 'Senior Dev', text: '"Write code that seeks out problems automatically."' },
    { speaker: 'Garbage Collector', text: 'Auto-targeting enabled. No slop escapes.' },
    { speaker: 'Smart Pointer', text: 'Better aim than your average AI suggestion.' },
    { speaker: 'Seek & Destroy', text: 'Heat-seeking missiles. Slop temperature: critical.' },
    { speaker: 'Runtime', text: 'Launching guided refactors at all detected slop.' },
  ],
};
