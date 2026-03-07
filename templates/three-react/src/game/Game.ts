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
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x556655,
    roughness: 0.9,
    metalness: 0.0,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);

  // Grid overlay + NavGrid (rebuilt when cellSize changes)
  let gridCellSize = useGameStore.getState().gridCellSize;
  let gridDivisions = Math.round(WORLD_SIZE / gridCellSize);
  let gridHelper = new THREE.GridHelper(WORLD_SIZE, gridDivisions, 0x888888, 0x444444);
  (gridHelper.material as THREE.Material).opacity = useGameStore.getState().gridOpacity;
  (gridHelper.material as THREE.Material).transparent = true;
  gridHelper.position.y = 0.01;
  scene.add(gridHelper);

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
  let obstacleMeshes: THREE.Mesh[] = [];

  const EARTHY_COLORS = [0x8B7355, 0x6B5B45, 0x7A6B55, 0x9B8B75, 0x5C4D3C, 0x8B8070, 0x6E6355];

  function generateObstacles(): void {
    clearObstacles();

    const store = useGameStore.getState();
    const snap = store.obstacleSnap;
    const stepH = store.charStepHeight;
    const cs = gridCellSize;
    const wallCount = 10 + Math.floor(Math.random() * 11); // 10-20 walls
    const debrisCount = 8 + Math.floor(Math.random() * 8); // 8-15 debris

    for (let i = 0; i < wallCount + debrisCount; i++) {
      const isDebris = i >= wallCount;
      let halfW: number, halfD: number, height: number, x: number, z: number;

      if (isDebris) {
        // Mix: ~60% steppable (below stepHeight), ~40% blocking (above)
        height = Math.random() < 0.6
          ? 0.05 + Math.random() * stepH * 0.9   // steppable
          : stepH + 0.1 + Math.random() * 0.3;   // just above stepHeight

        if (snap) {
          // Snap debris to cell bounds (1 cell each axis)
          halfW = cs * 0.5;
          halfD = cs * 0.5;
          const gx = Math.floor((Math.random() - 0.5) * (WORLD_SIZE / cs - 4));
          const gz = Math.floor((Math.random() - 0.5) * (WORLD_SIZE / cs - 4));
          x = gx * cs + cs * 0.5;
          z = gz * cs + cs * 0.5;
        } else {
          halfW = 0.2 + Math.random() * 0.4;
          halfD = 0.2 + Math.random() * 0.4;
          x = (Math.random() - 0.5) * (WORLD_SIZE - 4);
          z = (Math.random() - 0.5) * (WORLD_SIZE - 4);
        }
        // Debris can be near center — skip avoidance
      } else if (snap) {
        // Snap dimensions to whole cell multiples (1-3 cells per half-extent)
        const cellsW = 1 + Math.floor(Math.random() * 3);
        const cellsD = 1 + Math.floor(Math.random() * 3);
        halfW = cellsW * cs * 0.5;
        halfD = cellsD * cs * 0.5;
        height = 1 + Math.random() * 2;

        // Snap position to grid cell edges so box bounds align with grid lines
        do {
          const gx = Math.floor((Math.random() - 0.5) * (WORLD_SIZE / cs - 4));
          const gz = Math.floor((Math.random() - 0.5) * (WORLD_SIZE / cs - 4));
          x = gx * cs + (cellsW % 2 === 0 ? 0 : cs * 0.5);
          z = gz * cs + (cellsD % 2 === 0 ? 0 : cs * 0.5);
        } while (Math.abs(x) < cs * 2 && Math.abs(z) < cs * 2);
      } else {
        halfW = 0.5 + Math.random() * 1.5;
        halfD = 0.5 + Math.random() * 1.5;
        height = 1 + Math.random() * 2;

        do {
          x = (Math.random() - 0.5) * (WORLD_SIZE - 4);
          z = (Math.random() - 0.5) * (WORLD_SIZE - 4);
        } while (Math.abs(x) < 1.5 && Math.abs(z) < 1.5);
      }

      const box: AABBBox = { x, z, halfW, halfD, height };
      obstacles.push(box);

      const geo = new THREE.BoxGeometry(halfW * 2, height, halfD * 2);
      geo.translate(0, height / 2, 0);
      const color = EARTHY_COLORS[Math.floor(Math.random() * EARTHY_COLORS.length)];
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, 0, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      obstacleMeshes.push(mesh);
    }

    // Rebuild navGrid with obstacles (stepHeight determines which are blocking)
    const stepHeight = useGameStore.getState().charStepHeight;
    navGrid.build(obstacles, stepHeight, 0.25);
    character.setObstacles(obstacles);
  }

  function clearObstacles(): void {
    for (const mesh of obstacleMeshes) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    obstacleMeshes = [];
    obstacles = [];

    const stepHeight = useGameStore.getState().charStepHeight;
    navGrid.build([], stepHeight, 0.25);
    character.setObstacles([]);
  }

  function rebuildGrid(newCellSize: number): void {
    // Remove old grid
    scene.remove(gridHelper);
    gridHelper.geometry.dispose();
    (gridHelper.material as THREE.Material).dispose();

    // Create new grid
    gridCellSize = newCellSize;
    gridDivisions = Math.round(WORLD_SIZE / gridCellSize);
    gridHelper = new THREE.GridHelper(WORLD_SIZE, gridDivisions, 0x888888, 0x444444);
    (gridHelper.material as THREE.Material).opacity = useGameStore.getState().gridOpacity;
    (gridHelper.material as THREE.Material).transparent = true;
    gridHelper.position.y = 0.01;
    scene.add(gridHelper);

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

  // Raycaster for click-to-move
  const groundRaycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    groundRaycaster.setFromCamera(pointerNDC, cam.camera);
    const hits = groundRaycaster.intersectObject(ground);
    if (hits.length > 0) {
      const hit = hits[0].point;
      const snapMode = useGameStore.getState().charSnapMode;
      // Snap marker position to grid in grid modes
      let mx = hit.x, mz = hit.z;
      if (snapMode === '4dir' || snapMode === '8dir') {
        const snapped = character.getSnappedGoal(hit.x, hit.z);
        mx = snapped.x;
        mz = snapped.z;
      }
      const outerRadius = gridCellSize * 0.45 + RING_STROKE * 0.5;
      if (character.goTo(hit.x, hit.z, useGameStore.getState().charMoveSpeed, outerRadius)) {
        clickMarker.position.set(mx, 0.02, mz);
        markerMat.opacity = 1;
        markerFade = -1; // -1 = waiting for path arrival
      }
    }
  };
  canvas.addEventListener('contextmenu', onContextMenu);

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
    (gridHelper.material as THREE.Material).opacity = store.gridOpacity;

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
      canvas.removeEventListener('contextmenu', onContextMenu);
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
      scene.remove(gridHelper);
      gridHelper.geometry.dispose();
      (gridHelper.material as THREE.Material).dispose();

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
