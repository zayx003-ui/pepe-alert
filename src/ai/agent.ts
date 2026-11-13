/**
 * Agent autonome : perception (vue, ouïe), mémoire, déplacement sur la grille.
 * Les décisions propres à chaque entité sont dans ai/brains/.
 */
import { angleDelta, dist, dist2, lerpAngle } from '../core/math';
import type { Rng } from '../core/rng';
import { DOOR_OPEN } from '../world/grid';
import { findPath } from '../world/nav';
import { SECTORS } from '../world/sectors';
import type { WorldState } from '../world/state';
import { CELL, CellKind, DIR_DX, DIR_DY, EDGE_DOOR_BASE, GRID_W, cellCenterX, cellCenterZ, type SectorId } from '../world/types';
import type { EntityKind, EntitySpec } from './specs';

/** Ce que l'IA sait d'un joueur à l'instant t (fourni par l'hôte). */
export interface TargetInfo {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  alive: boolean;
  /** Caché dans un casier (identifiant du casier ou ''). */
  hiddenIn: string;
  crouching: boolean;
  lightOn: boolean;
  /** Portée du bruit continu produit (pas, respiration). */
  noise: number;
  speed: number;
  /** Nombre d'appareils électroniques allumés. */
  devices: number;
}

export interface NoiseEvent {
  x: number;
  z: number;
  /** Portée nominale en mètres. */
  radius: number;
  /** Identifiant du joueur, 'monde' ou 'entite'. */
  source: string;
  time: number;
}

export type AIEvent =
  | { type: 'attack'; uid: number; target: string; damage: number; injury: string; kind: EntityKind }
  | { type: 'sound'; uid: number; sound: string; x: number; z: number; radius: number }
  | { type: 'fake'; what: 'pas' | 'voix' | 'porte' | 'radio' | 'mirage'; x: number; z: number; as: string; uid: number }
  | { type: 'drain'; target: string; factor: number }
  | { type: 'infect'; target: string; amount: number }
  | { type: 'stress'; target: string; amount: number }
  | { type: 'marker'; id: number };

export interface AIContext {
  state: WorldState;
  targets: TargetInfo[];
  /** Bruits récents (les plus anciens sont purgés par le gestionnaire). */
  noises: NoiseEvent[];
  time: number;
  rng: Rng;
  /** Niveau de menace global de l'expédition, 0 à 1. */
  threat: number;
  emit(ev: AIEvent): void;
}

export interface EntitySnapshot {
  uid: number;
  kind: EntityKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  state: string;
  /** 0 = immobile, 1 = marche, 2 = course, 3 = attaque. */
  anim: number;
  visible: boolean;
}

export interface Memory {
  x: number;
  z: number;
  time: number;
  target: string;
}

const HIDE_MEMORY = 2.5;

export class EntityAgent {
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  state = 'dormant';
  stateTime = 0;
  anim = 0;
  visible = true;
  targetId = '';
  /** Dernière position connue d'une proie. */
  lastKnown: Memory | null = null;
  /** Régions où des joueurs ont été perçus, avec l'instant de la perception. */
  readonly heat = new Map<number, number>();
  cooldown = 0;
  /** Compteurs libres utilisés par les cerveaux. */
  timer = 0;
  counter = 0;
  goalX = 0;
  goalZ = 0;
  speed = 0;
  /** Perceptions rafraîchies à chaque « réflexion » (voir EntityAIManager). */
  seen: TargetInfo | null = null;
  heard: { x: number; z: number; margin: number; source: string } | null = null;
  observer: TargetInfo | null = null;
  /** Temps cumulé passé sous le regard d'un joueur. */
  gaze = 0;
  /** Traits tirés à chaque expédition (0 à 1). */
  traits = { aggression: 0.5, cunning: 0.5, patience: 0.5 };
  /** Délai avant le prochain réveil (état dormant). */
  wakeIn = 0;
  private path: number[] | null = null;
  private pathIndex = 0;
  private pathGoal = -1;
  private repath = 0;
  private doorWait = 0;
  private bashTimer = 0;
  private stuck = 0;
  /** Dernier instant où chaque joueur a été vu (pour savoir s'il s'est caché sous nos yeux). */
  private lastSeen = new Map<string, number>();
  private noiseCursor = 0;

  constructor(
    readonly uid: number,
    readonly spec: EntitySpec,
    readonly homeCells: number[],
  ) {}

  get kind(): EntityKind {
    return this.spec.kind;
  }

  setState(state: string): void {
    if (state !== this.state) {
      this.state = state;
      this.stateTime = 0;
      this.timer = 0;
      this.counter = 0;
    }
  }

  place(cell: number, ctx: AIContext): void {
    this.x = cellCenterX(cell);
    this.z = cellCenterZ(cell);
    this.y = ctx.state.grid.heightAt(this.x, this.z);
    this.clearPath();
  }

