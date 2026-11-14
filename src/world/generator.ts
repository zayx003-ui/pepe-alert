/**
 * Génération procédurale du complexe.
 *
 * 1. Un graphe de secteurs est tiré (arbre principal + raccourcis secondaires) puis
 *    plongé dans une macro-grille : deux secteurs reliés sont toujours voisins.
 * 2. Chaque secteur reçoit des couloirs reliant ses portails à un point central,
 *    puis des salles rectangulaires adossées aux couloirs.
 * 3. Un arbre couvrant garantit que toute salle est accessible ; des portes,
 *    conduits et passages secrets supplémentaires créent les chemins secondaires.
 * 4. Le décor, les machines et les objets sont placés (dressing.ts) puis la carte
 *    est validée (validate.ts) : en cas d'échec une nouvelle tentative déterministe
 *    est effectuée à partir de la même graine.
 */
import { Rng } from '../core/rng';
import { dressLayout } from './dressing';
import { SECTORS, SECTOR_BY_ID } from './sectors';
import {
  CELL,
  CellKind,
  DIR_DX,
  DIR_DY,
  EDGE_DOOR_BASE,
  EDGE_OPEN,
  EDGE_WALL,
  GRID_H,
  GRID_W,
  MACRO_H,
  MACRO_W,
  OPPOSITE,
  SLOT,
  cellIndex,
  type DoorDef,
  type DoorKind,
  type Layout,
  type LockDef,
  type Region,
  type RegionKind,
  type SectorId,
  type SectorInstance,
} from './types';
import { validateLayout } from './validate';

export const NOYAU_Y = -4;
const MAX_ATTEMPTS = 60;

class GenerationRetry extends Error {}

interface Portal {
  side: number;
  offset: number;
  link: number;
  kind: 'gate' | 'stairs' | 'elevator';
}

interface SharedEdge {
  cell: number;
  dir: number;
  ra: number;
  rb: number;
}

