/**
 * Habillage du complexe : décor narratif, machines, objets et éclairage.
 * Entièrement déterministe à partir du générateur aléatoire fourni.
 */
import type { Rng } from '../core/rng';
import { DOCUMENTS } from './lore';
import { FIXTURE_SPECS, PROPS } from './props';
import { SECTORS } from './sectors';
import {
  CELL,
  CellKind,
  DIR_DX,
  DIR_DY,
  EDGE_WALL,
  GRID_W,
  cellCenterX,
  cellCenterZ,
  worldToCell,
  type FixtureDef,
  type FixtureType,
  type Layout,
  type PropDef,
  type Region,
  type SectorId,
} from './types';

export const WALL_T = 0.2;

/** Libellés affichés sur la carte. */
export const ROOM_NAMES: Record<string, string> = {
  hall_accueil: "Hall d'accueil",
  sas_extraction: "Sas d'extraction",
  poste_securite: 'Poste de sécurité',
  vestiaire: 'Vestiaire',
  salle_attente: "Salle d'attente",
  reserve: 'Réserve',
  bureau: 'Bureau',
  bureau_direction: 'Bureau de la direction',
  salle_reunion: 'Salle de réunion',
  salle_badges: 'Salle des badges',
  salle_repos: 'Salle de repos',
  bloc_operatoire: 'Bloc opératoire',
  infirmerie: 'Infirmerie',
  pharmacie: 'Pharmacie',
  morgue: 'Morgue',
  chambre_patient: 'Chambre de patient',
  salle_generateur_aux: 'Générateur secondaire',
  atelier: 'Atelier',
  magasin: 'Magasin',
  local_technique: 'Local technique',
  salle_archives: 'Rayonnages',
  salle_lecture: 'Salle de lecture',
  chambre_forte: 'Chambre forte',
  chambre_anechoique: 'Chambre anéchoïque',
  regie_son: 'Régie son',
  labo_resonance: 'Laboratoire de résonance',
  salle_ecoute: "Salle d'écoute",
  labo_culture: 'Laboratoire de culture',
  labo_analyse: "Laboratoire d'analyse",
  salle_specimens: 'Salle des spécimens',
  sas_decontamination: 'Sas de décontamination',
  salle_serveurs: 'Salle des serveurs',
  salle_controle: 'Salle de contrôle',
  local_onduleurs: 'Local onduleurs',
  hall_generateur: 'Hall du générateur',
  salle_commande: 'Salle de commande',
  salle_transfo: 'Transformateurs',
  cellule_confinement: 'Cellule de confinement',
  salle_observation: "Salle d'observation",
  incinerateur: 'Incinérateur',
  dortoir_protocole: 'Dortoir du Protocole',
  salle_induction: "Salle d'induction",
  cryo: 'Cryogénie',
  chambre_noyau: 'Chambre du Noyau',
  antichambre: 'Antichambre',
  cache: 'Local non répertorié',
  couloir: 'Couloir',
  conduit: 'Conduit',
  ascenseur: 'Ascenseur',
};

