/**
 * Requêtes spatiales sur la carte : hauteur du sol, collisions, lignes de vue,
 * occlusion sonore. Pur (aucune dépendance au moteur 3D) et sans allocation
 * dans les fonctions appelées à chaque image.
 */
import { WALL_T } from './dressing';
import { FIXTURE_SPECS, PROPS } from './props';
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
  type DoorDef,
  type DoorKind,
  type Layout,
} from './types';

export const DOOR_CLOSED = 0;
export const DOOR_AJAR = 1;
export const DOOR_OPEN = 2;

/** Largeur et hauteur de l'ouverture selon le type de porte. */
export const OPENING: Record<DoorKind, { w: number; h: number }> = {
  door: { w: 1.1, h: 2.1 },
  gate: { w: 1.5, h: 2.3 },
  vent: { w: 0.9, h: 1.05 },
  secret: { w: 1.1, h: 2.1 },
  arch: { w: 1.6, h: 2.5 },
  elevator: { w: 1.4, h: 2.2 },
};

export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
  /** Porte associée (battant) : le collider n'est actif que si elle n'est pas ouverte. */
  door: number;
  blocksSight: boolean;
}

export interface MoveResult {
  x: number;
  z: number;
  hit: boolean;
}

export class WorldGrid {
  readonly colliders: Collider[] = [];
  /** Position de chaque porte : DOOR_CLOSED, DOOR_AJAR ou DOOR_OPEN. */
  readonly doorPos: Uint8Array;
  elevatorY: number;
  private buckets: Collider[][];
  private readonly out: MoveResult = { x: 0, z: 0, hit: false };

  constructor(readonly layout: Layout) {
    this.doorPos = new Uint8Array(layout.doors.length);
    for (const d of layout.doors) if (d.kind === 'arch') this.doorPos[d.id] = DOOR_OPEN;
    this.elevatorY = layout.elevator ? layout.elevator.topY : 0;
    this.buckets = Array.from({ length: GRID_W * GRID_H }, () => []);
    this.buildWalls();
    this.buildProps();
  }

  /* ---------------- construction ---------------- */

  private add(c: Collider): void {
    this.colliders.push(c);
    const x0 = Math.max(0, Math.floor((c.minX - 0.5) / CELL));
    const x1 = Math.min(GRID_W - 1, Math.floor((c.maxX + 0.5) / CELL));
    const z0 = Math.max(0, Math.floor((c.minZ - 0.5) / CELL));
    const z1 = Math.min(GRID_H - 1, Math.floor((c.maxZ + 0.5) / CELL));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.buckets[z * GRID_W + x]!.push(c);
  }

  /** Étendue verticale d'une cellule (sol le plus bas, plafond le plus haut). */
  cellMinY(cell: number): number {
    const l = this.layout;
    if (l.kind[cell] === CellKind.Elevator && l.elevator) return l.elevator.bottomY;
    return l.floorY[cell]! - (Math.abs(l.slopeX[cell]!) + Math.abs(l.slopeZ[cell]!)) * (CELL / 2);
  }

  cellMaxY(cell: number): number {
    const l = this.layout;
    if (l.kind[cell] === CellKind.Elevator && l.elevator) return l.elevator.topY + l.ceilH[cell]!;
    return l.floorY[cell]! + (Math.abs(l.slopeX[cell]!) + Math.abs(l.slopeZ[cell]!)) * (CELL / 2) + l.ceilH[cell]!;
  }

  private slab(cell: number, dir: number, from: number, to: number, minY: number, maxY: number, door: number, sight: boolean): void {
    // Segment de mur le long de l'arête `dir` de la cellule, entre les abscisses locales from..to (0..CELL).
    const cx = (cell % GRID_W) * CELL;
    const cz = ((cell / GRID_W) | 0) * CELL;
    const t = WALL_T / 2;
    let minX: number;
    let maxX: number;
    let minZ: number;
    let maxZ: number;
    if (dir === 0 || dir === 2) {
      const z = dir === 0 ? cz : cz + CELL;
      minX = cx + from;
      maxX = cx + to;
      minZ = z - t;
      maxZ = z + t;
    } else {
      const x = dir === 3 ? cx : cx + CELL;
      minZ = cz + from;
      maxZ = cz + to;
      minX = x - t;
      maxX = x + t;
    }
    this.add({ minX, maxX, minZ, maxZ, minY, maxY, door, blocksSight: sight });
  }

