import * as THREE from 'three';
import type { ParticleSystem, ParticleOptions } from '../types';

// ── Dust Motes ──

export function createDustMotes(opts: ParticleOptions = {}): ParticleSystem {
  const {
    count = 40,
    area = { x: 10, y: 5, z: 10 },
    speed = 0.3,
    size = 0.06,
    color = 0xffffff,
    opacity = 0.4,
  } = opts;

  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * area.x;
    positions[i * 3 + 1] = Math.random() * area.y;
    positions[i * 3 + 2] = (Math.random() - 0.5) * area.z;

    velocities[i * 3] = (Math.random() - 0.5) * speed;
    velocities[i * 3 + 1] = Math.random() * speed * 0.5;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * speed;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color,
    size,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  const group = new THREE.Group();
  group.add(points);

  return {
    group,
    update(dt: number) {
      const posAttr = geometry.attributes.position as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;

      for (let i = 0; i < count; i++) {
        arr[i * 3] += velocities[i * 3] * dt;
        arr[i * 3 + 1] += velocities[i * 3 + 1] * dt;
        arr[i * 3 + 2] += velocities[i * 3 + 2] * dt;

        if (arr[i * 3] > area.x / 2) arr[i * 3] = -area.x / 2;
        if (arr[i * 3] < -area.x / 2) arr[i * 3] = area.x / 2;
        if (arr[i * 3 + 1] > area.y) arr[i * 3 + 1] = 0;
        if (arr[i * 3 + 1] < 0) arr[i * 3 + 1] = area.y;
        if (arr[i * 3 + 2] > area.z / 2) arr[i * 3 + 2] = -area.z / 2;
        if (arr[i * 3 + 2] < -area.z / 2) arr[i * 3 + 2] = area.z / 2;
      }

      posAttr.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ── Ziggurat-style Rain (parametric: 'normal' or 'light' intensity) ──

interface RainConfig {
  dropCount: number;
  splashCount: number;
  speed: number;
  windMax: number;
  windVariation: number;
  columnHeight: number;
  splashLifetime: number;
  splashScaleMin: number;
  splashScaleRange: number;
  dropOpacity: number;
  splashOpacity: number;
  audioFreq: number;
  audioQ: number;
  audioGain: number;
}

const RAIN_CONFIGS: Record<string, RainConfig> = {
  normal: {
    dropCount: 400,
    splashCount: 150,
    speed: 12,
    windMax: 1.2,
    windVariation: 0.25,
    columnHeight: 30,
    splashLifetime: 0.28,
    splashScaleMin: 0.02,
    splashScaleRange: 0.07,
    dropOpacity: 0.22,
    splashOpacity: 0.2,
    audioFreq: 3500,
    audioQ: 0.5,
    audioGain: 0.06,
  },
  light: {
    dropCount: 120,
    splashCount: 60,
    speed: 6,
    windMax: 0.3,
    windVariation: 0.08,
    columnHeight: 30,
    splashLifetime: 0.4,
    splashScaleMin: 0.015,
    splashScaleRange: 0.05,
    dropOpacity: 0.15,
    splashOpacity: 0.15,
    audioFreq: 2200,
    audioQ: 0.8,
    audioGain: 0.025,
  },
};

export function createRainEffect(opts: ParticleOptions & {
  groundHeightAt?: (x: number, z: number) => number;
  intensity?: 'normal' | 'light';
} = {}): ParticleSystem {
  const {
    area = { x: 24, y: 30, z: 24 },
    groundHeightAt,
    intensity = 'normal',
  } = opts;

  const cfg = RAIN_CONFIGS[intensity];
  const group = new THREE.Group();

  // ── Rain drops: thin cylinders ──
  const dropGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.14, 3);
  const dropMat = new THREE.MeshBasicMaterial({
    color: 0x99aacc,
    transparent: true,
    opacity: cfg.dropOpacity,
    depthWrite: false,
  });

  const dropMesh = new THREE.InstancedMesh(dropGeo, dropMat, cfg.dropCount);
  dropMesh.frustumCulled = false;
  group.add(dropMesh);

  // Per-drop state
  const dropPositions = new Float32Array(cfg.dropCount * 3);
  const dropWindX = new Float32Array(cfg.dropCount);
  const dropWindZ = new Float32Array(cfg.dropCount);

  for (let i = 0; i < cfg.dropCount; i++) {
    dropPositions[i * 3] = (Math.random() - 0.5) * area.x;
    dropPositions[i * 3 + 1] = Math.random() * cfg.columnHeight;
    dropPositions[i * 3 + 2] = (Math.random() - 0.5) * area.z;
    dropWindX[i] = (Math.random() - 0.5) * 2 * cfg.windVariation;
    dropWindZ[i] = (Math.random() - 0.5) * 2 * cfg.windVariation;
  }

  // Global wind — smoothly changing direction
  let windX = 0.5 * (cfg.windMax / 1.2);
  let windZ = 0.3 * (cfg.windMax / 1.2);
  let windTargetX = windX;
  let windTargetZ = windZ;
  let windTimer = 0;

  // ── Splash rings (Ziggurat: large geometry, tiny scale, explicit rotation) ──
  const splashGeo = new THREE.RingGeometry(0.25, 0.35, 8);
  const splashMat = new THREE.MeshBasicMaterial({
    color: 0xccddff,
    transparent: true,
    opacity: cfg.splashOpacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const splashMesh = new THREE.InstancedMesh(splashGeo, splashMat, cfg.splashCount);
  splashMesh.frustumCulled = false;
  group.add(splashMesh);

  // Splash pool with alive/dead tracking
  const splashes: { x: number; y: number; z: number; age: number; alive: boolean }[] = [];
  for (let i = 0; i < cfg.splashCount; i++) {
    splashes.push({ x: 0, y: 0, z: 0, age: 0, alive: false });
  }
  let nextSplash = 0;

  // ── Rain ambient audio ──
  let audioCtx: AudioContext | null = null;
  let rainSource: AudioBufferSourceNode | null = null;
  let rainGain: GainNode | null = null;

  function startRainAudio(): void {
    try {
      audioCtx = new AudioContext();
      const bufferSize = audioCtx.sampleRate * 2;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1);
      }

      rainSource = audioCtx.createBufferSource();
      rainSource.buffer = buffer;
      rainSource.loop = true;

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = cfg.audioFreq;
      filter.Q.value = cfg.audioQ;

      rainGain = audioCtx.createGain();
      rainGain.gain.value = 0;
      rainGain.gain.linearRampToValueAtTime(cfg.audioGain, audioCtx.currentTime + 2);

      rainSource.connect(filter);
      filter.connect(rainGain);
      rainGain.connect(audioCtx.destination);
      rainSource.start();
    } catch {
      // Audio not available
    }
  }

  function stopRainAudio(): void {
    if (rainGain && audioCtx) {
      rainGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 1);
    }
    setTimeout(() => {
      rainSource?.stop();
      audioCtx?.close();
      audioCtx = null;
      rainSource = null;
      rainGain = null;
    }, 1500);
  }

  startRainAudio();

  const dropDummy = new THREE.Object3D();
  const splashDummy = new THREE.Object3D();
  const _vel = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);

  // Initialize all splash instances as hidden
  for (let i = 0; i < cfg.splashCount; i++) {
    splashDummy.scale.set(0, 0, 0);
    splashDummy.updateMatrix();
    splashMesh.setMatrixAt(i, splashDummy.matrix);
  }
  splashMesh.instanceMatrix.needsUpdate = true;

  return {
    group,
    update(dt: number) {
      // ── Smooth global wind ──
      windTimer -= dt;
      if (windTimer <= 0) {
        windTargetX = (Math.random() - 0.5) * 2 * cfg.windMax;
        windTargetZ = (Math.random() - 0.5) * 2 * cfg.windMax;
        windTimer = 8 + Math.random() * 6;
      }
      const windLerp = 1 - Math.pow(0.08, dt);
      windX += (windTargetX - windX) * windLerp;
      windZ += (windTargetZ - windZ) * windLerp;

      // ── Update drops ──
      for (let i = 0; i < cfg.dropCount; i++) {
        const px = i * 3;
        const py = i * 3 + 1;
        const pz = i * 3 + 2;

        const vx = windX + dropWindX[i];
        const vz = windZ + dropWindZ[i];

        dropPositions[px] += vx * dt;
        dropPositions[py] -= cfg.speed * dt;
        dropPositions[pz] += vz * dt;

        // Hit ground or terrain surface — spawn splash, respawn drop
        const surfaceY = groundHeightAt ? groundHeightAt(dropPositions[px], dropPositions[pz]) : 0;
        if (dropPositions[py] <= surfaceY) {
          // Only spawn splash if surface is flat within the splash radius
          // (avoids half-splashes floating off cube edges)
          const splashR = (cfg.splashScaleMin + cfg.splashScaleRange) * 0.7; // max visual radius
          let flatSurface = true;
          if (groundHeightAt) {
            const sx = dropPositions[px];
            const sz = dropPositions[pz];
            const threshold = 0.15;
            if (
              Math.abs(groundHeightAt(sx + splashR, sz) - surfaceY) > threshold ||
              Math.abs(groundHeightAt(sx - splashR, sz) - surfaceY) > threshold ||
              Math.abs(groundHeightAt(sx, sz + splashR) - surfaceY) > threshold ||
              Math.abs(groundHeightAt(sx, sz - splashR) - surfaceY) > threshold
            ) {
              flatSurface = false;
            }
          }

          if (flatSurface) {
            const si = nextSplash % cfg.splashCount;
            const sp = splashes[si];
            sp.x = dropPositions[px];
            sp.y = surfaceY + 0.06;
            sp.z = dropPositions[pz];
            sp.age = 0;
            sp.alive = true;
            nextSplash++;
          }

          // Respawn drop across 30-100% of column height
          dropPositions[py] = cfg.columnHeight * 0.3 + Math.random() * cfg.columnHeight * 0.7;
          dropPositions[px] = (Math.random() - 0.5) * area.x;
          dropPositions[pz] = (Math.random() - 0.5) * area.z;
          // Refresh per-drop wind offset on respawn
          dropWindX[i] = (Math.random() - 0.5) * 2 * cfg.windVariation;
          dropWindZ[i] = (Math.random() - 0.5) * 2 * cfg.windVariation;
        }

        // Wrap X/Z
        if (dropPositions[px] > area.x / 2) dropPositions[px] -= area.x;
        if (dropPositions[px] < -area.x / 2) dropPositions[px] += area.x;
        if (dropPositions[pz] > area.z / 2) dropPositions[pz] -= area.z;
        if (dropPositions[pz] < -area.z / 2) dropPositions[pz] += area.z;

        // Orient drop along velocity
        _vel.set(vx, -cfg.speed, vz).normalize();
        dropDummy.position.set(dropPositions[px], dropPositions[py], dropPositions[pz]);
        dropDummy.quaternion.setFromUnitVectors(_up, _vel);
        dropDummy.scale.set(1, 1, 1);
        dropDummy.updateMatrix();
        dropMesh.setMatrixAt(i, dropDummy.matrix);
      }
      dropMesh.instanceMatrix.needsUpdate = true;

      // ── Update splashes (explicit rotation, non-uniform scale) ──
      for (let i = 0; i < cfg.splashCount; i++) {
        const sp = splashes[i];
        if (!sp.alive) {
          splashDummy.scale.set(0, 0, 0);
        } else {
          sp.age += dt;
          if (sp.age >= cfg.splashLifetime) {
            sp.alive = false;
            splashDummy.scale.set(0, 0, 0);
          } else {
            const prog = sp.age / cfg.splashLifetime;
            const r = cfg.splashScaleMin + prog * cfg.splashScaleRange;
            splashDummy.position.set(sp.x, sp.y, sp.z);
            splashDummy.rotation.set(-Math.PI / 2, 0, 0);
            splashDummy.scale.set(r, r, 1);
          }
        }
        splashDummy.updateMatrix();
        splashMesh.setMatrixAt(i, splashDummy.matrix);
      }
      splashMesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      stopRainAudio();
      dropGeo.dispose();
      dropMat.dispose();
      splashGeo.dispose();
      splashMat.dispose();
      dropMesh.dispose();
      splashMesh.dispose();
    },
  };
}

