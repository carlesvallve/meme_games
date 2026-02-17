import Phaser from 'phaser';

interface PointLight {
  type: 'point';
  worldX: number;
  worldY: number;
  radius: number;
  intensity: number;
  r: number;
  g: number;
  b: number;
}

interface ConeLight {
  type: 'cone';
  worldX: number;
  worldY: number;
  rotation: number;   // radians — direction the cone points
  length: number;      // how far the cone reaches
  angle: number;       // spread angle in radians (e.g. PI/4 = 45 degrees)
  intensity: number;
  r: number;
  g: number;
  b: number;
}

type Light = PointLight | ConeLight;

export interface LightingConfig {
  /** Maximum simultaneous lights (default 32) */
  maxLights?: number;
  /** Base ambient brightness 0–1 (default 0.75). Higher = brighter scene. */
  ambient?: number;
  /** Gradient texture resolution (default 128) */
  gradientSize?: number;
  /** Gradient falloff inner ring (fraction 0–1, default 0.3) */
  falloffInner?: number;
  /** Gradient falloff mid ring (fraction 0–1, default 0.6) */
  falloffMid?: number;
  /** Alpha at inner ring (default 0.8) */
  innerAlpha?: number;
  /** Alpha at mid ring (default 0.4) */
  midAlpha?: number;
  /** Explicit width for the light map (defaults to canvas width) */
  width?: number;
  /** Explicit height for the light map (defaults to canvas height) */
  height?: number;
}

const DEFAULTS: Required<LightingConfig> = {
  maxLights: 32,
  ambient: 0.75,
  gradientSize: 128,
  falloffInner: 0.3,
  falloffMid: 0.6,
  innerAlpha: 0.8,
  midAlpha: 0.4,
  width: 0,
  height: 0,
};

/**
 * RenderTexture-based lighting system for Phaser 3.
 *
 * Supports two light types:
 * - **Point lights**: radial gradient circles (setLight)
 * - **Cone lights**: directional cone beams (setConeLight)
 *
 * The light map is displayed as a MULTIPLY-blend overlay:
 * - White areas (lights) preserve the scene colors.
 * - Gray areas (ambient) darken the scene proportionally.
 *
 * Usage:
 *   const lighting = new LightingSystem(scene, { ambient: 0.8 });
 *   lighting.setActive(true);
 *   // In update:
 *   lighting.setLight('player', px, py, 200, 0.9, 1, 0.9, 0.7);
 *   lighting.setConeLight('headlight', px, py, rotation, 300, Math.PI/4, 0.8);
 *   lighting.update();
 */
export class LightingSystem {
  scene: Phaser.Scene;
  config: Required<LightingConfig>;

  private _lights: Map<string, Light> = new Map();
  private _active: boolean = false;
  private _lightMapRT: Phaser.GameObjects.RenderTexture;
  private _stampSprite: Phaser.GameObjects.Image;
  private _coneStampSprite: Phaser.GameObjects.Image;
  private _gradientKey: string;
  private _coneKey: string;
  private _coneSize: number;
  private _width: number;
  private _height: number;
  private _pad: number = 0;

  constructor(scene: Phaser.Scene, config: LightingConfig = {}) {
    this.scene = scene;
    this.config = { ...DEFAULTS, ...config };

    this._width = this.config.width || scene.sys.game.canvas.width;
    this._height = this.config.height || scene.sys.game.canvas.height;

    // Create textures
    this._gradientKey = '__lighting_gradient__';
    this._coneKey = '__lighting_cone__';
    this._coneSize = this.config.gradientSize * 2; // cone texture is taller
    this._createGradientTexture();
    this._createConeTexture();

    // Create RT with generous padding to cover any camera zoom level
    // At zoom Z, scrollFactor(0) objects are scaled by Z from the camera center,
    // so the RT (scaled back to 1/Z) needs extra margin to cover the full viewport.
    const pad = Math.ceil(Math.max(this._width, this._height) * 0.5);
    this._pad = pad;
    this._lightMapRT = scene.add.renderTexture(-pad, -pad, this._width + pad * 2, this._height + pad * 2);
    this._lightMapRT.setOrigin(0, 0);
    this._lightMapRT.setScrollFactor(0);
    this._lightMapRT.setDepth(999);
    this._lightMapRT.setBlendMode(Phaser.BlendModes.MULTIPLY);
    this._lightMapRT.setVisible(false);

    // Reusable stamp sprites
    this._stampSprite = scene.make.image({ key: this._gradientKey, add: false });
    this._stampSprite.setOrigin(0.5, 0.5);

    this._coneStampSprite = scene.make.image({ key: this._coneKey, add: false });
    // Origin at bottom-center so the cone rotates around the ship position
    this._coneStampSprite.setOrigin(0.5, 0.85);
  }

