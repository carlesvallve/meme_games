import * as THREE from 'three';
import type { SceneLights, SceneSky } from './Scene';
import type { SkyColors } from './Sky';
import { applyLightPreset } from './Scene';
import type { LightPreset } from '../../store';

// ── Sun orbit ────────────────────────────────────────────────────────

const _sunDir = new THREE.Vector3();

/**
 * Compute sun direction from time of day (0–24).
 * 0h = nadir (directly below), 6h = east horizon, 12h = zenith, 18h = west horizon.
 */
export function computeSunDirection(timeOfDay: number): THREE.Vector3 {
  const angle = (timeOfDay / 24) * Math.PI * 2 - Math.PI / 2;
  _sunDir.set(
    Math.cos(angle) * 0.8,  // east-west
    Math.sin(angle),         // up-down
    Math.cos(angle) * 0.4,   // slight depth tilt
  );
  _sunDir.normalize();
  return _sunDir;
}

/**
 * Light intensity scale based on time of day (0–1).
 * Full brightness ~8–16h, smooth falloff at dawn/dusk, dim floor at night.
 */
export function computeDayLightScale(timeOfDay: number): number {
  const angle = (timeOfDay / 24) * Math.PI * 2 - Math.PI / 2;
  const sinVal = Math.sin(angle); // -1 at midnight, +1 at noon
  if (sinVal <= 0) return 0.3; // night floor — moonlit visibility
  const t = Math.pow(sinVal, 0.5);
  return 0.3 + t * 0.7;
}

/**
 * Star intensity: 1 at night, 0 during day, smooth transitions at dawn/dusk.
 */
export function computeStarIntensity(timeOfDay: number): number {
  const angle = (timeOfDay / 24) * Math.PI * 2 - Math.PI / 2;
  const sinVal = Math.sin(angle);
  // Stars fully visible when sun well below horizon, fade out as it rises
  if (sinVal <= -0.2) return 1.0;
  if (sinVal >= 0.1) return 0.0;
  // Smooth transition zone (-0.2 to 0.1)
  return 1.0 - smoothstep(-0.2, 0.1, sinVal);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ── Sky color targets for blending ───────────────────────────────────

const _nightColors: SkyColors = {
  zenith: 0x151530,
  horizon: 0x222240,
  ground: 0x101020,
  sun: 0xaabbff,
  sunGlow: 0x4455aa,
  fog: 0x1a1a30,
};

const _tmpColor = new THREE.Color();
const _tmpColor2 = new THREE.Color();

function lerpColor(a: number, b: number, t: number): number {
  _tmpColor.set(a);
  _tmpColor2.set(b);
  _tmpColor.lerp(_tmpColor2, t);
  return _tmpColor.getHex();
}

function blendSkyColors(base: SkyColors, target: SkyColors, t: number): SkyColors {
  return {
    zenith: lerpColor(base.zenith, target.zenith, t),
    horizon: lerpColor(base.horizon, target.horizon, t),
    ground: lerpColor(base.ground, target.ground, t),
    sun: lerpColor(base.sun, target.sun, t),
    sunGlow: lerpColor(base.sunGlow, target.sunGlow, t),
    fog: lerpColor(base.fog, target.fog, t),
  };
}

/** Brighten a hex color: boost lightness while keeping hue/saturation. */
function brightenColor(hex: number, factor: number): number {
  _tmpColor.set(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  _tmpColor.getHSL(hsl);
  // Push lightness toward 1, keep hue, slightly boost saturation
  hsl.l = hsl.l + (1.0 - hsl.l) * factor;
  hsl.s = Math.min(1, hsl.s * (1 + factor * 0.3));
  _tmpColor.setHSL(hsl.h, hsl.s, hsl.l);
  return _tmpColor.getHex();
}

/** Build a bright daytime version of the palette's own sky colors. */
function buildDayColors(palette: SkyColors): SkyColors {
  return {
    zenith: brightenColor(palette.zenith, 0.4),
    horizon: brightenColor(palette.horizon, 0.35),
    ground: brightenColor(palette.ground, 0.25),
    sun: brightenColor(palette.sun, 0.2),
    sunGlow: brightenColor(palette.sunGlow, 0.2),
    fog: brightenColor(palette.fog, 0.35),
  };
}

/** Build warm dawn/dusk colors from the palette — shift hue toward orange/warm. */
function buildDawnColors(palette: SkyColors): SkyColors {
  // Blend palette horizon toward warm orange, keep zenith darker
  const warmHorizon = lerpColor(palette.horizon, 0xdd7740, 0.5);
  const warmFog = lerpColor(palette.fog, 0x6a3820, 0.4);
  return {
    zenith: brightenColor(palette.zenith, 0.2),
    horizon: warmHorizon,
    ground: palette.ground,
    sun: lerpColor(palette.sun, 0xffdd90, 0.5),
    sunGlow: lerpColor(palette.sunGlow, 0xff7730, 0.5),
    fog: warmFog,
  };
}

/**
 * Blend palette sky colors for current time of day.
 * Daytime colors are brightened versions of the palette's own colors,
 * preserving each palette's unique character (mars stays reddish, etc).
 *
 * Phases (by sinVal = sin of sun angle):
 *   sinVal <= -0.15 : full night
 *   -0.15 → 0.15    : dawn/dusk (palette-tinted warm transition)
 *   0.15 → 0.5      : early/late day ramp
 *   >= 0.5           : full daytime (brightened palette)
 */
export function computeSkyColorsForTime(basePalette: SkyColors, timeOfDay: number): SkyColors {
  const angle = (timeOfDay / 24) * Math.PI * 2 - Math.PI / 2;
  const sinVal = Math.sin(angle);

  const dawnColors = buildDawnColors(basePalette);
  const dayColors = buildDayColors(basePalette);

  // Full night
  if (sinVal <= -0.15) {
    return { ..._nightColors };
  }

  // Dawn/dusk transition (-0.15 to 0.15)
  if (sinVal < 0.15) {
    const t = smoothstep(-0.15, 0.15, sinVal);
    return blendSkyColors(_nightColors, dawnColors, t);
  }

  // Dawn-to-day transition (0.15 to 0.5)
  if (sinVal < 0.5) {
    const t = smoothstep(0.15, 0.5, sinVal);
    return blendSkyColors(dawnColors, dayColors, t);
  }

  // Full day — brightened palette colors
  return dayColors;
}

// ── Debug helper ─────────────────────────────────────────────────────

function createOrbGroup(name: string, color: number, arrowColor: number, radius: number): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  const geo = new THREE.SphereGeometry(radius, 8, 8);
  const mat = new THREE.MeshBasicMaterial({ color });
  const sphere = new THREE.Mesh(geo, mat);
  sphere.name = `${name}Sphere`;
  group.add(sphere);
  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 0),
    radius * 6,
    arrowColor,
    radius * 1.2,
    radius * 0.6,
  );
  arrow.name = `${name}Arrow`;
  group.add(arrow);
  return group;
}

