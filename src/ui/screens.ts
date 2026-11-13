/**
 * Écrans hors partie : chaque fonction construit un écran à partir de l'état
 * réel de l'application (profil, salon, réglages) et de rappels d'action.
 */
import { ENTITY_KINDS, ENTITY_SPECS } from '../ai/specs';
import { ACTION_LABELS, DEFAULT_KEYS, keyLabel, type ActionId, type Quality, type Settings } from '../config/settings';
import { ITEMS, LOADOUT_POINTS, itemDef } from '../inventory/items';
import { OBJECTIVES, OBJECTIVE_BY_ID } from '../missions/objectives';
import type { ExpeditionResult } from '../network/protocol';
import type { LobbySettings, Member, RoomSession } from '../network/room';
import type { RoomInfo } from '../network/transport';
import type { VoiceChat } from '../network/voice';
import { ACHIEVEMENTS, UNLOCKS, isUnlocked, xpForLevel, type Profile } from '../persistence/progression';
import type { ResultOutcome } from '../persistence/store';
import { DOCUMENTS } from '../world/lore';
import { SECTORS } from '../world/sectors';
import { button, clear, field, formatDuration, h } from './dom';
import { documentView } from './panels';

const STATE_LABELS: Record<string, [string, string]> = {
  connected: ['connecté', ''],
  ready: ['prêt', 'ok'],
  loading: ['chargement', 'warn'],
  playing: ['en jeu', 'ok'],
  dead: ['mort', 'bad'],
  disconnected: ['déconnecté', 'bad'],
  extracted: ['extrait', 'ok'],
};

export function screen(...children: (Node | null)[]): HTMLElement {
  return h('div', { class: 'screen' }, ...children);
}

/* ------------------------------------------------------------ 1. lancement */

export function bootScreen(onEnter: () => void, modeNote: string): HTMLElement {
  return screen(
    h('h1', { class: 'title', text: 'NOCTURNE' }),
    h('div', { class: 'subtitle', text: 'Le Protocole des Disparus' }),
    button('Entrer dans le complexe', onEnter, { class: 'primary', id: 'enter' }),
    h('p', { class: 'muted small', style: 'margin-top:26px;max-width:520px;text-align:center', text: "Jeu d'horreur coopératif pour 2 à 6 joueurs. Casque recommandé. Certaines scènes comportent des lumières clignotantes." }),
    h('div', { class: 'corner', text: modeNote }),
    h('div', { class: 'corner right', text: 'v0.1' }),
  );
}

/* ------------------------------------------------------------ 2. menu principal */

export interface MenuActions {
  solo(): void;
  create(): void;
  join(): void;
  profile(): void;
  archives(): void;
  settings(): void;
  account(): void;
}

export function menuScreen(profile: Profile, online: boolean, configured: boolean, a: MenuActions): HTMLElement {
  const account = online ? 'Compte' : configured ? 'Connexion / Inscription' : 'Compte en ligne';
  return screen(
    h('h1', { class: 'title', text: 'NOCTURNE' }),
    h('div', { class: 'subtitle', text: 'Le Protocole des Disparus' }),
    h(
      'div',
      { class: 'menu' },
      button('Expédition en solo', a.solo, { class: 'primary', id: 'menu-solo' }),
      button('Créer un salon', a.create, { id: 'menu-create' }),
      button('Rejoindre un salon', a.join, { id: 'menu-join' }),
      button('Profil', a.profile, { id: 'menu-profile' }),
      button('Archives', a.archives, { id: 'menu-archives' }),
      button('Paramètres', a.settings, { id: 'menu-settings' }),
      button(account, a.account, { id: 'menu-account' }),
    ),
    h('div', { class: 'corner', text: `${profile.name} — ${profile.title} · niveau ${profile.level}` }),
    h('div', { class: 'corner right', text: online ? 'EN LIGNE' : 'MODE LOCAL' }),
  );
}

/* ------------------------------------------------------------ 3-4. connexion, inscription */

export interface AuthActions {
  signIn(email: string, password: string): Promise<string | null>;
  signUp(email: string, password: string, name: string): Promise<string | null>;
  guest(): Promise<string | null>;
  signOut(): Promise<void>;
  back(): void;
}

