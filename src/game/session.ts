/**
 * GameSession — une expédition vue par un joueur.
 *
 * Réunit le personnage local (déplacement, physiologie, inventaire), l'état du
 * monde, les autres joueurs, les entités et la liaison réseau. Entièrement
 * indépendant du moteur 3D et du DOM : la vue, l'audio et l'interface lisent
 * son état et écoutent ses événements. Cela permet de le tester en mémoire avec
 * plusieurs clients.
 */
import type { EntitySnapshot } from '../ai/agent';
import type { EntityKind } from '../ai/specs';
import { EventBus } from '../core/events';
import { angleDelta, clamp, dist, dist2, lerpAngle } from '../core/math';
import {
  INTERACT_RANGE,
  doorCenter,
  listActions,
  targetTitle,
  type ActionDef,
  type ActionResult,
  type ActorCtx,
  type TargetRef,
  type TerminalCommand,
} from '../interaction/actions';
import { Inventory, type InvItem } from '../inventory/inventory';
import { itemDef, itemLabel } from '../inventory/items';
import type { WorldNotice } from '../missions/events';
import type { MissionSnapshot } from '../missions/manager';
import {
  FLAG_ALIVE,
  FLAG_CROUCH,
  FLAG_EXTRACTED,
  FLAG_LIGHT,
  FLAG_RADIO,
  FLAG_SPRINT,
  MSG,
  type ChatMsg,
  type DamageMsg,
  type EffectMsg,
  type ExpeditionResult,
  type FactMsg,
  type FxMsg,
  type OpsMsg,
  type PlayerStateMsg,
  type PlayerStatus,
  type RequestMsg,
  type ResponseMsg,
  type SyncMsg,
} from '../network/protocol';
import type { Identity } from '../network/room';
import type { NetMessage } from '../network/transport';
import { PlayerMotor, SURFACE_NOISE, movementNoise, type MoveIntent } from '../player/motor';
import { PlayerSimulation, type InjuryType } from '../player/simulation';
import { generateLayout } from '../world/generator';
import { DOOR_OPEN } from '../world/grid';
import { SECTORS, type SectorDef } from '../world/sectors';
import { WorldState, type WorldOp } from '../world/state';
import { CellKind, type Layout } from '../world/types';
import { HostAuthority, type HostExport } from './host';

/** Liaison réseau minimale dont la session a besoin (un RoomSession la fournit). */
export interface SessionLink {
  send(t: string, d: unknown, to?: string): void;
}

export interface SessionOptions {
  seed: string;
  sessionId: string;
  self: Identity;
  roster: (Identity & { loadout: string[] })[];
  hostId: string;
  /** Objectif principal imposé ('' = tiré par la graine). */
  objective: string;
  link: SessionLink | null;
}

export interface PlayerRecord extends Identity {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
  noise: number;
  speed: number;
  health: number;
  devices: number;
  hiddenIn: string;
  activeItem: string;
  status: PlayerStatus;
  connected: boolean;
  /** Dernière position reçue (cible de l'interpolation). */
  tx: number;
  ty: number;
  tz: number;
  tyaw: number;
  lastUpdate: number;
}

export interface EntityView extends EntitySnapshot {
  tx: number;
  ty: number;
  tz: number;
  tyaw: number;
}

/** Commandes du joueur pour une image (remplies par la couche d'entrée). */
export interface FrameInput extends MoveIntent {
  holdBreath: boolean;
  /** Touche d'interaction maintenue / vient d'être pressée. */
  interact: boolean;
  interactPressed: boolean;
  /** Molette : change l'action sélectionnée ou l'emplacement actif. */
  scroll: number;
  usePressed: boolean;
  use: boolean;
  throwPressed: boolean;
  dropPressed: boolean;
  reloadPressed: boolean;
  lightPressed: boolean;
  /** Emplacement d'inventaire demandé (-1 = aucun). */
  slot: number;
  /** Interface ouverte : le personnage ne bouge plus. */
  frozen: boolean;
}

export function emptyInput(): FrameInput {
  return {
    forward: 0,
    strafe: 0,
    sprint: false,
    crouch: false,
    jump: false,
    holdBreath: false,
    interact: false,
    interactPressed: false,
    scroll: 0,
    usePressed: false,
    use: false,
    throwPressed: false,
    dropPressed: false,
    reloadPressed: false,
    lightPressed: false,
    slot: -1,
    frozen: false,
  };
}

export interface Focus {
  target: TargetRef;
  title: string;
  actions: ActionDef[];
  index: number;
  /** Avancement de l'action maintenue, 0 à 1. */
  progress: number;
}

export interface ChatLine {
  ch: 'prox' | 'radio' | 'systeme';
  name: string;
  text: string;
  /** Signalé comme imitation par un détecteur sonore allumé. */
  flagged: boolean;
}

export interface SoundEvent {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Son propre au joueur local (non spatialisé). */
  self?: boolean;
  volume?: number;
}

export interface SessionEvents {
  sound: SoundEvent;
  notice: { kind: string; text: string };
  hurt: { amount: number; kind: string };
  chat: ChatLine;
  ended: ExpeditionResult;
  document: string;
  terminal: string;
  status: PlayerStatus;
  fx: FxMsg;
  op: WorldOp;
  host: string;
}

const SEND_RATE = 0.1;
const FOCUS_RATE = 0.08;
const HUNT_STATES = new Set(['chasse', 'attaque', 'charge', 'frenesie', 'assaut', 'poursuite']);

