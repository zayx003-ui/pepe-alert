/**
 * Progression persistante : expérience, niveaux, déblocages cosmétiques, succès.
 * Les formules sont reproduites à l'identique dans la fonction SQL
 * `finish_session` (supabase/migrations) : en ligne, c'est le serveur qui calcule.
 */
import { OBJECTIVE_BY_ID } from '../missions/objectives';
import type { ExpeditionResult } from '../network/protocol';
import { DOCUMENTS } from '../world/lore';

export interface Profile {
  id: string;
  name: string;
  title: string;
  color: string;
  level: number;
  xp: number;
  /** Temps de jeu cumulé en secondes. */
  playtime: number;
  expeditions: number;
  successes: number;
  failures: number;
  deaths: number;
  creatures: string[];
  documents: string[];
  achievements: string[];
  /** Profil synchronisé avec Supabase (false = stocké dans ce navigateur). */
  online: boolean;
}

export function emptyProfile(id: string, name: string, online: boolean): Profile {
  return {
    id,
    name,
    title: 'Recrue',
    color: '#8a8f98',
    level: 1,
    xp: 0,
    playtime: 0,
    expeditions: 0,
    successes: 0,
    failures: 0,
    deaths: 0,
    creatures: [],
    documents: [],
    achievements: [],
    online,
  };
}

/** Expérience cumulée nécessaire pour atteindre un niveau. */
export function xpForLevel(level: number): number {
  return Math.round(350 * Math.pow(Math.max(0, level - 1), 1.45));
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (level < 50 && xp >= xpForLevel(level + 1)) level++;
  return level;
}

/**
 * Expérience gagnée par un joueur pour une expédition.
 * Réussite : objectif principal + secondaires, réduits de moitié si le joueur n'est pas sorti.
 * Échec : lot de consolation + moitié des secondaires accomplis.
 */
export function computeXp(result: ExpeditionResult, playerId: string): number {
  const me = result.players.find((p) => p.id === playerId);
  if (!me || me.status === 'abandon') return 0;
  let secondary = 0;
  let primary = 0;
  for (const id of result.objectivesDone) {
    const def = OBJECTIVE_BY_ID[id];
    if (!def) continue;
    if (def.kind === 'principal') primary += def.xp;
    else secondary += def.xp;
  }
  // Garde-fou : une expédition bouclée en moins de trois minutes ne rapporte que le lot de base.
  if (result.duration < 180) return 40;
  let xp: number;
  if (result.outcome === 'succes') xp = (primary + secondary) * (me.status === 'extrait' ? 1 : 0.5);
  else xp = 60 + secondary * 0.5;
  xp += Math.min(result.documents.length, 24) * 12;
  return Math.round(xp);
}

export interface Unlock {
  id: string;
  kind: 'titre' | 'tenue';
  label: string;
  /** Valeur appliquée (texte du titre ou couleur hexadécimale). */
  value: string;
  /** Condition : niveau minimal ou succès requis. */
  level?: number;
  achievement?: string;
}

/** Déblocages purement cosmétiques : aucun n'apporte d'avantage en jeu. */
export const UNLOCKS: Unlock[] = [
  { id: 't-recrue', kind: 'titre', label: 'Recrue', value: 'Recrue', level: 1 },
  { id: 't-eclaireur', kind: 'titre', label: 'Éclaireur', value: 'Éclaireur', level: 3 },
  { id: 't-technicien', kind: 'titre', label: 'Technicien de nuit', value: 'Technicien de nuit', level: 5 },
  { id: 't-veilleur', kind: 'titre', label: 'Veilleur', value: 'Veilleur', level: 8 },
  { id: 't-chef', kind: 'titre', label: "Chef d'expédition", value: "Chef d'expédition", level: 12 },
  { id: 't-archiviste', kind: 'titre', label: 'Archiviste', value: 'Archiviste', achievement: 'archiviste' },
  { id: 't-temoin', kind: 'titre', label: 'Témoin', value: 'Témoin', achievement: 'bestiaire' },
  { id: 't-dixieme', kind: 'titre', label: 'Dixième occupant', value: 'Dixième occupant', achievement: 'noyau' },
  { id: 'c-gris', kind: 'tenue', label: 'Gris réglementaire', value: '#8a8f98', level: 1 },
  { id: 'c-ambre', kind: 'tenue', label: 'Ambre de sécurité', value: '#d9952b', level: 2 },
  { id: 'c-bleu', kind: 'tenue', label: 'Bleu administration', value: '#3d6fa8', level: 4 },
  { id: 'c-vert', kind: 'tenue', label: 'Vert laboratoire', value: '#4f9a52', level: 6 },
  { id: 'c-rouge', kind: 'tenue', label: 'Rouge quarantaine', value: '#b8382f', level: 9 },
  { id: 'c-violet', kind: 'tenue', label: 'Violet acoustique', value: '#7d4fb0', level: 11 },
  { id: 'c-blanc', kind: 'tenue', label: 'Blanc médical', value: '#d8dde2', achievement: 'sans_perte' },
  { id: 'c-noir', kind: 'tenue', label: 'Noir du Noyau', value: '#23252b', achievement: 'noyau' },
];

