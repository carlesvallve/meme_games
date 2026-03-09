import * as THREE from 'three';
import {
  useGameStore,
  DEFAULT_CAMERA_PARAMS,
  DEFAULT_LIGHT_PRESET,
  DEFAULT_TORCH_PARAMS,
  DEFAULT_POST_PROCESS,
  DEFAULT_PARTICLE_TOGGLES,
} from '../store';
import type { ParticleToggles } from '../store';
import { Input } from './core/Input';
import { entityRegistry } from './core/Entity';
import {
  Camera,
  createScene,
  applyLightPreset,
  PostProcessStack,
  getSkyColors,
  updateDayCycle,
  computeSunDirection,
  createSunDebugHelper,
  updateSunDebug,
  disposeSunDebugHelper,
  WorldRevealFX,
  updateOcclusionReveal,
} from './rendering';
import type { GameInstance, ParticleSystem } from '../types';
import {
  createDustMotes,
  createRainEffect,
  createDebrisEffect,
} from '../utils/particles';
import { DestructionSystem } from './DestructionSystem';
import { NavGrid } from './pathfinding/NavGrid';
import { CharacterController } from './CharacterController';
import { GridOverlay } from './GridOverlay';
import { ObstacleGenerator } from './ObstacleGenerator';
import { LadderSystem } from './LadderSystem';
import { LadderGenerator } from './LadderGenerator';
import { audioSystem } from './AudioSystem';
import { audioSystem as sfxAudio } from '../utils/AudioSystem';
import {
  WORLD_SIZE,
  GROUND_COLOR,
  CAPSULE_RADIUS,
  GOAL_DRAG_THRESHOLD,
} from './GameConstants';
import { CHARACTER_MODELS } from './CharacterModelDefs';

// ── Particle helpers ─────────────────────────────────────────────────

interface ParticleSystems {
  dust: ParticleSystem | null;
  lightRain: ParticleSystem | null;
  rain: ParticleSystem | null;
  debris: ParticleSystem | null;
}

function syncParticles(
  scene: THREE.Scene,
  toggles: ParticleToggles,
  prev: ParticleToggles,
  systems: ParticleSystems,
): void {
  // Dust
  if (toggles.dust && !prev.dust) {
    systems.dust = createDustMotes({ area: { x: 20, y: 8, z: 20 } });
    scene.add(systems.dust.group);
  } else if (!toggles.dust && systems.dust) {
    scene.remove(systems.dust.group);
    systems.dust.dispose();
    systems.dust = null;
  }

  // Light rain
  if (toggles.lightRain && !prev.lightRain) {
    systems.lightRain = createRainEffect({ intensity: 'light' });
    scene.add(systems.lightRain.group);
  } else if (!toggles.lightRain && systems.lightRain) {
    scene.remove(systems.lightRain.group);
    systems.lightRain.dispose();
    systems.lightRain = null;
  }

  // Rain
  if (toggles.rain && !prev.rain) {
    systems.rain = createRainEffect({ intensity: 'normal' });
    scene.add(systems.rain.group);
  } else if (!toggles.rain && systems.rain) {
    scene.remove(systems.rain.group);
    systems.rain.dispose();
    systems.rain = null;
  }

  // Debris
  if (toggles.debris && !prev.debris) {
    systems.debris = createDebrisEffect();
    scene.add(systems.debris.group);
  } else if (!toggles.debris && systems.debris) {
    scene.remove(systems.debris.group);
    systems.debris.dispose();
    systems.debris = null;
  }
}

/** Find an animation clip by keyword across both grouped ("Movement/Run01") and flat ("Run") names. */
function resolveAnim(model: { getAnimationNames(): string[] }, keyword: string): string | null {
  const names = model.getAnimationNames();
  // 1. Exact match (case-sensitive)
  if (names.includes(keyword)) return keyword;
  // 2. Case-insensitive exact match on full name
  const lower = keyword.toLowerCase();
  const exact = names.find(n => n.toLowerCase() === lower);
  if (exact) return exact;
  // 3. Exact match on suffix after "/" (e.g. "Run" matches "Movement/Run")
  const suffixExact = names.find(n => {
    const slash = n.lastIndexOf('/');
    if (slash < 0) return false;
    return n.slice(slash + 1).toLowerCase() === lower;
  });
  if (suffixExact) return suffixExact;
  // 4. Partial match — keyword is a prefix of the suffix
  //    Strongly prefer exact-length suffix matches over longer ones
  const matches = names.filter(n => {
    const last = n.includes('/') ? n.slice(n.lastIndexOf('/') + 1) : n;
    return last.toLowerCase().startsWith(lower);
  });
  if (matches.length > 0) {
    // Sort: exact suffix length first, then by total name length
    return matches.sort((a, b) => {
      const aLast = a.includes('/') ? a.slice(a.lastIndexOf('/') + 1) : a;
      const bLast = b.includes('/') ? b.slice(b.lastIndexOf('/') + 1) : b;
      // If one suffix exactly equals the keyword, prefer it
      const aExact = aLast.toLowerCase() === lower ? 0 : 1;
      const bExact = bLast.toLowerCase() === lower ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return a.length - b.length;
    })[0];
  }
  return null;
}