/** Recettes de décor : « placement:type:min-max », placement w = mur, c = centre, f = sol. */
const RECIPES: Record<string, string> = {
  hall_accueil: 'c:comptoir:1-1 w:banc:2-3 w:plante:1-2 w:distributeur:1-1 w:panneau:1-2 f:papiers:1-2',
  sas_extraction: 'w:banc:1-1 w:casier_decor:1-2 w:panneau:1-1 w:caisse:0-1',
  poste_securite: 'w:console:1-1 w:ecrans:1-1 w:bureau:1-1 w:armoire:1-1 w:casier_decor:0-1',
  vestiaire: 'w:casier_decor:2-4 w:banc:1-2 w:lavabo:0-1 f:papiers:0-1',
  salle_attente: 'w:banc:2-3 w:plante:1-1 w:distributeur:0-1 w:canape:0-1 f:papiers:0-2',
  reserve: 'w:etagere:1-3 w:caisses:1-2 w:caisse:0-2 w:baril:0-1',
  bureau: 'w:bureau:1-2 w:classeur:1-2 w:etagere:0-1 w:tableau:0-1 f:papiers:0-2',
  bureau_direction: 'w:bureau:1-1 w:canape:1-1 w:etagere:1-2 w:classeur:1-1 w:plante:1-1 w:tableau:1-1',
  salle_reunion: 'c:table:1-2 w:tableau:1-1 w:ecrans:1-1 w:plante:0-1 f:papiers:1-2',
  salle_badges: 'w:bureau:1-1 w:classeur:2-3 w:armoire:1-1 w:console:0-1',
  salle_repos: 'w:canape:1-2 w:distributeur:1-1 w:lavabo:1-1 c:table:0-1',
  bloc_operatoire: 'c:table_operation:1-1 w:chariot:1-2 w:armoire:1-1 w:lavabo:1-1 w:ecrans:1-1 w:potence:1-2',
  infirmerie: 'w:lit:2-3 w:armoire:1-1 w:chariot:1-1 w:lavabo:1-1 w:rideau:1-2 w:potence:1-2',
  pharmacie: 'w:etagere:2-4 w:armoire:1-2 w:comptoir:0-1 w:caisse:0-1',
  morgue: 'w:tiroirs_morgue:2-3 c:brancard:1-1 w:lavabo:1-1 f:housse:1-2',
  chambre_patient: 'w:lit:1-1 w:chariot:0-1 w:potence:0-1 w:fauteuil_roulant:0-1 w:rideau:0-1',
  salle_generateur_aux: 'w:rack_outils:1-1 w:baril:1-2 w:tuyaux:1-2 w:caisse:0-1',
  atelier: 'w:etabli:1-2 w:rack_outils:1-2 w:caisses:0-1 w:baril:0-1 c:caisse:0-1',
  magasin: 'w:etagere:2-4 w:caisses:1-2 c:caisse:0-2 w:baril:0-2',
  local_technique: 'w:tuyaux:1-2 w:cuve:0-1 w:armoire:0-1 w:caisse:0-1',
  salle_archives: 'w:etagere_archives:3-6 c:etagere_archives:1-3 w:classeur:1-2 f:papiers:1-3',
  salle_lecture: 'c:table:1-2 w:etagere_archives:1-2 w:classeur:1-1 w:bureau:0-1 f:papiers:1-2',
  chambre_forte: 'w:armoire:2-3 w:classeur:2-3 w:caisse:0-1',
  chambre_anechoique: 'w:mousse:4-10 c:micro:1-2',
  regie_son: 'w:console:1-2 w:ecrans:1-1 w:enceinte:1-2 w:etagere:0-1',
  labo_resonance: 'w:enceinte:2-3 c:micro:1-1 w:console:1-1 w:mousse:1-3',
  salle_ecoute: 'w:bureau:1-2 w:enceinte:1-1 w:mousse:1-2 w:etagere:0-1',
  labo_culture: 'w:paillasse:2-3 w:tube_specimen:1-2 w:armoire:1-1 w:lavabo:1-1 f:flaque:0-1',
  labo_analyse: 'w:paillasse:1-2 w:console:1-1 w:ecrans:0-1 w:armoire:1-1 w:chariot:0-1',
  salle_specimens: 'w:tube_specimen:2-4 w:tube_brise:1-1 c:tube_specimen:0-1 f:flaque:1-2',
  sas_decontamination: 'w:lavabo:1-2 w:armoire:1-1 w:banc:0-1 w:tuyaux:1-1',
  salle_serveurs: 'c:baie_serveur:1-3 w:baie_serveur:2-5 w:tuyaux:0-1',
  salle_controle: 'w:console:2-3 w:ecrans:1-2 w:bureau:0-1 w:armoire:0-1',
  local_onduleurs: 'w:transfo:1-2 w:armoire:1-2 w:tuyaux:1-1',
  hall_generateur: 'w:tuyaux:2-4 w:cuve:1-2 w:transfo:1-2 w:baril:1-2 w:rack_outils:1-1',
  salle_commande: 'w:console:2-3 w:ecrans:1-2 w:armoire:1-1',
  salle_transfo: 'w:transfo:2-3 w:tuyaux:1-2 w:armoire:0-1',
  cellule_confinement: 'w:lit:1-1 w:lavabo:0-1 f:souche:0-2 f:sang:0-1',
  salle_observation: 'w:console:1-2 w:ecrans:1-2 w:bureau:1-1 w:classeur:0-1',
  incinerateur: 'w:baril:1-2 w:chariot:1-1 f:housse:1-3 w:tuyaux:1-1',
  dortoir_protocole: 'w:lit_protocole:2-5 w:ecrans:1-1 w:potence:1-2 w:chariot:0-1',
  salle_induction: 'w:console:1-1 w:lit_protocole:1-2 w:enceinte:1-2 w:ecrans:1-1',
  cryo: 'w:capsule_cryo:2-5 w:tuyaux:1-2 w:cuve:0-1 f:flaque:0-1',
  chambre_noyau: 'w:tuyaux:2-4 w:enceinte:2-4 w:cuve:1-2',
  antichambre: 'w:banc:1-1 w:casier_decor:1-1 w:panneau:1-1 w:caisse:0-1',
  cache: 'w:etagere:1-1 w:caisse:1-2 w:bureau:0-1 f:papiers:1-1',
};

