/**
 * Abstraction du transport réseau.
 *
 * Trois implémentations partagent cette interface :
 *  - SupabaseTransport : multijoueur en ligne (Supabase Realtime + table `rooms`) ;
 *  - LocalTransport    : entre onglets d'un même navigateur (BroadcastChannel), sans serveur ;
 *  - MemoryTransport   : en mémoire, pour les tests automatisés (latence et pertes simulables).
 */
export interface RoomInfo {
  code: string;
  name: string;
  hostId: string;
  hostName: string;
  players: number;
  maxPlayers: number;
  status: 'lobby' | 'playing';
  isPublic: boolean;
  /** Horodatages en millisecondes. */
  createdAt: number;
  updatedAt: number;
}

export interface NetMessage {
  /** Type du message. */
  t: string;
  /** Identifiant de l'émetteur. */
  f: string;
  /** Destinataire unique (absent = diffusion à tous). */
  to?: string;
  /** Charge utile. */
  d: unknown;
}

export type ChannelStatus = 'connected' | 'reconnecting' | 'closed';

export interface RoomChannel {
  readonly code: string;
  readonly selfId: string;
  send(t: string, d: unknown, to?: string): void;
  onMessage: (m: NetMessage) => void;
  onStatus: (s: ChannelStatus) => void;
  close(): void;
}

export interface Transport {
  readonly kind: 'supabase' | 'local' | 'memory';
  createRoom(info: RoomInfo): Promise<void>;
  updateRoom(code: string, patch: Partial<RoomInfo>): Promise<void>;
  removeRoom(code: string): Promise<void>;
  getRoom(code: string): Promise<RoomInfo | null>;
  /** Salons publics encore actifs. */
  listRooms(): Promise<RoomInfo[]>;
  open(code: string, selfId: string): Promise<RoomChannel>;
}

/** Un salon dont l'hôte ne donne plus signe de vie depuis ce délai n'est plus listé. */
export const ROOM_STALE_MS = 45_000;
/** Un salon vide ou abandonné expire au bout de ce délai. */
export const ROOM_EXPIRE_MS = 30 * 60_000;

export function generateRoomCode(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i++) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}

/* ------------------------------------------------------------------ */
/* Transport en mémoire (tests)                                        */
/* ------------------------------------------------------------------ */

interface MemoryPeer {
  channel: MemoryChannel;
  online: boolean;
}

class MemoryChannel implements RoomChannel {
  onMessage: (m: NetMessage) => void = () => {};
  onStatus: (s: ChannelStatus) => void = () => {};
  sent = 0;
  bytes = 0;

  constructor(
    readonly code: string,
    readonly selfId: string,
    private hub: MemoryHub,
  ) {}

  send(t: string, d: unknown, to?: string): void {
    this.hub.dispatch(this.code, { t, f: this.selfId, to, d });
    this.sent++;
    this.bytes += JSON.stringify(d ?? null).length + t.length + 8;
  }

  close(): void {
    this.hub.leave(this.code, this.selfId);
    this.onStatus('closed');
  }
}

/** Concentrateur partagé par tous les MemoryTransport d'un même test. */
export class MemoryHub {
  readonly rooms = new Map<string, RoomInfo>();
  private peers = new Map<string, Map<string, MemoryPeer>>();
  private queue: { at: number; code: string; m: NetMessage }[] = [];
  /** Temps simulé en millisecondes. */
  now = 0;
  /** Latence appliquée à chaque message, en millisecondes. */
  latency = 0;
  /** Probabilité de perte d'un message diffusé (0 à 1). */
  loss = 0;
  random: () => number = Math.random;
  delivered = 0;

  join(code: string, id: string): MemoryChannel {
    let room = this.peers.get(code);
    if (!room) this.peers.set(code, (room = new Map()));
    const channel = new MemoryChannel(code, id, this);
    room.set(id, { channel, online: true });
    return channel;
  }

  leave(code: string, id: string): void {
    this.peers.get(code)?.delete(id);
  }

  /** Coupe ou rétablit la liaison d'un pair (simulation de perte de connexion). */
  setOnline(code: string, id: string, online: boolean): void {
    const peer = this.peers.get(code)?.get(id);
    if (!peer) return;
    peer.online = online;
    peer.channel.onStatus(online ? 'connected' : 'reconnecting');
  }

  dispatch(code: string, m: NetMessage): void {
    const sender = this.peers.get(code)?.get(m.f);
    if (!sender || !sender.online) return;
    // Sérialisation systématique : garantit que rien de non transmissible ne circule.
    const copy = JSON.parse(JSON.stringify(m)) as NetMessage;
    this.queue.push({ at: this.now + this.latency, code, m: copy });
    if (this.latency === 0) this.flush();
  }

