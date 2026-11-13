import { it } from 'vitest';
import { generateLayout } from '../../src/world/generator';
import { CellKind, GRID_H, GRID_W } from '../../src/world/types';

it('ascii', () => {
  const seed = process.env.SEED ?? 'DEMO';
  const l = generateLayout(seed);
  const rows: string[] = [];
  const doorCells = new Map<number, string>();
  for (const d of l.doors) doorCells.set(d.cell, d.kind === 'vent' ? 'v' : d.kind === 'secret' ? '?' : d.kind === 'gate' ? 'G' : d.kind === 'elevator' ? 'E' : d.kind === 'arch' ? 'a' : 'd');
  for (let y = 0; y < GRID_H; y++) {
    let row = '';
    for (let x = 0; x < GRID_W; x++) {
      const c = y * GRID_W + x;
      const k = l.kind[c];
      let ch = k === CellKind.Void ? ' ' : k === CellKind.Corridor ? '.' : k === CellKind.Conduit ? '~' : k === CellKind.Stairs ? '>' : k === CellKind.Elevator ? 'E' : String.fromCharCode(65 + (l.region[c]! % 26));
      if (doorCells.has(c) && k !== CellKind.Elevator) ch = doorCells.get(c)!;
      if (l.blocked[c]) ch = '#';
      row += ch;
    }
    rows.push(row);
  }
  console.log(rows.join('\n'));
  console.log('attempt', l.attempt, 'repairs', l.repairs, 'regions', l.regions.length, 'doors', l.doors.length, 'props', l.props.length, 'items', l.items.length, 'fixtures', l.fixtures.length, 'lights', l.lights.length);
  console.log(l.sectors.map((s) => `${s.id}@${s.mx},${s.my}`).join(' '));
  console.log(l.links.map((k) => `${k.a}-${k.b}${k.main ? '' : '*'}`).join(' '));
  const counts: Record<string, number> = {};
  for (const r of l.regions) counts[r.type] = (counts[r.type] ?? 0) + 1;
  console.log(JSON.stringify(counts));
  console.log('stories', l.regions.filter((r) => r.story).length, 'missing fixtures', ['medstation.medical','purge.quarantaine','emitter.acoustique','sampler.bio','coolant.serveurs','probe.experimental','cryo.experimental','incinerator.quarantaine','antenna.accueil'].filter((id) => !l.fixtures.some((f) => f.id === id)));
});