interface RecipeEntry {
  place: 'w' | 'c' | 'f';
  type: string;
  min: number;
  max: number;
}

const PARSED: Record<string, RecipeEntry[]> = {};
for (const [room, text] of Object.entries(RECIPES)) {
  PARSED[room] = text.split(' ').map((tok) => {
    const [place, type, range] = tok.split(':') as [RecipeEntry['place'], string, string];
    const [min, max] = range.split('-').map(Number) as [number, number];
    if (!PROPS[type]) throw new Error(`Recette ${room} : décor inconnu ${type}`);
    return { place, type, min, max };
  });
}

/** Salle préférée pour le terminal de chaque secteur. */
const TERMINAL_ROOM: Record<SectorId, string[]> = {
  accueil: ['poste_securite'],
  administration: ['bureau_direction', 'salle_badges'],
  medical: ['infirmerie', 'bloc_operatoire'],
  maintenance: ['atelier', 'local_technique'],
  archives: ['salle_lecture', 'salle_archives'],
  acoustique: ['regie_son', 'salle_ecoute'],
  bio: ['labo_analyse', 'labo_culture'],
  serveurs: ['salle_controle', 'salle_serveurs'],
  centrale: ['salle_commande'],
  quarantaine: ['salle_observation'],
  experimental: ['salle_observation', 'salle_induction'],
  noyau: ['salle_controle', 'antichambre'],
};

const SPECIAL_FIXTURES: { type: FixtureType; sector: SectorId; rooms: string[]; center?: boolean; count?: number }[] = [
  { type: 'airlock', sector: 'accueil', rooms: ['sas_extraction'] },
  { type: 'antenna', sector: 'accueil', rooms: ['poste_securite'] },
  { type: 'medstation', sector: 'medical', rooms: ['infirmerie', 'pharmacie'] },
  { type: 'generator_aux', sector: 'maintenance', rooms: ['salle_generateur_aux'], center: true },
  { type: 'valve', sector: 'maintenance', rooms: ['local_technique', 'salle_generateur_aux'] },
  { type: 'emitter', sector: 'acoustique', rooms: ['chambre_anechoique', 'labo_resonance'], center: true },
  { type: 'sampler', sector: 'bio', rooms: ['labo_culture', 'labo_analyse'] },
  { type: 'coolant', sector: 'serveurs', rooms: ['local_onduleurs', 'salle_serveurs'] },
  { type: 'generator_main', sector: 'centrale', rooms: ['hall_generateur'], center: true },
  { type: 'valve', sector: 'centrale', rooms: ['salle_transfo', 'local_technique', 'hall_generateur'], count: 2 },
  { type: 'purge', sector: 'quarantaine', rooms: ['salle_observation'] },
  { type: 'incinerator', sector: 'quarantaine', rooms: ['incinerateur'] },
  { type: 'probe', sector: 'experimental', rooms: ['salle_induction', 'dortoir_protocole'] },
  { type: 'cryo', sector: 'experimental', rooms: ['cryo'] },
  { type: 'core_console', sector: 'noyau', rooms: ['chambre_noyau'] },
];

interface Slot {
  cell: number;
  dir: number;
}

interface Surface {
  x: number;
  y: number;
  z: number;
  region: number;
  used: boolean;
}

class Dresser {
  private used = new Set<number>();
  private wallSlots = new Map<number, Slot[]>();
  private centerCells = new Map<number, number[]>();
  private freeCells = new Map<number, number[]>();
  private surfaces: Surface[] = [];
  private itemUid = 1;

  constructor(
    private layout: Layout,
    private rng: Rng,
  ) {}

  run(): void {
    this.computeSlots();
    this.placeFixtures();
    this.placeNoyau();
    this.placeProps();
    this.placeStories();
    this.placeLights();
    this.placeItems();
    this.placeSpawn();
  }

  /* ---------------- emplacements ---------------- */

  private hasDoor(cell: number): boolean {
    const e = this.layout.edges;
    for (let d = 0; d < 4; d++) if (e[cell * 4 + d]! > 1) return true;
    return false;
  }

