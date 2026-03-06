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
  const groundGeo = new THREE.PlaneGeometry(40, 40);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x556655,
    roughness: 0.9,
    metalness: 0.0,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);

  // Grid overlay
  const gridHelper = new THREE.GridHelper(40, 40, 0x888888, 0x444444);
  (gridHelper.material as THREE.Material).opacity = useGameStore.getState().gridOpacity;
  (gridHelper.material as THREE.Material).transparent = true;
  gridHelper.position.y = 0.01;
  scene.add(gridHelper);

  // ── NavGrid + Character ────────────────────────────────────────────
  const navGrid = new NavGrid(40, 40, 0.5);
  navGrid.build([], 1, 0.25); // flat ground, all walkable

  const character = new DummyCharacter(navGrid);
  scene.add(character.root);

  // ── Torch light ──────────────────────────────────────────────────────
  const torchLight = new THREE.PointLight(0xffaa44, 0, 10);
  torchLight.castShadow = false;
  torchLight.visible = false;
  scene.add(torchLight);

  // Click marker ring
  const markerGeo = new THREE.RingGeometry(0.3, 0.45, 24);
  markerGeo.rotateX(-Math.PI / 2);
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
      if (character.goTo(hit.x, hit.z, useGameStore.getState().charMoveSpeed)) {
        clickMarker.position.set(hit.x, 0.02, hit.z);
        markerMat.opacity = 1;
        markerFade = 0.5;
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

    // Sync grid opacity
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

    // Click marker fade
    if (markerFade > 0) {
      markerFade -= dt;
      markerMat.opacity = Math.max(0, markerFade / 0.5);
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