export class GameSession {
  readonly seed: string;
  readonly sessionId: string;
  readonly self: Identity;
  readonly objective: string;
  readonly layout: Layout;
  readonly world: WorldState;
  readonly motor = new PlayerMotor();
  readonly sim = new PlayerSimulation();
  readonly inventory = new Inventory();
  readonly players = new Map<string, PlayerRecord>();
  readonly entities = new Map<number, EntityView>();
  readonly events = new EventBus<SessionEvents>();
  readonly documents = new Set<string>();
  readonly chat: ChatLine[] = [];
  /** Régions déjà visitées par l'équipe locale (carte). */
  readonly visited = new Set<number>();
  host: HostAuthority | null = null;
  hostId: string;
  mission: MissionSnapshot | null = null;
  result: ExpeditionResult | null = null;
  status: PlayerStatus = 'playing';
  hiddenIn = '';
  focus: Focus | null = null;
  time = 0;
  /** Portée du bruit actuellement produit (pour le sonomètre). */
  noise = 0;
  /** Le joueur est-il pris en chasse / voit-il une entité ? */
  chased = false;
  seesEntity = false;
  /** Lecture de l'appareil de mesure. */
  readout = { temperature: 0, contamination: 0, em: 0 };
  /** Délai restant avant extraction quand le joueur se tient dans le sas ouvert. */
  extractProgress = 0;
  private link: SessionLink | null;
  private sendTimer = 0;
  private focusTimer = 0;
  private lastSeq = 0;
  private reqCounter = 0;
  private pending = new Map<number, { action: ActionDef; target: TargetRef }>();
  private holdTarget = '';
  private useHold = 0;
  private drainFactor = 1;
  private drainTimer = 0;
  private hazardTimer = 0;
  private measureTimer = 0;
  private measureRegion = -1;
  private observeTimers = new Map<EntityKind, number>();
  private doorPrev: Uint8Array;
  private lastHostState: HostExport | null = null;
  private lastEntities: EntitySnapshot[] = [];
  private syncRequested = -Infinity;
  private deathSent = false;
  private currentSector: SectorDef = SECTORS[0]!;
  private actor: ActorCtx;

  constructor(opts: SessionOptions) {
    this.seed = opts.seed;
    this.sessionId = opts.sessionId;
    this.self = opts.self;
    this.objective = opts.objective;
    this.link = opts.link;
    this.hostId = opts.hostId;
    this.layout = generateLayout(opts.seed);
    this.world = new WorldState(this.layout);
    this.doorPrev = Uint8Array.from(this.world.doors, (d) => d.pos);
    this.actor = { id: opts.self.id, x: 0, z: 0, region: -1, cardLevel: 0, items: [], hiddenIn: '' };

    const spawn = this.layout.spawn;
    opts.roster.forEach((member, i) => {
      const angle = (i / Math.max(1, opts.roster.length)) * Math.PI * 2;
      const r = opts.roster.length > 1 ? 1.1 : 0;
      const x = spawn.x + Math.sin(angle) * r;
      const z = spawn.z + Math.cos(angle) * r;
      this.players.set(member.id, {
        ...member,
        x,
        y: spawn.y,
        z,
        yaw: angle + Math.PI,
        pitch: 0,
        flags: FLAG_ALIVE,
        noise: 0,
        speed: 0,
        health: 100,
        devices: 0,
        hiddenIn: '',
        activeItem: '',
        status: 'playing',
        connected: true,
        tx: x,
        ty: spawn.y,
        tz: z,
        tyaw: angle + Math.PI,
        lastUpdate: 0,
      });
      if (member.id === opts.self.id) {
        this.motor.teleport(x, spawn.y, z, angle + Math.PI);
        this.inventory.add('lampe');
        for (const item of member.loadout) if (item !== 'lampe') this.inventory.add(item);
      }
    });

    this.world.events.on('op', (op) => this.onOp(op));
    this.sim.events.on('died', ({ source }) => this.onDeath(source));
    this.sim.events.on('hurt', ({ amount, source }) => this.events.emit('hurt', { amount, kind: source }));
    this.sim.events.on('cough', () => this.selfNoise('toux', 10));
    this.sim.events.on('gasp', () => this.selfNoise('souffle', 9));

    if (this.isHost) {
      this.host = new HostAuthority(this);
      this.mission = this.host.missions.snapshot();
    }
  }

  get isHost(): boolean {
    return this.hostId === this.self.id;
  }

  get me(): PlayerRecord {
    return this.players.get(this.self.id)!;
  }

  get sector(): SectorDef {
    return this.currentSector;
  }

  /* ================================================================ */
  /* Boucle                                                            */
  /* ================================================================ */

  update(dt: number, input: FrameInput): void {
    this.time += dt;
    if (this.status === 'playing' && this.sim.alive && !this.result) this.updateLocal(dt, input);
    else this.focus = null;
    this.syncSelfRecord();

    this.sendTimer -= dt;
    if (this.sendTimer <= 0 && this.link) {
      this.sendTimer = SEND_RATE;
      this.link.send(MSG.PLAYER, this.stateMessage());
    }

    this.world.update(dt, this.isHost);
    if (this.host) this.host.update(dt);
    this.interpolate(dt);
  }

  private updateLocal(dt: number, input: FrameInput): void {
    const { motor, sim, inventory, world } = this;
    const grid = world.grid;

    /* Environnement */
    const cell = grid.cellAt(motor.x, motor.z);
    const sectorIdx = cell >= 0 ? this.layout.sectorOf[cell]! : -1;
    if (sectorIdx >= 0) this.currentSector = SECTORS[sectorIdx]!;
    const sector = this.currentSector;
    const region = cell >= 0 ? this.layout.region[cell]! : -1;
    if (region >= 0) this.visited.add(region);
    const powered = world.sectorPowered(sector.id);
    const lamp = inventory.find('lampe');
    const lightOn = lamp?.on === true;

    let contamination = sector.contamination;
    if (sector.id === 'quarantaine' && world.flag('purged')) contamination = 0;
    if (region >= 0 && this.layout.regions[region]!.story === 'souche' && !world.flag('purged')) contamination += 0.3;
    let temperature = sector.temperature;
    if (sector.id === 'experimental' && world.fixture('cryo.experimental')?.on === false) temperature += 7;

    this.perceiveEntities(dt);

    /* Déplacement */
    const frozen = input.frozen || this.hiddenIn !== '';
    motor.update(
      dt,
      input,
      { speedFactor: sim.speedFactor(inventory.encumbrance()), canSprint: sim.canSprint(), canJump: sim.canJump(), frozen },
      grid,
    );
    const ev = motor.events;
    const surface = motor.y < -0.5 && sector.id !== 'noyau' ? 'metal' : sector.surface;
    if (ev.step) this.events.emit('sound', { id: `pas_${surface}`, x: motor.x, y: motor.y, z: motor.z, self: true, volume: motor.crouching ? 0.25 : motor.sprinting ? 1 : 0.6 });
    if (ev.jumped) sim.spend(9);
    if (ev.landed > 3) {
      this.selfNoise(`pas_${surface}`, Math.min(14, ev.landed * 1.4));
      if (ev.landed > 8.5) sim.damage((ev.landed - 8.5) * 9, ev.landed > 11 ? 'fracture' : 'legere', 'chute');
    }

    /* Bruit continu */
    const acoustic = sector.id === 'acoustique' ? 1.8 : 1;
    let noise = movementNoise(motor, SURFACE_NOISE[surface] ?? 1) * acoustic;
    noise = Math.max(noise, input.holdBreath && sim.canHoldBreath() ? 0 : sim.breathNoise);
    if (inventory.find('detecteur_mouvement')?.on) noise = Math.max(noise, 4);
    this.noise = noise;

    /* Physiologie */
    let isolated = false;
    if (this.players.size > 1) {
      isolated = true;
      for (const p of this.players.values()) {
        if (p.id === this.self.id || p.status !== 'playing' || !p.connected) continue;
        if (dist2(p.x, p.z, motor.x, motor.z) < 14 * 14) {
          isolated = false;
          break;
        }
      }
    }
    sim.update(dt, {
      moving: motor.speed > 0.4,
      sprinting: motor.sprinting,
      crouching: motor.crouching,
      encumbrance: inventory.encumbrance(),
      ambientTemp: temperature,
      contamination,
      isolated,
      chased: this.chased,
      seesEntity: this.seesEntity,
      inDark: !powered && !lightOn,
      holdingBreath: input.holdBreath,
      dread: sector.id === 'experimental' ? 0.35 : sector.id === 'noyau' ? 0.5 : 0,
    });

    /* Batteries */
    this.drainTimer -= dt;
    if (this.drainTimer <= 0) this.drainFactor = 1;
    const before = lamp?.on;
    inventory.drain(dt, this.drainFactor);
    if (before && lamp && !lamp.on) this.notice('batterie', 'La lampe est à plat.');

    this.updateHazards(dt, sector, region);
    this.updateFocus(dt, input);
    this.updateItems(dt, input);
    this.updateReadings(dt, sector, region, contamination, temperature);
    this.updateExtraction(dt, region);
  }