export function createSunDebugHelper(scene: THREE.Scene): THREE.Group {
  const root = new THREE.Group();
  root.name = 'sunDebugHelper';

  const sunGroup = createOrbGroup('sun', 0xffdd44, 0xff4444, 0.5);
  root.add(sunGroup);

  const moonGroup = createOrbGroup('moon', 0xbbccff, 0x6688cc, 0.35);
  root.add(moonGroup);

  scene.add(root);
  return root;
}

const _debugPos = new THREE.Vector3();
const _debugDir = new THREE.Vector3();
const _moonDebugPos = new THREE.Vector3();
const _moonDebugDir = new THREE.Vector3();

export function updateSunDebug(
  helper: THREE.Group,
  sunDir: THREE.Vector3,
  cameraTarget: THREE.Vector3,
): void {
  // Sun orb — positioned offset from camera target along sun direction
  const sunGroup = helper.getObjectByName('sun') as THREE.Group | undefined;
  if (sunGroup) {
    _debugPos.copy(sunDir).multiplyScalar(15).add(cameraTarget);
    sunGroup.position.copy(_debugPos);
    _debugDir.copy(sunDir).negate();
    const arrow = sunGroup.getObjectByName('sunArrow') as THREE.ArrowHelper | undefined;
    if (arrow) arrow.setDirection(_debugDir);
  }

  // Moon orb — opposite to sun
  const moonGroup = helper.getObjectByName('moon') as THREE.Group | undefined;
  if (moonGroup) {
    _moonDebugPos.copy(sunDir).negate().multiplyScalar(15).add(cameraTarget);
    moonGroup.position.copy(_moonDebugPos);
    _moonDebugDir.copy(sunDir); // moon light shines in sun direction (toward scene)
    const arrow = moonGroup.getObjectByName('moonArrow') as THREE.ArrowHelper | undefined;
    if (arrow) arrow.setDirection(_moonDebugDir);
  }
}

export function disposeSunDebugHelper(scene: THREE.Scene, helper: THREE.Group): void {
  scene.remove(helper);
  helper.traverse((obj) => {
    if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
    if ((obj as THREE.Mesh).material) {
      const mat = (obj as THREE.Mesh).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else (mat as THREE.Material).dispose();
    }
  });
}

