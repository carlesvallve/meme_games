import type { CharacterModelOpts } from './CharacterModel';

/** Shared animation set GLBs — loaded once and cached globally.
 *  Each contains constraint-retargeted animations for the Imminence skeleton. */
export const ANIM_SETS = [
  { id: 'Idles', url: '/models/scifi-soldiers/anims/Idles.glb' },
  { id: 'Movement', url: '/models/scifi-soldiers/anims/Movement.glb' },
  { id: 'Combat', url: '/models/scifi-soldiers/anims/Combat.glb' },
  { id: 'Social', url: '/models/scifi-soldiers/anims/Social.glb' },
  { id: 'Misc', url: '/models/scifi-soldiers/anims/Misc.glb' },
  { id: 'Work', url: '/models/scifi-soldiers/anims/Work.glb' },
];

export interface CharacterModelDef {
  id: string;
  label: string;
  /** null = placeholder box (no GLB) */
  opts: Omit<CharacterModelOpts, 'onLoaded'> | null;
}

export const CHARACTER_MODELS: CharacterModelDef[] = [
  { id: 'none', label: 'Box (default)', opts: null },
  {
    id: 'imminence-male',
    label: 'Imminence Male',
    opts: { meshUrl: '/models/scifi-soldiers/Imminence-Update-Male.glb', scale: 0.5, rotation: [0, 0, 0] },
  },
  {
    id: 'imminence-female',
    label: 'Imminence Female',
    opts: { meshUrl: '/models/scifi-soldiers/Imminence-Update-Female.glb', scale: 0.5, rotation: [0, 0, 0] },
  },
];
