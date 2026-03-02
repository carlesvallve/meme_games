import * as THREE from 'three';
import type { LightPreset } from '../../store';
import { ProceduralSky, createSunLensflare, getSkyColors, type SkyColors } from './Sky';

export interface SceneLights {
  ambient: THREE.AmbientLight;
  dirPrimary: THREE.DirectionalLight;
  dirFill: THREE.DirectionalLight;
  dirRim: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
}

export interface SceneSky {
  sky: ProceduralSky;
  lensflare: THREE.Object3D;
  setColors: (colors: SkyColors) => void;
  setPalette: (paletteName: string) => void;
  dispose: () => void;
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
  default: 1.5,
  bright: 2.5,
  dark: 0.15,
  none: 0,
};


export function applyLightPreset(lights: SceneLights, preset: LightPreset, isExterior = false): void {
  const s = PRESET_SCALES[preset];
  const ext = isExterior ? 1.6 : 1;
  lights.ambient.intensity = DEFAULTS.ambient * s * ext;
  lights.dirPrimary.intensity = DEFAULTS.dirPrimary * s * ext;
  lights.dirFill.intensity = DEFAULTS.dirFill * s * ext;
  lights.dirRim.intensity = DEFAULTS.dirRim * s * ext;
  lights.hemi.intensity = DEFAULTS.hemi * s * ext;
}

export function createScene(paletteName = 'meadow'): { scene: THREE.Scene; lights: SceneLights; sceneSky: SceneSky } {
  const scene = new THREE.Scene();
  scene.background = null; // sky mesh replaces solid background

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

  // Procedural sky + lensflare
  const skyColors = getSkyColors(paletteName);
  scene.fog = new THREE.Fog(new THREE.Color(skyColors.fog), 20, 50);

  const sunDir = dirPrimary.position.clone().normalize();
  const sky = new ProceduralSky(sunDir, skyColors);
  scene.add(sky.mesh);

  const sunFarPos = sunDir.clone().multiplyScalar(100);
  const lensflare = createSunLensflare(sunFarPos, skyColors);
  scene.add(lensflare);

  const sceneSky: SceneSky = {
    sky,
    lensflare,
    setColors(colors: SkyColors) {
      sky.setColors(colors);
      (scene.fog as THREE.Fog).color.set(colors.fog);
    },
    setPalette(name: string) {
      const c = getSkyColors(name);
      this.setColors(c);
    },
    dispose() {
      scene.remove(sky.mesh);
      scene.remove(lensflare);
      sky.dispose();
    },
  };

  return { scene, lights: { ambient, dirPrimary, dirFill, dirRim, hemi }, sceneSky };
}