  sectorId(ctx: AIContext): SectorId | null {
    const c = ctx.state.grid.cellAt(this.x, this.z);
    const s = c >= 0 ? ctx.state.layout.sectorOf[c]! : -1;
    return s >= 0 ? SECTORS[s]!.id : null;
  }

  /* ---------------- perception ---------------- */

  distanceTo(t: { x: number; z: number }): number {
    return dist(this.x, this.z, t.x, t.z);
  }

  /** Le joueur est-il visible par l'entité ? */
  sees(t: TargetInfo, ctx: AIContext): boolean {
    if (!t.alive) return false;
    const d2 = dist2(this.x, this.z, t.x, t.z);
    if (t.hiddenIn) {
      // Un joueur caché n'est retrouvé que si on l'a vu entrer.
      return ctx.time - (this.lastSeen.get(t.id) ?? -99) < HIDE_MEMORY && d2 < 64;
    }
    let range = this.spec.visionRange;
    if (range <= 0) return false;
    if (t.lightOn) range *= 1.3;
    else if (!this.isLit(t, ctx)) range *= 0.45;
    if (t.crouching) range *= 0.75;
    if (d2 > range * range) return false;
    if (Math.abs(t.y - this.y) > 2.5) return false;
    if (d2 > 2.2 * 2.2) {
      const bearing = Math.atan2(t.x - this.x, t.z - this.z);
      if (Math.abs(angleDelta(this.yaw, bearing)) > this.spec.visionHalfFov) return false;
    }
    if (!ctx.state.grid.sight(this.x, this.z, t.x, t.z)) return false;
    this.lastSeen.set(t.id, ctx.time);
    return true;
  }

  /** Le secteur où se trouve le joueur est-il éclairé ? */
  isLit(t: { x: number; z: number }, ctx: AIContext): boolean {
    const c = ctx.state.grid.cellAt(t.x, t.z);
    const s = c >= 0 ? ctx.state.layout.sectorOf[c]! : -1;
    return s >= 0 && ctx.state.sectorPowered(SECTORS[s]!.id);
  }

  /** Lampe allumée visible en ligne de vue. */
  seesLight(t: TargetInfo, ctx: AIContext): boolean {
    if (!t.alive || !t.lightOn || t.hiddenIn || this.spec.lightSense <= 0) return false;
    if (dist2(this.x, this.z, t.x, t.z) > this.spec.lightSense * this.spec.lightSense) return false;
    return ctx.state.grid.sight(this.x, this.z, t.x, t.z);
  }

  /** Portée effective d'un bruit pour cette entité (négative si inaudible). */
  audibility(x: number, z: number, radius: number, ctx: AIContext): number {
    if (this.spec.hearing <= 0 || radius <= 0) return -1;
    const grid = ctx.state.grid;
    let reach = radius * this.spec.hearing;
    const c = grid.cellAt(x, z);
    const s = c >= 0 ? ctx.state.layout.sectorOf[c]! : -1;
    if (s >= 0) {
      const def = SECTORS[s]!;
      // Le bruit de fond masque les petits bruits ; le laboratoire acoustique les amplifie.
      reach *= def.id === 'acoustique' ? 1.8 : 1 - def.ambientNoise * 0.6;
    }
    const d = dist(this.x, this.z, x, z);
    if (d > reach) return -1;
    reach -= grid.soundOcclusion(x, z, this.x, this.z) * 5;
    return reach - d;
  }

  /**
   * Bruit le plus net perçu depuis le dernier appel (événements ponctuels et bruit
   * continu des joueurs). Renvoie null si rien n'est audible.
   */
  listen(ctx: AIContext): { x: number; z: number; margin: number; source: string } | null {
    let best: { x: number; z: number; margin: number; source: string } | null = null;
    for (let i = this.noiseCursor; i < ctx.noises.length; i++) {
      const n = ctx.noises[i]!;
      if (n.source === `e${this.uid}`) continue;
      const m = this.audibility(n.x, n.z, n.radius, ctx);
      if (m > 0 && (!best || m > best.margin)) best = { x: n.x, z: n.z, margin: m, source: n.source };
    }
    this.noiseCursor = ctx.noises.length;
    for (const t of ctx.targets) {
      if (!t.alive) continue;
      const m = this.audibility(t.x, t.z, t.hiddenIn ? t.noise * 0.3 : t.noise, ctx);
      if (m > 0 && (!best || m > best.margin)) best = { x: t.x, z: t.z, margin: m, source: t.id };
    }
    return best;
  }

  /** Appelé par le gestionnaire quand la liste des bruits est compactée. */
  shiftNoiseCursor(removed: number): void {
    this.noiseCursor = Math.max(0, this.noiseCursor - removed);
  }

