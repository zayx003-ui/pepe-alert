import { describe, expect, it } from 'vitest';
import { EntityAgent, type AIContext, type AIEvent, type TargetInfo } from '../../src/ai/agent';
import { BRAINS } from '../../src/ai/brains';
import { EntityAIManager } from '../../src/ai/manager';
import { ENTITY_KINDS, ENTITY_SPECS, type EntityKind } from '../../src/ai/specs';
import { Rng } from '../../src/core/rng';
import { generateLayout } from '../../src/world/generator';
import { DOOR_CLOSED, DOOR_OPEN } from '../../src/world/grid';
import { findPath } from '../../src/world/nav';
import { WorldState } from '../../src/world/state';
import { DIR_DX, DIR_DY, GRID_W, cellCenterX, cellCenterZ } from '../../src/world/types';

const layout = generateLayout('ENTITES');

function target(x: number, z: number, extra: Partial<TargetInfo> = {}): TargetInfo {
  return { id: 'p1', x, y: 0, z, yaw: 0, alive: true, hiddenIn: '', crouching: false, lightOn: false, noise: 0, speed: 0, devices: 0, ...extra };
}

interface Rig {
  world: WorldState;
  ctx: AIContext;
  events: AIEvent[];
  agent: EntityAgent;
  run(seconds: number, each?: () => void): void;
}

/** Monte une entité isolée dans une salle donnée. */
function rig(kind: EntityKind, cell: number): Rig {
  const world = new WorldState(layout);
  const events: AIEvent[] = [];
  const ctx: AIContext = { state: world, targets: [], noises: [], time: 0, rng: new Rng('test'), threat: 0.3, emit: (e) => events.push(e) };
  const home = layout.regions[layout.region[cell]!]!.cells;
  const agent = new EntityAgent(1, ENTITY_SPECS[kind], home);
  agent.state = BRAINS[kind].initial;
  agent.place(cell, ctx);
  const brain = BRAINS[kind];
  let acc = 0;
  return {
    world,
    ctx,
    events,
    agent,
    run(seconds, each) {
      for (let t = 0; t < seconds; t += 0.05) {
        each?.();
        ctx.time += 0.05;
        agent.stateTime += 0.05;
        acc += 0.05;
        if (acc >= 0.2) {
          acc = 0;
          brain.think(agent, ctx, 0.2);
        }
        brain.act(agent, ctx, 0.05);
      }
    },
  };
}

/** Deux cellules d'une même grande salle, sans meuble central entre elles. */
function roomPair(minDist: number): { a: number; b: number; region: number } {
  for (const r of layout.regions) {
    if (r.kind !== 'room' || r.w < 4 || r.h < 3 || r.sector === 'accueil') continue;
    const free = r.cells.filter((c) => !layout.blocked[c]);
    for (const a of free) {
      for (const b of free) {
        const d = Math.hypot(cellCenterX(a) - cellCenterX(b), cellCenterZ(a) - cellCenterZ(b));
        if (d < minDist) continue;
        const w = new WorldState(layout);
        if (w.grid.sight(cellCenterX(a), cellCenterZ(a), cellCenterX(b), cellCenterZ(b))) return { a, b, region: r.id };
      }
    }
  }
  throw new Error('aucune paire');
}

/** Porte simple séparant deux régions : cellule de chaque côté. */
function doorPair(): { id: number; a: number; b: number } {
  const d = layout.doors.find((x) => x.kind === 'door' && !x.lock && !layout.blocked[x.cell])!;
  return { id: d.id, a: d.cell, b: d.cell + DIR_DX[d.dir]! + DIR_DY[d.dir]! * GRID_W };
}

describe('fiches', () => {
  it('six entités originales, chacune avec une fiche complète', () => {
    expect(ENTITY_KINDS).toHaveLength(6);
    for (const k of ENTITY_KINDS) {
      const s = ENTITY_SPECS[k];
      for (const text of [s.summary, s.intelligence, s.behaviour, s.evasion]) expect(text.length, k).toBeGreaterThan(40);
      expect(BRAINS[k]).toBeDefined();
    }
  });
});