  private computeSlots(): void {
    const { layout, rng } = this;
    for (const r of layout.regions) {
      const walls: Slot[] = [];
      const centers: number[] = [];
      const free: number[] = [];
      for (const cell of r.cells) {
        const k = layout.kind[cell]!;
        if (k !== CellKind.Room && k !== CellKind.Corridor) continue;
        if (this.hasDoor(cell)) continue;
        free.push(cell);
        const wallDirs: number[] = [];
        for (let d = 0; d < 4; d++) if (layout.edges[cell * 4 + d] === EDGE_WALL) wallDirs.push(d);
        if (wallDirs.length > 0) {
          // Dans un couloir, on ne meuble qu'une cellule sur deux pour garder le passage.
          const cx = cell % GRID_W;
          const cy = (cell / GRID_W) | 0;
          if (r.kind === 'room' || (cx + cy) % 2 === 0) walls.push({ cell, dir: rng.pick(wallDirs) });
        } else if (r.kind === 'room') {
          const cx = cell % GRID_W;
          const cy = (cell / GRID_W) | 0;
          if ((cx + cy) % 2 === 0) centers.push(cell);
        }
      }
      rng.shuffle(walls);
      rng.shuffle(centers);
      this.wallSlots.set(r.id, walls);
      this.centerCells.set(r.id, centers);
      this.freeCells.set(r.id, free);
    }
  }

  private takeWall(region: number): Slot | null {
    const list = this.wallSlots.get(region)!;
    while (list.length) {
      const s = list.pop()!;
      if (!this.used.has(s.cell)) {
        this.used.add(s.cell);
        return s;
      }
    }
    return null;
  }

  private takeCenter(region: number): number | null {
    const list = this.centerCells.get(region)!;
    while (list.length) {
      const c = list.pop()!;
      if (!this.used.has(c)) {
        this.used.add(c);
        return c;
      }
    }
    return null;
  }

  private wallPose(slot: Slot, depth: number): { x: number; z: number; rot: number } {
    const off = CELL / 2 - WALL_T / 2 - depth / 2 - 0.02;
    const dx = DIR_DX[slot.dir]!;
    const dz = DIR_DY[slot.dir]!;
    return {
      x: cellCenterX(slot.cell) + dx * off,
      z: cellCenterZ(slot.cell) + dz * off,
      rot: Math.atan2(-dx, -dz),
    };
  }

  private markBlocked(x: number, z: number, w: number, d: number, rot: number): void {
    const swap = Math.abs(Math.sin(rot)) > 0.7;
    const hw = (swap ? d : w) / 2 + 0.25;
    const hd = (swap ? w : d) / 2 + 0.25;
    for (let zz = z - hd; zz <= z + hd + 0.001; zz += Math.min(CELL, hd * 2)) {
      for (let xx = x - hw; xx <= x + hw + 0.001; xx += Math.min(CELL, hw * 2)) {
        const c = worldToCell(xx, zz);
        if (c >= 0) this.layout.blocked[c] = 1;
      }
    }
  }

  private addProp(type: string, region: number, x: number, y: number, z: number, rot: number): PropDef {
    const spec = PROPS[type]!;
    const p: PropDef = { type, x, y, z, rot, region, variant: this.rng.int(0, 999) };
    this.layout.props.push(p);
    if (spec.surface !== undefined) this.surfaces.push({ x, y: y + spec.surface, z, region, used: false });
    return p;
  }

  private placeWallProp(r: Region, type: string): PropDef | null {
    const slot = this.takeWall(r.id);
    if (!slot) return null;
    const spec = PROPS[type]!;
    const pose = this.wallPose(slot, spec.d);
    const y = this.layout.floorY[slot.cell]!;
    const prop = this.addProp(type, r.id, pose.x, y, pose.z, pose.rot);
    if (type === 'bureau' && this.rng.chance(0.85)) {
      // Chaise devant le bureau, parfois renversée.
      const fx = -DIR_DX[slot.dir]! * 0.7;
      const fz = -DIR_DY[slot.dir]! * 0.7;
      const fallen = r.story === 'lutte' || this.rng.chance(0.15);
      this.addProp(fallen ? 'chaise_tombee' : 'chaise', r.id, pose.x + fx, y, pose.z + fz, pose.rot + Math.PI + this.rng.range(-0.5, 0.5));
    }
    return prop;
  }

  private placeCenterProp(r: Region, type: string): PropDef | null {
    const cell = this.takeCenter(r.id);
    if (cell === null) return null;
    const spec = PROPS[type]!;
    const rot = this.rng.chance(0.5) ? 0 : Math.PI / 2;
    const x = cellCenterX(cell);
    const z = cellCenterZ(cell);
    if (spec.solid) this.layout.blocked[cell] = 1;
    return this.addProp(type, r.id, x, this.layout.floorY[cell]!, z, rot);
  }

