/**
 * Autorité de l'hôte : fait vivre les entités, les missions et les événements,
 * valide les interactions demandées par les clients et arrête le résultat de
 * l'expédition. Une seule instance existe par partie ; si l'hôte part, un autre
 * joueur en recrée une à partir du dernier état reçu (`takeover`).
 */
import type { AIEvent, EntitySnapshot, TargetInfo } from '../ai/agent';
import { EntityAIManager } from '../ai/manager';
import { ENTITY_SPECS, type EntityKind } from '../ai/specs';
import { Rng } from '../core/rng';
import { performAction, performTerminal, type ActionResult } from '../interaction/actions';
import { EventDirector } from '../missions/events';
import { MissionManager } from '../missions/manager';
import { OBJECTIVE_BY_ID } from '../missions/objectives';
import {
  FLAG_ALIVE,
  FLAG_CROUCH,
  FLAG_LIGHT,
  MSG,
  type ChatMsg,
  type ExpeditionResult,
  type FactMsg,
  type FxMsg,
  type OpsMsg,
  type PlayerResult,
  type RequestMsg,
  type SyncMsg,
} from '../network/protocol';
import { SECTORS } from '../world/sectors';
import type { SectorId } from '../world/types';
import type { GameSession, PlayerRecord } from './session';

const ENTITY_RATE = 1 / 8;
const HOST_STATE_RATE = 6;

/** Phrases que le Visiteur peut émettre sur la radio sous le nom d'un coéquipier. */
const FAKE_RADIO = [
  'Par ici, j’ai trouvé quelque chose.',
  'Vous êtes où ? Je suis tout seul.',
  'Venez voir. Venez voir.',
  'J’ai la carte, rejoins-moi.',
  'Ne bougez pas, j’arrive.',
  'Tu m’entends ? Réponds.',
];

export type HostExport = ReturnType<MissionManager['exportFull']>;

export class HostAuthority {
  readonly ai: EntityAIManager;
  readonly missions: MissionManager;
  readonly director: EventDirector;
  seq = 0;
  ended = false;
  private entityTimer = 0;
  private hostStateTimer = 2;
  private targets: TargetInfo[] = [];
  private rng: Rng;
  private occupied = new Set<SectorId>();
  private endDelay = 0;

  constructor(
    private session: GameSession,
    restore?: { entities: EntitySnapshot[]; mission: HostExport | null; seq: number },
  ) {
    const { world, seed } = session;
    this.rng = new Rng(`${seed}:hote:${restore ? restore.seq : 0}`);
    this.ai = new EntityAIManager(world, seed);
    this.missions = new MissionManager(world, seed, session.objective || undefined);
    this.director = new EventDirector(world, seed);
    if (restore) {
      this.seq = restore.seq;
      this.ai.restore(restore.entities);
      if (restore.mission) this.missions.importFull(restore.mission);
      this.missions.dirty = true;
    } else {
      this.ai.spawnAll();
    }
    world.events.on('done', ({ def }) => {
      // Les processus bruyants s'entendent de loin.
      this.ai.addNoise(def.x, def.z, 16, 'monde');
    });
  }

  /* ---------------- boucle ---------------- */

