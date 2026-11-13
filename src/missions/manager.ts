/**
 * MissionManager — suit les objectifs de l'expédition (hôte), en produit un
 * instantané synchronisé et gère la phase d'extraction.
 */
import type { EntityKind } from '../ai/specs';
import { clamp01 } from '../core/math';
import { Rng } from '../core/rng';
import { DOOR_CLOSED } from '../world/grid';
import type { WorldState } from '../world/state';
import type { SectorId } from '../world/types';
import { OBJECTIVES, OBJECTIVE_BY_ID, type Consequence, type ObjectiveDef, type StepDef } from './objectives';

export type ObjectiveStatus = 'cache' | 'actif' | 'reussi' | 'echoue';

export interface ObjectiveState {
  id: string;
  status: ObjectiveStatus;
  step: number;
  /** Avancement de l'étape en cours. */
  cur: number;
  max: number;
  /** Secondes restantes avant échec (-1 = pas de limite). */
  timeLeft: number;
}

export type MissionPhase = 'expedition' | 'extraction' | 'terminee';

export interface MissionSnapshot {
  objectives: ObjectiveState[];
  phase: MissionPhase;
  outcome: '' | 'succes' | 'echec';
  elapsed: number;
  /** Compte à rebours une fois le sas ouvert (-1 tant qu'il est fermé). */
  extractionLeft: number;
  docs: string[];
  observed: string[];
  threat: number;
  deaths: number;
}

/** Temps laissé pour rejoindre le sas une fois celui-ci ouvert. */
export const EXTRACTION_WINDOW = 75;
/** Durée de référence d'une expédition pour la montée de la menace. */
const THREAT_RAMP = 1500;

export function pickObjectives(seed: string): { primary: ObjectiveDef; secondary: ObjectiveDef[] } {
  const rng = new Rng(`${seed}:mission`);
  const primaries = OBJECTIVES.filter((o) => o.kind === 'principal');
  const primary = rng.pick(primaries);
  const pool = rng.shuffle(OBJECTIVES.filter((o) => o.kind === 'secondaire'));
  const tags = new Set(primary.tags);
  const secondary: ObjectiveDef[] = [];
  for (const o of pool) {
    if (secondary.length >= 3) break;
    if (o.tags.some((t) => tags.has(t))) continue;
    o.tags.forEach((t) => tags.add(t));
    secondary.push(o);
  }
  return { primary, secondary };
}

export class MissionManager {
  readonly objectives: ObjectiveState[] = [];
  phase: MissionPhase = 'expedition';
  outcome: '' | 'succes' | 'echec' = '';
  elapsed = 0;
  extractionLeft = -1;
  deaths = 0;
  threatBonus = 0;
  readonly docs = new Set<string>();
  readonly observed = new Set<EntityKind>();
  /** Conséquences déclenchées depuis la dernière lecture (consommées par la session). */
  readonly consequences: Consequence[] = [];
  /** Objectifs dont l'état vient de changer (pour les notifications). */
  readonly changes: { id: string; status: ObjectiveStatus; step: number }[] = [];
  /** Vrai si l'instantané doit être rediffusé. */
  dirty = true;
  private collected = new Map<string, number>();
  private measured = new Map<SectorId, Set<number>>();
  private terminals = new Set<string>();
  private occupied = new Set<SectorId>();
  /** Secteurs dont au moins un sas a été vu ouvert ou déverrouillé (confiner suppose d'avoir ouvert). */
  private unsealed = new Set<SectorId>();

  constructor(
    private state: WorldState,
    seed: string,
    forcedPrimary?: string,
  ) {
    const pick = pickObjectives(seed);
    const primary = forcedPrimary ? (OBJECTIVE_BY_ID[forcedPrimary] ?? pick.primary) : pick.primary;
    for (const def of [primary, ...pick.secondary.filter((s) => s.id !== primary.id)]) {
      this.objectives.push({
        id: def.id,
        status: def.start ? 'cache' : 'actif',
        step: 0,
        cur: 0,
        max: 1,
        timeLeft: def.fail?.type === 'timer' && !def.start ? def.fail.seconds : -1,
      });
    }
  }

  get primary(): ObjectiveState {
    return this.objectives[0]!;
  }

  get threat(): number {
    const done = this.objectives.filter((o) => o.status === 'reussi').length;
    return clamp01(this.elapsed / THREAT_RAMP + done * 0.1 + this.threatBonus);
  }

  /* ---------------- faits rapportés par la session ---------------- */

  onPickup(item: string, data?: string): void {
    const add = (key: string): void => void this.collected.set(key, (this.collected.get(key) ?? 0) + 1);
    add(item);
    if (data) add(`${item}:${data}`);
  }

  onDocument(id: string): void {
    if (!this.docs.has(id)) {
      this.docs.add(id);
      this.dirty = true;
    }
  }

