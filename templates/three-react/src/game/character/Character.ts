import * as THREE from 'three';
import { useGameStore } from '../../store';
import { createCharacterMesh, voxRoster } from './characters';
import type { CharacterType } from './characters';
import type { VoxCharEntry, StepMode } from './VoxCharacterDB';
import {
  getArchetype,
  getCharacterStats,
  randomInRange,
  getCharacterAnimScale,
} from './VoxCharacterDB';
import { getActionHoldTime, getLungeConfig, getExhaustDuration } from './CharacterSettings';
import { Entity, Layer } from '../core/Entity';
import type { Environment } from '../environment';
import type { NavGrid } from '../pathfinding';
import { Behavior, type BehaviorAgent } from '../behaviors/Behavior';
import { Roaming } from '../behaviors/Roaming';
import { GoToPoint } from '../behaviors/GoToPoint';
import {
  PlayerControl,
  type PlayerControlDeps,
} from '../behaviors/PlayerControl';
import { audioSystem } from '../../utils/AudioSystem';
import type { LadderDef } from '../dungeon';
import {
  DEFAULT_CHARACTER_PARAMS,
  GRAVITY,
  MAX_FALL_SPEED,
  STEP_UP_RATE,
  FOOT_SFX_COOLDOWN,
  DEFAULT_HOP_FREQUENCY,
  ANIM_REFERENCE_SPEED,
  type MovementParams,
} from './CharacterSettings';
import { FootIK } from './FootIK';
import { lerpAngle } from '../../utils/math';
import { CharacterClimbing } from './CharacterClimbing';
import { CharacterCombat, type CombatOwner } from './CharacterCombat';
import { VoxAnimator } from './VoxAnimator';
import { HpBar } from './HpBar';
import { DebugPathVis } from './DebugPathVis';

export class Character implements BehaviorAgent {
  readonly mesh: THREE.Mesh;
  readonly characterType: CharacterType;
  entity: Entity;
  facing = 0;
  groundY = 0;
  visualGroundY = 0;
  velocityY = 0;
  moveTime = 0;
  lastHopHalf = 0;
  hopFrequency = DEFAULT_HOP_FREQUENCY;
  footSfxTimer = 0;
  /** Animation rhythm multiplier — scales hop frequency and walk anim FPS. */
  animSpeedScale = 1.0;
  /** Per-archetype anim multiplier (tweak any monster's animation rhythm). */
  characterAnimScale = 1.0;
  /** Crit chance 0-1, rolled on each hit. */
  critChance = 0.05;
  /** Deflect chance 0-1. */
  armour = 0;

  // ── Composed modules ──────────────────────────────────────────────
  private climbing = new CharacterClimbing();
  private combat = new CharacterCombat();
  private animator = new VoxAnimator();
  private hpBar: HpBar;
  private debugVis: DebugPathVis;
  private footIK: FootIK;

  /** Per-character movement parameters (mutable, shared by reference with behaviors) */
  params: MovementParams;

  torchLight: THREE.PointLight;
  torchLightEntity: Entity;
  fillLight: THREE.PointLight;
  torchTime = 0;
  private _baseSpeed: number | undefined;

  protected scene: THREE.Scene;
  terrain: Environment;
  private navGrid: NavGrid;
  private ladderDefs: ReadonlyArray<LadderDef>;

