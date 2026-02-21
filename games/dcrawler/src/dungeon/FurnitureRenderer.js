import * as THREE from 'three';
import { DUNGEON, CELL } from '../core/Constants.js';
import { getFurnitureForTheme } from './FurnitureDatabase.js';

/**
 * FurnitureRenderer — places theme-appropriate furniture in dungeon rooms.
 * Furniture is decorative only (no collision).
 */
export class FurnitureRenderer {
  constructor(dungeonGroup) {
    this.dungeonGroup = dungeonGroup;
    this.meshes = [];
  }

  /**
   * Place furniture in all rooms based on the theme.
   */
  placeFurniture(map, theme) {
    this.clear();
    if (!theme) return;

    const themeKey = theme.name.toLowerCase();
    const defs = getFurnitureForTheme(themeKey);
    if (defs.length === 0) return;

    for (const room of map.rooms) {
      this._furnishRoom(map, room, defs, theme);
    }
  }

  /**
   * Furnish a single room with shuffled furniture definitions.
   */
  _furnishRoom(map, room, defs, theme) {
    const cs = DUNGEON.CELL_SIZE;

    // Classify every floor cell inside the room
    const classified = this._classifyCells(map, room);
    if (classified.length === 0) return;

    // Detect entrance cells and their neighbors (to keep clear)
    const blocked = this._getBlockedCells(map, room);

    // Filter out blocked cells
    const available = classified.filter(c => !blocked.has(`${c.x},${c.z}`));

    // Shuffle available cells
    this._shuffle(available);

    // Track placed positions for spacing + per-def counts
    const placed = [];
    const defCounts = new Map();
    const minSpacing = 2; // grid cells

    for (const cell of available) {
      // Try each def (shuffled order per room)
      const shuffledDefs = [...defs];
      this._shuffle(shuffledDefs);

      for (const def of shuffledDefs) {
        // Check placement rule matches cell classification
        if (!this._placementMatches(def.placement, cell.type)) continue;

        // Check max per room
        const count = defCounts.get(def.id) || 0;
        if (count >= def.maxPerRoom) continue;

        // Roll frequency
        if (Math.random() > def.frequency) continue;

        // Check spacing
        const tooClose = placed.some(p =>
          Math.abs(p.x - cell.x) + Math.abs(p.z - cell.z) < minSpacing
        );
        if (tooClose) continue;

        // Place it
        const wx = cell.x * cs;
        const wz = cell.z * cs;
        this._createMesh(def, wx, wz, cell.wallDir, cs);

        placed.push({ x: cell.x, z: cell.z });
        defCounts.set(def.id, count + 1);
        break; // one piece per cell
      }
    }
  }