  update(dt: number): void {
    if (this.ended) return;
    const s = this.session;
    const world = s.world;

    // Cibles de l'IA et secteurs occupés.
    this.targets.length = 0;
    this.occupied.clear();
    let alive = 0;
    let active = 0;
    let extracted = 0;
    for (const p of s.players.values()) {
      if (p.status === 'extracted') extracted++;
      if (!p.connected) continue;
      if (p.status === 'playing') {
        alive++;
        active++;
        const cell = world.grid.cellAt(p.x, p.z);
        const sec = cell >= 0 ? world.layout.sectorOf[cell]! : -1;
        if (sec >= 0) this.occupied.add(SECTORS[sec]!.id);
        this.targets.push({
          id: p.id,
          x: p.x,
          y: p.y,
          z: p.z,
          yaw: p.yaw,
          alive: (p.flags & FLAG_ALIVE) !== 0,
          hiddenIn: p.hiddenIn,
          crouching: (p.flags & FLAG_CROUCH) !== 0,
          lightOn: (p.flags & FLAG_LIGHT) !== 0,
          noise: p.noise,
          speed: p.speed,
          devices: p.devices,
        });
      }
    }

    // Machines en marche : bruit continu perçu par les entités.
    this.machineNoise(dt);

    this.missions.setOccupied(this.occupied);
    this.missions.update(dt);
    for (const c of this.missions.consequences.splice(0)) this.applyConsequence(c);
    for (const ch of this.missions.changes.splice(0)) {
      const def = OBJECTIVE_BY_ID[ch.id]!;
      const text =
        ch.status === 'reussi'
          ? `Objectif accompli — ${def.title}`
          : ch.status === 'echoue'
            ? `Objectif échoué — ${def.title}`
            : ch.step === 0
              ? `Nouvel objectif — ${def.title}`
              : `${def.title} : étape ${ch.step + 1}/${def.steps.length}`;
      s.broadcastNotice({ kind: ch.status === 'echoue' ? 'echec' : 'objectif', text });
    }

    this.director.update(dt, this.missions.threat);
    for (const n of this.director.notices.splice(0)) {
      if (n.noise > 0) this.ai.addNoise(n.x, n.z, n.noise, 'monde');
      s.broadcast(MSG.NOTICE, n);
      s.receiveNotice(n);
    }

    this.ai.update(dt, this.targets, this.missions.threat);
    for (const ev of this.ai.events) this.handleAIEvent(ev);

    // Diffusion.
    if (world.outbox.length > 0) {
      const msg: OpsMsg = { seq: ++this.seq, ops: world.outbox.splice(0) };
      s.broadcast(MSG.OPS, msg);
    }
    this.entityTimer -= dt;
    if (this.entityTimer <= 0) {
      this.entityTimer = ENTITY_RATE;
      const snaps = this.ai.snapshots();
      s.applyEntities(snaps);
      s.broadcast(MSG.ENTITIES, snaps);
    }
    if (this.missions.dirty) {
      this.missions.dirty = false;
      const snap = this.missions.snapshot();
      s.mission = snap;
      s.broadcast(MSG.MISSION, snap);
    }
    this.hostStateTimer -= dt;
    if (this.hostStateTimer <= 0) {
      this.hostStateTimer = HOST_STATE_RATE;
      // Sert aussi de battement : un client qui a manqué des opérations le détecte au numéro de séquence.
      s.broadcast(MSG.HOST_STATE, { seq: this.seq, mission: this.missions.exportFull() });
    }

    // Fin de l'expédition : plus personne en jeu, ou fenêtre d'extraction écoulée.
    const windowOver = this.missions.phase === 'extraction' && this.missions.extractionLeft === 0;
    if (active === 0 || windowOver) {
      this.endDelay += dt;
      if (this.endDelay > 1.5) this.finish(extracted);
    } else this.endDelay = 0;
    void alive;
  }

  private machineTimer = 0;

  private machineNoise(dt: number): void {
    this.machineTimer -= dt;
    if (this.machineTimer > 0) return;
    this.machineTimer = 1.5;
    const world = this.session.world;
    for (const [id, f] of world.fixtures) {
      const def = world.fixtureDefs.get(id)!;
      let radius = 0;
      if (def.type === 'generator_main') radius = f.t > 0 ? 40 : f.on ? 18 : 0;
      else if (def.type === 'generator_aux') radius = f.t > 0 ? 26 : f.on ? 12 : 0;
      else if (def.type === 'airlock' && f.t > 0) radius = 45;
      else if ((def.type === 'purge' || def.type === 'core_console' || def.type === 'probe') && f.t > 0) radius = 30;
      else if (def.type === 'emitter' && f.on) radius = 35;
      else if (def.type === 'valve' && f.broken && f.on) radius = 14;
      if (radius > 0) this.ai.addNoise(def.x, def.z, radius, 'monde');
    }
  }