describe('perception', () => {
  it('voit devant soi mais pas à travers un mur ni une porte fermée', () => {
    const pair = roomPair(4);
    const r = rig('porteur', pair.a);
    const t = target(cellCenterX(pair.b), cellCenterZ(pair.b), { lightOn: true });
    r.agent.yaw = Math.atan2(t.x - r.agent.x, t.z - r.agent.z);
    expect(r.agent.sees(t, r.ctx)).toBe(true);
    r.agent.yaw += Math.PI;
    expect(r.agent.sees(t, r.ctx)).toBe(false);

    const dp = doorPair();
    const r2 = rig('porteur', dp.a);
    const t2 = target(cellCenterX(dp.b), cellCenterZ(dp.b), { lightOn: true });
    r2.agent.yaw = Math.atan2(t2.x - r2.agent.x, t2.z - r2.agent.z);
    r2.world.setDoor(dp.id, { pos: DOOR_CLOSED });
    expect(r2.agent.sees(t2, r2.ctx)).toBe(false);
    r2.world.setDoor(dp.id, { pos: DOOR_OPEN });
    expect(r2.agent.sees(t2, r2.ctx)).toBe(true);
  });

  it('distingue moins bien un joueur accroupi dans le noir', () => {
    const pair = roomPair(8);
    const r = rig('visiteur', pair.a);
    const base = target(cellCenterX(pair.b), cellCenterZ(pair.b));
    r.agent.yaw = Math.atan2(base.x - r.agent.x, base.z - r.agent.z);
    const d = r.agent.distanceTo(base);
    // Secteur sans courant, lampe éteinte : portée réduite à 45 %.
    expect(r.agent.sees({ ...base, lightOn: true }, r.ctx)).toBe(true);
    if (d > ENTITY_SPECS.visiteur.visionRange * 0.45 * 0.75) expect(r.agent.sees({ ...base, crouching: true }, r.ctx)).toBe(false);
  });

  it("entend un bruit proche, pas un bruit lointain ni derrière plusieurs murs", () => {
    const pair = roomPair(4);
    const r = rig('porteur', pair.a);
    expect(r.agent.audibility(cellCenterX(pair.b), cellCenterZ(pair.b), 12, r.ctx)).toBeGreaterThan(0);
    expect(r.agent.audibility(cellCenterX(pair.b), cellCenterZ(pair.b), 1, r.ctx)).toBeLessThan(0);
    expect(r.agent.audibility(r.agent.x + 30, r.agent.z + 30, 12, r.ctx)).toBeLessThan(0);
  });

  it("un joueur caché dans un casier n'est retrouvé que s'il a été vu en train d'y entrer", () => {
    const pair = roomPair(4);
    const r = rig('porteur', pair.a);
    const t = target(cellCenterX(pair.b), cellCenterZ(pair.b), { lightOn: true });
    r.agent.yaw = Math.atan2(t.x - r.agent.x, t.z - r.agent.z);
    expect(r.agent.sees({ ...t, hiddenIn: 'locker.x' }, r.ctx)).toBe(false);
    expect(r.agent.sees(t, r.ctx)).toBe(true);
    expect(r.agent.sees({ ...t, hiddenIn: 'locker.x' }, r.ctx)).toBe(true);
    r.ctx.time += 10;
    expect(r.agent.sees({ ...t, hiddenIn: 'locker.x' }, r.ctx)).toBe(false);
  });
});

