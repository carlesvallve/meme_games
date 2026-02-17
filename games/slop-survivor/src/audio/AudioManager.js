// AudioManager.js — Configured AudioManager instance for Slop Survivor

import { AudioManager, DrumMachine } from '@sttg/audio';
import { TIER_CPM } from './music.js';

const drumMachine = new DrumMachine();

export const audioManager = new AudioManager({
  tierCpmMap: TIER_CPM,
  drumMachine,
  storageKey: 'slop-survivor-muted',
});

export { drumMachine };
