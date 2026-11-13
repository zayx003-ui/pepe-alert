import { describe, expect, it } from 'vitest';
import { EventDirector } from '../../src/missions/events';
import { MissionManager, pickObjectives } from '../../src/missions/manager';
import { OBJECTIVES, OBJECTIVE_BY_ID } from '../../src/missions/objectives';
import { ITEM_BY_ID } from '../../src/inventory/items';
import { generateLayout } from '../../src/world/generator';
import { DOOR_CLOSED } from '../../src/world/grid';
import { PROCESS_TIME, WorldState } from '../../src/world/state';

const layout = generateLayout('MISSION');

describe('catalogue', () => {
  it('compte 30 objectifs distincts : 10 principaux, 20 secondaires', () => {
    expect(OBJECTIVES).toHaveLength(30);
    expect(new Set(OBJECTIVES.map((o) => o.id)).size).toBe(30);
    expect(OBJECTIVES.filter((o) => o.kind === 'principal')).toHaveLength(10);
    expect(OBJECTIVES.filter((o) => o.kind === 'secondaire')).toHaveLength(20);
    for (const o of OBJECTIVES) {
      expect(o.steps.length, o.id).toBeGreaterThan(0);
      expect(o.xp, o.id).toBeGreaterThan(0);
      expect(o.consequenceText.length, o.id).toBeGreaterThan(0);
      // Seuls les objectifs secondaires peuvent échouer : un principal ne bloque jamais la partie.
      if (o.kind === 'principal') expect(o.fail, o.id).toBeUndefined();
    }
  });

  it('chaque étape référence une machine ou un objet présent dans toute carte', () => {
    for (const seed of ['A1', 'B2', 'C3', 'D4', 'E5', 'F6']) {
      const l = generateLayout(seed);
      const fixtures = new Set(l.fixtures.map((f) => f.id));
      for (const o of OBJECTIVES) {
        for (const step of [...o.steps, ...(o.start ? [o.start] : [])]) {
          if (step.type === 'fixture' || step.type === 'terminal' || step.type === 'download') {
            expect(fixtures.has(step.id), `${seed} ${o.id} ${step.id}`).toBe(true);
          }
          if (step.type === 'collect') {
            expect(ITEM_BY_ID[step.item], step.item).toBeDefined();
            const available = l.items.filter((i) => i.item === step.item && (!step.data || i.data === step.data)).length;
            expect(available, `${seed} ${o.id} ${step.item}`).toBeGreaterThanOrEqual(step.count);
          }
        }
      }
    }
  });

  it('le tirage est déterministe et sans redondance', () => {
    const a = pickObjectives('TIRAGE');
    const b = pickObjectives('TIRAGE');
    expect(a.primary.id).toBe(b.primary.id);
    expect(a.secondary.map((s) => s.id)).toEqual(b.secondary.map((s) => s.id));
    expect(a.secondary).toHaveLength(3);
    const tags = [...a.primary.tags, ...a.secondary.flatMap((s) => s.tags)];
    expect(new Set(tags).size).toBe(tags.length);
    const primaries = new Set(Array.from({ length: 60 }, (_, i) => pickObjectives(`S${i}`).primary.id));
    expect(primaries.size).toBeGreaterThanOrEqual(8);
  });
});