  // ── Combat forwarding (keeps external API identical) ──────────────
  get hp(): number {
    return this.combat.hp;
  }
  set hp(v: number) {
    this.combat.hp = v;
  }
  get maxHp(): number {
    return this.combat.maxHp;
  }
  set maxHp(v: number) {
    this.combat.maxHp = v;
  }
  get isAlive(): boolean {
    return this.combat.isAlive;
  }
  set isAlive(v: boolean) {
    this.combat.isAlive = v;
  }
  isEnemy = false;
  get knockbackVX(): number {
    return this.combat.knockbackVX;
  }
  set knockbackVX(v: number) {
    this.combat.knockbackVX = v;
  }
  get knockbackVZ(): number {
    return this.combat.knockbackVZ;
  }
  set knockbackVZ(v: number) {
    this.combat.knockbackVZ = v;
  }
  get invulnTimer(): number {
    return this.combat.invulnTimer;
  }
  set invulnTimer(v: number) {
    this.combat.invulnTimer = v;
  }
  get flashTimer(): number {
    return this.combat.flashTimer;
  }
  set flashTimer(v: number) {
    this.combat.flashTimer = v;
  }
get isAttacking(): boolean {
    return this.combat.isAttacking;
  }
  set isAttacking(v: boolean) {
    this.combat.isAttacking = v;
  }
  get attackJustStarted(): boolean {
    return this.combat.attackJustStarted;
  }
  set attackJustStarted(v: boolean) {
    this.combat.attackJustStarted = v;
  }
  get attackCount(): number {
    return this.combat.attackCount;
  }
  set attackCount(v: number) {
    this.combat.attackCount = v;
  }
  get comboDamageMultiplier(): number {
    return this.combat.comboDamageMultiplier;
  }
  get exhaustTimer(): number {
    return this.combat.exhaustTimer;
  }
  set exhaustTimer(v: number) {
    this.combat.exhaustTimer = v;
  }
  get stunTimer(): number {
    return this.combat.stunTimer;
  }
  set stunTimer(v: number) {
    this.combat.stunTimer = v;
  }
  get lastHitDirX(): number {
    return this.combat.lastHitDirX;
  }
  set lastHitDirX(v: number) {
    this.combat.lastHitDirX = v;
  }
  get lastHitDirZ(): number {
    return this.combat.lastHitDirZ;
  }
  set lastHitDirZ(v: number) {
    this.combat.lastHitDirZ = v;
  }
  get showingHpBar(): boolean {
    return this.hpBar.showing;
  }
  set showingHpBar(v: boolean) {
    this.hpBar.showing = v;
  }

  // ── Regen / hunger forwarding ─────────────────────────────────────
  get regenDelay(): number {
    return this.combat.regenDelay;
  }
  set regenDelay(v: number) {
    this.combat.regenDelay = v;
  }
  get regenRate(): number {
    return this.combat.regenRate;
  }
  set regenRate(v: number) {
    this.combat.regenRate = v;
  }
  get timeSinceLastDamage(): number {
    return this.combat.timeSinceLastDamage;
  }
  get hungerEnabled(): boolean {
    return this.combat.hungerEnabled;
  }
  set hungerEnabled(v: boolean) {
    this.combat.hungerEnabled = v;
  }
  get hunger(): number {
    return this.combat.hunger;
  }
  set hunger(v: number) {
    this.combat.hunger = v;
  }
  get maxHunger(): number {
    return this.combat.maxHunger;
  }
  set maxHunger(v: number) {
    this.combat.maxHunger = v;
  }
  get hungerDecayRate(): number {
    return this.combat.hungerDecayRate;
  }
  set hungerDecayRate(v: number) {
    this.combat.hungerDecayRate = v;
  }
  restoreHunger(amount: number): void {
    this.combat.restoreHunger(amount);
  }

  // ── VOX forwarding ───────────────────────────────────────────────
  get voxEntry(): VoxCharEntry | null {
    return this.animator.voxEntry;
  }
  set voxEntry(v: VoxCharEntry | null) {
    this.animator.voxEntry = v;
  }

  getStepMode(): StepMode {
    return this.animator.getStepMode();
  }

  // ── Behavior system ─────────────────────────────────────────────
  protected behavior: Behavior;
  private defaultBehavior: Roaming;
  private playerControl: PlayerControl | null = null;
  private _selected = false;

