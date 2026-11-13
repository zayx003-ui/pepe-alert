import { describe, expect, it } from 'vitest';
import { listActions, performAction, performTerminal, targetTitle, terminalDoors, type ActorCtx, type TargetRef } from '../../src/interaction/actions';
import { DOCUMENT_BY_ID } from '../../src/world/lore';
import { generateLayout } from '../../src/world/generator';
import { DOOR_AJAR, DOOR_CLOSED, DOOR_OPEN } from '../../src/world/grid';
import { PROCESS_TIME, WorldState } from '../../src/world/state';
import { doorCenter } from '../../src/interaction/actions';

const layout = generateLayout('INTERACTION');

function world(): WorldState {
  return new WorldState(layout);
}

function actorAt(x: number, z: number, state: WorldState, extra: Partial<ActorCtx> = {}): ActorCtx {
  return { id: 'a', x, z, region: state.grid.regionAt(x, z), cardLevel: 0, items: [], hiddenIn: '', ...extra };
}

/** Acteur placé à 60 cm d'une porte, du côté de la région demandée. */
function atDoor(state: WorldState, id: number, side: 'a' | 'b', extra: Partial<ActorCtx> = {}): ActorCtx {
  const def = layout.doors[id]!;
  const c = doorCenter(def);
  const dx = [0, 1, 0, -1][def.dir]!;
  const dz = [-1, 0, 1, 0][def.dir]!;
  const s = side === 'a' ? -0.6 : 0.6;
  const actor = actorAt(c.x + dx * s, c.z + dz * s, state, extra);
  actor.region = side === 'a' ? def.a : def.b;
  return actor;
}

const ids = (state: WorldState, t: TargetRef, a: ActorCtx): string[] => listActions(state, t, a).map((x) => x.id);

