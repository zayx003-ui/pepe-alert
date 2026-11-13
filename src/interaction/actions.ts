/**
 * InteractionSystem — règles d'interaction, communes au client et à l'hôte.
 *
 * `listActions` décrit ce qu'un acteur peut faire sur une cible (libellé, durée,
 * bruit, conditions). Le client s'en sert pour l'affichage ; l'hôte rappelle la
 * même fonction avant d'exécuter (`performAction`) : une action refusée ici ne
 * peut pas être imposée par un client.
 */
import { itemDef, itemLabel } from '../inventory/items';
import { DOOR_AJAR, DOOR_CLOSED, DOOR_OPEN } from '../world/grid';
import { PROCESS_TIME, type WorldItem, type WorldState } from '../world/state';
import { SECTOR_BY_ID } from '../world/sectors';
import { CELL, GRID_W, type DoorDef, type FixtureDef } from '../world/types';

export type TargetRef = { t: 'door'; id: number } | { t: 'fx'; id: string } | { t: 'item'; uid: number };

/** Ce que l'hôte sait (ou accepte de croire) de l'acteur au moment de l'action. */
export interface ActorCtx {
  id: string;
  x: number;
  z: number;
  region: number;
  cardLevel: number;
  /** Identifiants des objets transportés. */
  items: string[];
  /** Identifiant du casier où l'acteur est caché, ou ''. */
  hiddenIn: string;
}

export interface ActionDef {
  id: string;
  label: string;
  /** Durée de maintien en secondes (0 = instantané). */
  duration: number;
  /** Portée du bruit produit, en mètres. */
  noise: number;
  enabled: boolean;
  /** Raison affichée lorsque l'action est indisponible. */
  reason?: string;
  /** Objet consommé par l'action. */
  consumes?: string;
  /** Usure infligée aux outils. */
  wear?: number;
}

export interface ActionResult {
  ok: boolean;
  reason?: string;
  /** Objets remis à l'acteur. */
  give?: { item: string; charge: number; data?: string }[];
  /** Objets retirés à l'acteur. */
  take?: string[];
  wear?: number;
  /** Effet local à appliquer chez l'acteur. */
  effect?: 'heal' | 'hide' | 'unhide' | 'terminal' | 'document';
  /** Paramètre de l'effet (identifiant de casier, de terminal, de document). */
  effectData?: string;
  noise: number;
}

/** Distance maximale d'interaction acceptée par l'hôte (portée + tolérance réseau). */
export const INTERACT_RANGE = 2.6;

const act = (id: string, label: string, duration = 0, noise = 0, extra: Partial<ActionDef> = {}): ActionDef => ({
  id,
  label,
  duration,
  noise,
  enabled: true,
  ...extra,
});

const off = (id: string, label: string, reason: string): ActionDef => ({ id, label, duration: 0, noise: 0, enabled: false, reason });

/* ------------------------------------------------------------------ */
/* Portes                                                              */
/* ------------------------------------------------------------------ */

