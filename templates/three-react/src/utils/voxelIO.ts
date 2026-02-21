import type { VoxelModel } from '../types';

export function exportVox(model: VoxelModel, palette: Record<number, { r: number; g: number; b: number }>): ArrayBuffer {
  const voxelEntries = Array.from(model.voxels.entries());

  // VOX file format: https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox.txt
  // Simplified: HEADER + SIZE chunk + XYZI chunk + RGBA chunk

  const numVoxels = voxelEntries.length;
  const sizeChunkSize = 12;
  const xyziChunkSize = 4 + numVoxels * 4;
  const rgbaChunkSize = 256 * 4;

  // Calculate total size
  const headerSize = 8; // "VOX " + version
  const mainChildSize =
    12 + sizeChunkSize + // SIZE chunk header + data
    12 + xyziChunkSize + // XYZI chunk header + data
    12 + rgbaChunkSize;  // RGBA chunk header + data
  const totalSize = headerSize + 12 + mainChildSize; // MAIN header + children

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  let offset = 0;

  function writeString(s: string) {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(offset++, s.charCodeAt(i));
    }
  }

  function writeInt32(v: number) {
    view.setInt32(offset, v, true);
    offset += 4;
  }

  // Header
  writeString('VOX ');
  writeInt32(150); // version

  // MAIN chunk
  writeString('MAIN');
  writeInt32(0); // chunk data size
  writeInt32(mainChildSize); // children size

  // SIZE chunk
  writeString('SIZE');
  writeInt32(sizeChunkSize);
  writeInt32(0);
  writeInt32(model.size.x);
  writeInt32(model.size.y);
  writeInt32(model.size.z);

  // XYZI chunk
  writeString('XYZI');
  writeInt32(xyziChunkSize);
  writeInt32(0);
  writeInt32(numVoxels);

  for (const [key, colorIdx] of voxelEntries) {
    const [x, y, z] = key.split(',').map(Number);
    view.setUint8(offset++, x);
    view.setUint8(offset++, y);
    view.setUint8(offset++, z);
    view.setUint8(offset++, colorIdx);
  }

  // RGBA chunk (palette)
  writeString('RGBA');
  writeInt32(rgbaChunkSize);
  writeInt32(0);

  for (let i = 0; i < 256; i++) {
    const color = palette[i + 1];
    if (color) {
      view.setUint8(offset++, color.r);
      view.setUint8(offset++, color.g);
      view.setUint8(offset++, color.b);
      view.setUint8(offset++, 255);
    } else {
      view.setUint8(offset++, 0);
      view.setUint8(offset++, 0);
      view.setUint8(offset++, 0);
      view.setUint8(offset++, 255);
    }
  }

  return buffer;
}

export function importVox(buffer: ArrayBuffer): { model: VoxelModel; palette: Record<number, { r: number; g: number; b: number }> } {
  const view = new DataView(buffer);
  let offset = 0;

  function readString(len: number): string {
    let s = '';
    for (let i = 0; i < len; i++) {
      s += String.fromCharCode(view.getUint8(offset++));
    }
    return s;
  }

  function readInt32(): number {
    const v = view.getInt32(offset, true);
    offset += 4;
    return v;
  }

  // Header
  const magic = readString(4);
  if (magic !== 'VOX ') throw new Error('Not a VOX file');
  readInt32(); // version

  const voxels = new Map<string, number>();
  const size = { x: 0, y: 0, z: 0 };
  const palette: Record<number, { r: number; g: number; b: number }> = {};

  // Read chunks
  while (offset < buffer.byteLength) {
    const chunkId = readString(4);
    const chunkSize = readInt32();
    readInt32(); // children size

    const chunkEnd = offset + chunkSize;

    if (chunkId === 'SIZE') {
      size.x = readInt32();
      size.y = readInt32();
      size.z = readInt32();
    } else if (chunkId === 'XYZI') {
      const numVoxels = readInt32();
      for (let i = 0; i < numVoxels; i++) {
        const x = view.getUint8(offset++);
        const y = view.getUint8(offset++);
        const z = view.getUint8(offset++);
        const colorIdx = view.getUint8(offset++);
        voxels.set(`${x},${y},${z}`, colorIdx);
      }
    } else if (chunkId === 'RGBA') {
      for (let i = 0; i < 256; i++) {
        const r = view.getUint8(offset++);
        const g = view.getUint8(offset++);
        const b = view.getUint8(offset++);
        offset++; // alpha
        palette[i + 1] = { r, g, b };
      }
    }

    offset = chunkEnd;
  }

  return { model: { size, voxels }, palette };
}

export function downloadVox(model: VoxelModel, palette: Record<number, { r: number; g: number; b: number }>, filename = 'model.vox'): void {
  const buffer = exportVox(model, palette);
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Register console commands
if (typeof window !== 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any;
  w.__exportVox = exportVox;
  w.__importVox = importVox;
}