interface Ctx {
  rng: Rng;
  layout: Layout;
  portals: Map<SectorId, Portal[]>;
  linkedPairs: Set<string>;
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function emptyLayout(seed: string, attempt: number): Layout {
  const n = GRID_W * GRID_H;
  return {
    seed,
    width: GRID_W,
    height: GRID_H,
    kind: new Uint8Array(n),
    region: new Int16Array(n).fill(-1),
    floorY: new Float32Array(n),
    slopeX: new Float32Array(n),
    slopeZ: new Float32Array(n),
    ceilH: new Float32Array(n).fill(3),
    sectorOf: new Int8Array(n).fill(-1),
    blocked: new Uint8Array(n),
    edges: new Int16Array(n * 4),
    regions: [],
    doors: [],
    sectors: [],
    links: [],
    props: [],
    items: [],
    fixtures: [],
    lights: [],
    spawn: { x: 0, y: 0, z: 0, region: 0 },
    extraction: { region: 0, x: 0, z: 0 },
    elevator: null,
    repairs: 0,
    attempt,
  };
}

/* ------------------------------------------------------------------ */
/* 1. Graphe des secteurs                                              */
/* ------------------------------------------------------------------ */

function placeSectors(ctx: Ctx): void {
  const { rng, layout } = ctx;
  const taken = new Map<string, SectorId>();
  const placed = new Map<SectorId, SectorInstance>();
  const slotKey = (x: number, y: number): string => `${x},${y}`;

  for (const def of SECTORS) {
    if (def.parents.length === 0) {
      const inst: SectorInstance = {
        id: def.id,
        mx: rng.int(1, MACRO_W - 2),
        my: rng.int(0, MACRO_H - 1),
        floorY: 0,
        regions: [],
        depth: 0,
      };
      placed.set(def.id, inst);
      taken.set(slotKey(inst.mx, inst.my), def.id);
      continue;
    }
    const candidates: { parent: SectorInstance; x: number; y: number }[] = [];
    for (const pid of def.parents) {
      const parent = placed.get(pid);
      if (!parent) continue;
      for (let d = 0; d < 4; d++) {
        const x = parent.mx + DIR_DX[d]!;
        const y = parent.my + DIR_DY[d]!;
        if (x < 0 || y < 0 || x >= MACRO_W || y >= MACRO_H) continue;
        if (taken.has(slotKey(x, y))) continue;
        candidates.push({ parent, x, y });
      }
    }
    if (candidates.length === 0) throw new GenerationRetry(`aucun emplacement pour ${def.id}`);
    const c = rng.pick(candidates);
    const inst: SectorInstance = {
      id: def.id,
      mx: c.x,
      my: c.y,
      floorY: def.id === 'noyau' ? NOYAU_Y : 0,
      regions: [],
      depth: c.parent.depth + 1,
    };
    placed.set(def.id, inst);
    taken.set(slotKey(c.x, c.y), def.id);
    layout.links.push({ a: c.parent.id, b: def.id, main: true, doors: [] });
  }

  for (const def of SECTORS) layout.sectors.push(placed.get(def.id)!);

  // Raccourcis secondaires entre secteurs voisins de palier proche.
  const hasLink = (a: SectorId, b: SectorId): boolean =>
    layout.links.some((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));
  for (const s of layout.sectors) {
    for (const d of [1, 2]) {
      const other = taken.get(slotKey(s.mx + DIR_DX[d]!, s.my + DIR_DY[d]!));
      if (!other || hasLink(s.id, other)) continue;
      if (s.id === 'noyau' || other === 'noyau') continue;
      const ta = SECTOR_BY_ID[s.id].tier;
      const tb = SECTOR_BY_ID[other].tier;
      if (Math.abs(ta - tb) > 1) continue;
      if (rng.chance(0.5)) layout.links.push({ a: s.id, b: other, main: false, doors: [] });
    }
  }

  // Portails : position de chaque liaison sur la frontière commune.
  for (const s of layout.sectors) ctx.portals.set(s.id, []);
  layout.links.forEach((link, li) => {
    const a = placed.get(link.a)!;
    const b = placed.get(link.b)!;
    const sideA = b.mx > a.mx ? 1 : b.mx < a.mx ? 3 : b.my > a.my ? 2 : 0;
    const sideB = OPPOSITE[sideA]!;
    if (link.b === 'noyau' || link.a === 'noyau') {
      const o1 = rng.int(3, 6);
      const o2 = rng.int(10, 12);
      const stairsFirst = rng.chance(0.5);
      const oStairs = stairsFirst ? o1 : o2;
      const oLift = stairsFirst ? o2 : o1;
      ctx.portals.get(link.a)!.push({ side: sideA, offset: oStairs, link: li, kind: 'stairs' });
      ctx.portals.get(link.b)!.push({ side: sideB, offset: oStairs, link: li, kind: 'stairs' });
      ctx.portals.get(link.a)!.push({ side: sideA, offset: oLift, link: li, kind: 'elevator' });
      ctx.portals.get(link.b)!.push({ side: sideB, offset: oLift, link: li, kind: 'elevator' });
    } else {
      const o = rng.int(4, 11);
      ctx.portals.get(link.a)!.push({ side: sideA, offset: o, link: li, kind: 'gate' });
      ctx.portals.get(link.b)!.push({ side: sideB, offset: o, link: li, kind: 'gate' });
    }
  });
}

/* ------------------------------------------------------------------ */
/* 2. Intérieur d'un secteur                                           */
/* ------------------------------------------------------------------ */

function newRegion(ctx: Ctx, kind: RegionKind, sector: SectorId, type: string, floorY: number): Region {
  const r: Region = {
    id: ctx.layout.regions.length,
    kind,
    sector,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    cells: [],
    type,
    floorY,
    secret: false,
    story: null,
    doors: [],
  };
  ctx.layout.regions.push(r);
  return r;
}

function finalizeBounds(r: Region): void {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of r.cells) {
    const x = c % GRID_W;
    const y = (c / GRID_W) | 0;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  r.x = x0;
  r.y = y0;
  r.w = x1 - x0 + 1;
  r.h = y1 - y0 + 1;
}

function addDoor(ctx: Ctx, cell: number, dir: number, kind: DoorKind, lock: LockDef | null, sector: SectorId): DoorDef {
  const { layout } = ctx;
  const n = cell + DIR_DX[dir]! + DIR_DY[dir]! * GRID_W;
  const door: DoorDef = {
    id: layout.doors.length,
    cell,
    dir,
    kind,
    lock,
    a: layout.region[cell]!,
    b: layout.region[n]!,
    sector,
  };
  layout.doors.push(door);
  layout.regions[door.a]!.doors.push(door.id);
  layout.regions[door.b]!.doors.push(door.id);
  ctx.linkedPairs.add(pairKey(door.a, door.b));
  return door;
}

function buildSector(ctx: Ctx, inst: SectorInstance): void {
  const { rng: baseRng, layout } = ctx;
  const rng = baseRng.fork(`secteur:${inst.id}`);
  const def = SECTOR_BY_ID[inst.id];
  const sIdx = SECTORS.indexOf(def);
  const ox = inst.mx * SLOT;
  const oy = inst.my * SLOT;
  const portals = ctx.portals.get(inst.id)!;
  const g = (lx: number, ly: number): number => cellIndex(ox + lx, oy + ly);
  const baseY = inst.floorY;

  /* --- salle centrale --- */
  let hub: { x: number; y: number; w: number; h: number; region: Region } | null = null;
  let tx = rng.int(6, 9);
  let ty = rng.int(6, 9);
  if (def.hub) {
    const { w, h } = def.hub;
    let hx = rng.int(4, 15 - w - 3);
    let hy = rng.int(4, 15 - h - 3);
    if (inst.id === 'noyau') {
      // Laisse cinq cellules libres côté escalier pour la rampe.
      const side = portals[0]!.side;
      hx = rng.int(2, 15 - w - 1);
      hy = rng.int(2, 15 - h - 1);
      if (side === 3) hx = rng.int(6, 15 - w);
      if (side === 1) hx = rng.int(1, 10 - w);
      if (side === 0) hy = rng.int(6, 15 - h);
      if (side === 2) hy = rng.int(1, 10 - h);
    }
    const region = newRegion(ctx, 'room', inst.id, def.hub.type, baseY);
    for (let y = hy; y < hy + h; y++) {
      for (let x = hx; x < hx + w; x++) {
        const c = g(x, y);
        layout.kind[c] = CellKind.Room;
        layout.region[c] = region.id;
        layout.floorY[c] = baseY;
        layout.ceilH[c] = 4.4;
        layout.sectorOf[c] = sIdx;
        region.cells.push(c);
      }
    }
    finalizeBounds(region);
    inst.regions.push(region.id);
    hub = { x: hx, y: hy, w, h, region };
    tx = hx + (w >> 1);
    ty = hy + (h >> 1);
  }
  const inHub = (x: number, y: number): boolean =>
    hub !== null && x >= hub.x && x < hub.x + hub.w && y >= hub.y && y < hub.y + hub.h;

  const carve = (lx: number, ly: number, y: number = baseY): number => {
    const c = g(lx, ly);
    if (layout.kind[c] === CellKind.Void) {
      layout.kind[c] = CellKind.Corridor;
      layout.floorY[c] = y;
      layout.ceilH[c] = 2.8;
      layout.sectorOf[c] = sIdx;
    }
    return c;
  };

  /* --- couloirs depuis les portails --- */
  for (const p of portals) {
    const inward = OPPOSITE[p.side]!;
    const dx = DIR_DX[inward]!;
    const dy = DIR_DY[inward]!;
    // Cellule de vide entre secteurs (raccord) puis première cellule intérieure.
    const gapX = p.side === 1 ? 15 : p.side === 3 ? 0 : p.offset;
    const gapY = p.side === 2 ? 15 : p.side === 0 ? 0 : p.offset;
    const gap = carve(gapX, gapY, p.kind === 'elevator' && inst.id === 'noyau' ? baseY : 0);
    if (inst.id === 'noyau') {
      if (p.kind === 'elevator') {
        layout.kind[gap] = CellKind.Elevator;
        layout.floorY[gap] = 0;
        layout.ceilH[gap] = 2.6;
      } else {
        layout.floorY[gap] = 0;
      }
    }
    let x = gapX + dx;
    let y = gapY + dy;
    let step = 0;
    const horizontal = dx !== 0;
    for (;;) {
      if (inHub(x, y)) break;
      const c = carve(x, y);
      if (inst.id === 'noyau' && p.kind === 'stairs' && step < 4) {
        layout.kind[c] = CellKind.Stairs;
        layout.floorY[c] = -(step + 0.5);
        layout.slopeX[c] = (-1 / CELL) * dx;
        layout.slopeZ[c] = (-1 / CELL) * dy;
        layout.ceilH[c] = 3.0;
      }
      step++;
      if (horizontal ? x === tx : y === ty) break;
      x += dx;
      y += dy;
    }
    if (!inHub(x, y)) {
      const px = horizontal ? 0 : Math.sign(tx - x);
      const py = horizontal ? Math.sign(ty - y) : 0;
      while (!(x === tx && y === ty)) {
        x += px;
        y += py;
        if (inHub(x, y)) break;
        carve(x, y);
      }
    }
  }

  /* --- bras de couloir supplémentaires --- */
  if (!hub) {
    carve(tx, ty);
    for (let d = 0; d < 4; d++) {
      if (!rng.chance(0.55)) continue;
      const len = rng.int(2, 5);
      let x = tx;
      let y = ty;
      for (let i = 0; i < len; i++) {
        x += DIR_DX[d]!;
        y += DIR_DY[d]!;
        if (x < 2 || y < 2 || x > 13 || y > 13) break;
        carve(x, y);
      }
    }
  }

  /* --- régions de couloir (composantes connexes) --- */
  const queue: number[] = [];
  let rootCorridor = -1;
  for (let ly = 0; ly < SLOT; ly++) {
    for (let lx = 0; lx < SLOT; lx++) {
      const start = g(lx, ly);
      const k = layout.kind[start]!;
      if (layout.region[start] !== -1) continue;
      if (k === CellKind.Elevator) {
        const r = newRegion(ctx, 'elevator', inst.id, 'ascenseur', 0);
        r.cells.push(start);
        layout.region[start] = r.id;
        finalizeBounds(r);
        inst.regions.push(r.id);
        continue;
      }
      if (k !== CellKind.Corridor && k !== CellKind.Stairs) continue;
      const r = newRegion(ctx, 'corridor', inst.id, 'couloir', baseY);
      queue.length = 0;
      queue.push(start);
      layout.region[start] = r.id;
      while (queue.length) {
        const c = queue.pop()!;
        r.cells.push(c);
        const cx = (c % GRID_W) - ox;
        const cy = ((c / GRID_W) | 0) - oy;
        for (let d = 0; d < 4; d++) {
          const nx = cx + DIR_DX[d]!;
          const ny = cy + DIR_DY[d]!;
          if (nx < 0 || ny < 0 || nx >= SLOT || ny >= SLOT) continue;
          const n = g(nx, ny);
          const nk = layout.kind[n]!;
          if ((nk === CellKind.Corridor || nk === CellKind.Stairs) && layout.region[n] === -1) {
            layout.region[n] = r.id;
            queue.push(n);
          }
        }
      }
      finalizeBounds(r);
      inst.regions.push(r.id);
      if (!hub && layout.region[g(tx, ty)] === r.id) rootCorridor = r.id;
    }
  }

  /* --- salles --- */
  const isFree = (x: number, y: number, w: number, h: number): boolean => {
    if (x < 1 || y < 1 || x + w > 15 || y + h > 15) return false;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) if (layout.kind[g(xx, yy)] !== CellKind.Void) return false;
    }
    return true;
  };
  const solid = (x: number, y: number): boolean => {
    if (x < 1 || y < 1 || x > 14 || y > 14) return false;
    const k = layout.kind[g(x, y)]!;
    return k === CellKind.Room || k === CellKind.Corridor;
  };
  const touches = (x: number, y: number, w: number, h: number): boolean => {
    for (let xx = x; xx < x + w; xx++) if (solid(xx, y - 1) || solid(xx, y + h)) return true;
    for (let yy = y; yy < y + h; yy++) if (solid(x - 1, yy) || solid(x + w, yy)) return true;
    return false;
  };
  const rooms: Region[] = [];
  const placeRoom = (x: number, y: number, w: number, h: number): void => {
    const r = newRegion(ctx, 'room', inst.id, '', baseY);
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const c = g(xx, yy);
        layout.kind[c] = CellKind.Room;
        layout.region[c] = r.id;
        layout.floorY[c] = baseY;
        layout.ceilH[c] = 3.2;
        layout.sectorOf[c] = sIdx;
        r.cells.push(c);
      }
    }
    r.x = ox + x;
    r.y = oy + y;
    r.w = w;
    r.h = h;
    rooms.push(r);
    inst.regions.push(r.id);
  };
  for (let i = 0; i < 160; i++) {
    const w = rng.int(2, 6);
    const h = rng.int(2, 6);
    if (w * h < 6 || w * h > 30) continue;
    const x = rng.int(1, 15 - w);
    const y = rng.int(1, 15 - h);
    if (isFree(x, y, w, h) && touches(x, y, w, h)) placeRoom(x, y, w, h);
  }
  // Passe de remplissage : plus grand rectangle libre à partir de chaque cellule vide.
  for (let y = 1; y <= 14; y++) {
    for (let x = 1; x <= 14; x++) {
      if (layout.kind[g(x, y)] !== CellKind.Void) continue;
      let w = 1;
      while (w < 5 && isFree(x, y, w + 1, 1)) w++;
      let h = 1;
      while (h < 5 && isFree(x, y, w, h + 1)) h++;
      if (w >= 2 && h >= 2 && w * h >= 6 && touches(x, y, w, h)) placeRoom(x, y, w, h);
    }
  }

  /* --- arêtes partagées entre régions --- */
  const shared: SharedEdge[] = [];
  const plain = (k: number): boolean => k === CellKind.Room || k === CellKind.Corridor;
  for (let ly = 1; ly <= 14; ly++) {
    for (let lx = 1; lx <= 14; lx++) {
      const c = g(lx, ly);
      if (!plain(layout.kind[c]!)) continue;
      for (const d of [1, 2]) {
        const nx = lx + DIR_DX[d]!;
        const ny = ly + DIR_DY[d]!;
        if (nx > 14 || ny > 14) continue;
        const n = g(nx, ny);
        if (!plain(layout.kind[n]!)) continue;
        const ra = layout.region[c]!;
        const rb = layout.region[n]!;
        if (ra !== rb) shared.push({ cell: c, dir: d, ra, rb });
      }
    }
  }

  /* --- arbre couvrant : toute région devient accessible --- */
  const root = hub ? hub.region.id : rootCorridor;
  if (root < 0) throw new GenerationRetry(`pas de racine pour ${inst.id}`);
  const connected = new Set<number>([root]);
  const candidates: SharedEdge[] = [];
  const weights: number[] = [];
  for (;;) {
    candidates.length = 0;
    weights.length = 0;
    let total = 0;
    for (const e of shared) {
      const ca = connected.has(e.ra);
      if (ca === connected.has(e.rb)) continue;
      const inside = layout.regions[ca ? e.ra : e.rb]!;
      const wgt = inside.kind === 'corridor' ? 4 : inside === hub?.region ? 2 : 1;
      candidates.push(e);
      weights.push(wgt);
      total += wgt;
    }
    if (candidates.length === 0) break;
    let roll = rng.next() * total;
    let chosen = candidates[0]!;
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) {
        chosen = candidates[i]!;
        break;
      }
    }
    const ka = layout.regions[chosen.ra]!;
    const kb = layout.regions[chosen.rb]!;
    const bothCorridor = ka.kind === 'corridor' && kb.kind === 'corridor';
    const hallArch = def.hub?.type === 'hall_accueil' && (ka === hub?.region || kb === hub?.region);
    addDoor(ctx, chosen.cell, chosen.dir, bothCorridor || hallArch ? 'arch' : 'door', null, inst.id);
    connected.add(chosen.ra);
    connected.add(chosen.rb);
  }
  for (const rid of inst.regions) {
    const r = layout.regions[rid]!;
    if (r.kind !== 'elevator' && !connected.has(rid)) throw new GenerationRetry(`région isolée dans ${inst.id}`);
  }

  /* --- chemins secondaires : portes, grilles de ventilation, passages secrets --- */
  rng.shuffle(shared);
  const usedCells = new Set<number>();
  for (const e of shared) {
    const key = pairKey(e.ra, e.rb);
    if (ctx.linkedPairs.has(key) || usedCells.has(e.cell)) continue;
    const ka = layout.regions[e.ra]!;
    const kb = layout.regions[e.rb]!;
    const roll = rng.next();
    const ventBias = inst.id === 'maintenance' ? 0.16 : 0.07;
    if (roll < 0.08) {
      addDoor(ctx, e.cell, e.dir, ka.kind === 'corridor' && kb.kind === 'corridor' ? 'arch' : 'door', null, inst.id);
    } else if (roll < 0.08 + ventBias) {
      addDoor(ctx, e.cell, e.dir, 'vent', null, inst.id);
    } else if (roll < 0.11 + ventBias && ka.kind === 'room' && kb.kind === 'room' && !hub) {
      addDoor(ctx, e.cell, e.dir, 'secret', null, inst.id);
    } else {
      // Paire laissée sans liaison : on ne la retirera plus.
      ctx.linkedPairs.add(key);
      continue;
    }
    usedCells.add(e.cell);
  }

  /* --- conduits creusés dans les murs épais --- */
  let conduits = 0;
  const maxConduits = inst.id === 'maintenance' ? 4 : 2;
  const tryConduit = (lx: number, ly: number, d: number): void => {
    if (conduits >= maxConduits) return;
    const dx = DIR_DX[d]!;
    const dy = DIR_DY[d]!;
    const from = g(lx, ly);
    if (!plain(layout.kind[from]!)) return;
    const run: number[] = [];
    let x = lx + dx;
    let y = ly + dy;
    while (x >= 1 && y >= 1 && x <= 14 && y <= 14 && layout.kind[g(x, y)] === CellKind.Void && run.length < 4) {
      run.push(g(x, y));
      x += dx;
      y += dy;
    }
    if (run.length === 0 || run.length > 3) return;
    if (x < 1 || y < 1 || x > 14 || y > 14) return;
    const to = g(x, y);
    if (!plain(layout.kind[to]!)) return;
    const ra = layout.region[from]!;
    const rb = layout.region[to]!;
    if (ra === rb || !rng.chance(0.35)) return;
    const r = newRegion(ctx, 'conduit', inst.id, 'conduit', baseY);
    for (const c of run) {
      layout.kind[c] = CellKind.Conduit;
      layout.region[c] = r.id;
      layout.floorY[c] = baseY;
      layout.ceilH[c] = 1.1;
      layout.sectorOf[c] = sIdx;
      r.cells.push(c);
    }
    finalizeBounds(r);
    inst.regions.push(r.id);
    addDoor(ctx, from, d, 'vent', null, inst.id);
    addDoor(ctx, run[run.length - 1]!, d, 'vent', null, inst.id);
    conduits++;
  };
  const scan: [number, number, number][] = [];
  for (let ly = 1; ly <= 14; ly++) for (let lx = 1; lx <= 14; lx++) for (const d of [1, 2]) scan.push([lx, ly, d]);
  rng.shuffle(scan);
  for (const [lx, ly, d] of scan) tryConduit(lx, ly, d);

  /* --- attribution des types de salles --- */
  const sorted = rooms.slice().sort((a, b) => b.w * b.h - a.w * a.h || a.id - b.id);
  let secretDone = inst.id === 'accueil';
  const wanted = def.rooms.slice();
  for (const r of sorted) {
    const onlySecret = r.doors.length > 0 && r.doors.every((id) => layout.doors[id]!.kind === 'secret');
    if (onlySecret) {
      r.type = 'cache';
      r.secret = true;
      continue;
    }
    if (wanted.length > 0) {
      r.type = wanted.shift()!;
      continue;
    }
    if (!secretDone && r.doors.length === 1 && r.w * r.h <= 12 && rng.chance(0.4)) {
      const door = layout.doors[r.doors[0]!]!;
      if (door.kind === 'door') {
        door.kind = 'secret';
        r.type = 'cache';
        r.secret = true;
        secretDone = true;
        continue;
      }
    }
    r.type = rng.pick(def.filler);
  }
  if (wanted.length > 0 && (inst.id === 'accueil' || wanted.length > def.rooms.length - 2)) {
    throw new GenerationRetry(`salles obligatoires manquantes dans ${inst.id}`);
  }
}

