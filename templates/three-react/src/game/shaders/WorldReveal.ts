import * as THREE from 'three';
import type { Camera } from '../rendering/Camera';
import type { PostProcessStack } from '../rendering/PostProcessing';

// HMR-safe uniforms
const _w = window as unknown as { __worldRevealUniforms?: typeof _defaults };
const _defaults = {
  u_worldRevealT: { value: 0.0 },
  u_worldRevealActive: { value: 0.0 },
  u_worldRevealMaxH: { value: 5.0 },
  u_worldRevealEdge: { value: 0.15 },
  u_worldRevealSpread: { value: 0.5 },
  u_worldRevealRadial: { value: 0.3 },
  // Occlusion reveal (see-through-walls)
  u_revealCenter: { value: new THREE.Vector3() },
  u_cameraPos: { value: new THREE.Vector3() },
  u_revealActive: { value: 0.0 },
  u_revealRadius: { value: 3.0 },
  u_revealFalloff: { value: 2.0 },
};
if (!_w.__worldRevealUniforms) _w.__worldRevealUniforms = _defaults;
export const worldRevealUniforms = _w.__worldRevealUniforms;

// HMR-safe patched set
const _wp = window as unknown as { __worldRevealPatched?: WeakSet<THREE.Material> };
if (!_wp.__worldRevealPatched) _wp.__worldRevealPatched = new WeakSet();
const patched = _wp.__worldRevealPatched;

/**
 * Patch a MeshStandardMaterial with progress-based reveal.
 * Each XZ area gets a random delay (hash + radial) so areas reveal at different times.
 * Within each area, geometry rises from Y=0 upward.
 */
export function patchWorldRevealMaterial(mat: THREE.MeshStandardMaterial): void {
  if (patched.has(mat)) return;
  patched.add(mat);

  const prevCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prevCompile) prevCompile(shader, renderer);

    shader.uniforms.u_worldRevealT = worldRevealUniforms.u_worldRevealT;
    shader.uniforms.u_worldRevealActive = worldRevealUniforms.u_worldRevealActive;
    shader.uniforms.u_worldRevealMaxH = worldRevealUniforms.u_worldRevealMaxH;
    shader.uniforms.u_worldRevealEdge = worldRevealUniforms.u_worldRevealEdge;
    shader.uniforms.u_worldRevealSpread = worldRevealUniforms.u_worldRevealSpread;
    shader.uniforms.u_worldRevealRadial = worldRevealUniforms.u_worldRevealRadial;
    // Occlusion reveal
    shader.uniforms.u_revealCenter = worldRevealUniforms.u_revealCenter;
    shader.uniforms.u_cameraPos = worldRevealUniforms.u_cameraPos;
    shader.uniforms.u_revealActive = worldRevealUniforms.u_revealActive;
    shader.uniforms.u_revealRadius = worldRevealUniforms.u_revealRadius;
    shader.uniforms.u_revealFalloff = worldRevealUniforms.u_revealFalloff;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 v_wRevealPos;',
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nv_wRevealPos = (modelMatrix * vec4(position, 1.0)).xyz;',
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
uniform float u_worldRevealT;
uniform float u_worldRevealActive;
uniform float u_worldRevealMaxH;
uniform float u_worldRevealEdge;
uniform float u_worldRevealSpread;
uniform float u_worldRevealRadial;
uniform vec3 u_revealCenter;
uniform vec3 u_cameraPos;
uniform float u_revealActive;
uniform float u_revealRadius;
uniform float u_revealFalloff;
varying vec3 v_wRevealPos;

float revealHash(vec2 p) {
  vec2 cell = floor(p * 2.0);
  return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
}`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
if (u_worldRevealActive > 0.01) {
  float noiseDelay = revealHash(v_wRevealPos.xz) * u_worldRevealSpread;
  float radialDelay = min(length(v_wRevealPos.xz) / 20.0, 1.0) * u_worldRevealRadial;
  float totalDelay = noiseDelay + radialDelay;

  float riseWindow = 0.3;
  float localT = clamp((u_worldRevealT - totalDelay) / riseWindow, 0.0, 1.0);
  localT = 1.0 - pow(1.0 - localT, 2.0);

  float areaRevealY = localT * u_worldRevealMaxH;
  float revealDist = v_wRevealPos.y - areaRevealY;
  if (revealDist > u_worldRevealEdge) discard;

  // Thin bright edge line at the reveal frontier — HDR so bloom catches it
  float edgeThickness = 0.03;
  float glow = smoothstep(u_worldRevealEdge - edgeThickness, u_worldRevealEdge, revealDist);
  gl_FragColor.rgb += vec3(2.0, 1.6, 0.8) * glow * u_worldRevealActive;
}

// Occlusion reveal: make walls transparent when between camera and player
if (u_revealActive > 0.001) {
  vec3 toPlayer = u_revealCenter - u_cameraPos;
  vec3 lineDir = normalize(toPlayer + vec3(0.001));
  float xzLen = length(vec2(toPlayer.x, toPlayer.z));
  float horizontalness = xzLen / max(length(toPlayer), 0.001);
  float viewGate = smoothstep(0.05, 0.15, horizontalness);

  vec2 toCamXZ = -normalize(vec2(lineDir.x, lineDir.z) + vec2(0.0001));
  vec2 fragDeltaXZ = vec2(v_wRevealPos.x - u_revealCenter.x, v_wRevealPos.z - u_revealCenter.z);
  float fragDistXZ = length(fragDeltaXZ);
  vec2 fragDirXZ = fragDeltaXZ / max(fragDistXZ, 0.001);

  float angleDot = dot(fragDirXZ, toCamXZ);
  float inCone = smoothstep(-0.1, 0.3, angleDot) * viewGate;
  float distFade = smoothstep(u_revealRadius, u_revealRadius + u_revealFalloff, fragDistXZ);

  float revealAlpha = mix(1.0, mix(1.0, distFade, inCone), u_revealActive);
  gl_FragColor.a *= revealAlpha;
}`,
    );
  };
  mat.needsUpdate = true;
}

