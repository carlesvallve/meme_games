// ── Post-Processing Stack ────────────────────────────────────────────
// EffectComposer pipeline: RenderPass → SSAO → Bloom → Vignette → ColorGrade

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import type { PostProcessSettings } from '../store';

// ── Custom color-grade shader ────────────────────────────────────────

const ColorGradeShader = {
  name: 'ColorGradeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    brightness: { value: 0.0 },
    contrast: { value: 0.0 },
    saturation: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float brightness;
    uniform float contrast;
    uniform float saturation;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // Brightness
      color.rgb += brightness;

      // Contrast
      color.rgb = (color.rgb - 0.5) * (1.0 + contrast) + 0.5;

      // Saturation
      float lum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      color.rgb = mix(vec3(lum), color.rgb, 1.0 + saturation);

      gl_FragColor = color;
    }
  `,
};

// ── PostProcessStack ─────────────────────────────────────────────────

export class PostProcessStack {
  readonly composer: EffectComposer;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;

  private renderPass: RenderPass;
  private ssaoPass: SSAOPass;
  private bloomPass: UnrealBloomPass;
  private vignettePass: ShaderPass;
  private colorGradePass: ShaderPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const size = renderer.getSize(new THREE.Vector2());
    const pixelRatio = renderer.getPixelRatio();

    // Composer
    this.composer = new EffectComposer(renderer);

    // 1. Render pass
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // 2. SSAO
    this.ssaoPass = new SSAOPass(scene, camera, size.x, size.y);
    this.ssaoPass.kernelRadius = 0.5;
    this.ssaoPass.minDistance = 0.001;
    this.ssaoPass.maxDistance = 0.1;
    this.ssaoPass.output = SSAOPass.OUTPUT.Default;
    this.composer.addPass(this.ssaoPass);

    // 3. Bloom
    const res = new THREE.Vector2(size.x * pixelRatio, size.y * pixelRatio);
    this.bloomPass = new UnrealBloomPass(res, 0.3, 0.4, 0.85);
    this.composer.addPass(this.bloomPass);

    // 4. Vignette
    this.vignettePass = new ShaderPass(VignetteShader);
    this.vignettePass.uniforms['offset'].value = 1.0;
    this.vignettePass.uniforms['darkness'].value = 1.2;
    this.composer.addPass(this.vignettePass);

    // 5. Color grade
    this.colorGradePass = new ShaderPass(ColorGradeShader);
    this.composer.addPass(this.colorGradePass);
  }

  /** Sync all pass parameters from store settings */
  sync(settings: PostProcessSettings): void {
    // SSAO
    this.ssaoPass.enabled = settings.enabled && settings.ssao.enabled;
    this.ssaoPass.kernelRadius = settings.ssao.radius;
    this.ssaoPass.minDistance = settings.ssao.minDistance;
    this.ssaoPass.maxDistance = settings.ssao.maxDistance;

    // Bloom
    this.bloomPass.enabled = settings.enabled && settings.bloom.enabled;
    this.bloomPass.strength = settings.bloom.strength;
    this.bloomPass.radius = settings.bloom.radius;
    this.bloomPass.threshold = settings.bloom.threshold;

    // Vignette
    this.vignettePass.enabled = settings.enabled && settings.vignette.enabled;
    this.vignettePass.uniforms['offset'].value = settings.vignette.offset;
    this.vignettePass.uniforms['darkness'].value = settings.vignette.darkness;

    // Color grade
    this.colorGradePass.enabled = settings.enabled && settings.colorGrade.enabled;
    this.colorGradePass.uniforms['brightness'].value = settings.colorGrade.brightness;
    this.colorGradePass.uniforms['contrast'].value = settings.colorGrade.contrast;
    this.colorGradePass.uniforms['saturation'].value = settings.colorGrade.saturation;
  }

  /** Call instead of renderer.render() */
  render(): void {
    this.composer.render();
  }

  /** Call on window resize */
  resize(width: number, height: number): void {
    const pixelRatio = this.renderer.getPixelRatio();
    this.composer.setSize(width, height);
    this.ssaoPass.setSize(width, height);
    this.bloomPass.setSize(width * pixelRatio, height * pixelRatio);
  }

  /** Update camera reference (e.g. if camera is replaced) */
  updateCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.renderPass.camera = camera;
    this.ssaoPass.camera = camera;
  }

  dispose(): void {
    this.composer.dispose();
  }
}