  private placeFloorProp(r: Region, type: string): PropDef | null {
    const cells = this.freeCells.get(r.id)!;
    if (cells.length === 0) return null;
    const cell = this.rng.pick(cells);
    return this.addProp(
      type,
      r.id,
      cellCenterX(cell) + this.rng.range(-0.4, 0.4),
      this.layout.floorY[cell]! + 0.012,
      cellCenterZ(cell) + this.rng.range(-0.4, 0.4),
      this.rng.range(0, Math.PI * 2),
    );
  }

  /* ---------------- machines ---------------- */

  private roomsOf(sector: SectorId, types: string[]): Region[] {
    const all = this.layout.regions.filter((r) => r.sector === sector && r.kind === 'room' && !r.secret);
    const out: Region[] = [];
    for (const t of types) for (const r of all) if (r.type === t && !out.includes(r)) out.push(r);
    // Repli : n'importe quelle salle du secteur, de la plus grande à la plus petite.
    for (const r of all.slice().sort((a, b) => b.cells.length - a.cells.length)) if (!out.includes(r)) out.push(r);
    return out;
  }

  private addFixture(type: FixtureType, sector: SectorId, rooms: Region[], center: boolean, index: number): FixtureDef | null {
    const spec = FIXTURE_SPECS[type]!;
    for (const r of rooms) {
      let pose: { x: number; z: number; rot: number } | null = null;
      let cell = -1;
      if (center) {
        // Centre géométrique de la salle si elle est assez grande, sinon cellule centrale libre.
        if (r.w >= 4 && r.h >= 4) {
          const x = (r.x + r.w / 2) * CELL;
          const z = (r.y + r.h / 2) * CELL;
          cell = worldToCell(x - 0.01, z - 0.01);
          pose = { x, z, rot: r.w >= r.h ? 0 : Math.PI / 2 };
          this.markBlocked(x, z, spec.w, spec.d, pose.rot);
          for (const c of r.cells) if (this.layout.blocked[c]) this.used.add(c);
        } else {
          const c = this.takeCenter(r.id);
          if (c !== null) {
            cell = c;
            pose = { x: cellCenterX(c), z: cellCenterZ(c), rot: 0 };
            this.layout.blocked[c] = 1;
          }
        }
      }
      if (!pose) {
        const slot = this.takeWall(r.id);
        if (!slot) continue;
        cell = slot.cell;
        pose = this.wallPose(slot, spec.d);
      }
      const id = index > 0 ? `${type}.${sector}.${index}` : `${type}.${sector}`;
      const f: FixtureDef = { id, type, sector, region: r.id, x: pose.x, y: this.layout.floorY[cell]!, z: pose.z, rot: pose.rot };
      this.layout.fixtures.push(f);
      return f;
    }
    return null;
  }

  private placeFixtures(): void {
    const { layout, rng } = this;
    for (const sf of SPECIAL_FIXTURES) {
      for (let i = 0; i < (sf.count ?? 1); i++) {
        this.addFixture(sf.type, sf.sector, this.roomsOf(sf.sector, sf.rooms), sf.center === true, i);
      }
    }
    for (const def of SECTORS) {
      const sector = def.id;
      const corridors = layout.regions
        .filter((r) => r.sector === sector && r.kind === 'corridor')
        .sort((a, b) => b.cells.length - a.cells.length);
      const anyRoom = this.roomsOf(sector, []);
      this.addFixture('fusebox', sector, [...corridors, ...anyRoom], false, 0);
      this.addFixture('terminal', sector, this.roomsOf(sector, TERMINAL_ROOM[sector]), false, 0);
      const lockerRooms = rng.shuffle(this.roomsOf(sector, sector === 'accueil' ? ['vestiaire'] : []).slice(0, 6));
      const lockers = sector === 'accueil' ? 2 : rng.int(1, 2);
      for (let i = 0; i < lockers; i++) {
        if (lockerRooms.length === 0) break;
        const room = sector === 'accueil' ? this.roomsOf(sector, ['vestiaire']) : [lockerRooms[i % lockerRooms.length]!, ...lockerRooms];
        this.addFixture('locker', sector, room, false, i);
      }
      // Caméra de surveillance : fixée en hauteur, n'occupe pas d'emplacement au sol.
      const camRoom = this.roomsOf(sector, def.hub ? [def.hub.type] : [])[0];
      if (camRoom) {
        const cell = camRoom.cells.find((c) => {
          for (let d = 0; d < 4; d++) if (layout.edges[c * 4 + d] === EDGE_WALL) return true;
          return false;
        });
        if (cell !== undefined) {
          let dir = 0;
          for (let d = 0; d < 4; d++) if (layout.edges[cell * 4 + d] === EDGE_WALL) dir = d;
          const pose = this.wallPose({ cell, dir }, 0.3);
          layout.fixtures.push({
            id: `camera.${sector}`,
            type: 'camera',
            sector,
            region: camRoom.id,
            x: pose.x,
            y: layout.floorY[cell]! + Math.min(layout.ceilH[cell]!, 3.2) - 0.45,
            z: pose.z,
            rot: pose.rot,
          });
        }
      }
    }
  }