  remember(x: number, z: number, target: string, ctx: AIContext): void {
    this.lastKnown = { x, z, time: ctx.time, target };
    const region = ctx.state.grid.regionAt(x, z);
    if (region >= 0) this.heat.set(region, ctx.time);
  }

  memoryFresh(ctx: AIContext): boolean {
    return this.lastKnown !== null && ctx.time - this.lastKnown.time < this.spec.memory;
  }

  /** Un joueur regarde-t-il l'entité (en ligne de vue, dans son champ de vision) ? */
  observedBy(ctx: AIContext, maxDist = 24): TargetInfo | null {
    for (const t of ctx.targets) {
      if (!t.alive || t.hiddenIn) continue;
      const d2 = dist2(this.x, this.z, t.x, t.z);
      if (d2 > maxDist * maxDist) continue;
      const bearing = Math.atan2(this.x - t.x, this.z - t.z);
      if (Math.abs(angleDelta(t.yaw, bearing)) > 0.6) continue;
      // Dans le noir sans lampe, on ne distingue rien au-delà de quelques mètres.
      if (!t.lightOn && !this.isLit(this, ctx) && d2 > 36) continue;
      if (ctx.state.grid.sight(t.x, t.z, this.x, this.z)) return t;
    }
    return null;
  }

  /** Rafraîchit vue et ouïe. Mémorise la position de ce qui est perçu. */
  perceive(ctx: AIContext): void {
    this.seen = null;
    let bd = Infinity;
    for (const t of ctx.targets) {
      if (!this.sees(t, ctx)) continue;
      const d = dist2(this.x, this.z, t.x, t.z);
      if (d < bd) {
        bd = d;
        this.seen = t;
      }
    }
    this.heard = this.listen(ctx);
    if (this.seen) {
      this.targetId = this.seen.id;
      this.remember(this.seen.x, this.seen.z, this.seen.id, ctx);
    } else if (this.heard) this.remember(this.heard.x, this.heard.z, this.heard.source, ctx);
  }

  target(ctx: AIContext): TargetInfo | null {
    for (const t of ctx.targets) if (t.id === this.targetId && t.alive) return t;
    return null;
  }

