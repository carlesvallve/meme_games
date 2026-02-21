import { DUNGEON, CELL } from '../core/Constants.js';
import { DungeonMap } from './DungeonMap.js';

export class DungeonGenerator {
  generate(floor = 1) {
    const map = new DungeonMap(DUNGEON.WIDTH, DUNGEON.HEIGHT);
    this._placeRooms(map);
    this._connectRooms(map);
    this._placeTorches(map);
    this._placeStairs(map);
    this._placeEnemies(map, floor);
    this._placeChests(map, floor);
    this._setPlayerStart(map);
    return map;
  }

  _placeRooms(map) {
    const maxAttempts = 100;
    for (let i = 0; i < maxAttempts && map.rooms.length < DUNGEON.MAX_ROOMS; i++) {
      const w = DUNGEON.MIN_ROOM_SIZE + Math.floor(Math.random() * (DUNGEON.MAX_ROOM_SIZE - DUNGEON.MIN_ROOM_SIZE + 1));
      const h = DUNGEON.MIN_ROOM_SIZE + Math.floor(Math.random() * (DUNGEON.MAX_ROOM_SIZE - DUNGEON.MIN_ROOM_SIZE + 1));
      const x = 1 + Math.floor(Math.random() * (map.width - w - 2));
      const z = 1 + Math.floor(Math.random() * (map.height - h - 2));

      const room = { x, z, w, h, cx: Math.floor(x + w / 2), cz: Math.floor(z + h / 2) };

      if (this._roomOverlaps(map, room)) continue;

      map.rooms.push(room);
      this._carveRoom(map, room);
    }
  }

  _roomOverlaps(map, room) {
    const pad = 1;
    for (const other of map.rooms) {
      if (room.x - pad < other.x + other.w &&
          room.x + room.w + pad > other.x &&
          room.z - pad < other.z + other.h &&
          room.z + room.h + pad > other.z) {
        return true;
      }
    }
    return false;
  }

  _carveRoom(map, room) {
    for (let z = room.z; z < room.z + room.h; z++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        map.setCell(x, z, CELL.FLOOR);
      }
    }
    // Place walls around room
    for (let z = room.z - 1; z <= room.z + room.h; z++) {
      for (let x = room.x - 1; x <= room.x + room.w; x++) {
        if (map.getCell(x, z) === CELL.VOID) {
          map.setCell(x, z, CELL.WALL);
        }
      }
    }
  }

  _connectRooms(map) {
    for (let i = 1; i < map.rooms.length; i++) {
      const a = map.rooms[i - 1];
      const b = map.rooms[i];
      this._carveCorridor(map, a.cx, a.cz, b.cx, b.cz);
    }
  }

  _carveCorridor(map, x1, z1, x2, z2) {
    let x = x1;
    let z = z1;

    // Horizontal first, then vertical
    while (x !== x2) {
      this._carveCorridorCell(map, x, z);
      x += x < x2 ? 1 : -1;
    }
    while (z !== z2) {
      this._carveCorridorCell(map, x, z);
      z += z < z2 ? 1 : -1;
    }
    this._carveCorridorCell(map, x, z);
  }

  _carveCorridorCell(map, x, z) {
    if (map.getCell(x, z) !== CELL.FLOOR) {
      map.setCell(x, z, CELL.FLOOR);
    }
    // Add walls around corridor
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        if (map.getCell(x + dx, z + dz) === CELL.VOID) {
          map.setCell(x + dx, z + dz, CELL.WALL);
        }
      }
    }
  }

  _placeTorches(map) {
    // Place torches along walls adjacent to floor tiles
    const candidates = [];
    for (let z = 1; z < map.height - 1; z++) {
      for (let x = 1; x < map.width - 1; x++) {
        if (map.getCell(x, z) !== CELL.FLOOR) continue;
        // Check if adjacent to a wall
        const dirs = [{ dx: 0, dz: -1 }, { dx: 1, dz: 0 }, { dx: 0, dz: 1 }, { dx: -1, dz: 0 }];
        for (const d of dirs) {
          if (map.getCell(x + d.dx, z + d.dz) === CELL.WALL) {
            candidates.push({ x, z });
            break;
          }
        }
      }
    }

    // Place torches with spacing — roughly every 5-7 tiles
    const minSpacing = 5;
    const placed = [];
    // Shuffle candidates
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    for (const c of candidates) {
      const tooClose = placed.some(p =>
        Math.abs(p.x - c.x) + Math.abs(p.z - c.z) < minSpacing
      );
      if (!tooClose) {
        map.setCell(c.x, c.z, CELL.TORCH);
        placed.push(c);
      }
    }
  }

  _placeStairs(map) {
    // Put stairs in the last room
    const lastRoom = map.rooms[map.rooms.length - 1];
    const sx = lastRoom.cx;
    const sz = lastRoom.cz;
    map.setCell(sx, sz, CELL.STAIRS);
    map.stairsPos = { x: sx, z: sz };
  }

  _placeEnemies(map, floor) {
    const enemyCount = 3 + floor * 2;
    let placed = 0;
    // Skip first room (player start) and last room (stairs)
    const availableRooms = map.rooms.slice(1, -1);

    for (const room of availableRooms) {
      if (placed >= enemyCount) break;
      const count = 1 + Math.floor(Math.random() * 2);
      for (let j = 0; j < count && placed < enemyCount; j++) {
        const ex = room.x + 1 + Math.floor(Math.random() * (room.w - 2));
        const ez = room.z + 1 + Math.floor(Math.random() * (room.h - 2));
        if (map.getCell(ex, ez) === CELL.FLOOR) {
          map.setCell(ex, ez, CELL.ENEMY);
          placed++;
        }
      }
    }
  }

  _placeChests(map, floor) {
    const chestCount = 1 + Math.floor(floor / 2);
    let placed = 0;
    const availableRooms = map.rooms.slice(1, -1);

    for (const room of availableRooms) {
      if (placed >= chestCount) break;
      if (Math.random() > 0.5) {
        const cx = room.x + 1 + Math.floor(Math.random() * (room.w - 2));
        const cz = room.z + 1 + Math.floor(Math.random() * (room.h - 2));
        if (map.getCell(cx, cz) === CELL.FLOOR) {
          map.setCell(cx, cz, CELL.CHEST);
          placed++;
        }
      }
    }
  }

  _setPlayerStart(map) {
    const firstRoom = map.rooms[0];
    map.playerStart = { x: firstRoom.cx, z: firstRoom.cz };
  }
}