  onMeasure(sector: SectorId, region: number): void {
    let set = this.measured.get(sector);
    if (!set) this.measured.set(sector, (set = new Set()));
    set.add(region);
  }

  onObserve(kind: EntityKind): void {
    if (!this.observed.has(kind)) {
      this.observed.add(kind);
      this.dirty = true;
    }
  }

  onTerminalUse(id: string): void {
    this.terminals.add(id);
  }

  onDeath(): void {
    this.deaths++;
    this.dirty = true;
  }

  /** Secteurs où se trouve au moins un joueur vivant. */
  setOccupied(sectors: Iterable<SectorId>): void {
    this.occupied.clear();
    for (const s of sectors) this.occupied.add(s);
  }

  /* ---------------- évaluation ---------------- */

  private progress(step: StepDef): [number, number] {
    const st = this.state;
    switch (step.type) {
      case 'collect':
        return [this.collected.get(step.data ? `${step.item}:${step.data}` : step.item) ?? 0, step.count];
      case 'fixture': {
        const f = st.fixture(step.id);
        if (!f) return [1, 1]; // machine absente de cette carte : l'étape ne doit pas bloquer
        switch (step.cond) {
          case 'on':
            return [f.on && !f.broken ? 1 : 0, 1];
          case 'off':
            return [f.on ? 0 : 1, 1];
          case 'fused':
            return f.need === 0 ? [1, 1] : [Math.min(f.value, f.need), f.need];
          case 'running':
            return [f.t > 0 || f.on || f.value > 0 ? 1 : 0, 1];
          case 'value':
            return [Math.min(f.value, step.value ?? 1), step.value ?? 1];
        }
        break;
      }
      case 'flag':
        return [st.flag(step.name) ? 1 : 0, 1];
      case 'reach':
        return [this.occupied.has(step.sector) ? 1 : 0, 1];
      case 'power':
        return [(step.sector === 'principal' ? st.mainPower : st.sectorPowered(step.sector)) ? 1 : 0, 1];
      case 'terminal':
        return [this.terminals.has(step.id) ? 1 : 0, 1];
      case 'download': {
        const f = st.fixture(step.id);
        if (!f) return [1, 1];
        return [f.value > 0 ? 1 : 0, 1];
      }
      case 'measure': {
        let n = 0;
        for (const s of step.sectors) n += this.measured.get(s)?.size ?? 0;
        return [Math.min(n, step.count), step.count];
      }
      case 'camera': {
        const layout = st.layout;
        for (const c of st.cameras) {
          const region = st.grid.regionAt(c.x, c.z);
          if (region >= 0 && layout.regions[region]!.sector === step.sector) return [1, 1];
        }
        return [0, 1];
      }
      case 'documents':
        return [Math.min(this.docs.size, step.count), step.count];
      case 'observe':
        return [this.observed.has(step.kind) ? 1 : 0, 1];
      case 'markers':
        return [Math.min(st.markers.length, step.count), step.count];
      case 'seal': {
        let total = 0;
        let sealed = 0;
        for (const d of st.layout.doors) {
          if (d.kind !== 'gate') continue;
          const a = st.layout.regions[d.a]!.sector;
          const b = st.layout.regions[d.b]!.sector;
          if (a !== step.sector && b !== step.sector) continue;
          total++;
          const rt = st.doors[d.id]!;
          if (rt.pos === DOOR_CLOSED && rt.locked) sealed++;
        }
        if (sealed < total) this.unsealed.add(step.sector);
        // Tant qu'aucun sas n'a été ouvert, il n'y a rien à confiner : l'étape reste en attente.
        if (!this.unsealed.has(step.sector)) return [Math.max(0, total - 1), Math.max(1, total)];
        return [sealed, Math.max(1, total)];
      }
      case 'valves': {
        let total = 0;
        let closed = 0;
        for (const [id, f] of st.fixtures) {
          if (!id.startsWith('valve.')) continue;
          total++;
          if (!f.on) closed++;
        }
        return [closed, Math.max(1, total)];
      }
    }
    return [0, 1];
  }