/* ------------------------------------------------------------------ */
/* 3. Sas entre secteurs, arêtes                                       */
/* ------------------------------------------------------------------ */

function buildGates(ctx: Ctx): void {
  const { layout } = ctx;
  const byId = new Map(layout.sectors.map((s) => [s.id, s]));
  layout.links.forEach((link, li) => {
    const a = byId.get(link.a)!;
    const portalsA = ctx.portals.get(link.a)!.filter((p) => p.link === li);
    for (const p of portalsA) {
      const ox = a.mx * SLOT;
      const oy = a.my * SLOT;
      const gx = p.side === 1 ? 15 : p.side === 3 ? 0 : p.offset;
      const gy = p.side === 2 ? 15 : p.side === 0 ? 0 : p.offset;
      const cell = cellIndex(ox + gx, oy + gy);
      const defA = SECTOR_BY_ID[link.a];
      const defB = SECTOR_BY_ID[link.b];
      let lock: LockDef | null = null;
      let kind: DoorKind = 'gate';
      if (p.kind === 'elevator') {
        kind = 'elevator';
        lock = { type: 'power', sector: 'noyau' };
      } else if (link.main) {
        const level = defB.gateLevel;
        if (level > 0) lock = { type: 'card', level: level as 1 | 2 | 3 };
      } else {
        // Raccourci : verrouillé depuis le secteur le plus profond.
        const deeper = defB.tier > defA.tier || (defB.tier === defA.tier && byId.get(link.b)!.depth >= a.depth);
        const n = cell + DIR_DX[p.side]! + DIR_DY[p.side]! * GRID_W;
        lock = { type: 'latch', side: layout.region[deeper ? n : cell]! };
      }
      const door = addDoor(ctx, cell, p.side, kind, lock, link.b);
      link.doors.push(door.id);
      if (p.kind === 'elevator') {
        // La cabine est la cellule côté Noyau ; seconde porte vers le niveau bas.
        const noy = link.a === 'noyau' ? link.a : link.b;
        const cab = link.a === 'noyau' ? cell : cell + DIR_DX[p.side]! + DIR_DY[p.side]! * GRID_W;
        const out = link.a === 'noyau' ? OPPOSITE[p.side]! : p.side;
        const lower = addDoor(ctx, cab, out, 'elevator', { type: 'power', sector: 'noyau' }, noy);
        link.doors.push(lower.id);
        layout.elevator = { cell: cab, topY: 0, bottomY: NOYAU_Y, doorTop: door.id, doorBottom: lower.id };
      }
    }
  });
}

