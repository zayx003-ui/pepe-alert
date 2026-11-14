/**
 * Directeur d'événements : le complexe vit sans attendre les joueurs.
 * Pannes, fuites, portes qui battent, annonces… tirés à intervalles irréguliers
 * par l'hôte, indépendamment de la position de l'équipe.
 * Aucun événement ne peut bloquer définitivement une partie : tout ce qu'il
 * casse se réarme, se referme ou se répare.
 */
import { Rng } from '../core/rng';
import { doorCenter } from '../interaction/actions';
import { DOOR_AJAR, DOOR_CLOSED, DOOR_OPEN } from '../world/grid';
import { SECTORS, SECTOR_BY_ID } from '../world/sectors';
import type { WorldState } from '../world/state';
import type { SectorId } from '../world/types';

export interface WorldNotice {
  /** Identifiant du type d'événement (sert aussi de clé sonore). */
  kind: 'coupure' | 'fuite' | 'generateur' | 'porte' | 'eclairage' | 'annonce' | 'relais' | 'surchauffe';
  /** Texte affiché aux joueurs concernés (vide = événement seulement sonore). */
  text: string;
  sector: SectorId | null;
  x: number;
  z: number;
  /** Portée du bruit produit (perçu par les entités). */
  noise: number;
}

const ANNOUNCEMENTS = [
  'Rappel : le couvre-feu du Protocole débute à vingt-deux heures.',
  'Le personnel du secteur expérimental est attendu… est attendu… est attendu…',
  'Sujet neuf, veuillez regagner votre lit.',
  "Défaut d'isolement en zone de quarantaine. Ceci n'est pas un exercice.",
  'Il y a quelqu’un à l’accueil. Il y a quelqu’un à l’accueil.',
  'Bonsoir.',
];

export class EventDirector {
  /** Événements produits depuis la dernière lecture. */
  readonly notices: WorldNotice[] = [];
  private rng: Rng;
  private next: number;
  private flickers: { id: number; until: number; mode: number }[] = [];

  constructor(
    private state: WorldState,
    seed: string,
  ) {
    this.rng = new Rng(`${seed}:evenements`);
    this.next = this.rng.range(70, 110);
  }

  update(dt: number, threat: number): void {
    const st = this.state;
    // Fin des vagues de clignotement.
    for (let i = this.flickers.length - 1; i >= 0; i--) {
      const f = this.flickers[i]!;
      if (st.time >= f.until) {
        st.commit({ k: 'light', id: f.id, mode: f.mode });
        this.flickers.splice(i, 1);
      }
    }
    this.next -= dt;
    if (this.next > 0) return;
    this.next = this.rng.range(55, 105) * (1.15 - threat * 0.45);
    this.trigger();
  }

  /** Déclenche un événement : celui demandé, ou un tirage parmi ceux possibles maintenant. */
  trigger(forced?: WorldNotice['kind']): boolean {
    if (forced) return this.run(forced);
    const options: [WorldNotice['kind'], number][] = [
      ['coupure', 2],
      ['fuite', 2],
      ['generateur', 1.5],
      ['porte', 3],
      ['eclairage', 3],
      ['annonce', 2],
      ['relais', 1],
      ['surchauffe', 1],
    ];
    const total = options.reduce((sum, o) => sum + o[1], 0);
    for (let tries = 0; tries < 6; tries++) {
      let roll = this.rng.next() * total;
      let kind = options[0]![0];
      for (const [k, w] of options) {
        roll -= w;
        if (roll <= 0) {
          kind = k;
          break;
        }
      }
      if (this.run(kind)) return true;
    }
    return false;
  }

  private notice(kind: WorldNotice['kind'], text: string, sector: SectorId | null, x: number, z: number, noise: number): void {
    this.notices.push({ kind, text, sector, x, z, noise });
  }

