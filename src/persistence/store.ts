/**
 * Stockage du profil : local (navigateur) ou Supabase.
 *
 * En ligne, le client ne modifie jamais lui-même son expérience ni ses
 * statistiques : il ne peut écrire que son nom, son titre et sa tenue. Les
 * récompenses sont attribuées par la fonction SQL `finish_session`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExpeditionResult } from '../network/protocol';
import { applyResult, computeXp, emptyProfile, levelForXp, type Profile } from './progression';

export interface ResultOutcome {
  profile: Profile;
  xp: number;
  newAchievements: string[];
  leveledUp: boolean;
  /** Message d'avertissement si la récompense n'a pas pu être enregistrée. */
  warning?: string;
}

export interface ProfileStore {
  readonly online: boolean;
  load(): Promise<Profile>;
  saveIdentity(patch: Partial<Pick<Profile, 'name' | 'title' | 'color'>>): Promise<Profile>;
  /**
   * Enregistre le résultat d'une expédition et renvoie le profil à jour.
   * `playerId` : identifiant sous lequel le joueur figurait dans la partie.
   */
  recordResult(result: ExpeditionResult, isHost: boolean, playerId: string): Promise<ResultOutcome>;
  /** Hôte : déclare l'ouverture d'une session côté serveur ; renvoie son identifiant. */
  openSession(roomCode: string, seed: string, players: string[]): Promise<string>;
}

const LOCAL_KEY = 'nocturne.profil';
const SESSIONS_KEY = 'nocturne.sessions';

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

export class LocalProfileStore implements ProfileStore {
  readonly online = false;

  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage) {}

  /** Sessions déjà comptées (conservées : deux onglets du même navigateur partagent le profil). */
  private recorded(): string[] {
    try {
      return JSON.parse(this.storage.getItem(SESSIONS_KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  }

  private read(): Profile {
    try {
      const raw = this.storage.getItem(LOCAL_KEY);
      if (raw) {
        const p = { ...emptyProfile('', '', false), ...(JSON.parse(raw) as Partial<Profile>) };
        if (p.id) return p;
      }
    } catch {
      // Profil illisible : on repart d'un profil neuf plutôt que de bloquer le jeu.
    }
    const fresh = emptyProfile(uuid(), `Agent-${Math.floor(100 + Math.random() * 900)}`, false);
    this.write(fresh);
    return fresh;
  }

  private write(p: Profile): void {
    this.storage.setItem(LOCAL_KEY, JSON.stringify(p));
  }

  async load(): Promise<Profile> {
    return this.read();
  }

  async saveIdentity(patch: Partial<Pick<Profile, 'name' | 'title' | 'color'>>): Promise<Profile> {
    const p = { ...this.read(), ...patch };
    p.name = p.name.trim().slice(0, 20) || 'Agent';
    this.write(p);
    return p;
  }

  async recordResult(result: ExpeditionResult, _isHost = true, playerId?: string): Promise<ResultOutcome> {
    const current = this.read();
    const id = playerId ?? current.id;
    // Un même résultat ne peut être compté qu'une fois.
    const done = this.recorded();
    if (done.includes(result.sessionId)) return { profile: current, xp: 0, newAchievements: [], leveledUp: false, warning: 'Résultat déjà enregistré pour ce profil.' };
    this.storage.setItem(SESSIONS_KEY, JSON.stringify([...done, result.sessionId].slice(-30)));
    const xp = computeXp(result, id);
    const { profile, newAchievements, leveledUp } = applyResult(current, result, xp, id);
    this.write(profile);
    return { profile, xp, newAchievements, leveledUp };
  }

  async openSession(): Promise<string> {
    return uuid();
  }
}

interface ProfileRow {
  id: string;
  display_name: string;
  title: string;
  color: string;
  xp: number;
  achievements: string[];
  documents: string[];
  creatures: string[];
}

interface StatsRow {
  playtime_seconds: number;
  expeditions: number;
  successes: number;
  failures: number;
  deaths: number;
}

export class SupabaseProfileStore implements ProfileStore {
  readonly online = true;

  constructor(
    private client: SupabaseClient,
    private userId: string,
  ) {}

  async load(): Promise<Profile> {
    const { data, error } = await this.client.from('player_profiles').select('*').eq('id', this.userId).maybeSingle();
    if (error) throw new Error(`Chargement du profil : ${error.message}`);
    const row = data as ProfileRow | null;
    if (!row) throw new Error('Profil introuvable. Reconnectez-vous.');
    const stats = await this.client.from('player_statistics').select('*').eq('user_id', this.userId).maybeSingle();
    const s = (stats.data ?? { playtime_seconds: 0, expeditions: 0, successes: 0, failures: 0, deaths: 0 }) as StatsRow;
    return {
      id: row.id,
      name: row.display_name,
      title: row.title,
      color: row.color,
      level: levelForXp(row.xp),
      xp: row.xp,
      playtime: s.playtime_seconds,
      expeditions: s.expeditions,
      successes: s.successes,
      failures: s.failures,
      deaths: s.deaths,
      creatures: row.creatures ?? [],
      documents: row.documents ?? [],
      achievements: row.achievements ?? [],
      online: true,
    };
  }

  async saveIdentity(patch: Partial<Pick<Profile, 'name' | 'title' | 'color'>>): Promise<Profile> {
    const update: Record<string, string> = {};
    if (patch.name !== undefined) update['display_name'] = patch.name.trim().slice(0, 20) || 'Agent';
    if (patch.title !== undefined) update['title'] = patch.title;
    if (patch.color !== undefined) update['color'] = patch.color;
    const { error } = await this.client.from('player_profiles').update(update).eq('id', this.userId);
    if (error) throw new Error(`Enregistrement du profil : ${error.message}`);
    return this.load();
  }

  async openSession(roomCode: string, seed: string, players: string[]): Promise<string> {
    const { data, error } = await this.client.rpc('start_session', { p_room: roomCode, p_seed: seed, p_players: players });
    if (error) throw new Error(`Ouverture de la session : ${error.message}`);
    return String(data);
  }

  async recordResult(result: ExpeditionResult, isHost: boolean): Promise<ResultOutcome> {
    const before = await this.load();
    let warning: string | undefined;
    if (isHost) {
      // Seul l'hôte de la session peut la clore ; le serveur calcule les récompenses de chacun.
      const { error } = await this.client.rpc('finish_session', {
        p_session: result.sessionId,
        p_outcome: result.outcome,
        p_objectives: result.objectivesDone,
        p_documents: result.documents,
        p_creatures: result.creatures,
        p_players: result.players.map((p) => ({ id: p.id, status: p.status })),
      });
      if (error) warning = `Résultat non enregistré : ${error.message}`;
    } else {
      // Laisse à l'hôte le temps d'enregistrer avant de relire le profil.
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 1200));
        const { data } = await this.client.from('expedition_results').select('xp_awarded').eq('session_id', result.sessionId).eq('user_id', this.userId).maybeSingle();
        if (data) break;
        if (i === 5) warning = "L'hôte n'a pas encore enregistré le résultat ; votre profil se mettra à jour plus tard.";
      }
    }
    const after = await this.load();
    return {
      profile: after,
      xp: after.xp - before.xp,
      newAchievements: after.achievements.filter((a) => !before.achievements.includes(a)),
      leveledUp: after.level > before.level,
      warning,
    };
  }
}