/** Hauteur du sol d'une cellule au milieu de l'arête `dir`. */
function edgeHeight(layout: Layout, cell: number, dir: number): number {
  return (
    layout.floorY[cell]! +
    layout.slopeX[cell]! * DIR_DX[dir]! * (CELL / 2) +
    layout.slopeZ[cell]! * DIR_DY[dir]! * (CELL / 2)
  );
}

function buildEdges(layout: Layout): void {
  const { kind, region, edges } = layout;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const c = cellIndex(x, y);
      for (let d = 0; d < 4; d++) {
        let v = EDGE_WALL;
        const nx = x + DIR_DX[d]!;
        const ny = y + DIR_DY[d]!;
        if (kind[c] !== CellKind.Void && nx >= 0 && ny >= 0 && nx < GRID_W && ny < GRID_H) {
          const n = cellIndex(nx, ny);
          if (kind[n] !== CellKind.Void && region[n] === region[c]) {
            const dh = Math.abs(edgeHeight(layout, c, d) - edgeHeight(layout, n, OPPOSITE[d]!));
            if (dh < 0.3) v = EDGE_OPEN;
          }
        }
        edges[c * 4 + d] = v;
      }
    }
  }
  for (const door of layout.doors) {
    const n = door.cell + DIR_DX[door.dir]! + DIR_DY[door.dir]! * GRID_W;
    edges[door.cell * 4 + door.dir] = EDGE_DOOR_BASE + door.id;
    edges[n * 4 + OPPOSITE[door.dir]!] = EDGE_DOOR_BASE + door.id;
  }
}