  private placeNoyau(): void {
    const hub = this.layout.regions.find((r) => r.type === 'chambre_noyau');
    if (!hub) return;
    const x = (hub.x + hub.w / 2) * CELL;
    const z = (hub.y + hub.h / 2) * CELL;
    this.addProp('noyau_coeur', hub.id, x, hub.floorY, z, 0);
    this.markBlocked(x, z, 2.4, 2.4, 0);
    for (const c of hub.cells) if (this.layout.blocked[c]) this.used.add(c);
  }

  /* ---------------- décor ---------------- */

  private placeProps(): void {
    const { layout, rng } = this;
    for (const r of layout.regions) {
      if (r.kind === 'room') {
        this.assignStory(r);
        const recipe = PARSED[r.type] ?? PARSED['reserve']!;
        for (const e of recipe) {
          const n = rng.int(e.min, e.max);
          for (let i = 0; i < n; i++) {
            if (e.place === 'w') this.placeWallProp(r, e.type);
            else if (e.place === 'c') this.placeCenterProp(r, e.type);
            else this.placeFloorProp(r, e.type);
          }
        }
      } else if (r.kind === 'corridor') {
        const slots = this.wallSlots.get(r.id)!;
        const n = Math.floor(slots.length * 0.3);
        for (let i = 0; i < n; i++) {
          const roll = rng.next();
          this.placeWallProp(r, roll < 0.55 ? 'tuyaux' : roll < 0.75 ? 'caisse' : roll < 0.9 ? 'baril' : 'panneau');
        }
        if (rng.chance(0.35)) this.placeFloorProp(r, rng.chance(0.5) ? 'papiers' : 'flaque');
      }
    }
  }

  private assignStory(r: Region): void {
    const { rng, layout } = this;
    if (r.secret || r.type === 'sas_extraction' || r.type.startsWith('hall') || r.type === 'chambre_noyau') return;
    const roll = rng.next();
    const organic = r.sector === 'quarantaine' || r.sector === 'bio';
    if (roll < 0.3) {
      if (organic) r.story = 'souche';
    } else if (roll < 0.42) r.story = 'lutte';
    else if (roll < 0.54) r.story = 'abandon';
    else if (roll < 0.62) r.story = 'panne';
    else if (roll < 0.7) {
      // Salle barricadée de l'intérieur : exige une porte simple non verrouillée.
      const doors = r.doors.map((id) => layout.doors[id]!).filter((d) => d.kind === 'door' && !d.lock);
      if (doors.length === 1 && r.doors.length <= 2 && r.type !== 'salle_generateur_aux') {
        r.story = 'barricade';
        doors[0]!.barricaded = true;
        doors[0]!.lock = { type: 'latch', side: r.id };
      }
    }
  }

  private placeStories(): void {
    const { layout, rng } = this;
    for (const r of layout.regions) {
      if (!r.story) continue;
      switch (r.story) {
        case 'lutte':
          this.placeFloorProp(r, 'sang');
          this.placeFloorProp(r, 'trainee');
          this.placeFloorProp(r, 'chaise_tombee');
          this.placeFloorProp(r, 'papiers');
          if (rng.chance(0.5)) this.placeFloorProp(r, 'debris');
          break;
        case 'abandon':
          this.placeFloorProp(r, 'papiers');
          this.placeFloorProp(r, 'papiers');
          this.placeFloorProp(r, 'debris');
          this.placeWallProp(r, 'armoire_ouverte');
          break;
        case 'panne':
          this.placeFloorProp(r, 'flaque');
          this.placeFloorProp(r, 'debris');
          break;
        case 'souche':
          for (let i = rng.int(2, 4); i > 0; i--) this.placeFloorProp(r, 'souche');
          this.placeFloorProp(r, 'flaque');
          break;
        case 'barricade':
          this.placeFloorProp(r, 'housse');
          this.placeFloorProp(r, 'sang');
          this.placeFloorProp(r, 'papiers');
          break;
      }
    }
  }

