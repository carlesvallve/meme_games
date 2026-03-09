import * as THREE from 'three';

/**
 * RevealShader — fades/discards blocks that occlude the player.
 * Projects a cone from camera toward player in XZ; fragments inside the cone
 * are discarded (dithered or sharp cutoff) so the player stays visible.
 */

// HMR-safe uniforms
const _w = window as unknown as { __revealShaderUniforms?: typeof _defaults };
const _defaults = {
  u_revealCenter: { value: new THREE.Vector3() },
  u_cameraPos: { value: new THREE.Vector3() },
  u_revealActive: { value: 0.0 },
  u_revealRadius: { value: 3.0 },
  u_revealFalloff: { value: 2.0 },
  u_revealDither: { value: 1.0 }, // 0 = sharp cutoff, 1 = dithered discard
};
if (!_w.__revealShaderUniforms) _w.__revealShaderUniforms = _defaults;
export const revealUniforms = _w.__revealShaderUniforms;

// HMR-safe patched set
const _wp = window as unknown as { __revealShaderPatched?: WeakSet<THREE.Material> };
if (!_wp.__revealShaderPatched) _wp.__revealShaderPatched = new WeakSet();
const patched = _wp.__revealShaderPatched;

// ── Shared GLSL snippets (used in both color and depth passes) ──

const REVEAL_UNIFORMS_GLSL = `
uniform vec3 u_revealCenter;
uniform vec3 u_cameraPos;
uniform float u_revealActive;
uniform float u_revealRadius;
uniform float u_revealFalloff;
uniform float u_revealDither;
`;

const REVEAL_CONE_DISCARD_GLSL = `
if (u_revealActive > 0.001) {
  vec2 camXZ = vec2(u_cameraPos.x, u_cameraPos.z);
  vec2 playerXZ = vec2(u_revealCenter.x, u_revealCenter.z);
  vec2 lineXZ = playerXZ - camXZ;
  float lineLenSq = dot(lineXZ, lineXZ);

  vec3 toPlayer3 = u_revealCenter - u_cameraPos;
  float xzLen = length(vec2(toPlayer3.x, toPlayer3.z));
  float horizontalness = xzLen / max(length(toPlayer3), 0.001);
  float viewGate = smoothstep(0.05, 0.15, horizontalness);

  vec2 fragXZ = vec2(v_wRevealPos.x, v_wRevealPos.z);
  vec2 fragFromCam = fragXZ - camXZ;
  float t = dot(fragFromCam, lineXZ) / max(lineLenSq, 0.001);
  float tGate = smoothstep(-0.01, 0.01, t) * (1.0 - smoothstep(0.85, 1.0, t));

  vec2 projected = camXZ + lineXZ * clamp(t, 0.0, 1.0);
  float perpDist = length(fragXZ - projected);
  float coneWidth = mix(0.5, u_revealRadius, clamp(t, 0.0, 1.0));
  float coneFade = 1.0 - smoothstep(coneWidth, coneWidth + u_revealFalloff, perpDist);

  float distToPlayer = length(fragXZ - playerXZ);
  float proximityGuard = smoothstep(0.3, 0.8, distToPlayer);

  float revealStrength = tGate * coneFade * viewGate * proximityGuard * u_revealActive;
  if (revealStrength > 0.5) discard;
}
`;