  nearestTarget(ctx: AIContext, filter?: (t: TargetInfo) => boolean): TargetInfo | null {
    let best: TargetInfo | null = null;
    let bd = Infinity;
    for (const t of ctx.targets) {
      if (!t.alive || (filter && !filter(t))) continue;
      const d = dist2(this.x, this.z, t.x, t.z);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  /* ---------------- déplacement ---------------- */

  clearPath(): void {
    this.path = null;
    this.pathGoal = -1;
  }

  /**
   * Fixe une destination. Renvoie false si elle est inatteignable avec les
   * capacités de l'entité.
   */
  goTo(x: number, z: number, ctx: AIContext): boolean {
    const grid = ctx.state.grid;
    const from = grid.cellAt(this.x, this.z);
    const to = grid.cellAt(x, z);
    if (to < 0 || from < 0) return false;
    this.goalX = x;
    this.goalZ = z;
    if (to === this.pathGoal && this.path && this.repath > 0) return true;
    const path = findPath(grid, ctx.state, from, to, this.spec.caps);
    if (!path) {
      this.clearPath();
      return false;
    }
    this.path = path;
    this.pathIndex = 0;
    this.pathGoal = to;
    this.repath = 2.5;
    return true;
  }

  goToCell(cell: number, ctx: AIContext): boolean {
    return this.goTo(cellCenterX(cell), cellCenterZ(cell), ctx);
  }

  hasPath(): boolean {
    return this.path !== null;
  }

  /** Cellule aléatoire du territoire (ou de la région donnée). */
  randomHomeCell(ctx: AIContext): number {
    return ctx.rng.pick(this.homeCells);
  }

  /**
   * Avance le long du chemin. Ouvre ou enfonce les portes rencontrées selon ses
   * capacités. Renvoie true une fois la destination atteinte (ou le chemin perdu).
   */
  follow(dt: number, speed: number, ctx: AIContext): boolean {
    this.repath -= dt;
    this.speed = 0;
    if (!this.path) return true;
    const grid = ctx.state.grid;
    const layout = grid.layout;
    const cur = grid.cellAt(this.x, this.z);
    const last = this.pathIndex >= this.path.length;
    let tx = this.goalX;
    let tz = this.goalZ;
    if (!last) {
      const next = this.path[this.pathIndex]!;
      tx = cellCenterX(next);
      tz = cellCenterZ(next);
      if (next !== cur) {
        const delta = next - cur;
        const dir: number = delta === -GRID_W ? 0 : delta === 1 ? 1 : delta === GRID_W ? 2 : delta === -1 ? 3 : -1;
        if (dir < 0) {
          // Écarté du chemin (collision) : on recalcule.
          this.pathGoal = -1;
          if (!this.goTo(this.goalX, this.goalZ, ctx)) return true;
          return false;
        }
        const e = layout.edges[cur * 4 + dir]!;
        if (e >= EDGE_DOOR_BASE) {
          const id = e - EDGE_DOOR_BASE;
          const def = layout.doors[id]!;
          if (def.kind !== 'arch' && grid.doorPos[id] !== DOOR_OPEN && this.kind !== 'statique') {
            // S'approche du seuil avant d'agir sur la porte.
            const ex = cellCenterX(cur) + DIR_DX[dir]! * (CELL / 2 - 0.55);
            const ez = cellCenterZ(cur) + DIR_DY[dir]! * (CELL / 2 - 0.55);
            if (dist2(this.x, this.z, ex, ez) > 0.2) {
              this.step(dt, ex, ez, speed, ctx);
              return false;
            }
            this.handleDoor(id, dt, ctx);
            return false;
          }
        }
      }
    }
    const before = dist(this.x, this.z, tx, tz);
    this.step(dt, tx, tz, speed, ctx);
    const after = dist(this.x, this.z, tx, tz);
    if (before - after < speed * dt * 0.2) this.stuck += dt;
    else this.stuck = 0;
    if (after < 0.3) {
      if (last) {
        this.clearPath();
        return true;
      }
      this.pathIndex++;
    }
    return false;
  }

  private handleDoor(id: number, dt: number, ctx: AIContext): void {
    const state = ctx.state;
    const door = state.doors[id]!;
    const def = state.layout.doors[id]!;
    this.anim = 0;
    if (state.isLocked(id) || def.kind === 'vent') {
      // Porte verrouillée, barricadée, ou grille : l'entité frappe jusqu'à céder.
      this.bashTimer -= dt;
      if (this.bashTimer > 0) return;
      this.bashTimer = def.kind === 'vent' ? 0.9 : 1.3;
      ctx.emit({ type: 'sound', uid: this.uid, sound: def.kind === 'vent' ? 'grille' : 'coup_porte', x: this.x, z: this.z, radius: 20 });
      if (def.kind === 'vent') {
        state.setDoor(id, { pos: DOOR_OPEN });
        return;
      }
      const dmg = this.kind === 'echo' ? 34 : 26;
      if (door.barricade > 0) state.setDoor(id, { barricade: Math.max(0, door.barricade - dmg) });
      else {
        const hp = door.hp - dmg;
        if (hp <= 0) state.setDoor(id, { hp: 0, locked: false, pos: DOOR_OPEN, barricadeSide: -1 });
        else state.setDoor(id, { hp });
      }
      return;
    }
    this.doorWait += dt;
    if (this.doorWait < (this.kind === 'echo' ? 0.25 : 0.7)) return;
    this.doorWait = 0;
    state.setDoor(id, { pos: DOOR_OPEN });
    ctx.emit({ type: 'sound', uid: this.uid, sound: 'porte', x: this.x, z: this.z, radius: this.kind === 'echo' ? 16 : 7 });
  }

  /** Déplacement élémentaire vers un point, avec glissement contre le décor. */
  step(dt: number, tx: number, tz: number, speed: number, ctx: AIContext): void {
    const dx = tx - this.x;
    const dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return;
    const move = Math.min(d, speed * dt);
    let nx = this.x + (dx / d) * move;
    let nz = this.z + (dz / d) * move;
    const grid = ctx.state.grid;
    if (this.kind !== 'statique' && this.stuck < 1.2) {
      const c = grid.cellAt(nx, nz);
      const crawl = c >= 0 && grid.layout.kind[c] === CellKind.Conduit;
      const r = grid.resolve(nx, nz, this.spec.radius, this.y, crawl ? 0.7 : Math.min(this.spec.height, 1.0));
      nx = r.x;
      nz = r.z;
    } else if (this.stuck > 2.2) this.stuck = 0;
    this.x = nx;
    this.z = nz;
    this.y = grid.heightAt(nx, nz);
    this.yaw = lerpAngle(this.yaw, Math.atan2(dx, dz), Math.min(1, dt * 8));
    this.speed = speed;
    this.anim = speed > 3.2 ? 2 : 1;
  }

  face(x: number, z: number, dt: number): void {
    this.yaw = lerpAngle(this.yaw, Math.atan2(x - this.x, z - this.z), Math.min(1, dt * 5));
  }

  snapshot(): EntitySnapshot {
    return {
      uid: this.uid,
      kind: this.kind,
      x: Math.round(this.x * 100) / 100,
      y: Math.round(this.y * 100) / 100,
      z: Math.round(this.z * 100) / 100,
      yaw: Math.round(this.yaw * 100) / 100,
      state: this.state,
      anim: this.anim,
      visible: this.visible,
    };
  }
}