// ── Wind Debris (tumbling papers) ──

const DEBRIS_COUNT = 20;
const DEBRIS_BOUNDS = 8;
const WIND_SPEED = 0.6;
const WIND_TURBULENCE = 0.3;

const PAPER_COLORS = [
  0xeeeeee, 0xddddcc, 0xccccbb, 0xbbaa99,
  0xd4c9a8, 0xc8bfa0, 0xaaaaaa, 0xe8e0d0,
];

export function createDebrisEffect(): ParticleSystem {
  const group = new THREE.Group();

  const geo = new THREE.PlaneGeometry(0.2, 0.14);
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, DEBRIS_COUNT);
  mesh.frustumCulled = false;
  group.add(mesh);

  // Per-debris state
  const positions = new Float32Array(DEBRIS_COUNT * 3);
  const phases = new Float32Array(DEBRIS_COUNT);
  const scales = new Float32Array(DEBRIS_COUNT);
  const baseY = new Float32Array(DEBRIS_COUNT);

  for (let i = 0; i < DEBRIS_COUNT; i++) {
    positions[i * 3] = (Math.random() - 0.5) * DEBRIS_BOUNDS * 2;
    baseY[i] = 0.25 + Math.random() * 2;
    positions[i * 3 + 1] = baseY[i];
    positions[i * 3 + 2] = (Math.random() - 0.5) * DEBRIS_BOUNDS * 2;
    phases[i] = Math.random() * Math.PI * 2;
    scales[i] = 0.5 + Math.random() * 1.0;

    // Set per-instance color
    const color = new THREE.Color(PAPER_COLORS[Math.floor(Math.random() * PAPER_COLORS.length)]);
    mesh.setColorAt(i, color);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  // Wind audio
  let audioCtx: AudioContext | null = null;
  let windSource: AudioBufferSourceNode | null = null;
  let windGain: GainNode | null = null;

  function startWindAudio(): void {
    try {
      audioCtx = new AudioContext();
      const bufferSize = audioCtx.sampleRate * 2;
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1);
      }

      windSource = audioCtx.createBufferSource();
      windSource.buffer = buffer;
      windSource.loop = true;

      const filter = audioCtx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 400;
      filter.Q.value = 0.3;

      windGain = audioCtx.createGain();
      windGain.gain.value = 0;
      windGain.gain.linearRampToValueAtTime(0.04, audioCtx.currentTime + 3);

      windSource.connect(filter);
      filter.connect(windGain);
      windGain.connect(audioCtx.destination);
      windSource.start();
    } catch {
      // Audio not available
    }
  }

  function stopWindAudio(): void {
    if (windGain && audioCtx) {
      windGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 1);
    }
    setTimeout(() => {
      windSource?.stop();
      audioCtx?.close();
      audioCtx = null;
      windSource = null;
      windGain = null;
    }, 1500);
  }

  startWindAudio();

  let elapsed = 0;
  const dummy = new THREE.Object3D();

  return {
    group,
    update(dt: number) {
      elapsed += dt;

      for (let i = 0; i < DEBRIS_COUNT; i++) {
        const ph = phases[i];
        const t = elapsed;

        // Drift with wind + turbulence
        positions[i * 3] += (WIND_SPEED * 0.6 + Math.sin(t + ph) * WIND_TURBULENCE) * dt * 4;
        positions[i * 3 + 2] += (Math.sin(t * 0.7 + ph * 1.3) * WIND_TURBULENCE) * dt * 4;

        // Bob up and down
        positions[i * 3 + 1] = baseY[i] + Math.sin(t * 1.5 + ph * 2) * 0.4;

        // Wrap around
        if (positions[i * 3] > DEBRIS_BOUNDS) {
          positions[i * 3] = -DEBRIS_BOUNDS;
          positions[i * 3 + 2] = (Math.random() - 0.5) * DEBRIS_BOUNDS * 2;
          baseY[i] = 0.25 + Math.random() * 2;
        }

        // Tumble rotation
        dummy.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
        dummy.rotation.set(
          Math.sin(t * 0.8 + ph * 3) * 0.6,  // roll
          t * 0.3 + ph,                         // yaw (continuous spin)
          Math.sin(t + ph) * 0.5,               // pitch
        );
        dummy.scale.setScalar(scales[i]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      stopWindAudio();
      geo.dispose();
      mat.dispose();
      mesh.dispose();
    },
  };
}

// ── Firework Burst (kept for completeness) ──

export function createFireworkBurst(opts: ParticleOptions & { origin?: THREE.Vector3 } = {}): ParticleSystem {
  const {
    count = 50,
    speed = 5,
    size = 0.1,
    color = 0xffaa00,
    opacity = 1,
    origin = new THREE.Vector3(0, 2, 0),
  } = opts;

  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const lifetimes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    positions[i * 3] = origin.x;
    positions[i * 3 + 1] = origin.y;
    positions[i * 3 + 2] = origin.z;

    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const v = speed * (0.5 + Math.random() * 0.5);
    velocities[i * 3] = v * Math.sin(phi) * Math.cos(theta);
    velocities[i * 3 + 1] = v * Math.cos(phi);
    velocities[i * 3 + 2] = v * Math.sin(phi) * Math.sin(theta);

    lifetimes[i] = 1.0;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color,
    size,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  const group = new THREE.Group();
  group.add(points);

  return {
    group,
    update(dt: number) {
      const posAttr = geometry.attributes.position as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      let alive = false;

      for (let i = 0; i < count; i++) {
        if (lifetimes[i] <= 0) continue;
        alive = true;

        lifetimes[i] -= dt;
        velocities[i * 3 + 1] -= 9.8 * dt;

        arr[i * 3] += velocities[i * 3] * dt;
        arr[i * 3 + 1] += velocities[i * 3 + 1] * dt;
        arr[i * 3 + 2] += velocities[i * 3 + 2] * dt;
      }

      material.opacity = alive ? Math.max(0, material.opacity - dt * 0.5) : 0;
      posAttr.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