// ── Dungeon interior lighting (static, no day cycle) ────────────────

/**
 * Apply fixed interior lighting for dungeons.
 * Single shadow-casting directional at a nice angle, warm ambient,
 * no moon, no sky/star updates.
 */
export function applyDungeonLighting(
  sceneLights: SceneLights,
  lightPreset: LightPreset,
): void {
  applyLightPreset(sceneLights, lightPreset, false);

  // Fixed directional from above-front for good wall/floor shadows
  sceneLights.dirPrimary.position.set(8, 25, 12);
  sceneLights.dirPrimary.castShadow = true;

  // Remove moon from rendering entirely (saves per-fragment light computation)
  sceneLights.dirMoon.visible = false;
  sceneLights.dirMoon.castShadow = false;

  // Warm ambient tint for interior feel
  sceneLights.ambient.color.setHex(0x8878a0);
  sceneLights.hemi.color.setHex(0x7878a0);
}

// ── Main update ──────────────────────────────────────────────────────

const _farPos = new THREE.Vector3();

export function updateDayCycle(
  sceneLights: SceneLights,
  sceneSky: SceneSky,
  lightPreset: LightPreset,
  isExterior: boolean,
  timeOfDay: number,
  basePalette: SkyColors,
  fog: THREE.Fog | null,
): void {
  const sunDir = computeSunDirection(timeOfDay);

  // Update sun direction in sky shader
  sceneSky.sky.setSunDirection(sunDir);

  // Update lensflare position and visibility
  _farPos.copy(sunDir).multiplyScalar(100);
  sceneSky.lensflare.position.copy(_farPos);
  sceneSky.lensflare.visible = sunDir.y > -0.05;

  // Sun directional light follows sun position
  sceneLights.dirPrimary.position.copy(sunDir).multiplyScalar(30);
  sceneLights.dirPrimary.shadow.camera.updateProjectionMatrix();

  // Ensure moon is in the scene (may have been hidden by dungeon lighting)
  sceneLights.dirMoon.visible = true;

  // Moon directional light — opposite to sun, active at night
  const moonDir = sunDir.clone().negate();
  // Clamp moon above horizon so it always shines downward when active
  if (moonDir.y < 0.15) {
    moonDir.y = 0.15;
    moonDir.normalize();
  }
  sceneLights.dirMoon.position.copy(moonDir).multiplyScalar(30);
  sceneLights.dirMoon.shadow.camera.updateProjectionMatrix();

  // Apply base light preset, then modulate by day cycle
  applyLightPreset(sceneLights, lightPreset, isExterior);
  const dayScale = computeDayLightScale(timeOfDay);
  const nightT = 1.0 - dayScale; // 0 at full day, ~0.7 at midnight

  // Sun lights: scale with day, fade to zero at night
  sceneLights.dirPrimary.intensity *= dayScale;
  sceneLights.dirFill.intensity *= dayScale;
  sceneLights.dirRim.intensity *= dayScale;

  // Moon light: ramps up at night, cool blue-purple tint
  const moonIntensity = nightT * 8.0;
  sceneLights.dirMoon.intensity = moonIntensity;

  // Sun always casts shadows in exterior; moon provides fill light without shadows
  sceneLights.dirPrimary.castShadow = true;
  sceneLights.dirMoon.castShadow = false;

  // Ambient + hemisphere: boost at night for overall visibility
  const ambientScale = Math.max(dayScale, 0.6);
  sceneLights.ambient.intensity *= ambientScale;
  sceneLights.hemi.intensity *= ambientScale;

  // Tint ambient toward blue-purple at night (reset to base color first to avoid drift)
  _tmpColor.setHex(0x7070a0); // original ambient color from createScene
  _tmpColor2.setHex(0x6068c0);
  _tmpColor.lerp(_tmpColor2, nightT * 0.7);
  sceneLights.ambient.color.copy(_tmpColor);

  // Tint hemisphere sky color toward cool blue at night
  _tmpColor.setHex(0x8080b0); // original hemi sky color from createScene
  _tmpColor2.setHex(0x5858b0);
  _tmpColor.lerp(_tmpColor2, nightT * 0.6);
  sceneLights.hemi.color.copy(_tmpColor);

  // Update sky colors for time of day
  const skyColors = computeSkyColorsForTime(basePalette, timeOfDay);
  sceneSky.sky.setColors(skyColors);

  // Update star intensity
  const starIntensity = computeStarIntensity(timeOfDay);
  sceneSky.sky.setStarIntensity(starIntensity);

  // Update fog color
  if (fog) {
    fog.color.set(skyColors.fog);
  }
}