  private applyConsequence(c: string): void {
    const s = this.session;
    switch (c) {
      case 'menace+':
        this.missions.threatBonus += 0.15;
        break;
      case 'menace-':
        this.missions.threatBonus -= 0.12;
        break;
      case 'reveil':
        for (const a of this.ai.agents) if (a.kind === 'visiteur' && a.state === 'dormant') a.wakeIn = Math.min(a.wakeIn, a.stateTime + 6);
        break;
      case 'ravitaillement': {
        const spawn = s.layout.spawn;
        for (const item of ['medkit', 'piles', 'serum']) {
          s.world.commit({
            k: 'item+',
            it: { uid: s.world.newUid(), item, x: spawn.x + this.rng.range(-0.8, 0.8), y: spawn.y + 0.02, z: spawn.z + this.rng.range(-0.8, 0.8), charge: -1 },
          });
        }
        break;
      }
      case 'carte':
        s.world.setFlag('carte_complete', 1);
        break;
    }
    this.missions.dirty = true;
  }

  private handleAIEvent(ev: AIEvent): void {
    const s = this.session;
    switch (ev.type) {
      case 'attack':
        s.sendTo(ev.target, MSG.DAMAGE, { amount: ev.damage, injury: ev.injury, kind: ev.kind });
        this.fx({ type: 'sound', sound: `attaque_${ev.kind}`, x: this.agentPos(ev.uid).x, z: this.agentPos(ev.uid).z, uid: ev.uid });
        break;
      case 'sound':
        this.ai.addNoise(ev.x, ev.z, ev.radius * 0.6, `e${ev.uid}`);
        this.fx({ type: 'sound', sound: ev.sound, x: ev.x, z: ev.z, uid: ev.uid });
        break;
      case 'fake':
        if (ev.what === 'radio') {
          const as = s.players.get(ev.as);
          const msg: ChatMsg = { ch: 'radio', name: as?.name ?? '???', text: this.rng.pick(FAKE_RADIO), x: ev.x, z: ev.z, fake: true };
          s.broadcast(MSG.CHAT, msg);
          s.receiveChat(msg);
        } else this.fx({ type: 'fake', what: ev.what, x: ev.x, z: ev.z, as: ev.as });
        break;
      case 'drain':
        s.sendTo(ev.target, MSG.EFFECT, { type: 'drain', v: ev.factor });
        break;
      case 'infect':
        s.sendTo(ev.target, MSG.EFFECT, { type: 'infect', v: ev.amount });
        break;
      case 'stress':
        s.sendTo(ev.target, MSG.EFFECT, { type: 'stress', v: ev.amount });
        break;
      case 'marker':
        if (s.world.markers.some((m) => m.id === ev.id)) s.world.commit({ k: 'marker-', id: ev.id });
        break;
    }
  }

  private agentPos(uid: number): { x: number; z: number } {
    const a = this.ai.agents.find((x) => x.uid === uid);
    return a ? { x: a.x, z: a.z } : { x: 0, z: 0 };
  }

  private fx(msg: FxMsg): void {
    this.session.broadcast(MSG.FX, msg);
    this.session.receiveFx(msg);
  }

  /* ---------------- demandes des joueurs ---------------- */

  handleRequest(from: string, msg: RequestMsg): ActionResult {
    const s = this.session;
    const p = s.players.get(from);
    if (!p || p.status !== 'playing') return { ok: false, reason: 'Joueur hors jeu', noise: 0 };
    // La position retenue est celle que l'hôte connaît, pas celle annoncée par le client.
    const actor = { ...msg.actor, id: from, x: p.x, z: p.z, region: s.world.grid.regionAt(p.x, p.z), hiddenIn: p.hiddenIn };
    const result = msg.term
      ? performTerminal(s.world, msg.target.t === 'fx' ? msg.target.id : '', msg.term, actor)
      : performAction(s.world, msg.target, msg.action, actor);
    if (!result.ok) return result;
    if (result.noise > 0) this.ai.addNoise(p.x, p.z, result.noise, from);
    if (result.give) for (const g of result.give) this.missions.onPickup(g.item, g.data);
    if (result.effect === 'document' && result.effectData) this.missions.onDocument(result.effectData);
    if (result.effect === 'terminal' && result.effectData) this.missions.onTerminalUse(result.effectData);
    if (result.effect === 'hide' && result.effectData) p.hiddenIn = result.effectData;
    if (result.effect === 'unhide') p.hiddenIn = '';
    return result;
  }

