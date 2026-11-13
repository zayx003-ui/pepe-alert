/**
 * Protocole de jeu. Tous les messages transitent par le canal du salon.
 *
 * Autorité :
 *  - chaque client est maître de son propre personnage (position, inventaire, santé) ;
 *  - l'hôte est maître du monde (portes, machines, objets au sol), des entités,
 *    des missions et du résultat de l'expédition ;
 *  - Supabase (fonctions SQL) est maître des récompenses persistantes.
 */
import type { EntitySnapshot } from '../ai/agent';
import type { ActionResult, ActorCtx, TargetRef, TerminalCommand } from '../interaction/actions';
import type { MissionSnapshot } from '../missions/manager';
import type { WorldNotice } from '../missions/events';
import type { WorldOp, WorldSnapshot } from '../world/state';

export const MSG = {
  /** client → tous : état de son personnage (10 Hz). */
  PLAYER: 'ps',
  /** hôte → tous : opérations sur le monde, numérotées. */
  OPS: 'ops',
  /** hôte → tous : instantané des entités (8 Hz). */
  ENTITIES: 'ent',
  /** hôte → tous : état des missions. */
  MISSION: 'mis',
  /** hôte → tous : état interne des missions, pour la reprise d'autorité. */
  HOST_STATE: 'hst',
  /** client → hôte : demande d'interaction ; hôte → client : réponse. */
  REQUEST: 'req',
  RESPONSE: 'res',
  /** client → hôte : fait rapporté (objet lâché, relevé, mort, extraction…). */
  FACT: 'fact',
  /** hôte → un client : dégât ou effet subi. */
  DAMAGE: 'dmg',
  EFFECT: 'eff',
  /** hôte → tous : son ou leurre ponctuel. */
  FX: 'fx',
  NOTICE: 'ntc',
  /** client → hôte : demande d'état complet ; hôte → client : état complet. */
  SYNC_REQUEST: 'sreq',
  SYNC: 'sync',
  CHAT: 'chat',
  RESULT: 'result',
  /** Signalisation WebRTC (voix). */
  RTC: 'rtc',
} as const;

export const FLAG_CROUCH = 1;
export const FLAG_LIGHT = 2;
export const FLAG_SPRINT = 4;
export const FLAG_ALIVE = 8;
export const FLAG_RADIO = 16;
export const FLAG_EXTRACTED = 32;

export interface PlayerStateMsg {
  /** Position. */
  p: [number, number, number];
  /** Orientation (lacet, tangage). */
  r: [number, number];
  /** Drapeaux FLAG_*. */
  f: number;
  /** Portée du bruit continu. */
  n: number;
  /** Vitesse. */
  s: number;
  /** Santé. */
  h: number;
  /** Appareils allumés. */
  d: number;
  /** Casier où le joueur est caché. */
  k: string;
  /** Objet tenu en main. */
  a: string;
}

export interface OpsMsg {
  seq: number;
  ops: WorldOp[];
}

export interface RequestMsg {
  n: number;
  target: TargetRef;
  action: string;
  actor: ActorCtx;
  term?: TerminalCommand;
}

export interface ResponseMsg {
  n: number;
  r: ActionResult;
}

export type FactMsg =
  | { k: 'drop'; item: string; charge: number; data?: string; x: number; y: number; z: number; noise: number }
  | { k: 'marker'; x: number; y: number; z: number }
  | { k: 'camera'; x: number; y: number; z: number; yaw: number }
  | { k: 'measure'; region: number }
  | { k: 'observe'; kind: string }
  | { k: 'noise'; x: number; z: number; r: number }
  | { k: 'died'; cause: string }
  | { k: 'extracted' }
  | { k: 'leave'; locker: string };

export interface DamageMsg {
  amount: number;
  injury: string;
  kind: string;
}

export interface EffectMsg {
  type: 'infect' | 'drain' | 'stress';
  v: number;
}

export type FxMsg =
  | { type: 'sound'; sound: string; x: number; z: number; uid: number }
  | { type: 'fake'; what: string; x: number; z: number; as: string };

export interface ChatMsg {
  ch: 'prox' | 'radio';
  name: string;
  text: string;
  x: number;
  z: number;
  /** Message imité par le Visiteur (jamais émis par un client). */
  fake?: boolean;
}

export interface SyncMsg {
  seq: number;
  world: WorldSnapshot;
  mission: MissionSnapshot;
  entities: EntitySnapshot[];
  /** États connus de l'hôte pour chaque joueur (position, vivant…). */
  players: Record<string, { x: number; y: number; z: number; status: PlayerStatus }>;
}

export type PlayerStatus = 'playing' | 'dead' | 'extracted';

export interface PlayerResult {
  id: string;
  name: string;
  status: 'extrait' | 'mort' | 'disparu' | 'abandon';
}

export interface ExpeditionResult {
  sessionId: string;
  seed: string;
  outcome: 'succes' | 'echec';
  duration: number;
  primary: string;
  objectivesDone: string[];
  objectivesFailed: string[];
  documents: string[];
  creatures: string[];
  players: PlayerResult[];
}

export type { EntitySnapshot, MissionSnapshot, WorldNotice };