describe('navigation', () => {
  it('les capacités déterminent les chemins : porte fermée, conduit, sas', () => {
    const world = new WorldState(layout);
    const dp = doorPair();
    world.setDoor(dp.id, { pos: DOOR_CLOSED, locked: false });
    const opener = ENTITY_SPECS.visiteur.caps;
    const noHands = ENTITY_SPECS.porteur.caps;
    const direct = findPath(world.grid, world, dp.a, dp.b, opener)!;
    expect(direct).toEqual([dp.b]);
    const blocked = findPath(world.grid, world, dp.a, dp.b, noHands);
    expect(blocked === null || blocked.length > 1).toBe(true);
    world.setDoor(dp.id, { pos: DOOR_OPEN });
    expect(findPath(world.grid, world, dp.a, dp.b, noHands)).toEqual([dp.b]);
    // Porte verrouillée : seul celui qui peut l'enfoncer passe.
    world.setDoor(dp.id, { pos: DOOR_CLOSED, locked: true });
    // Enfoncer coûte cher : l'entité préfère un détour s'il existe, mais garde l'option.
    world.setDoor(dp.id, { pos: DOOR_CLOSED, locked: true });
    expect(findPath(world.grid, world, dp.a, dp.b, opener)).not.toBeNull();
    const weak = { ...opener, breach: false };
    const around = findPath(world.grid, world, dp.a, dp.b, weak);
    expect(around === null || around.length > 1).toBe(true);
  });

  it('un sas verrouillé arrête toutes les entités ; ouvert, il les laisse passer', () => {
    const world = new WorldState(layout);
    const gate = layout.doors.find((d) => d.kind === 'gate' && d.lock?.type === 'card')!;
    const a = gate.cell;
    const b = gate.cell + DIR_DX[gate.dir]! + DIR_DY[gate.dir]! * GRID_W;
    expect(findPath(world.grid, world, a, b, ENTITY_SPECS.visiteur.caps, 6000)?.length ?? 99).toBeGreaterThan(1);
    world.setDoor(gate.id, { locked: false, pos: DOOR_CLOSED });
    expect(findPath(world.grid, world, a, b, ENTITY_SPECS.visiteur.caps)).toEqual([b]);
    expect(findPath(world.grid, world, a, b, ENTITY_SPECS.echo.caps)?.length ?? 99).toBeGreaterThan(1);
    world.setDoor(gate.id, { pos: DOOR_OPEN });
    expect(findPath(world.grid, world, a, b, ENTITY_SPECS.porteur.caps)).toEqual([b]);
    // Les conduits ne sont praticables que pour le Rampant.
    const vent = layout.doors.find((d) => d.kind === 'vent')!;
    const va = vent.cell;
    const vb = vent.cell + DIR_DX[vent.dir]! + DIR_DY[vent.dir]! * GRID_W;
    expect(findPath(world.grid, world, va, vb, ENTITY_SPECS.rampant.caps)).toEqual([vb]);
    const other = findPath(world.grid, world, va, vb, ENTITY_SPECS.visiteur.caps);
    expect(other === null || other.length > 1).toBe(true);
  });
});

describe('comportements', () => {
  it("l'Écho ignore un joueur immobile et silencieux, charge un bruit répété", () => {
    const pair = roomPair(6);
    const r = rig('echo', pair.a);
    const quiet = target(cellCenterX(pair.b), cellCenterZ(pair.b), { lightOn: true });
    r.ctx.targets = [quiet];
    r.agent.gaze = 999; // pas de cliquetis pendant ce test
    r.run(4);
    expect(r.agent.state).toBe('patrouille');
    expect(r.events.filter((e) => e.type === 'attack')).toHaveLength(0);
    r.ctx.targets = [{ ...quiet, noise: 13, speed: 5 }];
    r.run(1.2);
    expect(['charge', 'attaque', 'recuperation']).toContain(r.agent.state);
    r.run(6);
    expect(r.events.some((e) => e.type === 'attack' && e.kind === 'echo')).toBe(true);
  });

  it("l'Écho se laisse détourner par un objet lancé", () => {
    const pair = roomPair(6);
    const r = rig('echo', pair.a);
    r.agent.gaze = 999;
    r.ctx.targets = [target(cellCenterX(pair.a), cellCenterZ(pair.a) + 0.5, { crouching: true })];
    r.ctx.noises.push({ x: cellCenterX(pair.b), z: cellCenterZ(pair.b), radius: 14, source: 'p1', time: 0 });
    r.run(1);
    expect(r.agent.lastKnown).not.toBeNull();
    expect(Math.hypot(r.agent.lastKnown!.x - cellCenterX(pair.b), r.agent.lastKnown!.z - cellCenterZ(pair.b))).toBeLessThan(0.5);
  });

  it('le Phototrope converge sur une lampe allumée et renonce quand elle s’éteint', () => {
    const pair = roomPair(8);
    const r = rig('phototrope', pair.a);
    const t = target(cellCenterX(pair.b), cellCenterZ(pair.b));
    r.ctx.targets = [t];
    r.run(0.5);
    expect(r.agent.state).toBe('derive');
    r.agent.place(pair.a, r.ctx);
    t.lightOn = true;
    const d0 = r.agent.distanceTo(t);
    r.run(1.5);
    expect(['attirance', 'frenesie']).toContain(r.agent.state);
    expect(r.agent.distanceTo(t)).toBeLessThan(d0);
    t.lightOn = false;
    r.run(9);
    expect(r.agent.state).toBe('derive');
    expect(r.events.filter((e) => e.type === 'attack')).toHaveLength(0);
  });

  it("le Porteur suit sa proie mais reste bloqué par une porte fermée", () => {
    const dp = doorPair();
    const r = rig('porteur', dp.a);
    r.world.setDoor(dp.id, { pos: DOOR_OPEN });
    const t = target(cellCenterX(dp.b), cellCenterZ(dp.b), { lightOn: true, noise: 6 });
    r.agent.yaw = Math.atan2(t.x - r.agent.x, t.z - r.agent.z);
    r.ctx.targets = [t];
    r.run(0.6);
    expect(r.agent.state).toBe('poursuite');
    // Le joueur referme la porte derrière lui.
    r.agent.place(dp.a, r.ctx);
    r.world.setDoor(dp.id, { pos: DOOR_CLOSED });
    r.run(6);
    expect(r.world.doors[dp.id]!.pos).toBe(DOOR_CLOSED);
    expect(r.world.grid.cellAt(r.agent.x, r.agent.z)).not.toBe(dp.b);
    expect(r.events.filter((e) => e.type === 'attack')).toHaveLength(0);
  });

  it('le Porteur contamine par simple proximité', () => {
    const pair = roomPair(2);
    const r = rig('porteur', pair.a);
    r.ctx.targets = [target(r.agent.x + 1.5, r.agent.z)];
    r.run(1);
    expect(r.events.some((e) => e.type === 'infect')).toBe(true);
  });

  it("le Statique n'est attiré que par les appareils allumés et vide les batteries", () => {
    const pair = roomPair(6);
    const r = rig('statique', pair.a);
    const t = target(cellCenterX(pair.b), cellCenterZ(pair.b), { lightOn: true, devices: 0 });
    r.ctx.targets = [t];
    r.run(3);
    expect(r.agent.state).toBe('veille');
    t.devices = 2;
    r.run(4);
    expect(['attraction', 'dissipe']).toContain(r.agent.state);
    expect(r.events.some((e) => e.type === 'drain')).toBe(true);
    t.devices = 0;
    r.events.length = 0;
    r.run(8);
    expect(r.agent.state).toBe('veille');
  });

  it('le Rampant surgit puis se replie après avoir frappé', () => {
    const pair = roomPair(3);
    const r = rig('rampant', pair.a);
    const t = target(cellCenterX(pair.b), cellCenterZ(pair.b), { lightOn: true, noise: 6 });
    r.agent.yaw = Math.atan2(t.x - r.agent.x, t.z - r.agent.z);
    r.ctx.targets = [t];
    r.run(8);
    expect(r.events.some((e) => e.type === 'attack' && e.kind === 'rampant')).toBe(true);
    expect(['repli', 'affut']).toContain(r.agent.state);
    expect(r.agent.cooldown).toBeGreaterThan(5);
  });
});