  /** Avance le temps simulé et livre les messages arrivés à échéance. */
  advance(ms: number): void {
    this.now += ms;
    this.flush();
  }

  private flushing = false;

  private flush(): void {
    if (this.flushing) return;
    this.flushing = true;
    while (this.queue.length > 0 && this.queue[0]!.at <= this.now) {
      const { code, m } = this.queue.shift()!;
      const room = this.peers.get(code);
      if (!room) continue;
      for (const [id, peer] of room) {
        if (id === m.f || !peer.online) continue;
        if (m.to && m.to !== id) continue;
        if (!m.to && this.loss > 0 && this.random() < this.loss) continue;
        this.delivered++;
        peer.channel.onMessage(m);
      }
    }
    this.flushing = false;
  }
}

export class MemoryTransport implements Transport {
  readonly kind = 'memory' as const;

  constructor(readonly hub: MemoryHub) {}

  async createRoom(info: RoomInfo): Promise<void> {
    this.hub.rooms.set(info.code, { ...info });
  }

  async updateRoom(code: string, patch: Partial<RoomInfo>): Promise<void> {
    const room = this.hub.rooms.get(code);
    if (room) Object.assign(room, patch);
  }

  async removeRoom(code: string): Promise<void> {
    this.hub.rooms.delete(code);
  }

  async getRoom(code: string): Promise<RoomInfo | null> {
    const room = this.hub.rooms.get(code);
    return room ? { ...room } : null;
  }

  async listRooms(): Promise<RoomInfo[]> {
    return Array.from(this.hub.rooms.values())
      .filter((r) => r.isPublic)
      .map((r) => ({ ...r }));
  }

  async open(code: string, selfId: string): Promise<RoomChannel> {
    const channel = this.hub.join(code, selfId);
    queueMicrotask(() => channel.onStatus('connected'));
    return channel;
  }
}

/* ------------------------------------------------------------------ */
/* Transport local (onglets d'un même navigateur)                      */
/* ------------------------------------------------------------------ */

const REGISTRY_KEY = 'nocturne.salons';

function readRegistry(): Record<string, RoomInfo> {
  try {
    return JSON.parse(localStorage.getItem(REGISTRY_KEY) ?? '{}') as Record<string, RoomInfo>;
  } catch {
    return {};
  }
}

function writeRegistry(reg: Record<string, RoomInfo>): void {
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(reg));
}

export class LocalTransport implements Transport {
  readonly kind = 'local' as const;

  async createRoom(info: RoomInfo): Promise<void> {
    const reg = readRegistry();
    reg[info.code] = info;
    writeRegistry(reg);
  }

  async updateRoom(code: string, patch: Partial<RoomInfo>): Promise<void> {
    const reg = readRegistry();
    if (!reg[code]) return;
    reg[code] = { ...reg[code], ...patch, updatedAt: Date.now() };
    writeRegistry(reg);
  }

  async removeRoom(code: string): Promise<void> {
    const reg = readRegistry();
    delete reg[code];
    writeRegistry(reg);
  }

  async getRoom(code: string): Promise<RoomInfo | null> {
    const room = readRegistry()[code];
    if (!room || Date.now() - room.updatedAt > ROOM_EXPIRE_MS) return null;
    return room;
  }

  async listRooms(): Promise<RoomInfo[]> {
    const reg = readRegistry();
    const now = Date.now();
    let changed = false;
    for (const [code, room] of Object.entries(reg)) {
      if (now - room.updatedAt > ROOM_EXPIRE_MS) {
        delete reg[code];
        changed = true;
      }
    }
    if (changed) writeRegistry(reg);
    return Object.values(reg).filter((r) => r.isPublic && now - r.updatedAt < ROOM_STALE_MS);
  }

  async open(code: string, selfId: string): Promise<RoomChannel> {
    const bc = new BroadcastChannel(`nocturne-salon-${code}`);
    const channel: RoomChannel = {
      code,
      selfId,
      send(t, d, to) {
        bc.postMessage({ t, f: selfId, to, d } satisfies NetMessage);
      },
      onMessage: () => {},
      onStatus: () => {},
      close() {
        bc.close();
        channel.onStatus('closed');
      },
    };
    bc.onmessage = (ev: MessageEvent<NetMessage>) => {
      const m = ev.data;
      if (m.to && m.to !== selfId) return;
      channel.onMessage(m);
    };
    queueMicrotask(() => channel.onStatus('connected'));
    return channel;
  }
}
