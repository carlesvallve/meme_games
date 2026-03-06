import * as THREE from 'three';
import { useGameStore } from '../store';
import { voxRoster, VOX_HEROES, VOX_ENEMIES } from './character';
import type { GameContext } from './GameContext';
import type { GameCharacterManager } from './GameCharacters';
import type { GameSceneManager } from './GameSceneManager';
import { applyCharacterStats } from './GameCallbacks';

/** Melee auto-aim: find nearest enemy within reach+margin and a wide cone, return snap facing or null. */
export function findMeleeAimTarget(
  px: number,
  pz: number,
  currentFacing: number,
  enemies: ReadonlyArray<{
    isAlive: boolean;
    mesh: { position: THREE.Vector3 };
  }>,
  props?: ReadonlyArray<{ x: number; z: number }>,
): number | null {
  const maxRange = 1.8;
  const maxAngle = Math.PI * 0.6;

  let bestAngleDiff = maxAngle;
  let bestFacing: number | null = null;

  const fwdX = -Math.sin(currentFacing);
  const fwdZ = -Math.cos(currentFacing);

  for (const enemy of enemies) {
    if (!enemy.isAlive) continue;
    const dx = enemy.mesh.position.x - px;
    const dz = enemy.mesh.position.z - pz;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > maxRange || dist < 0.01) continue;

    const dot = fwdX * (dx / dist) + fwdZ * (dz / dist);
    const angleDiff = Math.acos(Math.min(1, Math.max(-1, dot)));
    if (angleDiff < bestAngleDiff) {
      bestAngleDiff = angleDiff;
      bestFacing = Math.atan2(-dx, -dz);
    }
  }

  if (props) {
    for (const prop of props) {
      const dx = prop.x - px;
      const dz = prop.z - pz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > maxRange || dist < 0.01) continue;

      const dot = fwdX * (dx / dist) + fwdZ * (dz / dist);
      const angleDiff = Math.acos(Math.min(1, Math.max(-1, dot)));
      if (angleDiff < bestAngleDiff) {
        bestAngleDiff = angleDiff;
        bestFacing = Math.atan2(-dx, -dz);
      }
    }
  }

  return bestFacing;
}

export interface GameInputManager {
  raycastTerrain(clientX: number, clientY: number): { x: number; z: number; y: number } | null;
  sendActiveCharTo(tx: number, tz: number, ty: number): void;
  handleClick(clientX: number, clientY: number): void;
  onCycleKey: (e: KeyboardEvent) => void;
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp: (e: PointerEvent) => void;
  onResize: () => void;
}

const DRAG_REPATH_ENABLED = false;
const DRAG_REPATH_DIST = 0.5;

