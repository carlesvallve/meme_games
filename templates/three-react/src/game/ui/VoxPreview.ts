import * as THREE from 'three';
import { loadVoxModel, buildVoxMesh } from '../../utils/VoxModelLoader';
import type { VoxCharEntry } from '../character/VoxCharacterDB';

const PREVIEW_SIZE = 96;
const ROTATION_SPEED = 0.4; // radians per second
const RENDER_INTERVAL = 100; // ms between render updates (~10fps)

interface PreviewSlot {
  mesh: THREE.Mesh;
  scene: THREE.Scene;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/**
 * Singleton manager: one shared WebGLRenderer, one rAF loop throttled to ~10fps.
 * Each model gets a 2D canvas that cards embed directly.
 */
class VoxPreviewManager {
  private renderer: THREE.WebGLRenderer | null = null;
  private camera: THREE.OrthographicCamera;
  private slots = new Map<string, PreviewSlot>();
  private rafId = 0;
  private lastRender = 0;
  private angle = 0;
  private lastTime = 0;

  constructor() {
    // Frustum covers full model height with some margin
    this.camera = new THREE.OrthographicCamera(-0.35, 0.35, 0.55, -0.05, 0.01, 10);
    this.setupCamera();
  }

  private ensureRenderer() {
    if (this.renderer) return this.renderer;
    const r = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    r.setSize(PREVIEW_SIZE, PREVIEW_SIZE);
    r.setPixelRatio(1);
    r.setClearColor(0x000000, 0);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.2;
    // Offscreen — not visible
    r.domElement.style.position = 'fixed';
    r.domElement.style.left = '-9999px';
    r.domElement.style.top = '-9999px';
    document.body.appendChild(r.domElement);
    this.renderer = r;
    return r;
  }

  private setupCamera() {
    const r = 0.7;
    const cy = 0.0;
    this.camera.position.set(0, cy, r);
    this.camera.lookAt(0, cy, 0);
  }

  private startLoop() {
    if (this.rafId) return;
    this.lastTime = performance.now();
    this.lastRender = 0;

    const tick = (now: number) => {
      this.rafId = requestAnimationFrame(tick);
      const dt = (now - this.lastTime) / 1000;
      this.lastTime = now;
      this.angle -= ROTATION_SPEED * dt;

      // Throttle actual rendering
      if (now - this.lastRender < RENDER_INTERVAL) return;
      this.lastRender = now;
      if (this.slots.size === 0) return;

      const renderer = this.ensureRenderer();

      for (const slot of this.slots.values()) {
        slot.mesh.rotation.y = this.angle;
        renderer.render(slot.scene, this.camera);
        slot.ctx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
        slot.ctx.drawImage(renderer.domElement, 0, 0);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopLoop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  /** Load a vox model and return a live rotating canvas. */
  async load(entry: VoxCharEntry): Promise<HTMLCanvasElement> {
    const existing = this.slots.get(entry.id);
    if (existing) return existing.canvas;

    const canvas = document.createElement('canvas');
    canvas.width = PREVIEW_SIZE;
    canvas.height = PREVIEW_SIZE;
    const ctx = canvas.getContext('2d')!;

    try {
      const url = `${entry.folderPath}/${entry.prefix}.vox`;
      const { model, palette } = await loadVoxModel(url);
      const geo = buildVoxMesh(model, palette, 0.5);
      // Center geometry on X/Z so rotation pivots around the body, not weapon tips
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      const cx = (bb.min.x + bb.max.x) / 2;
      const cz = (bb.min.z + bb.max.z) / 2;
      geo.translate(-cx, 0, -cz);
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
      const mesh = new THREE.Mesh(geo, mat);

      const scene = new THREE.Scene();
      // Low ambient so directional lights create visible contrast
      scene.add(new THREE.AmbientLight(0xffffff, 0.3));
      // Key light — strong, top-left-front for clear shading
      const key = new THREE.DirectionalLight(0xffffff, 3.0);
      key.position.set(-2, 3, 2);
      scene.add(key);
      // Fill light — subtle, opposite side to prevent pure black
      const fill = new THREE.DirectionalLight(0x8899cc, 0.4);
      fill.position.set(2, 0, -1);
      scene.add(fill);
      scene.add(mesh);

      this.slots.set(entry.id, { mesh, scene, canvas, ctx });
      this.startLoop();
    } catch (err) {
      console.warn(`[VoxPreview] Failed to load ${entry.id}:`, err);
    }

    return canvas;
  }

  /** Remove a model and free resources. */
  remove(id: string) {
    const slot = this.slots.get(id);
    if (!slot) return;
    slot.mesh.geometry.dispose();
    (slot.mesh.material as THREE.Material).dispose();
    slot.scene.clear();
    this.slots.delete(id);
    if (this.slots.size === 0) this.stopLoop();
  }

  /** Remove all models and stop. */
  clear() {
    for (const id of [...this.slots.keys()]) this.remove(id);
    this.stopLoop();
  }

  /** Full teardown. */
  dispose() {
    this.clear();
    if (this.renderer) {
      this.renderer.domElement.remove();
      this.renderer.dispose();
      this.renderer = null;
    }
  }
}

/** Singleton shared across app lifetime. */
export const voxPreviewManager = new VoxPreviewManager();