describe('le Visiteur', () => {
  it('reste dormant sans stimulus puis se repositionne hors de vue', () => {
    const pair = roomPair(6);
    const r = rig('visiteur', pair.a);
    r.agent.wakeIn = 20;
    r.agent.visible = false;
    const t = target(cellCenterX(pair.b), cellCenterZ(pair.b), { lightOn: true });
    r.ctx.targets = [t];
    r.run(10);
    expect(r.agent.state).toBe('dormant');
    expect(r.agent.visible).toBe(false);
    r.run(14);
    expect(r.agent.state).not.toBe('dormant');
    if (r.agent.state === 'observation') {
      expect(r.agent.visible).toBe(true);
      // Jamais sous les yeux du joueur au moment où il apparaît.
      expect(r.agent.distanceTo(t)).toBeGreaterThanOrEqual(11);
    }
  });

  it('disparaît quand on le fixe trop longtemps avec une lampe', () => {
    const pair = roomPair(7);
    const r = rig('visiteur', pair.a);
    r.agent.setState('observation');
    r.agent.traits.patience = 1;
    const t = target(cellCenterX(pair.b), cellCenterZ(pair.b), { lightOn: true });
    t.yaw = Math.atan2(r.agent.x - t.x, r.agent.z - t.z);
    r.agent.yaw = Math.atan2(t.x - r.agent.x, t.z - r.agent.z);
    r.ctx.targets = [t];
    r.run(3);
    expect(r.agent.state).toBe('disparition');
    expect(r.events.some((e) => e.type === 'stress')).toBe(true);
  });

  it('chasse, frappe une fois, puis se retire et observe un temps de récupération', () => {
    const pair = roomPair(5);
    const r = rig('visiteur', pair.a);
    r.agent.setState('chasse');
    const t = target(cellCenterX(pair.b), cellCenterZ(pair.b), { lightOn: true });
    r.agent.yaw = Math.atan2(t.x - r.agent.x, t.z - r.agent.z);
    r.agent.targetId = 'p1';
    r.ctx.targets = [t];
    r.run(6);
    const attacks = r.events.filter((e) => e.type === 'attack');
    expect(attacks).toHaveLength(1);
    expect(['disparition', 'dormant']).toContain(r.agent.state);
    r.run(12);
    expect(r.agent.state).toBe('dormant');
    expect(r.agent.wakeIn).toBeGreaterThan(8);
    expect(r.events.filter((e) => e.type === 'attack')).toHaveLength(1);
  });

  it('perd la trace d’un joueur qui rompt la ligne de vue', () => {
    const dp = doorPair();
    const r = rig('visiteur', dp.a);
    r.world.setDoor(dp.id, { pos: DOOR_CLOSED });
    r.agent.setState('chasse');
    r.agent.targetId = 'p1';
    // Le joueur est loin, hors de vue, silencieux : aucune information n'arrive.
    r.ctx.targets = [target(r.agent.x + 40, r.agent.z + 30)];
    r.run(4);
    expect(r.agent.state).not.toBe('chasse');
    expect(r.agent.state).not.toBe('attaque');
    expect(r.events.filter((e) => e.type === 'attack')).toHaveLength(0);
  });

  it('imite des sons et des appels pendant la phase d’imitation', () => {
    const pair = roomPair(6);
    const r = rig('visiteur', pair.a);
    r.agent.setState('imitation');
    r.agent.targetId = 'p1';
    r.agent.traits.cunning = 1;
    r.agent.traits.patience = 1;
    r.ctx.targets = [target(r.agent.x + 30, r.agent.z + 20), { ...target(r.agent.x + 32, r.agent.z + 20), id: 'p2' }];
    r.run(30);
    const fakes = r.events.filter((e) => e.type === 'fake');
    expect(fakes.length).toBeGreaterThanOrEqual(3);
    // L'imitation emprunte l'identité d'un coéquipier de la proie.
    expect(fakes.every((f) => f.type === 'fake' && f.as === 'p2')).toBe(true);
  });

  it('ses traits changent d’une expédition à l’autre', () => {
    const traits = new Set<string>();
    for (const seed of ['E1', 'E2', 'E3', 'E4']) {
      const m = new EntityAIManager(new WorldState(layout), seed);
      m.spawnAll();
      const v = m.agents.find((a) => a.kind === 'visiteur')!;
      traits.add(`${v.traits.aggression.toFixed(2)}/${v.traits.cunning.toFixed(2)}/${v.traits.patience.toFixed(2)}`);
    }
    expect(traits.size).toBe(4);
  });
});

