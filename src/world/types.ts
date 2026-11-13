/**
 * Modèle de données du complexe NOCTURNE.
 * Tout ce fichier est pur (aucune dépendance au moteur 3D) : la génération, la
 * validation, la navigation IA et les tests unitaires s'appuient dessus.
 */

/** Taille d'une cellule de grille en mètres. */
export const CELL = 2;
/** Taille d'un emplacement de secteur en cellules (intérieur 14x14 + 1 cellule de vide de chaque côté). */
export const SLOT = 16;
export const MACRO_W = 5;
export const MACRO_H = 4;
export const GRID_W = MACRO_W * SLOT;
export const GRID_H = MACRO_H * SLOT;

export const enum CellKind {
  Void = 0,
  Room = 1,
  Corridor = 2,
  Conduit = 3,
  Stairs = 4,
  Elevator = 5,
}

/** Directions cardinales : N (z-), E (x+), S (z+), O (x-). */
export const DIR_DX = [0, 1, 0, -1] as const;
export const DIR_DY = [-1, 0, 1, 0] as const;
export const OPPOSITE = [2, 3, 0, 1] as const;

export const EDGE_WALL = 0;
export const EDGE_OPEN = 1;
/** Les valeurs >= EDGE_DOOR_BASE désignent la porte d'indice (valeur - EDGE_DOOR_BASE). */
export const EDGE_DOOR_BASE = 2;

export type SectorId =
  | 'accueil'
  | 'administration'
  | 'bio'
  | 'acoustique'
  | 'medical'
  | 'archives'
  | 'serveurs'
  | 'maintenance'
  | 'centrale'
  | 'quarantaine'
  | 'experimental'
  | 'noyau';

export type DoorKind = 'door' | 'gate' | 'vent' | 'secret' | 'arch' | 'elevator';

export type LockDef =
  | { type: 'card'; level: 1 | 2 | 3 }
  | { type: 'power'; sector: SectorId }
  /** Verrouillée de l'intérieur : ne s'ouvre que depuis la région `side`. */
  | { type: 'latch'; side: number }
  | { type: 'terminal'; terminal: string };

export interface DoorDef {
  id: number;
  cell: number;
  dir: number;
  kind: DoorKind;
  lock: LockDef | null;
  /** Régions de part et d'autre (a = côté `cell`). */
  a: number;
  b: number;
  sector: SectorId;
  /** Porte déjà barricadée à la génération (scène « barricade »). */
  barricaded?: boolean;
}

export type RegionKind = 'room' | 'corridor' | 'conduit' | 'elevator';

export interface Region {
  id: number;
  kind: RegionKind;
  sector: SectorId;
  /** Rectangle en cellules pour les salles ; boîte englobante sinon. */
  x: number;
  y: number;
  w: number;
  h: number;
  cells: number[];
  type: string;
  floorY: number;
  secret: boolean;
  story: string | null;
  doors: number[];
}

export interface PropDef {
  type: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  region: number;
  variant: number;
}

export interface ItemSpawn {
  uid: number;
  item: string;
  x: number;
  y: number;
  z: number;
  region: number;
  /** Donnée libre : identifiant de document, niveau de carte… */
  data?: string;
}

export type FixtureType =
  | 'fusebox'
  | 'generator_main'
  | 'generator_aux'
  | 'terminal'
  | 'airlock'
  | 'medstation'
  | 'valve'
  | 'purge'
  | 'emitter'
  | 'coolant'
  | 'antenna'
  | 'incinerator'
  | 'cryo'
  | 'core_console'
  | 'locker'
  | 'camera'
  | 'sampler'
  | 'probe';

export interface FixtureDef {
  id: string;
  type: FixtureType;
  sector: SectorId;
  region: number;
  x: number;
  y: number;
  z: number;
  rot: number;
}

export interface LightDef {
  id: number;
  x: number;
  y: number;
  z: number;
  region: number;
  sector: SectorId;
  /** 0 = normal, 1 = clignotant, 2 = détruit. */
  mode: 0 | 1 | 2;
}

export interface SectorInstance {
  id: SectorId;
  /** Emplacement dans la macro-grille. */
  mx: number;
  my: number;
  floorY: number;
  regions: number[];
  depth: number;
}

export interface SectorLink {
  a: SectorId;
  b: SectorId;
  /** Arête de l'arbre principal (true) ou raccourci secondaire (false). */
  main: boolean;
  doors: number[];
}

export interface Layout {
  seed: string;
  width: number;
  height: number;
  kind: Uint8Array;
  region: Int16Array;
  floorY: Float32Array;
  slopeX: Float32Array;
  slopeZ: Float32Array;
  ceilH: Float32Array;
  /** Indice du secteur (dans SECTORS) de chaque cellule, -1 pour le vide. */
  sectorOf: Int8Array;
  /** Cellules occupées par un meuble central : évitées par la navigation IA. */
  blocked: Uint8Array;
  edges: Int16Array;
  regions: Region[];
  doors: DoorDef[];
  sectors: SectorInstance[];
  links: SectorLink[];
  props: PropDef[];
  items: ItemSpawn[];
  fixtures: FixtureDef[];
  lights: LightDef[];
  spawn: { x: number; y: number; z: number; region: number };
  extraction: { region: number; x: number; z: number };
  /** Cellule de la cabine d'ascenseur (ou -1) et ses niveaux. */
  elevator: { cell: number; topY: number; bottomY: number; doorTop: number; doorBottom: number } | null;
  /** Nombre de corrections automatiques appliquées par le validateur. */
  repairs: number;
  /** Tentative de génération retenue (0 = première). */
  attempt: number;
}

export function cellIndex(x: number, y: number): number {
  return y * GRID_W + x;
}

export function cellX(i: number): number {
  return i % GRID_W;
}

export function cellY(i: number): number {
  return (i / GRID_W) | 0;
}

export function inGrid(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < GRID_W && y < GRID_H;
}

/** Centre d'une cellule en coordonnées monde. */
export function cellCenterX(i: number): number {
  return (cellX(i) + 0.5) * CELL;
}

export function cellCenterZ(i: number): number {
  return (cellY(i) + 0.5) * CELL;
}

export function worldToCell(x: number, z: number): number {
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(z / CELL);
  if (!inGrid(cx, cy)) return -1;
  return cy * GRID_W + cx;
}