function doorActions(state: WorldState, def: DoorDef, actor: ActorCtx): ActionDef[] {
  const d = state.doors[def.id]!;
  const hasTools = actor.items.includes('outils');
  switch (def.kind) {
    case 'arch':
      return [];
    case 'vent':
      return d.pos === DOOR_OPEN ? [act('close', 'Refermer la grille', 0.8, 5)] : [act('open', 'Ouvrir la grille', 1.2, 9)];
    case 'secret':
      return d.pos === DOOR_OPEN ? [act('close', 'Refermer le panneau', 0.6, 4)] : [act('open', 'Pousser le panneau', 1.0, 5)];
    case 'elevator': {
      const lift = state.layout.elevator!;
      const here = def.id === lift.doorTop ? 0 : 1;
      const powered = state.sectorPowered('noyau') && state.mainPower;
      const moving = state.elevator.y !== (state.elevator.target === 0 ? lift.topY : lift.bottomY);
      if (moving) return [off('lift', 'Ascenseur', 'Cabine en mouvement')];
      const inCab = actor.region === state.layout.region[lift.cell];
      if (!powered) return [off('lift', inCab ? 'Ascenseur' : "Appeler l'ascenseur", 'Hors tension — générateur principal requis')];
      if (inCab) return [act('lift', state.elevator.target === 0 ? 'Descendre au Noyau' : 'Monter', 1, 10)];
      if (state.elevator.target === here) return [];
      return [act('lift', "Appeler l'ascenseur", 1, 10)];
    }
    default:
      break;
  }
  const out: ActionDef[] = [];
  if (d.barricade > 0) {
    if (actor.region === d.barricadeSide) out.push(act('unbarricade', 'Retirer la barricade', 3, 8));
    else if (def.kind === 'door') out.push(act('force', 'Forcer la porte', hasTools ? 5 : 9, 22, { wear: hasTools ? 15 : 0 }));
    else out.push(off('force', 'Porte bloquée', "Barricadée de l'autre côté"));
    return out;
  }
  if (d.locked) {
    const lock = def.lock;
    if (!lock) out.push(act('unlock', 'Déverrouiller', 0.5, 3));
    else if (lock.type === 'card') {
      if (actor.cardLevel >= lock.level) out.push(act('unlock', `Passer la carte (niveau ${lock.level})`, 0.6, 6));
      else out.push(off('unlock', 'Sas verrouillé', `Carte d'accès niveau ${lock.level} requise`));
    } else if (lock.type === 'latch') {
      if (actor.region === lock.side) out.push(act('unlock', 'Déverrouiller', 0.8, 5));
      else if (def.kind === 'door') out.push(act('force', 'Forcer la porte', hasTools ? 5 : 9, 22, { wear: hasTools ? 15 : 0 }));
      else out.push(off('unlock', 'Sas verrouillé', "Verrouillé depuis l'autre côté"));
    } else out.push(off('unlock', 'Verrouillé', 'Hors tension'));
    return out;
  }
  if (d.pos === DOOR_CLOSED) {
    out.push(act('open', 'Ouvrir', 0, def.kind === 'gate' ? 9 : 5));
    if (def.kind === 'door') out.push(act('ajar', 'Entrebâiller', 0, 2));
    if (def.kind === 'door' || def.lock?.type !== 'card') out.push(act('lock', 'Verrouiller', 0.5, 3));
    else if (actor.cardLevel >= def.lock.level) out.push(act('lock', 'Verrouiller (carte)', 0.6, 6));
    if (def.kind === 'door') out.push(act('barricade', hasTools ? 'Barricader (outils)' : 'Barricader', 4, 10, { wear: hasTools ? 10 : 0 }));
  } else if (d.pos === DOOR_AJAR) {
    out.push(act('open', 'Ouvrir', 0, 5));
    out.push(act('close', 'Fermer', 0, 3));
  } else {
    out.push(act('close', 'Fermer', 0, def.kind === 'gate' ? 9 : 4));
    if (def.kind === 'door') out.push(act('ajar', 'Entrebâiller', 0, 2));
  }
  return out;
}