  constructor(
    scene: THREE.Scene,
    terrain: Environment,
    navGrid: NavGrid,
    type: CharacterType,
    position: THREE.Vector3,
    ladderDefs: ReadonlyArray<LadderDef> = [],
    skipAutoSkin = false,
  ) {
    this.scene = scene;
    this.terrain = terrain;
    this.footIK = new FootIK(terrain);
    this.navGrid = navGrid;
    this.characterType = type;
    this.ladderDefs = ladderDefs;

    // Mesh (placeholder — replaced by VOX skin below)
    this.mesh = createCharacterMesh();
    this.mesh.position.copy(position);
    this.groundY = position.y;
    this.visualGroundY = position.y;
    scene.add(this.mesh);
    this.entity = new Entity(this.mesh, {
      layer: Layer.Character,
      radius: 0.25,
    });

    // HP bar (billboard)
    this.hpBar = new HpBar(scene);

    // Debug path visualization
    this.debugVis = new DebugPathVis(scene, terrain);

    // Torch light
    const torch = useGameStore.getState().torchParams;
    this.torchLight = new THREE.PointLight(
      new THREE.Color(torch.color),
      torch.intensity,
      torch.distance,
    );
    this.torchLight.position.set(
      position.x,
      position.y + torch.offsetUp,
      position.z,
    );
    this.torchLight.castShadow = false;
    scene.add(this.torchLight);
    this.torchLightEntity = new Entity(this.torchLight, {
      layer: Layer.Light,
      radius: torch.distance,
    });

    // Fill light
    this.fillLight = new THREE.PointLight(
      new THREE.Color(torch.color),
      torch.intensity * 0.4,
      3,
    );
    this.fillLight.castShadow = false;
    scene.add(this.fillLight);

    // Params: Character defaults first, then overlay store
    const pp = useGameStore.getState().characterParams;
    this.params = { ...DEFAULT_CHARACTER_PARAMS, ...pp };

    // Default behavior: roaming
    this.defaultBehavior = new Roaming({ navGrid, ladderDefs }, this.params);
    this.behavior = this.defaultBehavior;

    // Auto-apply VOX skin from the roster (skip for enemies — they apply their own)
    if (!skipAutoSkin) {
      const rosterEntry = voxRoster[type];
      if (rosterEntry) {
        this.applyVoxSkin(rosterEntry);
        // Apply per-character stats (heroes or monsters picked via roster)
        const stats = getCharacterStats(getArchetype(rosterEntry.name));
        this.hp = this.maxHp = Math.round(randomInRange(stats.hp));
        this.params.speed = randomInRange(stats.movSpeed);
        // Boost player-controlled monsters so they feel responsive
        if (!this.isEnemy && rosterEntry.category === 'enemy') {
          this.params.speed = Math.max(this.params.speed * 1.25, 2.0);
        }
        this.params.attackDamage = Math.floor(randomInRange(stats.damage));
        this.params.attackCooldown = 1 / randomInRange(stats.atkSpeed);
        this.critChance = stats.critChance;
        this.armour = stats.armour;
      }
    }
  }

  // ── CombatOwner adapter ─────────────────────────────────────────
  private _combatOwner: CombatOwner | null = null;
  private get combatOwner(): CombatOwner {
    if (!this._combatOwner) {
      const self = this;
      this._combatOwner = {
        mesh: this.mesh,
        get groundY() {
          return self.groundY;
        },
        set groundY(v: number) {
          self.groundY = v;
        },
        isEnemy: this.isEnemy,
        get isMoving() {
          return self._wasMoving;
        },
        params: this.params,
        terrain: this.terrain,
        playActionAnim: () => this.playActionAnim(),
        getActionFrameCount: () => this.animator.getActionFrameCount(),
        getVoxAnimState: () => this.animator.getVoxAnimState(),
        getVoxFrameIndex: () => this.animator.getVoxFrameIndex(),
        isActionHolding: () => this.animator.actionHolding,
      };
    }
    return this._combatOwner;
  }

  // ── BehaviorAgent interface ──────────────────────────────────────

  getX(): number {
    return this.mesh.position.x;
  }
  getZ(): number {
    return this.mesh.position.z;
  }
  getFacing(): number {
    return this.facing;
  }
  setFacing(angle: number): void {
    this.facing = angle;
    this.mesh.rotation.y = angle;
  }