describe('gestionnaire', () => {
  it('fait apparaître toutes les entités sur leur territoire', () => {
    const m = new EntityAIManager(new WorldState(layout), 'spawn');
    m.spawnAll();
    const counts: Record<string, number> = {};
    for (const a of m.agents) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
    expect(counts).toEqual({ visiteur: 1, echo: 1, phototrope: 1, rampant: 1, porteur: 3, statique: 1 });
  });

  it('simule dix minutes sans erreur et la purge détruit les Porteurs', () => {
    const world = new WorldState(layout);
    const m = new EntityAIManager(world, 'longue');
    m.spawnAll();
    const t = target(layout.spawn.x, layout.spawn.z, { lightOn: true, noise: 5, devices: 1 });
    for (let i = 0; i < 12000; i++) {
      if (i % 200 === 0) m.addNoise(t.x, t.z, 12, 'p1');
      m.update(0.05, [t], Math.min(1, i / 12000));
      for (const a of m.agents) {
        expect(Number.isFinite(a.x) && Number.isFinite(a.z)).toBe(true);
      }
    }
    world.setFlag('purged', 1);
    m.update(0.05, [t], 1);
    expect(m.agents.some((a) => a.kind === 'porteur')).toBe(false);
  });

  it('se reconstruit à partir d’instantanés (changement d’hôte)', () => {
    const world = new WorldState(layout);
    const a = new EntityAIManager(world, 'migr');
    a.spawnAll();
    const snaps = JSON.parse(JSON.stringify(a.snapshots()));
    const b = new EntityAIManager(world, 'migr');
    b.restore(snaps);
    expect(b.agents).toHaveLength(a.agents.length);
    expect(b.agents[3]!.x).toBeCloseTo(a.agents[3]!.x, 1);
    b.update(0.05, [], 0);
  });
});
