import * as THREE from 'three';

const TEX_SIZE = 256;

// Seeded random for consistent textures
function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Wobbly line for hand-drawn feel
function wobblyLine(ctx, x1, y1, x2, y2, jitter = 1.5) {
  const steps = Math.max(4, Math.floor(Math.hypot(x2 - x1, y2 - y1) / 6));
  ctx.beginPath();
  ctx.moveTo(x1 + (Math.random() - 0.5) * jitter, y1 + (Math.random() - 0.5) * jitter);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t + (Math.random() - 0.5) * jitter;
    const y = y1 + (y2 - y1) * t + (Math.random() - 0.5) * jitter;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// Cross-hatching for shading areas
function crossHatch(ctx, x, y, w, h, density = 0.3, angle = Math.PI / 4) {
  if (Math.random() > density) return;
  ctx.save();
  ctx.globalAlpha = 0.1 + Math.random() * 0.15;
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 0.5;
  const spacing = 6 + Math.random() * 4;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const diag = Math.hypot(w, h);

  for (let d = -diag; d < diag; d += spacing) {
    const lx1 = x + w / 2 + cos * d - sin * diag;
    const ly1 = y + h / 2 + sin * d + cos * diag;
    const lx2 = x + w / 2 + cos * d + sin * diag;
    const ly2 = y + h / 2 + sin * d - cos * diag;
    wobblyLine(ctx, lx1, ly1, lx2, ly2, 0.8);
  }
  ctx.restore();
}

export function createWallTexture(seed = 0, theme = null) {
  const base = theme ? theme.wall.base : '#f8f4f0';
  const stroke = theme ? theme.wall.stroke : '#1a1a1a';
  const style = theme ? theme.wall.style : 'brick';

  const canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d');
  const rng = seededRandom(seed + 1);

  // Base fill
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Grain noise
  for (let i = 0; i < 800; i++) {
    const gx = rng() * TEX_SIZE;
    const gy = rng() * TEX_SIZE;
    ctx.fillStyle = `rgba(0,0,0,${rng() * 0.06})`;
    ctx.fillRect(gx, gy, 1 + rng() * 2, 1 + rng() * 2);
  }

  ctx.strokeStyle = stroke;

  if (style === 'panels') {
    // Office panels — vertical rectangular panels with horizontal divider
    ctx.lineWidth = 1;
    const panelW = 80 + Math.floor(rng() * 20);
    const panelCols = Math.ceil(TEX_SIZE / panelW) + 1;

    // Horizontal divider at mid-height
    const midY = TEX_SIZE * 0.45 + rng() * TEX_SIZE * 0.1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(TEX_SIZE, midY);
    ctx.stroke();

    // Vertical panel dividers (straight lines, not wobbly)
    for (let col = 0; col <= panelCols; col++) {
      const x = col * panelW;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, TEX_SIZE);
      ctx.stroke();
    }

    // Subtle grain per panel (not cracks)
    ctx.globalAlpha = 0.03;
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = stroke;
      const gx = rng() * TEX_SIZE;
      const gy = rng() * TEX_SIZE;
      ctx.fillRect(gx, gy, 1 + rng() * 3, 1);
    }
    ctx.globalAlpha = 1;
  } else {
    // Brick pattern (dungeon default)
    ctx.lineWidth = 1.2;
    const brickH = 28 + Math.floor(rng() * 8);
    const brickW = 50 + Math.floor(rng() * 16);
    const rows = Math.ceil(TEX_SIZE / brickH) + 1;

    for (let row = 0; row < rows; row++) {
      const y = row * brickH;
      const offset = (row % 2) * brickW * 0.5;

      wobblyLine(ctx, 0, y, TEX_SIZE, y, 1.5);

      const cols = Math.ceil(TEX_SIZE / brickW) + 2;
      for (let col = 0; col < cols; col++) {
        const x = col * brickW + offset;
        wobblyLine(ctx, x, y, x, y + brickH, 1.5);
      }

      for (let col = 0; col < cols; col++) {
        const bx = col * brickW + offset;
        if (rng() < 0.15) {
          ctx.lineWidth = 0.6;
          ctx.globalAlpha = 0.4;
          const cx = bx + rng() * brickW;
          const cy = y + rng() * brickH;
          wobblyLine(ctx, cx, cy, cx + (rng() - 0.5) * 20, cy + (rng() - 0.5) * 15, 2);
          ctx.globalAlpha = 1;
          ctx.lineWidth = 1.2;
        }
        if (rng() < 0.08) {
          crossHatch(ctx, bx + 2, y + 2, brickW - 4, brickH - 4, 1, Math.PI / 4 + rng() * 0.3);
        }
      }
    }
  }

  // Border/outline emphasis
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, TEX_SIZE - 2, TEX_SIZE - 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