  /** Apply vertical hop offset. */
  applyHop(hopHeight: number): number {
    const hopSin = Math.sin(this.moveTime * Math.PI);
    const hop = Math.abs(hopSin) * hopHeight;
    this.mesh.position.y = this.visualGroundY + hop;
    const currentHopHalf = Math.floor(this.moveTime) % 2;
    const stepMode = this.getStepMode();

    if (stepMode === 'flyer') {
      if (
        currentHopHalf !== this.lastHopHalf &&
        this.footSfxTimer >= FOOT_SFX_COOLDOWN
      ) {
        this.lastHopHalf = currentHopHalf;
        this.footSfxTimer = 0;
        audioSystem.sfxAt(
          'fly',
          this.mesh.position.x,
          this.mesh.position.z,
          this.isEnemy ? 0.4 : 0.5,
        );
      } else if (currentHopHalf !== this.lastHopHalf) {
        this.lastHopHalf = currentHopHalf;
      }
      return currentHopHalf;
    }
    if (
      stepMode === 'walker' &&
      currentHopHalf !== this.lastHopHalf &&
      this.footSfxTimer >= FOOT_SFX_COOLDOWN
    ) {
      this.lastHopHalf = currentHopHalf;
      this.footSfxTimer = 0;
      const stepVol = this.isEnemy ? 0.5 : 0.7;
      audioSystem.sfxAt(
        'step',
        this.mesh.position.x,
        this.mesh.position.z,
        stepVol,
      );
    } else if (currentHopHalf !== this.lastHopHalf) {
      this.lastHopHalf = currentHopHalf;
    }

    return currentHopHalf;
  }

  // ── VOX skin loading ─────────────────────────────────────────────

  async applyVoxSkin(entry: VoxCharEntry): Promise<void> {
    // Store base speed on first skin apply, restore it on subsequent ones
    if (this._baseSpeed === undefined) this._baseSpeed = this.params.speed;
    else this.params.speed = this._baseSpeed;

    await this.animator.applySkin(this, entry, this.footIK);

    // Derive collision radius from actual mesh XZ extent
    this.mesh.geometry.computeBoundingBox();
    const bb = this.mesh.geometry.boundingBox;
    if (bb) {
      const halfX = (bb.max.x - bb.min.x) / 2;
      const halfZ = (bb.max.z - bb.min.z) / 2;
      // Use the larger XZ axis, with a small padding
      this.entity.radius = Math.max(halfX, halfZ) + 0.02;
    }

    // Jumpers move slower than walkers (only for non-enemies; enemies use per-monster movSpeed)
    if (entry.stepMode === 'jumper' && !this.isEnemy) {
      this.params.speed *= 0.6;
    }

    // Small critters scurry with faster animation
    const archetype = getArchetype(entry.name);
    this.characterAnimScale = getCharacterAnimScale(archetype);

    // Per-character action hold time and lunge
    this.params.actionHoldTime = getActionHoldTime(archetype);
    this.params.exhaustDuration = getExhaustDuration(archetype);
    const [lungeDist, lungeDur] = getLungeConfig(archetype);
    this.params.lungeDistance = lungeDist;
    this.params.lungeDuration = lungeDur;
  }

  private _wasMoving = false;

  private updateVoxAnimation(dt: number, isMoving: boolean): void {
    // Stop step loop when player-controlled character transitions to idle
    if (this._selected && this._wasMoving && !isMoving) {
      audioSystem.stopSteps();
    }
    this._wasMoving = isMoving;
    this.animator.update(this, dt, isMoving, this.footIK);
  }

  private playActionAnim(): void {
    this.animator.playAction(this);
  }

  // ── Selection & control switching ────────────────────────────────

  get selected(): boolean {
    return this._selected;
  }

  setPlayerControlled(deps: PlayerControlDeps): void {
    this._selected = true;
    this.playerControl = new PlayerControl(
      { navGrid: this.navGrid, ladderDefs: this.ladderDefs },
      deps,
    );
    this.behavior = this.playerControl;
  }

  setAIControlled(): void {
    this._selected = false;
    this.playerControl = null;
    this.behavior = this.defaultBehavior;
  }

