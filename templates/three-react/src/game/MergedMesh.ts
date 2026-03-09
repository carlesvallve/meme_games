import * as THREE from 'three';
import { patchWorldRevealMaterial } from './shaders/WorldReveal';

export interface MergedMeshOptions {
  roughness?: number;
  metalness?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/**
 * Merges multiple Three.js objects (Meshes or Groups) into a single
 * BufferGeometry with vertex colors, tracking per-source vertex ranges
 * for individual destruction via vertex zeroing.
 */
export class MergedMesh {
  private vertexRanges: { start: number; count: number }[] = [];
  private destroyed = new Set<number>();
  private wrapper: THREE.Group | null = null;

  get isMerged(): boolean { return this.vertexRanges.length > 0; }

  /** Merge an array of Object3Ds into a single mesh.
   *  Disposes and removes originals from scene. Returns the wrapper Group. */
  merge(
    sources: THREE.Object3D[],
    scene: THREE.Scene,
    opts: MergedMeshOptions = {},
  ): THREE.Group | null {
    if (sources.length < 2) return null;

    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    this.vertexRanges = [];
    this.destroyed.clear();

    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      source.updateMatrixWorld(true);
      const start = positions.length / 3;

      source.traverse((child) => {
        if (!(child as THREE.Mesh).isMesh) return;
        const mesh = child as THREE.Mesh;
        const geo = mesh.geometry.index
          ? mesh.geometry.toNonIndexed()
          : mesh.geometry.clone();
        geo.applyMatrix4(mesh.matrixWorld);

        const pos = geo.getAttribute('position') as THREE.BufferAttribute;
        const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
        const existingColors = geo.getAttribute('color') as THREE.BufferAttribute | null;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const c = mat.color;

        for (let v = 0; v < pos.count; v++) {
          positions.push(pos.getX(v), pos.getY(v), pos.getZ(v));
          normals.push(nrm.getX(v), nrm.getY(v), nrm.getZ(v));
          // Preserve existing vertex colors (from a previous merge), else use material color
          if (existingColors) {
            colors.push(existingColors.getX(v), existingColors.getY(v), existingColors.getZ(v));
          } else {
            colors.push(c.r, c.g, c.b);
          }
        }
        geo.dispose();
      });

      this.vertexRanges.push({ start, count: positions.length / 3 - start });
    }

    const mergedGeo = new THREE.BufferGeometry();
    mergedGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    mergedGeo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    mergedGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mergedMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: opts.roughness ?? 0.85,
      metalness: opts.metalness ?? 0.05,
      transparent: true,
      depthWrite: true,
    });
    patchWorldRevealMaterial(mergedMat);

    const mergedMesh = new THREE.Mesh(mergedGeo, mergedMat);
    mergedMesh.castShadow = opts.castShadow !== false;
    mergedMesh.receiveShadow = opts.receiveShadow === true;

    // Dispose originals
    for (const source of sources) {
      source.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).geometry.dispose();
          const mat = (child as THREE.Mesh).material;
          if (Array.isArray(mat)) mat.forEach(m => m.dispose());
          else (mat as THREE.Material).dispose();
        }
      });
      scene.remove(source);
    }

    this.wrapper = new THREE.Group();
    this.wrapper.add(mergedMesh);
    scene.add(this.wrapper);
    return this.wrapper;
  }

  /** Destroy source by index — zeroes its vertices. Returns true on success. */
  destroy(index: number): boolean {
    if (!this.isMerged || index < 0 || index >= this.vertexRanges.length) return false;
    if (this.destroyed.has(index)) return false;
    this.destroyed.add(index);

    const range = this.vertexRanges[index];
    const mergedMesh = this.wrapper!.children[0] as THREE.Mesh;
    const posAttr = mergedMesh.geometry.getAttribute('position') as THREE.BufferAttribute;

    for (let v = range.start; v < range.start + range.count; v++) {
      posAttr.setXYZ(v, 0, 0, 0);
    }
    posAttr.needsUpdate = true;
    return true;
  }

  isDestroyed(index: number): boolean {
    return this.destroyed.has(index);
  }

  /** Remove merged mesh from scene and dispose. Resets all tracking state. */
  clear(scene: THREE.Scene): void {
    if (this.wrapper) {
      this.wrapper.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).geometry.dispose();
          const mat = (child as THREE.Mesh).material;
          if (Array.isArray(mat)) mat.forEach(m => m.dispose());
          else (mat as THREE.Material).dispose();
        }
      });
      scene.remove(this.wrapper);
      this.wrapper = null;
    }
    this.vertexRanges = [];
    this.destroyed.clear();
  }
}
