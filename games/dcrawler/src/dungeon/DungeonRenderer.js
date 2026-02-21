import * as THREE from 'three';
import { DUNGEON, CELL, COLORS, CAMERA } from '../core/Constants.js';
import {
  createWallTexture,
  createFloorTexture,
  createCeilingTexture,
  createSpiderWebTexture,
  createTorchTexture,
} from './TextureGenerator.js';
import { FurnitureRenderer } from './FurnitureRenderer.js';

export class DungeonRenderer {
  constructor(scene) {
    this.scene = scene;
    this.dungeonGroup = new THREE.Group();
    this.scene.add(this.dungeonGroup);
    this.torchLights = [];
    this.torchSprites = [];
    this._torchTime = 0;
    this._theme = null;

    // Texture caches (regenerated per theme)
    this._wallTextures = [];
    this._floorTextures = [];
    this._ceilingTextures = [];
    this._spiderWebTexture = createSpiderWebTexture();
    this._torchTexture = createTorchTexture();

    // Furniture renderer
    this.furnitureRenderer = new FurnitureRenderer(this.dungeonGroup);

    // Shared geometries
    this.wallGeo = new THREE.BoxGeometry(DUNGEON.CELL_SIZE, DUNGEON.CELL_SIZE, DUNGEON.CELL_SIZE);
    this.floorGeo = new THREE.PlaneGeometry(DUNGEON.CELL_SIZE, DUNGEON.CELL_SIZE);
    this.webGeo = new THREE.PlaneGeometry(1.5, 1.5);
  }

  _generateTextures(theme) {
    // Regenerate textures when theme changes
    if (this._theme === theme) return;
    this._theme = theme;

    // Dispose old textures
    [...this._wallTextures, ...this._floorTextures, ...this._ceilingTextures].forEach(t => t.dispose());

    this._wallTextures = [];
    this._floorTextures = [];
    this._ceilingTextures = [];
    for (let i = 0; i < 4; i++) {
      this._wallTextures.push(createWallTexture(i * 37, theme));
      this._floorTextures.push(createFloorTexture(i * 53, theme));
      this._ceilingTextures.push(createCeilingTexture(i * 71, theme));
    }
  }

  render(map, theme = null) {
    this._generateTextures(theme);

    // Clear previous
    this._clearGroup();
    this.torchLights.forEach(l => this.scene.remove(l));
    this.torchLights = [];
    this.torchSprites = [];

    const cs = DUNGEON.CELL_SIZE;

    for (let z = 0; z < map.height; z++) {
      for (let x = 0; x < map.width; x++) {
        const cell = map.getCell(x, z);
        const wx = x * cs;
        const wz = z * cs;
        const seed = x * 31 + z * 17;

        if (cell === CELL.WALL) {
          this._addWall(wx, wz, cs, seed);
          if (!theme || theme.decorations.spiderWebs) {
            this._maybeAddSpiderWeb(map, x, z, wx, wz, cs, seed);
          }
        } else if (cell >= CELL.FLOOR) {
          this._addFloor(wx, wz, cell, seed, theme);
          this._addCeiling(wx, wz, seed);
        }

        if (cell === CELL.TORCH) {
          // Torch on a wall — add floor too
          this._addFloor(wx, wz, CELL.FLOOR, seed, theme);
          this._addCeiling(wx, wz, seed);
          this._addTorch(map, x, z, wx, wz, cs, theme);
        }
      }
    }

    // Add edge outlines to give the comic look more punch
    this._addEdgeOutlines(map, cs, theme);

    // Place furniture in rooms
    this.furnitureRenderer.placeFurniture(map, theme);
  }

  _clearGroup() {
    this.furnitureRenderer.clear();
    while (this.dungeonGroup.children.length > 0) {
      const child = this.dungeonGroup.children[0];
      this.dungeonGroup.remove(child);
      if (child.geometry && child.geometry !== this.wallGeo &&
          child.geometry !== this.floorGeo && child.geometry !== this.webGeo) {
        child.geometry.dispose();
      }
    }
  }

  _addWall(wx, wz, cs, seed) {
    const texIdx = seed % this._wallTextures.length;
    const tex = this._wallTextures[texIdx];
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: 0xffffff,
      emissiveIntensity: 0.35,
      roughness: 0.9,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(this.wallGeo, mat);
    mesh.position.set(wx, cs / 2, wz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.dungeonGroup.add(mesh);
  }

  _addFloor(wx, wz, cellType, seed, theme) {
    const texIdx = seed % this._floorTextures.length;
    const accent = theme ? theme.accent : COLORS.ACCENT;
    let mat;
    if (cellType === CELL.STAIRS) {
      mat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.8 });
    } else {
      const tex = this._floorTextures[texIdx];
      mat = new THREE.MeshStandardMaterial({
        map: tex,
        emissiveMap: tex,
        emissive: 0xffffff,
        emissiveIntensity: 0.25,
        roughness: 0.95,
        metalness: 0,
      });
    }
    const floor = new THREE.Mesh(this.floorGeo, mat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(wx, 0, wz);
    floor.receiveShadow = true;
    this.dungeonGroup.add(floor);
  }