describe('portes', () => {
  const plain = layout.doors.find((d) => d.kind === 'door' && !d.lock)!;
  const t: TargetRef = { t: 'door', id: plain.id };

  it('ouvrir, fermer, entrebâiller', () => {
    const w = world();
    w.setDoor(plain.id, { pos: DOOR_CLOSED });
    const a = atDoor(w, plain.id, 'a');
    expect(ids(w, t, a)).toEqual(['open', 'ajar', 'lock', 'barricade']);
    expect(performAction(w, t, 'open', a).ok).toBe(true);
    expect(w.doors[plain.id]!.pos).toBe(DOOR_OPEN);
    expect(w.grid.doorBlocks(plain.id)).toBe(false);
    expect(performAction(w, t, 'ajar', a).ok).toBe(true);
    expect(w.doors[plain.id]!.pos).toBe(DOOR_AJAR);
    expect(w.grid.doorBlocks(plain.id)).toBe(true);
    expect(performAction(w, t, 'close', a).ok).toBe(true);
    expect(w.doors[plain.id]!.pos).toBe(DOOR_CLOSED);
  });

  it('verrouiller empêche d’ouvrir, déverrouiller le permet', () => {
    const w = world();
    w.setDoor(plain.id, { pos: DOOR_CLOSED });
    const a = atDoor(w, plain.id, 'a');
    performAction(w, t, 'lock', a);
    expect(w.isLocked(plain.id)).toBe(true);
    expect(performAction(w, t, 'open', a).ok).toBe(false);
    expect(performAction(w, t, 'unlock', a).ok).toBe(true);
    expect(performAction(w, t, 'open', a).ok).toBe(true);
  });

  it('barricader : seul le côté de pose peut retirer, l’autre doit forcer', () => {
    const w = world();
    w.setDoor(plain.id, { pos: DOOR_CLOSED });
    const inside = atDoor(w, plain.id, 'a');
    const outside = atDoor(w, plain.id, 'b');
    expect(performAction(w, t, 'barricade', inside).ok).toBe(true);
    expect(w.doors[plain.id]!.barricade).toBe(60);
    expect(ids(w, t, inside)).toEqual(['unbarricade']);
    expect(ids(w, t, outside)).toEqual(['force']);
    const force = listActions(w, t, outside)[0]!;
    const withTools = listActions(w, t, { ...outside, items: ['outils'] })[0]!;
    expect(withTools.duration).toBeLessThan(force.duration);
    expect(force.noise).toBeGreaterThan(15);
    expect(performAction(w, t, 'force', outside).ok).toBe(true);
    expect(w.doors[plain.id]!.pos).toBe(DOOR_OPEN);
    expect(w.doors[plain.id]!.barricade).toBe(0);
  });

  it('refuse une interaction hors de portée', () => {
    const w = world();
    const far = actorAt(layout.spawn.x + 40, layout.spawn.z + 40, w);
    const r = performAction(w, t, 'open', far);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('Trop loin');
  });

  it('un sas à carte exige le bon niveau', () => {
    const w = world();
    const gate = layout.doors.find((d) => d.kind === 'gate' && d.lock?.type === 'card' && d.lock.level === 2)!;
    const gt: TargetRef = { t: 'door', id: gate.id };
    const low = atDoor(w, gate.id, 'a', { cardLevel: 1 });
    expect(listActions(w, gt, low)[0]!.enabled).toBe(false);
    expect(performAction(w, gt, 'unlock', low).ok).toBe(false);
    const high = atDoor(w, gate.id, 'a', { cardLevel: 3 });
    expect(performAction(w, gt, 'unlock', high).ok).toBe(true);
    expect(performAction(w, gt, 'open', high).ok).toBe(true);
    expect(w.doors[gate.id]!.pos).toBe(DOOR_OPEN);
  });

  it('un sas à loquet ne se déverrouille que du bon côté', () => {
    const w = world();
    const gate = layout.doors.find((d) => d.kind === 'gate' && d.lock?.type === 'latch');
    if (!gate || gate.lock?.type !== 'latch') return; // aucune liaison secondaire sur cette graine
    const gt: TargetRef = { t: 'door', id: gate.id };
    const goodSide = gate.lock.side === gate.a ? 'a' : 'b';
    const badSide = goodSide === 'a' ? 'b' : 'a';
    expect(performAction(w, gt, 'unlock', atDoor(w, gate.id, badSide)).ok).toBe(false);
    expect(performAction(w, gt, 'unlock', atDoor(w, gate.id, goodSide)).ok).toBe(true);
  });

  it('grille de conduit et panneau secret', () => {
    const w = world();
    const vent = layout.doors.find((d) => d.kind === 'vent')!;
    const a = atDoor(w, vent.id, 'a');
    const action = listActions(w, { t: 'door', id: vent.id }, a)[0]!;
    expect(action.id).toBe('open');
    expect(action.duration).toBeGreaterThan(0);
    performAction(w, { t: 'door', id: vent.id }, 'open', a);
    expect(w.doors[vent.id]!.pos).toBe(DOOR_OPEN);
    const secret = layout.doors.find((d) => d.kind === 'secret')!;
    expect(performAction(w, { t: 'door', id: secret.id }, 'open', atDoor(w, secret.id, 'a')).ok).toBe(true);
  });
});

