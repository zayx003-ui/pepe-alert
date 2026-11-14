/**
 * État dynamique du complexe (portes, machines, objets au sol, énergie, ascenseur).
 *
 * Toute modification passe par une opération sérialisable (`WorldOp`). L'hôte les
 * produit (`commit`) et les diffuse ; les clients les rejouent (`apply`). L'état
 * complet se sérialise pour les connexions tardives, les reconnexions et la
 * reprise d'autorité après le départ de l'hôte.
 */
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { DOOR_AJAR, DOOR_CLOSED, DOOR_OPEN, WorldGrid } from './grid';
import type { DoorQuery } from './nav';
import { SECTOR_BY_ID } from './sectors';
import type { FixtureDef, Layout, SectorId } from './types';

export interface DoorRt {
  pos: number;
  locked: boolean;
  /** Solidité de la barricade (0 = aucune). */
  barricade: number;
  /** Région depuis laquelle la barricade a été posée. */
  barricadeSide: number;
  /** Intégrité du battant face aux assauts des entités. */
  hp: number;
}

export interface FixtureRt {
  on: boolean;
  broken: boolean;
  /** Compteur propre à la machine (fusibles posés, fréquence, cellules…). */
  value: number;
  need: number;
  /** Secondes restantes du processus en cours (0 = aucun). */
  t: number;
  total: number;
}

export interface WorldItem {
  uid: number;
  item: string;
  x: number;
  y: number;
  z: number;
  data?: string;
  charge: number;
}

export interface Marker {
  id: number;
  x: number;
  y: number;
  z: number;
}

export interface PlacedCamera {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  owner: string;
}

export type WorldOp =
  | { k: 'door'; id: number; s: DoorRt }
  | { k: 'fx'; id: string; s: FixtureRt }
  | { k: 'item+'; it: WorldItem }
  | { k: 'item-'; uid: number }
  | { k: 'marker'; m: Marker }
  | { k: 'marker-'; id: number }
  | { k: 'cam+'; c: PlacedCamera }
  | { k: 'cam-'; id: number }
  | { k: 'elev'; y: number; target: number }
  | { k: 'flag'; name: string; v: number }
  | { k: 'light'; id: number; mode: number };

export interface WorldSnapshot {
  doors: DoorRt[];
  fixtures: [string, FixtureRt][];
  items: WorldItem[];
  markers: Marker[];
  cameras: PlacedCamera[];
  elevator: { y: number; target: number };
  flags: Record<string, number>;
  lights: number[];
  time: number;
  nextUid: number;
}

export interface WorldEvents {
  op: WorldOp;
  /** Un processus temporisé vient de s'achever (hôte uniquement). */
  done: { id: string; def: FixtureDef };
}

/** Fusibles manquants au départ dans le tableau de chaque secteur. */
export const FUSES_NEEDED: Record<SectorId, number> = {
  accueil: 0,
  administration: 0,
  medical: 3,
  maintenance: 1,
  archives: 1,
  acoustique: 1,
  bio: 1,
  serveurs: 1,
  centrale: 2,
  quarantaine: 1,
  experimental: 1,
  noyau: 0,
};

/** Durées des processus temporisés, en secondes. */
export const PROCESS_TIME = {
  generator_aux: 15,
  generator_main: 45,
  airlock: 90,
  purge: 100,
  detune: 120,
  download: 40,
  probe: 45,
  burn: 8,
  medstation: 60,
} as const;

export class WorldState implements DoorQuery {
  readonly grid: WorldGrid;
  readonly doors: DoorRt[] = [];
  readonly fixtures = new Map<string, FixtureRt>();
  readonly fixtureDefs = new Map<string, FixtureDef>();
  readonly items = new Map<number, WorldItem>();
  readonly markers: Marker[] = [];
  readonly cameras: PlacedCamera[] = [];
  readonly elevator = { y: 0, target: 0 };
  readonly flags: Record<string, number> = {};
  readonly lightMode: Uint8Array;
  readonly events = new EventBus<WorldEvents>();
  /** Opérations produites par l'hôte et pas encore diffusées. */
  readonly outbox: WorldOp[] = [];
  time = 0;
  private nextUid = 100000;

