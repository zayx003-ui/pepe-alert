/**
 * Client Supabase et transport en ligne.
 *
 * Le client n'est créé que si VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY sont
 * définis au moment du build. Sinon le jeu fonctionne en mode local et
 * l'interface le signale clairement.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { ChannelStatus, NetMessage, RoomChannel, RoomInfo, Transport } from './transport';

const url = (import.meta.env?.VITE_SUPABASE_URL as string | undefined)?.trim();
const key = (import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true },
        realtime: { params: { eventsPerSecond: 30 } },
      })
    : null;

export const supabaseConfigured = supabase !== null;

interface RoomRow {
  code: string;
  name: string;
  host_id: string;
  host_name: string;
  players: number;
  max_players: number;
  status: 'lobby' | 'playing';
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

function toInfo(r: RoomRow): RoomInfo {
  return {
    code: r.code,
    name: r.name,
    hostId: r.host_id,
    hostName: r.host_name,
    players: r.players,
    maxPlayers: r.max_players,
    status: r.status,
    isPublic: r.is_public,
    createdAt: Date.parse(r.created_at),
    updatedAt: Date.parse(r.updated_at),
  };
}

function fail(context: string, error: { message: string } | null): void {
  if (error) throw new Error(`${context} : ${error.message}`);
}

/**
 * Transport Supabase : la table `rooms` sert d'annuaire (via des fonctions SQL
 * qui vérifient l'identité de l'appelant) et un canal Realtime par salon diffuse
 * les messages de jeu.
 */
export class SupabaseTransport implements Transport {
  readonly kind = 'supabase' as const;

  constructor(private client: SupabaseClient) {}

  async createRoom(info: RoomInfo): Promise<void> {
    const { error } = await this.client.rpc('create_room', {
      p_code: info.code,
      p_name: info.name,
      p_host_name: info.hostName,
      p_is_public: info.isPublic,
      p_max_players: info.maxPlayers,
    });
    fail('Création du salon', error);
  }

  async updateRoom(code: string, patch: Partial<RoomInfo>): Promise<void> {
    const { error } = await this.client.rpc('touch_room', {
      p_code: code,
      p_name: patch.name ?? null,
      p_is_public: patch.isPublic ?? null,
      p_max_players: patch.maxPlayers ?? null,
      p_players: patch.players ?? null,
      p_status: patch.status ?? null,
      p_host_name: patch.hostName ?? null,
    });
    // Un échec ici (hôte remplacé entre-temps, salon expiré) ne doit pas interrompre la partie.
    if (error) console.warn('[salon] mise à jour refusée :', error.message);
  }

  async removeRoom(code: string): Promise<void> {
    const { error } = await this.client.rpc('close_room', { p_code: code });
    if (error) console.warn('[salon] fermeture refusée :', error.message);
  }

  async getRoom(code: string): Promise<RoomInfo | null> {
    const { data, error } = await this.client.rpc('join_room', { p_code: code });
    fail('Entrée dans le salon', error);
    const row = (Array.isArray(data) ? data[0] : data) as RoomRow | null;
    return row ? toInfo(row) : null;
  }

  async listRooms(): Promise<RoomInfo[]> {
    const { data, error } = await this.client.from('public_rooms').select('*').order('updated_at', { ascending: false }).limit(50);
    fail('Liste des salons', error);
    return ((data ?? []) as RoomRow[]).map(toInfo);
  }

  async open(code: string, selfId: string): Promise<RoomChannel> {
    const rt: RealtimeChannel = this.client.channel(`salon:${code}`, { config: { broadcast: { self: false, ack: false } } });
    const channel: RoomChannel = {
      code,
      selfId,
      send(t, d, to) {
        void rt.send({ type: 'broadcast', event: 'm', payload: { t, f: selfId, to, d } satisfies NetMessage });
      },
      onMessage: () => {},
      onStatus: () => {},
      close() {
        void this_.client.removeChannel(rt);
        channel.onStatus('closed');
      },
    };
    const this_ = this;
    rt.on('broadcast', { event: 'm' }, ({ payload }) => {
      const m = payload as NetMessage;
      // Les messages adressés sont diffusés sur le canal et filtrés ici.
      if (m.to && m.to !== selfId) return;
      channel.onMessage(m);
    });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      rt.subscribe((status) => {
        let mapped: ChannelStatus | null = null;
        if (status === 'SUBSCRIBED') mapped = 'connected';
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') mapped = 'reconnecting';
        else if (status === 'CLOSED') mapped = 'closed';
        if (!settled) {
          settled = true;
          if (status === 'SUBSCRIBED') resolve();
          else reject(new Error('Connexion au canal temps réel impossible.'));
        }
        if (mapped) channel.onStatus(mapped);
      });
    });
    return channel;
  }
}
