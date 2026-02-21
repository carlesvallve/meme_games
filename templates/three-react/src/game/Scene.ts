import * as THREE from 'three';
import type { LightPreset } from '../store';

export interface SceneLights {
  ambient: THREE.AmbientLight;
  dirPrimary: THREE.DirectionalLight;
  dirFill: THREE.DirectionalLight;
  dirRim: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
}

// Store default intensities so presets can scale them
const DEFAULTS = {
  ambient: 1.0,
  dirPrimary: 2.0,
  dirFill: 1.0,
  dirRim: 0.7,
  hemi: 0.8,
};

const PRESET_SCALES: Record<LightPreset, number> = {
  default: 1,
  bright: 1.6,
  dark: 0.15,
  none: 0,
};

export function applyLightPreset(lights: SceneLights, preset: LightPreset): void {
  const s = PRESET_SCALES[preset];
  lights.ambient.intensity = DEFAULTS.ambient * s;
  lights.dirPrimary.intensity = DEFAULTS.dirPrimary * s;
  lights.dirFill.intensity = DEFAULTS.dirFill * s;
  lights.dirRim.intensity = DEFAULTS.dirRim * s;
  lights.hemi.intensity = DEFAULTS.hemi * s;
}

export function createScene(): { scene: THREE.Scene; lights: SceneLights } {
  const scene = new THREE.Scene();
  const bgColor = 0x0a0a14;
  scene.background = new THREE.Color(bgColor);
  scene.fog = new THREE.Fog(bgColor, 20, 50);

  // Ambient light
  const ambient = new THREE.AmbientLight(0x7070a0, DEFAULTS.ambient);
  scene.add(ambient);

  // Primary directional (with shadows)
  const dirPrimary = new THREE.DirectionalLight(0xffffff, DEFAULTS.dirPrimary);
  dirPrimary.position.set(10, 20, 10);
  dirPrimary.castShadow = true;
  dirPrimary.shadow.mapSize.set(2048, 2048);
  dirPrimary.shadow.camera.near = 0.5;
  dirPrimary.shadow.camera.far = 60;
  const d = 20;
  dirPrimary.shadow.camera.left = -d;
  dirPrimary.shadow.camera.right = d;
  dirPrimary.shadow.camera.top = d;
  dirPrimary.shadow.camera.bottom = -d;
  scene.add(dirPrimary);

  // Fill directional
  const dirFill = new THREE.DirectionalLight(0x6a6a8a, DEFAULTS.dirFill);
  dirFill.position.set(-12, 15, -8);
  scene.add(dirFill);

  // Rim directional
  const dirRim = new THREE.DirectionalLight(0x8888aa, DEFAULTS.dirRim);
  dirRim.position.set(5, 8, -15);
  scene.add(dirRim);

  // Hemisphere
  const hemi = new THREE.HemisphereLight(0x8080b0, 0x2a2a45, DEFAULTS.hemi);
  scene.add(hemi);

  return { scene, lights: { ambient, dirPrimary, dirFill, dirRim, hemi } };
}
