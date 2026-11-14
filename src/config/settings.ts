/** Réglages du joueur, conservés dans le navigateur. */
export type Quality = 'faible' | 'moyenne' | 'elevee';

export type ActionId =
  | 'avancer'
  | 'reculer'
  | 'gauche'
  | 'droite'
  | 'courir'
  | 'accroupir'
  | 'sauter'
  | 'interagir'
  | 'lampe'
  | 'recharger'
  | 'inventaire'
  | 'carte'
  | 'documents'
  | 'parler'
  | 'radio'
  | 'lacher'
  | 'apnee'
  | 'discussion';

export const ACTION_LABELS: Record<ActionId, string> = {
  avancer: 'Avancer',
  reculer: 'Reculer',
  gauche: 'Pas à gauche',
  droite: 'Pas à droite',
  courir: 'Courir',
  accroupir: "S'accroupir",
  sauter: 'Sauter',
  interagir: 'Interagir',
  lampe: 'Lampe torche',
  recharger: 'Recharger',
  inventaire: 'Inventaire',
  carte: 'Carte',
  documents: 'Documents',
  parler: 'Voix de proximité',
  radio: 'Radio',
  lacher: "Lâcher l'objet",
  apnee: 'Retenir sa respiration',
  discussion: 'Discussion écrite',
};

/**
 * Touches par défaut, exprimées en positions physiques (KeyboardEvent.code) :
 * KeyW / KeyA / KeyS / KeyD correspondent à Z / Q / S / D sur un clavier AZERTY.
 */
export const DEFAULT_KEYS: Record<ActionId, string> = {
  avancer: 'KeyW',
  reculer: 'KeyS',
  gauche: 'KeyA',
  droite: 'KeyD',
  courir: 'ShiftLeft',
  accroupir: 'ControlLeft',
  sauter: 'Space',
  interagir: 'KeyE',
  lampe: 'KeyF',
  recharger: 'KeyR',
  inventaire: 'Tab',
  carte: 'KeyM',
  documents: 'KeyJ',
  parler: 'KeyV',
  radio: 'KeyG',
  lacher: 'KeyX',
  apnee: 'KeyQ',
  discussion: 'Enter',
};

export interface Settings {
  sensitivity: number;
  invertY: boolean;
  /** Mouvement brut de la souris (accélération du système désactivée). */
  rawInput: boolean;
  /** Champ de vision horizontal en degrés. */
  fov: number;
  /** Amplitude de l'oscillation de la caméra, 0 à 1. */
  bob: number;
  /** Secousses de caméra (impacts, stress). */
  shake: boolean;
  quality: Quality;
  renderScale: number;
  volumes: { general: number; ambiance: number; effets: number; entites: number; musique: number; comms: number };
  voice: { enabled: boolean; mode: 'ptt' | 'ouvert' };
  keys: Record<ActionId, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  invertY: false,
  rawInput: true,
  fov: 84,
  bob: 0.7,
  shake: true,
  quality: 'moyenne',
  renderScale: 1,
  volumes: { general: 0.8, ambiance: 0.7, effets: 0.9, entites: 0.9, musique: 0.5, comms: 0.9 },
  voice: { enabled: false, mode: 'ptt' },
  keys: { ...DEFAULT_KEYS },
};

const KEY = 'nocturne.reglages';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const saved = JSON.parse(raw) as Partial<Settings>;
    return {
      ...structuredClone(DEFAULT_SETTINGS),
      ...saved,
      volumes: { ...DEFAULT_SETTINGS.volumes, ...saved.volumes },
      voice: { ...DEFAULT_SETTINGS.voice, ...saved.voice },
      keys: { ...DEFAULT_KEYS, ...saved.keys },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

const AZERTY: Record<string, string> = { KeyW: 'Z', KeyA: 'Q', KeyQ: 'A', KeyZ: 'W', KeyM: ',', Semicolon: 'M' };
const NAMES: Record<string, string> = {
  ShiftLeft: 'Maj',
  ShiftRight: 'Maj droite',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl droite',
  AltLeft: 'Alt',
  Space: 'Espace',
  Tab: 'Tab',
  Enter: 'Entrée',
  Escape: 'Échap',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

let layoutMap: { get(code: string): string | undefined } | null = null;

/** Tente de lire la disposition réelle du clavier (Chromium) pour afficher les bonnes lettres. */
export async function detectKeyboardLayout(): Promise<void> {
  try {
    const kb = (navigator as unknown as { keyboard?: { getLayoutMap(): Promise<{ get(code: string): string | undefined }> } }).keyboard;
    if (kb) layoutMap = await kb.getLayoutMap();
  } catch {
    layoutMap = null;
  }
}

/** Libellé lisible d'une touche. */
export function keyLabel(code: string): string {
  if (NAMES[code]) return NAMES[code];
  const mapped = layoutMap?.get(code);
  if (mapped) return mapped.toUpperCase();
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('fr') && AZERTY[code]) return AZERTY[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Mouse')) return code === 'Mouse0' ? 'Clic gauche' : code === 'Mouse2' ? 'Clic droit' : 'Clic molette';
  return code;
}
