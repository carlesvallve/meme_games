/**
 * WaterSystem — water/floor plane creation and per-frame animation.
 *
 * Shared across terrain presets (unlike HeightmapBuilder and BoxPlacer which
 * are each exclusive to their own preset group):
 *  - Heightmap:           animated water with a custom ShaderMaterial featuring
 *                         depth-based shallow/deep coloring, caustics, foam
 *                         edges, and waves.
 *  - Scattered/terraced:  flat opaque floor plane (reused for raycasting).
 *  - Dungeon presets:     no water (rooms have their own floors).
 *
 * The depth pass (updateWater) renders the scene to a depth render target
 * so the fragment shader can compute foam lines where geometry intersects
 * the water surface.
 *
 * Used by TerrainBuilder facade; not called directly by consumers.
 */

import * as THREE from 'three';
import { EnvironmentContext } from '../environment/EnvironmentContext';
import { useGameStore } from '../../store';
import { computeDayLightScale } from '../rendering/DayCycle';

export class WaterSystem {
  private ctx: EnvironmentContext;

  constructor(ctx: EnvironmentContext) {
    this.ctx = ctx;
  }

  /** Water plane Y. Computed from heightmap data if available, otherwise default. */
  getWaterY(): number {
    // If heightmap computed a data-driven water level, use it
    if (this.ctx.computedWaterY !== null) return this.ctx.computedWaterY;
    return this.ctx.preset === 'heightmap' && this.ctx.heightmapStyle === 'caves' ? -0.5 : 0;
  }