export function accountScreen(mode: 'connexion' | 'inscription', configured: boolean, online: boolean, profile: Profile, a: AuthActions, switchMode: (m: 'connexion' | 'inscription') => void): HTMLElement {
  if (!configured) {
    return screen(
      h(
        'div',
        { class: 'panel narrow' },
        h('h2', { text: 'Compte en ligne' }),
        h('div', { class: 'notice-box' }, "Ce déploiement n'est relié à aucun projet Supabase : la connexion et l'inscription ne sont pas disponibles."),
        h('p', { class: 'small', style: 'margin-top:14px', text: "Vous jouez en mode local : votre profil est conservé dans ce navigateur et le multijoueur fonctionne entre onglets du même navigateur. Pour jouer en ligne, l'hébergeur du jeu doit renseigner VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY (voir docs/DEPLOYMENT.md)." }),
        h('div', { class: 'row', style: 'margin-top:18px' }, button('Retour', a.back)),
      ),
    );
  }
  if (online) {
    return screen(
      h('div', { class: 'panel narrow' }, h('h2', { text: 'Compte' }), h('p', { text: `Connecté en tant que ${profile.name}.` }), h('p', { class: 'small muted', text: 'Votre progression est enregistrée sur le serveur.' }), h('div', { class: 'row', style: 'margin-top:18px' }, button('Se déconnecter', () => void a.signOut(), { class: 'danger' }), button('Retour', a.back))),
    );
  }
  const email = h('input', { type: 'email', placeholder: 'adresse@exemple.fr', id: 'auth-email' });
  const password = h('input', { type: 'password', placeholder: '8 caractères minimum', id: 'auth-password' });
  const name = h('input', { type: 'text', maxlength: 20, placeholder: "Nom d'agent", id: 'auth-name' });
  const error = h('div', { class: 'error' });
  const submit = button(mode === 'connexion' ? 'Se connecter' : 'Créer le compte', () => void run(), { class: 'primary', id: 'auth-submit' });
  const run = async (): Promise<void> => {
    error.textContent = '';
    if (!email.value.includes('@')) return void (error.textContent = 'Adresse électronique invalide.');
    if (password.value.length < 8) return void (error.textContent = 'Le mot de passe doit compter au moins 8 caractères.');
    if (mode === 'inscription' && name.value.trim().length < 2) return void (error.textContent = "Choisissez un nom d'agent (2 caractères minimum).");
    submit.disabled = true;
    const result = mode === 'connexion' ? await a.signIn(email.value.trim(), password.value) : await a.signUp(email.value.trim(), password.value, name.value.trim());
    submit.disabled = false;
    if (result) error.textContent = result;
  };
  const guest = button('Jouer en invité', () => void a.guest().then((r) => r && (error.textContent = r)), { title: 'Compte anonyme (doit être autorisé dans le projet Supabase)' });
  return screen(
    h(
      'div',
      { class: 'panel narrow' },
      h('div', { class: 'tabs' }, h('button', { class: `tab ${mode === 'connexion' ? 'active' : ''}`, type: 'button', text: 'Connexion', onclick: () => switchMode('connexion') }), h('button', { class: `tab ${mode === 'inscription' ? 'active' : ''}`, type: 'button', text: 'Inscription', onclick: () => switchMode('inscription') })),
      h('div', { class: 'col' }, mode === 'inscription' ? field("Nom d'agent", name) : null, field('Adresse électronique', email), field('Mot de passe', password), error, h('div', { class: 'row' }, submit, guest, h('span', { class: 'spacer' }), button('Retour', a.back))),
    ),
  );
}

/* ------------------------------------------------------------ 5. profil */

export function profileScreen(profile: Profile, save: (patch: Partial<Pick<Profile, 'name' | 'title' | 'color'>>) => Promise<string | null>, back: () => void): HTMLElement {
  const name = h('input', { type: 'text', maxlength: 20, value: profile.name, id: 'profile-name' });
  const error = h('div', { class: 'error' });
  const titles = h('select', { id: 'profile-title' });
  for (const u of UNLOCKS.filter((x) => x.kind === 'titre')) {
    const ok = isUnlocked(profile, u);
    const opt = h('option', { value: u.value, text: ok ? u.label : `${u.label} — ${u.level ? `niveau ${u.level}` : 'succès requis'}`, disabled: !ok });
    if (u.value === profile.title) opt.selected = true;
    titles.append(opt);
  }
  let color = profile.color;
  const colors = h('div', { class: 'row' });
  const paint = (): void => {
    clear(colors);
    for (const u of UNLOCKS.filter((x) => x.kind === 'tenue')) {
      const ok = isUnlocked(profile, u);
      const b = h('button', { class: `btn small ${color === u.value ? 'on' : ''}`, type: 'button', disabled: !ok, title: ok ? u.label : `${u.label} — ${u.level ? `niveau ${u.level}` : 'succès requis'}`, onclick: () => ((color = u.value), paint()) }, h('span', { class: 'swatch', style: `display:inline-block;background:${u.value};vertical-align:middle;margin-right:6px` }), u.label);
      colors.append(b);
    }
  };
  paint();
  const next = xpForLevel(profile.level + 1);
  const prev = xpForLevel(profile.level);
  const stat = (a: string, b: string): HTMLElement => h('div', { class: 'stat' }, h('span', { text: a }), h('b', { text: b }));
  const achievements = h('div', { class: 'col' });
  for (const a of ACHIEVEMENTS) {
    const got = profile.achievements.includes(a.id);
    achievements.append(h('div', { class: 'row' }, h('span', { class: `badge ${got ? 'ok' : ''}`, text: got ? 'obtenu' : 'à obtenir' }), h('span', { text: a.label }), h('span', { class: 'muted small', text: a.description })));
  }
  return screen(
    h(
      'div',
      { class: 'panel wide' },
      h('h2', { text: 'Profil' }),
      h(
        'div',
        { class: 'grid2' },
        h(
          'div',
          { class: 'col' },
          field("Nom d'agent", name),
          field('Titre', titles),
          h('span', { class: 'field-label', text: 'Tenue' }),
          colors,
          error,
          h('div', { class: 'row' }, button('Enregistrer', () => void save({ name: name.value, title: titles.value, color }).then((e) => (error.textContent = e ?? 'Profil enregistré.')), { class: 'primary', id: 'profile-save' }), button('Retour', back)),
          h('p', { class: 'small muted', text: 'Titres et tenues sont purement cosmétiques : aucun ne donne un avantage en jeu.' }),
        ),
        h(
          'div',
          { class: 'col' },
          h('div', { class: 'row between' }, h('span', { text: `Niveau ${profile.level}` }), h('span', { class: 'muted small', text: `${profile.xp} / ${next} XP` })),
          h('div', { class: 'bar' }, h('i', { style: `width:${Math.min(100, ((profile.xp - prev) / Math.max(1, next - prev)) * 100)}%` })),
          stat('Identifiant', profile.id.slice(0, 8)),
          stat('Temps de jeu', formatDuration(profile.playtime)),
          stat('Expéditions', String(profile.expeditions)),
          stat('Réussites', String(profile.successes)),
          stat('Échecs', String(profile.failures)),
          stat('Morts', String(profile.deaths)),
          stat('Créatures rencontrées', `${profile.creatures.length} / ${ENTITY_KINDS.length}`),
          stat('Documents récupérés', `${profile.documents.length} / ${DOCUMENTS.length}`),
          stat('Stockage', profile.online ? 'serveur' : 'ce navigateur'),
        ),
      ),
      h('h3', { text: 'Succès' }),
      achievements,
    ),
  );
}

