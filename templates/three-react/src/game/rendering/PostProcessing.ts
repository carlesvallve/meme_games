// ── Post-Processing Stack ────────────────────────────────────────────
// EffectComposer pipeline: RenderPass → SSAO → Bloom → Vignette → ColorGrade

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js';
import type { PostProcessSettings } from '../../store';

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

// ── Fade shader (screen multiply) ────────────────────────────────────
const FadeShader = {
  name: 'FadeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    fadeAlpha: { value: 1.0 },       // 1 = fully visible, 0 = black
    vignetteBoost: { value: 0.0 },   // extra vignette darkness during fade
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
    uniform float fadeAlpha;
    uniform float vignetteBoost;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      // Vignette: darken edges more during fade
      float dist = distance(vUv, vec2(0.5));
      float vig = smoothstep(0.2, 0.9, dist) * vignetteBoost;
      color.rgb *= max(0.0, fadeAlpha - vig);
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
  private fadePass: ShaderPass;

  // Fade state
  private fadeValue = 1.0;        // current alpha (1 = visible, 0 = black)
  private fadeTarget = 1.0;       // target alpha
  private fadeSpeed = 3.0;        // lerp speed
  private fadeCallback: (() => void) | null = null; // called when fade-out reaches 0
  private fadeHolding = false;    // true = stay black until releaseFade() is called

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

    // 6. Fade (always last — screen-wide darken for transitions)
    this.fadePass = new ShaderPass(FadeShader);
    this.fadePass.enabled = false;
    this.composer.addPass(this.fadePass);
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

  // ── Color grade overrides (for death transitions) ──

  /** Override saturation uniform directly (bypasses store sync). */
  setSaturation(v: number): void {
    this.colorGradePass.uniforms['saturation'].value = v;
  }

  /** Override brightness uniform directly (bypasses store sync). */
  setBrightness(v: number): void {
    this.colorGradePass.uniforms['brightness'].value = v;
  }

  getSaturation(): number {
    return this.colorGradePass.uniforms['saturation'].value as number;
  }

  getBrightness(): number {
    return this.colorGradePass.uniforms['brightness'].value as number;
  }

  /** Force color grade pass enabled (for death transition desaturation even if store disables it). */
  setColorGradeEnabled(v: boolean): void {
    this.colorGradePass.enabled = v;
  }

  /** Directly set fade alpha (1 = visible, 0 = black). Used by death transitions for progressive fade. */
  setFadeAlpha(v: number): void {
    this.fadePass.enabled = v < 0.999;
    this.fadePass.uniforms['fadeAlpha'].value = v;
    this.fadePass.uniforms['vignetteBoost'].value = (1 - v) * 0.6;
  }

  /** Insert a ShaderPass just before the fade pass (last in the chain). */
  insertPassBeforeFade(pass: ShaderPass): void {
    // Remove fade, add the new pass, re-add fade
    this.composer.passes.splice(this.composer.passes.indexOf(this.fadePass), 0, pass);
  }

  /**
   * Fade screen to black, call `onBlack` when fully dark, hold black until `releaseFade()`.
   * @param onBlack — called at the midpoint (screen is black). Call `releaseFade()` when ready to fade in.
   * @param fadeOutSpeed — fade-out speed (default 3.0, higher = faster)
   * @param fadeInSpeed — fade-in speed (default same as fadeOutSpeed)
   */
  fadeTransition(onBlack: () => void, fadeOutSpeed = 3.0, fadeInSpeed?: number): void {
    this.fadeSpeed = fadeOutSpeed;
    this._fadeInSpeed = fadeInSpeed ?? fadeOutSpeed;
    this.fadeTarget = 0;
    this.fadeCallback = onBlack;
    this.fadeHolding = false;
    // Clear speech bubbles immediately when any fade transition begins
    this._onFadeStart?.();
  }

  /** Optional callback fired at fade start — used to clear speech bubbles etc. */
  _onFadeStart: (() => void) | null = null;

  private _fadeInSpeed = 3.0;

  /** Release the fade hold — starts the fade-in from black. */
  releaseFade(): void {
    this.fadeHolding = false;
    this.fadeSpeed = this._fadeInSpeed;
    this.fadeTarget = 1;
  }

  /** Update fade animation — call every frame with dt */
  updateFade(dt: number): void {
    if (this.fadeValue === this.fadeTarget && !this.fadeCallback && !this.fadeHolding) return;

    // Holding black — wait for releaseFade()
    if (this.fadeHolding) {
      this.fadePass.enabled = true;
      this.fadePass.uniforms['fadeAlpha'].value = 0;
      this.fadePass.uniforms['vignetteBoost'].value = 0.6;
      return;
    }

    // Lerp toward target
    const diff = this.fadeTarget - this.fadeValue;
    this.fadeValue += diff * Math.min(1, this.fadeSpeed * dt);

    // Snap when close
    if (Math.abs(diff) < 0.01) {
      this.fadeValue = this.fadeTarget;
    }

    // Hit black — fire callback and hold
    if (this.fadeTarget === 0 && this.fadeValue <= 0.01 && this.fadeCallback) {
      this.fadeValue = 0;
      const cb = this.fadeCallback;
      this.fadeCallback = null;
      // Hold black until releaseFade() is called (set before cb so cb can release immediately)
      this.fadeHolding = true;
      cb();
    }

    // Update shader uniforms
    const active = this.fadeValue < 0.999;
    this.fadePass.enabled = active;
    if (active) {
      this.fadePass.uniforms['fadeAlpha'].value = this.fadeValue;
      this.fadePass.uniforms['vignetteBoost'].value = (1 - this.fadeValue) * 0.6;
    }
  }

  /** True if a fade transition is in progress (fading out, holding, or fading in) */
  get isFading(): boolean {
    return this.fadeValue < 0.999 || this.fadeCallback !== null || this.fadeHolding;
  }

  /** True only while fading to black or holding black (gameplay should freeze) */
  get isFadingOut(): boolean {
    return this.fadeCallback !== null || this.fadeHolding;
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
