import * as THREE from 'three';
import { DUNGEON, CAMERA } from '../core/Constants.js';

export class SpriteRenderer {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.sprites = new Map(); // key -> sprite mesh
    this.animations = []; // active animations
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    // Click/tap handler
    this._onClick = this._onClick.bind(this);
    window.addEventListener('pointerdown', this._onClick);
  }

  createSprite(key, config) {
    const { x, z, color = 0xffffff, width = 1.6, height = 2.4, symbol = '?' } = config;

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 192;
    const ctx = canvas.getContext('2d');
    this._drawCharacter(ctx, canvas.width, canvas.height, color, symbol);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.1,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(width, height, 1);
    sprite.position.set(
      x * DUNGEON.CELL_SIZE,
      height / 2,
      z * DUNGEON.CELL_SIZE
    );

    sprite.userData = { gridX: x, gridZ: z, key, clickable: false, onClick: null };
    this.scene.add(sprite);
    this.sprites.set(key, sprite);
    return sprite;
  }

  createLootBag(key, x, z) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    this._drawLootBag(ctx, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.1,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0, 0, 1); // start at 0 for spawn animation
    sprite.position.set(
      x * DUNGEON.CELL_SIZE,
      1.0,
      z * DUNGEON.CELL_SIZE
    );
    sprite.userData = { gridX: x, gridZ: z, key, clickable: true, onClick: null };

    this.scene.add(sprite);
    this.sprites.set(key, sprite);

    // Spawn bounce-in animation
    this._animate(sprite, {
      duration: 400,
      from: { sx: 0, sy: 0, y: 2.5 },
      to: { sx: 1.8, sy: 1.8, y: 1.0 },
      easing: 'bounceOut',
    });

    return sprite;
  }

  createPuffEffect(x, z) {
    // Multiple small particles spreading out and fading
    const count = 8;
    const particles = [];
    for (let i = 0; i < count; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(16, 16, 12 + Math.random() * 4, 0, Math.PI * 2);
      ctx.fill();

      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 1 });
      const sprite = new THREE.Sprite(material);
      const size = 0.3 + Math.random() * 0.5;
      sprite.scale.set(size, size, 1);
      sprite.position.set(
        x * DUNGEON.CELL_SIZE,
        1.0,
        z * DUNGEON.CELL_SIZE
      );
      this.scene.add(sprite);
      particles.push(sprite);

      // Animate outward and fade
      const angle = (i / count) * Math.PI * 2;
      const dist = 1.0 + Math.random() * 0.8;
      const targetX = sprite.position.x + Math.cos(angle) * dist;
      const targetZ = sprite.position.z + Math.sin(angle) * dist;
      const targetY = 1.0 + Math.random() * 1.5;

      this._animate(sprite, {
        duration: 500 + Math.random() * 200,
        from: {
          x: sprite.position.x, y: sprite.position.y, z: sprite.position.z,
          sx: size, sy: size, opacity: 1,
        },
        to: {
          x: targetX, y: targetY, z: targetZ,
          sx: size * 2, sy: size * 2, opacity: 0,
        },
        easing: 'easeOut',
        onComplete: () => {
          this.scene.remove(sprite);
          material.dispose();
          texture.dispose();
        },
      });
    }
  }

  animateLootPickup(key, onComplete) {
    const sprite = this.sprites.get(key);
    if (!sprite) { onComplete?.(); return; }

    // Squish down
    this._animate(sprite, {
      duration: 150,
      from: { sx: 1.8, sy: 1.8 },
      to: { sx: 2.2, sy: 1.2 },
      easing: 'easeIn',
      onComplete: () => {
        // Bounce up
        this._animate(sprite, {
          duration: 200,
          from: { sx: 2.2, sy: 1.2 },
          to: { sx: 1.4, sy: 2.4, y: 2.0 },
          easing: 'easeOut',
          onComplete: () => {
            // Shrink and vanish
            this._animate(sprite, {
              duration: 200,
              from: { sx: 1.4, sy: 2.4, opacity: 1 },
              to: { sx: 0, sy: 0, opacity: 0 },
              easing: 'easeIn',
              onComplete: () => {
                // Puff!
                this.createPuffEffect(sprite.userData.gridX, sprite.userData.gridZ);
                this.removeSprite(key);
                onComplete?.();
              },
            });
          },
        });
      },
    });
  }

  _drawCharacter(ctx, w, h, color, symbol) {
    const colorStr = '#' + color.toString(16).padStart(6, '0');

    ctx.fillStyle = colorStr;
    ctx.beginPath();
    const bx = w * 0.2, by = h * 0.25, bw = w * 0.6, bh = h * 0.65;
    ctx.roundRect(bx, by, bw, bh, 10);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(w / 2, h * 0.2, w * 0.22, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(w * 0.4, h * 0.17, 4, 0, Math.PI * 2);
    ctx.arc(w * 0.6, h * 0.17, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#000';
    ctx.font = 'bold 32px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(symbol, w / 2, h * 0.55);
  }

  _drawLootBag(ctx, w, h) {
    // Bag body
    ctx.fillStyle = '#c8a050';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(w * 0.2, h * 0.35);
    ctx.quadraticCurveTo(w * 0.1, h * 0.9, w * 0.3, h * 0.92);
    ctx.lineTo(w * 0.7, h * 0.92);
    ctx.quadraticCurveTo(w * 0.9, h * 0.9, w * 0.8, h * 0.35);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Bag tie / neck
    ctx.fillStyle = '#a08030';
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.35, w * 0.32, h * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Tie knot
    ctx.fillStyle = '#886020';
    ctx.beginPath();
    ctx.moveTo(w * 0.38, h * 0.18);
    ctx.quadraticCurveTo(w * 0.5, h * 0.38, w * 0.62, h * 0.18);
    ctx.quadraticCurveTo(w * 0.5, h * 0.28, w * 0.38, h * 0.18);
    ctx.fill();
    ctx.stroke();

    // Dollar sign
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', w / 2, h * 0.65);

    // Highlight
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.beginPath();
    ctx.ellipse(w * 0.38, h * 0.55, w * 0.1, h * 0.15, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- CLICK DETECTION ----

  _onClick(event) {
    this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);

    const clickables = [];
    for (const [, sprite] of this.sprites) {
      if (sprite.userData.clickable && sprite.userData.onClick) {
        clickables.push(sprite);
      }
    }

    const intersects = this.raycaster.intersectObjects(clickables);
    if (intersects.length > 0) {
      const hit = intersects[0].object;
      hit.userData.onClick(hit);
    }
  }

  // ---- ANIMATION SYSTEM ----

  _animate(sprite, opts) {
    const anim = {
      sprite,
      duration: opts.duration,
      elapsed: 0,
      from: { ...opts.from },
      to: { ...opts.to },
      easing: opts.easing || 'linear',
      onComplete: opts.onComplete || null,
    };
    this.animations.push(anim);
  }

  update(dt) {
    for (let i = this.animations.length - 1; i >= 0; i--) {
      const a = this.animations[i];
      a.elapsed += dt || 16;
      let t = Math.min(1, a.elapsed / a.duration);

      // Apply easing
      if (a.easing === 'easeOut') t = 1 - Math.pow(1 - t, 3);
      else if (a.easing === 'easeIn') t = t * t * t;
      else if (a.easing === 'bounceOut') {
        if (t < 0.5) t = 4 * t * t * t;
        else t = 1 - Math.pow(-2 * t + 2, 3) / 2;
        // Extra bounce
        if (t > 0.8) t = 1 + Math.sin((t - 0.8) * Math.PI * 5) * 0.05 * (1 - t) * 5;
      }

      const lerp = (from, to) => from + (to - from) * t;

      if ('sx' in a.from && 'sx' in a.to) a.sprite.scale.x = lerp(a.from.sx, a.to.sx);
      if ('sy' in a.from && 'sy' in a.to) a.sprite.scale.y = lerp(a.from.sy, a.to.sy);
      if ('x' in a.from && 'x' in a.to) a.sprite.position.x = lerp(a.from.x, a.to.x);
      if ('y' in a.from && 'y' in a.to) a.sprite.position.y = lerp(a.from.y, a.to.y);
      if ('z' in a.from && 'z' in a.to) a.sprite.position.z = lerp(a.from.z, a.to.z);
      if ('opacity' in a.from && 'opacity' in a.to) {
        a.sprite.material.opacity = lerp(a.from.opacity, a.to.opacity);
      }

      if (t >= 1) {
        this.animations.splice(i, 1);
        a.onComplete?.();
      }
    }
  }

  removeSprite(key) {
    const sprite = this.sprites.get(key);
    if (sprite) {
      // Remove any pending animations for this sprite
      this.animations = this.animations.filter(a => a.sprite !== sprite);
      this.scene.remove(sprite);
      if (sprite.material.map) sprite.material.map.dispose();
      sprite.material.dispose();
      this.sprites.delete(key);
    }
  }

  getSpriteAtGrid(gx, gz) {
    for (const [key, sprite] of this.sprites) {
      if (sprite.userData.gridX === gx && sprite.userData.gridZ === gz) {
        return { key, sprite };
      }
    }
    return null;
  }

  dispose() {
    for (const [key] of this.sprites) {
      this.removeSprite(key);
    }
    this.animations = [];
  }

  destroy() {
    this.dispose();
    window.removeEventListener('pointerdown', this._onClick);
  }
}