  /**
   * Classify each floor cell in a room by wall proximity.
   * Returns: [{ x, z, type: 'corner'|'near-wall'|'center', wallDir: {dx,dz} }]
   */
  _classifyCells(map, room) {
    const cells = [];
    const dirs = [
      { dx: 0, dz: -1 }, { dx: 1, dz: 0 },
      { dx: 0, dz: 1 }, { dx: -1, dz: 0 },
    ];

    for (let z = room.z; z < room.z + room.h; z++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        const cell = map.getCell(x, z);
        // Skip occupied cells
        if (cell === CELL.ENEMY || cell === CELL.CHEST ||
            cell === CELL.STAIRS || cell === CELL.TORCH ||
            cell === CELL.SHOP || cell === CELL.TRAP) continue;
        if (cell < CELL.FLOOR) continue;

        // Check if this is the player start
        if (map.playerStart && map.playerStart.x === x && map.playerStart.z === z) continue;

        // Count wall neighbors and find a wall direction
        let wallCount = 0;
        let wallDir = { dx: 0, dz: 0 };
        for (const d of dirs) {
          if (map.getCell(x + d.dx, z + d.dz) === CELL.WALL) {
            wallCount++;
            wallDir = d;
          }
        }

        let type;
        if (wallCount >= 2) type = 'corner';
        else if (wallCount === 1) type = 'near-wall';
        else type = 'center';

        cells.push({ x, z, type, wallDir });
      }
    }
    return cells;
  }

  /**
   * Find cells that should stay clear: entrance cells and their neighbors.
   * Entrance cells = room-edge floor cells adjacent to corridor floor outside the room.
   */
  _getBlockedCells(map, room) {
    const blocked = new Set();
    const dirs = [
      { dx: 0, dz: -1 }, { dx: 1, dz: 0 },
      { dx: 0, dz: 1 }, { dx: -1, dz: 0 },
    ];

    // Check room perimeter
    for (let z = room.z; z < room.z + room.h; z++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        // Only check edge cells of the room
        const isEdge = (x === room.x || x === room.x + room.w - 1 ||
                        z === room.z || z === room.z + room.h - 1);
        if (!isEdge) continue;

        const cell = map.getCell(x, z);
        if (cell < CELL.FLOOR && cell !== CELL.TORCH) continue;

        // Check if any neighbor outside the room is a floor (corridor)
        for (const d of dirs) {
          const nx = x + d.dx;
          const nz = z + d.dz;
          const isOutside = nx < room.x || nx >= room.x + room.w ||
                            nz < room.z || nz >= room.z + room.h;
          if (!isOutside) continue;

          const ncell = map.getCell(nx, nz);
          if (ncell >= CELL.FLOOR || ncell === CELL.TORCH) {
            // This is an entrance cell — block it and neighbors
            blocked.add(`${x},${z}`);
            for (const d2 of dirs) {
              blocked.add(`${x + d2.dx},${z + d2.dz}`);
            }
          }
        }
      }
    }
    return blocked;
  }

  /**
   * Check if a placement rule matches a cell classification.
   */
  _placementMatches(placement, cellType) {
    switch (placement) {
      case 'corner': return cellType === 'corner';
      case 'near-wall': return cellType === 'near-wall' || cellType === 'corner';
      case 'center': return cellType === 'center';
      case 'ceiling': return true; // any floor cell can have ceiling furniture
      case 'wall-mounted': return cellType === 'near-wall' || cellType === 'corner';
      case 'floor': return cellType === 'center'; // rugs in center areas
      default: return false;
    }
  }

  /**
   * Create a Three.js mesh for a furniture piece.
   */
  _createMesh(def, wx, wz, wallDir, cs) {
    const { size, meshType, color, stroke, yOffset, drawFace } = def;

    // Create canvas texture
    const texSize = 128;
    const canvas = document.createElement('canvas');
    canvas.width = texSize;
    canvas.height = texSize;
    const ctx = canvas.getContext('2d');

    // Fill base color
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, texSize, texSize);

    // Stroke border (comic style)
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, texSize - 4, texSize - 4);

    // Optional detail drawing
    if (drawFace) {
      drawFace(ctx, texSize, texSize);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;

    let geometry;
    let mesh;

    switch (meshType) {
      case 'cylinder': {
        geometry = new THREE.CylinderGeometry(size.w / 2, size.w / 2, size.h, 8);
        const mat = new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.8,
          metalness: 0,
        });
        mesh = new THREE.Mesh(geometry, mat);
        mesh.position.set(wx, size.h / 2 + yOffset, wz);
        break;
      }

      case 'plane': {
        geometry = new THREE.PlaneGeometry(size.w, size.h || size.d);
        const matConfig = {
          map: texture,
          transparent: true,
          side: THREE.DoubleSide,
          roughness: 0.6,
          metalness: 0,
        };
        if (def.emissive) {
          matConfig.emissive = 0xffffff;
          matConfig.emissiveMap = texture;
          matConfig.emissiveIntensity = 0.8;
        }
        const mat = new THREE.MeshStandardMaterial(matConfig);
        mesh = new THREE.Mesh(geometry, mat);

        if (def.placement === 'ceiling') {
          // Flat on ceiling
          mesh.rotation.x = Math.PI / 2;
          mesh.position.set(wx, cs - 0.05, wz);
        } else if (def.placement === 'wall-mounted') {
          // Mounted on wall — face away from wall
          const offset = cs * 0.48;
          mesh.position.set(
            wx + wallDir.dx * offset,
            yOffset,
            wz + wallDir.dz * offset
          );
          // Rotate to face away from wall
          if (wallDir.dx !== 0) {
            mesh.rotation.y = Math.PI / 2;
          }
        } else if (def.placement === 'floor') {
          // Flat on floor
          mesh.rotation.x = -Math.PI / 2;
          mesh.position.set(wx, yOffset, wz);
        }
        break;
      }

      case 'box':
      default: {
        geometry = new THREE.BoxGeometry(size.w, size.h, size.d);
        const mat = new THREE.MeshStandardMaterial({
          map: texture,
          roughness: 0.8,
          metalness: 0,
        });
        mesh = new THREE.Mesh(geometry, mat);

        // Offset toward wall if near-wall placement
        let ox = 0, oz = 0;
        if (def.placement === 'near-wall' || def.placement === 'corner') {
          ox = wallDir.dx * cs * 0.2;
          oz = wallDir.dz * cs * 0.2;
        }

        mesh.position.set(wx + ox, size.h / 2 + yOffset, wz + oz);
        break;
      }
    }

    if (mesh) {
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.dungeonGroup.add(mesh);
      this.meshes.push(mesh);
    }
  }

  /**
   * Remove all furniture meshes and dispose resources.
   */
  clear() {
    for (const mesh of this.meshes) {
      this.dungeonGroup.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        if (mesh.material.map) mesh.material.map.dispose();
        mesh.material.dispose();
      }
    }
    this.meshes = [];
  }

  /**
   * Fisher-Yates shuffle in place.
   */
  _shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
}