  goTo(worldX: number, worldZ: number): void {
    this.debugVis.clear();
    this.behavior = new GoToPoint(
      { navGrid: this.navGrid, ladderDefs: this.ladderDefs },
      this.params,
      worldX,
      worldZ,
    );
  }

  getCameraTarget(): { x: number; y: number; z: number } {
    return {
      x: this.mesh.position.x,
      y: this.visualGroundY + 0.5,
      z: this.mesh.position.z,
    };
  }

  // ── Update ───────────────────────────────────────────────────────

  update(dt: number): void {
    this.updateCombat(dt);

    if (!this.isAlive) return;

    if (this.stunTimer > 0) {
      this.updateVisualY(dt);
      this.mesh.position.y = this.visualGroundY;
      this.updateVoxAnimation(dt, false);
      this.updateTorch(dt);
      return;
    }

    if (
      this._selected &&
      this.playerControl &&
      this.behavior instanceof GoToPoint
    ) {
      if (this.playerControl.hasInput()) {
        this.behavior = this.playerControl;
      }
    }

    const status = this.behavior.update(this, dt);

    if (status === 'done') {
      if (this._selected && this.playerControl) {
        this.behavior = this.playerControl;
      } else {
        this.behavior = this.defaultBehavior;
      }
    }

    if (this.params.showPathDebug) {
      this.debugVis.sync(this.behavior, this.mesh.position);
    } else {
      this.debugVis.clear();
    }
    this.updateTorch(dt);
  }

  // ── Movement (BehaviorAgent) ─────────────────────────────────────

  move(
    dx: number,
    dz: number,
    speed: number,
    stepHeight: number,
    capsuleRadius: number,
    dt: number,
    slopeHeight?: number,
    skipFacing?: boolean,
  ): boolean {
    if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return false;
    this.footSfxTimer += dt;

    // Play an immediate step sound when starting movement from idle
    const startingMove = this.moveTime === 0;
    if (startingMove && this.footSfxTimer >= FOOT_SFX_COOLDOWN) {
      const stepMode = this.getStepMode();
      if (stepMode === 'walker') {
        const vol = this.isEnemy ? 0.5 : 0.7;
        audioSystem.sfxAt(
          'step',
          this.mesh.position.x,
          this.mesh.position.z,
          vol,
        );
        this.footSfxTimer = 0;
      }
    }

    const oldX = this.mesh.position.x;
    const oldZ = this.mesh.position.z;

    // Door steering: when near a doorway, blend movement toward door center
    let effDx = dx;
    let effDz = dz;
    const door = this.terrain.getNearbyDoor(oldX, oldZ, dx, dz, 1.5);
    if (door) {
      const steerStrength = 0.35;
      if (door.corrAxis === 'x') {
        const offset = door.cx - oldX;
        effDx =
          dx +
          Math.sign(offset) * Math.min(Math.abs(offset), 1) * steerStrength;
      } else {
        const offset = door.cz - oldZ;
        effDz =
          dz +
          Math.sign(offset) * Math.min(Math.abs(offset), 1) * steerStrength;
      }
      // Re-normalize to keep same overall speed
      const len = Math.sqrt(effDx * effDx + effDz * effDz);
      if (len > 0.001) {
        effDx /= len;
        effDz /= len;
      }
    }

    // Slow down on stairs for smoother traversal (cap reduction so slow chars stay playable)
    const onStairs = this.terrain.isOnStairs(oldX, oldZ);
    const effSpeed = onStairs ? Math.max(speed * 0.7, Math.min(speed, 1.5)) : speed;
    const newX = oldX + effDx * effSpeed * dt;
    const newZ = oldZ + effDz * effSpeed * dt;

    const resolved = this.terrain.resolveMovement(
      newX,
      newZ,
      this.groundY,
      stepHeight,
      capsuleRadius,
      oldX,
      oldZ,
      slopeHeight,
    );
    this.mesh.position.x = resolved.x;
    this.mesh.position.z = resolved.z;
    this.groundY = resolved.y;

    this.updateVisualY(dt);

    if (!skipFacing) {
      const targetAngle = Math.atan2(dx, dz) + Math.PI;
      this.facing = lerpAngle(this.facing, targetAngle, 1 - Math.exp(-24 * dt));
      this.mesh.rotation.y = this.facing;
    }

    // Scale hop frequency and walk animation proportional to actual velocity
    {
      const movedX = this.mesh.position.x - oldX;
      const movedZ = this.mesh.position.z - oldZ;
      const actualSpeed =
        dt > 0 ? Math.sqrt(movedX * movedX + movedZ * movedZ) / dt : 0;
      const rawScale =
        Math.sqrt(actualSpeed / ANIM_REFERENCE_SPEED) * this.characterAnimScale;
      const minScale = this.getStepMode() === 'jumper' ? 0.8 : 0.3;
      this.animSpeedScale = Math.max(rawScale, minScale);
      this.hopFrequency = DEFAULT_HOP_FREQUENCY * this.animSpeedScale;
    }
    this.moveTime += dt * this.hopFrequency;
    this.updateVoxAnimation(dt, true);

    return true;
  }