  /** Vapeur, purge : dégâts d'environnement. */
  private updateHazards(dt: number, sector: SectorDef, region: number): void {
    this.hazardTimer -= dt;
    if (this.hazardTimer > 0) return;
    this.hazardTimer = 0.5;
    const { world, motor, sim } = this;
    for (const [id, f] of world.fixtures) {
      if (!f.broken || !f.on || !id.startsWith('valve.')) continue;
      const def = world.fixtureDefs.get(id)!;
      if (dist2(def.x, def.z, motor.x, motor.z) < 3.2 * 3.2 && world.grid.sight(def.x, def.z, motor.x, motor.z)) {
        sim.damage(4, 'brulure', 'vapeur');
      }
    }
    const purge = world.fixture('purge.quarantaine');
    if (purge && purge.t > 0 && sector.id === 'quarantaine') sim.damage(7, 'brulure', 'purge thermique');
    void region;
  }

  /* ================================================================ */
  /* Perception des entités                                            */
  /* ================================================================ */

  private perceiveEntities(dt: number): void {
    const { motor, world } = this;
    let chased = false;
    let sees = false;
    let em = 0;
    const meter = this.inventory.find('mesureur')?.on === true;
    for (const e of this.entities.values()) {
      const d = dist(e.x, e.z, motor.x, motor.z);
      if (e.kind === 'statique') em = Math.max(em, clamp(1 - d / 25, 0, 1));
      if (!e.visible || d > 20 || Math.abs(e.y - motor.y) > 3) continue;
      if (!world.grid.sight(motor.x, motor.z, e.x, e.z)) continue;
      if (HUNT_STATES.has(e.state) && d < 16) chased = true;
      const bearing = Math.atan2(e.x - motor.x, e.z - motor.z);
      const inView = Math.abs(angleDelta(motor.yaw, bearing)) < 0.75;
      const visible = e.kind === 'statique' ? meter && d < 8 : inView && d < 18;
      if (!visible) continue;
      if (e.kind !== 'statique') sees = true;
      if (d < 12) {
        const t = (this.observeTimers.get(e.kind) ?? 0) + dt;
        this.observeTimers.set(e.kind, t);
        if (t > 1.5 && t - dt <= 1.5) this.fact({ k: 'observe', kind: e.kind });
      }
    }
    this.chased = chased;
    this.seesEntity = sees;
    this.readout.em = em;
  }

  /* ================================================================ */
  /* Interactions                                                      */
  /* ================================================================ */

  private actorCtx(): ActorCtx {
    const a = this.actor;
    a.x = this.motor.x;
    a.z = this.motor.z;
    a.region = this.world.grid.regionAt(this.motor.x, this.motor.z);
    a.cardLevel = this.inventory.cardLevel();
    a.items.length = 0;
    for (const s of this.inventory.slots) if (s && !a.items.includes(s.id) && (s.id !== 'outils' || s.charge > 0)) a.items.push(s.id);
    a.hiddenIn = this.hiddenIn;
    return a;
  }

  private static key(t: TargetRef): string {
    return t.t === 'door' ? `d${t.id}` : t.t === 'fx' ? `f${t.id}` : `i${t.uid}`;
  }