export function createInputManager(
  ctx: GameContext,
  characters: GameCharacterManager,
  sceneManager: GameSceneManager,
): GameInputManager {

  function raycastTerrain(
    clientX: number,
    clientY: number,
  ): { x: number; z: number; y: number } | null {
    ctx.pointerNDC.x = (clientX / window.innerWidth) * 2 - 1;
    ctx.pointerNDC.y = -(clientY / window.innerHeight) * 2 + 1;
    ctx.raycaster.setFromCamera(ctx.pointerNDC, ctx.cam.camera);

    let hitPoint: THREE.Vector3 | null = null;

    const boxGroup = ctx.terrain.getBoxGroup();
    if (boxGroup.children.length > 0) {
      const boxHits = ctx.raycaster.intersectObject(boxGroup, true);
      for (const h of boxHits) {
        if (
          (h.object as THREE.Mesh).isMesh &&
          h.object.type === 'Mesh' &&
          !h.object.userData.collisionOnly
        ) {
          hitPoint = h.point;
          break;
        }
      }
    }

    if (!hitPoint) {
      const terrainGroup = ctx.terrain.getGroup();
      if (terrainGroup.children.length > 0) {
        const groupHits = ctx.raycaster.intersectObject(terrainGroup, true);
        for (const h of groupHits) {
          if (
            (h.object as THREE.Mesh).isMesh &&
            h.object.visible &&
            !h.object.userData.collisionOnly &&
            !h.object.userData.isWall
          ) {
            hitPoint = h.point;
            break;
          }
        }
      }
    }

    if (!hitPoint) {
      const terrainMesh = ctx.terrain.getTerrainMesh();
      if (terrainMesh) {
        const hits = ctx.raycaster.intersectObject(terrainMesh, false);
        if (hits.length > 0) hitPoint = hits[0].point;
      }
    }

    if (!hitPoint) {
      const flatPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      if (ctx.raycaster.ray.intersectPlane(flatPlane, ctx._planeHit)) {
        hitPoint = ctx._planeHit;
      }
    }

    if (!hitPoint) return null;
    const snapped = ctx.navGrid.snapToGrid(hitPoint.x, hitPoint.z);
    return {
      x: snapped.x,
      z: snapped.z,
      y: ctx.terrain.getTerrainY(snapped.x, snapped.z),
    };
  }

  function sendActiveCharTo(tx: number, tz: number, ty: number): void {
    if (!ctx.activeCharacter) return;
    ctx.activeCharacter.goTo(tx, tz);
    ctx.clickMarker.position.set(tx, ty + 0.05, tz);
    ctx.clickMarker.visible = true;
    ctx.markerLife = 0.6;
  }

  function handleClick(clientX: number, clientY: number): void {
    if (useGameStore.getState().phase !== 'playing') return;

    ctx.pointerNDC.x = (clientX / window.innerWidth) * 2 - 1;
    ctx.pointerNDC.y = -(clientY / window.innerHeight) * 2 + 1;
    ctx.raycaster.setFromCamera(ctx.pointerNDC, ctx.cam.camera);

    const otherChars = ctx.characters.filter((c) => c !== ctx.activeCharacter);
    const charMeshes = otherChars.map((c) => c.mesh);
    const charHits = ctx.raycaster.intersectObjects(charMeshes, true);
    if (charHits.length > 0) {
      const hitObj = charHits[0].object;
      const char = otherChars.find(
        (c) =>
          c.mesh === hitObj ||
          hitObj.parent === c.mesh ||
          c.mesh === hitObj.parent,
      );
      if (char) {
        characters.selectCharacter(char);
        return;
      }
    }

    const hit = raycastTerrain(clientX, clientY);
    if (hit) {
      sendActiveCharTo(hit.x, hit.z, hit.y);
    }
  }

  const onCycleKey = (e: KeyboardEvent) => {
    if (useGameStore.getState().phase !== 'playing') return;
    if (e.code === 'ArrowLeft') {
      characters.cycleCharacter(-1);
      e.preventDefault();
    } else if (e.code === 'ArrowRight') {
      characters.cycleCharacter(1);
      e.preventDefault();
    } else if (e.code === 'KeyR') {
      if (ctx.activeCharacter) {
        const pool = e.shiftKey ? VOX_ENEMIES : VOX_HEROES;
        const entry = pool[Math.floor(Math.random() * pool.length)];
        voxRoster[ctx.activeCharacter.characterType] = entry;
        ctx.speechSystem.onSkinChanged(ctx.activeCharacter);
        ctx.activeCharacter.applyVoxSkin(entry);
        applyCharacterStats(ctx, ctx.activeCharacter);
      }
      e.preventDefault();
    } else if (e.code === 'Digit1') {
      if (ctx.activeCharacter) {
        const archer = VOX_HEROES.find((entry) => entry.id === 'archer');
        if (archer) {
          voxRoster[ctx.activeCharacter.characterType] = archer;
          ctx.speechSystem.onSkinChanged(ctx.activeCharacter);
          ctx.activeCharacter.applyVoxSkin(archer);
          applyCharacterStats(ctx, ctx.activeCharacter);
        }
      }
      e.preventDefault();
    } else if (e.code === 'KeyL' && !e.shiftKey) {
      useGameStore.getState().toggleTorch();
      e.preventDefault();
    } else if (e.code === 'KeyL' && e.shiftKey) {
      const ladders = ctx.terrain.getLadderDefs();
      if (ladders.length === 0) return;
      ctx.debugLadderIndex++;
      if (ctx.debugLadderIndex >= ladders.length) ctx.debugLadderIndex = -1;
      e.preventDefault();
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    ctx.pointerDragActive = false;
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!DRAG_REPATH_ENABLED) return;
    if (!(e.buttons & 1)) {
      ctx.pointerDragActive = false;
      return;
    }
    if (useGameStore.getState().phase !== 'playing') return;
    if (!ctx.activeCharacter) return;
    if (!ctx.cam.wasDrag()) return;

    const hit = raycastTerrain(e.clientX, e.clientY);
    if (!hit) return;

    if (ctx.pointerDragActive) {
      const dx = hit.x - ctx.lastDragX;
      const dz = hit.z - ctx.lastDragZ;
      if (dx * dx + dz * dz < DRAG_REPATH_DIST * DRAG_REPATH_DIST) return;
    }

    ctx.pointerDragActive = true;
    ctx.lastDragX = hit.x;
    ctx.lastDragZ = hit.z;
    sendActiveCharTo(hit.x, hit.z, hit.y);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (ctx.pointerDragActive) {
      const hit = raycastTerrain(e.clientX, e.clientY);
      if (hit) sendActiveCharTo(hit.x, hit.z, hit.y);
      ctx.pointerDragActive = false;
    } else if (!ctx.cam.wasDrag()) {
      handleClick(e.clientX, e.clientY);
    }
  };

  const onResize = () => {
    ctx.renderer.setSize(window.innerWidth, window.innerHeight);
    ctx.cam.resize(window.innerWidth / window.innerHeight);
    ctx.postProcess.resize(window.innerWidth, window.innerHeight);
  };

  return {
    raycastTerrain,
    sendActiveCharTo,
    handleClick,
    onCycleKey,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onResize,
  };
}