/* ------------------------------------------------------------ 6. création de salon */

export function createRoomScreen(profile: Profile, online: boolean, create: (s: Partial<LobbySettings>) => Promise<string | null>, back: () => void): HTMLElement {
  const name = h('input', { type: 'text', maxlength: 40, value: `Expédition de ${profile.name}`, id: 'room-name' });
  const seed = h('input', { type: 'text', maxlength: 16, placeholder: 'aléatoire', id: 'room-seed' });
  const max = h('select', { id: 'room-max' });
  for (let i = 2; i <= 6; i++) max.append(h('option', { value: String(i), text: `${i} joueurs` }));
  max.value = '6';
  const pub = h('input', { type: 'checkbox', checked: true, id: 'room-public' });
  const objective = h('select', { id: 'room-objective' }, h('option', { value: '', text: 'Tiré au sort par la graine' }));
  for (const o of OBJECTIVES.filter((x) => x.kind === 'principal')) objective.append(h('option', { value: o.id, text: o.title }));
  const error = h('div', { class: 'error' });
  const go = button('Créer le salon', () => {
    go.disabled = true;
    void create({ name: name.value, seed: seed.value.toUpperCase(), maxPlayers: Number(max.value), isPublic: pub.checked, objective: objective.value }).then((e) => {
      go.disabled = false;
      if (e) error.textContent = e;
    });
  }, { class: 'primary', id: 'room-create' });
  return screen(
    h(
      'div',
      { class: 'panel narrow' },
      h('h2', { text: 'Créer un salon' }),
      h(
        'div',
        { class: 'col' },
        online ? null : h('div', { class: 'notice-box', text: "Mode local : ce salon n'est visible que depuis les autres onglets de ce navigateur." }),
        field('Nom du salon', name),
        field('Joueurs', max),
        field('Objectif principal', objective),
        field('Graine de génération', seed, 'Une même graine reproduit exactement la même carte.'),
        h('label', { class: 'check' }, pub, 'Salon public (visible dans la recherche)'),
        error,
        h('div', { class: 'row' }, go, button('Retour', back)),
      ),
    ),
  );
}

/* ------------------------------------------------------------ 7. recherche de salon */