export function createFloorTexture(seed = 0, theme = null) {
  const base = theme ? theme.floor.base : '#ece6e0';
  const stroke = theme ? theme.floor.stroke : '#1a1a1a';
  const style = theme ? theme.floor.style : 'stone';

  const canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d');
  const rng = seededRandom(seed + 100);

  // Base fill
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  if (style === 'carpet') {
    // Office carpet — dense fine noise, no grid lines
    for (let i = 0; i < 2000; i++) {
      const gx = rng() * TEX_SIZE;
      const gy = rng() * TEX_SIZE;
      const bright = rng() * 0.08;
      ctx.fillStyle = rng() < 0.5
        ? `rgba(0,0,0,${bright})`
        : `rgba(255,255,255,${bright * 0.5})`;
      ctx.fillRect(gx, gy, 1 + rng(), 1 + rng());
    }

    // Occasional subtle stain
    if (rng() < 0.4) {
      ctx.globalAlpha = 0.04;
      ctx.fillStyle = stroke;
      const sx = rng() * TEX_SIZE;
      const sy = rng() * TEX_SIZE;
      ctx.beginPath();
      ctx.arc(sx, sy, 15 + rng() * 25, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  } else {
    // Stone tile grid (dungeon default)
    for (let i = 0; i < 600; i++) {
      ctx.fillStyle = `rgba(0,0,0,${rng() * 0.04})`;
      ctx.fillRect(rng() * TEX_SIZE, rng() * TEX_SIZE, 1 + rng() * 2, 1);
    }

    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    const tileSize = 60 + Math.floor(rng() * 20);
    const cols = Math.ceil(TEX_SIZE / tileSize) + 1;

    for (let row = 0; row <= cols; row++) {
      const y = row * tileSize;
      wobblyLine(ctx, 0, y, TEX_SIZE, y, 2);
      for (let col = 0; col <= cols; col++) {
        const x = col * tileSize + (row % 2 ? tileSize * 0.3 : 0);
        wobblyLine(ctx, x, y, x, y + tileSize, 2);
      }
    }

    // Occasional cracks
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 3; i++) {
      if (rng() < 0.5) {
        const sx = rng() * TEX_SIZE;
        const sy = rng() * TEX_SIZE;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        let cx = sx, cy = sy;
        const steps = 3 + Math.floor(rng() * 5);
        for (let s = 0; s < steps; s++) {
          cx += (rng() - 0.5) * 30;
          cy += (rng() - 0.5) * 30;
          ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createCeilingTexture(seed = 0, theme = null) {
  const base = theme ? theme.ceiling.base : '#e0d8d0';
  const stroke = theme ? theme.ceiling.stroke : '#1a1a1a';
  const style = theme ? theme.ceiling.style : 'beams';

  const canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d');
  const rng = seededRandom(seed + 200);

  // Base fill
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // Grain
  for (let i = 0; i < 500; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rng() * 0.05})`;
    ctx.fillRect(rng() * TEX_SIZE, rng() * TEX_SIZE, 1 + rng() * 3, 1);
  }

  if (style === 'tiles') {
    // Office drop ceiling tiles — regular grid, clean straight lines
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    const tileSize = 128;
    const cols = Math.ceil(TEX_SIZE / tileSize) + 1;

    for (let row = 0; row <= cols; row++) {
      const y = row * tileSize;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(TEX_SIZE, y);
      ctx.stroke();
    }
    for (let col = 0; col <= cols; col++) {
      const x = col * tileSize;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, TEX_SIZE);
      ctx.stroke();
    }

    // Small dots for acoustic tile texture
    ctx.fillStyle = stroke;
    ctx.globalAlpha = 0.08;
    for (let i = 0; i < 600; i++) {
      const dx = rng() * TEX_SIZE;
      const dy = rng() * TEX_SIZE;
      ctx.beginPath();
      ctx.arc(dx, dy, 0.5 + rng() * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else {
    // Beams (dungeon default) — cross-hatch + beam lines
    crossHatch(ctx, 0, 0, TEX_SIZE, TEX_SIZE, 1, Math.PI / 4);

    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.25;
    const beamCount = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < beamCount; i++) {
      const y = (i + 1) * TEX_SIZE / (beamCount + 1);
      wobblyLine(ctx, 0, y, TEX_SIZE, y, 3);
    }
    ctx.globalAlpha = 1;
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function createSpiderWebTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  // Transparent base
  ctx.clearRect(0, 0, 128, 128);

  // Web from top-left corner
  ctx.strokeStyle = 'rgba(200, 200, 200, 0.7)';
  ctx.lineWidth = 0.8;

  // Radial threads
  const cx = 4, cy = 4;
  const angles = [0, 0.3, 0.6, 0.9, 1.2, 1.57];
  const maxR = 100;

  for (const a of angles) {
    const ex = cx + Math.cos(a) * maxR;
    const ey = cy + Math.sin(a) * maxR;
    wobblyLine(ctx, cx, cy, ex, ey, 1);
  }

  // Spiral rings
  for (let r = 20; r < maxR; r += 18 + Math.random() * 10) {
    ctx.beginPath();
    for (let ai = 0; ai < angles.length - 1; ai++) {
      const a1 = angles[ai], a2 = angles[ai + 1];
      const x1 = cx + Math.cos(a1) * r + (Math.random() - 0.5) * 2;
      const y1 = cy + Math.sin(a1) * r + (Math.random() - 0.5) * 2;
      const x2 = cx + Math.cos(a2) * r + (Math.random() - 0.5) * 2;
      const y2 = cy + Math.sin(a2) * r + (Math.random() - 0.5) * 2;
      if (ai === 0) ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(
        (x1 + x2) / 2 + (Math.random() - 0.5) * 4,
        (y1 + y2) / 2 + (Math.random() - 0.5) * 4,
        x2, y2
      );
    }
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

export function createTorchTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 64, 128);

  // Handle
  ctx.fillStyle = '#4a3828';
  ctx.fillRect(28, 50, 8, 70);
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(28, 50, 8, 70);

  // Bracket
  ctx.fillStyle = '#555';
  ctx.fillRect(22, 48, 20, 6);
  ctx.strokeRect(22, 48, 20, 6);

  // Flame glow
  const gradient = ctx.createRadialGradient(32, 35, 2, 32, 35, 22);
  gradient.addColorStop(0, 'rgba(255, 230, 150, 0.9)');
  gradient.addColorStop(0.4, 'rgba(255, 180, 60, 0.6)');
  gradient.addColorStop(1, 'rgba(255, 120, 20, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(5, 10, 54, 50);

  // Flame shape
  ctx.fillStyle = '#ffcc44';
  ctx.beginPath();
  ctx.moveTo(32, 12);
  ctx.quadraticCurveTo(42, 25, 38, 42);
  ctx.quadraticCurveTo(32, 48, 26, 42);
  ctx.quadraticCurveTo(22, 25, 32, 12);
  ctx.fill();

  // Inner flame
  ctx.fillStyle = '#fff8e0';
  ctx.beginPath();
  ctx.moveTo(32, 20);
  ctx.quadraticCurveTo(37, 28, 35, 38);
  ctx.quadraticCurveTo(32, 42, 29, 38);
  ctx.quadraticCurveTo(27, 28, 32, 20);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  return tex;
}