// ── Occlusion reveal — see through walls when they occlude the character ──

let smoothedOcclusionActive = 0;

export function updateOcclusionReveal(
  playerPos: THREE.Vector3,
  cameraPos: THREE.Vector3,
  occluded: boolean,
): void {
  worldRevealUniforms.u_revealCenter.value.copy(playerPos);
  worldRevealUniforms.u_cameraPos.value.copy(cameraPos);
  worldRevealUniforms.u_revealRadius.value = 3.0;
  worldRevealUniforms.u_revealFalloff.value = 2.0;

  const target = occluded ? 1.0 : 0.0;
  smoothedOcclusionActive += (target - smoothedOcclusionActive) * 0.12;
  if (Math.abs(smoothedOcclusionActive - target) < 0.01) smoothedOcclusionActive = target;
  worldRevealUniforms.u_revealActive.value = smoothedOcclusionActive;
}

// ── WorldRevealFX — self-contained reveal animation + juicy effects ──

export class WorldRevealFX {
  private cam: Camera | null = null;
  private postProcess: PostProcessStack | null = null;
  private active = false;
  private elapsed = 0;
  private duration = 3.0;
  private lastRumble = 0;
  private brightnessBoost = 0;

  /** Call once to wire up camera and post-processing references. */
  init(cam: Camera, postProcess: PostProcessStack): void {
    this.cam = cam;
    this.postProcess = postProcess;
  }

  /** Kick off a reveal sweep with effects. */
  start(maxHeight: number, duration = 3.0): void {
    this.active = true;
    this.elapsed = 0;
    this.duration = duration;
    this.lastRumble = 0;
    this.brightnessBoost = 0;

    worldRevealUniforms.u_worldRevealT.value = 0.0;
    worldRevealUniforms.u_worldRevealActive.value = 1.0;
    worldRevealUniforms.u_worldRevealMaxH.value = maxHeight + 0.5;

    // Initial brightness flash on generation start (no shake — too jarring)
    this.brightnessBoost = 0.2;
  }

  /** Call every frame with delta time. Drives shader + effects. */
  update(dt: number): void {
    // Decay brightness flash (independent of reveal active state)
    if (this.brightnessBoost > 0.001) {
      this.brightnessBoost *= Math.exp(-12 * dt); // very fast decay
      if (this.brightnessBoost < 0.001) this.brightnessBoost = 0;
      this.postProcess?.setBrightness(this.brightnessBoost);
    }

    if (!this.active) return;

    this.elapsed += dt;
    const t = Math.min(this.elapsed / this.duration, 1.0);

    // Drive shader progress
    const maxDelay = worldRevealUniforms.u_worldRevealSpread.value
      + worldRevealUniforms.u_worldRevealRadial.value;
    const riseWindow = 0.3;
    const totalRange = 1.0 + maxDelay + riseWindow;
    const shaderT = t * totalRange;
    worldRevealUniforms.u_worldRevealT.value = shaderT;

    // Check if all fragments have been revealed (shader is visually done)
    const shaderDone = shaderT >= maxDelay + riseWindow;

    // Periodic brightness pulse as blocks emerge
    if (!shaderDone && this.elapsed - this.lastRumble > 0.35) {
      this.lastRumble = this.elapsed;
      this.brightnessBoost = Math.max(this.brightnessBoost, 0.06 * (1 - t));
    }

    // End when shader is visually complete
    if (shaderDone) {
      this.active = false;
      this.brightnessBoost = 0;
      worldRevealUniforms.u_worldRevealActive.value = 0.0;
      worldRevealUniforms.u_worldRevealT.value = 0.0;
      this.postProcess?.setBrightness(0);
    }
  }

  isRevealing(): boolean {
    return this.active;
  }
}
