import * as THREE from 'three';
import { entityRegistry, Layer } from '../core/Entity';

// Persist across Vite HMR so patched materials keep referencing the same uniform objects
const _w = window as unknown as { __revealUniforms?: typeof _defaultUniforms };
const _defaultUniforms = {
  u_revealCenter: { value: new THREE.Vector3() },
  u_cameraPos: { value: new THREE.Vector3() },
  u_revealActive: { value: 0.0 },
  u_revealRadius: { value: 3.0 },
  u_revealFalloff: { value: 2.0 },
};
if (!_w.__revealUniforms) _w.__revealUniforms = _defaultUniforms;
export const revealUniforms = _w.__revealUniforms;

/**
 * Patch any MeshStandardMaterial with a directional reveal cone.
 * Architecture fragments in the camera direction from the player go transparent.
 * Radius/falloff are set per-preset in updateReveal().
 */
export function patchRevealMaterial(mat: THREE.MeshStandardMaterial): void {
  mat.transparent = true;
  mat.depthWrite = true;
  mat.needsUpdate = true;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.u_revealCenter = revealUniforms.u_revealCenter;
    shader.uniforms.u_cameraPos = revealUniforms.u_cameraPos;
    shader.uniforms.u_revealActive = revealUniforms.u_revealActive;
    shader.uniforms.u_revealRadius = revealUniforms.u_revealRadius;
    shader.uniforms.u_revealFalloff = revealUniforms.u_revealFalloff;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 v_worldPos;',
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      '#include <worldpos_vertex>\nv_worldPos = (modelMatrix * vec4(position, 1.0)).xyz;',
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
uniform vec3 u_revealCenter;
uniform vec3 u_cameraPos;
uniform float u_revealActive;
uniform float u_revealRadius;
uniform float u_revealFalloff;
varying vec3 v_worldPos;`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>

// Directional cone: transparent only in the direction from player toward camera
vec3 toPlayer = u_revealCenter - u_cameraPos;
vec3 lineDir = normalize(toPlayer + vec3(0.001));

// How horizontal is the view? 0 = top-down, 1 = side-on
float xzLen = length(vec2(toPlayer.x, toPlayer.z));
float horizontalness = xzLen / max(length(toPlayer), 0.001);
// Disable reveal when camera is nearly overhead (nothing occluded)
float viewGate = smoothstep(0.05, 0.15, horizontalness);

// Direction from player toward camera in XZ
vec2 lineDirXZ = normalize(vec2(lineDir.x, lineDir.z) + vec2(0.0001));
vec2 toCamXZ = -lineDirXZ;

// Fragment direction from player in XZ
vec2 fragDeltaXZ = vec2(v_worldPos.x - u_revealCenter.x, v_worldPos.z - u_revealCenter.z);
float fragDistXZ = length(fragDeltaXZ);
vec2 fragDirXZ = fragDeltaXZ / max(fragDistXZ, 0.001);

// Angle check: only fragments toward the camera direction
float angleDot = dot(fragDirXZ, toCamXZ);
float inCone = smoothstep(-0.1, 0.3, angleDot) * viewGate;

// Distance fade from player in XZ
float distFade = smoothstep(u_revealRadius, u_revealRadius + u_revealFalloff, fragDistXZ);

float revealAlpha = mix(1.0, mix(1.0, distFade, inCone), u_revealActive);
gl_FragColor.a *= revealAlpha;`,
    );
  };
}

// Persist across HMR so materials aren't double-patched
const _wp = window as unknown as { __revealPatchedMats?: WeakSet<THREE.Material> };
if (!_wp.__revealPatchedMats) _wp.__revealPatchedMats = new WeakSet();
const patchedMats = _wp.__revealPatchedMats;

/**
 * Auto-patch every MeshStandardMaterial found on Architecture-layer entities.
 * Uses a WeakSet so each material is only patched once; safe to call per-frame.
 */
export function patchSceneArchitecture(): void {
  for (const entity of entityRegistry.entities) {
    if (!(entity.layer & Layer.Architecture)) continue;
    entity.object3D.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const mat of mats) {
        if (mat instanceof THREE.MeshStandardMaterial && !patchedMats.has(mat)) {
          patchRevealMaterial(mat);
          patchedMats.add(mat);
        }
      }
    });
  }
}

let smoothedActive = 0;

export function updateReveal(
  playerPos: THREE.Vector3,
  cameraPos: THREE.Vector3,
  occluded: boolean,
  preset?: string,
): void {
  revealUniforms.u_revealCenter.value.copy(playerPos);
  revealUniforms.u_cameraPos.value.copy(cameraPos);

  if (preset === 'voxelDungeon') {
    revealUniforms.u_revealRadius.value = 3.0;
    revealUniforms.u_revealFalloff.value = 2.0;
  } else {
    revealUniforms.u_revealRadius.value = 20.0;
    revealUniforms.u_revealFalloff.value = 5.0;
  }

  const target = occluded ? 1.0 : 0.0;
  smoothedActive += (target - smoothedActive) * 0.12;
  if (Math.abs(smoothedActive - target) < 0.01) smoothedActive = target;
  revealUniforms.u_revealActive.value = smoothedActive;
}