  constructor(readonly layout: Layout) {
    this.grid = new WorldGrid(layout);
    const rng = new Rng(`${layout.seed}:etat`);
    for (const d of layout.doors) {
      let pos = d.kind === 'arch' ? DOOR_OPEN : DOOR_CLOSED;
      const locked = d.lock !== null;
      if (d.kind === 'door' && !locked) {
        const roll = rng.next();
        if (roll < 0.14) pos = DOOR_OPEN;
        else if (roll < 0.22) pos = DOOR_AJAR;
      }
      this.doors.push({
        pos,
        locked,
        barricade: d.barricaded ? 100 : 0,
        barricadeSide: d.barricaded && d.lock?.type === 'latch' ? d.lock.side : -1,
        hp: 100,
      });
      this.grid.doorPos[d.id] = pos;
    }
    for (const f of layout.fixtures) {
      const rt: FixtureRt = { on: false, broken: false, value: 0, need: 0, t: 0, total: 0 };
      switch (f.type) {
        case 'fusebox':
          rt.need = FUSES_NEEDED[f.sector];
          rt.on = rt.need === 0;
          break;
        case 'valve':
        case 'cryo':
        case 'camera':
          rt.on = true;
          break;
        case 'antenna':
          rt.broken = true;
          break;
        case 'core_console':
          rt.need = 2;
          break;
        case 'incinerator':
          rt.need = 3;
          break;
        case 'sampler':
          rt.need = 2;
          break;
        default:
          break;
      }
      this.fixtures.set(f.id, rt);
      this.fixtureDefs.set(f.id, f);
    }
    for (const it of layout.items) {
      this.items.set(it.uid, { uid: it.uid, item: it.item, x: it.x, y: it.y, z: it.z, data: it.data, charge: -1 });
    }
    this.lightMode = Uint8Array.from(layout.lights, (l) => l.mode);
    if (layout.elevator) {
      this.elevator.y = layout.elevator.topY;
      this.grid.elevatorY = this.elevator.y;
    }
  }

  /* ---------------- lecture ---------------- */

  fixture(id: string): FixtureRt | undefined {
    return this.fixtures.get(id);
  }

  isLocked(id: number): boolean {
    const d = this.doors[id]!;
    return d.locked || d.barricade > 0;
  }

  flag(name: string): number {
    return this.flags[name] ?? 0;
  }

  get mainPower(): boolean {
    return this.fixtures.get('generator_main.centrale')?.on === true;
  }

  get auxPower(): boolean {
    return this.fixtures.get('generator_aux.maintenance')?.on === true;
  }

  /** Un secteur est alimenté si son tableau est complet et qu'un générateur le dessert. */
  sectorPowered(sector: SectorId): boolean {
    const box = this.fixtures.get(`fusebox.${sector}`);
    if (box && (box.broken || box.value < box.need)) return false;
    if (sector === 'accueil') return true; // alimentation de secours autonome
    if (this.mainPower) return true;
    return this.auxPower && SECTOR_BY_ID[sector].tier <= 1;
  }

  newUid(): number {
    return this.nextUid++;
  }

  /* ---------------- écriture ---------------- */

  /** Applique une opération reçue (ou produite localement). */
  apply(op: WorldOp): void {
    switch (op.k) {
      case 'door':
        this.doors[op.id] = op.s;
        this.grid.doorPos[op.id] = op.s.pos;
        break;
      case 'fx':
        this.fixtures.set(op.id, op.s);
        break;
      case 'item+':
        this.items.set(op.it.uid, op.it);
        if (op.it.uid >= this.nextUid) this.nextUid = op.it.uid + 1;
        break;
      case 'item-':
        this.items.delete(op.uid);
        break;
      case 'marker':
        this.markers.push(op.m);
        break;
      case 'marker-': {
        const i = this.markers.findIndex((m) => m.id === op.id);
        if (i >= 0) this.markers.splice(i, 1);
        break;
      }
      case 'cam+':
        this.cameras.push(op.c);
        break;
      case 'cam-': {
        const i = this.cameras.findIndex((c) => c.id === op.id);
        if (i >= 0) this.cameras.splice(i, 1);
        break;
      }
      case 'elev':
        this.elevator.y = op.y;
        this.elevator.target = op.target;
        this.grid.elevatorY = op.y;
        break;
      case 'flag':
        this.flags[op.name] = op.v;
        break;
      case 'light':
        this.lightMode[op.id] = op.mode;
        break;
    }
    this.events.emit('op', op);
  }

  /** Hôte : applique l'opération et la met en file pour diffusion. */
  commit(op: WorldOp): void {
    this.apply(op);
    this.outbox.push(op);
  }

  setDoor(id: number, patch: Partial<DoorRt>): void {
    this.commit({ k: 'door', id, s: { ...this.doors[id]!, ...patch } });
  }

  setFixture(id: string, patch: Partial<FixtureRt>): void {
    const cur = this.fixtures.get(id);
    if (cur) this.commit({ k: 'fx', id, s: { ...cur, ...patch } });
  }