export interface Achievement {
  id: string;
  label: string;
  description: string;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'premiere_sortie', label: 'Première sortie', description: "Réussir une expédition et s'extraire." },
  { id: 'sans_perte', label: 'Personne derrière', description: "Réussir une expédition à plusieurs sans perdre un seul membre." },
  { id: 'veteran', label: 'Habitué des lieux', description: 'Participer à dix expéditions.' },
  { id: 'survivant', label: 'Cinq retours', description: 'Réussir cinq expéditions.' },
  { id: 'lecteur', label: 'Lecteur', description: 'Rassembler dix documents.' },
  { id: 'archiviste', label: 'Archiviste', description: 'Rassembler tous les documents.' },
  { id: 'bestiaire', label: 'Bestiaire complet', description: 'Observer les six entités.' },
  { id: 'noyau', label: 'Le seuil refermé', description: 'Désaccorder le Noyau.' },
  { id: 'purge', label: 'Table rase', description: 'Purger la quarantaine.' },
  { id: 'lumiere', label: 'Fiat lux', description: 'Rallumer la centrale.' },
];

/** Applique un résultat au profil (mode local ; en ligne le serveur fait de même). */
export function applyResult(profile: Profile, result: ExpeditionResult, xp: number): { profile: Profile; newAchievements: string[]; leveledUp: boolean } {
  const me = result.players.find((p) => p.id === profile.id);
  const next: Profile = { ...profile, creatures: profile.creatures.slice(), documents: profile.documents.slice(), achievements: profile.achievements.slice() };
  if (!me) return { profile: next, newAchievements: [], leveledUp: false };
  next.xp += xp;
  next.playtime += result.duration;
  next.expeditions += 1;
  if (result.outcome === 'succes' && me.status === 'extrait') next.successes += 1;
  else next.failures += 1;
  if (me.status === 'mort') next.deaths += 1;
  for (const c of result.creatures) if (!next.creatures.includes(c)) next.creatures.push(c);
  for (const d of result.documents) if (!next.documents.includes(d)) next.documents.push(d);
  const before = next.level;
  next.level = levelForXp(next.xp);

  const earned: string[] = [];
  const grant = (id: string, condition: boolean): void => {
    if (condition && !next.achievements.includes(id)) {
      next.achievements.push(id);
      earned.push(id);
    }
  };
  const won = result.outcome === 'succes' && me.status === 'extrait';
  grant('premiere_sortie', won);
  grant('sans_perte', won && result.players.length > 1 && result.players.every((p) => p.status === 'extrait'));
  grant('veteran', next.expeditions >= 10);
  grant('survivant', next.successes >= 5);
  grant('lecteur', next.documents.length >= 10);
  grant('archiviste', next.documents.length >= DOCUMENTS.length);
  grant('bestiaire', next.creatures.length >= 6);
  grant('noyau', won && result.objectivesDone.includes('P-CORE'));
  grant('purge', won && result.objectivesDone.includes('P-PURGE'));
  grant('lumiere', won && result.objectivesDone.includes('P-PWR'));
  return { profile: next, newAchievements: earned, leveledUp: next.level > before };
}

export function isUnlocked(profile: Profile, u: Unlock): boolean {
  if (u.level !== undefined) return profile.level >= u.level;
  if (u.achievement) return profile.achievements.includes(u.achievement);
  return true;
}