// Full dither+discard variant for the color pass
const REVEAL_FULL_DISCARD_GLSL = `
if (u_revealActive > 0.001) {
  vec2 camXZ = vec2(u_cameraPos.x, u_cameraPos.z);
  vec2 playerXZ = vec2(u_revealCenter.x, u_revealCenter.z);
  vec2 lineXZ = playerXZ - camXZ;
  float lineLenSq = dot(lineXZ, lineXZ);

  vec3 toPlayer3 = u_revealCenter - u_cameraPos;
  float xzLen = length(vec2(toPlayer3.x, toPlayer3.z));
  float horizontalness = xzLen / max(length(toPlayer3), 0.001);
  float viewGate = smoothstep(0.05, 0.15, horizontalness);

  vec2 fragXZ = vec2(v_wRevealPos.x, v_wRevealPos.z);
  vec2 fragFromCam = fragXZ - camXZ;
  float t = dot(fragFromCam, lineXZ) / max(lineLenSq, 0.001);
  float tGate = smoothstep(-0.01, 0.01, t) * (1.0 - smoothstep(0.85, 1.0, t));

  vec2 projected = camXZ + lineXZ * clamp(t, 0.0, 1.0);
  float perpDist = length(fragXZ - projected);
  float coneWidth = mix(0.5, u_revealRadius, clamp(t, 0.0, 1.0));
  float coneFade = 1.0 - smoothstep(coneWidth, coneWidth + u_revealFalloff, perpDist);

  float distToPlayer = length(fragXZ - playerXZ);
  float proximityGuard = smoothstep(0.3, 0.8, distToPlayer);

  float reveal = tGate * coneFade * viewGate * proximityGuard;
  float revealStrength = reveal * u_revealActive;
  if (u_revealDither > 0.5) {
    // Dithered discard: 4x4 Bayer matrix, no alpha blending needed
    vec2 screenPos = gl_FragCoord.xy;
    int ix = int(mod(screenPos.x, 4.0));
    int iy = int(mod(screenPos.y, 4.0));
    int idx = ix + iy * 4;
    float threshold;
    if      (idx ==  0) threshold = 0.0/16.0;
    else if (idx ==  1) threshold = 8.0/16.0;
    else if (idx ==  2) threshold = 2.0/16.0;
    else if (idx ==  3) threshold = 10.0/16.0;
    else if (idx ==  4) threshold = 12.0/16.0;
    else if (idx ==  5) threshold = 4.0/16.0;
    else if (idx ==  6) threshold = 14.0/16.0;
    else if (idx ==  7) threshold = 6.0/16.0;
    else if (idx ==  8) threshold = 3.0/16.0;
    else if (idx ==  9) threshold = 11.0/16.0;
    else if (idx == 10) threshold = 1.0/16.0;
    else if (idx == 11) threshold = 9.0/16.0;
    else if (idx == 12) threshold = 15.0/16.0;
    else if (idx == 13) threshold = 7.0/16.0;
    else if (idx == 14) threshold = 13.0/16.0;
    else                threshold = 5.0/16.0;
    if (revealStrength > threshold) discard;
  } else {
    if (revealStrength > 0.5) discard;
  }
}
`;

/**
 * Patch a MeshStandardMaterial with the occlusion reveal effect.
 * Discards fragments in a cone between camera and player so the player stays visible.
 * Independent of WorldTransitionShader — both can be applied to the same material.
 */
export function patchRevealMaterial(mat: THREE.MeshStandardMaterial): void {
  if (patched.has(mat)) return;
  patched.add(mat);

  const prevCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (prevCompile) prevCompile(shader, renderer);

    shader.uniforms.u_revealCenter = revealUniforms.u_revealCenter;
    shader.uniforms.u_cameraPos = revealUniforms.u_cameraPos;
    shader.uniforms.u_revealActive = revealUniforms.u_revealActive;
    shader.uniforms.u_revealRadius = revealUniforms.u_revealRadius;
    shader.uniforms.u_revealFalloff = revealUniforms.u_revealFalloff;
    shader.uniforms.u_revealDither = revealUniforms.u_revealDither;

    // Vertex: add world-position varying
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 v_wRevealPos;',
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nv_wRevealPos = (modelMatrix * vec4(position, 1.0)).xyz;',
    );

    // Fragment: declare uniforms + varying, inject cone discard after dithering
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\n${REVEAL_UNIFORMS_GLSL}\nvarying vec3 v_wRevealPos;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>\n${REVEAL_FULL_DISCARD_GLSL}`,
    );
  };
  mat.needsUpdate = true;
}

// ── Custom depth material for shadow pass ──

/** Create a custom depth material that discards fragments in the occlusion cone.
 *  Prevents "invisible" cubes from still casting shadows. */
function createRevealDepthMaterial(): THREE.MeshDepthMaterial {
  const depthMat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });
  depthMat.onBeforeCompile = (shader) => {
    shader.uniforms.u_revealCenter = revealUniforms.u_revealCenter;
    shader.uniforms.u_cameraPos = revealUniforms.u_cameraPos;
    shader.uniforms.u_revealActive = revealUniforms.u_revealActive;
    shader.uniforms.u_revealRadius = revealUniforms.u_revealRadius;
    shader.uniforms.u_revealFalloff = revealUniforms.u_revealFalloff;
    shader.uniforms.u_revealDither = revealUniforms.u_revealDither;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 v_wRevealPos;',
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <clipping_planes_vertex>',
      '#include <clipping_planes_vertex>\nv_wRevealPos = (modelMatrix * vec4(position, 1.0)).xyz;',
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\n${REVEAL_UNIFORMS_GLSL}\nvarying vec3 v_wRevealPos;`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <clipping_planes_fragment>',
      `#include <clipping_planes_fragment>\n${REVEAL_CONE_DISCARD_GLSL}`,
    );
  };
  depthMat.needsUpdate = true;
  return depthMat;
}