  /** Cherche ce que le joueur regarde à portée de main. */
  private findTarget(): TargetRef | null {
    const { motor, world } = this;
    if (this.hiddenIn) return { t: 'fx', id: this.hiddenIn };
    const grid = world.grid;
    const eyeY = motor.y + motor.eyeHeight;
    const cp = Math.cos(motor.pitch);
    const fx = Math.sin(motor.yaw) * cp;
    const fy = -Math.sin(motor.pitch);
    const fz = Math.cos(motor.yaw) * cp;
    let best: TargetRef | null = null;
    let bestScore = Infinity;
    const consider = (target: TargetRef, x: number, y: number, z: number, range: number, tolerance: number, needSight: boolean): void => {
      const dx = x - motor.x;
      const dz = z - motor.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > range * range) return;
      const dy = y - eyeY;
      const len = Math.sqrt(d2 + dy * dy) || 1;
      const dot = (dx * fx + dy * fy + dz * fz) / len;
      const angle = Math.acos(clamp(dot, -1, 1));
      if (angle > tolerance) return;
      if (needSight && d2 > 0.6 && !grid.sight(motor.x, motor.z, x, z)) return;
      const score = angle + Math.sqrt(d2) * 0.08;
      if (score < bestScore) {
        bestScore = score;
        best = target;
      }
    };
    const region = grid.regionAt(motor.x, motor.z);
    for (const def of this.layout.doors) {
      if (def.kind === 'arch' || (def.a !== region && def.b !== region)) continue;
      const c = doorCenter(def);
      const base = grid.doorBaseY(def);
      const low = def.kind === 'vent';
      consider({ t: 'door', id: def.id }, c.x, base + (low ? 0.5 : 1.15), c.z, def.kind === 'secret' ? 1.5 : 2.1, low ? 0.75 : 0.6, false);
    }
    for (const it of world.items.values()) {
      if (Math.abs(it.x - motor.x) > 2.2 || Math.abs(it.z - motor.z) > 2.2) continue;
      consider({ t: 'item', uid: it.uid }, it.x, it.y + 0.08, it.z, 2.0, 0.42, true);
    }
    for (const def of this.layout.fixtures) {
      if (def.type === 'camera') continue;
      if (Math.abs(def.x - motor.x) > 3 || Math.abs(def.z - motor.z) > 3) continue;
      const big = def.type === 'generator_main' || def.type === 'generator_aux';
      consider({ t: 'fx', id: def.id }, def.x, def.y + (big ? 0.9 : 1.1), def.z, big ? 2.5 : 2.1, big ? 0.8 : 0.55, false);
    }
    return best;
  }

  private updateFocus(dt: number, input: FrameInput): void {
    this.focusTimer -= dt;
    if (this.focusTimer <= 0 || input.interactPressed) {
      this.focusTimer = FOCUS_RATE;
      const target = input.frozen && !this.hiddenIn ? null : this.findTarget();
      if (!target) this.focus = null;
      else {
        const key = GameSession.key(target);
        const actions = listActions(this.world, target, this.actorCtx());
        if (actions.length === 0) this.focus = null;
        else if (this.focus && GameSession.key(this.focus.target) === key) {
          this.focus.actions = actions;
          this.focus.index = Math.min(this.focus.index, actions.length - 1);
        } else this.focus = { target, title: targetTitle(this.world, target), actions, index: 0, progress: 0 };
      }
    }
    const focus = this.focus;
    if (!focus) {
      this.holdTarget = '';
      return;
    }
    if (input.scroll !== 0 && focus.actions.length > 1 && focus.progress === 0) {
      focus.index = (focus.index + Math.sign(input.scroll) + focus.actions.length) % focus.actions.length;
    }
    const action = focus.actions[focus.index]!;
    const key = `${GameSession.key(focus.target)}:${action.id}`;
    if (input.interactPressed) {
      if (!action.enabled) {
        this.notice('refus', action.reason ?? 'Impossible');
        this.events.emit('sound', { id: 'refus', x: 0, y: 0, z: 0, self: true });
        return;
      }
      if (focus.target.t === 'item') {
        const it = this.world.items.get(focus.target.uid);
        const blocked = it && it.item !== 'document' ? this.inventory.cannotAdd(it.item) : null;
        if (blocked) {
          this.notice('refus', blocked);
          return;
        }
      }
      if (action.duration <= 0) {
        this.request(focus.target, action);
        return;
      }
      this.holdTarget = key;
      focus.progress = 0.001;
    }
    if (this.holdTarget === key && input.interact && focus.progress > 0) {
      focus.progress += dt / action.duration;
      if (focus.progress >= 1) {
        focus.progress = 0;
        this.holdTarget = '';
        this.request(focus.target, action);
      }
    } else if (focus.progress > 0) {
      focus.progress = 0;
      this.holdTarget = '';
    }
  }

  private request(target: TargetRef, action: ActionDef, term?: TerminalCommand): void {
    const msg: RequestMsg = { n: ++this.reqCounter, target, action: action.id, actor: { ...this.actorCtx(), items: this.actor.items.slice() }, term };
    if (this.host) {
      this.applyResult(this.host.handleRequest(this.self.id, msg), action);
      return;
    }
    this.pending.set(msg.n, { action, target });
    this.link?.send(MSG.REQUEST, msg, this.hostId);
  }

  /**
   * Exécute une action sur une cible sans passer par le regard du joueur.
   * Les règles restent celles de `listActions` : une action indisponible est refusée.
   */
  perform(target: TargetRef, actionId: string): boolean {
    const action = listActions(this.world, target, this.actorCtx()).find((a) => a.id === actionId);
    if (!action || !action.enabled) return false;
    this.request(target, action);
    return true;
  }

  /** Commande envoyée depuis l'interface d'un terminal. */
  terminalCommand(terminalId: string, cmd: TerminalCommand): void {
    this.request({ t: 'fx', id: terminalId }, { id: 'term', label: '', duration: 0, noise: 0, enabled: true }, cmd);
  }

  private applyResult(r: ActionResult, action: ActionDef): void {
    if (!r.ok) {
      if (r.reason) this.notice('refus', r.reason);
      return;
    }
    const inv = this.inventory;
    if (r.take) for (const id of r.take) inv.consume(id);
    if (r.wear) {
      const tools = inv.find('outils');
      if (tools) {
        tools.charge = Math.max(0, tools.charge - r.wear);
        inv.revision++;
        if (tools.charge <= 0) {
          inv.remove(tools);
          this.notice('info', 'Les outils sont hors d’usage.');
        }
      }
    }
    if (r.give) {
      for (const g of r.give) {
        if (inv.add(g.item, g.charge > 0 ? g.charge : undefined, g.data)) {
          this.notice('objet', `${itemLabel(g.item, g.data)} récupéré`);
          this.events.emit('sound', { id: 'ramasser', x: 0, y: 0, z: 0, self: true });
        } else this.dropToFloor({ id: g.item, charge: g.charge, data: g.data, on: false }, 0);
      }
    }
    switch (r.effect) {
      case 'heal':
        this.sim.treatAll();
        this.sim.heal(45);
        this.notice('soin', 'Blessures traitées par la station médicale.');
        break;
      case 'hide':
        this.hiddenIn = r.effectData ?? '';
        break;
      case 'unhide':
        this.hiddenIn = '';
        break;
      case 'terminal':
        if (r.effectData) this.events.emit('terminal', r.effectData);
        break;
      case 'document':
        if (r.effectData) {
          this.documents.add(r.effectData);
          this.events.emit('document', r.effectData);
        }
        break;
    }
    void action;
  }

  /* ================================================================ */
  /* Objets tenus                                                      */
  /* ================================================================ */

  private updateItems(dt: number, input: FrameInput): void {
    const inv = this.inventory;
    if (input.frozen) {
      this.useHold = 0;
      return;
    }
    if (input.slot >= 0) inv.select(input.slot);
    else if (input.scroll !== 0 && (!this.focus || this.focus.actions.length <= 1)) inv.cycle(Math.sign(input.scroll));

    if (input.lightPressed) this.toggleItem(inv.find('lampe'));
    if (input.reloadPressed) {
      const fail = inv.reload();
      if (fail) this.notice('refus', fail);
      else {
        this.notice('objet', 'Piles remplacées.');
        this.events.emit('sound', { id: 'recharge', x: 0, y: 0, z: 0, self: true });
      }
    }
    const active = inv.active;
    if (input.dropPressed && active) {
      inv.remove(active);
      this.dropToFloor(active, 0);
    }
    if (input.throwPressed && active) {
      if (this.sim.stamina < 6) this.notice('refus', 'Trop essoufflé pour lancer.');
      else {
        inv.remove(active);
        this.sim.spend(6);
        this.dropToFloor(active, 9);
      }
    }
    if (!active) {
      this.useHold = 0;
      return;
    }
    const def = itemDef(active.id);
    if (def.use === 'toggle' && input.usePressed) this.toggleItem(active);
    else if (def.use === 'deploy' && input.usePressed) this.deploy(active);
    else if (def.use === 'consume') {
      // Usage maintenu : relâcher annule.
      const duration = active.id === 'medkit' ? 3 : 2;
      if (input.use) {
        if (this.useHold === 0 && !this.canConsume(active)) return;
        this.useHold += dt / duration;
        if (this.useHold >= 1) {
          this.useHold = 0;
          this.consume(active);
        }
      } else this.useHold = 0;
    } else if (active.id === 'piles' && input.usePressed) {
      // Recharge l'appareil le plus déchargé.
      let worst: InvItem | null = null;
      for (const s of inv.slots) if (s && itemDef(s.id).rechargeable && (!worst || s.charge < worst.charge)) worst = s;
      if (worst && worst.charge < itemDef(worst.id).maxCharge - 1 && inv.spendCharge('piles')) {
        worst.charge = itemDef(worst.id).maxCharge;
        this.notice('objet', `${itemDef(worst.id).name} rechargé.`);
        this.events.emit('sound', { id: 'recharge', x: 0, y: 0, z: 0, self: true });
      } else this.notice('refus', 'Aucun appareil à recharger.');
    } else if (input.usePressed && def.use === 'passive' && active.id !== 'piles') {
      this.notice('info', "S'utilise sur une machine ou une porte.");
    }
  }

  /** Avancement de l'usage maintenu (soin, injection), 0 à 1. */
  get useProgress(): number {
    return this.useHold;
  }

  private toggleItem(item: InvItem | null): void {
    if (!item) return;
    if (!item.on && item.charge <= 0) {
      this.notice('refus', 'Batterie vide.');
      return;
    }
    item.on = !item.on;
    this.inventory.revision++;
    this.events.emit('sound', { id: 'clic_lampe', x: 0, y: 0, z: 0, self: true });
  }

  private canConsume(item: InvItem): boolean {
    if (item.id === 'medkit' && this.sim.health >= 99 && !this.sim.injuries.some((i) => !i.treated)) {
      this.notice('refus', 'Aucune blessure à soigner.');
      return false;
    }
    if (item.id === 'serum' && this.sim.infection < 1) {
      this.notice('refus', "Aucune infection à traiter.");
      return false;
    }
    return true;
  }

  private consume(item: InvItem): void {
    if (item.id === 'medkit') {
      const treated = this.sim.treatWorst();
      this.sim.heal(28);
      this.inventory.spendCharge('medkit');
      this.notice('soin', treated ? 'Blessure traitée.' : 'Soins appliqués.');
    } else if (item.id === 'serum') {
      this.sim.cureInfection();
      this.inventory.spendCharge('serum');
      this.notice('soin', 'Infection éliminée.');
    }
    this.events.emit('sound', { id: 'soin', x: 0, y: 0, z: 0, self: true });
  }

  private deploy(item: InvItem): void {
    const { motor, world } = this;
    if (item.id === 'marqueurs') {
      if (!this.inventory.spendCharge('marqueurs')) return;
      this.fact({ k: 'marker', x: motor.x + Math.sin(motor.yaw) * 0.4, y: motor.y + 0.03, z: motor.z + Math.cos(motor.yaw) * 0.4 });
      this.events.emit('sound', { id: 'marqueur', x: 0, y: 0, z: 0, self: true });
      return;
    }
    if (item.id === 'camera') {
      const x = motor.x + Math.sin(motor.yaw) * 0.7;
      const z = motor.z + Math.cos(motor.yaw) * 0.7;
      if (!world.grid.walkable(x, z) || !world.grid.sight(motor.x, motor.z, x, z)) {
        this.notice('refus', 'Pas la place de poser la caméra ici.');
        return;
      }
      this.inventory.remove(item);
      this.fact({ k: 'camera', x, y: world.grid.heightAt(x, z) + 0.35, z, yaw: motor.yaw });
      this.notice('objet', 'Caméra posée. Consultable depuis la carte et les terminaux.');
    }
  }

  /**
   * Dépose (force 0) ou lance un objet. Le point de chute est calculé en avançant
   * jusqu'au premier obstacle ; un objet lancé fait du bruit là où il retombe.
   */
  private dropToFloor(item: InvItem, force: number): void {
    const { motor, world } = this;
    const grid = world.grid;
    let x = motor.x;
    let z = motor.z;
    if (force > 0) {
      const reach = force * Math.max(0.35, Math.cos(motor.pitch));
      const dx = Math.sin(motor.yaw);
      const dz = Math.cos(motor.yaw);
      for (let d = 0.5; d <= reach; d += 0.5) {
        const nx = motor.x + dx * d;
        const nz = motor.z + dz * d;
        if (!grid.walkable(nx, nz) || !grid.sight(x, z, nx, nz)) break;
        const r = grid.resolve(nx, nz, 0.12, grid.heightAt(nx, nz), 1.2);
        if (r.hit) break;
        x = nx;
        z = nz;
      }
    } else {
      x += Math.sin(motor.yaw) * 0.45;
      z += Math.cos(motor.yaw) * 0.45;
      if (!grid.walkable(x, z) || !grid.sight(motor.x, motor.z, x, z)) {
        x = motor.x;
        z = motor.z;
      }
    }
    const noise = force > 0 ? 6 + itemDef(item.id).weight * 5 : 2;
    this.fact({ k: 'drop', item: item.id, charge: item.charge, data: item.data, x, y: grid.heightAt(x, z) + 0.02, z, noise });
    this.events.emit('sound', { id: force > 0 ? 'impact' : 'poser', x, y: grid.heightAt(x, z), z });
  }

  /* ================================================================ */
  /* Relevés, extraction, mort                                         */
  /* ================================================================ */

  private updateReadings(dt: number, sector: SectorDef, region: number, contamination: number, temperature: number): void {
    this.readout.temperature = temperature;
    this.readout.contamination = contamination;
    const meter = this.inventory.find('mesureur');
    if (!meter?.on || region < 0) {
      this.measureTimer = 0;
      return;
    }
    if (region !== this.measureRegion) {
      this.measureRegion = region;
      this.measureTimer = 0;
    }
    // Trois secondes dans une même salle, appareil allumé : relevé enregistré.
    if (this.measureTimer >= 0 && this.layout.regions[region]!.kind === 'room') {
      this.measureTimer += dt;
      if (this.measureTimer >= 3) {
        this.measureTimer = -1;
        this.fact({ k: 'measure', region });
        this.notice('info', `Relevé enregistré — ${sector.name}.`);
        this.events.emit('sound', { id: 'bip', x: 0, y: 0, z: 0, self: true });
      }
    }
  }

  private updateExtraction(dt: number, region: number): void {
    if (this.world.flag('airlock') !== 2 || region !== this.layout.extraction.region) {
      this.extractProgress = 0;
      return;
    }
    this.extractProgress += dt / 2.5;
    if (this.extractProgress >= 1) {
      this.extractProgress = 0;
      this.setStatus('extracted');
      this.fact({ k: 'extracted' });
    }
  }

  private onDeath(cause: string): void {
    if (this.deathSent) return;
    this.deathSent = true;
    // Le contenu de l'inventaire reste sur place : l'équipe peut le récupérer.
    for (const s of this.inventory.slots) if (s) this.dropToFloor({ ...s, on: false }, 0);
    this.inventory.clear();
    if (this.hiddenIn) this.fact({ k: 'leave', locker: this.hiddenIn });
    this.hiddenIn = '';
    this.setStatus('dead');
    this.fact({ k: 'died', cause });
  }

  private setStatus(status: PlayerStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.me.status = status;
    this.focus = null;
    this.events.emit('status', status);
  }

  /* ================================================================ */
  /* Réseau : émission                                                 */
  /* ================================================================ */

  broadcast(t: string, d: unknown): void {
    this.link?.send(t, d);
  }

  /** Hôte : message destiné à un joueur précis (ou traité localement si c'est lui). */
  sendTo(id: string, t: string, d: unknown): void {
    if (id === this.self.id) this.dispatch(t, d, this.self.id);
    else this.link?.send(t, d, id);
  }

  broadcastNotice(n: { kind: string; text: string }): void {
    this.broadcast(MSG.NOTICE, n);
    this.notice(n.kind, n.text);
  }

  private fact(f: FactMsg): void {
    if (this.host) this.host.handleFact(this.self.id, f);
    else this.link?.send(MSG.FACT, f, this.hostId);
  }

  private selfNoise(sound: string, radius: number): void {
    this.events.emit('sound', { id: sound, x: this.motor.x, y: this.motor.y, z: this.motor.z, self: true });
    this.fact({ k: 'noise', x: this.motor.x, z: this.motor.z, r: radius });
  }

  private deviceCount(): number {
    let n = 0;
    for (const s of this.inventory.slots) if (s && s.on) n++;
    return n;
  }

  private stateMessage(): PlayerStateMsg {
    const m = this.motor;
    let f = 0;
    if (m.crouching) f |= FLAG_CROUCH;
    if (this.inventory.find('lampe')?.on) f |= FLAG_LIGHT;
    if (m.sprinting) f |= FLAG_SPRINT;
    if (this.sim.alive) f |= FLAG_ALIVE;
    if (this.inventory.find('radio')?.on) f |= FLAG_RADIO;
    if (this.status === 'extracted') f |= FLAG_EXTRACTED;
    const r = (v: number): number => Math.round(v * 100) / 100;
    return {
      p: [r(m.x), r(m.y), r(m.z)],
      r: [r(m.yaw), r(m.pitch)],
      f,
      n: Math.round(this.noise * 10) / 10,
      s: r(m.speed),
      h: Math.round(this.sim.health),
      d: this.deviceCount(),
      k: this.hiddenIn,
      a: this.inventory.active?.id ?? '',
    };
  }

  private syncSelfRecord(): void {
    const me = this.me;
    const msg = this.stateMessage();
    me.x = me.tx = msg.p[0];
    me.y = me.ty = msg.p[1];
    me.z = me.tz = msg.p[2];
    me.yaw = me.tyaw = this.motor.yaw;
    me.pitch = this.motor.pitch;
    me.flags = msg.f;
    me.noise = this.noise;
    me.speed = this.motor.speed;
    me.health = this.sim.health;
    me.devices = msg.d;
    me.hiddenIn = this.hiddenIn;
    me.activeItem = msg.a;
    me.lastUpdate = this.time;
  }

  /* ---------------- discussion ---------------- */

  /** Portée radio : relais actif = tout le complexe ; sinon 45 m. Les serveurs brouillent. */
  private radioQuality(x: number, z: number): number {
    const relay = this.world.fixture('antenna.accueil')?.on === true;
    const d = dist(x, z, this.motor.x, this.motor.z);
    if (!relay && d > 45) return 0;
    const cell = this.world.grid.cellAt(x, z);
    const far = cell >= 0 && SECTORS[this.layout.sectorOf[cell]!]?.id === 'serveurs';
    return far || this.currentSector.id === 'serveurs' ? 0.55 : 1;
  }

  sendChat(ch: 'prox' | 'radio', text: string): string | null {
    text = text.trim().slice(0, 160);
    if (!text) return null;
    if (ch === 'radio' && !this.inventory.find('radio')?.on) return 'Radio éteinte ou absente.';
    const msg: ChatMsg = { ch, name: this.self.name, text, x: this.motor.x, z: this.motor.z };
    this.broadcast(MSG.CHAT, msg);
    this.pushChat({ ch, name: this.self.name, text, flagged: false });
    return null;
  }

  receiveChat(msg: ChatMsg): void {
    let text = msg.text;
    if (msg.ch === 'prox') {
      const d = dist(msg.x, msg.z, this.motor.x, this.motor.z);
      if (d > 16 || this.world.grid.soundOcclusion(msg.x, msg.z, this.motor.x, this.motor.z) >= 2) return;
    } else {
      if (!this.inventory.find('radio')?.on) return;
      const q = this.radioQuality(msg.x, msg.z);
      if (q <= 0) return;
      if (q < 1) text = garble(text, this.time);
    }
    const flagged = msg.fake === true && this.inventory.find('detecteur_sonore')?.on === true;
    this.pushChat({ ch: msg.ch, name: msg.name, text, flagged });
  }

  private pushChat(line: ChatLine): void {
    this.chat.push(line);
    if (this.chat.length > 60) this.chat.shift();
    this.events.emit('chat', line);
  }

  notice(kind: string, text: string): void {
    this.events.emit('notice', { kind, text });
  }

  /* ================================================================ */
  /* Réseau : réception                                                */
  /* ================================================================ */

  /** Point d'entrée des messages réseau (branché sur l'événement `message` du salon). */
  receive(m: NetMessage): void {
    this.dispatch(m.t, m.d, m.f);
  }

  private dispatch(t: string, d: unknown, from: string): void {
    switch (t) {
      case MSG.PLAYER:
        this.onPlayerState(from, d as PlayerStateMsg);
        break;
      case MSG.OPS: {
        if (from !== this.hostId || this.host) break;
        const msg = d as OpsMsg;
        if (msg.seq <= this.lastSeq) break;
        if (msg.seq !== this.lastSeq + 1) {
          this.requestSync();
          break;
        }
        this.lastSeq = msg.seq;
        for (const op of msg.ops) this.world.apply(op);
        break;
      }
      case MSG.ENTITIES:
        if (from === this.hostId && !this.host) this.applyEntities(d as EntitySnapshot[]);
        break;
      case MSG.MISSION:
        if (from === this.hostId && !this.host) this.mission = d as MissionSnapshot;
        break;
      case MSG.HOST_STATE: {
        if (from !== this.hostId || this.host) break;
        const msg = d as { seq: number; mission: HostExport };
        this.lastHostState = msg.mission;
        if (msg.seq > this.lastSeq) this.requestSync();
        break;
      }
      case MSG.REQUEST:
        if (this.host) {
          const msg = d as RequestMsg;
          this.link?.send(MSG.RESPONSE, { n: msg.n, r: this.host.handleRequest(from, msg) } satisfies ResponseMsg, from);
        }
        break;
      case MSG.RESPONSE: {
        const msg = d as ResponseMsg;
        const pending = this.pending.get(msg.n);
        if (pending) {
          this.pending.delete(msg.n);
          this.applyResult(msg.r, pending.action);
        }
        break;
      }
      case MSG.FACT:
        if (this.host) this.host.handleFact(from, d as FactMsg);
        break;
      case MSG.DAMAGE: {
        if (from !== this.hostId) break;
        const msg = d as DamageMsg;
        if (this.status === 'playing') {
          // Arraché à sa cachette.
          if (this.hiddenIn) {
            this.fact({ k: 'leave', locker: this.hiddenIn });
            this.hiddenIn = '';
          }
          this.sim.damage(msg.amount, msg.injury as InjuryType, msg.kind);
        }
        break;
      }
      case MSG.EFFECT: {
        if (from !== this.hostId) break;
        const msg = d as EffectMsg;
        if (msg.type === 'infect') this.sim.infection = Math.min(100, this.sim.infection + msg.v);
        else if (msg.type === 'stress') this.sim.addStress(msg.v);
        else {
          this.drainFactor = msg.v;
          this.drainTimer = 1;
        }
        break;
      }
      case MSG.FX:
        if (from === this.hostId && !this.host) this.receiveFx(d as FxMsg);
        break;
      case MSG.NOTICE: {
        if (from !== this.hostId) break;
        const n = d as Partial<WorldNotice> & { kind: string; text: string };
        if ('noise' in n) this.receiveNotice(n as WorldNotice);
        else this.notice(n.kind, n.text);
        break;
      }
      case MSG.CHAT: {
        const msg = d as ChatMsg;
        // Seul l'hôte peut relayer une imitation ; un client ne peut pas en forger.
        if (msg.fake && from !== this.hostId) break;
        this.receiveChat(msg);
        break;
      }
      case MSG.SYNC_REQUEST:
        if (this.host) this.link?.send(MSG.SYNC, this.host.buildSync(), from);
        break;
      case MSG.SYNC:
        if (from === this.hostId && !this.host) this.applySync(d as SyncMsg);
        break;
      case MSG.RESULT:
        if (from === this.hostId && !this.host) this.receiveResult(d as ExpeditionResult);
        break;
    }
  }

  private onPlayerState(from: string, s: PlayerStateMsg): void {
    const p = this.players.get(from);
    if (!p || from === this.self.id) return;
    p.tx = s.p[0];
    p.ty = s.p[1];
    p.tz = s.p[2];
    p.tyaw = s.r[0];
    p.pitch = s.r[1];
    if (!p.connected || dist2(p.x, p.z, p.tx, p.tz) > 36) {
      // Reprise après coupure ou téléportation : pas d'interpolation.
      p.x = p.tx;
      p.y = p.ty;
      p.z = p.tz;
      p.yaw = p.tyaw;
    }
    p.flags = s.f;
    p.noise = s.n;
    p.speed = s.s;
    p.health = s.h;
    p.devices = s.d;
    p.activeItem = s.a;
    // L'hôte reste maître de l'état « caché » et du statut ; les clients suivent l'annonce.
    if (!this.host) {
      p.hiddenIn = s.k;
      p.status = s.f & FLAG_EXTRACTED ? 'extracted' : s.f & FLAG_ALIVE ? 'playing' : 'dead';
    }
    p.connected = true;
    p.lastUpdate = this.time;
  }

  applyEntities(snaps: EntitySnapshot[]): void {
    this.lastEntities = snaps;
    const seen = new Set<number>();
    for (const s of snaps) {
      seen.add(s.uid);
      const e = this.entities.get(s.uid);
      if (!e) {
        this.entities.set(s.uid, { ...s, tx: s.x, ty: s.y, tz: s.z, tyaw: s.yaw });
        continue;
      }
      // Réapparition ailleurs : pas de glissement à travers la carte.
      const jump = dist2(e.x, e.z, s.x, s.z) > 25 || (!e.visible && s.visible);
      e.tx = s.x;
      e.ty = s.y;
      e.tz = s.z;
      e.tyaw = s.yaw;
      e.state = s.state;
      e.anim = s.anim;
      e.visible = s.visible;
      if (jump) {
        e.x = s.x;
        e.y = s.y;
        e.z = s.z;
        e.yaw = s.yaw;
      }
    }
    for (const uid of Array.from(this.entities.keys())) if (!seen.has(uid)) this.entities.delete(uid);
  }

  /** Interpolation des joueurs distants et des entités vers leur dernière position connue. */
  private interpolate(dt: number): void {
    const k = Math.min(1, dt * 12);
    for (const p of this.players.values()) {
      if (p.id === this.self.id) continue;
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
      p.z += (p.tz - p.z) * k;
      p.yaw = lerpAngle(p.yaw, p.tyaw, k);
      if (p.connected && this.time - p.lastUpdate > 6) p.connected = false;
    }
    for (const e of this.entities.values()) {
      e.x += (e.tx - e.x) * k;
      e.y += (e.ty - e.y) * k;
      e.z += (e.tz - e.z) * k;
      e.yaw = lerpAngle(e.yaw, e.tyaw, k);
    }
  }

  /** Demande l'état complet à l'hôte (désynchronisation, reconnexion, arrivée tardive). */
  requestSync(): void {
    if (this.host || this.time - this.syncRequested < 1.5) return;
    this.syncRequested = this.time;
    this.link?.send(MSG.SYNC_REQUEST, null, this.hostId);
  }

  private applySync(s: SyncMsg): void {
    this.world.load(s.world);
    this.lastSeq = s.seq;
    this.mission = s.mission;
    this.applyEntities(s.entities);
    for (const [id, st] of Object.entries(s.players)) {
      const p = this.players.get(id);
      if (!p || id === this.self.id) continue;
      p.x = p.tx = st.x;
      p.y = p.ty = st.y;
      p.z = p.tz = st.z;
      p.status = st.status;
    }
    // Arrivée en cours de partie (rechargement de page) : on reprend là où l'hôte nous avait vu.
    const mine = s.players[this.self.id];
    if (mine && this.time < 4) this.restoreSelf(mine.x, mine.y, mine.z, mine.status);
  }

  /** Reprise après rechargement de page : l'hôte indique où le personnage se trouvait. */
  restoreSelf(x: number, y: number, z: number, status: PlayerStatus): void {
    this.motor.teleport(x, y, z);
    if (status !== 'playing') {
      this.deathSent = true;
      this.setStatus(status);
    }
  }

  receiveFx(msg: FxMsg): void {
    this.events.emit('fx', msg);
  }

  receiveNotice(n: WorldNotice): void {
    // Les annonces portent partout ; les pannes ne sont signalées qu'aux joueurs du secteur ou à portée de radio.
    const here = n.sector === null || n.sector === this.currentSector.id;
    if (n.text && (here || this.inventory.find('radio')?.on)) this.notice(n.kind, n.text);
    if (n.kind !== 'eclairage') this.events.emit('sound', { id: `evt_${n.kind}`, x: n.x, y: this.motor.y, z: n.z, self: n.sector === null });
  }

  receiveResult(r: ExpeditionResult): void {
    if (this.result) return;
    this.result = r;
    this.events.emit('ended', r);
  }

  /* ---------------- hôte ---------------- */

  /** Le salon a désigné un nouvel hôte. */
  setHost(id: string): void {
    if (id === this.hostId) return;
    this.hostId = id;
    this.pending.clear();
    this.events.emit('host', id);
    if (id === this.self.id && !this.host && !this.result) {
      // Reprise d'autorité à partir du dernier état reçu.
      this.host = new HostAuthority(this, { entities: this.lastEntities, mission: this.lastHostState, seq: this.lastSeq });
      this.mission = this.host.missions.snapshot();
      this.notice('info', "Vous êtes désormais l'hôte de l'expédition.");
    } else if (id !== this.self.id) {
      this.host = null;
      this.requestSync();
    }
  }

  /** Un joueur a quitté le salon ou ne répond plus. */
  setConnected(id: string, connected: boolean): void {
    const p = this.players.get(id);
    if (p && p.id !== this.self.id) p.connected = connected;
  }

  /** Abandon volontaire : l'hôte clôt l'expédition si plus personne ne joue. */
  abandon(): void {
    if (this.status === 'playing') {
      this.deathSent = true;
      this.setStatus('dead');
      this.fact({ k: 'died', cause: 'abandon' });
    }
  }

  /* ---------------- sons déduits des opérations sur le monde ---------------- */

  private onOp(op: WorldOp): void {
    this.events.emit('op', op);
    if (op.k === 'door') {
      const prev = this.doorPrev[op.id]!;
      this.doorPrev[op.id] = op.s.pos;
      if (prev === op.s.pos) return;
      const def = this.layout.doors[op.id]!;
      const c = doorCenter(def);
      const y = this.world.grid.doorBaseY(def) + 1;
      const opening = op.s.pos === DOOR_OPEN;
      const id = def.kind === 'gate' || def.kind === 'elevator' ? (opening ? 'sas_ouvre' : 'sas_ferme') : def.kind === 'vent' ? 'grille' : opening ? 'porte_ouvre' : 'porte_ferme';
      this.events.emit('sound', { id, x: c.x, y, z: c.z });
    } else if (op.k === 'fx') {
      const def = this.world.fixtureDefs.get(op.id);
      if (def && def.type !== 'locker') this.events.emit('sound', { id: 'machine', x: def.x, y: def.y + 1, z: def.z });
    }
  }

  /** Cellule sous les pieds : utile à la vue (conduits, escaliers). */
  cellKind(): number {
    const c = this.world.grid.cellAt(this.motor.x, this.motor.z);
    return c >= 0 ? this.layout.kind[c]! : CellKind.Void;
  }
}

/** Brouille une partie des caractères (interférences radio). */
function garble(text: string, seed: number): string {
  let out = '';
  let h = Math.floor(seed * 1000) | 0;
  for (const ch of text) {
    h = (Math.imul(h, 1103515245) + 12345) | 0;
    out += ch !== ' ' && ((h >>> 16) & 7) < 3 ? '░' : ch;
  }
  return out;
}

export { INTERACT_RANGE };
