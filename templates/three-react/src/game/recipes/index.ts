// ── Progression Recipes Registry ────────────────────────────────────
// Import all built-in recipes and expose them as a name → recipe map.
// To add a new recipe: create the file, import here, add to RECIPES.

import type { ProgressionRecipe } from './types';
import { CLASSIC } from './classic';
import { BLITZ } from './blitz';
import { NIGHTMARE } from './nightmare';

export type { ProgressionRecipe, FloorZoneConfig, ThemedFloor } from './types';

/** All registered recipes, keyed by name. Mutable so registerRecipe() can add runtime entries. */
export const RECIPES: Record<string, ProgressionRecipe> = {
  [CLASSIC.name]: CLASSIC,
  [BLITZ.name]: BLITZ,
  [NIGHTMARE.name]: NIGHTMARE,
};

/** Default recipe name (must be a key in RECIPES). */
export const DEFAULT_RECIPE = CLASSIC.name;