// Lazily created shared depth material
let _revealDepthMat: THREE.MeshDepthMaterial | null = null;
function getRevealDepthMaterial(): THREE.MeshDepthMaterial {
  if (!_revealDepthMat) _revealDepthMat = createRevealDepthMaterial();
  return _revealDepthMat;
}

/** Apply custom depth material so shadow pass also discards occluded fragments. */
export function applyRevealDepthMaterial(mesh: THREE.Mesh): void {
  mesh.customDepthMaterial = getRevealDepthMaterial();
}

// ── CPU-side logic ──

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

let smoothedOcclusionActive = 0;

/**
 * CPU-side mirror of the shader's reveal cone logic.
 * Returns true if the given world position would be discarded by the reveal shader.
 */
export function isPointRevealed(point: THREE.Vector3): boolean {
  const active = smoothedOcclusionActive;
  if (active < 0.1) return false;

  const camPos = revealUniforms.u_cameraPos.value;
  const playerPos = revealUniforms.u_revealCenter.value;
  const radius = revealUniforms.u_revealRadius.value;
  const falloff = revealUniforms.u_revealFalloff.value;

  // View gate: horizontalness
  const dx = playerPos.x - camPos.x;
  const dz = playerPos.z - camPos.z;
  const dy = playerPos.y - camPos.y;
  const xzLen = Math.sqrt(dx * dx + dz * dz);
  const totalLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const horizontalness = xzLen / Math.max(totalLen, 0.001);
  if (horizontalness < 0.15) return false;

  // Project onto camera→player line in XZ
  const lineX = playerPos.x - camPos.x;
  const lineZ = playerPos.z - camPos.z;
  const lineLenSq = lineX * lineX + lineZ * lineZ;
  const fragX = point.x - camPos.x;
  const fragZ = point.z - camPos.z;
  const t = (fragX * lineX + fragZ * lineZ) / Math.max(lineLenSq, 0.001);

  // tGate
  if (t < -0.01 || t > 1.0) return false;
  const tGate = Math.min(smoothstep(-0.01, 0.01, t), 1 - smoothstep(0.85, 1.0, t));

  // Perpendicular distance
  const tc = Math.max(0, Math.min(1, t));
  const projX = camPos.x + lineX * tc;
  const projZ = camPos.z + lineZ * tc;
  const perpDist = Math.sqrt((point.x - projX) ** 2 + (point.z - projZ) ** 2);
  const coneWidth = 0.5 + (radius - 0.5) * Math.max(0, Math.min(1, t));
  if (perpDist > coneWidth + falloff) return false;
  const coneFade = 1 - smoothstep(coneWidth, coneWidth + falloff, perpDist);

  // Proximity guard
  const distToPlayer = Math.sqrt((point.x - playerPos.x) ** 2 + (point.z - playerPos.z) ** 2);
  const proximityGuard = smoothstep(0.3, 0.8, distToPlayer);

  const reveal = tGate * coneFade * horizontalness * proximityGuard * active;
  return reveal > 0.5;
}

/** Update occlusion reveal uniforms each frame. */
export function updateOcclusionReveal(
  playerPos: THREE.Vector3,
  cameraPos: THREE.Vector3,
  occluded: boolean,
  dither = true,
): void {
  revealUniforms.u_revealCenter.value.copy(playerPos);
  revealUniforms.u_cameraPos.value.copy(cameraPos);
  revealUniforms.u_revealRadius.value = 1.5;
  revealUniforms.u_revealFalloff.value = 1.0;
  revealUniforms.u_revealDither.value = dither ? 1.0 : 0.0;

  const target = occluded ? 1.0 : 0.0;
  smoothedOcclusionActive += (target - smoothedOcclusionActive) * 0.12;
  if (Math.abs(smoothedOcclusionActive - target) < 0.01) smoothedOcclusionActive = target;
  revealUniforms.u_revealActive.value = smoothedOcclusionActive;
}
