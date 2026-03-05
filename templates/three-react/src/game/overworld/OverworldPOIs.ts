/**
 * OverworldPOIs — procedural mesh builders for Points of Interest.
 *
 * Provides both mini markers (for overworld tiles) and full-size
 * structures (for zoomed-in heightmaps).
 */

import * as THREE from 'three';

// ── Helpers ────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.85, metalness: 0.1 });
const _darkStoneMat = new THREE.MeshStandardMaterial({ color: 0x6a6058, roughness: 0.85, metalness: 0.1 });
const _darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2a, roughness: 1.0 });
const _roofMat = new THREE.MeshStandardMaterial({ color: 0x7a4030, roughness: 0.8, metalness: 0.05 });

// ── Mini markers (overworld tiles) ─────────────────────────────────

/** Small procedural castle for overworld tile. scale ~0.08 for 4m tiles. */
export function buildMiniCastle(seed: number, scale: number): THREE.Group {
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  const V = scale;

  // Main keep
  const keepW = V * 5;
  const keepH = V * 7;
  const keepD = V * 5;
  const keep = new THREE.Mesh(new THREE.BoxGeometry(keepW, keepH, keepD), _stoneMat);
  keep.position.y = keepH / 2;
  keep.castShadow = true;
  keep.receiveShadow = true;
  group.add(keep);

  // Turrets on corners
  const turretCount = 2 + Math.floor(rng() * 3);
  const turretW = V * 2;
  const turretH = V * 4;
  for (let i = 0; i < turretCount; i++) {
    const turret = new THREE.Mesh(new THREE.BoxGeometry(turretW, turretH, turretW), _darkStoneMat);
    const angle = (i / turretCount) * Math.PI * 2 + rng() * 0.3;
    const dist = keepW * 0.45;
    turret.position.set(
      Math.cos(angle) * dist,
      keepH + turretH / 2 - V,
      Math.sin(angle) * dist,
    );
    turret.castShadow = true;
    group.add(turret);
  }

  // Roof hint on keep
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(keepW * 1.1, V * 1.5, keepD * 1.1),
    _roofMat,
  );
  roof.position.y = keepH + V * 0.5;
  roof.castShadow = true;
  group.add(roof);

  return group;
}

/** Small dungeon entrance marker for overworld tile. */
export function buildMiniDungeonMarker(seed: number, scale: number): THREE.Group {
  const rng = mulberry32(seed);
  void rng; // consume for determinism consistency
  const group = new THREE.Group();
  const V = scale;

  // Two stone pillars
  const pillarW = V * 1.5;
  const pillarH = V * 6;
  const spacing = V * 2.5;

  const left = new THREE.Mesh(new THREE.BoxGeometry(pillarW, pillarH, pillarW), _stoneMat);
  left.position.set(-spacing, pillarH / 2, 0);
  left.castShadow = true;
  group.add(left);

  const right = new THREE.Mesh(new THREE.BoxGeometry(pillarW, pillarH, pillarW), _stoneMat);
  right.position.set(spacing, pillarH / 2, 0);
  right.castShadow = true;
  group.add(right);

  // Lintel
  const lintel = new THREE.Mesh(
    new THREE.BoxGeometry(spacing * 2 + pillarW, V * 1.5, pillarW),
    _darkStoneMat,
  );
  lintel.position.set(0, pillarH + V * 0.5, 0);
  lintel.castShadow = true;
  group.add(lintel);

  // Dark opening
  const doorH = pillarH * 0.85;
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(spacing * 1.6, doorH, V * 0.5),
    _darkMat,
  );
  door.position.set(0, doorH / 2, 0);
  group.add(door);

  return group;
}

// ── Full-size structures (heightmap) ───────────────────────────────