  update(dt: number): void {
    if (this.phase === 'terminee') return;
    this.elapsed += dt;
    for (const o of this.objectives) {
      const def = OBJECTIVE_BY_ID[o.id]!;
      if (o.status === 'cache') {
        const [c, m] = this.progress(def.start!);
        if (c >= m) {
          o.status = 'actif';
          if (def.fail?.type === 'timer') o.timeLeft = def.fail.seconds;
          this.changes.push({ id: o.id, status: o.status, step: 0 });
          this.dirty = true;
        }
        continue;
      }
      if (o.status !== 'actif') continue;
      // Conditions d'échec.
      let failed = false;
      if (def.fail?.type === 'timer') {
        const before = Math.ceil(o.timeLeft);
        o.timeLeft -= dt;
        if (Math.ceil(o.timeLeft) !== before && Math.ceil(o.timeLeft) % 10 === 0) this.dirty = true;
        failed = o.timeLeft <= 0;
      } else if (def.fail?.type === 'flag') failed = this.state.flag(def.fail.name) > 0;
      else if (def.fail?.type === 'deaths') failed = this.deaths >= def.fail.count;
      if (failed && def.kind === 'secondaire') {
        o.status = 'echoue';
        o.timeLeft = -1;
        if (def.penalty) this.consequences.push(def.penalty);
        this.changes.push({ id: o.id, status: o.status, step: o.step });
        this.dirty = true;
        continue;
      }
      // Avancement : plusieurs étapes peuvent être franchies d'un coup.
      for (let guard = 0; guard < 8; guard++) {
        const [cur, max] = this.progress(def.steps[o.step]!);
        if (cur !== o.cur || max !== o.max) {
          o.cur = cur;
          o.max = max;
          this.dirty = true;
        }
        if (cur < max) break;
        o.step++;
        this.dirty = true;
        if (o.step >= def.steps.length) {
          o.status = 'reussi';
          o.step = def.steps.length - 1;
          o.timeLeft = -1;
          if (def.consequence) this.consequences.push(def.consequence);
          this.changes.push({ id: o.id, status: o.status, step: o.step });
          break;
        }
        this.changes.push({ id: o.id, status: o.status, step: o.step });
      }
    }
    if (this.phase === 'expedition' && this.primary.status === 'reussi') {
      this.phase = 'extraction';
      this.state.setFlag('extraction_ready', 1);
      this.dirty = true;
    }
    if (this.phase === 'extraction' && this.state.flag('airlock') === 2) {
      if (this.extractionLeft < 0) {
        this.extractionLeft = EXTRACTION_WINDOW;
        this.dirty = true;
      } else {
        const before = Math.ceil(this.extractionLeft);
        this.extractionLeft = Math.max(0, this.extractionLeft - dt);
        if (Math.ceil(this.extractionLeft) !== before) this.dirty = true;
      }
    }
  }

  /** Clôt l'expédition (appelé par la session lorsque plus personne n'est en jeu). */
  finish(extracted: number): void {
    if (this.phase === 'terminee') return;
    this.phase = 'terminee';
    this.outcome = extracted > 0 && this.primary.status === 'reussi' ? 'succes' : 'echec';
    this.dirty = true;
  }

  /* ---------------- sérialisation ---------------- */

  snapshot(): MissionSnapshot {
    return {
      objectives: this.objectives.map((o) => ({ ...o, timeLeft: Math.ceil(o.timeLeft) })),
      phase: this.phase,
      outcome: this.outcome,
      elapsed: Math.floor(this.elapsed),
      extractionLeft: Math.ceil(this.extractionLeft),
      docs: Array.from(this.docs),
      observed: Array.from(this.observed),
      threat: Math.round(this.threat * 100) / 100,
      deaths: this.deaths,
    };
  }

  /** État interne complet, pour la reprise d'autorité par un nouvel hôte. */
  exportFull(): { snap: MissionSnapshot; collected: [string, number][]; measured: [SectorId, number[]][]; terminals: string[]; threatBonus: number; unsealed: SectorId[] } {
    return {
      snap: this.snapshot(),
      collected: Array.from(this.collected),
      measured: Array.from(this.measured, ([s, set]) => [s, Array.from(set)]),
      terminals: Array.from(this.terminals),
      threatBonus: this.threatBonus,
      unsealed: Array.from(this.unsealed),
    };
  }

  importFull(data: ReturnType<MissionManager['exportFull']>): void {
    this.load(data.snap);
    this.collected = new Map(data.collected);
    this.measured = new Map(data.measured.map(([s, list]) => [s, new Set(list)]));
    this.terminals = new Set(data.terminals);
    this.threatBonus = data.threatBonus;
    this.unsealed = new Set(data.unsealed ?? []);
  }

  load(s: MissionSnapshot): void {
    this.objectives.length = 0;
    for (const o of s.objectives) this.objectives.push({ ...o });
    this.phase = s.phase;
    this.outcome = s.outcome;
    this.elapsed = s.elapsed;
    this.extractionLeft = s.extractionLeft;
    this.deaths = s.deaths;
    this.docs.clear();
    for (const d of s.docs) this.docs.add(d);
    this.observed.clear();
    for (const k of s.observed) this.observed.add(k as EntityKind);
  }
}

/** Libellé de l'étape en cours d'un objectif. */
export function currentStepLabel(o: ObjectiveState): string {
  const def = OBJECTIVE_BY_ID[o.id];
  if (!def) return '';
  const step = def.steps[Math.min(o.step, def.steps.length - 1)]!;
  return o.max > 1 ? `${step.label} (${o.cur}/${o.max})` : step.label;
}
