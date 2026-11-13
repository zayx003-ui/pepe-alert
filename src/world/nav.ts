/**
 * Navigation des entités : A* sur la grille de cellules.
 * Les capacités de l'entité (ouvrir les portes, emprunter les conduits, enfoncer
 * une porte verrouillée) déterminent les arêtes franchissables.
 */
import { DOOR_OPEN, type WorldGrid } from './grid';
import { CellKind, DIR_DX, DIR_DY, EDGE_DOOR_BASE, EDGE_OPEN, EDGE_WALL, GRID_H, GRID_W } from './types';

export interface NavCaps {
  /** Peut ouvrir une porte fermée non verrouillée. */
  openDoors: boolean;
  /** Peut emprunter grilles et conduits. */
  vents: boolean;
  /** Peut enfoncer une porte verrouillée ou barricadée (coût élevé). */
  breach: boolean;
  /** Peut franchir les sas entre secteurs. */
  gates: boolean;
}

/** État dynamique minimal des portes dont la navigation a besoin. */
export interface DoorQuery {
  isLocked(id: number): boolean;
}

const N = GRID_W * GRID_H;
const gScore = new Float32Array(N);
const fScore = new Float32Array(N);
const cameFrom = new Int32Array(N);
const closed = new Uint8Array(N);
const stamp = new Uint32Array(N);
let currentStamp = 0;
const heap: number[] = [];

function heapPush(node: number): void {
  heap.push(node);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (fScore[heap[p]!]! <= fScore[heap[i]!]!) break;
    const t = heap[p]!;
    heap[p] = heap[i]!;
    heap[i] = t;
    i = p;
  }
}

function heapPop(): number {
  const top = heap[0]!;
  const last = heap.pop()!;
  if (heap.length > 0) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && fScore[heap[l]!]! < fScore[heap[m]!]!) m = l;
      if (r < heap.length && fScore[heap[r]!]! < fScore[heap[m]!]!) m = r;
      if (m === i) break;
      const t = heap[m]!;
      heap[m] = heap[i]!;
      heap[i] = t;
      i = m;
    }
  }
  return top;
}

/** Coût de franchissement d'une arête, ou -1 si infranchissable. */
export function edgeCost(grid: WorldGrid, doors: DoorQuery, cell: number, dir: number, caps: NavCaps): number {
  const l = grid.layout;
  const e = l.edges[cell * 4 + dir]!;
  if (e === EDGE_WALL) return -1;
  const n = cell + DIR_DX[dir]! + DIR_DY[dir]! * GRID_W;
  const nk = l.kind[n]!;
  if (nk === CellKind.Elevator) return -1;
  if (nk === CellKind.Conduit && !caps.vents) return -1;
  let cost = 1 + (l.blocked[n] ? 8 : 0);
  if (e === EDGE_OPEN) return cost;
  const id = e - EDGE_DOOR_BASE;
  const door = l.doors[id]!;
  if (door.kind === 'arch') return cost;
  if (door.kind === 'elevator') return -1;
  if (door.kind === 'vent') return caps.vents ? cost + 1 : -1;
  // Une porte laissée ouverte laisse passer n'importe quelle entité.
  if (grid.doorPos[id] === DOOR_OPEN) return cost;
  if (door.kind === 'gate' && !caps.gates) return -1;
  if (door.kind === 'secret') return -1;
  if (doors.isLocked(id)) {
    if (!caps.breach || door.kind === 'gate') return -1;
    cost += 20;
  } else if (!caps.openDoors) return -1;
  return cost + 2;
}

/**
 * Chemin de cellule à cellule. Renvoie la liste des cellules à parcourir (hors
 * cellule de départ) ou null si la destination est inatteignable.
 */
export function findPath(grid: WorldGrid, doors: DoorQuery, from: number, to: number, caps: NavCaps, maxNodes = 2500): number[] | null {
  if (from < 0 || to < 0) return null;
  if (from === to) return [];
  const l = grid.layout;
  if (l.kind[to] === CellKind.Void || l.kind[from] === CellKind.Void) return null;
  currentStamp++;
  heap.length = 0;
  const tx = to % GRID_W;
  const ty = (to / GRID_W) | 0;
  const h = (c: number): number => Math.abs((c % GRID_W) - tx) + Math.abs(((c / GRID_W) | 0) - ty);
  stamp[from] = currentStamp;
  gScore[from] = 0;
  fScore[from] = h(from);
  closed[from] = 0;
  cameFrom[from] = -1;
  heapPush(from);
  let expanded = 0;
  while (heap.length > 0 && expanded < maxNodes) {
    const cur = heapPop();
    if (cur === to) {
      const path: number[] = [];
      let c = cur;
      while (c !== from) {
        path.push(c);
        c = cameFrom[c]!;
      }
      path.reverse();
      return path;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;
    expanded++;
    for (let d = 0; d < 4; d++) {
      const cost = edgeCost(grid, doors, cur, d, caps);
      if (cost < 0) continue;
      const n = cur + DIR_DX[d]! + DIR_DY[d]! * GRID_W;
      const g = gScore[cur]! + cost;
      if (stamp[n] !== currentStamp) {
        stamp[n] = currentStamp;
        closed[n] = 0;
        gScore[n] = Infinity;
      }
      if (closed[n] || g >= gScore[n]!) continue;
      gScore[n] = g;
      fScore[n] = g + h(n);
      cameFrom[n] = cur;
      heapPush(n);
    }
  }
  return null;
}
