/**
 * FurnitureDatabase — Definitions and catalogs for room furniture/props.
 *
 * Placement rules:
 *   near-wall   — floor cell with 1+ wall neighbors; offset toward wall
 *   corner      — floor cell with 2+ adjacent wall neighbors
 *   center      — floor cell with 0 wall neighbors
 *   ceiling     — plane on ceiling (y = CELL_SIZE)
 *   wall-mounted — plane on wall face
 *   floor       — flat on ground (y = 0.01)
 */

// ─── Office catalog ────────────────────────────────────────────────

const officeFurniture = [
  {
    id: 'desk',
    themes: ['office'],
    placement: 'near-wall',
    frequency: 0.25,
    maxPerRoom: 3,
    meshType: 'box',
    size: { w: 1.8, h: 0.8, d: 1.0 },
    yOffset: 0,
    color: '#8B7355',
    stroke: '#1a1a1a',
    drawFace(ctx, w, h) {
      // Keyboard area
      ctx.fillStyle = '#555555';
      ctx.fillRect(w * 0.15, h * 0.1, w * 0.45, h * 0.25);
      // Monitor
      ctx.fillStyle = '#333333';
      ctx.fillRect(w * 0.65, h * 0.05, w * 0.25, h * 0.35);
      ctx.fillStyle = '#6699cc';
      ctx.fillRect(w * 0.67, h * 0.08, w * 0.21, h * 0.25);
    },
  },
  {
    id: 'chair',
    themes: ['office'],
    placement: 'center',
    frequency: 0.2,
    maxPerRoom: 3,
    meshType: 'box',
    size: { w: 0.6, h: 0.5, d: 0.6 },
    yOffset: 0,
    color: '#333333',
    stroke: '#1a1a1a',
  },
  {
    id: 'cubicle-wall',
    themes: ['office'],
    placement: 'near-wall',
    frequency: 0.15,
    maxPerRoom: 2,
    meshType: 'box',
    size: { w: 2.0, h: 1.6, d: 0.15 },
    yOffset: 0,
    color: '#b0a898',
    stroke: '#888888',
    drawFace(ctx, w, h) {
      // Fabric texture lines
      ctx.strokeStyle = '#9a9080';
      ctx.lineWidth = 1;
      for (let y = 0; y < h; y += 4) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      // Metal trim at top
      ctx.fillStyle = '#aaaaaa';
      ctx.fillRect(0, 0, w, h * 0.05);
    },
  },
  {
    id: 'server-rack',
    themes: ['office'],
    placement: 'near-wall',
    frequency: 0.12,
    maxPerRoom: 1,
    meshType: 'box',
    size: { w: 0.8, h: 2.2, d: 0.8 },
    yOffset: 0,
    color: '#2a2a2a',
    stroke: '#111111',
    drawFace(ctx, w, h) {
      // Blinking LEDs
      const colors = ['#00ff00', '#00cc00', '#ff8800', '#00ff00'];
      for (let i = 0; i < 6; i++) {
        const y = h * 0.1 + i * (h * 0.13);
        ctx.fillStyle = '#444444';
        ctx.fillRect(w * 0.1, y, w * 0.8, h * 0.08);
        // LED dots
        for (let j = 0; j < 3; j++) {
          ctx.fillStyle = colors[(i + j) % colors.length];
          ctx.beginPath();
          ctx.arc(w * 0.2 + j * w * 0.25, y + h * 0.04, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    },
  },
  {
    id: 'water-cooler',
    themes: ['office'],
    placement: 'corner',
    frequency: 0.15,
    maxPerRoom: 1,
    meshType: 'cylinder',
    size: { w: 0.5, h: 1.2, d: 0.5 },
    yOffset: 0,
    color: '#ddddee',
    stroke: '#888888',
    drawFace(ctx, w, h) {
      // Water jug (blue tint)
      ctx.fillStyle = '#aaccee';
      ctx.fillRect(w * 0.25, h * 0.05, w * 0.5, h * 0.4);
      // Spout area
      ctx.fillStyle = '#cccccc';
      ctx.fillRect(w * 0.3, h * 0.5, w * 0.4, h * 0.1);
    },
  },
  {
    id: 'filing-cabinet',
    themes: ['office'],
    placement: 'near-wall',
    frequency: 0.2,
    maxPerRoom: 2,
    meshType: 'box',
    size: { w: 0.6, h: 1.4, d: 0.5 },
    yOffset: 0,
    color: '#888888',
    stroke: '#555555',
    drawFace(ctx, w, h) {
      // Drawer lines
      ctx.strokeStyle = '#666666';
      ctx.lineWidth = 2;
      for (let i = 1; i <= 3; i++) {
        const y = (i / 4) * h;
        ctx.beginPath();
        ctx.moveTo(w * 0.1, y);
        ctx.lineTo(w * 0.9, y);
        ctx.stroke();
        // Drawer handle
        ctx.fillStyle = '#aaaaaa';
        ctx.fillRect(w * 0.4, y - h * 0.04, w * 0.2, h * 0.03);
      }
    },
  },
  {
    id: 'potted-plant',
    themes: ['office'],
    placement: 'corner',
    frequency: 0.2,
    maxPerRoom: 1,
    meshType: 'cylinder',
    size: { w: 0.5, h: 1.0, d: 0.5 },
    yOffset: 0,
    color: '#664422',
    stroke: '#1a1a1a',
    drawFace(ctx, w, h) {
      // Leaves
      ctx.fillStyle = '#339933';
      const cx = w / 2;
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2;
        const lx = cx + Math.cos(angle) * w * 0.25;
        const ly = h * 0.15 + Math.sin(angle) * h * 0.12;
        ctx.beginPath();
        ctx.ellipse(lx, ly, w * 0.18, h * 0.12, angle, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  },
  {
    id: 'whiteboard',
    themes: ['office'],
    placement: 'wall-mounted',
    frequency: 0.15,
    maxPerRoom: 1,
    meshType: 'plane',
    size: { w: 2.0, h: 1.2, d: 0.05 },
    yOffset: 1.5,
    color: '#f0f0f0',
    stroke: '#888888',
    drawFace(ctx, w, h) {
      // Scribbles
      ctx.strokeStyle = '#3366cc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w * 0.1, h * 0.3);
      ctx.quadraticCurveTo(w * 0.3, h * 0.1, w * 0.5, h * 0.3);
      ctx.stroke();
      ctx.strokeStyle = '#cc3333';
      ctx.beginPath();
      ctx.moveTo(w * 0.1, h * 0.6);
      ctx.lineTo(w * 0.8, h * 0.6);
      ctx.stroke();
      // Marker tray
      ctx.fillStyle = '#cccccc';
      ctx.fillRect(w * 0.1, h * 0.88, w * 0.8, h * 0.08);
    },
  },
  {
    id: 'ceiling-light-panel',
    themes: ['office'],
    placement: 'ceiling',
    frequency: 0.3,
    maxPerRoom: 2,
    meshType: 'plane',
    size: { w: 1.5, h: 0.4, d: 0.4 },
    yOffset: 0,
    color: '#eeeeff',
    stroke: '#cccccc',
    emissive: true,
  },
];

// ─── Dungeon catalog ───────────────────────────────────────────────

const dungeonFurniture = [
  {
    id: 'barrel',
    themes: ['dungeon'],
    placement: 'near-wall',
    frequency: 0.2,
    maxPerRoom: 3,
    meshType: 'cylinder',
    size: { w: 0.7, h: 1.0, d: 0.7 },
    yOffset: 0,
    color: '#8B6914',
    stroke: '#1a1a1a',
    drawFace(ctx, w, h) {
      // Metal bands
      ctx.strokeStyle = '#555555';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, h * 0.2);
      ctx.lineTo(w, h * 0.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, h * 0.8);
      ctx.lineTo(w, h * 0.8);
      ctx.stroke();
    },
  },
  {
    id: 'crate',
    themes: ['dungeon'],
    placement: 'near-wall',
    frequency: 0.2,
    maxPerRoom: 3,
    meshType: 'box',
    size: { w: 0.8, h: 0.8, d: 0.8 },
    yOffset: 0,
    color: '#9B7B3C',
    stroke: '#1a1a1a',
    drawFace(ctx, w, h) {
      // Wood planks
      ctx.strokeStyle = '#7a6020';
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(0, (i / 4) * h);
        ctx.lineTo(w, (i / 4) * h);
        ctx.stroke();
      }
      // Cross brace
      ctx.strokeStyle = '#665020';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w * 0.1, h * 0.1);
      ctx.lineTo(w * 0.9, h * 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(w * 0.9, h * 0.1);
      ctx.lineTo(w * 0.1, h * 0.9);
      ctx.stroke();
    },
  },
  {
    id: 'table',
    themes: ['dungeon'],
    placement: 'center',
    frequency: 0.15,
    maxPerRoom: 1,
    meshType: 'box',
    size: { w: 1.6, h: 0.75, d: 0.9 },
    yOffset: 0,
    color: '#7B5B3A',
    stroke: '#1a1a1a',
    drawFace(ctx, w, h) {
      // Mug
      ctx.fillStyle = '#aa8866';
      ctx.fillRect(w * 0.7, h * 0.1, w * 0.12, h * 0.15);
    },
  },
  {
    id: 'stool',
    themes: ['dungeon'],
    placement: 'center',
    frequency: 0.15,
    maxPerRoom: 2,
    meshType: 'cylinder',
    size: { w: 0.45, h: 0.5, d: 0.45 },
    yOffset: 0,
    color: '#7B5B3A',
    stroke: '#1a1a1a',
  },
  {
    id: 'weapon-rack',
    themes: ['dungeon'],
    placement: 'near-wall',
    frequency: 0.12,
    maxPerRoom: 1,
    meshType: 'box',
    size: { w: 1.5, h: 2.0, d: 0.4 },
    yOffset: 0,
    color: '#5a4a32',
    stroke: '#1a1a1a',
    drawFace(ctx, w, h) {
      // Weapon silhouettes
      ctx.fillStyle = '#888888';
      // Sword
      ctx.fillRect(w * 0.15, h * 0.1, w * 0.04, h * 0.6);
      // Axe head
      ctx.fillRect(w * 0.4, h * 0.1, w * 0.04, h * 0.5);
      ctx.fillRect(w * 0.35, h * 0.1, w * 0.15, h * 0.15);
      // Spear
      ctx.fillRect(w * 0.7, h * 0.05, w * 0.03, h * 0.7);
    },
  },
  {
    id: 'chains',
    themes: ['dungeon'],
    placement: 'wall-mounted',
    frequency: 0.12,
    maxPerRoom: 1,
    meshType: 'plane',
    size: { w: 0.6, h: 1.5, d: 0.05 },
    yOffset: 1.8,
    color: '#666666',
    stroke: '#333333',
    drawFace(ctx, w, h) {
      ctx.strokeStyle = '#888888';
      ctx.lineWidth = 3;
      // Chain links
      for (let i = 0; i < 6; i++) {
        const y = h * 0.1 + i * (h * 0.14);
        const x = w * 0.35 + (i % 2) * w * 0.1;
        ctx.beginPath();
        ctx.ellipse(x, y, w * 0.08, h * 0.06, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Shackle
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.88, w * 0.15, 0, Math.PI);
      ctx.stroke();
    },
  },
  {
    id: 'carpet',
    themes: ['dungeon'],
    placement: 'floor',
    frequency: 0.1,
    maxPerRoom: 1,
    meshType: 'plane',
    size: { w: 2.5, h: 1.8, d: 0.01 },
    yOffset: 0.01,
    color: '#882222',
    stroke: '#661111',
    drawFace(ctx, w, h) {
      // Border pattern
      ctx.strokeStyle = '#cc9944';
      ctx.lineWidth = 3;
      ctx.strokeRect(w * 0.08, h * 0.08, w * 0.84, h * 0.84);
      ctx.strokeStyle = '#aa7733';
      ctx.lineWidth = 1;
      ctx.strokeRect(w * 0.14, h * 0.14, w * 0.72, h * 0.72);
    },
  },
  {
    id: 'bone-pile',
    themes: ['dungeon'],
    placement: 'corner',
    frequency: 0.15,
    maxPerRoom: 1,
    meshType: 'box',
    size: { w: 0.8, h: 0.3, d: 0.6 },
    yOffset: 0,
    color: '#ccbb99',
    stroke: '#1a1a1a',
    drawFace(ctx, w, h) {
      // Bone shapes
      ctx.fillStyle = '#ddd0b8';
      ctx.fillRect(w * 0.1, h * 0.4, w * 0.5, h * 0.15);
      ctx.fillRect(w * 0.3, h * 0.2, w * 0.4, h * 0.12);
      // Skull
      ctx.beginPath();
      ctx.arc(w * 0.7, h * 0.35, w * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.arc(w * 0.66, h * 0.32, 2, 0, Math.PI * 2);
      ctx.arc(w * 0.74, h * 0.32, 2, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  {
    id: 'bookshelf',
    themes: ['dungeon'],
    placement: 'near-wall',
    frequency: 0.12,
    maxPerRoom: 1,
    meshType: 'box',
    size: { w: 1.4, h: 2.2, d: 0.5 },
    yOffset: 0,
    color: '#5a4a32',
    stroke: '#1a1a1a',
    drawFace(ctx, w, h) {
      // Shelves
      ctx.fillStyle = '#4a3a22';
      for (let i = 1; i <= 4; i++) {
        ctx.fillRect(0, (i / 5) * h - 2, w, 4);
      }
      // Books
      const bookColors = ['#cc3333', '#3333cc', '#33aa33', '#ccaa33', '#884488'];
      for (let shelf = 0; shelf < 4; shelf++) {
        const sy = (shelf / 5) * h + 4;
        const sh = h / 5 - 8;
        let bx = w * 0.05;
        while (bx < w * 0.9) {
          const bw = 4 + Math.random() * 6;
          ctx.fillStyle = bookColors[Math.floor(Math.random() * bookColors.length)];
          ctx.fillRect(bx, sy, bw, sh * (0.7 + Math.random() * 0.3));
          bx += bw + 1;
        }
      }
    },
  },
  {
    id: 'candelabra',
    themes: ['dungeon'],
    placement: 'center',
    frequency: 0.1,
    maxPerRoom: 1,
    meshType: 'cylinder',
    size: { w: 0.3, h: 1.4, d: 0.3 },
    yOffset: 0,
    color: '#aa8844',
    stroke: '#1a1a1a',
    drawFace(ctx, w, h) {
      // Candle tops
      ctx.fillStyle = '#ffeeaa';
      ctx.fillRect(w * 0.3, h * 0.02, w * 0.15, h * 0.12);
      ctx.fillRect(w * 0.55, h * 0.02, w * 0.15, h * 0.12);
      // Flame dots
      ctx.fillStyle = '#ffaa33';
      ctx.beginPath();
      ctx.arc(w * 0.375, h * 0.02, 3, 0, Math.PI * 2);
      ctx.arc(w * 0.625, h * 0.02, 3, 0, Math.PI * 2);
      ctx.fill();
    },
  },
];

// ─── API ───────────────────────────────────────────────────────────

const allFurniture = [...officeFurniture, ...dungeonFurniture];

/**
 * Return the furniture definitions for a given theme key.
 * @param {string} themeKey — 'office' | 'dungeon'
 */
export function getFurnitureForTheme(themeKey) {
  const key = themeKey.toLowerCase();
  return allFurniture.filter(f => f.themes.includes(key));
}