  setFlag(name: string, v: number): void {
    if (this.flags[name] !== v) this.commit({ k: 'flag', name, v });
  }

  /* ---------------- simulation ---------------- */

  /**
   * Avance l'ascenseur (tous les pairs) et, sur l'hôte, les processus temporisés.
   */
  update(dt: number, authoritative: boolean): void {
    this.time += dt;
    const lift = this.layout.elevator;
    if (lift) {
      const targetY = this.elevator.target === 0 ? lift.topY : lift.bottomY;
      if (this.elevator.y !== targetY) {
        const step = 1.1 * dt;
        const dy = targetY - this.elevator.y;
        this.elevator.y = Math.abs(dy) <= step ? targetY : this.elevator.y + Math.sign(dy) * step;
        this.grid.elevatorY = this.elevator.y;
        if (authoritative && this.elevator.y === targetY) {
          this.commit({ k: 'elev', y: targetY, target: this.elevator.target });
          this.setDoor(this.elevator.target === 0 ? lift.doorTop : lift.doorBottom, { pos: DOOR_OPEN, locked: false });
        }
      }
    }
    for (const [id, f] of this.fixtures) {
      if (f.t <= 0) continue;
      f.t -= dt;
      if (f.t > 0 || !authoritative) {
        if (f.t < 0) f.t = 0;
        continue;
      }
      f.t = 0;
      this.finishProcess(id, f);
    }
  }

  private finishProcess(id: string, f: FixtureRt): void {
    const def = this.fixtureDefs.get(id)!;
    switch (def.type) {
      case 'generator_aux':
      case 'generator_main':
        this.setFixture(id, { on: true, t: 0 });
        break;
      case 'airlock':
        this.setFixture(id, { on: true, t: 0 });
        this.setFlag('airlock', 2);
        break;
      case 'purge':
        this.setFixture(id, { on: false, t: 0, value: 1 });
        this.setFlag('purged', 1);
        break;
      case 'core_console':
        this.setFixture(id, { on: true, t: 0 });
        this.setFlag('detuned', 1);
        break;
      case 'terminal':
        this.setFixture(id, { t: 0, value: f.value + 1 });
        break;
      case 'probe':
        this.setFixture(id, { t: 0, value: 1, on: false });
        break;
      case 'incinerator':
        this.setFixture(id, { t: 0, on: false });
        break;
      default:
        this.setFixture(id, { t: 0 });
        break;
    }
    this.events.emit('done', { id, def });
  }

  /** Lance le déplacement de la cabine (hôte). */
  moveElevator(target: number): void {
    const lift = this.layout.elevator;
    if (!lift) return;
    this.setDoor(lift.doorTop, { pos: DOOR_CLOSED, locked: true });
    this.setDoor(lift.doorBottom, { pos: DOOR_CLOSED, locked: true });
    this.commit({ k: 'elev', y: this.elevator.y, target });
  }

  /* ---------------- sérialisation ---------------- */

  snapshot(): WorldSnapshot {
    return {
      doors: this.doors.map((d) => ({ ...d })),
      fixtures: Array.from(this.fixtures, ([id, f]) => [id, { ...f }]),
      items: Array.from(this.items.values(), (i) => ({ ...i })),
      markers: this.markers.map((m) => ({ ...m })),
      cameras: this.cameras.map((c) => ({ ...c })),
      elevator: { ...this.elevator },
      flags: { ...this.flags },
      lights: Array.from(this.lightMode),
      time: this.time,
      nextUid: this.nextUid,
    };
  }

  load(s: WorldSnapshot): void {
    s.doors.forEach((d, i) => this.apply({ k: 'door', id: i, s: { ...d } }));
    for (const [id, f] of s.fixtures) this.apply({ k: 'fx', id, s: { ...f } });
    for (const uid of Array.from(this.items.keys())) this.apply({ k: 'item-', uid });
    for (const it of s.items) this.apply({ k: 'item+', it: { ...it } });
    this.markers.length = 0;
    for (const m of s.markers) this.apply({ k: 'marker', m: { ...m } });
    for (const c of this.cameras.slice()) this.apply({ k: 'cam-', id: c.id });
    for (const c of s.cameras) this.apply({ k: 'cam+', c: { ...c } });
    this.apply({ k: 'elev', y: s.elevator.y, target: s.elevator.target });
    for (const [name, v] of Object.entries(s.flags)) this.apply({ k: 'flag', name, v });
    s.lights.forEach((mode, id) => {
      if (this.lightMode[id] !== mode) this.apply({ k: 'light', id, mode });
    });
    this.time = s.time;
    this.nextUid = Math.max(this.nextUid, s.nextUid);
  }
}