describe('machines', () => {
  const fx = (id: string): { def: (typeof layout.fixtures)[number]; t: TargetRef } => {
    const def = layout.fixtures.find((f) => f.id === id)!;
    return { def, t: { t: 'fx', id } };
  };

  it('tableau électrique : les fusibles sont exigés et consommés', () => {
    const w = world();
    const { def, t } = fx('fusebox.medical');
    const a = actorAt(def.x, def.z, w);
    expect(listActions(w, t, a)[0]!.enabled).toBe(false);
    const withFuse = { ...a, items: ['fusible'] };
    for (let i = 0; i < 3; i++) {
      const r = performAction(w, t, 'fuse', withFuse);
      expect(r.ok).toBe(true);
      expect(r.take).toEqual(['fusible']);
    }
    expect(w.fixture('fusebox.medical')!.on).toBe(true);
    expect(performAction(w, t, 'fuse', withFuse).ok).toBe(false);
  });

  it('générateur secondaire : démarrage temporisé puis secteurs proches alimentés', () => {
    const w = world();
    const { def, t } = fx('generator_aux.maintenance');
    const a = actorAt(def.x, def.z, w);
    expect(w.sectorPowered('accueil')).toBe(true);
    expect(w.sectorPowered('administration')).toBe(false);
    expect(performAction(w, t, 'start', a).ok).toBe(true);
    expect(w.auxPower).toBe(false);
    let done = '';
    w.events.on('done', (e) => (done = e.id));
    for (let s = 0; s < PROCESS_TIME.generator_aux + 1; s += 0.5) w.update(0.5, true);
    expect(done).toBe('generator_aux.maintenance');
    expect(w.auxPower).toBe(true);
    expect(w.sectorPowered('administration')).toBe(true);
    // Palier 2 : hors de portée du générateur secondaire.
    expect(w.sectorPowered('serveurs')).toBe(false);
    // Médical : palier 1 mais tableau incomplet.
    expect(w.sectorPowered('medical')).toBe(false);
  });

  it('générateur principal : exige le tableau de la centrale', () => {
    const w = world();
    const { def, t } = fx('generator_main.centrale');
    const a = actorAt(def.x, def.z, w);
    expect(performAction(w, t, 'start', a).ok).toBe(false);
    w.setFixture('fusebox.centrale', { value: 2, on: true });
    expect(performAction(w, t, 'start', a).ok).toBe(true);
    for (let s = 0; s < PROCESS_TIME.generator_main + 1; s += 0.5) w.update(0.5, true);
    expect(w.mainPower).toBe(true);
    expect(w.sectorPowered('centrale')).toBe(true);
  });

  it('une machine en panne exige des outils et les use', () => {
    const w = world();
    const { def, t } = fx('antenna.accueil');
    const a = actorAt(def.x, def.z, w);
    expect(performAction(w, t, 'repair', a).ok).toBe(false);
    const r = performAction(w, t, 'repair', { ...a, items: ['outils'] });
    expect(r.ok).toBe(true);
    expect(r.wear).toBeGreaterThan(0);
    expect(performAction(w, t, 'start', a).ok).toBe(true);
    expect(w.fixture('antenna.accueil')!.on).toBe(true);
  });

  it("le sas d'extraction reste fermé tant que l'objectif principal n'est pas accompli", () => {
    const w = world();
    const { def, t } = fx('airlock.accueil');
    const a = actorAt(def.x, def.z, w);
    expect(performAction(w, t, 'cycle', a).ok).toBe(false);
    w.setFlag('extraction_ready', 1);
    expect(performAction(w, t, 'cycle', a).ok).toBe(true);
    expect(w.flag('airlock')).toBe(1);
    for (let s = 0; s < PROCESS_TIME.airlock + 1; s += 0.5) w.update(0.5, true);
    expect(w.flag('airlock')).toBe(2);
  });

  it('casier : une seule personne à la fois', () => {
    const w = world();
    const def = layout.fixtures.find((f) => f.type === 'locker')!;
    const t: TargetRef = { t: 'fx', id: def.id };
    const a = actorAt(def.x, def.z, w);
    const r = performAction(w, t, 'hide', a);
    expect(r.effect).toBe('hide');
    expect(performAction(w, t, 'hide', { ...a, id: 'b' }).ok).toBe(false);
    expect(performAction(w, t, 'leave', { ...a, hiddenIn: def.id }).effect).toBe('unhide');
    expect(w.fixture(def.id)!.on).toBe(false);
  });

  it("l'ascenseur exige le courant principal puis rejoint le niveau du Noyau", () => {
    const w = world();
    const lift = layout.elevator!;
    const t: TargetRef = { t: 'door', id: lift.doorBottom };
    const a = atDoor(w, lift.doorBottom, 'b');
    expect(listActions(w, t, a)[0]!.enabled).toBe(false);
    w.setFixture('generator_main.centrale', { on: true });
    w.setFixture('fusebox.centrale', { value: 2, on: true });
    const call = listActions(w, t, a)[0]!;
    expect(call.enabled).toBe(true);
    expect(performAction(w, t, 'lift', a).ok).toBe(true);
    for (let s = 0; s < 8; s += 0.1) w.update(0.1, true);
    expect(w.elevator.y).toBe(lift.bottomY);
    expect(w.grid.heightAt((lift.cell % 80) * 2 + 1, ((lift.cell / 80) | 0) * 2 + 1)).toBe(lift.bottomY);
    expect(w.doors[lift.doorBottom]!.pos).toBe(DOOR_OPEN);
    expect(w.doors[lift.doorTop]!.pos).toBe(DOOR_CLOSED);
  });
});

