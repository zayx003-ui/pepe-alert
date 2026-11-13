/**
 * Validation d'une carte générée.
 *
 * Simule la progression d'une équipe : à partir du point d'apparition, on étend
 * l'ensemble des régions atteignables en ne franchissant que les portes dont la
 * condition d'ouverture est satisfaite par ce qui a déjà été atteint (cartes,
 * générateur, côté du loquet). La carte est valide si TOUTES les régions — donc
 * tous les objets, machines et la sortie — finissent atteignables.
 */
import { CellKind, type DoorDef, type Layout } from './types';

export interface ReachState {
  reached: Uint8Array;
  cardLevel: number;
  power: boolean;
  /** Ordre de découverte des régions (utile pour le débogage et les tests). */
  order: number[];
}

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  repairs: number;
  reach: ReachState;
}

function doorPassable(door: DoorDef, from: number, st: ReachState): boolean {
  const lock = door.lock;
  if (!lock) return true;
  switch (lock.type) {
    case 'card':
      return st.cardLevel >= lock.level;
    case 'power':
      return st.power;
    case 'latch':
      // Une porte simple barricadée peut toujours être forcée ; un sas non.
      if (door.kind === 'door') return true;
      return from === lock.side || st.reached[lock.side] === 1;
    case 'terminal':
      return true;
  }
}

/** Calcule l'ensemble des régions atteignables par progression (point fixe). */
export function computeReach(layout: Layout): ReachState {
  const n = layout.regions.length;
  const st: ReachState = { reached: new Uint8Array(n), cardLevel: 0, power: false, order: [] };
  const itemsByRegion = new Map<number, typeof layout.items>();
  for (const it of layout.items) {
    let list = itemsByRegion.get(it.region);
    if (!list) itemsByRegion.set(it.region, (list = []));
    list.push(it);
  }
  const fixturesByRegion = new Map<number, typeof layout.fixtures>();
  for (const f of layout.fixtures) {
    let list = fixturesByRegion.get(f.region);
    if (!list) fixturesByRegion.set(f.region, (list = []));
    list.push(f);
  }
  let fuses = 0;
  let hasMainGen = false;
  let hasCentraleBox = false;

  const absorb = (region: number): void => {
    st.reached[region] = 1;
    st.order.push(region);
    for (const it of itemsByRegion.get(region) ?? []) {
      if (it.item === 'carte') st.cardLevel = Math.max(st.cardLevel, Number(it.data ?? 0));
      if (it.item === 'fusible') fuses++;
    }
    for (const f of fixturesByRegion.get(region) ?? []) {
      if (f.type === 'generator_main') hasMainGen = true;
      if (f.id === 'fusebox.centrale') hasCentraleBox = true;
    }
    st.power = hasMainGen && hasCentraleBox && fuses >= 3;
  };

  absorb(layout.spawn.region);
  let changed = true;
  while (changed) {
    changed = false;
    for (const door of layout.doors) {
      const ra = st.reached[door.a] === 1;
      const rb = st.reached[door.b] === 1;
      if (ra === rb) continue;
      const from = ra ? door.a : door.b;
      const to = ra ? door.b : door.a;
      if (doorPassable(door, from, st)) {
        absorb(to);
        changed = true;
      }
    }
  }
  return st;
}

export function validateLayout(layout: Layout, opts: { repair: boolean }): ValidationReport {
  const errors: string[] = [];
  let repairs = 0;

  // Cohérence structurelle.
  for (let c = 0; c < layout.kind.length; c++) {
    if (layout.kind[c] !== CellKind.Void && layout.region[c]! < 0) errors.push(`cellule ${c} sans région`);
  }
  for (const r of layout.regions) {
    if (r.cells.length === 0) errors.push(`région ${r.id} vide`);
    if (r.doors.length === 0 && r.id !== layout.spawn.region) errors.push(`région ${r.id} (${r.type}) sans accès`);
  }
  if (layout.items.filter((i) => i.item === 'fusible').length < 8) errors.push('fusibles insuffisants');
  for (const level of ['1', '2', '3']) {
    if (!layout.items.some((i) => i.item === 'carte' && i.data === level)) errors.push(`carte niveau ${level} absente`);
  }
  for (const required of ['airlock.accueil', 'generator_main.centrale', 'generator_aux.maintenance', 'core_console.noyau', 'fusebox.centrale']) {
    if (!layout.fixtures.some((f) => f.id === required)) errors.push(`machine ${required} absente`);
  }
  if (errors.length > 0) return { ok: false, errors, repairs, reach: computeReach(layout) };

  // Atteignabilité avec réparation : on retire le verrou d'une porte frontière tant qu'il reste des régions isolées.
  let reach = computeReach(layout);
  const total = layout.regions.length;
  for (let guard = 0; guard < 64; guard++) {
    if (reach.order.length === total) break;
    if (!opts.repair) break;
    const frontier = layout.doors.find((d) => d.lock && (reach.reached[d.a] === 1) !== (reach.reached[d.b] === 1));
    if (!frontier) break;
    frontier.lock = null;
    frontier.barricaded = false;
    repairs++;
    reach = computeReach(layout);
  }
  if (reach.order.length !== total) {
    const missing = layout.regions.filter((r) => !reach.reached[r.id]).map((r) => `${r.sector}/${r.type}`);
    errors.push(`régions inaccessibles : ${missing.slice(0, 6).join(', ')}`);
  }
  layout.repairs = repairs;
  return { ok: errors.length === 0, errors, repairs, reach };
}
