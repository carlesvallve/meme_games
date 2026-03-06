import * as THREE from 'three';
import type { Input, InputState } from './core/Input';
import type { Camera, PostProcessStack, DeathSequence, SceneSky, SceneLights } from './rendering';
import type { Environment } from './environment';
import type { Character, CharacterType } from './character';
import type { EnemySystem } from './enemies';
import type { ProjectileSystem, PropDestructionSystem, LootSystem, GoreSystem, PotionEffectSystem, PotionVFX } from './combat';
import type { CollectibleSystem, ChestSystem, SpeechBubbleSystem } from './props';
import type { ParticleToggles, LightPreset } from '../store';
import type { ParticleSystem } from '../types';
import type { LevelSnapshot } from './dungeon';
import type { SkyColors } from './rendering';

export interface KickedPotion {
  mesh: THREE.Mesh;
  colorIndex: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  bounces: number;
  rolling: boolean;
  stopped: boolean;
}

export interface CharInventory {
  collectibles: number;
  coins: number;
  potionInventory: Array<{ colorIndex: number; count: number }>;
}

/**
 * Shared mutable state container for the game.
 * All sub-modules receive this and read/write from it.
 */
export interface GameContext {
  // Core
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  cam: Camera;
  postProcess: PostProcessStack;
  input: Input;
  sceneLights: SceneLights;
  sceneSky: SceneSky;

  // Terrain + nav
  terrain: Environment;
  navGrid: ReturnType<Environment['buildNavGrid']>;

  // Characters
  characters: Character[];
  activeCharacter: Character | null;
  lastSelectedCharacter: CharacterType | null;

  // Systems
  enemySystem: EnemySystem | null;
  projectileSystem: ProjectileSystem | null;
  propDestructionSystem: PropDestructionSystem | null;
  collectibles: CollectibleSystem;
  lootSystem: LootSystem;
  potionSystem: PotionEffectSystem;
  potionVFX: PotionVFX;
  chestSystem: ChestSystem;
  goreSystem: GoreSystem;
  deathSequence: DeathSequence;
  speechSystem: SpeechBubbleSystem;

  // Particles
  particleSystems: Record<keyof ParticleToggles, ParticleSystem | null>;
  prevToggles: ParticleToggles;

  // Kicked potions
  kickedPotions: KickedPotion[];

  // State flags
  needsFullRegen: boolean;
  exitTriggered: boolean;
  portalCooldown: number;
  potionHudTimer: number;
  hmrReused: boolean;

  // Hitstop
  hitstopTimer: number;

  // Lighting/grid sync
  currentLightPreset: LightPreset;
  lastIsExterior: boolean;
  currentGridOpacity: number;
  currentRoomLabels: boolean;
  currentDebugDebris: boolean;

  // Input state cache
  cachedInputState: InputState;

  // Per-character inventory
  inventories: Map<string, CharInventory>;

  // Click marker
  clickMarker: THREE.Mesh;
  markerMat: THREE.MeshBasicMaterial;
  markerLife: number;

  // Raycasting shared objects
  raycaster: THREE.Raycaster;
  pointerNDC: THREE.Vector2;
  _planeHit: THREE.Vector3;

  // Day cycle
  sunDebugHelper: THREE.Group | null;
  baseSkyColors: SkyColors;

  // Overworld sky crossfade
  skyCrossfade: {
    from: SkyColors;
    to: SkyColors;
    progress: number; // 0→1
    duration: number;  // seconds
    active: boolean;
  } | null;

  // Debug
  debugLadderIndex: number;

  // Pointer drag
  pointerDragActive: boolean;
  lastDragX: number;
  lastDragZ: number;

  // RAF
  rafId: number;
  lastTime: number;

  // Pending snapshot
  pendingSnapshot: LevelSnapshot | null;

  // Game started (distinguishes initial boot from playing)
  gameStarted: boolean;

  // POI dungeon enter prompt
  dungeonEnterPrompt: THREE.Sprite | null;
  dungeonEnterPromptTarget: { x: number; y: number; z: number } | null;
  /** Last overworld tile index the player stood on (for tile-enter announcements) */
  lastOverworldTile: number | null;

  // Edge travel prompt (heightmap → neighbor tile)
  edgeTravelPrompt: THREE.Sprite | null;
  edgeTravelEnterPrompt: THREE.Sprite | null;
}
