import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';

// ── Sky color presets per palette mood ──────────────────────────────

export interface SkyColors {
  zenith: number;    // top of sky
  horizon: number;   // band at horizon
  ground: number;    // below horizon (blends with fog)
  sun: number;       // sun disc color
  sunGlow: number;   // soft glow around sun
  fog: number;       // fog color (matches horizon)
}

const DEFAULT_SKY: SkyColors = {
  zenith: 0x0a0a2e,
  horizon: 0x4a3060,
  ground: 0x0a0a14,
  sun: 0xfffae0,
  sunGlow: 0xffaa40,
  fog: 0x2a1830,
};

const PALETTE_SKY: Record<string, Partial<SkyColors>> = {
  meadow:    { zenith: 0x1a2a5a, horizon: 0x6a80b0, ground: 0x1a2030, fog: 0x3a4860, sun: 0xfff8e0, sunGlow: 0xffcc60 },
  autumn:    { zenith: 0x1a1840, horizon: 0x8a4830, ground: 0x12100a, fog: 0x4a2818, sun: 0xffe0a0, sunGlow: 0xff8030 },
  tropical:  { zenith: 0x0a2858, horizon: 0x40a0c0, ground: 0x0a1828, fog: 0x2a6080, sun: 0xfffff0, sunGlow: 0xffdd80 },
  snowland:  { zenith: 0x2a3050, horizon: 0x8090b0, ground: 0x1a1a28, fog: 0x5a6880, sun: 0xf0f0ff, sunGlow: 0xc0d0ff },
  sands:     { zenith: 0x2a2040, horizon: 0xc08840, ground: 0x1a1008, fog: 0x6a4820, sun: 0xfff0c0, sunGlow: 0xffa030 },
  obsidian:  { zenith: 0x080810, horizon: 0x301820, ground: 0x060608, fog: 0x180c10, sun: 0xff8060, sunGlow: 0xc03020 },
  highlands: { zenith: 0x182848, horizon: 0x5a7090, ground: 0x101820, fog: 0x384858, sun: 0xfff8e0, sunGlow: 0xffbb50 },
  enchanted: { zenith: 0x0a1040, horizon: 0x5030a0, ground: 0x080818, fog: 0x281860, sun: 0xe0c0ff, sunGlow: 0x9060ff },
  swamp:     { zenith: 0x101820, horizon: 0x304028, ground: 0x080a08, fog: 0x1a2818, sun: 0xd0d8a0, sunGlow: 0x88a040 },
  coral:     { zenith: 0x0a2050, horizon: 0x50a0a0, ground: 0x081828, fog: 0x286868, sun: 0xfffff0, sunGlow: 0x80ffe0 },
  ash:       { zenith: 0x080808, horizon: 0x282020, ground: 0x040404, fog: 0x181010, sun: 0xffa060, sunGlow: 0xc04020 },
  mars:      { zenith: 0x1a0808, horizon: 0x6a2818, ground: 0x100808, fog: 0x401810, sun: 0xffc080, sunGlow: 0xff6030 },
};

export function getSkyColors(paletteName: string): SkyColors {
  const override = PALETTE_SKY[paletteName];
  if (!override) return { ...DEFAULT_SKY };
  return { ...DEFAULT_SKY, ...override };
}

// ── Procedural sky shader ───────────────────────────────────────────

const skyVertexShader = /* glsl */ `
varying vec3 vWorldDir;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldDir = normalize(worldPos.xyz - cameraPosition);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w; // push to far plane
}
`;

const skyFragmentShader = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uSunGlow;
uniform vec3 uSunDir;

varying vec3 vWorldDir;