describe('déroulement', () => {
  it('« Restaurer le secteur médical » se déroule étape par étape jusqu’à l’extraction', () => {
    const w = new WorldState(layout);
    const m = new MissionManager(w, 'x', 'P-MED');
    expect(m.primary.id).toBe('P-MED');
    m.update(0.1);
    expect(m.primary.step).toBe(0);
    expect(m.primary.max).toBe(3);

    m.onPickup('fusible');
    m.onPickup('fusible');
    m.update(0.1);
    expect(m.primary.cur).toBe(2);
    m.onPickup('fusible');
    m.update(0.1);
    expect(m.primary.step).toBe(1);

    w.setFixture('generator_aux.maintenance', { on: true });
    m.update(0.1);
    expect(m.primary.step).toBe(2);

    w.setFixture('fusebox.medical', { value: 3, on: true });
    m.update(0.1);
    expect(m.primary.step).toBe(3);

    m.onTerminalUse('terminal.medical');
    m.update(0.1);
    expect(m.primary.step).toBe(4);
    expect(m.phase).toBe('expedition');
    expect(w.flag('extraction_ready')).toBe(0);

    w.setFixture('terminal.medical', { t: PROCESS_TIME.download, total: PROCESS_TIME.download });
    for (let s = 0; s < PROCESS_TIME.download + 1; s += 0.5) {
      w.update(0.5, true);
      m.update(0.5);
    }
    expect(m.primary.status).toBe('reussi');
    expect(m.phase).toBe('extraction');
    expect(w.flag('extraction_ready')).toBe(1);
    expect(m.consequences).toContain('reveil');

    // Sas ouvert : le compte à rebours d'extraction démarre.
    w.setFlag('airlock', 2);
    m.update(0.1);
    expect(m.extractionLeft).toBeGreaterThan(70);
    m.finish(1);
    expect(m.outcome).toBe('succes');
  });

  it('sans extraction, la réussite de l’objectif ne suffit pas', () => {
    const w = new WorldState(layout);
    const m = new MissionManager(w, 'x', 'P-MED');
    m.finish(0);
    expect(m.outcome).toBe('echec');
  });

  it('un objectif masqué apparaît à sa condition de départ, puis peut échouer au chrono', () => {
    const w = new WorldState(layout);
    const m = new MissionManager(w, 'x', 'P-MED');
    m.objectives.push({ id: 'S-COOL', status: 'cache', step: 0, cur: 0, max: 1, timeLeft: -1 });
    m.update(1);
    expect(m.objectives.at(-1)!.status).toBe('cache');
    m.setOccupied(['serveurs']);
    m.update(1);
    const cool = m.objectives.at(-1)!;
    expect(cool.status).toBe('actif');
    expect(cool.timeLeft).toBeGreaterThan(400);
    for (let s = 0; s < 430; s += 5) m.update(5);
    expect(cool.status).toBe('echoue');
    expect(m.consequences).toContain('menace+');
    // L'objectif principal, lui, reste actif.
    expect(m.primary.status).toBe('actif');
  });

  it('relevés, caméra, marqueurs, documents et confinement sont comptés', () => {
    const w = new WorldState(layout);
    const m = new MissionManager(w, 'x', 'P-MED');
    const add = (id: string): void => void m.objectives.push({ id, status: OBJECTIVE_BY_ID[id]!.start ? 'cache' : 'actif', step: 0, cur: 0, max: 1, timeLeft: -1 });
    for (const id of ['S-CONTAM', 'S-CAM-EXP', 'S-MARK', 'S-DOCS-5', 'S-SEAL', 'S-VALVES', 'S-ID-ECHO']) add(id);
    const state = (id: string) => m.objectives.find((o) => o.id === id)!;

    m.onMeasure('bio', 1);
    m.onMeasure('bio', 1); // même salle : compté une fois
    m.onMeasure('quarantaine', 7);
    m.update(0.1);
    expect(state('S-CONTAM').cur).toBe(2);
    m.onMeasure('bio', 2);

    const exp = layout.regions.find((r) => r.sector === 'experimental' && r.kind === 'room')!;
    w.commit({ k: 'cam+', c: { id: 1, x: (exp.x + 0.5) * 2, y: 0, z: (exp.y + 0.5) * 2, yaw: 0, owner: 'a' } });
    for (let i = 0; i < 5; i++) w.commit({ k: 'marker', m: { id: 10 + i, x: i, y: 0, z: 0 } });
    for (let i = 0; i < 5; i++) m.onDocument(`doc-${i}`);
    m.onObserve('echo');
    for (const [id] of w.fixtures) if (id.startsWith('valve.')) w.setFixture(id, { on: false });
    m.setOccupied(['quarantaine']);
    for (const d of layout.doors) {
      if (d.kind !== 'gate') continue;
      if (layout.regions[d.a]!.sector === 'quarantaine' || layout.regions[d.b]!.sector === 'quarantaine') w.setDoor(d.id, { pos: DOOR_CLOSED, locked: true });
    }
    m.update(0.1);
    m.update(0.1);
    for (const id of ['S-CONTAM', 'S-CAM-EXP', 'S-MARK', 'S-DOCS-5', 'S-SEAL', 'S-VALVES', 'S-ID-ECHO']) {
      expect(state(id).status, id).toBe('reussi');
    }
  });

  it("l'état des missions survit à un changement d'hôte", () => {
    const w = new WorldState(layout);
    const a = new MissionManager(w, 'x', 'P-MED');
    a.onPickup('fusible');
    a.onPickup('fusible');
    a.onDocument('acc-01');
    a.update(12);
    const b = new MissionManager(w, 'x', 'P-MED');
    b.importFull(JSON.parse(JSON.stringify(a.exportFull())));
    b.onPickup('fusible');
    b.update(0.1);
    expect(b.primary.step).toBe(1);
    expect(b.docs.has('acc-01')).toBe(true);
    expect(b.elapsed).toBeGreaterThanOrEqual(12);
  });

  it('la menace augmente avec le temps et les objectifs accomplis', () => {
    const w = new WorldState(layout);
    const m = new MissionManager(w, 'x', 'P-MED');
    const t0 = m.threat;
    m.update(600);
    expect(m.threat).toBeGreaterThan(t0 + 0.3);
    expect(m.threat).toBeLessThanOrEqual(1);
  });
});

describe('événements dynamiques', () => {
  it('surviennent même sans aucun joueur et ne cassent rien de définitif', () => {
    const w = new WorldState(layout);
    w.setFixture('generator_aux.maintenance', { on: true });
    w.setFixture('generator_main.centrale', { on: true });
    w.setFixture('fusebox.centrale', { value: 2, on: true });
    w.setFixture('antenna.accueil', { broken: false, on: true });
    w.setFixture('coolant.serveurs', { on: true });
    const d = new EventDirector(w, 'evt');
    const kinds = new Set<string>();
    for (let s = 0; s < 3600; s += 1) {
      w.update(1, true);
      d.update(1, 0.5);
      for (const n of d.notices.splice(0)) kinds.add(n.kind);
    }
    expect(kinds.size).toBeGreaterThanOrEqual(6);
    // Tout ce qui est tombé en panne reste réparable par une action de joueur.
    expect(w.sectorPowered('accueil')).toBe(true);
    for (const [id, f] of w.fixtures) {
      if (id.startsWith('fusebox.') && f.broken) expect(f.value).toBeLessThanOrEqual(f.need);
    }
  });

  it('chaque type d’événement peut être déclenché', () => {
    const w = new WorldState(layout);
    w.setFixture('generator_main.centrale', { on: true });
    w.setFixture('fusebox.centrale', { value: 2, on: true });
    w.setFixture('antenna.accueil', { broken: false, on: true });
    w.setFixture('coolant.serveurs', { on: true });
    const d = new EventDirector(w, 'evt2');
    for (const kind of ['coupure', 'fuite', 'generateur', 'porte', 'eclairage', 'annonce', 'relais', 'surchauffe'] as const) {
      expect(d.trigger(kind), kind).toBe(true);
    }
    expect(d.notices).toHaveLength(8);
    expect(w.fixture('antenna.accueil')!.on).toBe(false);
  });
});