export function findRoomScreen(list: () => Promise<RoomInfo[]>, join: (code: string) => Promise<string | null>, back: () => void): HTMLElement {
  const rooms = h('div', { class: 'list', id: 'room-list' });
  const code = h('input', { type: 'text', maxlength: 5, placeholder: 'CODE', id: 'join-code', style: 'text-transform:uppercase;letter-spacing:0.3em;font-family:var(--mono)' });
  const error = h('div', { class: 'error' });
  const tryJoin = (c: string): void => {
    error.textContent = '';
    void join(c).then((e) => e && (error.textContent = e));
  };
  const refresh = async (): Promise<void> => {
    clear(rooms);
    rooms.append(h('div', { class: 'list-item muted', text: 'Recherche…' }));
    try {
      const found = await list();
      clear(rooms);
      if (found.length === 0) rooms.append(h('div', { class: 'list-item muted', text: 'Aucun salon public pour le moment.' }));
      for (const r of found) {
        const full = r.players >= r.maxPlayers;
        rooms.append(
          h(
            'div',
            { class: 'list-item' },
            h('div', { class: 'col', style: 'gap:2px' }, h('span', { text: r.name }), h('span', { class: 'muted small', text: `Hôte : ${r.hostName}` })),
            h('span', { class: 'spacer' }),
            h('span', { class: `badge ${r.status === 'playing' ? 'warn' : 'ok'}`, text: r.status === 'playing' ? 'en expédition' : 'lobby' }),
            h('span', { class: 'badge', text: `${r.players}/${r.maxPlayers}` }),
            button('Rejoindre', () => tryJoin(r.code), { class: 'small', disabled: full || r.status === 'playing', title: full ? 'Salon complet' : r.status === 'playing' ? 'Expédition en cours' : undefined }),
          ),
        );
      }
    } catch (e) {
      clear(rooms);
      rooms.append(h('div', { class: 'list-item', text: `Erreur : ${e instanceof Error ? e.message : String(e)}` }));
    }
  };
  void refresh();
  return screen(
    h(
      'div',
      { class: 'panel' },
      h('h2', { text: 'Rejoindre un salon' }),
      h('div', { class: 'row', style: 'margin-bottom:14px' }, code, button('Rejoindre par code', () => tryJoin(code.value), { class: 'primary', id: 'join-submit' })),
      error,
      h('div', { class: 'row between' }, h('h3', { text: 'Salons publics' }), button('Actualiser', () => void refresh(), { class: 'small', id: 'room-refresh' })),
      rooms,
      h('div', { class: 'row', style: 'margin-top:16px' }, button('Retour', back)),
    ),
  );
}

/* ------------------------------------------------------------ 8. lobby */

export interface LobbyActions {
  ready(r: boolean): void;
  loadout(): void;
  start(): void;
  leave(): void;
  chat(text: string): void;
  settings(patch: Partial<LobbySettings>): void;
  voice(): void;
}

export interface LobbyView {
  root: HTMLElement;
  refresh(): void;
  addChat(name: string, text: string): void;
  setError(text: string): void;
}