describe('objets et terminaux', () => {
  it('ramasser retire l’objet du monde et le remet à l’acteur', () => {
    const w = world();
    const it0 = layout.items.find((i) => i.item === 'fusible')!;
    const t: TargetRef = { t: 'item', uid: it0.uid };
    const a = actorAt(it0.x, it0.z, w);
    const r = performAction(w, t, 'take', a);
    expect(r.give?.[0]?.item).toBe('fusible');
    expect(w.items.has(it0.uid)).toBe(false);
    // Un second joueur arrive trop tard.
    expect(performAction(w, t, 'take', a).ok).toBe(false);
  });

  it('chaque cible a un intitulé affichable (régression : regarder un document plantait)', () => {
    const w = world();
    for (const it of layout.items) {
      const title = targetTitle(w, { t: 'item', uid: it.uid });
      expect(title.length, it.item).toBeGreaterThan(0);
      if (it.item === 'document') expect(title).toBe(DOCUMENT_BY_ID[it.data!]!.title);
    }
    for (const f of layout.fixtures) expect(targetTitle(w, { t: 'fx', id: f.id }).length, f.id).toBeGreaterThan(0);
    for (const d of layout.doors) if (d.kind !== 'arch') expect(targetTitle(w, { t: 'door', id: d.id }).length).toBeGreaterThan(0);
  });

  it('un document se lit sans encombrer l’inventaire', () => {
    const w = world();
    const doc = layout.items.find((i) => i.item === 'document')!;
    const r = performAction(w, { t: 'item', uid: doc.uid }, 'read', actorAt(doc.x, doc.z, w));
    expect(r.effect).toBe('document');
    expect(r.effectData).toBe(doc.data);
    expect(r.give).toBeUndefined();
  });

  it('terminal : hors tension refusé, puis verrouillage de porte et transfert', () => {
    const w = world();
    const def = layout.fixtures.find((f) => f.id === 'terminal.administration')!;
    const a = actorAt(def.x, def.z, w);
    expect(listActions(w, { t: 'fx', id: def.id }, a)[0]!.enabled).toBe(false);
    expect(performTerminal(w, def.id, { c: 'download' }, a).ok).toBe(false);
    w.setFixture('generator_aux.maintenance', { on: true });
    expect(performAction(w, { t: 'fx', id: def.id }, 'use', a).effect).toBe('terminal');
    const doors = terminalDoors(w, def);
    expect(doors.length).toBeGreaterThan(0);
    const open = doors.find((d) => d.allowed)!;
    const before = w.doors[open.id]!.locked;
    expect(performTerminal(w, def.id, { c: 'door', door: open.id }, a).ok).toBe(true);
    expect(w.doors[open.id]!.locked).toBe(!before);
    expect(performTerminal(w, def.id, { c: 'download' }, a).ok).toBe(true);
    expect(performTerminal(w, def.id, { c: 'download' }, a).ok).toBe(false);
    for (let s = 0; s < PROCESS_TIME.download + 1; s += 0.5) w.update(0.5, true);
    expect(w.fixture(def.id)!.value).toBe(1);
  });

  it("l'état du monde se sérialise et se recharge à l'identique", () => {
    const a = world();
    a.setDoor(3, { pos: DOOR_OPEN, locked: false });
    a.setFixture('fusebox.medical', { value: 2 });
    a.commit({ k: 'item-', uid: layout.items[0]!.uid });
    a.commit({ k: 'marker', m: { id: 1, x: 1, y: 0, z: 1 } });
    a.setFlag('purged', 1);
    const b = world();
    b.load(JSON.parse(JSON.stringify(a.snapshot())));
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.grid.doorPos[3]).toBe(DOOR_OPEN);
  });
});