  private updateVisualY(dt: number): void {
    if (this.groundY > this.visualGroundY) {
      this.visualGroundY = THREE.MathUtils.lerp(
        this.visualGroundY,
        this.groundY,
        1 - Math.exp(-STEP_UP_RATE * dt),
      );
      this.velocityY = 0;
    } else if (this.groundY < this.visualGroundY) {
      this.velocityY = Math.min(this.velocityY + GRAVITY * dt, MAX_FALL_SPEED);
      this.visualGroundY -= this.velocityY * dt;
      if (this.visualGroundY <= this.groundY) {
        const impactSpeed = this.velocityY;
        this.visualGroundY = this.groundY;
        this.velocityY = 0;
        const stepMode = this.getStepMode();
        if (stepMode === 'flyer') {
          // no step/land sounds for flyers
        } else if (impactSpeed > 1 && this.footSfxTimer >= FOOT_SFX_COOLDOWN) {
          const vol = this.isEnemy ? 0.5 : 0.7;
          // On stairs or small drops, play a step instead of heavy land thud
          const onStairs = this.terrain.isOnStairs(this.mesh.position.x, this.mesh.position.z);
          const isSmallDrop = impactSpeed < 3;
          if (stepMode === 'jumper') {
            if (Math.random() < 0.5)
              audioSystem.sfxAt(
                'step',
                this.mesh.position.x,
                this.mesh.position.z,
                vol,
              );
          } else if (onStairs || isSmallDrop) {
            audioSystem.sfxAt(
              'step',
              this.mesh.position.x,
              this.mesh.position.z,
              vol * 0.6,
            );
          } else {
            audioSystem.sfxAt(
              'land',
              this.mesh.position.x,
              this.mesh.position.z,
              vol,
            );
          }
          this.footSfxTimer = 0;
        }
      }
    } else {
      this.velocityY = 0;
    }
  }

  updateIdle(dt: number): void {
    this.footSfxTimer += dt;
    if (this.moveTime > 0) {
      if (
        this.footSfxTimer >= FOOT_SFX_COOLDOWN &&
        this.getStepMode() !== 'flyer'
      ) {
        this.footSfxTimer = 0;
        const stepVol = this.isEnemy ? 0.5 : 0.7;
        audioSystem.sfxAt(
          'step',
          this.mesh.position.x,
          this.mesh.position.z,
          stepVol,
        );
      }
      this.moveTime = 0;
      this.lastHopHalf = 0;
    }
    this.updateVisualY(dt);
    this.mesh.position.y = THREE.MathUtils.lerp(
      this.mesh.position.y,
      this.visualGroundY,
      1 - Math.exp(-15 * dt),
    );
    this.updateVoxAnimation(dt, false);
  }

  // ── HP bar ──────────────────────────────────────────────────────

  updateHpBar(camera: THREE.Camera): void {
    // HP bar follows mesh visibility: hidden when character is hidden/dimmed
    if (!this.mesh.visible) {
      this.hpBar.hide();
      return;
    }
    this.hpBar.update(
      this.mesh.position,
      this.hp,
      this.maxHp,
      this.isAlive,
      camera,
    );
  }