/* ------------------------------------------------------------------ */
/* Point d'entrée                                                      */
/* ------------------------------------------------------------------ */

function attemptLayout(seed: string, attempt: number): Layout {
  const layout = emptyLayout(seed, attempt);
  const ctx: Ctx = {
    rng: new Rng(`${seed}#${attempt}`),
    layout,
    portals: new Map(),
    linkedPairs: new Set(),
  };
  placeSectors(ctx);
  for (const inst of layout.sectors) buildSector(ctx, inst);
  buildGates(ctx);
  buildEdges(layout);
  if (!layout.elevator) throw new GenerationRetry('ascenseur manquant');
  dressLayout(layout, ctx.rng.fork('decor'));
  const report = validateLayout(layout, { repair: true });
  if (!report.ok) throw new GenerationRetry(report.errors.join('; '));
  return layout;
}

const cache = new Map<string, Layout>();

/**
 * Génère (ou relit depuis le cache) la carte associée à une graine.
 * La même graine produit toujours exactement la même carte.
 */
export function generateLayout(seed: string): Layout {
  const cached = cache.get(seed);
  if (cached) return cached;
  let lastError = '';
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const layout = attemptLayout(seed, attempt);
      cache.clear();
      cache.set(seed, layout);
      return layout;
    } catch (err) {
      if (!(err instanceof GenerationRetry)) throw err;
      lastError = err.message;
    }
  }
  throw new Error(`Génération impossible pour la graine « ${seed} » : ${lastError}`);
}
