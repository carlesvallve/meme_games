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
} from './rendering';
import type { GameInstance, ParticleSystem } from '../types';
import { createDustMotes, createRainEffect, createDebrisEffect } from '../utils/particles';
import { NavGrid } from './pathfinding/NavGrid';
import type { AABBBox } from './pathfinding/NavGrid';
import { DummyCharacter } from './DummyCharacter';
import { GridOverlay } from './GridOverlay';
import { audioSystem } from './AudioSystem';

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

  // ── Input ───────────────────────────────────────────────────────────
  const input = new Input();

  // ── Ground plane ────────────────────────────────────────────────────
  const WORLD_SIZE = 41; // odd so there's always a center cell
  const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
  groundGeo.rotateX(-Math.PI / 2);
  const GROUND_COLOR = 0x9B8B75;
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
  navGrid.build([], useGameStore.getState().charStepHeight, 0.25);

  const character = new DummyCharacter(navGrid);
  // Snap initial position to grid center (0,0 is always a cell center with odd world size)
  const initSnap = navGrid.snapToGrid(0, 0);
  character.root.position.set(initSnap.x, 0, initSnap.z);
  scene.add(character.root);
  character.setScene(scene);

  // ── Obstacles ──────────────────────────────────────────────────────
  let obstacles: AABBBox[] = [];
  let obstacleColors: number[] = [];
  let obstacleMeshes: THREE.Mesh[] = [];

  const EARTHY_COLORS = [0x8B7355, 0x6B5B45, 0x7A6B55, 0x9B8B75, 0x5C4D3C, 0x8B8070, 0x6E6355];

  /** Place a single box obstacle and its mesh */
  function placeBox(x: number, z: number, halfW: number, halfD: number, height: number, color: number): void {
    const box: AABBBox = { x, z, halfW, halfD, height };
    obstacles.push(box);
    obstacleColors.push(color);
    const geo = new THREE.BoxGeometry(halfW * 2, height, halfD * 2);
    geo.translate(0, height / 2, 0);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, 0, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    obstacleMeshes.push(mesh);
  }

  /** Random grid position avoiding center clear zone */
  function randGridPos(cs: number, clearRadius: number): { gx: number; gz: number } {
    const gridHalf = Math.floor(WORLD_SIZE / cs / 2) - 2;
    let gx: number, gz: number;
    do {
      gx = Math.floor((Math.random() - 0.5) * gridHalf * 2);
      gz = Math.floor((Math.random() - 0.5) * gridHalf * 2);
    } while (Math.abs(gx * cs) < clearRadius && Math.abs(gz * cs) < clearRadius);
    return { gx, gz };
  }

  function generateObstacles(): void {
    clearObstacles();

    const store = useGameStore.getState();
    const snap = store.obstacleSnap;
    const stepH = store.charStepHeight;
    const cs = gridCellSize;
    const clearRadius = cs * 3;

    // ── Compound shapes: L, U, T, +, corridors ──
    const shapeCount = 4 + Math.floor(Math.random() * 4); // 4-7 compound shapes
    for (let s = 0; s < shapeCount; s++) {
      const color = EARTHY_COLORS[Math.floor(Math.random() * EARTHY_COLORS.length)];
      const height = 1.2 + Math.random() * 1.5;
      const shape = Math.floor(Math.random() * 5); // 0=L, 1=U, 2=T, 3=+, 4=corridor
      const { gx: ox, gz: oz } = randGridPos(cs, clearRadius);
      // Randomly rotate shape (0, 90, 180, 270)
      const rot = Math.floor(Math.random() * 4);

      // Build shape as list of cell offsets relative to origin
      let cells: { dx: number; dz: number }[] = [];
      const armLen = 3 + Math.floor(Math.random() * 4); // 3-6 cells
      const armLen2 = 3 + Math.floor(Math.random() * 3);

      if (shape === 0) {
        // L-shape: horizontal arm + vertical arm
        for (let i = 0; i < armLen; i++) cells.push({ dx: i, dz: 0 });
        for (let i = 1; i < armLen2; i++) cells.push({ dx: 0, dz: i });
      } else if (shape === 1) {
        // U-shape: two parallel arms + bottom connector
        for (let i = 0; i < armLen; i++) { cells.push({ dx: 0, dz: i }); cells.push({ dx: 3, dz: i }); }
        cells.push({ dx: 1, dz: 0 }); cells.push({ dx: 2, dz: 0 });
      } else if (shape === 2) {
        // T-shape: horizontal bar + vertical stem
        const barLen = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < barLen; i++) cells.push({ dx: i, dz: 0 });
        const mid = Math.floor(barLen / 2);
        for (let i = 1; i < armLen; i++) cells.push({ dx: mid, dz: i });
      } else if (shape === 3) {
        // + shape: cross
        const arm = 2 + Math.floor(Math.random() * 2);
        for (let i = -arm; i <= arm; i++) { cells.push({ dx: i, dz: 0 }); if (i !== 0) cells.push({ dx: 0, dz: i }); }
      } else {
        // Corridor/wall: long thin wall (1 cell wide, 5-10 long)
        const wallLen = 5 + Math.floor(Math.random() * 6);
        for (let i = 0; i < wallLen; i++) cells.push({ dx: i, dz: 0 });
      }

      // Apply rotation (90° increments)
      if (rot > 0) {
        cells = cells.map(({ dx, dz }) => {
          if (rot === 1) return { dx: -dz, dz: dx };
          if (rot === 2) return { dx: -dx, dz: -dz };
          return { dx: dz, dz: -dx };
        });
      }

      // Place each cell as a box
      if (snap) {
        for (const { dx, dz } of cells) {
          const cx = (ox + dx) * cs + cs * 0.5;
          const cz = (oz + dz) * cs + cs * 0.5;
          placeBox(cx, cz, cs * 0.5, cs * 0.5, height, color);
        }
      } else {
        // Non-snap: place as merged AABB per shape segment
        for (const { dx, dz } of cells) {
          const cx = ox * cs + dx * cs + cs * 0.5;
          const cz = oz * cs + dz * cs + cs * 0.5;
          placeBox(cx, cz, cs * 0.5, cs * 0.5, height, color);
        }
      }
    }

    // ── Large solid blocks (rooms/pillars) ──
    const blockCount = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < blockCount; i++) {
      const color = EARTHY_COLORS[Math.floor(Math.random() * EARTHY_COLORS.length)];
      const height = 1 + Math.random() * 2;
      const cellsW = 2 + Math.floor(Math.random() * 4); // 2-5 cells wide
      const cellsD = 2 + Math.floor(Math.random() * 4);
      const { gx, gz } = randGridPos(cs, clearRadius);

      if (snap) {
        const halfW = cellsW * cs * 0.5;
        const halfD = cellsD * cs * 0.5;
        const x = gx * cs + (cellsW % 2 === 0 ? 0 : cs * 0.5);
        const z = gz * cs + (cellsD % 2 === 0 ? 0 : cs * 0.5);
        placeBox(x, z, halfW, halfD, height, color);
      } else {
        const halfW = (1 + Math.random() * 3);
        const halfD = (1 + Math.random() * 3);
        const x = gx * cs;
        const z = gz * cs;
        placeBox(x, z, halfW, halfD, height, color);
      }
    }

    // ── Scattered debris (steppable + some blocking) ──
    const debrisCount = 8 + Math.floor(Math.random() * 8);
    for (let i = 0; i < debrisCount; i++) {
      const height = Math.random() < 0.6
        ? 0.05 + Math.random() * stepH * 0.9
        : stepH + 0.1 + Math.random() * 0.3;
      const color = EARTHY_COLORS[Math.floor(Math.random() * EARTHY_COLORS.length)];

      if (snap) {
        const gx = Math.floor((Math.random() - 0.5) * (WORLD_SIZE / cs - 4));
        const gz = Math.floor((Math.random() - 0.5) * (WORLD_SIZE / cs - 4));
        placeBox(gx * cs + cs * 0.5, gz * cs + cs * 0.5, cs * 0.5, cs * 0.5, height, color);
      } else {
        const x = (Math.random() - 0.5) * (WORLD_SIZE - 4);
        const z = (Math.random() - 0.5) * (WORLD_SIZE - 4);
        placeBox(x, z, 0.2 + Math.random() * 0.4, 0.2 + Math.random() * 0.4, height, color);
      }
    }

    // Rebuild navGrid + grid overlay with obstacles
    const stepHeight = useGameStore.getState().charStepHeight;
    navGrid.build(obstacles, stepHeight, 0.25);
    character.setObstacles(obstacles);
    gridOverlay.rebuild(WORLD_SIZE, gridCellSize, GROUND_COLOR, obstacles, obstacleColors);
    refreshDebugNav();
  }

  function clearObstacles(): void {
    for (const mesh of obstacleMeshes) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    obstacleMeshes = [];
    obstacles = [];
    obstacleColors = [];

    const stepHeight = useGameStore.getState().charStepHeight;
    navGrid.build([], stepHeight, 0.25);
    character.setObstacles([]);
    gridOverlay.rebuild(WORLD_SIZE, gridCellSize, GROUND_COLOR, [], []);
    refreshDebugNav();
  }

  let prevDebugNav = false;
  function refreshDebugNav(): void {
    const enabled = useGameStore.getState().debugNavGrid;
    gridOverlay.setDebugNav(enabled ? navGrid : null, obstacles);
    prevDebugNav = enabled;
  }

  function rebuildGrid(newCellSize: number): void {
    gridCellSize = newCellSize;

    // Rebuild grid overlay with current obstacles
    gridOverlay.rebuild(WORLD_SIZE, gridCellSize, GROUND_COLOR, obstacles, obstacleColors);

    // Rebuild navGrid (preserve current obstacles)
    navGrid = new NavGrid(WORLD_SIZE, WORLD_SIZE, gridCellSize);
    navGrid.build(obstacles, useGameStore.getState().charStepHeight, 0.25);
    character.setNavGrid(navGrid);

    // Rebuild click marker to match new cell size
    if (gridCellSize !== markerCellSize) {
      clickMarker.geometry.dispose();
      markerGeo = createMarkerGeo(gridCellSize);
      clickMarker.geometry = markerGeo;
      markerCellSize = gridCellSize;
    }
    refreshDebugNav();
  }

  // ── Torch light ──────────────────────────────────────────────────────
  const torchLight = new THREE.PointLight(0xffaa44, 0, 10);
  torchLight.castShadow = false;
  torchLight.visible = false;
  scene.add(torchLight);

  // Click marker ring — sized to match grid cell, stroke matches debug line width
  const RING_STROKE = 0.05;
  let markerCellSize = gridCellSize;
  function createMarkerGeo(cellSize: number): THREE.RingGeometry {
    const outer = cellSize * 0.45;
    const inner = outer - RING_STROKE;
    const geo = new THREE.RingGeometry(inner, outer, 32);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }
  let markerGeo = createMarkerGeo(gridCellSize);
  const markerMat = new THREE.MeshBasicMaterial({ color: 0xffff44, transparent: true, opacity: 0 });
  const clickMarker = new THREE.Mesh(markerGeo, markerMat);
  clickMarker.position.y = 0.02;
  scene.add(clickMarker);
  let markerFade = 0;
  // Smooth snap: marker lerps to snapped grid position on mouse release
  let markerSnapTarget: { x: number; z: number } | null = null;
  const MARKER_SNAP_SPEED = 16;

  // Raycaster for click-to-move
  const groundRaycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();
  let goalPointerDown = false;
  let goalPointerMoved = false;
  let goalPointerDownPos = { x: 0, y: 0 };
  let goalPointerType: string = 'mouse';
  let goalFiredOnDown = false;
  const GOAL_DRAG_THRESHOLD = 8;

  function tryGoTo(clientX: number, clientY: number, isDrag = false): void {
    const rect = canvas.getBoundingClientRect();
    pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    groundRaycaster.setFromCamera(pointerNDC, cam.camera);
    const hits = groundRaycaster.intersectObject(ground);
    if (hits.length > 0) {
      const hit = hits[0].point;
      const snapMode = useGameStore.getState().charSnapMode;
      const isGrid = snapMode === '4dir' || snapMode === '8dir';
      // Snapped position for pathfinding
      let mx = hit.x, mz = hit.z;
      if (isGrid) {
        const snapped = character.getSnappedGoal(hit.x, hit.z);
        mx = snapped.x;
        mz = snapped.z;
      }
      const outerRadius = gridCellSize * 0.45 + RING_STROKE * 0.5;
      if (character.goTo(hit.x, hit.z, useGameStore.getState().charMoveSpeed, outerRadius, isDrag)) {
        // During drag in grid modes: show marker at raw mouse pos, snap on release
        if (isDrag && isGrid && goalPointerDown) {
          clickMarker.position.set(hit.x, 0.02, hit.z);
          markerSnapTarget = { x: mx, z: mz };
        } else {
          clickMarker.position.set(mx, 0.02, mz);
          markerSnapTarget = null;
        }
        markerMat.opacity = 1;
        markerFade = -1;
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
      if (goalPointerType === 'touch' && useGameStore.getState().charContinuousPath) {
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
    // markerSnapTarget was set during drag — tick loop will lerp it
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

  // Context menu prevention handled by Camera

  // ── Particle systems ────────────────────────────────────────────────
  const particles: ParticleSystems = { dust: null, lightRain: null, rain: null, debris: null };
  let prevToggles: ParticleToggles = { dust: false, lightRain: false, rain: false, debris: false };
  // Initial sync
  syncParticles(scene, useGameStore.getState().particleToggles, prevToggles, particles);
  prevToggles = { ...useGameStore.getState().particleToggles };

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
    onClearObstacles: () => clearObstacles(),
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
      updateSunDebug(sunDebugHelper, computeSunDirection(store.timeOfDay), cam.camera.position);
    }

    // Sync post-processing
    postProcess.sync(store.postProcess);

    // Sync grid
    if (store.gridCellSize !== gridCellSize) {
      rebuildGrid(store.gridCellSize);
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
    character.setStepHeight(store.charStepHeight);
    character.setSnapMode(store.charSnapMode);
    const moveSpeed = store.charMoveSpeed;

    const inp = input.update();
    let dx = 0, dz = 0;
    if (inp.left) dx -= 1;
    if (inp.right) dx += 1;
    if (inp.forward) dz -= 1;
    if (inp.backward) dz += 1;
    character.moveDirectional(dx, dz, cam.getAngleY(), dt, moveSpeed);
    character.update(dt, moveSpeed);

    const pos = character.getPosition();
    cam.setTarget(pos.x, pos.y, pos.z);

    // ── Torch ─────────────────────────────────────────────────────────
    if (store.torchEnabled) {
      const tp = store.torchParams;
      torchLight.visible = true;
      torchLight.color.set(tp.color);
      torchLight.intensity = tp.intensity + (tp.flicker > 0 ? (Math.random() - 0.5) * tp.flicker * 2 : 0);
      torchLight.distance = tp.distance;
      // Position relative to character
      const cPos = character.getPosition();
      const fwd = Math.sin(character.root.rotation.y);
      const side = Math.cos(character.root.rotation.y);
      torchLight.position.set(
        cPos.x + fwd * (tp.offsetForward ?? 0.5) + side * (tp.offsetRight ?? 0),
        (tp.offsetUp ?? 1.5),
        cPos.z + side * (tp.offsetForward ?? 0.5) - fwd * (tp.offsetRight ?? 0),
      );
    } else {
      torchLight.visible = false;
    }

    // Smooth-snap marker to grid position after drag release
    if (markerSnapTarget && !goalPointerDown) {
      const dx = markerSnapTarget.x - clickMarker.position.x;
      const dz = markerSnapTarget.z - clickMarker.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 0.01) {
        clickMarker.position.x = markerSnapTarget.x;
        clickMarker.position.z = markerSnapTarget.z;
        markerSnapTarget = null;
      } else {
        const t = 1 - Math.exp(-MARKER_SNAP_SPEED * dt);
        clickMarker.position.x += dx * t;
        clickMarker.position.z += dz * t;
      }
    }
    // Path line endpoint tracks marker position (smooth during drag + snap)
    if (markerSnapTarget || goalPointerDown) {
      character.setPathLineEndpoint(clickMarker.position.x, clickMarker.position.z);
    }

    // Click marker fade — start fading when path completes
    if (markerFade === -1 && !character.isPathActive()) {
      markerFade = 0.4; // start fade-out
    }
    if (markerFade > 0) {
      markerFade -= dt;
      markerMat.opacity = Math.max(0, markerFade / 0.4);
    }

    // Update camera
    cam.updatePosition(dt);

    // Render
    postProcess.render();
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
      scene.remove(character.root);
      character.dispose();
      scene.remove(clickMarker);
      markerGeo.dispose();
      markerMat.dispose();

      // Obstacles
      clearObstacles();

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
