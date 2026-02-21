import { DUNGEON, CELL } from '../core/Constants.js';

export class DungeonMap {
  constructor(width = DUNGEON.WIDTH, height = DUNGEON.HEIGHT) {
    this.width = width;
    this.height = height;
    this.grid = [];
    this.rooms = [];
    this.explored = [];
    this.entities = new Map(); // "x,y" -> entity data
    this.playerStart = { x: 0, z: 0 };
    this.stairsPos = null;
    this.clear();
  }

  clear() {
    this.grid = Array.from({ length: this.height }, () =>
      Array(this.width).fill(CELL.VOID)
    );
    this.explored = Array.from({ length: this.height }, () =>
      Array(this.width).fill(false)
    );
    this.rooms = [];
    this.entities.clear();
  }

  getCell(x, z) {
    if (x < 0 || x >= this.width || z < 0 || z >= this.height) return CELL.VOID;
    return this.grid[z][x];
  }

  setCell(x, z, type) {
    if (x < 0 || x >= this.width || z < 0 || z >= this.height) return;
    this.grid[z][x] = type;
  }

  isWalkable(x, z) {
    const cell = this.getCell(x, z);
    return cell === CELL.FLOOR || cell === CELL.DOOR || cell === CELL.STAIRS ||
           cell === CELL.CHEST || cell === CELL.TRAP || cell === CELL.SHOP ||
           cell === CELL.ENEMY || cell === CELL.TORCH;
  }

  explore(x, z, radius = 2) {
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx >= 0 && nx < this.width && nz >= 0 && nz < this.height) {
          this.explored[nz][nx] = true;
        }
      }
    }
  }

  getEntity(x, z) {
    return this.entities.get(`${x},${z}`) || null;
  }

  setEntity(x, z, entity) {
    this.entities.set(`${x},${z}`, entity);
  }

  removeEntity(x, z) {
    this.entities.delete(`${x},${z}`);
  }

  getRandomFloorTile() {
    const floors = [];
    for (let z = 0; z < this.height; z++) {
      for (let x = 0; x < this.width; x++) {
        if (this.grid[z][x] === CELL.FLOOR) floors.push({ x, z });
      }
    }
    return floors.length > 0 ? floors[Math.floor(Math.random() * floors.length)] : null;
  }
}
