import { describe, expect, it } from 'vitest';
import { generateLayout } from '../../src/world/generator';
import { SECTORS } from '../../src/world/sectors';
import { CellKind, EDGE_OPEN, GRID_W, DIR_DX, DIR_DY, OPPOSITE } from '../../src/world/types';
import { computeReach, validateLayout } from '../../src/world/validate';

const SEEDS = Array.from({ length: 40 }, (_, i) => `TEST-${i}`);

describe('génération procédurale', () => {
  it('produit une carte valide pour 40 graines', () => {
    let repairs = 0;
    let attempts = 0;
    for (const seed of SEEDS) {
      const layout = generateLayout(seed);
      const report = validateLayout(layout, { repair: false });
      expect(report.errors, `graine ${seed}`).toEqual([]);
      expect(layout.sectors).toHaveLength(12);
      repairs += layout.repairs;
      attempts += layout.attempt;
    }
    // Les réparations automatiques doivent rester l'exception.
    expect(repairs).toBeLessThan(SEEDS.length);
    expect(attempts).toBeLessThan(SEEDS.length * 6);
  });

  it('est déterministe : même graine, même carte', () => {
    const a = generateLayout('DETERMINISME');
    generateLayout('AUTRE'); // vide le cache
    const b = generateLayout('DETERMINISME');
    expect(a).not.toBe(b);
    expect(Array.from(b.kind)).toEqual(Array.from(a.kind));
    expect(Array.from(b.edges)).toEqual(Array.from(a.edges));
    expect(b.doors).toEqual(a.doors);
    expect(b.items).toEqual(a.items);
    expect(b.props).toEqual(a.props);
    expect(b.fixtures).toEqual(a.fixtures);
  });

  it('des graines différentes donnent des cartes différentes', () => {
    const a = generateLayout('ALPHA');
    const ka = Array.from(a.kind).join('');
    const b = generateLayout('BRAVO');
    expect(Array.from(b.kind).join('')).not.toEqual(ka);
  });

  it('contient les douze secteurs, reliés par un chemin principal jusqu’au Noyau', () => {
    const layout = generateLayout('CHEMIN');
    for (const def of SECTORS) {
      const inst = layout.sectors.find((s) => s.id === def.id)!;
      expect(inst.regions.length, def.id).toBeGreaterThanOrEqual(3);
    }
    const main = layout.links.filter((l) => l.main);
    expect(main).toHaveLength(11);
    const reach = computeReach(layout);
    const noyau = layout.regions.find((r) => r.type === 'chambre_noyau')!;
    expect(reach.reached[noyau.id]).toBe(1);
    expect(reach.reached[layout.extraction.region]).toBe(1);
  });

  it('respecte la progression : aucune carte derrière la porte qu’elle ouvre', () => {
    for (const seed of SEEDS.slice(0, 15)) {
      const layout = generateLayout(seed);
      const reach = computeReach(layout);
      expect(reach.cardLevel).toBe(3);
      expect(reach.power).toBe(true);
    }
  });

  it('les arêtes sont symétriques et les escaliers franchissables', () => {
    const layout = generateLayout('ARETES');
    for (let c = 0; c < layout.kind.length; c++) {
      if (layout.kind[c] === CellKind.Void) continue;
      for (let d = 0; d < 4; d++) {
        const e = layout.edges[c * 4 + d]!;
        if (e === 0) continue;
        const n = c + DIR_DX[d]! + DIR_DY[d]! * GRID_W;
        expect(layout.edges[n * 4 + OPPOSITE[d]!]).toBe(e);
      }
    }
    const stairs: number[] = [];
    for (let c = 0; c < layout.kind.length; c++) if (layout.kind[c] === CellKind.Stairs) stairs.push(c);
    expect(stairs).toHaveLength(4);
    for (const c of stairs) {
      let open = 0;
      for (let d = 0; d < 4; d++) if (layout.edges[c * 4 + d] === EDGE_OPEN) open++;
      expect(open).toBe(2);
    }
    expect(layout.elevator).not.toBeNull();
  });

  it('propose des chemins secondaires, des conduits et des passages secrets', () => {
    let vents = 0;
    let secrets = 0;
    let shortcuts = 0;
    for (const seed of SEEDS.slice(0, 10)) {
      const layout = generateLayout(seed);
      vents += layout.doors.filter((d) => d.kind === 'vent').length;
      secrets += layout.doors.filter((d) => d.kind === 'secret').length;
      shortcuts += layout.links.filter((l) => !l.main).length;
    }
    expect(vents).toBeGreaterThan(20);
    expect(secrets).toBeGreaterThan(5);
    expect(shortcuts).toBeGreaterThan(5);
  });
});
