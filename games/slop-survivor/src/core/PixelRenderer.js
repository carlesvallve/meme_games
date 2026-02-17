/**
 * Renders a 2D pixel matrix to a Phaser texture.
 *
 * @param {Phaser.Scene} scene - The scene to register the texture on
 * @param {number[][]} pixels - 2D array of palette indices (0 = transparent)
 * @param {(number|null)[]} palette - Array of hex colors indexed by pixel value
 * @param {string} key - Texture key to register
 * @param {number} scale - Pixel scale (2 = each pixel becomes 2x2)
 */
export function renderPixelArt(scene, pixels, palette, key, scale = 2) {
  if (scene.textures.exists(key)) return;

  const h = pixels.length;
  const w = pixels[0].length;
  const texW = w * scale;
  const texH = h * scale;

  // Use Phaser's createCanvas to avoid high-DPI canvas scaling issues
  const canvasTex = scene.textures.createCanvas(key, texW, texH);
  const ctx = canvasTex.getContext();

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = pixels[y][x];
      if (idx === 0 || palette[idx] == null) continue;
      const color = palette[idx];
      const r = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const b = color & 0xff;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }

  canvasTex.refresh();
}

/**
 * Renders multiple frames as a spritesheet texture.
 * Frames are laid out horizontally in a single row.
 * Uses addCanvas and manually creates frame data for spritesheet behavior.
 *
 * @param {Phaser.Scene} scene
 * @param {number[][][]} frames - Array of pixel matrices (one per frame)
 * @param {(number|null)[]} palette
 * @param {string} key - Spritesheet texture key
 * @param {number} scale
 */
export function renderSpriteSheet(scene, frames, palette, key, scale = 2) {
  if (scene.textures.exists(key)) return;

  const h = frames[0].length;
  const w = frames[0][0].length;
  const frameW = w * scale;
  const frameH = h * scale;
  const totalW = frameW * frames.length;

  // Use Phaser's createCanvas to avoid high-DPI canvas scaling issues
  const canvasTex = scene.textures.createCanvas(key, totalW, frameH);
  const ctx = canvasTex.getContext();

  frames.forEach((pixels, fi) => {
    const offsetX = fi * frameW;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = pixels[y][x];
        if (idx === 0 || palette[idx] == null) continue;
        const color = palette[idx];
        const r = (color >> 16) & 0xff;
        const g = (color >> 8) & 0xff;
        const b = color & 0xff;
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(offsetX + x * scale, y * scale, scale, scale);
      }
    }
  });

  canvasTex.refresh();

  // Add individual frames for spritesheet behavior
  const tex = scene.textures.get(key);
  for (let i = 0; i < frames.length; i++) {
    tex.add(i, 0, i * frameW, 0, frameW, frameH);
  }
}