  /** Add or update a radial point light */
  setLight(
    id: string,
    worldX: number,
    worldY: number,
    radius: number,
    intensity: number,
    r: number = 1,
    g: number = 0.9,
    b: number = 0.7,
  ): void {
    this._lights.set(id, { type: 'point', worldX, worldY, radius, intensity, r, g, b });
  }

  /** Add or update a directional cone light (like headlights) */
  setConeLight(
    id: string,
    worldX: number,
    worldY: number,
    rotation: number,
    length: number,
    angle: number,
    intensity: number,
    r: number = 1,
    g: number = 0.95,
    b: number = 0.85,
  ): void {
    this._lights.set(id, { type: 'cone', worldX, worldY, rotation, length, angle, intensity, r, g, b });
  }

  /** Remove a light by id */
  removeLight(id: string): void {
    this._lights.delete(id);
  }

  /** Remove all lights */
  clearLights(): void {
    this._lights.clear();
  }

  /** Set the ambient brightness (0 = pitch black, 1 = full bright / no darkening) */
  setAmbient(value: number): void {
    this.config.ambient = Math.max(0, Math.min(1, value));
  }

  getAmbient(): number {
    return this.config.ambient;
  }

  /** Enable/disable the lighting overlay */
  setActive(active: boolean): void {
    this._active = active;
    this._lightMapRT.setVisible(active);
  }

  get active(): boolean {
    return this._active;
  }

  /** Call every frame to re-render the light map */
  update(): void {
    if (!this._active) return;

    const cam = this.scene.cameras.main;
    const rt = this._lightMapRT;

    // Counteract camera zoom so the overlay covers exactly the viewport
    // (scrollFactor(0) objects are still affected by camera zoom in Phaser 3)
    const zoom = cam.zoom;
    rt.setScale(1 / zoom);
    rt.setPosition(-this._pad / zoom, -this._pad / zoom);

    // Clear with ambient color
    const amb = Math.floor(this.config.ambient * 255);
    rt.fill(amb, amb, amb);

    if (this._lights.size === 0) return;

    const halfGrad = this.config.gradientSize / 2;

    rt.beginDraw();

    let count = 0;
    for (const light of this._lights.values()) {
      if (count >= this.config.maxLights) break;

      // World to screen position
      const screenX = (light.worldX - cam.scrollX) * cam.zoom + this._pad;
      const screenY = (light.worldY - cam.scrollY) * cam.zoom + this._pad;

      // Compute tint
      const cr = Math.min(255, Math.floor(light.r * 255));
      const cg = Math.min(255, Math.floor(light.g * 255));
      const cb = Math.min(255, Math.floor(light.b * 255));
      const tint = (cr << 16) | (cg << 8) | cb;

      if (light.type === 'cone') {
        const pixelLength = light.length * cam.zoom;
        const rtW = this._width + this._pad * 2;
        const rtH = this._height + this._pad * 2;

        // Skip if clearly off-screen
        if (
          screenX + pixelLength < 0 || screenX - pixelLength > rtW ||
          screenY + pixelLength < 0 || screenY - pixelLength > rtH
        ) {
          count++;
          continue;
        }

        // Scale: the cone texture is _coneSize tall, we want it to be pixelLength
        const scaleY = pixelLength / this._coneSize;
        // Width scales with the spread angle relative to the base angle
        const baseAngle = Math.PI / 2; // the texture was drawn with ~90 degree spread
        const scaleX = scaleY * (light.angle / baseAngle);

        this._coneStampSprite.setPosition(screenX, screenY);
        this._coneStampSprite.setScale(scaleX, scaleY);
        // Phaser rotation: 0 = right. Our cone texture points up (-Y).
        // To point in the light's direction, rotate by (rotation + PI/2)
        this._coneStampSprite.setRotation(light.rotation + Math.PI / 2);
        this._coneStampSprite.setTint(tint);
        this._coneStampSprite.setAlpha(light.intensity);

        rt.batchDraw(this._coneStampSprite);
      } else {
        // Point light
        const pixelRadius = light.radius * cam.zoom;
        const rtW = this._width + this._pad * 2;
        const rtH = this._height + this._pad * 2;

        if (
          screenX + pixelRadius < 0 || screenX - pixelRadius > rtW ||
          screenY + pixelRadius < 0 || screenY - pixelRadius > rtH
        ) {
          count++;
          continue;
        }

        const scale = pixelRadius / halfGrad;

        this._stampSprite.setPosition(screenX, screenY);
        this._stampSprite.setScale(scale);
        this._stampSprite.setTint(tint);
        this._stampSprite.setAlpha(light.intensity);

        rt.batchDraw(this._stampSprite);
      }

      count++;
    }

    rt.endDraw();
  }