export function createGame(canvas: HTMLCanvasElement): GameInstance {
  // ── Renderer ────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;

  // ── Scene ───────────────────────────────────────────────────────────
  const { scene, lights: sceneLights, sceneSky } = createScene();
  const initialLightPreset = useGameStore.getState().lightPreset;
  applyLightPreset(sceneLights, initialLightPreset, true);

  // Base sky colors for day cycle blending
  const baseSkyColors = getSkyColors('meadow');

  // ── Camera ──────────────────────────────────────────────────────────
  const initialCamParams = useGameStore.getState().cameraParams;
  const cam = new Camera(window.innerWidth / window.innerHeight, canvas, {
    fov: initialCamParams.fov ?? 60,
    distance: initialCamParams.distance,
    angleX: -35,
    angleY: 45,
    onDistanceChange: (d) =>
      useGameStore.getState().setCameraParam('distance', d),
  });
  // Set initial target so camera is active (hasInitialTarget = true)
  cam.setTarget(0, 0, 0);

  // ── Post-processing ─────────────────────────────────────────────────
  const postProcess = new PostProcessStack(renderer, scene, cam.camera);
  postProcess.sync(useGameStore.getState().postProcess);

  // ── World reveal FX ──────────────────────────────────────────────────
  const worldReveal = new WorldRevealFX();
  worldReveal.init(cam, postProcess);

  // ── Input ───────────────────────────────────────────────────────────
  const input = new Input();

  // ── Ground plane ────────────────────────────────────────────────────
  const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new THREE.MeshStandardMaterial({
    color: GROUND_COLOR,
    roughness: 0.9,
    metalness: 0.0,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);

  // Grid overlay + NavGrid (rebuilt when cellSize changes)
  let gridCellSize = useGameStore.getState().gridCellSize;
  const gridOverlay = new GridOverlay();
  gridOverlay.setOpacity(useGameStore.getState().gridOpacity);
  gridOverlay.rebuild(WORLD_SIZE, gridCellSize, GROUND_COLOR, [], []);
  scene.add(gridOverlay.group);

  let navGrid = new NavGrid(WORLD_SIZE, WORLD_SIZE, gridCellSize);
  navGrid.build(
    [],
    useGameStore.getState().charStepUp,
    useGameStore.getState().charStepDown,
    CAPSULE_RADIUS,
  );

  const character = new CharacterController(navGrid);
  // Snap initial position to grid center (0,0 is always a cell center with odd world size)
  const initSnap = navGrid.snapToGrid(0, 0);
  character.root.position.set(initSnap.x, 0, initSnap.z);
  scene.add(character.root);
  character.setScene(scene);
  character.onLandingImpact = (fallHeight: number) => {
    const cells = fallHeight / gridCellSize;
    cam.shake(Math.min(cells * 0.04, 0.25), Math.min(cells * 0.06, 0.3));
  };

  // Model loading — reacts to store.charModel changes
  let currentModelId = '';
  function syncModel(modelId: string): void {
    if (modelId === currentModelId) return;
    currentModelId = modelId;
    const def = CHARACTER_MODELS.find((m) => m.id === modelId);
    if (!def || !def.opts) {
      // "none" = revert to placeholder box
      character.clearModel();
      useGameStore.getState().setCharAnimationList([]);
      return;
    }
    character.loadModel({
      meshUrl: def.opts.meshUrl,
      scale: def.opts.scale,
      rotation: def.opts.rotation,
      onLoaded: (names) => {
        console.log(`Model "${def.label}" loaded: ${names.length} animations:`, names);
        useGameStore.getState().setCharAnimationList(names);
      },
    }, def.loader ?? 'imminence');
  }
  // Initial sync
  syncModel(useGameStore.getState().charModel);

  // Character model callbacks
  useGameStore.setState({
    onRandomizeParts: () => {
      const model = character.getModel();
      if (model) {
        model.randomizeParts();
        useGameStore.setState({ hierarchyVersion: Date.now() });
      }
    },
    onGetHierarchy: () => {
      const model = character.getModel();
      return model ? model.getHierarchy() : [];
    },
    onToggleHierarchyNode: (uuid: string) => {
      const model = character.getModel();
      if (!model) return;
      model.toggleNodeByUuid(uuid);
      useGameStore.setState({ hierarchyVersion: Date.now() });
    },
  });

  // ── Obstacles & Ladders ────────────────────────────────────────────
  const obstacleGen = new ObstacleGenerator(scene);
  const ladderSystem = new LadderSystem(scene);
  const ladderGenerator = new LadderGenerator();

  /** Single canonical navgrid rebuild — called after ANY world operation.
   *  Rebuilds navGrid from obstacles, re-registers ladder nav-links,
   *  recomputes reachability, updates character + overlay + debug. */
  function rebuildWorld(): void {
    const { charStepUp, charStepDown } = useGameStore.getState();
    navGrid.build(obstacleGen.obstacles, charStepUp, charStepDown, CAPSULE_RADIUS);
    ladderSystem.reregisterNavLinks(navGrid);
    character.setObstacles(obstacleGen.obstacles);
    character.setLadderDefs(ladderSystem.ladders);
    gridOverlay.rebuild(WORLD_SIZE, gridCellSize, GROUND_COLOR, obstacleGen.obstacles, obstacleGen.colors);
    refreshDebugNav();
  }

  function generateLadders(): void {
    ladderSystem.unmerge();
    // Rebuild navGrid fresh (clears old links) before scanning for ladder sites
    const { charStepUp, charStepDown } = useGameStore.getState();
    navGrid.build(obstacleGen.obstacles, charStepUp, charStepDown, CAPSULE_RADIUS);
    ladderGenerator.generate(navGrid, ladderSystem);
    // Now do full rebuild to re-register all ladder links + reachability
    rebuildWorld();
    autoMergeIfEnabled();
  }

  function mergeWorld(): void {
    obstacleGen.unmerge();
    ladderSystem.unmerge();
    obstacleGen.mergeMeshes();
    ladderSystem.mergeMeshes();
    rebuildWorld();
  }

  function unmergeWorld(): void {
    obstacleGen.unmerge();
    ladderSystem.unmerge();
    rebuildWorld();
  }

  let suppressAutoMerge = false;

  function autoMergeIfEnabled(): void {
    if (!suppressAutoMerge && useGameStore.getState().autoMerge) mergeWorld();
  }

  function generateObstacles(): void {
    obstacleGen.unmerge();
    obstacleGen.generateObstacles(gridCellSize);
    rebuildWorld();
    autoMergeIfEnabled();
  }

  function generateTerrain(): void {
    obstacleGen.unmerge();
    obstacleGen.generateTerrain(gridCellSize);
    rebuildWorld();
    autoMergeIfEnabled();
  }

  function clearObstacles(): void {
    destruction.cancelTarget();
    obstacleGen.clear();
    ladderSystem.clear();
    // Full rebuild with empty world
    rebuildWorld();
    character.setNavGrid(navGrid); // clears path + path line + label
    // Hide goal marker
    pathLine.hideMarker();
  }

  let prevStepUp = useGameStore.getState().charStepUp;
  let prevStepDown = useGameStore.getState().charStepDown;
  let prevDebugNav = false;
  function refreshDebugNav(): void {
    const enabled = useGameStore.getState().debugNavGrid;
    gridOverlay.setDebugNav(enabled ? navGrid : null, obstacleGen.obstacles);
    prevDebugNav = enabled;
  }

  function rebuildGrid(newCellSize: number): void {
    gridCellSize = newCellSize;

    // Rebuild grid overlay with current obstacles
    gridOverlay.rebuild(
      WORLD_SIZE,
      gridCellSize,
      GROUND_COLOR,
      obstacleGen.obstacles,
      obstacleGen.colors,
    );

    // Rebuild navGrid with new cell size (preserves current obstacles)
    navGrid = new NavGrid(WORLD_SIZE, WORLD_SIZE, gridCellSize);
    ladderSystem.clear(); // ladders invalid at old cell size
    rebuildWorld();
    character.setNavGrid(navGrid);

    // PathLineRenderer handles marker resize internally via ensureMarker(cellSize)
  }

  // ── Torch light ──────────────────────────────────────────────────────
  const torchLight = new THREE.PointLight(0xffaa44, 0, 10);
  torchLight.castShadow = false;
  torchLight.visible = false;
  scene.add(torchLight);

  // Goal marker is managed by the character's PathLineRenderer
  const pathLine = character.getPathLine();

  // Raycaster for click-to-move
  const groundRaycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();
  let goalPointerDown = false;
  let goalPointerMoved = false;
  let goalPointerDownPos = { x: 0, y: 0 };
  let goalPointerType: string = 'mouse';
  let goalFiredOnDown = false;

  /** Raycast XZ from screen coords, then look up NavGrid surface height */
  function raycastGoalPos(
    clientX: number,
    clientY: number,
  ): { x: number; z: number; y: number } | null {
    const rect = canvas.getBoundingClientRect();
    pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    groundRaycaster.setFromCamera(pointerNDC, cam.camera);
    // Raycast obstacles first (closest hit), then ground as fallback
    let hitPoint: THREE.Vector3 | null = null;
    if (obstacleGen.meshes.length > 0) {
      const obsHits = groundRaycaster.intersectObjects(obstacleGen.meshes);
      if (obsHits.length > 0) hitPoint = obsHits[0].point;
    }
    if (!hitPoint) {
      const groundHits = groundRaycaster.intersectObject(ground);
      if (groundHits.length > 0) hitPoint = groundHits[0].point;
    }
    if (!hitPoint) return null;
    // Use XZ from hit, but Y from NavGrid surface (like voxel-engine)
    const cell = navGrid.getCell(
      ...(Object.values(navGrid.worldToGrid(hitPoint.x, hitPoint.z)) as [
        number,
        number,
      ]),
    );
    const surfaceY = cell ? cell.surfaceHeight : 0;
    return { x: hitPoint.x, z: hitPoint.z, y: surfaceY };
  }

  function tryGoTo(clientX: number, clientY: number, isDrag = false): void {
    const goalPos = raycastGoalPos(clientX, clientY);
    if (!goalPos) return;
    {
      const hit = goalPos;
      const snapMode = useGameStore.getState().charSnapMode;
      const isGrid = snapMode === '4dir' || snapMode === '8dir';
      let mx = hit.x,
        mz = hit.z;
      if (isGrid) {
        const snapped = character.getSnappedGoal(hit.x, hit.z);
        mx = snapped.x;
        mz = snapped.z;
      }
      if (
        character.goTo(
          hit.x,
          hit.z,
          useGameStore.getState().charMoveSpeed,
          pathLine.getMarkerRadius(),
          isDrag,
        )
      ) {
        // During drag in grid modes: show marker at raw mouse pos, snap on release
        if (isDrag && isGrid && goalPointerDown) {
          pathLine.showMarkerWithSnap(hit.x, hit.z, mx, mz, hit.y, gridCellSize);
        } else {
          pathLine.showMarker(mx, hit.y, mz, gridCellSize);
        }
      }
    }
  }

  // Left click / single finger touch → path goal (+ continuous path on drag)
  // Uses pointerId tracking for reliable cross-platform behavior.
  // goTo() handles autoMove logic internally via clickCount.
  let goalPointerId = -1;

  const onPointerDownGoal = (e: PointerEvent) => {
    if (e.button !== 0) return;
    audioSystem.init();
    goalPointerId = e.pointerId;
    goalPointerDown = true;
    goalPointerMoved = false;
    goalFiredOnDown = false;
    goalPointerDownPos = { x: e.clientX, y: e.clientY };
    goalPointerType = e.pointerType;
    // Mouse: always fire immediately on down
    if (e.pointerType === 'mouse') {
      tryGoTo(e.clientX, e.clientY);
      goalFiredOnDown = true;
    }
  };
  const onPointerMoveGoal = (e: PointerEvent) => {
    if (!goalPointerDown || e.pointerId !== goalPointerId) return;
    if (!goalPointerMoved) {
      const dx = e.clientX - goalPointerDownPos.x;
      const dy = e.clientY - goalPointerDownPos.y;
      if (Math.sqrt(dx * dx + dy * dy) < GOAL_DRAG_THRESHOLD) return;
      goalPointerMoved = true;
      // Touch continuous path: fire on first confirmed drag
      if (
        goalPointerType === 'touch' &&
        useGameStore.getState().charContinuousPath
      ) {
        tryGoTo(e.clientX, e.clientY, true);
      }
    }
    if (useGameStore.getState().charContinuousPath) {
      tryGoTo(e.clientX, e.clientY, true);
      goalFiredOnDown = true;
    }
  };
  const onPointerUpGoal = (e: PointerEvent) => {
    if (!goalPointerDown || e.pointerId !== goalPointerId) return;
    // Only fire on up if we didn't already fire on down/move (prevents double-fire)
    if (!goalPointerMoved && !goalFiredOnDown) {
      tryGoTo(e.clientX, e.clientY);
    }
    goalPointerDown = false;
    goalPointerId = -1;
  };
  // Cancel goal tracking when second finger touches (two-finger = camera/zoom)
  const onTouchStartGoal = (e: TouchEvent) => {
    if (e.touches.length >= 2) {
      goalPointerDown = false;
      goalPointerId = -1;
    }
  };
  canvas.addEventListener('pointerdown', onPointerDownGoal);
  window.addEventListener('pointermove', onPointerMoveGoal);
  window.addEventListener('pointerup', onPointerUpGoal);
  window.addEventListener('pointercancel', onPointerUpGoal);
  canvas.addEventListener('touchstart', onTouchStartGoal, { passive: true });

  // ── Mesh pick label (right-click on character to identify parts) ────
  const meshPickRaycaster = new THREE.Raycaster();
  const meshPickNDC = new THREE.Vector2();
  let meshPickLabel: HTMLDivElement | null = null;

  function removeMeshPickLabel(): void {
    if (meshPickLabel) { meshPickLabel.remove(); meshPickLabel = null; }
  }

  const onRightClickPick = (e: MouseEvent) => {
    // Right-click only
    if (e.button !== 2) return;
    const model = character.getModel();
    if (!model) return;

    const rect = canvas.getBoundingClientRect();
    meshPickNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    meshPickNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    meshPickRaycaster.setFromCamera(meshPickNDC, cam.camera);

    const pick = model.pickMesh(meshPickRaycaster);
    removeMeshPickLabel();
    if (!pick) return;

    // Create floating label
    meshPickLabel = document.createElement('div');
    meshPickLabel.innerHTML = `<b>[${pick.groupName}] ${pick.variantName}</b><br>mesh: ${pick.meshName}<br>mat: ${pick.materialName}<br>verts: ${pick.vertCount}`;
    Object.assign(meshPickLabel.style, {
      position: 'fixed',
      left: `${e.clientX + 12}px`,
      top: `${e.clientY - 8}px`,
      background: 'rgba(0,0,0,0.85)',
      color: '#fff',
      padding: '4px 10px',
      borderRadius: '4px',
      fontSize: '12px',
      fontFamily: 'monospace',
      pointerEvents: 'none',
      zIndex: '9999',
      whiteSpace: 'pre',
      border: '1px solid rgba(255,255,255,0.2)',
    });
    document.body.appendChild(meshPickLabel);
    console.log(`[MeshPick] Group="${pick.groupName}" Variant="${pick.variantName}" mesh="${pick.meshName}" mat="${pick.materialName}" verts=${pick.vertCount}`);

    // Auto-dismiss after 3s
    setTimeout(removeMeshPickLabel, 3000);
  };
  canvas.addEventListener('mousedown', onRightClickPick);

  // Context menu prevention handled by Camera

  // ── Particle systems ────────────────────────────────────────────────
  const particles: ParticleSystems = {
    dust: null,
    lightRain: null,
    rain: null,
    debris: null,
  };
  let prevToggles: ParticleToggles = {
    dust: false,
    lightRain: false,
    rain: false,
    debris: false,
  };
  // Initial sync
  syncParticles(
    scene,
    useGameStore.getState().particleToggles,
    prevToggles,
    particles,
  );
  prevToggles = { ...useGameStore.getState().particleToggles };

  // ── Obstacle destruction ────────────────────────────────────────────
  const destruction = new DestructionSystem(scene);

  // ── Sun debug helper ────────────────────────────────────────────────
  let sunDebugHelper: THREE.Group | null = null;

  // ── Callbacks ───────────────────────────────────────────────────────
  useGameStore.setState({
    onStartGame: () => {
      useGameStore.getState().setPhase('playing');
    },
    onPauseToggle: () => {
      const s = useGameStore.getState();
      s.setPhase(s.phase === 'paused' ? 'playing' : 'paused');
    },
    onResetCameraParams: () => {
      useGameStore.setState({ cameraParams: { ...DEFAULT_CAMERA_PARAMS } });
    },
    onResetLightParams: () => {
      useGameStore.setState({
        lightPreset: DEFAULT_LIGHT_PRESET,
        torchEnabled: false,
        torchParams: { ...DEFAULT_TORCH_PARAMS },
        postProcess: { ...DEFAULT_POST_PROCESS },
        particleToggles: { ...DEFAULT_PARTICLE_TOGGLES },
        timeOfDay: 10,
        dayCycleEnabled: false,
        dayCycleSpeed: 1,
      });
      applyLightPreset(sceneLights, DEFAULT_LIGHT_PRESET, true);
    },
    onGenerateObstacles: () => generateObstacles(),
    onGenerateTerrain: () => generateTerrain(),
    onGenerateLadders: () => generateLadders(),
    onClearObstacles: () => clearObstacles(),
    onGenerateWorld: () => {
      clearObstacles();
      suppressAutoMerge = true;
      const passes = 6 + Math.floor(Math.random() * 5); // 6-10 passes
      for (let i = 0; i < passes; i++) {
        if (Math.random() < 0.5) generateObstacles();
        else generateTerrain();
      }
      generateLadders();
      suppressAutoMerge = false;
      autoMergeIfEnabled();
      if (useGameStore.getState().worldRevealEnabled) {
        const maxH = obstacleGen.obstacles.reduce((m, o) => Math.max(m, o.height), 0);
        worldReveal.start(maxH);
      }
    },
    onMergeWorld: () => mergeWorld(),
    onUnmergeWorld: () => unmergeWorld(),
  });

  // ── Game loop ───────────────────────────────────────────────────────
  let rafId = 0;
  let lastTime = 0;

  function tick(time: number) {
    rafId = requestAnimationFrame(tick);
    const dt = Math.min((time - lastTime) / 1000, 0.1);
    lastTime = time;

    const store = useGameStore.getState();

    // Sync camera params from store
    cam.setParams(store.cameraParams);

    // Sync light preset
    applyLightPreset(sceneLights, store.lightPreset, true);

    // Day cycle
    if (store.dayCycleEnabled) {
      let speed = store.dayCycleSpeed;
      // Fast nights: 4x speed when sun is below horizon
      if (store.fastNights) {
        const angle = (store.timeOfDay / 24) * Math.PI * 2 - Math.PI / 2;
        if (Math.sin(angle) < 0) speed *= 4;
      }
      const newTime = (store.timeOfDay + speed * dt) % 24;
      store.setTimeOfDay(newTime);
    }

    // Update day cycle lighting + sky
    updateDayCycle(
      sceneLights,
      sceneSky,
      store.lightPreset,
      true, // isExterior
      store.timeOfDay,
      baseSkyColors,
      scene.fog as THREE.Fog | null,
    );

    // Sun debug helper
    if (store.sunDebug && !sunDebugHelper) {
      sunDebugHelper = createSunDebugHelper(scene);
    } else if (!store.sunDebug && sunDebugHelper) {
      disposeSunDebugHelper(scene, sunDebugHelper);
      sunDebugHelper = null;
    }
    if (sunDebugHelper) {
      updateSunDebug(
        sunDebugHelper,
        computeSunDirection(store.timeOfDay),
        cam.camera.position,
      );
    }

    // Sync post-processing
    postProcess.sync(store.postProcess);

    // Sync grid
    if (store.gridCellSize !== gridCellSize) {
      rebuildGrid(store.gridCellSize);
    }
    // Rebuild navGrid when step heights change (affects passability)
    if (
      store.charStepUp !== prevStepUp ||
      store.charStepDown !== prevStepDown
    ) {
      prevStepUp = store.charStepUp;
      prevStepDown = store.charStepDown;
      ladderSystem.clear(); // ladders invalid with new step params
      rebuildWorld();
    }
    gridOverlay.setOpacity(store.gridOpacity);

    // Sync debug navGrid overlay
    if (store.debugNavGrid !== prevDebugNav) {
      refreshDebugNav();
    }

    // Sync particles
    const toggles = store.particleToggles;
    syncParticles(scene, toggles, prevToggles, particles);
    prevToggles = { ...toggles };

    // Update particle systems
    if (particles.dust) particles.dust.update(dt);
    if (particles.lightRain) particles.lightRain.update(dt);
    if (particles.rain) particles.rain.update(dt);
    if (particles.debris) particles.debris.update(dt);

    // ── Character input + update ──────────────────────────────────────
    character.setDebugPath(store.charDebugPath);
    character.setAutoMove(store.charAutoMove);
    character.setStringPull(store.charStringPull);
    character.setStepUp(store.charStepUp);
    character.setStepDown(store.charStepDown);
    character.setTurnSpeed(store.charRotSpeed);
    character.setGravity(store.charGravity);
    character.setSnapMode(store.charSnapMode);
    const moveSpeed = store.charMoveSpeed;

    // Sync character model from dropdown
    syncModel(store.charModel);
    character.setHopEnabled(store.charHop);

    const inp = input.update();
    let dx = 0,
      dz = 0;
    if (inp.left) dx -= 1;
    if (inp.right) dx += 1;
    if (inp.forward) dz -= 1;
    if (inp.backward) dz += 1;
    character.moveDirectional(dx, dz, cam.getAngleY(), dt, moveSpeed);
    character.update(dt, moveSpeed);

    // Sync animation: locomotion state machine drives anim, dropdown only in idle
    const model = character.getModel();
    if (model && model.isLoaded()) {
      model.setGroundPin(store.charGroundPin);
      if (store.charTestAnim) {
        // Test mode: dropdown controls animation, no gameplay override
        if (model.getCurrentClip() !== store.charAnimation) model.play(store.charAnimation);
        model.setRawTimeScale(store.charSpeed);
      } else {
        const anim = character.getAnimState();
        if (anim.state === 'walk') {
          const walkAnim = resolveAnim(model, 'Walk') ?? resolveAnim(model, 'Run');
          if (walkAnim && model.getCurrentClip() !== walkAnim) model.play(walkAnim);
          model.setTimeScale(anim.moveSpeed);
        } else if (anim.state === 'run') {
          const runAnim = resolveAnim(model, 'Run') ?? resolveAnim(model, 'Walk');
          if (runAnim && model.getCurrentClip() !== runAnim) model.play(runAnim);
          model.setTimeScale(anim.moveSpeed);
        } else if (anim.state === 'climb') {
          const idleAnim = resolveAnim(model, 'Idle') ?? 'Idle';
          if (model.getCurrentClip() !== idleAnim) model.play(idleAnim, 0.1);
          model.setRawTimeScale(store.charSpeed);
        } else if (anim.state === 'jump') {
          const jumpAnim = resolveAnim(model, 'Jump');
          if (jumpAnim && model.getCurrentClip() !== jumpAnim) model.play(jumpAnim, 0.1);
          model.setTimeScale(anim.moveSpeed || moveSpeed);
        } else {
          const idleAnim = resolveAnim(model, 'Idle') ?? 'Idle';
          if (model.getCurrentClip() !== idleAnim) model.play(idleAnim);
          model.setRawTimeScale(store.charSpeed);
        }
      }
    }

    const pos = character.getPosition();
    cam.setTarget(pos.x, character.getGroundY(), pos.z);
    cam.setCharacterState(character.getFacingAngle(), character.getIsMoving());
    sfxAudio.setPlayerPosition(pos.x, pos.z);

    // TAB: snap camera behind character
    if (inp.cameraSnap) {
      cam.snapBehind(character.getFacingAngle() + Math.PI);
    }

    // ── SPACE: obstacle destruction ────────────────────────────────────
    if (inp.attack && obstacleGen.isMerged) {
      if (destruction.hasTarget) {
        if (destruction.confirmDestroy(obstacleGen, ladderSystem, cam)) {
          rebuildWorld();
        }
      } else {
        const cPos = character.getPosition();
        const angle = character.getFacingAngle();
        const probeX = cPos.x + Math.sin(angle) * gridCellSize;
        const probeZ = cPos.z + Math.cos(angle) * gridCellSize;
        destruction.tryTarget(obstacleGen, probeX, probeZ);
      }
    }

    // Clear destroy target if character moves
    if (destruction.hasTarget && (dx !== 0 || dz !== 0)) {
      destruction.cancelTarget();
    }

    // Update destruction (debris physics, highlight pulse, label bob)
    destruction.update(dt);

    // ── Torch ─────────────────────────────────────────────────────────
    if (store.torchEnabled) {
      const tp = store.torchParams;
      torchLight.visible = true;
      torchLight.color.set(tp.color);
      torchLight.intensity =
        tp.intensity +
        (tp.flicker > 0 ? (Math.random() - 0.5) * tp.flicker * 2 : 0);
      torchLight.distance = tp.distance;
      // Position relative to character
      const cPos = character.getPosition();
      const fwd = Math.sin(character.root.rotation.y);
      const side = Math.cos(character.root.rotation.y);
      torchLight.position.set(
        cPos.x + fwd * (tp.offsetForward ?? 0.5) + side * (tp.offsetRight ?? 0),
        cPos.y + (tp.offsetUp ?? 1.5),
        cPos.z + side * (tp.offsetForward ?? 0.5) - fwd * (tp.offsetRight ?? 0),
      );
    } else {
      torchLight.visible = false;
    }

    // Update goal marker (snap lerp + fade) — returns true when marker is animating
    if (pathLine.updateMarker(dt, character.isPathActive(), goalPointerDown)) {
      const mPos = pathLine.getMarkerPosition();
      if (mPos) character.setPathLineEndpoint(mPos.x, mPos.z);
    }

    // World reveal animation
    worldReveal.update(dt);

    // Occlusion reveal: raycast camera→player, fade walls that occlude character
    // In isometric/top-down views the straight camera→player ray sails over
    // short walls, so we cast a fan of rays at ground level to catch them.
    {
      const playerPos = character.getPosition();
      const groundY = character.getGroundY();
      const playerWorldPos = new THREE.Vector3(playerPos.x, groundY + 0.5, playerPos.z);
      const camPos = cam.camera.position;

      let occluded = false;
      if (obstacleGen.meshes.length > 0) {
        // Cast 3 rays at different target heights: ground, knee, chest
        const heights = [groundY + 0.05, groundY + 0.25, groundY + 0.5];
        const rayOrigin = camPos.clone();
        for (const h of heights) {
          const target = new THREE.Vector3(playerPos.x, h, playerPos.z);
          const dir = new THREE.Vector3().subVectors(target, rayOrigin).normalize();
          const dist = rayOrigin.distanceTo(target);
          const raycaster = new THREE.Raycaster(rayOrigin, dir, 0.1, dist);
          const hits = raycaster.intersectObjects(obstacleGen.meshes, true);
          if (hits.length > 0) { occluded = true; break; }
        }
      }
      updateOcclusionReveal(playerWorldPos, camPos, occluded);
    }

    // Update camera
    cam.updatePosition(dt);

    // Render
    renderer.info.reset();
    postProcess.render();

    // Push draw call count to store (only when changed to avoid unnecessary subscriber notifications)
    const dc = renderer.info.render.calls;
    if (dc !== useGameStore.getState().drawCalls) {
      useGameStore.setState({ drawCalls: dc });
    }
  }

  rafId = requestAnimationFrame(tick);

  // ── Resize ──────────────────────────────────────────────────────────
  const onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h);
    cam.resize(w / h);
    postProcess.resize(w, h);
  };
  window.addEventListener('resize', onResize);

  // ── Pause on ESC ────────────────────────────────────────────────────
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      const s = useGameStore.getState();
      if (s.phase === 'playing' || s.phase === 'paused') {
        s.onPauseToggle?.();
      }
    }
  };
  window.addEventListener('keydown', onKeyDown);

  // ── Cleanup ─────────────────────────────────────────────────────────
  return {
    destroy() {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
      input.destroy();
      cam.destroy();
      postProcess.dispose();

      // Torch
      scene.remove(torchLight);
      torchLight.dispose();

      // Character + marker
      canvas.removeEventListener('pointerdown', onPointerDownGoal);
      window.removeEventListener('pointermove', onPointerMoveGoal);
      window.removeEventListener('pointerup', onPointerUpGoal);
      window.removeEventListener('pointercancel', onPointerUpGoal);
      canvas.removeEventListener('touchstart', onTouchStartGoal);
      canvas.removeEventListener('mousedown', onRightClickPick);
      removeMeshPickLabel();
      scene.remove(character.root);
      character.dispose();

      // Obstacles & ladders
      clearObstacles();
      ladderSystem.dispose();
      destruction.dispose();

      // Ground
      scene.remove(ground);
      groundGeo.dispose();
      groundMat.dispose();
      scene.remove(gridOverlay.group);
      gridOverlay.dispose();

      // Particles
      for (const sys of Object.values(particles)) {
        if (sys) {
          scene.remove(sys.group);
          sys.dispose();
        }
      }

      // Sun debug
      if (sunDebugHelper) {
        disposeSunDebugHelper(scene, sunDebugHelper);
      }

      entityRegistry.clear();
      renderer.dispose();
    },
  };
}