  private buildWalls(): void {
    const l = this.layout;
    for (let cell = 0; cell < l.kind.length; cell++) {
      if (l.kind[cell] === CellKind.Void) continue;
      for (let d = 0; d < 4; d++) {
        const e = l.edges[cell * 4 + d]!;
        if (e === EDGE_OPEN) continue;
        const n = cell + DIR_DX[d]! + DIR_DY[d]! * GRID_W;
        const nx = (cell % GRID_W) + DIR_DX[d]!;
        const ny = ((cell / GRID_W) | 0) + DIR_DY[d]!;
        const nVoid = nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H || l.kind[n] === CellKind.Void;
        // Chaque arête intérieure n'est traitée qu'une fois (depuis la cellule nord/ouest).
        if (!nVoid && (d === 0 || d === 3)) continue;
        const minY = nVoid ? this.cellMinY(cell) : Math.min(this.cellMinY(cell), this.cellMinY(n));
        const maxY = nVoid ? this.cellMaxY(cell) : Math.max(this.cellMaxY(cell), this.cellMaxY(n));
        if (e === EDGE_WALL) {
          this.slab(cell, d, -WALL_T / 2, CELL + WALL_T / 2, minY - 0.5, maxY + 0.5, -1, true);
          continue;
        }
        const door = l.doors[e - EDGE_DOOR_BASE]!;
        const op = OPENING[door.kind];
        const a = (CELL - op.w) / 2;
        const base = this.doorBaseY(door);
        this.slab(cell, d, -WALL_T / 2, a, minY - 0.5, maxY + 0.5, -1, true);
        this.slab(cell, d, CELL - a, CELL + WALL_T / 2, minY - 0.5, maxY + 0.5, -1, true);
        // Linteau et allège : bloquent le passage mais pas le test de vue 2D (l'ouverture reste visible).
        this.slab(cell, d, a, CELL - a, base + op.h, maxY + 0.5, -1, false);
        if (base - (minY - 0.5) > 0.05) this.slab(cell, d, a, CELL - a, minY - 0.5, base - 0.02, -1, false);
        if (door.kind !== 'arch') this.slab(cell, d, a, CELL - a, base, base + op.h, door.id, false);
      }
    }
  }

  /** Hauteur du seuil d'une porte. */
  doorBaseY(door: DoorDef): number {
    const l = this.layout;
    const n = door.cell + DIR_DX[door.dir]! + DIR_DY[door.dir]! * GRID_W;
    if (l.elevator && door.kind === 'elevator') return door.id === l.elevator.doorTop ? l.elevator.topY : l.elevator.bottomY;
    return Math.max(
      l.kind[door.cell] === CellKind.Elevator ? -99 : l.floorY[door.cell]!,
      l.kind[n] === CellKind.Elevator ? -99 : l.floorY[n]!,
    );
  }

  private buildProps(): void {
    const l = this.layout;
    const box = (x: number, y: number, z: number, w: number, d: number, h: number, rot: number, sight: boolean): void => {
      const swap = Math.abs(Math.sin(rot)) > 0.7;
      const hw = (swap ? d : w) / 2;
      const hd = (swap ? w : d) / 2;
      this.add({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, minY: y, maxY: y + h, door: -1, blocksSight: sight });
    };
    for (const p of l.props) {
      const spec = PROPS[p.type]!;
      if (spec.solid) box(p.x, p.y, p.z, spec.w, spec.d, spec.h, p.rot, spec.tall === true);
    }
    for (const f of l.fixtures) {
      const spec = FIXTURE_SPECS[f.type]!;
      if (spec.solid) box(f.x, f.y, f.z, spec.w, spec.d, spec.h, f.rot, spec.tall === true);
    }
  }

  /* ---------------- requêtes ---------------- */

  cellAt(x: number, z: number): number {
    const cx = Math.floor(x / CELL);
    const cz = Math.floor(z / CELL);
    if (cx < 0 || cz < 0 || cx >= GRID_W || cz >= GRID_H) return -1;
    return cz * GRID_W + cx;
  }

  walkable(x: number, z: number): boolean {
    const c = this.cellAt(x, z);
    return c >= 0 && this.layout.kind[c] !== CellKind.Void;
  }

  regionAt(x: number, z: number): number {
    const c = this.cellAt(x, z);
    return c < 0 ? -1 : this.layout.region[c]!;
  }

  heightAt(x: number, z: number): number {
    const c = this.cellAt(x, z);
    if (c < 0) return 0;
    const l = this.layout;
    if (l.kind[c] === CellKind.Elevator) return this.elevatorY;
    const cx = ((c % GRID_W) + 0.5) * CELL;
    const cz = (((c / GRID_W) | 0) + 0.5) * CELL;
    return l.floorY[c]! + l.slopeX[c]! * (x - cx) + l.slopeZ[c]! * (z - cz);
  }

  /** Hauteur libre sous plafond à cette position. */
  headroomAt(x: number, z: number): number {
    const c = this.cellAt(x, z);
    return c < 0 ? 3 : this.layout.ceilH[c]!;
  }

  doorBlocks(id: number): boolean {
    return this.doorPos[id] !== DOOR_OPEN;
  }