function performDoor(state: WorldState, def: DoorDef, action: ActionDef, actor: ActorCtx): ActionResult {
  const d = state.doors[def.id]!;
  const res: ActionResult = { ok: true, noise: action.noise, wear: action.wear };
  switch (action.id) {
    case 'open':
      state.setDoor(def.id, { pos: DOOR_OPEN });
      break;
    case 'close':
      state.setDoor(def.id, { pos: DOOR_CLOSED });
      break;
    case 'ajar':
      state.setDoor(def.id, { pos: DOOR_AJAR });
      break;
    case 'lock':
      state.setDoor(def.id, { locked: true, pos: DOOR_CLOSED });
      break;
    case 'unlock':
      state.setDoor(def.id, { locked: false });
      break;
    case 'barricade':
      state.setDoor(def.id, { barricade: actor.items.includes('outils') ? 100 : 60, barricadeSide: actor.region, pos: DOOR_CLOSED });
      break;
    case 'unbarricade':
      state.setDoor(def.id, { barricade: 0, barricadeSide: -1, locked: d.locked && def.lock?.type !== 'latch' });
      break;
    case 'force':
      state.setDoor(def.id, { barricade: 0, barricadeSide: -1, locked: false, pos: DOOR_OPEN, hp: Math.min(d.hp, 40) });
      break;
    case 'lift':
      state.moveElevator(state.elevator.target === 0 ? 1 : 0);
      break;
    default:
      return { ok: false, reason: 'Action inconnue', noise: 0 };
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* Machines                                                            */
/* ------------------------------------------------------------------ */

const FREQUENCIES = ['A — 38 Hz', 'B — 112 Hz', 'C — 440 Hz'];

function fixtureActions(state: WorldState, def: FixtureDef, actor: ActorCtx): ActionDef[] {
  const f = state.fixtures.get(def.id)!;
  const powered = state.sectorPowered(def.sector);
  const has = (item: string): boolean => actor.items.includes(item);
  const needPower = (a: ActionDef): ActionDef => (powered ? a : off(a.id, a.label, 'Secteur hors tension'));
  const repair = (): ActionDef =>
    has('outils') ? act('repair', 'Réparer', 6, 12, { wear: 30 }) : off('repair', 'Réparer', 'Outils de réparation requis');
  switch (def.type) {
    case 'fusebox':
      if (f.broken) return [act('reset', 'Réarmer le disjoncteur', 1.5, 6)];
      if (f.value < f.need) {
        const label = `Insérer un fusible (${f.value}/${f.need})`;
        return [has('fusible') ? act('fuse', label, 1.5, 5, { consumes: 'fusible' }) : off('fuse', label, 'Aucun fusible')];
      }
      return [off('info', 'Tableau électrique', 'Circuit rétabli')];
    case 'generator_aux':
    case 'generator_main': {
      if (f.broken) return [repair()];
      if (f.t > 0) return [off('start', 'Générateur', 'Montée en régime…')];
      if (f.on) return [act('stop', 'Arrêter le générateur', 1, 6)];
      if (def.type === 'generator_main') {
        const box = state.fixtures.get('fusebox.centrale');
        if (box && (box.broken || box.value < box.need)) return [off('start', 'Démarrer le générateur', 'Tableau du secteur incomplet')];
      }
      return [act('start', 'Démarrer le générateur', 2, 14)];
    }
    case 'terminal':
      return [needPower(act('use', 'Utiliser le terminal', 0, 2))];
    case 'airlock':
      if (state.flag('airlock') === 2) return [off('cycle', "Sas d'extraction", 'Sas ouvert — évacuez')];
      if (f.t > 0) return [off('cycle', "Sas d'extraction", 'Cycle en cours…')];
      if (!state.flag('extraction_ready')) return [off('cycle', "Lancer le cycle d'extraction", 'Objectif principal inachevé')];
      return [act('cycle', "Lancer le cycle d'extraction", 2, 12)];
    case 'medstation':
      if (f.t > 0) return [off('heal', 'Station médicale', 'Recharge en cours…')];
      return [needPower(act('heal', 'Se soigner', 5, 4))];
    case 'valve':
      return f.on ? [act('close', 'Fermer la vanne', 2, 8)] : [act('open', 'Ouvrir la vanne', 2, 8)];
    case 'purge':
      if (state.flag('purged')) return [off('purge', 'Purge thermique', 'Purge effectuée')];
      if (f.t > 0) return [off('purge', 'Purge thermique', 'Purge en cours…')];
      if (!state.mainPower) return [off('purge', 'Lancer la purge thermique', 'Générateur principal requis')];
      return [needPower(act('purge', 'Lancer la purge thermique', 3, 16))];
    case 'emitter':
      return [
        needPower(act('toggle', f.on ? "Couper l'émetteur" : "Activer l'émetteur", 1, f.on ? 3 : 18)),
        act('config', `Reconfigurer (fréquence ${FREQUENCIES[f.value % 3]})`, 1.5, 4),
      ];
    case 'coolant':
      if (f.broken) return [repair()];
      if (f.on) return [off('info', 'Refroidissement', 'En service')];
      return [needPower(act('restart', 'Redémarrer le refroidissement', 4, 10))];
    case 'antenna':
      if (f.broken) return [repair()];
      return f.on ? [act('stop', 'Couper le relais radio', 1, 3)] : [needPower(act('start', 'Activer le relais radio', 2, 6))];
    case 'incinerator': {
      if (f.t > 0) return [off('burn', 'Incinérateur', 'Combustion en cours…')];
      if (f.value >= f.need) return [off('burn', 'Incinérateur', 'Échantillons détruits')];
      const label = `Incinérer un échantillon (${f.value}/${f.need})`;
      return [has('echantillon') ? needPower(act('burn', label, 2, 12, { consumes: 'echantillon' })) : off('burn', label, 'Aucun échantillon')];
    }
    case 'cryo':
      return f.on ? [act('stop', 'Désactiver la cryogénie', 3, 10)] : [needPower(act('start', 'Réactiver la cryogénie', 3, 10))];
    case 'core_console': {
      if (state.flag('detuned')) return [off('detune', 'Console du Noyau', 'Noyau désaccordé')];
      if (f.t > 0) return [off('detune', 'Console du Noyau', 'Désaccord en cours — tenez la position')];
      if (f.value < f.need) {
        const label = `Insérer une cellule (${f.value}/${f.need})`;
        return [has('cellule') ? act('cell', label, 3, 8, { consumes: 'cellule' }) : off('cell', label, "Cellule d'énergie requise")];
      }
      if (!state.mainPower) return [off('detune', 'Désaccorder le Noyau', 'Générateur principal requis')];
      return [act('detune', 'Désaccorder le Noyau', 4, 20)];
    }
    case 'sampler':
      if (f.value >= f.need) return [off('sample', 'Préleveur', 'Cuve vide')];
      return [needPower(act('sample', 'Prélever un échantillon', 4, 6))];
    case 'probe':
      if (f.value > 0) return [off('record', "Banc d'induction", 'Enregistrement terminé')];
      if (f.t > 0) return [off('record', "Banc d'induction", 'Enregistrement en cours…')];
      return [needPower(act('record', "Lancer l'enregistrement", 3, 8))];
    case 'locker':
      if (actor.hiddenIn === def.id) return [act('leave', 'Sortir du casier', 0, 6)];
      if (f.on) return [off('hide', 'Casier', 'Occupé')];
      return [act('hide', 'Se cacher', 0.6, 6)];
    case 'camera':
      return [];
  }
}

function performFixture(state: WorldState, def: FixtureDef, action: ActionDef, actor: ActorCtx): ActionResult {
  const f = state.fixtures.get(def.id)!;
  const res: ActionResult = { ok: true, noise: action.noise, wear: action.wear };
  if (action.consumes) res.take = [action.consumes];
  const start = (seconds: number, patch: Partial<typeof f> = {}): void =>
    state.setFixture(def.id, { ...patch, t: seconds, total: seconds });
  switch (`${def.type}:${action.id}`) {
    case 'fusebox:reset':
      state.setFixture(def.id, { broken: false, on: f.value >= f.need });
      break;
    case 'fusebox:fuse':
      state.setFixture(def.id, { value: f.value + 1, on: f.value + 1 >= f.need });
      break;
    case 'generator_aux:repair':
    case 'generator_main:repair':
    case 'coolant:repair':
    case 'antenna:repair':
      state.setFixture(def.id, { broken: false });
      break;
    case 'generator_aux:start':
      start(PROCESS_TIME.generator_aux);
      break;
    case 'generator_main:start':
      start(PROCESS_TIME.generator_main);
      break;
    case 'generator_aux:stop':
    case 'generator_main:stop':
    case 'antenna:stop':
    case 'cryo:stop':
      state.setFixture(def.id, { on: false });
      break;
    case 'antenna:start':
    case 'cryo:start':
    case 'coolant:restart':
      state.setFixture(def.id, { on: true });
      break;
    case 'terminal:use':
      res.effect = 'terminal';
      res.effectData = def.id;
      break;
    case 'airlock:cycle':
      start(PROCESS_TIME.airlock);
      state.setFlag('airlock', 1);
      break;
    case 'medstation:heal':
      start(PROCESS_TIME.medstation);
      res.effect = 'heal';
      break;
    case 'valve:close':
      state.setFixture(def.id, { on: false, broken: false });
      break;
    case 'valve:open':
      state.setFixture(def.id, { on: true });
      break;
    case 'purge:purge':
      start(PROCESS_TIME.purge, { on: true });
      break;
    case 'emitter:toggle':
      state.setFixture(def.id, { on: !f.on });
      break;
    case 'emitter:config':
      state.setFixture(def.id, { value: (f.value + 1) % 3 });
      break;
    case 'incinerator:burn':
      start(PROCESS_TIME.burn, { value: f.value + 1, on: true });
      break;
    case 'core_console:cell':
      state.setFixture(def.id, { value: f.value + 1 });
      break;
    case 'core_console:detune':
      start(PROCESS_TIME.detune);
      break;
    case 'sampler:sample':
      state.setFixture(def.id, { value: f.value + 1 });
      res.give = [{ item: 'echantillon', charge: 0 }];
      break;
    case 'probe:record':
      start(PROCESS_TIME.probe, { on: true });
      break;
    case 'locker:hide':
      state.setFixture(def.id, { on: true });
      res.effect = 'hide';
      res.effectData = def.id;
      break;
    case 'locker:leave':
      state.setFixture(def.id, { on: false });
      res.effect = 'unhide';
      res.effectData = def.id;
      break;
    default:
      return { ok: false, reason: 'Action inconnue', noise: 0 };
  }
  void actor;
  return res;
}

/* ------------------------------------------------------------------ */
/* Objets au sol                                                       */
/* ------------------------------------------------------------------ */

function itemActions(item: WorldItem): ActionDef[] {
  if (item.item === 'document') return [act('read', 'Prendre le document', 0, 1)];
  return [act('take', `Ramasser : ${itemLabel(item.item, item.data)}`, 0, 2)];
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/** Position monde de la cible (pour les contrôles de distance et le bruit). */
export function targetPosition(state: WorldState, target: TargetRef): { x: number; z: number } | null {
  if (target.t === 'door') {
    const def = state.layout.doors[target.id];
    if (!def) return null;
    return doorCenter(def);
  }
  if (target.t === 'fx') {
    const def = state.fixtureDefs.get(target.id);
    return def ? { x: def.x, z: def.z } : null;
  }
  const it = state.items.get(target.uid);
  return it ? { x: it.x, z: it.z } : null;
}

export function doorCenter(def: DoorDef): { x: number; z: number } {
  const cx = (def.cell % GRID_W) * CELL;
  const cz = ((def.cell / GRID_W) | 0) * CELL;
  const h = CELL / 2;
  switch (def.dir) {
    case 0:
      return { x: cx + h, z: cz };
    case 1:
      return { x: cx + CELL, z: cz + h };
    case 2:
      return { x: cx + h, z: cz + CELL };
    default:
      return { x: cx, z: cz + h };
  }
}

export function listActions(state: WorldState, target: TargetRef, actor: ActorCtx): ActionDef[] {
  if (target.t === 'door') {
    const def = state.layout.doors[target.id];
    return def ? doorActions(state, def, actor) : [];
  }
  if (target.t === 'fx') {
    const def = state.fixtureDefs.get(target.id);
    return def ? fixtureActions(state, def, actor) : [];
  }
  const it = state.items.get(target.uid);
  return it ? itemActions(it) : [];
}

/** Libellé court de la cible, affiché au-dessus des actions. */
export function targetTitle(state: WorldState, target: TargetRef): string {
  if (target.t === 'door') {
    const def = state.layout.doors[target.id]!;
    if (def.kind === 'gate') return `Sas — ${SECTOR_BY_ID[def.sector].name}`;
    if (def.kind === 'vent') return 'Grille de conduit';
    if (def.kind === 'elevator') return 'Ascenseur du Noyau';
    if (def.kind === 'secret') return 'Panneau mural';
    return 'Porte';
  }
  if (target.t === 'fx') {
    const def = state.fixtureDefs.get(target.id)!;
    return FIXTURE_NAMES[def.type] ?? def.type;
  }
  const it = state.items.get(target.uid);
  return it ? itemLabel(it.item, it.data) : '';
}

export const FIXTURE_NAMES: Record<string, string> = {
  fusebox: 'Tableau électrique',
  generator_main: 'Générateur principal',
  generator_aux: 'Générateur secondaire',
  terminal: 'Terminal',
  airlock: "Commande du sas d'extraction",
  medstation: 'Station médicale',
  valve: 'Vanne de vapeur',
  purge: 'Console de purge',
  emitter: 'Émetteur acoustique',
  coolant: 'Refroidissement des baies',
  antenna: 'Relais radio',
  incinerator: 'Incinérateur',
  cryo: 'Commande cryogénique',
  core_console: 'Console du Noyau',
  locker: 'Casier',
  camera: 'Caméra de surveillance',
  sampler: 'Préleveur de culture',
  probe: "Banc d'induction",
};

/**
 * Exécution côté hôte. Revalide la distance et les conditions avant de modifier l'état.
 */
export function performAction(state: WorldState, target: TargetRef, actionId: string, actor: ActorCtx): ActionResult {
  const pos = targetPosition(state, target);
  if (!pos) return { ok: false, reason: 'Cible disparue', noise: 0 };
  const dx = pos.x - actor.x;
  const dz = pos.z - actor.z;
  if (dx * dx + dz * dz > INTERACT_RANGE * INTERACT_RANGE) return { ok: false, reason: 'Trop loin', noise: 0 };
  const action = listActions(state, target, actor).find((a) => a.id === actionId);
  if (!action) return { ok: false, reason: 'Action indisponible', noise: 0 };
  if (!action.enabled) return { ok: false, reason: action.reason ?? 'Action indisponible', noise: 0 };
  if (target.t === 'door') return performDoor(state, state.layout.doors[target.id]!, action, actor);
  if (target.t === 'fx') return performFixture(state, state.fixtureDefs.get(target.id)!, action, actor);
  const it = state.items.get(target.uid)!;
  state.commit({ k: 'item-', uid: it.uid });
  if (it.item === 'document') return { ok: true, noise: action.noise, effect: 'document', effectData: it.data };
  const charge = it.charge >= 0 ? it.charge : itemDef(it.item).maxCharge;
  return { ok: true, noise: action.noise, give: [{ item: it.item, charge, data: it.data }] };
}

/* ------------------------------------------------------------------ */
/* Terminaux                                                           */
/* ------------------------------------------------------------------ */

export interface TerminalDoorEntry {
  id: number;
  label: string;
  locked: boolean;
  /** Le terminal peut-il commander cette porte ? */
  allowed: boolean;
  reason?: string;
}

/** Portes commandables depuis le terminal d'un secteur. */
export function terminalDoors(state: WorldState, terminal: FixtureDef): TerminalDoorEntry[] {
  const tier = SECTOR_BY_ID[terminal.sector].tier;
  const out: TerminalDoorEntry[] = [];
  for (const d of state.layout.doors) {
    if (d.kind !== 'gate' && d.kind !== 'door') continue;
    const ra = state.layout.regions[d.a]!;
    const rb = state.layout.regions[d.b]!;
    if (ra.sector !== terminal.sector && rb.sector !== terminal.sector) continue;
    if (d.kind === 'door' && !(state.doors[d.id]!.locked || d.lock)) continue;
    const rt = state.doors[d.id]!;
    let allowed = true;
    let reason: string | undefined;
    if (rt.barricade > 0) {
      allowed = false;
      reason = 'Obstruction mécanique';
    } else if (d.lock?.type === 'card' && d.lock.level > Math.max(1, tier)) {
      allowed = false;
      reason = `Habilitation niveau ${d.lock.level} requise`;
    }
    const other = ra.sector === terminal.sector ? rb : ra;
    const label = d.kind === 'gate' ? `Sas vers ${SECTOR_BY_ID[other.sector].name}` : `Porte — ${other.type === 'couloir' ? ra.type : other.type}`;
    out.push({ id: d.id, label, locked: rt.locked, allowed, reason });
  }
  return out;
}

export type TerminalCommand = { c: 'door'; door: number } | { c: 'download' };

/** Commande émise depuis l'interface d'un terminal (exécutée par l'hôte). */
export function performTerminal(state: WorldState, terminalId: string, cmd: TerminalCommand, actor: ActorCtx): ActionResult {
  const def = state.fixtureDefs.get(terminalId);
  if (!def || def.type !== 'terminal') return { ok: false, reason: 'Terminal inconnu', noise: 0 };
  const dx = def.x - actor.x;
  const dz = def.z - actor.z;
  if (dx * dx + dz * dz > INTERACT_RANGE * INTERACT_RANGE) return { ok: false, reason: 'Trop loin', noise: 0 };
  if (!state.sectorPowered(def.sector)) return { ok: false, reason: 'Secteur hors tension', noise: 0 };
  if (cmd.c === 'door') {
    const entry = terminalDoors(state, def).find((e) => e.id === cmd.door);
    if (!entry) return { ok: false, reason: 'Porte inconnue', noise: 0 };
    if (!entry.allowed) return { ok: false, reason: entry.reason, noise: 0 };
    state.setDoor(cmd.door, { locked: !entry.locked, pos: entry.locked ? state.doors[cmd.door]!.pos : DOOR_CLOSED });
    return { ok: true, noise: 6 };
  }
  const f = state.fixtures.get(terminalId)!;
  if (f.t > 0) return { ok: false, reason: 'Transfert déjà en cours', noise: 0 };
  state.setFixture(terminalId, { t: PROCESS_TIME.download, total: PROCESS_TIME.download });
  return { ok: true, noise: 4 };
}