void main() {
  vec3 dir = normalize(vWorldDir);
  float y = dir.y;

  // Sky gradient: ground -> horizon -> zenith
  vec3 color;
  if (y > 0.0) {
    float t = pow(y, 0.6);
    color = mix(uHorizon, uZenith, t);
  } else {
    float t = pow(-y, 0.8);
    color = mix(uHorizon, uGround, t);
  }

  // Sun disc
  float sunDot = max(0.0, dot(dir, uSunDir));
  float sunDisc = smoothstep(0.997, 0.999, sunDot);
  color = mix(color, uSunColor, sunDisc);

  // Sun glow (soft halo)
  float glow = pow(sunDot, 24.0) * 0.6;
  color += uSunGlow * glow;

  // Subtle wider glow
  float wideGlow = pow(sunDot, 6.0) * 0.15;
  color += uSunGlow * wideGlow;

  // Stars — raised from horizon, moderate density
  float starField = fract(sin(dot(floor(dir * 800.0), vec3(12.9898, 78.233, 45.164))) * 43758.5453);
  float starBright = smoothstep(0.998, 1.0, starField);          // sparse bright stars
  float starDim = smoothstep(0.995, 0.998, starField) * 0.3;     // sparse faint stars
  float horizonFade = smoothstep(0.05, 0.25, y);                  // slightly lower start
  float sunFade = 1.0 - smoothstep(0.8, 1.0, sunDot);            // fade near sun
  float starMask = (starBright + starDim) * horizonFade * sunFade;
  color += vec3(starMask * 0.7);

  gl_FragColor = vec4(color, 1.0);
}
`;

export class ProceduralSky {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(sunDirection: THREE.Vector3, colors: SkyColors) {
    const sunDir = sunDirection.clone().normalize();

    this.material = new THREE.ShaderMaterial({
      vertexShader: skyVertexShader,
      fragmentShader: skyFragmentShader,
      uniforms: {
        uZenith: { value: new THREE.Color(colors.zenith) },
        uHorizon: { value: new THREE.Color(colors.horizon) },
        uGround: { value: new THREE.Color(colors.ground) },
        uSunColor: { value: new THREE.Color(colors.sun) },
        uSunGlow: { value: new THREE.Color(colors.sunGlow) },
        uSunDir: { value: sunDir },
      },
      side: THREE.BackSide,
      depthWrite: false,
    });

    const geo = new THREE.SphereGeometry(500, 32, 16);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'proceduralSky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  setColors(colors: SkyColors): void {
    this.material.uniforms.uZenith.value.set(colors.zenith);
    this.material.uniforms.uHorizon.value.set(colors.horizon);
    this.material.uniforms.uGround.value.set(colors.ground);
    this.material.uniforms.uSunColor.value.set(colors.sun);
    this.material.uniforms.uSunGlow.value.set(colors.sunGlow);
  }

  setSunDirection(dir: THREE.Vector3): void {
    this.material.uniforms.uSunDir.value.copy(dir).normalize();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

// ── Procedural lensflare textures ───────────────────────────────────

function createFlareTexture(size: number, innerRadius: number, outerRadius: number, color: string): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;

  const gradient = ctx.createRadialGradient(cx, cy, innerRadius * size, cx, cy, outerRadius * size);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.4, color.replace('1)', '0.4)'));
  gradient.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function createHexTexture(size: number, color: string): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.35;

  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();

  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export function createSunLensflare(sunPosition: THREE.Vector3, colors: SkyColors): Lensflare {
  const lensflare = new Lensflare();

  const mainGlow = createFlareTexture(256, 0, 0.5, 'rgba(255,255,240,1)');
  const softBloom = createFlareTexture(256, 0, 0.5, 'rgba(255,180,80,1)');
  const hex1 = createHexTexture(128, 'rgba(255,200,100,0.3)');
  const hex2 = createHexTexture(64, 'rgba(180,140,255,0.2)');

  lensflare.addElement(new LensflareElement(mainGlow, 300, 0, new THREE.Color(colors.sun)));
  lensflare.addElement(new LensflareElement(softBloom, 600, 0, new THREE.Color(colors.sunGlow).multiplyScalar(0.3)));
  lensflare.addElement(new LensflareElement(hex1, 80, 0.3));
  lensflare.addElement(new LensflareElement(hex2, 120, 0.6));
  lensflare.addElement(new LensflareElement(hex1, 60, 0.9));

  lensflare.position.copy(sunPosition);

  return lensflare;
}