export function lobbyScreen(room: RoomSession, voice: VoiceChat | null, online: boolean, a: LobbyActions): LobbyView {
  const members = h('div', { class: 'list' });
  const head = h('div');
  const controls = h('div', { class: 'row', style: 'margin-top:16px' });
  const hostBox = h('div', { class: 'col' });
  const chatLog = h('div', { class: 'list', style: 'height:150px;max-height:150px' });
  const error = h('div', { class: 'error' });
  const chatInput = h('input', {
    type: 'text',
    maxlength: 160,
    placeholder: 'Écrire au salon…',
    id: 'lobby-chat',
    onkeydown: (e) => {
      if (e.key === 'Enter' && chatInput.value.trim()) {
        a.chat(chatInput.value.trim());
        chatInput.value = '';
      }
    },
  });
  const refresh = (): void => {
    const me = room.me;
    const list = room.list();
    clear(head);
    head.append(
      h('div', { class: 'row between' }, h('h2', { text: room.settings.name, style: 'margin:0' }), h('div', { class: 'row' }, h('span', { class: 'muted small', text: 'Code' }), h('span', { class: 'code', text: room.code, id: 'room-code' }))),
      h('p', { class: 'muted small', style: 'margin-top:8px', text: `${list.length} / ${room.settings.maxPlayers} joueurs · ${room.settings.isPublic ? 'public' : 'privé'} · graine ${room.settings.seed || '—'} · objectif ${room.settings.objective ? OBJECTIVE_BY_ID[room.settings.objective]?.title : 'tiré au sort'}` }),
    );
    if (room.status !== 'connected') head.append(h('div', { class: 'notice-box', text: 'Connexion au salon interrompue — tentative de reconnexion…' }));
    clear(members);
    for (const m of list) {
      const [label, cls] = STATE_LABELS[m.state] ?? [m.state, ''];
      const talking = voice?.speaking(m.id);
      members.append(
        h(
          'div',
          { class: 'list-item' },
          h('span', { class: 'swatch', style: `background:${m.color}` }),
          h('div', { class: 'col', style: 'gap:1px' }, h('span', { text: `${m.name}${m.id === room.self.id ? ' (vous)' : ''}` }), h('span', { class: 'muted small', text: `${m.title} · ${m.loadout.map((i) => itemDef(i).name).join(', ')}` })),
          h('span', { class: 'spacer' }),
          talking ? h('span', { class: 'badge ok', text: 'parle' }) : null,
          m.id === room.hostId ? h('span', { class: 'badge warn', text: 'hôte' }) : null,
          h('span', { class: `badge ${m.id === room.hostId && m.state === 'connected' ? 'ok' : cls}`, text: m.id === room.hostId && m.state === 'connected' ? 'prêt' : label }),
        ),
      );
    }
    clear(controls);
    const isReady = me.state === 'ready';
    if (room.isHost) {
      const ok = room.everyoneReady();
      controls.append(button("Lancer l'expédition", a.start, { class: 'primary', disabled: !ok, title: ok ? undefined : 'Tous les joueurs doivent être prêts', id: 'lobby-start' }));
    } else controls.append(button(isReady ? 'Annuler « prêt »' : 'Prêt', () => a.ready(!isReady), { class: isReady ? 'on' : 'primary', id: 'lobby-ready' }));
    controls.append(button('Équipement', a.loadout, { id: 'lobby-loadout' }));
    if (voice) {
      const label = voice.state === 'actif' ? 'Voix active' : voice.state === 'refuse' ? 'Écoute seule (micro refusé)' : voice.state === 'demande' ? 'Autorisation…' : voice.state === 'indisponible' ? 'Voix indisponible' : 'Activer la voix';
      controls.append(button(label, a.voice, { class: voice.listening ? 'on' : '', disabled: voice.state === 'indisponible' || voice.state === 'demande', id: 'lobby-voice', title: 'WebRTC pair à pair. Sans la voix, la discussion écrite reste disponible.' }));
    }
    controls.append(h('span', { class: 'spacer' }), button('Quitter', a.leave, { class: 'danger', id: 'lobby-leave' }));
    clear(hostBox);
    if (room.isHost) {
      const seed = h('input', { type: 'text', maxlength: 16, value: room.settings.seed, onchange: () => a.settings({ seed: seed.value.toUpperCase().trim() || room.settings.seed }) });
      const objective = h('select', { onchange: () => a.settings({ objective: objective.value }) }, h('option', { value: '', text: 'Tiré au sort par la graine' }));
      for (const o of OBJECTIVES.filter((x) => x.kind === 'principal')) objective.append(h('option', { value: o.id, text: o.title }));
      objective.value = room.settings.objective;
      const pub = h('input', { type: 'checkbox', checked: room.settings.isPublic, onchange: () => a.settings({ isPublic: pub.checked }) });
      hostBox.append(h('h3', { text: "Réglages de l'hôte" }), field('Graine', seed), field('Objectif principal', objective), h('label', { class: 'check' }, pub, 'Salon public'));
    } else {
      const brief = room.settings.objective ? OBJECTIVE_BY_ID[room.settings.objective] : null;
      hostBox.append(h('h3', { text: 'Briefing' }), h('p', { class: 'small', text: brief ? brief.brief : "L'objectif sera révélé à l'entrée dans le complexe." }));
    }
  };
  const root = screen(
    h(
      'div',
      { class: 'panel wide' },
      head,
      h('div', { class: 'grid2', style: 'margin-top:16px' }, h('div', { class: 'col' }, members), h('div', { class: 'col' }, hostBox, h('h3', { text: online ? 'Discussion' : 'Discussion (onglets de ce navigateur)' }), chatLog, chatInput)),
      error,
      controls,
    ),
  );
  refresh();
  return {
    root,
    refresh,
    addChat(name, text) {
      chatLog.append(h('div', { class: 'list-item small' }, h('b', { text: `${name} : ` }), text));
      chatLog.scrollTop = chatLog.scrollHeight;
    },
    setError(text) {
      error.textContent = text;
    },
  };
}

/* ------------------------------------------------------------ 9. sélection d'équipement */

export function loadoutScreen(current: string[], done: (loadout: string[]) => void): HTMLElement {
  const chosen = new Set(current.filter((i) => i !== 'lampe'));
  const list = h('div', { class: 'list' });
  const points = h('div', { class: 'code', style: 'font-size:20px' });
  const cost = (): number => Array.from(chosen).reduce((sum, id) => sum + (itemDef(id).loadoutCost ?? 0), 0);
  const render = (): void => {
    clear(list);
    const used = cost();
    points.textContent = `${LOADOUT_POINTS - used} point${LOADOUT_POINTS - used > 1 ? 's' : ''}`;
    for (const item of ITEMS) {
      if (item.loadoutCost === undefined) continue;
      const locked = item.id === 'lampe';
      const on = locked || chosen.has(item.id);
      const affordable = on || used + item.loadoutCost <= LOADOUT_POINTS;
      list.append(
        h(
          'div',
          { class: 'list-item' },
          h('div', { class: 'col', style: 'gap:2px;flex:1' }, h('span', { text: item.name }), h('span', { class: 'muted small', text: item.description })),
          h('span', { class: 'badge', text: `${item.weight} kg` }),
          h('span', { class: 'badge warn', text: locked ? 'fournie' : `${item.loadoutCost} pt` }),
          button(on ? 'Retirer' : 'Prendre', () => ((on ? chosen.delete(item.id) : chosen.add(item.id)), render()), { class: `small ${on ? 'on' : ''}`, disabled: locked || !affordable, id: `loadout-${item.id}` }),
        ),
      );
    }
  };
  render();
  return screen(
    h(
      'div',
      { class: 'panel' },
      h('div', { class: 'row between' }, h('h2', { text: 'Équipement', style: 'margin:0' }), points),
      h('p', { class: 'muted small', style: 'margin:10px 0 14px', text: "Chaque membre choisit ce qu'il emporte. Le reste se trouve dans le complexe — ou pas." }),
      list,
      h('div', { class: 'row', style: 'margin-top:16px' }, button('Valider', () => done(['lampe', ...chosen]), { class: 'primary', id: 'loadout-done' })),
    ),
  );
}