  _addCeiling(wx, wz, seed) {
    const texIdx = seed % this._ceilingTextures.length;
    const tex = this._ceilingTextures[texIdx];
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: 0xffffff,
      emissiveIntensity: 0.2,
      roughness: 1,
      metalness: 0,
    });
    const ceiling = new THREE.Mesh(this.floorGeo, mat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(wx, DUNGEON.CELL_SIZE, wz);
    this.dungeonGroup.add(ceiling);
  }

  _maybeAddSpiderWeb(map, gx, gz, wx, wz, cs, seed) {
    // Place webs in corners — where two walls meet at a floor cell
    if ((seed * 7) % 10 > 2) return; // ~30% chance

    // Check if this wall is adjacent to a floor corner
    const neighbors = [
      { dx: -1, dz: 0 }, { dx: 1, dz: 0 },
      { dx: 0, dz: -1 }, { dx: 0, dz: 1 },
    ];

    for (const n of neighbors) {
      const nx = gx + n.dx;
      const nz = gz + n.dz;
      if (map.getCell(nx, nz) >= CELL.FLOOR) {
        const webMat = new THREE.MeshBasicMaterial({
          map: this._spiderWebTexture,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
          opacity: 0.5,
        });
        const web = new THREE.Mesh(this.webGeo, webMat);

        // Position web at the junction between wall and floor cell, near ceiling
        web.position.set(
          wx + n.dx * cs * 0.48,
          cs * 0.85,
          wz + n.dz * cs * 0.48
        );

        // Face the web toward the floor cell
        if (n.dx !== 0) {
          web.rotation.y = Math.PI / 2;
        }

        this.dungeonGroup.add(web);
        return; // One web per wall block max
      }
    }
  }

  _addTorch(map, gx, gz, wx, wz, cs, theme) {
    const isOffice = theme && theme.name.toLowerCase() === 'office';

    if (isOffice) {
      this._addCeilingLight(wx, wz, cs, theme);
    } else {
      this._addFireTorch(map, gx, gz, wx, wz, cs, theme);
    }
  }

  _addCeilingLight(wx, wz, cs, theme) {
    // Fluorescent ceiling panel — emissive rectangle on ceiling
    const panelW = 1.5;
    const panelD = 0.4;
    const texSize = 128;
    const canvas = document.createElement('canvas');
    canvas.width = texSize;
    canvas.height = texSize;
    const ctx = canvas.getContext('2d');

    // White emissive panel with subtle grid lines
    ctx.fillStyle = '#eeeeff';
    ctx.fillRect(0, 0, texSize, texSize);
    ctx.strokeStyle = '#ccccdd';
    ctx.lineWidth = 1;
    ctx.strokeRect(4, 4, texSize - 8, texSize - 8);
    // Center divider
    ctx.beginPath();
    ctx.moveTo(texSize / 2, 4);
    ctx.lineTo(texSize / 2, texSize - 4);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(panelW, panelD);
    const mat = new THREE.MeshStandardMaterial({
      map: texture,
      emissive: 0xddddef,
      emissiveMap: texture,
      emissiveIntensity: 1.0,
      roughness: 0.3,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    const panel = new THREE.Mesh(geo, mat);
    panel.rotation.x = Math.PI / 2;
    panel.position.set(wx, cs - 0.05, wz);
    this.dungeonGroup.add(panel);

    // Cool-white point light from ceiling
    const torchColor = theme.torchLight || COLORS.TORCH_LIGHT;
    const light = new THREE.PointLight(torchColor, 0.9, cs * 4);
    light.position.set(wx, cs * 0.9, wz);
    light.castShadow = false;
    this.scene.add(light);
    this.torchLights.push(light);
  }

  _addFireTorch(map, gx, gz, wx, wz, cs, theme) {
    // Find which direction has a wall to mount the torch on
    const dirs = [
      { dx: 0, dz: -1, ry: 0 },
      { dx: 1, dz: 0, ry: -Math.PI / 2 },
      { dx: 0, dz: 1, ry: Math.PI },
      { dx: -1, dz: 0, ry: Math.PI / 2 },
    ];

    let mountDir = dirs[0];
    for (const d of dirs) {
      if (map.getCell(gx + d.dx, gz + d.dz) === CELL.WALL) {
        mountDir = d;
        break;
      }
    }

    // Torch sprite
    const torchMat = new THREE.SpriteMaterial({
      map: this._torchTexture,
      transparent: true,
    });
    const torchSprite = new THREE.Sprite(torchMat);
    torchSprite.scale.set(1.2, 2.4, 1);
    torchSprite.position.set(
      wx + mountDir.dx * cs * 0.35,
      cs * 0.65,
      wz + mountDir.dz * cs * 0.35
    );
    this.dungeonGroup.add(torchSprite);
    this.torchSprites.push(torchSprite);

    // Point light — use theme torch color
    const torchColor = theme ? theme.torchLight : COLORS.TORCH_LIGHT;
    const light = new THREE.PointLight(torchColor, 0.8, cs * 3.5);
    light.position.set(
      wx + mountDir.dx * cs * 0.2,
      cs * 0.75,
      wz + mountDir.dz * cs * 0.2
    );
    light.castShadow = false; // Performance: only player light casts shadows
    this.scene.add(light);
    this.torchLights.push(light);
  }

  _addEdgeOutlines(map, cs, theme) {
    // Add thin black line geometry at wall-floor boundaries for comic ink outlines
    const inkColor = theme ? theme.ink : COLORS.INK;
    const lineMat = new THREE.LineBasicMaterial({ color: inkColor, linewidth: 1 });
    const points = [];

    for (let z = 0; z < map.height; z++) {
      for (let x = 0; x < map.width; x++) {
        if (map.getCell(x, z) !== CELL.WALL) continue;
        const wx = x * cs;
        const wz = z * cs;
        const h = cs;
        const half = cs / 2;

        // Check each neighbor — if it's a floor, draw an outline edge there
        const edges = [
          { dx: 0, dz: -1, corners: [[-half, 0, -half], [-half, h, -half], [half, h, -half], [half, 0, -half]] },
          { dx: 0, dz: 1, corners: [[-half, 0, half], [-half, h, half], [half, h, half], [half, 0, half]] },
          { dx: -1, dz: 0, corners: [[-half, 0, -half], [-half, h, -half], [-half, h, half], [-half, 0, half]] },
          { dx: 1, dz: 0, corners: [[half, 0, -half], [half, h, -half], [half, h, half], [half, 0, half]] },
        ];

        for (const edge of edges) {
          const ncell = map.getCell(x + edge.dx, z + edge.dz);
          if (ncell >= CELL.FLOOR || ncell === CELL.TORCH) {
            // Add edge outline
            for (let i = 0; i < edge.corners.length; i++) {
              const c1 = edge.corners[i];
              const c2 = edge.corners[(i + 1) % edge.corners.length];
              points.push(
                new THREE.Vector3(wx + c1[0], c1[1], wz + c1[2]),
                new THREE.Vector3(wx + c2[0], c2[1], wz + c2[2])
              );
            }
          }
        }
      }
    }

    if (points.length > 0) {
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const lines = new THREE.LineSegments(geo, lineMat);
      this.dungeonGroup.add(lines);
    }
  }

  // Call from render loop for torch flicker
  updateTorches(dt) {
    this._torchTime += dt * 0.003;
    const isOffice = this._theme && this._theme.name.toLowerCase() === 'office';

    for (let i = 0; i < this.torchLights.length; i++) {
      const light = this.torchLights[i];
      if (isOffice) {
        // Subtle fluorescent hum — barely perceptible flicker
        light.intensity = 0.85 + Math.sin(this._torchTime * 1.2 + i * 3.7) * 0.03 +
          Math.sin(this._torchTime * 8.1 + i * 0.9) * 0.02;
      } else {
        // Fire torch — warm flickering
        light.intensity = 0.6 + Math.sin(this._torchTime * 3 + i * 2.1) * 0.15 +
          Math.sin(this._torchTime * 7.3 + i * 1.3) * 0.08;
      }
    }
  }

  gridToWorld(gx, gz) {
    return {
      x: gx * DUNGEON.CELL_SIZE,
      y: CAMERA.EXPLORE_HEIGHT,
      z: gz * DUNGEON.CELL_SIZE,
    };
  }

  dispose() {
    this._clearGroup();
    this.furnitureRenderer.clear();
    this.torchLights.forEach(l => this.scene.remove(l));
    this.torchLights = [];
    this.torchSprites = [];
    this.scene.remove(this.dungeonGroup);
  }
}