  /* ---------------- éclairage ---------------- */

  private addLight(x: number, z: number, cell: number, r: Region): void {
    const { layout, rng } = this;
    const harsh = r.sector === 'experimental' || r.sector === 'quarantaine' || r.sector === 'noyau';
    let mode: 0 | 1 | 2 = 0;
    const roll = rng.next();
    if (r.story === 'panne' || roll < (harsh ? 0.25 : 0.1)) mode = 2;
    else if (r.story === 'lutte' || roll < (harsh ? 0.5 : 0.24)) mode = 1;
    layout.lights.push({
      id: layout.lights.length,
      x,
      y: layout.floorY[cell]! + layout.ceilH[cell]! - 0.12,
      z,
      region: r.id,
      sector: r.sector,
      mode,
    });
  }

  private placeLights(): void {
    const { layout } = this;
    for (const r of layout.regions) {
      if (r.kind === 'room') {
        const cx = (r.x + r.w / 2) * CELL;
        const cz = (r.y + r.h / 2) * CELL;
        const cell = worldToCell(cx - 0.01, cz - 0.01);
        if (r.w * r.h >= 20) {
          const horizontal = r.w >= r.h;
          const ox = horizontal ? (r.w * CELL) / 4 : 0;
          const oz = horizontal ? 0 : (r.h * CELL) / 4;
          this.addLight(cx - ox, cz - oz, cell, r);
          this.addLight(cx + ox, cz + oz, cell, r);
        } else {
          this.addLight(cx, cz, cell, r);
        }
      } else if (r.kind === 'corridor') {
        for (const c of r.cells) {
          const x = c % GRID_W;
          const y = (c / GRID_W) | 0;
          if ((x + y * 2) % 4 === 0) this.addLight(cellCenterX(c), cellCenterZ(c), c, r);
        }
      }
    }
  }

  /* ---------------- objets ---------------- */

  private placeItemIn(item: string, r: Region, data?: string): boolean {
    const { layout, rng } = this;
    const surfaces = this.surfaces.filter((s) => s.region === r.id && !s.used);
    if (surfaces.length > 0 && rng.chance(0.8)) {
      const s = rng.pick(surfaces);
      s.used = true;
      layout.items.push({ uid: this.itemUid++, item, x: s.x + rng.range(-0.25, 0.25), y: s.y, z: s.z, region: r.id, data });
      return true;
    }
    const cells = this.freeCells.get(r.id)!.filter((c) => !layout.blocked[c]);
    const pool = cells.filter((c) => !this.used.has(c));
    const list = pool.length > 0 ? pool : cells.length > 0 ? cells : r.cells;
    const cell = rng.pick(list);
    layout.items.push({
      uid: this.itemUid++,
      item,
      x: cellCenterX(cell) + rng.range(-0.3, 0.3),
      y: layout.floorY[cell]! + 0.02,
      z: cellCenterZ(cell) + rng.range(-0.3, 0.3),
      region: r.id,
      data,
    });
    return true;
  }

  /** Place un objet dans l'un des secteurs donnés, de préférence dans les salles listées. */
  private placeItem(item: string, sectors: SectorId[], rooms: string[] = [], data?: string, allowSecret = false): void {
    const { layout, rng } = this;
    const sector = rng.pick(sectors);
    let pool = layout.regions.filter((r) => r.sector === sector && r.kind === 'room' && (allowSecret || !r.secret) && r.story !== 'barricade');
    const preferred = pool.filter((r) => rooms.includes(r.type));
    if (preferred.length > 0) pool = preferred;
    if (pool.length === 0) pool = layout.regions.filter((r) => r.sector === sector && r.kind !== 'conduit' && r.kind !== 'elevator');
    this.placeItemIn(item, rng.pick(pool), data);
  }