  createGround(): void {
    const size = this.ctx.groundSize;
    const geo = new THREE.PlaneGeometry(size, size, 64, 64);
    geo.rotateX(-Math.PI / 2);

    // Dungeon modes have their own floors — no water plane needed
    if (this.ctx.preset === 'voxelDungeon') {
      return;
    }

    // Heightmap water is created later via createHeightmapWater() when height data is ready
    if (this.ctx.preset === 'heightmap') {
      return;
    }

    // Basic: solid floor plane instead of water
    if (this.ctx.preset === 'basic') {
      const floorMat = new THREE.MeshStandardMaterial({
        color: this.ctx.palette.flat,
        roughness: 0.95,
        metalness: 0.05,
      });
      const floor = new THREE.Mesh(geo, floorMat);
      floor.position.y = -0.01;
      floor.receiveShadow = true;
      this.ctx.waterMesh = floor; // reuse field for raycasting
      this.ctx.group.add(floor);
      return;
    }

    // Depth render target for foam around all objects
    const depthTarget = new THREE.WebGLRenderTarget(1024, 1024, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    depthTarget.depthTexture = new THREE.DepthTexture(1024, 1024);
    depthTarget.depthTexture.format = THREE.DepthFormat;
    depthTarget.depthTexture.type = THREE.UnsignedIntType;
    this.ctx.depthTarget = depthTarget;

    const waterMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uShallowColor: { value: new THREE.Color(this.ctx.palette.waterShallow) },
        uDeepColor: { value: new THREE.Color(this.ctx.palette.waterDeep) },
        uDepthTex: { value: depthTarget.depthTexture },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 100 },
        uResolution: { value: new THREE.Vector2(1024, 1024) },
        uLightScale: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec4 vScreenPos;
        varying vec3 vWorldPos;
        varying float vViewZ;

        void main() {
          vec3 pos = position;
          // Gentle wave
          pos.y += sin(pos.x * 0.6 + uTime * 0.3) * cos(pos.z * 0.5 + uTime * 0.2) * 0.012;
          vec4 worldPos = modelMatrix * vec4(pos, 1.0);
          vWorldPos = worldPos.xyz;
          vec4 viewPos = viewMatrix * worldPos;
          vViewZ = -viewPos.z;
          vScreenPos = projectionMatrix * viewPos;
          gl_Position = vScreenPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uShallowColor;
        uniform vec3 uDeepColor;
        uniform sampler2D uDepthTex;
        uniform float uCameraNear;
        uniform float uCameraFar;
        uniform vec2 uResolution;
        uniform float uLightScale;
        varying vec4 vScreenPos;
        varying vec3 vWorldPos;
        varying float vViewZ;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2(1,0)), f.x),
            mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x),
            f.y
          );
        }

        float linearizeDepth(float d) {
          return uCameraNear * uCameraFar / (uCameraFar - d * (uCameraFar - uCameraNear));
        }

        void main() {
          // Screen-space UV from clip coords
          vec2 screenUV = (vScreenPos.xy / vScreenPos.w) * 0.5 + 0.5;

          // Scene depth behind this water fragment
          float sceneDepthRaw = texture2D(uDepthTex, screenUV).r;
          float sceneDepth = linearizeDepth(sceneDepthRaw);
          float waterDepth = vViewZ;

          // How much scene geometry is behind the water surface (in world units)
          float depthDiff = sceneDepth - waterDepth;

          // Discard water in front of scene (terrain above water)
          if (depthDiff < 0.0) discard;

          // Wave offset for animated foam
          float waveOffset = sin(vWorldPos.x * 0.8 + uTime * 0.5) * 0.03
                           + sin(vWorldPos.z * 0.6 + uTime * 0.35) * 0.02;

          float animDepth = depthDiff + waveOffset;

          // Color: shallow → deep
          float depthMix = smoothstep(0.0, 3.0, animDepth);
          vec3 col = mix(uShallowColor, uDeepColor, depthMix);

          // Subtle caustics
          float t = uTime * 0.15;
          float caustic = noise(vWorldPos.xz * 1.5 + t) * noise(vWorldPos.xz * 2.2 - t * 0.7);
          col += vec3(caustic * 0.04);

          // ── Smooth foam line at edges ──
          // Sample depth at neighboring pixels to soften jagged triangle edges
          float foamNoise = noise(vWorldPos.xz * 5.0 + uTime * 0.3) * 0.008
                          + noise(vWorldPos.xz * 12.0 - uTime * 0.2) * 0.004;

          vec2 texel = 1.5 / uResolution;  // 1.5px blur radius
          float foamSum = 0.0;
          float totalWeight = 0.0;
          for (int ox = -1; ox <= 1; ox++) {
            for (int oz = -1; oz <= 1; oz++) {
              vec2 off = vec2(float(ox), float(oz)) * texel;
              float sDepth = linearizeDepth(texture2D(uDepthTex, screenUV + off).r);
              float dd = sDepth - vViewZ;
              // Compute per-sample foam
              float sGradX = dFdx(dd);
              float sGradY = dFdy(dd);
              float sGrad = length(vec2(sGradX, sGradY));
              float fw = mix(0.05, 0.1, smoothstep(0.01, 0.1, sGrad));
              float w = (ox == 0 && oz == 0) ? 2.0 : 1.0;
              foamSum += smoothstep(fw + foamNoise, 0.0, dd) * w;
              totalWeight += w;
            }
          }
          float foamLine = (foamSum / totalWeight) * 0.9;

          float foam = min(0.9, foamLine);
          vec3 foamColor = vec3(uLightScale);
          col = mix(col, foamColor, foam);

          // Alpha: fade in smoothly, more opaque deep
          float alpha = smoothstep(0.0, 0.5, animDepth) * 0.6;
          alpha = max(alpha, foam * 0.95);

          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    this.ctx.waterMaterial = waterMat;

    const water = new THREE.Mesh(geo, waterMat);
    water.position.y = this.getWaterY();
    this.ctx.waterMesh = water;
    this.ctx.group.add(water);
  }

  /** Create heightmap water mesh that conforms to terrain at edges.
   *  Must be called after heightmap data is available in ctx. */
  createHeightmapWater(): void {
    const heights = this.ctx.heightmapData;
    const res = this.ctx.heightmapRes;
    const groundSize = this.ctx.heightmapGroundSize;
    if (!heights || !res || !groundSize) return;

    const waterY = this.getWaterY();
    const BLEND = 3; // grid cells to blend from edge inward
    const verts = res + 1;
    const cellSize = groundSize / res;
    const halfGround = groundSize / 2;

    // Build vertex grid: interior flat at waterY, edges conform to terrain
    const positions = new Float32Array(verts * verts * 3);
    for (let z = 0; z < verts; z++) {
      for (let x = 0; x < verts; x++) {
        const idx = z * verts + x;
        const wx = x * cellSize - halfGround;
        const wz = z * cellSize - halfGround;
        const terrainH = heights[idx];

        const edgeDist = Math.min(x, z, res - x, res - z);
        let y: number;
        if (edgeDist >= BLEND) {
          y = waterY;
        } else {
          const t = edgeDist / BLEND;
          y = terrainH + (waterY - terrainH) * (t * t);
        }

        positions[idx * 3] = wx;
        positions[idx * 3 + 1] = y;
        positions[idx * 3 + 2] = wz;
      }
    }

    const indices: number[] = [];
    for (let z = 0; z < res; z++) {
      for (let x = 0; x < res; x++) {
        const tl = z * verts + x;
        const tr = tl + 1;
        const bl = (z + 1) * verts + x;
        const br = bl + 1;
        indices.push(tl, bl, tr);
        indices.push(tr, bl, br);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    // Depth render target for foam
    const depthTarget = new THREE.WebGLRenderTarget(1024, 1024, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    depthTarget.depthTexture = new THREE.DepthTexture(1024, 1024);
    depthTarget.depthTexture.format = THREE.DepthFormat;
    depthTarget.depthTexture.type = THREE.UnsignedIntType;
    this.ctx.depthTarget = depthTarget;

    const waterMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uShallowColor: { value: new THREE.Color(this.ctx.palette.waterShallow) },
        uDeepColor: { value: new THREE.Color(this.ctx.palette.waterDeep) },
        uDepthTex: { value: depthTarget.depthTexture },
        uCameraNear: { value: 0.1 },
        uCameraFar: { value: 100 },
        uResolution: { value: new THREE.Vector2(1024, 1024) },
        uLightScale: { value: 1.0 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec4 vScreenPos;
        varying vec3 vWorldPos;
        varying float vViewZ;

        void main() {
          vec3 pos = position;
          pos.y += sin(pos.x * 0.6 + uTime * 0.3) * cos(pos.z * 0.5 + uTime * 0.2) * 0.012;
          vec4 worldPos = modelMatrix * vec4(pos, 1.0);
          vWorldPos = worldPos.xyz;
          vec4 viewPos = viewMatrix * worldPos;
          vViewZ = -viewPos.z;
          vScreenPos = projectionMatrix * viewPos;
          gl_Position = vScreenPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uShallowColor;
        uniform vec3 uDeepColor;
        uniform sampler2D uDepthTex;
        uniform float uCameraNear;
        uniform float uCameraFar;
        uniform vec2 uResolution;
        uniform float uLightScale;
        varying vec4 vScreenPos;
        varying vec3 vWorldPos;
        varying float vViewZ;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2(1,0)), f.x),
            mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x),
            f.y
          );
        }

        float linearizeDepth(float d) {
          return uCameraNear * uCameraFar / (uCameraFar - d * (uCameraFar - uCameraNear));
        }

        void main() {
          vec2 screenUV = (vScreenPos.xy / vScreenPos.w) * 0.5 + 0.5;
          float sceneDepthRaw = texture2D(uDepthTex, screenUV).r;
          float sceneDepth = linearizeDepth(sceneDepthRaw);
          float waterDepth = vViewZ;
          float depthDiff = sceneDepth - waterDepth;
          if (depthDiff < 0.0) discard;

          float waveOffset = sin(vWorldPos.x * 0.8 + uTime * 0.5) * 0.03
                           + sin(vWorldPos.z * 0.6 + uTime * 0.35) * 0.02;
          float animDepth = depthDiff + waveOffset;
          float depthMix = smoothstep(0.0, 3.0, animDepth);
          vec3 col = mix(uShallowColor, uDeepColor, depthMix);

          float t = uTime * 0.15;
          float caustic = noise(vWorldPos.xz * 1.5 + t) * noise(vWorldPos.xz * 2.2 - t * 0.7);
          col += vec3(caustic * 0.04);

          float foamNoise = noise(vWorldPos.xz * 5.0 + uTime * 0.3) * 0.008
                          + noise(vWorldPos.xz * 12.0 - uTime * 0.2) * 0.004;
          vec2 texel = 1.5 / uResolution;
          float foamSum = 0.0;
          float totalWeight = 0.0;
          for (int ox = -1; ox <= 1; ox++) {
            for (int oz = -1; oz <= 1; oz++) {
              vec2 off = vec2(float(ox), float(oz)) * texel;
              float sDepth = linearizeDepth(texture2D(uDepthTex, screenUV + off).r);
              float dd = sDepth - vViewZ;
              float sGradX = dFdx(dd);
              float sGradY = dFdy(dd);
              float sGrad = length(vec2(sGradX, sGradY));
              float fw = mix(0.05, 0.1, smoothstep(0.01, 0.1, sGrad));
              float w = (ox == 0 && oz == 0) ? 2.0 : 1.0;
              foamSum += smoothstep(fw + foamNoise, 0.0, dd) * w;
              totalWeight += w;
            }
          }
          float foamLine = (foamSum / totalWeight) * 0.9;
          float foam = min(0.9, foamLine);
          vec3 foamColor = vec3(uLightScale);
          col = mix(col, foamColor, foam);

          float alpha = smoothstep(0.0, 0.5, animDepth) * 0.6;
          alpha = max(alpha, foam * 0.95);
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    this.ctx.waterMaterial = waterMat;
    const water = new THREE.Mesh(geo, waterMat);
    this.ctx.waterMesh = water;
    this.ctx.group.add(water);
  }

  /** Render depth pass and animate water. Call before main render. */
  updateWater(dt: number, renderer?: THREE.WebGLRenderer, scene?: THREE.Scene, camera?: THREE.Camera): void {
    if (!this.ctx.waterMaterial) return;
    this.ctx.waterMaterial.uniforms.uTime.value += dt;

    // Sync foam brightness with day/night cycle
    const timeOfDay = useGameStore.getState().timeOfDay;
    this.ctx.waterMaterial.uniforms.uLightScale.value = computeDayLightScale(timeOfDay);

    if (renderer && scene && camera && this.ctx.depthTarget && this.ctx.waterMesh) {
      // Update camera uniforms
      if (camera instanceof THREE.PerspectiveCamera) {
        this.ctx.waterMaterial.uniforms.uCameraNear.value = camera.near;
        this.ctx.waterMaterial.uniforms.uCameraFar.value = camera.far;
      }

      // Resize depth target to match renderer
      const size = renderer.getSize(new THREE.Vector2());
      if (this.ctx.depthTarget.width !== size.x || this.ctx.depthTarget.height !== size.y) {
        this.ctx.depthTarget.setSize(size.x, size.y);
        this.ctx.waterMaterial.uniforms.uResolution.value.set(size.x, size.y);
      }

      // Render depth pass: hide water, render scene to depth target
      this.ctx.waterMesh.visible = false;
      renderer.setRenderTarget(this.ctx.depthTarget);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      this.ctx.waterMesh.visible = true;
    }
  }
}
