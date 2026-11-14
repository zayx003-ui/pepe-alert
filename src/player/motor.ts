/**
 * Déplacement du joueur : marche, course, accroupissement, saut, pentes et collisions.
 * Pur et déterministe (testable sans moteur 3D).
 */
import { approach, clamp } from '../core/math';
import type { WorldGrid } from '../world/grid';

export interface MoveIntent {
  /** Avant / arrière, de -1 à 1. */
  forward: number;
  /** Droite / gauche, de -1 à 1. */
  strafe: number;
  sprint: boolean;
  crouch: boolean;
  jump: boolean;
}

export interface MoveMods {
  speedFactor: number;
  canSprint: boolean;
  canJump: boolean;
  /** Immobilisé (caché dans un casier, interface ouverte, mort). */
  frozen: boolean;
}

export interface MotorEvents {
  /** Un pas vient d'être posé. */
  step: boolean;
  /** Vitesse verticale à l'atterrissage (0 si aucun atterrissage cette image). */
  landed: number;
  jumped: boolean;
}

export const PLAYER_RADIUS = 0.3;
export const STAND_HEIGHT = 1.75;
export const CROUCH_HEIGHT = 1.0;
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 0.88;
export const WALK_SPEED = 2.7;
export const SPRINT_SPEED = 5.1;
export const CROUCH_SPEED = 1.35;
const GRAVITY = 18;
const JUMP_SPEED = 4.7;
const STEP_UP = 0.5;

export class PlayerMotor {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  yaw = 0;
  pitch = 0;
  grounded = true;
  /** 0 = debout, 1 = accroupi (interpolé). */
  crouch = 0;
  crouching = false;
  sprinting = false;
  /** Vitesse horizontale réelle (m/s). */
  speed = 0;
  /** Distance cumulée depuis le dernier pas. */
  stride = 0;
  /** Phase de la démarche pour l'oscillation de la caméra. */
  gait = 0;
  readonly events: MotorEvents = { step: false, landed: 0, jumped: false };
  private jumpHeld = false;

  teleport(x: number, y: number, z: number, yaw = this.yaw): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.yaw = yaw;
    this.vx = this.vy = this.vz = 0;
    this.grounded = true;
  }

  get height(): number {
    return STAND_HEIGHT + (CROUCH_HEIGHT - STAND_HEIGHT) * this.crouch;
  }

  get eyeHeight(): number {
    return EYE_STAND + (EYE_CROUCH - EYE_STAND) * this.crouch;
  }

  /** Le joueur a-t-il la place de se relever ? */
  canStand(grid: WorldGrid): boolean {
    if (grid.headroomAt(this.x, this.z) < STAND_HEIGHT + 0.05) return false;
    return !grid.resolve(this.x, this.z, PLAYER_RADIUS - 0.02, this.y + CROUCH_HEIGHT - 0.35, STAND_HEIGHT - CROUCH_HEIGHT + 0.35).hit;
  }

  update(dt: number, intent: MoveIntent, mods: MoveMods, grid: WorldGrid): void {
    const ev = this.events;
    ev.step = false;
    ev.landed = 0;
    ev.jumped = false;

    /* Posture */
    if (intent.crouch) this.crouching = true;
    else if (this.crouching && this.canStand(grid)) this.crouching = false;
    this.crouch = approach(this.crouch, this.crouching ? 1 : 0, dt * 6);

    /* Vitesse souhaitée */
    let f = mods.frozen ? 0 : clamp(intent.forward, -1, 1);
    let s = mods.frozen ? 0 : clamp(intent.strafe, -1, 1);
    const len = Math.hypot(f, s);
    if (len > 1) {
      f /= len;
      s /= len;
    }
    this.sprinting = intent.sprint && mods.canSprint && !this.crouching && f > 0.1 && len > 0.1 && !mods.frozen;
    let max = this.crouching ? CROUCH_SPEED : this.sprinting ? SPRINT_SPEED : WALK_SPEED;
    if (f < 0) max *= 0.8;
    max *= mods.speedFactor;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wantX = (sin * f + cos * s) * max;
    const wantZ = (cos * f - sin * s) * max;
    const accel = this.grounded ? (len > 0 ? 16 : 20) : 3;
    this.vx = approach(this.vx, wantX, accel * dt);
    this.vz = approach(this.vz, wantZ, accel * dt);

    /* Saut et gravité */
    if (intent.jump && !this.jumpHeld && this.grounded && mods.canJump && !this.crouching && !mods.frozen) {
      this.vy = JUMP_SPEED;
      this.grounded = false;
      ev.jumped = true;
    }
    this.jumpHeld = intent.jump;

    /* Déplacement horizontal par sous-pas (évite de traverser un mur fin à grande vitesse) */
    const dist = Math.hypot(this.vx, this.vz) * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.15));
    const sx = (this.vx * dt) / steps;
    const sz = (this.vz * dt) / steps;
    const h = this.height;
    const startX = this.x;
    const startZ = this.z;
    for (let i = 0; i < steps; i++) {
      let nx = this.x + sx;
      let nz = this.z + sz;
      const r = grid.resolve(nx, nz, PLAYER_RADIUS, this.y, h);
      nx = r.x;
      nz = r.z;
      if (!grid.walkable(nx, nz)) break;
      // Marche trop haute (bord de cabine d'ascenseur, palier) : on ne monte pas.
      if (grid.heightAt(nx, nz) > this.y + STEP_UP) {
        if (grid.heightAt(nx, this.z) <= this.y + STEP_UP && grid.walkable(nx, this.z)) nz = this.z;
        else if (grid.heightAt(this.x, nz) <= this.y + STEP_UP && grid.walkable(this.x, nz)) nx = this.x;
        else break;
      }
      this.x = nx;
      this.z = nz;
    }
    const moved = Math.hypot(this.x - startX, this.z - startZ);
    this.speed = dt > 0 ? moved / dt : 0;

    /* Vertical */
    const floor = grid.heightAt(this.x, this.z);
    if (this.grounded) {
      if (floor < this.y - 0.6) {
        this.grounded = false;
        this.vy = 0;
      } else this.y = floor;
    }
    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      const ceiling = floor + grid.headroomAt(this.x, this.z);
      if (this.y + h > ceiling && this.vy > 0) {
        this.y = ceiling - h;
        this.vy = 0;
      }
      if (this.y <= floor) {
        ev.landed = -this.vy;
        this.y = floor;
        this.vy = 0;
        this.grounded = true;
      }
    }

    /* Démarche */
    if (this.grounded && this.speed > 0.4) {
      this.stride += moved;
      const strideLen = this.sprinting ? 1.25 : this.crouching ? 0.6 : 0.82;
      this.gait += (moved / strideLen) * Math.PI;
      if (this.stride >= strideLen) {
        this.stride -= strideLen;
        ev.step = true;
      }
    } else if (this.speed < 0.1) {
      this.stride = 0;
    }
  }
}

/** Portée (en mètres) du bruit de déplacement. */
export function movementNoise(motor: PlayerMotor, surfaceFactor: number): number {
  if (!motor.grounded || motor.speed < 0.3) return 0;
  const base = motor.crouching ? 1.6 : motor.sprinting ? 13 : 5.5;
  return base * surfaceFactor;
}

export const SURFACE_NOISE: Record<string, number> = {
  beton: 0.9,
  metal: 1.25,
  carrelage: 1,
  grille: 1.45,
  moquette: 0.5,
};