  handleFact(from: string, fact: FactMsg): void {
    const s = this.session;
    const p = s.players.get(from);
    if (!p) return;
    const world = s.world;
    switch (fact.k) {
      case 'drop': {
        // L'objet doit retomber près du joueur : on borne la distance annoncée.
        if (Math.hypot(fact.x - p.x, fact.z - p.z) > 14 || !world.grid.walkable(fact.x, fact.z)) return;
        world.commit({ k: 'item+', it: { uid: world.newUid(), item: fact.item, x: fact.x, y: fact.y, z: fact.z, data: fact.data, charge: fact.charge } });
        this.ai.addNoise(fact.x, fact.z, Math.min(16, fact.noise), from);
        break;
      }
      case 'marker':
        if (Math.hypot(fact.x - p.x, fact.z - p.z) > 3) return;
        world.commit({ k: 'marker', m: { id: world.newUid(), x: fact.x, y: fact.y, z: fact.z } });
        break;
      case 'camera':
        if (Math.hypot(fact.x - p.x, fact.z - p.z) > 3) return;
        world.commit({ k: 'cam+', c: { id: world.newUid(), x: fact.x, y: fact.y, z: fact.z, yaw: fact.yaw, owner: from } });
        break;
      case 'measure': {
        const region = world.grid.regionAt(p.x, p.z);
        if (region >= 0) this.missions.onMeasure(world.layout.regions[region]!.sector, region);
        break;
      }
      case 'observe':
        if (fact.kind in ENTITY_SPECS) this.missions.onObserve(fact.kind as EntityKind);
        break;
      case 'noise':
        this.ai.addNoise(fact.x, fact.z, Math.min(20, fact.r), from);
        break;
      case 'died':
        if (p.status === 'playing') {
          p.status = 'dead';
          this.missions.onDeath();
          s.broadcastNotice({ kind: 'mort', text: `${p.name} ne répond plus.` });
        }
        break;
      case 'extracted':
        if (p.status === 'playing' && world.flag('airlock') === 2 && world.grid.regionAt(p.x, p.z) === s.layout.extraction.region) {
          p.status = 'extracted';
          s.broadcastNotice({ kind: 'objectif', text: `${p.name} a quitté le complexe.` });
        }
        break;
      case 'leave': {
        const f = world.fixture(fact.locker);
        if (f?.on) world.setFixture(fact.locker, { on: false });
        p.hiddenIn = '';
        break;
      }
    }
  }

  buildSync(): SyncMsg {
    const s = this.session;
    const players: SyncMsg['players'] = {};
    for (const p of s.players.values()) players[p.id] = { x: p.x, y: p.y, z: p.z, status: p.status };
    return { seq: this.seq, world: s.world.snapshot(), mission: this.missions.snapshot(), entities: this.ai.snapshots(), players };
  }

  /* ---------------- résultat ---------------- */

  finish(extracted: number): void {
    if (this.ended) return;
    this.ended = true;
    const s = this.session;
    this.missions.finish(extracted);
    s.mission = this.missions.snapshot();
    s.broadcast(MSG.MISSION, s.mission);
    const players: PlayerResult[] = [];
    for (const p of s.players.values()) players.push({ id: p.id, name: p.name, status: resultStatus(p) });
    const result: ExpeditionResult = {
      sessionId: s.sessionId,
      seed: s.seed,
      outcome: this.missions.outcome === 'succes' ? 'succes' : 'echec',
      duration: Math.floor(this.missions.elapsed),
      primary: this.missions.primary.id,
      objectivesDone: this.missions.objectives.filter((o) => o.status === 'reussi').map((o) => o.id),
      objectivesFailed: this.missions.objectives.filter((o) => o.status === 'echoue').map((o) => o.id),
      documents: Array.from(this.missions.docs),
      creatures: Array.from(this.missions.observed),
      players,
    };
    s.broadcast(MSG.RESULT, result);
    s.receiveResult(result);
  }
}

function resultStatus(p: PlayerRecord): PlayerResult['status'] {
  if (p.status === 'extracted') return 'extrait';
  if (p.status === 'dead') return 'mort';
  return p.connected ? 'disparu' : 'abandon';
}
