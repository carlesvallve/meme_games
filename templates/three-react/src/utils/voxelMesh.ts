import * as THREE from 'three';
import type { VoxelModel } from '../types';

export function buildVoxelGeometry(
  model: VoxelModel,
  palette: Record<number, THREE.Color>,
  scale = 0.25,
): THREE.BufferGeometry {
  const boxGeo = new THREE.BoxGeometry(scale, scale, scale);
  const geometries: THREE.BufferGeometry[] = [];

  const centerX = (model.size.x * scale) / 2;
  const centerY = 0;
  const centerZ = (model.size.z * scale) / 2;

  for (const [key, colorIdx] of model.voxels) {
    const [x, y, z] = key.split(',').map(Number);
    const color = palette[colorIdx] ?? new THREE.Color(0xffffff);

    const clone = boxGeo.clone();
    clone.translate(
      x * scale - centerX,
      y * scale - centerY,
      z * scale - centerZ,
    );

    // Apply vertex colors
    const count = clone.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    clone.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    geometries.push(clone);
  }

  boxGeo.dispose();

  if (geometries.length === 0) {
    return new THREE.BufferGeometry();
  }

  const merged = mergeGeometries(geometries);

  for (const g of geometries) g.dispose();

  return merged;
}

function mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalPositions = 0;
  let totalIndices = 0;

  for (const geo of geometries) {
    totalPositions += geo.attributes.position.count;
    totalIndices += (geo.index?.count ?? 0);
  }

  const positions = new Float32Array(totalPositions * 3);
  const normals = new Float32Array(totalPositions * 3);
  const colors = new Float32Array(totalPositions * 3);
  const indices = new Uint32Array(totalIndices);

  let posOffset = 0;
  let idxOffset = 0;
  let vertexOffset = 0;

  for (const geo of geometries) {
    const pos = geo.attributes.position;
    const norm = geo.attributes.normal;
    const col = geo.attributes.color;
    const idx = geo.index;

    for (let i = 0; i < pos.count * 3; i++) {
      positions[posOffset + i] = (pos.array as Float32Array)[i];
      normals[posOffset + i] = (norm.array as Float32Array)[i];
      colors[posOffset + i] = (col.array as Float32Array)[i];
    }

    if (idx) {
      for (let i = 0; i < idx.count; i++) {
        indices[idxOffset + i] = (idx.array as Uint16Array | Uint32Array)[i] + vertexOffset;
      }
      idxOffset += idx.count;
    }

    vertexOffset += pos.count;
    posOffset += pos.count * 3;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));

  return merged;
}
