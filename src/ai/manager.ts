/**
 * EntityAIManager — crée, fait vivre et sérialise les entités.
 * S'exécute uniquement chez l'hôte ; les clients reçoivent des instantanés.
 */
import { Rng } from '../core/rng';
import { SECTORS } from '../world/sectors';
import type { WorldState } from '../world/state';
import { CellKind, DIR_DX, DIR_DY, GRID_W } from '../world/types';
import { EntityAgent, type AIContext, type AIEvent, type EntitySnapshot, type NoiseEvent, type TargetInfo } from './agent';
import { BRAINS } from './brains';
import { ENTITY_KINDS, ENTITY_SPECS, type EntityKind } from './specs';

/** Intervalle entre deux « réflexions » d'une entité proche des joueurs. */
const THINK_NEAR = 0.2;
/** Loin de tout joueur, l'entité réfléchit moins souvent (coût IA réduit). */
const THINK_FAR = 0.6;
const NOISE_LIFETIME = 3;

export class EntityAIManager {
  readonly agents: EntityAgent[] = [];
  readonly noises: NoiseEvent[] = [];
  /** Événements produits pendant la dernière mise à jour (attaques, sons, leurres). */
  readonly events: AIEvent[] = [];
  threat = 0;
  private time = 0;
  private rng: Rng;
  private thinkTimers = new Map<number, number>();
  private ctx: AIContext;

  constructor(
    readonly state: WorldState,
    seed: string,
  ) {
    this.rng = new Rng(`${seed}:entites`);
    this.ctx = {
      state,
      targets: [],
      noises: this.noises,
      time: 0,
      rng: this.rng,
      threat: 0,
      emit: (ev) => this.events.push(ev),
    };
  }

  /** Cellules du territoire d'une espèce. */
  private homeCells(kind: EntityKind): number[] {
    const layout = this.state.layout;
    const spec = ENTITY_SPECS[kind];
    const cells: number[] = [];
    if (kind === 'rampant') {
      // Conduits et abords des grilles de tout le complexe.
      for (let c = 0; c < layout.kind.length; c++) if (layout.kind[c] === CellKind.Conduit) cells.push(c);
      for (const d of layout.doors) {
        if (d.kind !== 'vent') continue;
        cells.push(d.cell, d.cell + DIR_DX[d.dir]! + DIR_DY[d.dir]! * GRID_W);
      }
      if (cells.length > 0) return cells;
    }
    const home = spec.home.map((id) => SECTORS.findIndex((s) => s.id === id));
    for (const r of layout.regions) {
      if (r.kind !== 'room' && r.kind !== 'corridor') continue;
      if (r.secret || !home.includes(SECTORS.findIndex((s) => s.id === r.sector))) continue;
      for (const c of r.cells) if (!layout.blocked[c] && layout.kind[c] !== CellKind.Stairs) cells.push(c);
    }
    return cells;
  }

  /** Fait apparaître toutes les entités de l'expédition. */
  spawnAll(): void {
    let uid = 1;
    for (const kind of ENTITY_KINDS) {
      const spec = ENTITY_SPECS[kind];
      const home = this.homeCells(kind);
      if (home.length === 0) continue;
      // Le Phototrope ne hante qu'un de ses secteurs possibles par expédition.
      let cells = home;
      if (kind === 'phototrope') {
        const sector = this.rng.pick(spec.home);
        const idx = SECTORS.findIndex((s) => s.id === sector);
        const only = home.filter((c) => this.state.layout.sectorOf[c] === idx);
        if (only.length > 0) cells = only;
      }
      for (let i = 0; i < spec.count; i++) {
        const agent = new EntityAgent(uid++, spec, cells);
        agent.state = BRAINS[kind].initial;
        agent.traits = { aggression: this.rng.range(0.2, 0.9), cunning: this.rng.range(0.2, 0.95), patience: this.rng.range(0.15, 0.9) };
        agent.place(this.rng.pick(cells), this.ctx);
        agent.yaw = this.rng.range(0, Math.PI * 2);
        if (kind === 'visiteur') {
          agent.visible = false;
          agent.wakeIn = 55 + (1 - agent.traits.aggression) * 70;
        }
        this.agents.push(agent);
        this.thinkTimers.set(agent.uid, this.rng.range(0, THINK_NEAR));
      }
    }
  }

  addNoise(x: number, z: number, radius: number, source: string): void {
    if (radius > 0) this.noises.push({ x, z, radius, source, time: this.time });
  }

  update(dt: number, targets: TargetInfo[], threat: number): void {
    this.time += dt;
    this.threat = threat;
    this.events.length = 0;
    const ctx = this.ctx;
    ctx.targets = targets;
    ctx.time = this.time;
    ctx.threat = threat;

    // Purge des bruits anciens (en gardant les curseurs d'écoute cohérents).
    let expired = 0;
    while (expired < this.noises.length && this.time - this.noises[expired]!.time > NOISE_LIFETIME) expired++;
    if (expired > 0) {
      this.noises.splice(0, expired);
      for (const a of this.agents) a.shiftNoiseCursor(expired);
    }

    // La purge thermique détruit les Porteurs.
    if (this.state.flag('purged')) {
      for (let i = this.agents.length - 1; i >= 0; i--) if (this.agents[i]!.kind === 'porteur') this.agents.splice(i, 1);
    }

    for (const a of this.agents) {
      a.stateTime += dt;
      const brain = BRAINS[a.kind];
      let timer = this.thinkTimers.get(a.uid)! - dt;
      if (timer <= 0) {
        let near = false;
        for (const t of targets) {
          const dx = t.x - a.x;
          const dz = t.z - a.z;
          if (dx * dx + dz * dz < 45 * 45) {
            near = true;
            break;
          }
        }
        const interval = near ? THINK_NEAR : THINK_FAR;
        brain.think(a, ctx, interval);
        timer += interval;
      }
      this.thinkTimers.set(a.uid, timer);
      brain.act(a, ctx, dt);
    }
  }

  snapshots(): EntitySnapshot[] {
    return this.agents.map((a) => a.snapshot());
  }

  /**
   * Reprise d'autorité : reconstruit les entités à partir des derniers instantanés
   * reçus de l'ancien hôte. Elles repartent d'un état prudent, à la même position.
   */
  restore(snaps: EntitySnapshot[]): void {
    this.agents.length = 0;
    for (const s of snaps) {
      const spec = ENTITY_SPECS[s.kind];
      const home = this.homeCells(s.kind);
      if (home.length === 0) continue;
      const a = new EntityAgent(s.uid, spec, home);
      a.x = s.x;
      a.y = s.y;
      a.z = s.z;
      a.yaw = s.yaw;
      a.visible = s.visible;
      a.traits = { aggression: this.rng.range(0.2, 0.9), cunning: this.rng.range(0.2, 0.95), patience: this.rng.range(0.15, 0.9) };
      a.state = s.kind === 'visiteur' ? (s.visible ? 'observation' : 'dormant') : BRAINS[s.kind].initial;
      a.wakeIn = 20;
      this.agents.push(a);
      this.thinkTimers.set(a.uid, this.rng.range(0, THINK_NEAR));
    }
  }
}