  // ── Combat methods ───────────────────────────────────────────────

  hideHpBar(): void {
    this.hpBar.hide();
  }

  hideBody(): void {
    this.mesh.visible = false;
    this.hpBar.hide();
  }

  consumeJustTookDamage(): boolean {
    return this.combat.consumeJustTookDamage();
  }

  takeDamage(
    amount: number,
    fromX: number,
    fromZ: number,
    knockback: number,
  ): boolean {
    return this.combat.takeDamage(
      this.combatOwner,
      amount,
      fromX,
      fromZ,
      knockback,
    );
  }

  startAttack(): boolean {
    return this.combat.startAttack(this.combatOwner);
  }

  /** Cap lunge distance so it stops short of a target (call right after startAttack). */
  capLungeToTarget(targetX: number, targetZ: number, stopDist: number): void {
    this.combat.capLungeToTarget(
      this.mesh.position.x, this.mesh.position.z,
      targetX, targetZ, stopDist,
    );
  }

  isInAttackHitWindow(): boolean {
    return this.combat.isInAttackHitWindow(this.combatOwner);
  }

  markAttackHitApplied(): void {
    this.combat.markAttackHitApplied();
  }

  canApplyAttackHit(): boolean {
    return this.combat.canApplyAttackHit(this.combatOwner);
  }

  updateCombat(dt: number): void {
    this.combat.update(this.combatOwner, dt);
  }

  updateTorch(dt: number): void {
    const torchOn = useGameStore.getState().torchEnabled;
    const torch = useGameStore.getState().torchParams;

    if (!torchOn) {
      this.torchLight.intensity = 0;
      this.fillLight.intensity = 0;
      return;
    }

    this.torchLight.color.set(torch.color);
    this.torchLight.distance = torch.distance;

    this.torchTime += dt * 12;
    const flickerAmount = torch.flicker;
    const flicker =
      1 +
      (Math.sin(this.torchTime) * 0.5 +
        Math.sin(this.torchTime * 2.3) * 0.3 +
        Math.sin(this.torchTime * 5.7) * 0.2) *
        flickerAmount;
    this.torchLight.intensity = torch.intensity * flicker;

    this.torchLight.position.set(
      this.mesh.position.x,
      this.mesh.position.y + torch.offsetUp,
      this.mesh.position.z,
    );

    const fwdX = -Math.sin(this.facing);
    const fwdZ = -Math.cos(this.facing);
    const rightX = -fwdZ;
    const rightZ = fwdX;
    this.fillLight.color.set(torch.color);
    this.fillLight.intensity = torch.intensity * 0.4 * flicker;
    this.fillLight.position.set(
      this.mesh.position.x +
        fwdX * torch.offsetForward +
        rightX * torch.offsetRight,
      this.mesh.position.y + torch.offsetUp * 0.6,
      this.mesh.position.z +
        fwdZ * torch.offsetForward +
        rightZ * torch.offsetRight,
    );
  }

  // ── Climbing ─────────────────────────────────────────────────────

  playClimbStep(): void {
    audioSystem.sfxAt('step', this.mesh.position.x, this.mesh.position.z, 0.4);
  }

  startClimb(ladder: LadderDef, direction: 'up' | 'down'): void {
    this.climbing.start(this, ladder, direction);
  }

  updateClimb(dt: number): boolean {
    return this.climbing.update(this, dt);
  }

  isClimbing(): boolean {
    return this.climbing.active;
  }

  getPosition(): THREE.Vector3 {
    return this.mesh.position;
  }

  // ── Dispose ──────────────────────────────────────────────────────

  dispose(): void {
    this.debugVis.dispose();
    this.entity.destroy();
    this.torchLightEntity.destroy();
    this.scene.remove(this.mesh);
    (this.mesh.material as THREE.Material).dispose();
    this.scene.remove(this.torchLight);
    this.scene.remove(this.fillLight);
    this.hpBar.dispose(this.scene);
  }
}
