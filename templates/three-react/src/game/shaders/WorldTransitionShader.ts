import * as THREE from 'three';
import type { Camera } from '../rendering/Camera';
import type { PostProcessStack } from '../rendering/PostProcessing';

// HMR-safe uniforms
const _w = window as unknown as { __worldTransitionUniforms?: typeof _defaults };
const _defaults = {
  u_worldRevealT: { value: 0.0 },
  u_worldRevealActive: { value: 0.0 },
  u_worldRevealMaxH: { value: 5.0 },
  u_worldRevealEdge: { value: 0.15 },
  u_worldRevealSpread: { value: 0.5 },
  u_worldRevealRadial: { value: 0.3 },
};
if (!_w.__worldTransitionUniforms) _w.__worldTransitionUniforms = _defaults;
export const worldTransitionUniforms = _w.__worldTransitionUniforms;

// HMR-safe patched set
const _wp = window as unknown as { __worldTransitionPatched?: WeakSet<THREE.Material> };
if (!_wp.__worldTransitionPatched) _wp.__worldTransitionPatched = new WeakSet();
const patched = _wp.__worldTransitionPatched;

/**
 * Patch a MeshStandardMaterial with the world build-in transition effect.
 * Each XZ area gets a random delay (hash + radial) so areas reveal at different times.
 * Within each area, geometry rises from Y=0 upward with a glowing edge.
 * Only active during world generation (u_worldRevealActive > 0).
 */
export function patchWorldTransitionMaterial(mat: THREE.MeshStandardMaterial): void {
  if (patched.has(mat)) return;
  patched.add(mat);

  const prevCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prevCompile) prevCompile(shader, renderer);

    shader.uniforms.u_worldRevealT = worldTransitionUniforms.u_worldRevealT;
    shader.uniforms.u_worldRevealActive = worldTransitionUniforms.u_worldRevealActive;
    shader.uniforms.u_worldRevealMaxH = worldTransitionUniforms.u_worldRevealMaxH;
    shader.uniforms.u_worldRevealEdge = worldTransitionUniforms.u_worldRevealEdge;
    shader.uniforms.u_worldRevealSpread = worldTransitionUniforms.u_worldRevealSpread;
    shader.uniforms.u_worldRevealRadial = worldTransitionUniforms.u_worldRevealRadial;

    // Vertex: add world-position varying
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 v_wBuildPos;',
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nv_wBuildPos = (modelMatrix * vec4(position, 1.0)).xyz;',
    );

    // Fragment: declare uniforms + varying, inject transition logic
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
uniform float u_worldRevealT;
uniform float u_worldRevealActive;
uniform float u_worldRevealMaxH;
uniform float u_worldRevealEdge;
uniform float u_worldRevealSpread;
uniform float u_worldRevealRadial;
varying vec3 v_wBuildPos;

float buildHash(vec2 p) {
  vec2 cell = floor(p * 2.0);
  return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
}`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
if (u_worldRevealActive > 0.01) {
  float noiseDelay = buildHash(v_wBuildPos.xz) * u_worldRevealSpread;
  float radialDelay = min(length(v_wBuildPos.xz) / 20.0, 1.0) * u_worldRevealRadial;
  float totalDelay = noiseDelay + radialDelay;

  float riseWindow = 0.3;
  float localT = clamp((u_worldRevealT - totalDelay) / riseWindow, 0.0, 1.0);
  localT = 1.0 - pow(1.0 - localT, 2.0);

  float areaRevealY = localT * u_worldRevealMaxH;
  float revealDist = v_wBuildPos.y - areaRevealY;
  if (revealDist > u_worldRevealEdge) discard;

  // Thin bright edge line at the reveal frontier — HDR so bloom catches it
  float edgeThickness = 0.03;
  float glow = smoothstep(u_worldRevealEdge - edgeThickness, u_worldRevealEdge, revealDist);
  gl_FragColor.rgb += vec3(2.0, 1.6, 0.8) * glow * u_worldRevealActive;
}`,
    );
  };
  mat.needsUpdate = true;
}

// ── WorldBuildFX — self-contained reveal animation + juicy effects ──

export class WorldBuildFX {
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

    worldTransitionUniforms.u_worldRevealT.value = 0.0;
    worldTransitionUniforms.u_worldRevealActive.value = 1.0;
    worldTransitionUniforms.u_worldRevealMaxH.value = maxHeight + 0.5;

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
    const maxDelay = worldTransitionUniforms.u_worldRevealSpread.value
      + worldTransitionUniforms.u_worldRevealRadial.value;
    const riseWindow = 0.3;
    const totalRange = 1.0 + maxDelay + riseWindow;
    const shaderT = t * totalRange;
    worldTransitionUniforms.u_worldRevealT.value = shaderT;

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
      worldTransitionUniforms.u_worldRevealActive.value = 0.0;
      worldTransitionUniforms.u_worldRevealT.value = 0.0;
      this.postProcess?.setBrightness(0);
    }
  }

  isRevealing(): boolean {
    return this.active;
  }
}