  /**
   * Résout les collisions d'un cylindre vertical (rayon r, pieds à feetY, hauteur h).
   * Le résultat est renvoyé dans un objet réutilisé : le lire immédiatement.
   */
  resolve(x: number, z: number, r: number, feetY: number, h: number): MoveResult {
    const out = this.out;
    out.hit = false;
    const low = feetY + 0.4;
    const high = feetY + h;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      const cx = Math.floor(x / CELL);
      const cz = Math.floor(z / CELL);
      if (cx < 0 || cz < 0 || cx >= GRID_W || cz >= GRID_H) break;
      const bucket = this.buckets[cz * GRID_W + cx]!;
      for (let i = 0; i < bucket.length; i++) {
        const c = bucket[i]!;
        if (c.door >= 0 && this.doorPos[c.door] === DOOR_OPEN) continue;
        if (c.maxY <= low || c.minY >= high) continue;
        const px = x < c.minX ? c.minX : x > c.maxX ? c.maxX : x;
        const pz = z < c.minZ ? c.minZ : z > c.maxZ ? c.maxZ : z;
        let dx = x - px;
        let dz = z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = r - d;
          x += (dx / d) * push;
          z += (dz / d) * push;
        } else {
          // Centre à l'intérieur de la boîte : sortie par la face la plus proche.
          const left = x - c.minX;
          const right = c.maxX - x;
          const back = z - c.minZ;
          const front = c.maxZ - z;
          const m = Math.min(left, right, back, front);
          dx = dz = 0;
          if (m === left) x = c.minX - r;
          else if (m === right) x = c.maxX + r;
          else if (m === back) z = c.minZ - r;
          else z = c.maxZ + r;
        }
        moved = true;
        out.hit = true;
      }
      if (!moved) break;
    }
    out.x = x;
    out.z = z;
    return out;
  }

  /** Valeur d'occlusion d'une arête : 0 = libre, 1 = mur plein. */
  private edgeOcclusion(cell: number, dir: number, forSound: boolean): number {
    const e = this.layout.edges[cell * 4 + dir]!;
    if (e === EDGE_OPEN) return 0;
    if (e === EDGE_WALL) return 1;
    const id = e - EDGE_DOOR_BASE;
    const door = this.layout.doors[id]!;
    const pos = this.doorPos[id]!;
    if (pos === DOOR_OPEN) return forSound ? 0 : door.kind === 'vent' ? 0.5 : 0;
    if (forSound) return door.kind === 'vent' ? 0.1 : pos === DOOR_AJAR ? 0.25 : 0.6;
    return 1;
  }

  /**
   * Parcourt les cellules traversées par le segment et cumule l'occlusion des arêtes
   * franchies. S'arrête dès que `limit` est atteint.
   */
  private trace(x0: number, z0: number, x1: number, z1: number, forSound: boolean, limit: number): number {
    let cx = Math.floor(x0 / CELL);
    let cz = Math.floor(z0 / CELL);
    const ex = Math.floor(x1 / CELL);
    const ez = Math.floor(z1 / CELL);
    const dx = x1 - x0;
    const dz = z1 - z0;
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(CELL / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
    let tMaxX = dx !== 0 ? ((dx > 0 ? (cx + 1) * CELL - x0 : x0 - cx * CELL) / Math.abs(dx)) : Infinity;
    let tMaxZ = dz !== 0 ? ((dz > 0 ? (cz + 1) * CELL - z0 : z0 - cz * CELL) / Math.abs(dz)) : Infinity;
    let total = 0;
    for (let guard = 0; guard < 256; guard++) {
      if (cx === ex && cz === ez) break;
      if (cx < 0 || cz < 0 || cx >= GRID_W || cz >= GRID_H) return limit;
      const cell = cz * GRID_W + cx;
      if (tMaxX < tMaxZ) {
        total += this.edgeOcclusion(cell, stepX > 0 ? 1 : 3, forSound);
        cx += stepX;
        tMaxX += tDeltaX;
      } else {
        total += this.edgeOcclusion(cell, stepZ > 0 ? 2 : 0, forSound);
        cz += stepZ;
        tMaxZ += tDeltaZ;
      }
      if (total >= limit) return total;
    }
    return total;
  }

  /** Vrai si rien n'arrête la vue entre les deux points (murs, portes fermées, meubles hauts). */
  sight(x0: number, z0: number, x1: number, z1: number): boolean {
    if (this.trace(x0, z0, x1, z1, false, 1) >= 1) return false;
    // Meubles hauts : test segment / boîte dans les cellules du segment (échantillonnage tous les mètres).
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.ceil(len);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = x0 + dx * t;
      const z = z0 + dz * t;
      const c = this.cellAt(x, z);
      if (c < 0) return false;
      const bucket = this.buckets[c]!;
      for (let k = 0; k < bucket.length; k++) {
        const b = bucket[k]!;
        if (!b.blocksSight || b.door >= 0) continue;
        if (b.maxX - b.minX > CELL || b.maxZ - b.minZ > CELL) continue; // murs : déjà traités par trace()
        if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return false;
      }
    }
    return true;
  }

  /** Occlusion sonore cumulée (0 = à l'air libre ; chaque mur plein compte pour 1). */
  soundOcclusion(x0: number, z0: number, x1: number, z1: number): number {
    return this.trace(x0, z0, x1, z1, true, 4);
  }
}
