import * as THREE from 'three';
import { LIGHT_DEFAULTS, LIGHT_PRESET_SCALES, LIGHT_EXTERIOR_SCALE } from '../../store';
import type { LightPreset } from '../../store';
import { ProceduralSky, createSunLensflare, getSkyColors, type SkyColors } from './Sky';

export interface SceneLights {
  ambient: THREE.AmbientLight;
  dirPrimary: THREE.DirectionalLight;
  dirFill: THREE.DirectionalLight;
  dirRim: THREE.DirectionalLight;
  dirMoon: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
}

export interface SceneSky {
  sky: ProceduralSky;
  lensflare: THREE.Object3D;
  setColors: (colors: SkyColors) => void;
  setPalette: (paletteName: string) => void;
  setStarIntensity: (v: number) => void;
  dispose: () => void;
}

export function applyLightPreset(lights: SceneLights, preset: LightPreset, isExterior = false): void {
  const s = LIGHT_PRESET_SCALES[preset];
  const ext = isExterior ? LIGHT_EXTERIOR_SCALE : 1;
  lights.ambient.intensity = LIGHT_DEFAULTS.ambient * s * ext;
  lights.dirPrimary.intensity = LIGHT_DEFAULTS.dirPrimary * s * ext;
  lights.dirFill.intensity = LIGHT_DEFAULTS.dirFill * s * ext;
  lights.dirRim.intensity = LIGHT_DEFAULTS.dirRim * s * ext;
  lights.hemi.intensity = LIGHT_DEFAULTS.hemi * s * ext;
}

export function createScene(paletteName = 'meadow'): { scene: THREE.Scene; lights: SceneLights; sceneSky: SceneSky } {
  const scene = new THREE.Scene();
  scene.background = null; // sky mesh replaces solid background

  // Ambient light
  const ambient = new THREE.AmbientLight(0x7070a0, LIGHT_DEFAULTS.ambient);
  scene.add(ambient);

  // Primary directional (with shadows)
  const dirPrimary = new THREE.DirectionalLight(0xffffff, LIGHT_DEFAULTS.dirPrimary);
  dirPrimary.position.set(8, 30, 10);
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
  const dirFill = new THREE.DirectionalLight(0x6a6a8a, LIGHT_DEFAULTS.dirFill);
  dirFill.position.set(-12, 15, -8);
  scene.add(dirFill);

  // Rim directional
  const dirRim = new THREE.DirectionalLight(0x8888aa, LIGHT_DEFAULTS.dirRim);
  dirRim.position.set(5, 8, -15);
  scene.add(dirRim);

  // Moon directional (shadow-casting, active at night)
  const dirMoon = new THREE.DirectionalLight(0x6070b0, 0);
  dirMoon.position.set(-8, 30, -10);
  dirMoon.castShadow = true;
  dirMoon.shadow.mapSize.set(1024, 1024);
  dirMoon.shadow.camera.near = 0.5;
  dirMoon.shadow.camera.far = 60;
  dirMoon.shadow.camera.left = -d;
  dirMoon.shadow.camera.right = d;
  dirMoon.shadow.camera.top = d;
  dirMoon.shadow.camera.bottom = -d;
  scene.add(dirMoon);

  // Hemisphere
  const hemi = new THREE.HemisphereLight(0x8080b0, 0x2a2a45, LIGHT_DEFAULTS.hemi);
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
    setStarIntensity(v: number) {
      sky.setStarIntensity(v);
    },
    dispose() {
      scene.remove(sky.mesh);
      scene.remove(lensflare);
      sky.dispose();
    },
  };

  return { scene, lights: { ambient, dirPrimary, dirFill, dirRim, dirMoon, hemi }, sceneSky };
}