  private placeItems(): void {
    const { layout, rng } = this;
    const t = (tier: number): SectorId[] => SECTORS.filter((s) => s.tier === tier).map((s) => s.id);
    const distinct = (list: SectorId[], n: number): SectorId[] => rng.shuffle(list.slice()).slice(0, n);

    // Cartes d'accès : toujours dans un palier inférieur à celui qu'elles ouvrent.
    this.placeItem('carte', ['administration'], ['salle_badges', 'bureau_direction'], '1');
    this.placeItem('carte', ['accueil'], ['poste_securite', 'vestiaire'], '1');
    for (const s of distinct(t(1), 2)) this.placeItem('carte', [s], [], '2');
    for (const s of distinct(t(2), 2)) this.placeItem('carte', [s], [], '3');

    const table: [string, SectorId[], string[], number][] = [
      ['fusible', ['maintenance'], ['magasin', 'atelier'], 2],
      ['fusible', ['centrale'], [], 1],
      ['fusible', ['medical'], [], 1],
      ['fusible', ['administration'], [], 1],
      ['fusible', ['archives'], [], 1],
      ['fusible', ['accueil'], ['reserve', 'poste_securite'], 1],
      ['fusible', ['serveurs', 'acoustique', 'bio'], [], 2],
      ['outils', ['maintenance'], ['atelier'], 1],
      ['outils', ['accueil'], ['reserve', 'vestiaire'], 1],
      ['outils', ['centrale'], [], 1],
      ['medkit', ['medical'], ['pharmacie', 'infirmerie'], 2],
      ['medkit', ['accueil', 'administration'], [], 1],
      ['medkit', ['quarantaine', 'experimental'], [], 2],
      ['serum', ['bio'], ['labo_analyse', 'sas_decontamination'], 1],
      ['serum', ['medical'], ['pharmacie'], 1],
      ['serum', ['quarantaine'], [], 1],
      ['marqueurs', ['accueil'], [], 1],
      ['marqueurs', ['maintenance', 'archives'], [], 2],
      ['detecteur_mouvement', ['accueil'], ['poste_securite'], 1],
      ['detecteur_mouvement', ['serveurs', 'centrale'], [], 1],
      ['detecteur_sonore', ['acoustique'], ['regie_son', 'salle_ecoute'], 1],
      ['detecteur_sonore', ['administration', 'accueil'], [], 1],
      ['camera', ['accueil'], ['poste_securite'], 1],
      ['camera', ['serveurs'], ['salle_controle'], 1],
      ['mesureur', ['bio'], [], 1],
      ['mesureur', ['medical', 'accueil'], [], 1],
      ['radio', ['accueil'], ['poste_securite', 'vestiaire'], 1],
      ['lampe', ['accueil'], ['vestiaire', 'reserve'], 1],
      ['echantillon', ['bio'], ['labo_culture', 'salle_specimens', 'labo_analyse'], 3],
      ['disque', ['serveurs'], ['salle_serveurs', 'salle_controle'], 2],
      ['disque', ['administration'], ['bureau_direction'], 1],
      ['bande', ['acoustique'], ['regie_son', 'chambre_anechoique', 'labo_resonance'], 3],
      ['cellule', ['centrale'], ['salle_transfo', 'local_technique'], 1],
      ['cellule', ['maintenance'], ['magasin', 'local_technique'], 1],
    ];
    for (const [item, sectors, rooms, count] of table) {
      for (let i = 0; i < count; i++) this.placeItem(item, sectors, rooms);
    }
    this.placeItem('dossier', ['archives'], ['chambre_forte'], 'protocole');
    this.placeItem('dossier', ['experimental'], ['dortoir_protocole', 'salle_observation'], 'sujets');
    for (const def of SECTORS) {
      const n = def.tier === 0 ? 2 : rng.int(1, 2);
      for (let i = 0; i < n; i++) this.placeItem('piles', [def.id]);
    }
    for (const doc of DOCUMENTS) this.placeItem('document', [doc.sector], [], doc.id);
    // Les salles cachées et barricadées récompensent la curiosité.
    for (const r of layout.regions) {
      if (r.secret) {
        this.placeItemIn(rng.pick(['medkit', 'piles', 'serum', 'marqueurs']), r);
        this.placeItemIn('piles', r);
      } else if (r.story === 'barricade') {
        this.placeItemIn(rng.pick(['medkit', 'piles', 'outils']), r);
      }
    }
  }

  private placeSpawn(): void {
    const { layout } = this;
    const hall = layout.regions.find((r) => r.type === 'hall_accueil')!;
    const free = this.freeCells.get(hall.id)!.filter((c) => !layout.blocked[c] && !this.used.has(c));
    const cell = free.length > 0 ? free[(free.length / 2) | 0]! : hall.cells[0]!;
    layout.spawn = { x: cellCenterX(cell), y: layout.floorY[cell]!, z: cellCenterZ(cell), region: hall.id };
    const sas = layout.regions.find((r) => r.type === 'sas_extraction');
    if (!sas) throw new Error("Sas d'extraction manquant");
    layout.extraction = { region: sas.id, x: (sas.x + sas.w / 2) * CELL, z: (sas.y + sas.h / 2) * CELL };
  }
}

export function dressLayout(layout: Layout, rng: Rng): void {
  new Dresser(layout, rng).run();
}