  /** Set the depth of the lighting overlay */
  setDepth(depth: number): void {
    this._lightMapRT.setDepth(depth);
  }

  /** Destroy the lighting system and its resources */
  destroy(): void {
    this._lights.clear();
    if (this._lightMapRT) {
      this._lightMapRT.destroy();
    }
    if (this._stampSprite) {
      this._stampSprite.destroy();
    }
    if (this._coneStampSprite) {
      this._coneStampSprite.destroy();
    }
  }

  /** Create the radial gradient texture for point lights */
  private _createGradientTexture(): void {
    if (this.scene.textures.exists(this._gradientKey)) return;

    const size = this.config.gradientSize;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const center = size / 2;
    const grad = ctx.createRadialGradient(center, center, 0, center, center, center);
    grad.addColorStop(0, 'rgba(255,255,255,1.0)');
    grad.addColorStop(this.config.falloffInner, `rgba(255,255,255,${this.config.innerAlpha})`);
    grad.addColorStop(this.config.falloffMid, `rgba(255,255,255,${this.config.midAlpha})`);
    grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    this.scene.textures.addCanvas(this._gradientKey, canvas);
  }

  /** Create the cone gradient texture for directional lights */
  private _createConeTexture(): void {
    if (this.scene.textures.exists(this._coneKey)) return;

    const size = this._coneSize;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const cx = size / 2;
    const cy = size * 0.85; // origin near bottom

    // Draw a cone-shaped gradient pointing upward from (cx, cy)
    // Using a series of radial gradients clipped to a triangle path
    ctx.save();

    // Define the cone/triangle path — wider aperture
    const spreadHalf = Math.PI / 4; // 45 degrees each side = 90 degree cone
    const coneLen = size * 0.9;
    const leftX = cx + Math.sin(-spreadHalf) * coneLen;
    const leftY = cy - Math.cos(-spreadHalf) * coneLen;
    const rightX = cx + Math.sin(spreadHalf) * coneLen;
    const rightY = cy - Math.cos(spreadHalf) * coneLen;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(leftX, leftY);
    // Arc across the top
    ctx.arc(cx, cy, coneLen, -Math.PI / 2 - spreadHalf, -Math.PI / 2 + spreadHalf);
    ctx.closePath();
    ctx.clip();

    // Radial gradient from origin outward
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coneLen);
    grad.addColorStop(0, 'rgba(255,255,255,1.0)');
    grad.addColorStop(0.15, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.6)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.25)');
    grad.addColorStop(1.0, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Soften the edges — wide smooth angular falloff using destination-out
    const angularGrad = ctx.createLinearGradient(leftX, leftY, rightX, rightY);
    angularGrad.addColorStop(0, 'rgba(0,0,0,0.6)');
    angularGrad.addColorStop(0.15, 'rgba(0,0,0,0.25)');
    angularGrad.addColorStop(0.35, 'rgba(0,0,0,0.0)');
    angularGrad.addColorStop(0.65, 'rgba(0,0,0,0.0)');
    angularGrad.addColorStop(0.85, 'rgba(0,0,0,0.25)');
    angularGrad.addColorStop(1.0, 'rgba(0,0,0,0.6)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = angularGrad;
    ctx.fillRect(0, 0, size, size);

    ctx.restore();

    this.scene.textures.addCanvas(this._coneKey, canvas);
  }
}