/* ------------------------------------------------------------ 10. chargement */

export function loadingScreen(title: string, lines: string[]): { root: HTMLElement; set(text: string): void } {
  const status = h('p', { class: 'muted', text: lines[0] ?? '' });
  const root = screen(h('h2', { text: title }), status, h('div', { class: 'loading-bar' }, h('i')));
  return { root, set: (text) => (status.textContent = text) };
}

/* ------------------------------------------------------------ 15. paramètres */

export function settingsScreen(settings: Settings, changed: () => void, back: () => void, inGame: boolean): HTMLElement {
  const slider = (label: string, value: number, min: number, max: number, step: number, set: (v: number) => void, fmt: (v: number) => string = (v) => String(Math.round(v * 100))): HTMLElement => {
    const out = h('span', { class: 'badge', text: fmt(value) });
    const input = h('input', {
      type: 'range',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(value),
      oninput: () => {
        const v = Number(input.value);
        set(v);
        out.textContent = fmt(v);
        changed();
      },
    });
    return h('label', { class: 'field' }, h('div', { class: 'row between' }, h('span', { class: 'field-label', text: label }), out), input);
  };
  const check = (label: string, value: boolean, set: (v: boolean) => void): HTMLElement => {
    const input = h('input', { type: 'checkbox', checked: value, onchange: () => (set(input.checked), changed()) });
    return h('label', { class: 'check' }, input, label);
  };
  const quality = h('select', { onchange: () => ((settings.quality = quality.value as Quality), changed()) });
  for (const [id, label] of [['faible', 'Faible (machines modestes)'], ['moyenne', 'Moyenne'], ['elevee', 'Élevée']] as const) quality.append(h('option', { value: id, text: label }));
  quality.value = settings.quality;
  const voiceMode = h('select', { onchange: () => ((settings.voice.mode = voiceMode.value as 'ptt' | 'ouvert'), changed()) }, h('option', { value: 'ptt', text: 'Pousser pour parler' }), h('option', { value: 'ouvert', text: 'Micro ouvert' }));
  voiceMode.value = settings.voice.mode;

  const keys = h('div', { class: 'col', style: 'gap:4px' });
  let listening: ActionId | null = null;
  const capture = (e: KeyboardEvent): void => {
    if (!listening) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code !== 'Escape') {
      // Une touche déjà utilisée est échangée avec l'action qui la portait.
      const other = (Object.keys(settings.keys) as ActionId[]).find((k) => settings.keys[k] === e.code);
      if (other) settings.keys[other] = settings.keys[listening];
      settings.keys[listening] = e.code;
      changed();
    }
    listening = null;
    document.removeEventListener('keydown', capture, true);
    renderKeys();
  };
  const renderKeys = (): void => {
    clear(keys);
    for (const action of Object.keys(ACTION_LABELS) as ActionId[]) {
      const waiting = listening === action;
      keys.append(
        h(
          'div',
          { class: 'stat' },
          h('span', { text: ACTION_LABELS[action] }),
          button(waiting ? 'Appuyez sur une touche…' : keyLabel(settings.keys[action]), () => {
            listening = action;
            document.addEventListener('keydown', capture, true);
            renderKeys();
          }, { class: `small ${waiting ? 'on' : ''}` }),
        ),
      );
    }
    keys.append(h('div', { class: 'row', style: 'margin-top:8px' }, button('Touches par défaut', () => ((settings.keys = { ...DEFAULT_KEYS }), changed(), renderKeys()), { class: 'small' })));
  };
  renderKeys();
  const v = settings.volumes;
  return h(
    'div',
    { class: `screen ${inGame ? 'overlay' : ''}` },
    h(
      'div',
      { class: 'panel wide' },
      h('h2', { text: 'Paramètres' }),
      h(
        'div',
        { class: 'grid2' },
        h(
          'div',
          { class: 'col' },
          h('h3', { text: 'Caméra et souris' }),
          slider('Sensibilité', settings.sensitivity, 0.2, 3, 0.05, (x) => (settings.sensitivity = x), (x) => x.toFixed(2)),
          slider('Champ de vision', settings.fov, 60, 105, 1, (x) => (settings.fov = x), (x) => `${x}°`),
          slider('Oscillation de la caméra', settings.bob, 0, 1, 0.05, (x) => (settings.bob = x), (x) => `${Math.round(x * 100)} %`),
          check('Secousses de caméra (impacts, stress)', settings.shake, (x) => (settings.shake = x)),
          check("Entrée brute de la souris (désactive l'accélération)", settings.rawInput, (x) => (settings.rawInput = x)),
          check("Inverser l'axe vertical", settings.invertY, (x) => (settings.invertY = x)),
          h('h3', { text: 'Affichage' }),
          field('Qualité graphique', quality, "Appliquée au lancement de la prochaine expédition."),
          slider('Échelle de rendu', settings.renderScale, 0.5, 1, 0.05, (x) => (settings.renderScale = x), (x) => `${Math.round(x * 100)} %`),
          button('Plein écran', () => {
            void document.documentElement.requestFullscreen?.().then(() => (navigator as unknown as { keyboard?: { lock(keys?: string[]): Promise<void> } }).keyboard?.lock?.().catch(() => {}));
          }, { class: 'small', title: 'En plein écran, les raccourcis du navigateur (Ctrl + touche) ne ferment plus le jeu.' }),
          h('h3', { text: 'Son' }),
          slider('Volume général', v.general, 0, 1, 0.05, (x) => (v.general = x)),
          slider('Ambiance', v.ambiance, 0, 1, 0.05, (x) => (v.ambiance = x)),
          slider('Effets (pas, portes, machines)', v.effets, 0, 1, 0.05, (x) => (v.effets = x)),
          slider('Entités', v.entites, 0, 1, 0.05, (x) => (v.entites = x)),
          slider('Musique', v.musique, 0, 1, 0.05, (x) => (v.musique = x)),
          slider('Communications', v.comms, 0, 1, 0.05, (x) => (v.comms = x)),
          field('Voix', voiceMode, 'Le microphone se demande depuis le lobby.'),
        ),
        h('div', { class: 'col' }, h('h3', { text: 'Commandes' }), h('p', { class: 'small muted', text: 'Les touches sont repérées par leur position : la disposition par défaut correspond à ZQSD sur un clavier AZERTY. Clic gauche : utiliser · clic droit : lancer · molette : changer d’action ou d’objet · 1 à 8 : emplacements.' }), keys),
      ),
      h('div', { class: 'row', style: 'margin-top:18px' }, button(inGame ? 'Reprendre' : 'Retour', back, { class: 'primary', id: 'settings-back' })),
    ),
  );
}

