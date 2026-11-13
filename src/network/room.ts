/**
 * Salon multijoueur : présence, états des joueurs, réglages du lobby, lancement
 * de la partie, élection d'un nouvel hôte et reconnexion.
 *
 * Le protocole repose uniquement sur des messages diffusés (`RoomChannel`) :
 * il fonctionne à l'identique sur Supabase Realtime, entre onglets et en test.
 */
import { EventBus } from '../core/events';
import { randomSeedString } from '../core/rng';
import { generateRoomCode, type ChannelStatus, type NetMessage, type RoomChannel, type RoomInfo, type Transport } from './transport';

export type PlayerNetState = 'connected' | 'ready' | 'loading' | 'playing' | 'dead' | 'disconnected' | 'extracted';

export interface Identity {
  id: string;
  name: string;
  title: string;
  /** Couleur de la tenue (hex). */
  color: string;
}

export interface Member extends Identity {
  state: PlayerNetState;
  loadout: string[];
  joinedAt: number;
  lastSeen: number;
}

export interface LobbySettings {
  name: string;
  seed: string;
  isPublic: boolean;
  maxPlayers: number;
  /** Identifiant d'objectif principal imposé, ou '' pour un tirage par la graine. */
  objective: string;
}

export interface StartPayload {
  sessionId: string;
  seed: string;
  objective: string;
  hostId: string;
  roster: (Identity & { loadout: string[] })[];
}

export interface RoomEvents {
  members: Member[];
  host: string;
  settings: LobbySettings;
  start: StartPayload;
  /** Tous les joueurs ont chargé (ou le délai est écoulé) : la partie commence. */
  go: null;
  status: ChannelStatus;
  /** Le salon n'est plus accessible (complet, fermé, expulsion). */
  closed: string;
  /** Message applicatif (jeu, discussion, voix) relayé tel quel. */
  message: NetMessage;
}

export const HEARTBEAT_MS = 2000;
export const TIMEOUT_MS = 7000;
/** Un joueur déconnecté garde sa place pendant ce délai. */
export const RECONNECT_GRACE_MS = 90_000;
/** Délai maximal d'attente des joueurs en chargement. */
export const LOADING_TIMEOUT_MS = 30_000;
export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 6;

interface HeartbeatData {
  m: Omit<Member, 'lastSeen'>;
  host: string;
  epoch: number;
  phase: RoomSession['phase'];
}

export class RoomSession {
  readonly members = new Map<string, Member>();
  readonly events = new EventBus<RoomEvents>();
  hostId: string;
  hostEpoch = 0;
  settings: LobbySettings;
  phase: 'lobby' | 'loading' | 'playing' = 'lobby';
  status: ChannelStatus = 'connected';
  startPayload: StartPayload | null = null;
  private lastBeat = -Infinity;
  private lastRegistry = -Infinity;
  private loadingSince = 0;
  private closed = false;
  /** Tant que l'hôte n'a pas accepté l'entrée, on ne s'annonce pas aux autres membres. */
  private accepted = true;
  /** Raison du refus ou de la fermeture, le cas échéant. */
  closedReason: string | null = null;

  private constructor(
    readonly transport: Transport,
    readonly channel: RoomChannel,
    readonly self: Identity,
    settings: LobbySettings,
    hostId: string,
    private now: () => number,
  ) {
    this.settings = settings;
    this.hostId = hostId;
    this.members.set(self.id, { ...self, state: 'connected', loadout: ['lampe'], joinedAt: now(), lastSeen: now() });
    channel.onMessage = (m) => this.receive(m);
    channel.onStatus = (s) => this.onStatus(s);
  }

  /* ---------------- création / entrée ---------------- */

