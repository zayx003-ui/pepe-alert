/**
 * Panneaux plein écran en cours de partie : tablette (inventaire, carte,
 * documents) et interface des terminaux.
 */
import { ENTITY_SPECS } from '../ai/specs';
import type { GameSession } from '../game/session';
import { terminalDoors } from '../interaction/actions';
import { COMFORT_WEIGHT, MAX_WEIGHT } from '../inventory/inventory';
import { itemDef, itemLabel } from '../inventory/items';
import { INJURY_NAMES } from '../player/simulation';
import { ROOM_NAMES } from '../world/dressing';
import { DOOR_OPEN } from '../world/grid';
import { DOCUMENT_BY_ID } from '../world/lore';
import { SECTORS, SECTOR_BY_ID } from '../world/sectors';
import { CELL, CellKind, DIR_DX, DIR_DY, EDGE_WALL, GRID_H, GRID_W, type FixtureDef } from '../world/types';
import { button, clear, h } from './dom';

export type TabletTab = 'inventaire' | 'carte' | 'documents';

/** Vue d'une caméra : position et orientation à donner au rendu. */
export interface CameraFeed {
  label: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export function documentView(id: string): HTMLElement {
  const doc = DOCUMENT_BY_ID[id];
  if (!doc) return h('div', { class: 'doc', text: 'Document illisible.' });
  return h('div', { class: 'doc' }, h('h4', { text: doc.title }), h('div', { class: 'src', text: `${doc.source} — ${SECTOR_BY_ID[doc.sector].name}` }), h('p', { text: doc.body }));
}

const PX = 11;

/** Dessine la carte des zones visitées. */
export function drawMap(canvas: HTMLCanvasElement, s: GameSession): void {
  const l = s.layout;
  canvas.width = GRID_W * PX;
  canvas.height = GRID_H * PX;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#050607';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const all = s.world.flag('carte_complete') > 0;
  const known = (cell: number): boolean => {
    const r = l.region[cell]!;
    return r >= 0 && (all || s.visited.has(r)) && !(l.regions[r]!.secret && !s.visited.has(r));
  };
  for (let cy = 0; cy < GRID_H; cy++) {
    for (let cx = 0; cx < GRID_W; cx++) {
      const c = cy * GRID_W + cx;
      if (l.kind[c] === CellKind.Void || !known(c)) continue;
      const def = SECTORS[l.sectorOf[c]!]!;
      const k = l.kind[c]!;
      const lum = k === CellKind.Room ? 0.3 : k === CellKind.Conduit ? 0.12 : 0.2;
      const visited = s.visited.has(l.region[c]!);
      const f = visited ? 1 : 0.5;
      ctx.fillStyle = `rgb(${Math.round((30 + def.accent[0] * 90) * lum * 2 * f)},${Math.round((30 + def.accent[1] * 90) * lum * 2 * f)},${Math.round((30 + def.accent[2] * 90) * lum * 2 * f)})`;
      ctx.fillRect(cx * PX, cy * PX, PX, PX);
      ctx.strokeStyle = 'rgba(214,211,200,0.75)';
      ctx.lineWidth = 1;
      for (let d = 0; d < 4; d++) {
        const e = l.edges[c * 4 + d]!;
        if (e === 1) continue;
        const x0 = cx * PX + (d === 1 ? PX : 0);
        const y0 = cy * PX + (d === 2 ? PX : 0);
        const x1 = cx * PX + (d === 3 ? 0 : PX);
        const y1 = cy * PX + (d === 0 ? 0 : PX);
        if (e === EDGE_WALL) {
          ctx.beginPath();
          ctx.moveTo(x0 + 0.5, y0 + 0.5);
          ctx.lineTo(x1 + 0.5, y1 + 0.5);
          ctx.stroke();
        } else {
          // Porte : trait coloré selon son état.
          const door = l.doors[e - 2]!;
          if (door.kind === 'secret' && s.world.doors[door.id]!.pos !== DOOR_OPEN) {
            ctx.beginPath();
            ctx.moveTo(x0 + 0.5, y0 + 0.5);
            ctx.lineTo(x1 + 0.5, y1 + 0.5);
            ctx.stroke();
            continue;
          }
          const rt = s.world.doors[door.id]!;
          ctx.strokeStyle = door.kind === 'arch' ? 'rgba(0,0,0,0)' : rt.locked || rt.barricade > 0 ? '#c8412f' : rt.pos === DOOR_OPEN ? '#5fae6a' : '#d9952b';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo((x0 * 3 + x1) / 4 + 0.5 * DIR_DX[d]! * 0, (y0 * 3 + y1) / 4);
          ctx.lineTo((x0 + x1 * 3) / 4, (y0 + y1 * 3) / 4 + 0.5 * DIR_DY[d]! * 0);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(214,211,200,0.75)';
          ctx.lineWidth = 1;
        }
      }
    }
  }
  // Noms des secteurs connus.
  ctx.font = 'bold 11px "Courier New", monospace';
  ctx.textAlign = 'center';
  for (const inst of l.sectors) {
    if (!all && !inst.regions.some((r) => s.visited.has(r))) continue;
    ctx.fillStyle = 'rgba(233,229,216,0.85)';
    ctx.fillText(SECTOR_BY_ID[inst.id].name.toUpperCase(), (inst.mx + 0.5) * 16 * PX, inst.my * 16 * PX + 9);
  }
  const dot = (x: number, z: number, color: string, r = 3): void => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc((x / CELL) * PX, (z / CELL) * PX, r, 0, Math.PI * 2);
    ctx.fill();
  };
  for (const m of s.world.markers) dot(m.x, m.z, '#6dff8a', 2);
  for (const c of s.world.cameras) dot(c.x, c.z, '#5d93c9', 3);
  // Coéquipiers : visibles seulement si les deux radios sont allumées.
  const radio = s.inventory.find('radio')?.on === true;
  for (const p of s.players.values()) {
    if (p.id === s.self.id || p.status !== 'playing') continue;
    if (radio && p.flags & 16) dot(p.x, p.z, '#d6d3c8', 3);
  }
  // Sortie.
  if (known(s.world.grid.cellAt(s.layout.extraction.x, s.layout.extraction.z))) {
    ctx.strokeStyle = '#5fae6a';
    ctx.lineWidth = 2;
    ctx.strokeRect((s.layout.extraction.x / CELL) * PX - 5, (s.layout.extraction.z / CELL) * PX - 5, 10, 10);
  }
  // Joueur : flèche orientée.
  const px = (s.motor.x / CELL) * PX;
  const pz = (s.motor.z / CELL) * PX;
  ctx.save();
  ctx.translate(px, pz);
  ctx.rotate(-s.motor.yaw + Math.PI);
  ctx.fillStyle = '#d9952b';
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 5);
  ctx.lineTo(0, 2);
  ctx.lineTo(-5, 5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export class Tablet {
  readonly root: HTMLElement;
  private body = h('div');
  private tabs = h('div', { class: 'tabs' });
  private tab: TabletTab = 'inventaire';
  private canvas = h('canvas');
  private revision = -1;
  private timer = 0;
  private openDoc = '';

  constructor(
    parent: HTMLElement,
    private session: GameSession,
    /** Documents déjà possédés dans le profil (lisibles aussi). */
    private knownDocs: string[],
    private callbacks: { close(): void; watch(feed: CameraFeed): void },
  ) {
    this.root = h('div', { class: 'screen overlay' }, h('div', { class: 'panel wide' }, this.tabs, this.body, h('div', { class: 'row', style: 'margin-top:16px' }, h('span', { class: 'spacer' }), button('Fermer', () => callbacks.close(), { class: 'small' }))));
    parent.append(this.root);
    requestAnimationFrame(() => this.root.classList.add('visible'));
  }

  show(tab: TabletTab): void {
    this.tab = tab;
    this.revision = -1;
    this.render();
  }

  get current(): TabletTab {
    return this.tab;
  }

  private render(): void {
    clear(this.tabs);
    for (const [id, label] of [['inventaire', 'Inventaire'], ['carte', 'Carte'], ['documents', 'Documents']] as const) {
      this.tabs.append(h('button', { class: `tab ${this.tab === id ? 'active' : ''}`, type: 'button', text: label, onclick: () => this.show(id) }));
    }
    clear(this.body);
    if (this.tab === 'inventaire') this.renderInventory();
    else if (this.tab === 'carte') this.renderMap();
    else this.renderDocuments();
  }

  private renderInventory(): void {
    const s = this.session;
    const inv = s.inventory;
    this.revision = inv.revision;
    const grid = h('div', { class: 'inv-grid' });
    inv.slots.forEach((item, i) => {
      const cell = h('div', { class: `inv-cell ${item ? '' : 'empty'} ${i === inv.selected ? 'selected' : ''}`, onclick: () => (inv.select(i), this.render()) });
      cell.append(h('span', { class: 'n', text: String(i + 1) }));
      if (item) {
        const def = itemDef(item.id);
        const charge = def.chargeLabel === 'batterie' ? `${Math.ceil(item.charge)} %` : def.chargeLabel ? `${Math.ceil(item.charge)} ${def.chargeLabel === 'usages' ? '×' : '%'}` : '';
        cell.append(h('span', { text: itemLabel(item.id, item.data) }), h('span', { class: 'n', text: `${charge}${item.on ? ' · allumé' : ''}` }));
      } else cell.append(h('span', { text: '—' }));
      grid.append(cell);
    });
    const active = inv.active;
    const weight = inv.weight();
    const detail = h('div', { class: 'col' });
    if (active) {
      const def = itemDef(active.id);
      detail.append(h('h3', { text: itemLabel(active.id, active.data) }), h('p', { class: 'small', text: def.description }), h('p', { class: 'small muted', text: `${def.weight} kg · ${def.size} emplacement${def.size > 1 ? 's' : ''} · ${def.rarity}` }));
    } else detail.append(h('p', { class: 'muted', text: 'Emplacement vide.' }));
    const sim = s.sim;
    const health = h('div', { class: 'col' }, h('h3', { text: 'État physique' }));
    const stat = (a: string, b: string): HTMLElement => h('div', { class: 'stat' }, h('span', { text: a }), h('b', { text: b }));
    health.append(stat('Santé', `${Math.round(sim.health)} / 100`), stat('Endurance', `${Math.round(sim.stamina)} / ${sim.maxStamina()}`), stat('Stress', `${Math.round(sim.stress)} %`), stat('Température', `${sim.bodyTemp.toFixed(1)} °C`), stat('Infection', `${Math.round(sim.infection)} %`));
    if (sim.injuries.length === 0) health.append(h('p', { class: 'small muted', text: 'Aucune blessure.' }));
    for (const inj of sim.injuries) health.append(stat(INJURY_NAMES[inj.type], inj.treated ? 'stabilisée' : `gravité ${Math.round(inj.severity * 100)} %`));
    this.body.append(
      h('div', { class: 'grid2' }, h('div', { class: 'col' }, grid, h('div', { class: 'stat' }, h('span', { text: 'Charge' }), h('b', { text: `${weight.toFixed(1)} / ${MAX_WEIGHT} kg${weight > COMFORT_WEIGHT ? ' — encombré' : ''}` })), h('div', { class: 'bar' }, h('i', { style: `width:${Math.min(100, (weight / MAX_WEIGHT) * 100)}%` })), detail), health),
    );
  }

  private renderMap(): void {
    const s = this.session;
    drawMap(this.canvas, s);
    const cams = h('div', { class: 'row' });
    for (const [i, c] of s.world.cameras.entries()) {
      cams.append(button(`Caméra portable ${i + 1}`, () => this.callbacks.watch({ label: `CAMÉRA PORTABLE ${i + 1}`, x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: 0.05 }), { class: 'small' }));
    }
    this.body.append(
      h('div', { class: 'map-wrap' }, this.canvas),
      h(
        'div',
        { class: 'legend' },
        h('span', {}, h('i', { style: 'background:#d9952b' }), 'Vous'),
        h('span', {}, h('i', { style: 'background:#d6d3c8' }), 'Coéquipier (radios allumées)'),
        h('span', {}, h('i', { style: 'background:#5fae6a' }), 'Porte ouverte'),
        h('span', {}, h('i', { style: 'background:#c8412f' }), 'Verrouillée'),
        h('span', {}, h('i', { style: 'background:#6dff8a' }), 'Marqueur'),
        h('span', {}, h('i', { style: 'background:#5d93c9' }), 'Caméra posée'),
      ),
    );
    if (s.world.cameras.length) this.body.append(h('h3', { text: 'Caméras portables' }), cams);
  }

  private renderDocuments(): void {
    const s = this.session;
    const ids = Array.from(new Set([...s.documents, ...(s.mission?.docs ?? [])]));
    const older = this.knownDocs.filter((d) => !ids.includes(d));
    const list = h('div', { class: 'list' });
    const add = (id: string, fresh: boolean): void => {
      const doc = DOCUMENT_BY_ID[id];
      if (!doc) return;
      list.append(h('div', { class: 'list-item clickable', onclick: () => ((this.openDoc = id), this.render()) }, h('span', { text: doc.title }), h('span', { class: 'spacer' }), h('span', { class: `badge ${fresh ? 'ok' : ''}`, text: fresh ? 'cette expédition' : SECTOR_BY_ID[doc.sector].name })));
    };
    ids.forEach((id) => add(id, true));
    older.forEach((id) => add(id, false));
    if (ids.length + older.length === 0) list.append(h('div', { class: 'list-item muted', text: 'Aucun document récupéré pour le moment.' }));
    this.body.append(h('div', { class: 'grid2' }, list, this.openDoc ? documentView(this.openDoc) : h('p', { class: 'muted', text: 'Sélectionnez un document pour le lire.' })));
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.tab === 'inventaire' && this.session.inventory.revision !== this.revision) this.render();
    else if (this.tab === 'carte' && this.timer <= 0) {
      this.timer = 0.5;
      drawMap(this.canvas, this.session);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

/* ------------------------------------------------------------------ */
/* Terminal                                                            */
/* ------------------------------------------------------------------ */

type TerminalTab = 'infos' | 'portes' | 'cameras' | 'transfert';

export class TerminalPanel {
  readonly root: HTMLElement;
  private body = h('div');
  private tabs = h('div', { class: 'tabs' });
  private tab: TerminalTab = 'infos';
  private def: FixtureDef;
  private timer = 0;

  constructor(
    parent: HTMLElement,
    private session: GameSession,
    private terminalId: string,
    private callbacks: { close(): void; watch(feed: CameraFeed): void },
  ) {
    this.def = session.world.fixtureDefs.get(terminalId)!;
    this.root = h(
      'div',
      { class: 'screen overlay' },
      h('div', { class: 'terminal' }, h('h2', { text: `Terminal — ${SECTOR_BY_ID[this.def.sector].name}` }), this.tabs, this.body, h('div', { class: 'row', style: 'margin-top:16px' }, h('span', { class: 'spacer' }), button('Déconnexion', () => callbacks.close(), { class: 'small' }))),
    );
    parent.append(this.root);
    requestAnimationFrame(() => this.root.classList.add('visible'));
    this.render();
  }

  private render(): void {
    clear(this.tabs);
    for (const [id, label] of [['infos', 'Informations'], ['portes', 'Portes'], ['cameras', 'Caméras'], ['transfert', 'Transfert']] as const) {
      this.tabs.append(h('button', { class: `tab ${this.tab === id ? 'active' : ''}`, type: 'button', text: label, onclick: () => ((this.tab = id), this.render()) }));
    }
    clear(this.body);
    const s = this.session;
    const w = s.world;
    if (!w.sectorPowered(this.def.sector)) {
      this.body.append(h('p', { text: '> ALIMENTATION PERDUE. Terminal hors service.' }));
      return;
    }
    const stat = (a: string, b: string): HTMLElement => h('div', { class: 'stat' }, h('span', { text: a }), h('b', { text: b }));
    if (this.tab === 'infos') {
      const sector = SECTOR_BY_ID[this.def.sector];
      this.body.append(h('p', { text: `> ${sector.role}` }), h('p', { text: `> AVERTISSEMENT : ${sector.hazard}` }), h('h3', { text: 'Réseau électrique' }));
      this.body.append(stat('Générateur principal', w.mainPower ? 'EN SERVICE' : 'ARRÊTÉ'), stat('Générateur secondaire', w.auxPower ? 'EN SERVICE' : 'ARRÊTÉ'));
      for (const sec of SECTORS) {
        const box = w.fixture(`fusebox.${sec.id}`);
        const state = w.sectorPowered(sec.id) ? 'alimenté' : box?.broken ? 'disjoncteur ouvert' : box && box.value < box.need ? `fusibles ${box.value}/${box.need}` : 'sans source';
        this.body.append(stat(sec.name, state));
      }
      // Capteurs de présence du secteur : ce qui bouge, sans dire quoi.
      const moving: string[] = [];
      for (const e of s.entities.values()) {
        const region = w.grid.regionAt(e.x, e.z);
        if (region < 0 || s.layout.regions[region]!.sector !== this.def.sector || e.kind === 'statique') continue;
        if (e.anim > 0) moving.push(ROOM_NAMES[s.layout.regions[region]!.type] ?? 'zone inconnue');
      }
      this.body.append(h('h3', { text: 'Capteurs de présence' }), h('p', { text: moving.length ? `> Mouvement détecté : ${Array.from(new Set(moving)).join(', ')}.` : '> Aucun mouvement détecté dans le secteur.' }));
      const seen = s.mission?.observed ?? [];
      if (seen.length) this.body.append(h('h3', { text: 'Entités identifiées' }), h('p', { text: `> ${seen.map((k) => ENTITY_SPECS[k as keyof typeof ENTITY_SPECS]?.name ?? k).join(', ')}` }));
    } else if (this.tab === 'portes') {
      const doors = terminalDoors(w, this.def);
      if (doors.length === 0) this.body.append(h('p', { text: '> Aucune porte commandée depuis ce terminal.' }));
      const list = h('div', { class: 'list' });
      for (const d of doors) {
        list.append(
          h(
            'div',
            { class: 'list-item' },
            h('span', { text: d.label }),
            h('span', { class: 'spacer' }),
            h('span', { class: `badge ${d.locked ? 'bad' : 'ok'}`, text: d.locked ? 'verrouillée' : 'libre' }),
            button(d.locked ? 'Déverrouiller' : 'Verrouiller', () => s.terminalCommand(this.terminalId, { c: 'door', door: d.id }), { class: 'small', disabled: !d.allowed, title: d.reason }),
          ),
        );
      }
      this.body.append(list);
    } else if (this.tab === 'cameras') {
      const list = h('div', { class: 'list' });
      for (const f of s.layout.fixtures) {
        if (f.type !== 'camera') continue;
        const on = w.sectorPowered(f.sector);
        const name = `Caméra — ${SECTOR_BY_ID[f.sector].name}`;
        list.append(h('div', { class: 'list-item' }, h('span', { text: name }), h('span', { class: 'spacer' }), button('Afficher', () => this.callbacks.watch({ label: name.toUpperCase(), x: f.x, y: f.y, z: f.z, yaw: f.rot, pitch: 0.5 }), { class: 'small', disabled: !on, title: on ? undefined : 'Secteur hors tension' })));
      }
      for (const [i, c] of w.cameras.entries()) {
        list.append(h('div', { class: 'list-item' }, h('span', { text: `Caméra portable ${i + 1}` }), h('span', { class: 'spacer' }), button('Afficher', () => this.callbacks.watch({ label: `CAMÉRA PORTABLE ${i + 1}`, x: c.x, y: c.y, z: c.z, yaw: c.yaw, pitch: 0.05 }), { class: 'small' })));
      }
      this.body.append(list);
    } else {
      const f = w.fixture(this.terminalId)!;
      if (f.t > 0) {
        this.body.append(h('p', { text: `> TRANSFERT EN COURS… ${Math.round((1 - f.t / Math.max(1, f.total)) * 100)} %` }), h('div', { class: 'bar' }, h('i', { style: `width:${(1 - f.t / Math.max(1, f.total)) * 100}%;background:#5fae6a` })), h('p', { class: 'small', text: 'Restez en vie. Le transfert se poursuit même si vous vous éloignez.' }));
      } else {
        this.body.append(h('p', { text: f.value > 0 ? '> Données transférées. Vous pouvez relancer un transfert.' : '> Données du secteur disponibles pour transfert.' }), button('Lancer le transfert', () => s.terminalCommand(this.terminalId, { c: 'download' })));
      }
    }
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.5;
      this.render();
    }
    // S'éloigner du terminal ferme la session.
    const dx = this.def.x - this.session.motor.x;
    const dz = this.def.z - this.session.motor.z;
    if (dx * dx + dz * dz > 9 || this.session.status !== 'playing') this.callbacks.close();
  }

  dispose(): void {
    this.root.remove();
  }
}