/* ------------------------------------------------------------ 16-17. mort, extraction */

export function statusOverlay(kind: 'dead' | 'out', detail: string): HTMLElement {
  return h('div', { class: 'screen clear' }, h('div', { class: `big-message ${kind}`, text: kind === 'dead' ? 'VOUS ÊTES MORT' : 'EXTRAIT' }), h('p', { class: 'muted', style: 'margin-top:14px;text-shadow:0 1px 3px #000', text: detail }));
}

/* ------------------------------------------------------------ pause */

export function pauseScreen(a: { resume(): void; settings(): void; abandon(): void }, multiplayer: boolean): HTMLElement {
  return h(
    'div',
    { class: 'screen overlay' },
    h('h2', { text: 'Pause' }),
    multiplayer ? h('p', { class: 'muted small', text: "L'expédition continue pendant que ce menu est ouvert." }) : null,
    h('div', { class: 'menu', style: 'margin-top:12px' }, button('Reprendre', a.resume, { class: 'primary', id: 'pause-resume' }), button('Paramètres', a.settings), button("Abandonner l'expédition", a.abandon, { class: 'danger', id: 'pause-abandon' })),
  );
}

/* ------------------------------------------------------------ 18. résultats */

export function resultsScreen(result: ExpeditionResult, selfId: string, outcome: ResultOutcome | null, a: { lobby(): void; menu(): void }, canLobby: boolean): HTMLElement {
  const success = result.outcome === 'succes';
  const objectives = h('div', { class: 'col' });
  for (const id of result.objectivesDone) objectives.append(h('div', { class: 'row' }, h('span', { class: 'badge ok', text: 'accompli' }), h('span', { text: OBJECTIVE_BY_ID[id]?.title ?? id })));
  for (const id of result.objectivesFailed) objectives.append(h('div', { class: 'row' }, h('span', { class: 'badge bad', text: 'échoué' }), h('span', { text: OBJECTIVE_BY_ID[id]?.title ?? id })));
  if (!result.objectivesDone.includes(result.primary)) objectives.append(h('div', { class: 'row' }, h('span', { class: 'badge bad', text: 'inachevé' }), h('span', { text: OBJECTIVE_BY_ID[result.primary]?.title ?? result.primary })));
  const players = h('div', { class: 'list' });
  const labels: Record<string, [string, string]> = { extrait: ['extrait', 'ok'], mort: ['mort', 'bad'], disparu: ['disparu', 'bad'], abandon: ['abandon', 'warn'] };
  for (const p of result.players) {
    const [label, cls] = labels[p.status]!;
    players.append(h('div', { class: 'list-item' }, h('span', { text: p.name + (p.id === selfId ? ' (vous)' : '') }), h('span', { class: 'spacer' }), h('span', { class: `badge ${cls}`, text: label })));
  }
  const reward = h('div', { class: 'col' });
  if (outcome) {
    reward.append(h('div', { class: 'stat' }, h('span', { text: 'Expérience gagnée' }), h('b', { text: `+${outcome.xp}`, id: 'result-xp' })), h('div', { class: 'stat' }, h('span', { text: 'Niveau' }), h('b', { text: `${outcome.profile.level}${outcome.leveledUp ? ' — niveau supérieur !' : ''}` })));
    for (const id of outcome.newAchievements) reward.append(h('div', { class: 'row' }, h('span', { class: 'badge ok', text: 'succès' }), h('span', { text: ACHIEVEMENTS.find((x) => x.id === id)?.label ?? id })));
    if (outcome.warning) reward.append(h('div', { class: 'notice-box', text: outcome.warning }));
  } else reward.append(h('p', { class: 'muted', text: 'Enregistrement du résultat…' }));
  return screen(
    h(
      'div',
      { class: 'panel wide' },
      h('h2', { text: success ? 'Expédition réussie' : 'Expédition perdue', style: `color:${success ? 'var(--green)' : 'var(--red)'}`, id: 'result-title' }),
      h('p', { class: 'muted', text: `Durée : ${formatDuration(result.duration)} · graine ${result.seed} · ${result.documents.length} document(s) · ${result.creatures.length} entité(s) observée(s)` }),
      h('div', { class: 'grid2' }, h('div', { class: 'col' }, h('h3', { text: 'Objectifs' }), objectives, h('h3', { text: 'Récompenses' }), reward), h('div', { class: 'col' }, h('h3', { text: 'Équipe' }), players)),
      h('div', { class: 'row', style: 'margin-top:18px' }, canLobby ? button('Retour au salon', a.lobby, { class: 'primary', id: 'result-lobby' }) : null, button('Menu principal', a.menu, { id: 'result-menu' })),
    ),
  );
}