  static async create(transport: Transport, self: Identity, settings: Partial<LobbySettings>, now: () => number = Date.now): Promise<RoomSession> {
    let code = generateRoomCode();
    for (let i = 0; i < 5 && (await transport.getRoom(code)); i++) code = generateRoomCode();
    const full: LobbySettings = {
      name: settings.name?.trim() || `Expédition de ${self.name}`,
      seed: settings.seed?.trim() || randomSeedString(),
      isPublic: settings.isPublic ?? true,
      maxPlayers: Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, settings.maxPlayers ?? MAX_PLAYERS)),
      objective: settings.objective ?? '',
    };
    const info: RoomInfo = {
      code,
      name: full.name,
      hostId: self.id,
      hostName: self.name,
      players: 1,
      maxPlayers: full.maxPlayers,
      status: 'lobby',
      isPublic: full.isPublic,
      createdAt: now(),
      updatedAt: now(),
    };
    await transport.createRoom(info);
    const channel = await transport.open(code, self.id);
    return new RoomSession(transport, channel, self, full, self.id, now);
  }

  static async join(transport: Transport, code: string, self: Identity, now: () => number = Date.now): Promise<RoomSession> {
    code = code.trim().toUpperCase();
    const info = await transport.getRoom(code);
    if (!info) throw new Error('Salon introuvable ou expiré.');
    const channel = await transport.open(code, self.id);
    const settings: LobbySettings = { name: info.name, seed: '', isPublic: info.isPublic, maxPlayers: info.maxPlayers, objective: '' };
    const room = new RoomSession(transport, channel, self, settings, info.hostId, now);
    room.accepted = false;
    room.hello();
    return room;
  }

  get code(): string {
    return this.channel.code;
  }

  get isHost(): boolean {
    return this.hostId === this.self.id;
  }

  get me(): Member {
    return this.members.get(this.self.id)!;
  }

  list(): Member[] {
    return Array.from(this.members.values()).sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
  }

  /* ---------------- actions locales ---------------- */

  private hello(): void {
    this.channel.send('hello', this.beatData());
  }

  private beatData(): HeartbeatData {
    const { lastSeen: _ignored, ...m } = this.me;
    void _ignored;
    return { m, host: this.hostId, epoch: this.hostEpoch, phase: this.phase };
  }

  private beat(): void {
    this.lastBeat = this.now();
    this.me.lastSeen = this.lastBeat;
    // Entrée pas encore acceptée : on redemande au lieu de s'annoncer.
    this.channel.send(this.accepted ? 'hb' : 'hello', this.beatData());
  }

  setState(state: PlayerNetState): void {
    if (this.me.state === state) return;
    this.me.state = state;
    this.beat();
    this.emitMembers();
    if (this.isHost) this.checkLoaded();
  }

  setReady(ready: boolean): void {
    if (this.phase === 'lobby') this.setState(ready ? 'ready' : 'connected');
  }

  setLoadout(loadout: string[]): void {
    this.me.loadout = loadout.slice();
    this.beat();
    this.emitMembers();
  }

  updateSettings(patch: Partial<LobbySettings>): void {
    if (!this.isHost || this.phase !== 'lobby') return;
    this.settings = { ...this.settings, ...patch };
    this.settings.maxPlayers = Math.min(MAX_PLAYERS, Math.max(this.members.size, this.settings.maxPlayers));
    this.broadcastLobby();
    this.events.emit('settings', this.settings);
    void this.transport.updateRoom(this.code, { name: this.settings.name, isPublic: this.settings.isPublic, maxPlayers: this.settings.maxPlayers });
  }

  /** Tous les membres connectés sont-ils prêts ? (l'hôte l'est implicitement) */
  everyoneReady(): boolean {
    for (const m of this.members.values()) {
      if (m.id === this.hostId || m.state === 'disconnected') continue;
      if (m.state !== 'ready') return false;
    }
    return true;
  }

  /** Hôte : lance le chargement de l'expédition chez tous les joueurs. */
  start(sessionId: string): StartPayload | null {
    if (!this.isHost || this.phase !== 'lobby' || !this.everyoneReady()) return null;
    const roster = this.list()
      .filter((m) => m.state !== 'disconnected')
      .map((m) => ({ id: m.id, name: m.name, title: m.title, color: m.color, loadout: m.loadout }));
    const payload: StartPayload = { sessionId, seed: this.settings.seed, objective: this.settings.objective, hostId: this.self.id, roster };
    this.channel.send('start', payload);
    this.beginLoading(payload);
    void this.transport.updateRoom(this.code, { status: 'playing' });
    return payload;
  }

  private beginLoading(payload: StartPayload): void {
    this.startPayload = payload;
    this.phase = 'loading';
    this.loadingSince = this.now();
    this.me.state = 'loading';
    this.beat();
    this.events.emit('start', payload);
    this.emitMembers();
  }

  /** Le client local a fini de charger la carte. */
  markLoaded(): void {
    this.setState('playing');
  }

  private checkLoaded(): void {
    if (this.phase !== 'loading') return;
    const waiting = Array.from(this.members.values()).some((m) => m.state === 'loading');
    const timedOut = this.now() - this.loadingSince > LOADING_TIMEOUT_MS;
    if (waiting && !timedOut) return;
    // Un joueur bloqué en chargement ne retient pas les autres : il rejoindra par synchronisation complète.
    this.phase = 'playing';
    this.channel.send('go', null);
    this.events.emit('go', null);
  }

  /** Retour au lobby après une expédition. */
  backToLobby(): void {
    this.phase = 'lobby';
    this.startPayload = null;
    this.me.state = 'connected';
    if (this.isHost) {
      this.settings = { ...this.settings, seed: randomSeedString() };
      this.broadcastLobby();
      void this.transport.updateRoom(this.code, { status: 'lobby' });
    }
    this.beat();
    this.emitMembers();
    this.events.emit('settings', this.settings);
  }

  send(t: string, d: unknown, to?: string): void {
    if (!this.closed) this.channel.send(t, d, to);
  }

  leave(): void {
    if (this.closed) return;
    this.closed = true;
    this.channel.send('bye', null);
    const remaining = this.members.size - 1;
    if (remaining <= 0) void this.transport.removeRoom(this.code);
    this.channel.close();
  }

  /* ---------------- boucle ---------------- */

  /** À appeler régulièrement (au moins deux fois par seconde). */
  tick(): void {
    if (this.closed) return;
    const now = this.now();
    if (now - this.lastBeat >= HEARTBEAT_MS) this.beat();
    let changed = false;
    for (const m of Array.from(this.members.values())) {
      if (m.id === this.self.id) continue;
      const silent = now - m.lastSeen;
      if (silent > RECONNECT_GRACE_MS) {
        this.members.delete(m.id);
        changed = true;
      } else if (silent > TIMEOUT_MS && m.state !== 'disconnected') {
        m.state = 'disconnected';
        changed = true;
      }
    }
    if (changed) this.emitMembers();
    this.electHost();
    if (this.isHost) {
      this.checkLoaded();
      if (now - this.lastRegistry > 10_000) {
        this.lastRegistry = now;
        const players = Array.from(this.members.values()).filter((m) => m.state !== 'disconnected').length;
        void this.transport.updateRoom(this.code, { players, hostId: this.self.id, hostName: this.self.name, updatedAt: now });
      }
    }
  }

  /** Si l'hôte a disparu, le membre connecté le plus ancien prend le relais. */
  private electHost(): void {
    if (this.status !== 'connected') return;
    const host = this.members.get(this.hostId);
    if (host && host.state !== 'disconnected') return;
    let best: Member | null = null;
    for (const m of this.members.values()) {
      if (m.state === 'disconnected') continue;
      if (!best || m.joinedAt < best.joinedAt || (m.joinedAt === best.joinedAt && m.id < best.id)) best = m;
    }
    if (!best || best.id !== this.self.id) return;
    this.hostId = this.self.id;
    this.hostEpoch++;
    this.channel.send('host', { id: this.self.id, epoch: this.hostEpoch });
    this.events.emit('host', this.hostId);
    this.broadcastLobby();
    this.lastRegistry = -Infinity;
  }

  private broadcastLobby(to?: string): void {
    this.channel.send('lobby', { settings: this.settings, host: this.hostId, epoch: this.hostEpoch, phase: this.phase, start: this.startPayload }, to);
  }

  private emitMembers(): void {
    this.events.emit('members', this.list());
  }

  private onStatus(s: ChannelStatus): void {
    const previous = this.status;
    this.status = s;
    this.events.emit('status', s);
    if (s === 'connected' && previous === 'reconnecting') {
      // Reconnexion : on se réannonce pour récupérer l'état du salon.
      this.me.lastSeen = this.now();
      for (const m of this.members.values()) m.lastSeen = this.now();
      this.hello();
    }
  }

  /* ---------------- réception ---------------- */

  /** Règle de préséance : l'époque la plus haute l'emporte ; à égalité, le plus petit identifiant. */
  private adoptHost(id: string, epoch: number): void {
    if (epoch < this.hostEpoch) return;
    if (epoch === this.hostEpoch && id >= this.hostId) return;
    this.hostEpoch = epoch;
    if (this.hostId !== id) {
      this.hostId = id;
      this.events.emit('host', id);
    }
  }

  private upsert(data: HeartbeatData): void {
    const now = this.now();
    const prev = this.members.get(data.m.id);
    const next: Member = { ...data.m, lastSeen: now };
    const changed =
      !prev || prev.state !== next.state || prev.name !== next.name || prev.loadout.join() !== next.loadout.join() || prev.color !== next.color || prev.title !== next.title;
    this.members.set(next.id, next);
    this.adoptHost(data.host, data.epoch);
    if (changed) this.emitMembers();
    if (this.isHost) this.checkLoaded();
  }

  private receive(m: NetMessage): void {
    if (this.closed) return;
    switch (m.t) {
      case 'hello': {
        const data = m.d as HeartbeatData;
        const known = this.members.has(data.m.id);
        if (this.isHost) {
          const active = Array.from(this.members.values()).filter((x) => x.state !== 'disconnected').length;
          const inRoster = this.startPayload?.roster.some((r) => r.id === data.m.id) ?? false;
          if (!known && active >= this.settings.maxPlayers) {
            this.channel.send('refuse', 'Salon complet.', m.f);
            return;
          }
          if (!known && this.phase !== 'lobby' && !inRoster) {
            this.channel.send('refuse', 'Expédition déjà en cours.', m.f);
            return;
          }
        } else if (!known) break; // seul l'hôte admet un nouveau membre
        this.upsert(data);
        this.beat();
        if (this.isHost) this.broadcastLobby(m.f);
        break;
      }
      case 'hb': {
        const data = m.d as HeartbeatData;
        const known = this.members.has(data.m.id);
        this.upsert(data);
        // Nouveau venu admis par l'hôte : on se présente pour qu'il connaisse tout le monde.
        if (!known && this.accepted) this.beat();
        break;
      }
      case 'bye':
        if (this.members.delete(m.f)) this.emitMembers();
        this.electHost();
        break;
      case 'host': {
        const d = m.d as { id: string; epoch: number };
        this.adoptHost(d.id, d.epoch);
        break;
      }
      case 'lobby': {
        const d = m.d as { settings: LobbySettings; host: string; epoch: number; phase: RoomSession['phase']; start: StartPayload | null };
        if (d.epoch < this.hostEpoch) break;
        this.adoptHost(d.host, d.epoch);
        if (!this.accepted) {
          this.accepted = true;
          this.beat();
        }
        this.settings = d.settings;
        this.events.emit('settings', this.settings);
        if (d.phase !== 'lobby' && d.start && this.phase === 'lobby') {
          // Arrivée (ou retour) en cours de partie : chargement immédiat.
          this.beginLoading(d.start);
          if (d.phase === 'playing') {
            this.phase = 'playing';
            this.events.emit('go', null);
          }
        } else if (d.phase === 'lobby' && this.phase !== 'lobby' && m.f === this.hostId) {
          this.phase = 'lobby';
          this.startPayload = null;
          this.me.state = 'connected';
        }
        break;
      }
      case 'start':
        if (m.f === this.hostId && this.phase === 'lobby') this.beginLoading(m.d as StartPayload);
        break;
      case 'go':
        if (m.f === this.hostId && this.phase === 'loading') {
          this.phase = 'playing';
          this.events.emit('go', null);
        }
        break;
      case 'refuse':
        this.closed = true;
        this.closedReason = String(m.d);
        this.channel.close();
        this.events.emit('closed', String(m.d));
        break;
      default:
        this.events.emit('message', m);
        break;
    }
  }
}