/** Full-size castle for zoomed-in heightmap. */
export function buildFullCastle(seed: number): THREE.Group {
  const rng = mulberry32(seed);
  const group = new THREE.Group();

  // Main keep (50% scale)
  const keepW = 1.0;
  const keepH = 1.5;
  const keepD = 1.0;
  const keep = new THREE.Mesh(new THREE.BoxGeometry(keepW, keepH, keepD), _stoneMat);
  keep.position.y = keepH / 2;
  keep.castShadow = true;
  keep.receiveShadow = true;
  group.add(keep);

  // Corner turrets
  const turretCount = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < turretCount; i++) {
    const tw = 0.3;
    const th = 0.75 + rng() * 0.5;
    const turret = new THREE.Mesh(new THREE.BoxGeometry(tw, th, tw), _darkStoneMat);
    const angle = (i / turretCount) * Math.PI * 2 + rng() * 0.4;
    const dist = keepW * 0.55;
    turret.position.set(
      Math.cos(angle) * dist,
      keepH + th / 2 - 0.3,
      Math.sin(angle) * dist,
    );
    turret.castShadow = true;
    group.add(turret);
  }

  // Walls around keep — each wall split by a gate opening with a door
  const wallH = 0.9;
  const wallThick = 0.15;
  const wallDist = keepW * 0.9;
  const wallLen = keepW * 1.8;
  const gateW = 0.55;  // gate opening width (wide for walkability)
  const halfSegLen = (wallLen - gateW) / 2;

  for (let side = 0; side < 4; side++) {
    const isXWall = side % 2 === 0;
    const sign = side < 2 ? 1 : -1;

    // Two wall segments on each side of the gate
    for (const segSign of [-1, 1]) {
      const seg = new THREE.Mesh(
        new THREE.BoxGeometry(
          isXWall ? halfSegLen : wallThick,
          wallH,
          isXWall ? wallThick : halfSegLen,
        ),
        _stoneMat,
      );
      const offset = segSign * (gateW / 2 + halfSegLen / 2);
      seg.position.set(
        isXWall ? offset : sign * wallDist,
        wallH / 2,
        isXWall ? sign * wallDist : offset,
      );
      seg.castShadow = true;
      seg.receiveShadow = true;
      group.add(seg);
    }

    // Gate pillars
    const pillarW2 = 0.08;
    const pillarH2 = wallH * 0.9;
    for (const pSign of [-1, 1]) {
      const pillar = new THREE.Mesh(
        new THREE.BoxGeometry(pillarW2, pillarH2, pillarW2),
        _darkStoneMat,
      );
      const pOff = pSign * (gateW / 2 + pillarW2 / 2);
      pillar.position.set(
        isXWall ? pOff : sign * wallDist,
        pillarH2 / 2,
        isXWall ? sign * wallDist : pOff,
      );
      pillar.castShadow = true;
      group.add(pillar);
    }

    // Gate lintel
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(
        isXWall ? gateW + pillarW2 * 2 : wallThick,
        0.15,
        isXWall ? wallThick : gateW + pillarW2 * 2,
      ),
      _darkStoneMat,
    );
    lintel.position.set(
      isXWall ? 0 : sign * wallDist,
      pillarH2 + 0.07,
      isXWall ? sign * wallDist : 0,
    );
    lintel.castShadow = true;
    group.add(lintel);

    // Dark door opening
    const doorH2 = pillarH2 * 0.85;
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(
        isXWall ? gateW : 0.08,
        doorH2,
        isXWall ? 0.08 : gateW,
      ),
      _darkMat,
    );
    door.position.set(
      isXWall ? 0 : sign * wallDist,
      doorH2 / 2,
      isXWall ? sign * wallDist : 0,
    );
    group.add(door);
  }

  // Roof
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(keepW * 1.15, 0.4, keepD * 1.15),
    _roofMat,
  );
  roof.position.y = keepH + 0.1;
  roof.castShadow = true;
  group.add(roof);

  return group;
}

/** Full-size dungeon entrance for zoomed-in heightmap. */
export function buildFullDungeonEntrance(seed: number): THREE.Group {
  const rng = mulberry32(seed);
  void rng;
  const group = new THREE.Group();

  const pillarW = 0.18;
  const pillarH = 0.7;
  const spacing = 0.3;

  // Pillars
  const left = new THREE.Mesh(new THREE.BoxGeometry(pillarW, pillarH, pillarW), _stoneMat);
  left.position.set(-spacing, pillarH / 2, 0);
  left.castShadow = true;
  group.add(left);

  const right = new THREE.Mesh(new THREE.BoxGeometry(pillarW, pillarH, pillarW), _stoneMat);
  right.position.set(spacing, pillarH / 2, 0);
  right.castShadow = true;
  group.add(right);

  // Lintel
  const lintelW = spacing * 2 + pillarW;
  const lintelH = 0.14;
  const lintel = new THREE.Mesh(
    new THREE.BoxGeometry(lintelW, lintelH, pillarW),
    _darkStoneMat,
  );
  lintel.position.set(0, pillarH + lintelH / 2, 0);
  lintel.castShadow = true;
  group.add(lintel);

  // Dark opening
  const doorH = pillarH * 0.9;
  const doorW = spacing * 1.5;
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(doorW, doorH, 0.08),
    _darkMat,
  );
  door.position.set(0, doorH / 2, 0);
  group.add(door);

  // Arch stones on top
  const archStone = new THREE.Mesh(
    new THREE.BoxGeometry(lintelW * 0.6, 0.1, pillarW * 1.2),
    _stoneMat,
  );
  archStone.position.set(0, pillarH + lintelH + 0.05, 0);
  archStone.castShadow = true;
  group.add(archStone);

  return group;
}