/* ------------------------------------------------------------ 19. archives */

export function archivesScreen(profile: Profile, back: () => void): HTMLElement {
  const body = h('div');
  const tabs = h('div', { class: 'tabs' });
  let tab: 'documents' | 'bestiaire' | 'secteurs' | 'objectifs' = 'documents';
  let open = '';
  const render = (): void => {
    clear(tabs);
    for (const [id, label] of [['documents', 'Documents'], ['bestiaire', 'Bestiaire'], ['secteurs', 'Secteurs'], ['objectifs', 'Objectifs']] as const) {
      tabs.append(h('button', { class: `tab ${tab === id ? 'active' : ''}`, type: 'button', text: label, onclick: () => ((tab = id), render()) }));
    }
    clear(body);
    if (tab === 'documents') {
      const list = h('div', { class: 'list' });
      for (const d of DOCUMENTS) {
        const got = profile.documents.includes(d.id);
        list.append(h('div', { class: `list-item ${got ? 'clickable' : ''}`, onclick: () => got && ((open = d.id), render()) }, h('span', { class: got ? '' : 'muted', text: got ? d.title : '— document non récupéré —' }), h('span', { class: 'spacer' }), h('span', { class: 'badge', text: SECTORS.find((s) => s.id === d.sector)!.name })));
      }
      body.append(h('p', { class: 'muted small', text: `${profile.documents.length} / ${DOCUMENTS.length} documents récupérés.` }), h('div', { class: 'grid2' }, list, open && profile.documents.includes(open) ? documentView(open) : h('p', { class: 'muted', text: 'Sélectionnez un document récupéré pour le relire.' })));
    } else if (tab === 'bestiaire') {
      for (const kind of ENTITY_KINDS) {
        const spec = ENTITY_SPECS[kind];
        const seen = profile.creatures.includes(kind);
        body.append(h('h3', { text: seen ? spec.name : '??? — entité non observée' }));
        if (seen) body.append(h('p', { class: 'small', text: spec.summary }), h('p', { class: 'small' }, h('b', { text: 'Comportement. ' }), spec.behaviour), h('p', { class: 'small' }, h('b', { text: 'Parade. ' }), spec.evasion));
        else body.append(h('p', { class: 'small muted', text: "Observez-la au cours d'une expédition pour consigner sa fiche." }));
      }
    } else if (tab === 'secteurs') {
      for (const s of SECTORS) body.append(h('h3', { text: s.name }), h('p', { class: 'small', text: s.role }), h('p', { class: 'small muted', text: `Risque : ${s.hazard}` }));
    } else {
      for (const o of OBJECTIVES) body.append(h('div', { class: 'stat' }, h('span', {}, h('span', { class: `badge ${o.kind === 'principal' ? 'warn' : ''}`, text: o.kind }), ` ${o.title}`), h('b', { text: `${o.xp} XP` })));
    }
  };
  render();
  return screen(h('div', { class: 'panel wide' }, h('h2', { text: 'Archives' }), tabs, body, h('div', { class: 'row', style: 'margin-top:18px' }, button('Retour', back, { id: 'archives-back' }))));
}

export type { Member };