  private run(kind: WorldNotice['kind']): boolean {
    const st = this.state;
    const rng = this.rng;
    switch (kind) {
      case 'coupure': {
        // Le disjoncteur d'un secteur alimenté saute (jamais l'accueil : point de repli).
        const powered = SECTORS.filter((s) => s.id !== 'accueil' && st.sectorPowered(s.id));
        if (powered.length === 0) return false;
        const sector = rng.pick(powered).id;
        const def = st.fixtureDefs.get(`fusebox.${sector}`);
        if (!def) return false;
        st.setFixture(def.id, { broken: true, on: false });
        this.notice('coupure', `Coupure de courant — ${SECTOR_BY_ID[sector].name}. Réarmez le disjoncteur.`, sector, def.x, def.z, 10);
        return true;
      }
      case 'fuite': {
        const valves = Array.from(st.fixtures).filter(([id, f]) => id.startsWith('valve.') && f.on && !f.broken);
        if (valves.length === 0) return false;
        const [id] = rng.pick(valves);
        const def = st.fixtureDefs.get(id)!;
        st.setFixture(id, { broken: true });
        this.notice('fuite', `Fuite de vapeur — ${SECTOR_BY_ID[def.sector].name}. Fermez la vanne.`, def.sector, def.x, def.z, 18);
        return true;
      }
      case 'generateur': {
        const aux = st.fixture('generator_aux.maintenance');
        const main = st.fixture('generator_main.centrale');
        const candidates: string[] = [];
        if (aux?.on) candidates.push('generator_aux.maintenance', 'generator_aux.maintenance');
        if (main?.on) candidates.push('generator_main.centrale');
        if (candidates.length === 0) return false;
        const id = rng.pick(candidates);
        const def = st.fixtureDefs.get(id)!;
        // Le plus souvent un simple arrêt ; parfois une vraie panne à réparer avec des outils.
        const broken = rng.chance(0.3);
        st.setFixture(id, { on: false, broken });
        this.notice(
          'generateur',
          broken ? `Le ${id.includes('main') ? 'générateur principal' : 'générateur secondaire'} est en panne. Outils requis.` : `Le ${id.includes('main') ? 'générateur principal' : 'générateur secondaire'} s'est arrêté.`,
          def.sector,
          def.x,
          def.z,
          14,
        );
        return true;
      }
      case 'porte': {
        // Une porte simple, non verrouillée, change d'état toute seule.
        for (let tries = 0; tries < 12; tries++) {
          const def = rng.pick(st.layout.doors);
          const rt = st.doors[def.id]!;
          if (def.kind !== 'door' || rt.locked || rt.barricade > 0) continue;
          const pos = rt.pos === DOOR_OPEN ? DOOR_CLOSED : rng.chance(0.5) ? DOOR_OPEN : DOOR_AJAR;
          st.setDoor(def.id, { pos });
          const c = doorCenter(def);
          this.notice('porte', '', def.sector, c.x, c.z, 9);
          return true;
        }
        return false;
      }
      case 'eclairage': {
        const sector = rng.pick(SECTORS).id;
        let count = 0;
        st.layout.lights.forEach((l) => {
          if (l.sector !== sector || st.lightMode[l.id] !== 0 || count >= 10) return;
          if (!rng.chance(0.5)) return;
          this.flickers.push({ id: l.id, until: st.time + rng.range(12, 30), mode: 0 });
          st.commit({ k: 'light', id: l.id, mode: 1 });
          count++;
        });
        if (count === 0) return false;
        this.notice('eclairage', '', sector, 0, 0, 0);
        return true;
      }
      case 'annonce':
        this.notice('annonce', `« ${rng.pick(ANNOUNCEMENTS)} »`, null, 0, 0, 0);
        return true;
      case 'relais': {
        const f = st.fixture('antenna.accueil');
        const def = st.fixtureDefs.get('antenna.accueil');
        if (!f?.on || !def) return false;
        st.setFixture(def.id, { on: false });
        this.notice('relais', 'Le relais radio a décroché. Réactivez-le au poste de sécurité.', 'accueil', def.x, def.z, 0);
        return true;
      }
      case 'surchauffe': {
        const f = st.fixture('coolant.serveurs');
        const def = st.fixtureDefs.get('coolant.serveurs');
        if (!f?.on || !def) return false;
        st.setFixture(def.id, { on: false });
        this.notice('surchauffe', 'Le refroidissement des baies vient de lâcher.', 'serveurs', def.x, def.z, 12);
        return true;
      }
    }
  }
}
