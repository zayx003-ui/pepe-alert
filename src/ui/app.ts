/**
 * Contrôleur d'application : enchaîne les écrans et relie le salon, la session
 * de jeu, le rendu, l'audio, la voix et la persistance.
 */
import { AudioManager } from '../audio/manager';
import { detectKeyboardLayout, loadSettings, saveSettings, type Settings } from '../config/settings';
import { GameView } from '../engine/gameView';
import { InputManager, type UiAction } from '../engine/input';
import { Renderer } from '../engine/renderer';
import { GameSession } from '../game/session';
import { MSG, type ExpeditionResult } from '../network/protocol';
import { RoomSession, type Identity, type LobbySettings, type StartPayload } from '../network/room';
import { SupabaseTransport, supabase, supabaseConfigured } from '../network/supabase';
import { LocalTransport, type Transport } from '../network/transport';
import { VoiceChat } from '../network/voice';
import type { Profile } from '../persistence/progression';
import { LocalProfileStore, SupabaseProfileStore, type ProfileStore, type ResultOutcome } from '../persistence/store';
import { DOCUMENT_BY_ID } from '../world/lore';
import { h } from './dom';
import { Hud } from './hud';
import { Tablet, TerminalPanel, type CameraFeed, type TabletTab } from './panels';
import {
  accountScreen,
  archivesScreen,
  bootScreen,
  createRoomScreen,
  findRoomScreen,
  loadingScreen,
  loadoutScreen,
  lobbyScreen,
  menuScreen,
  pauseScreen,
  profileScreen,
  resultsScreen,
  settingsScreen,
  statusOverlay,
  type LobbyView,
} from './screens';
import './styles.css';

const LOBBY_CHAT = 'lchat';

export class App {
  private ui = document.getElementById('ui') as HTMLElement;
  private canvas = document.getElementById('scene') as HTMLCanvasElement;
  private settings: Settings = loadSettings();
  private params = new URLSearchParams(location.search);
  private store: ProfileStore = new LocalProfileStore();
  private profile!: Profile;
  private online = false;
  private audio: AudioManager | null = null;
  private current: HTMLElement | null = null;
  /* Salon */
  private room: RoomSession | null = null;
  private lobby: LobbyView | null = null;
  private voice: VoiceChat | null = null;
  private roomUnsubs: (() => void)[] = [];
  private roomTimer = 0;
  private roomInterval = 0;
  /* Partie */
  private session: GameSession | null = null;
  private renderer: Renderer | null = null;
  private view: GameView | null = null;
  private input: InputManager | null = null;
  private hud: Hud | null = null;
  private tablet: Tablet | null = null;
  private terminal: TerminalPanel | null = null;
  private overlay: HTMLElement | null = null;
  private statusBanner: HTMLElement | null = null;
  private inGame = false;
  private resultShown = false;

  async start(): Promise<void> {
    await detectKeyboardLayout();
    await this.resolveAccount();
    window.addEventListener('beforeunload', (e) => {
      // Protège d'une fermeture accidentelle (Ctrl + Z ferme l'onglet sur un clavier AZERTY).
      if (this.inGame && this.session && !this.session.result) e.preventDefault();
    });
    const note = this.online ? 'En ligne' : supabaseConfigured ? 'Non connecté — mode local' : 'Mode local (Supabase non configuré)';
    this.show(
      bootScreen(() => {
        this.audio = new AudioManager(this.settings);
        this.audio.resume();
        this.audio.play('ui_ouvre');
        this.showMenu();
        const auto = this.params.get('auto');
        if (auto === 'solo') void this.createRoom({ isPublic: false, maxPlayers: 1, seed: this.params.get('seed') ?? '' }, true);
      }, note),
    );
    (window as unknown as Record<string, unknown>)['nocturne'] = this;
  }

  /* ================================================================ */
  /* Compte et profil                                                  */
  /* ================================================================ */

  private async resolveAccount(): Promise<void> {
    this.online = false;
    this.store = new LocalProfileStore();
    if (supabase && this.params.get('local') !== '1') {
      try {
        const { data } = await supabase.auth.getSession();
        const user = data.session?.user;
        if (user) {
          const store = new SupabaseProfileStore(supabase, user.id);
          this.profile = await store.load();
          this.store = store;
          this.online = true;
          return;
        }
      } catch (e) {
        console.warn('[compte] session en ligne indisponible, passage en mode local :', e);
      }
    }
    this.profile = await this.store.load();
  }

  private get transport(): Transport {
    return this.online && supabase ? new SupabaseTransport(supabase) : new LocalTransport();
  }

  /**
   * Identité présentée au salon. En mode local, le profil est commun à tous les
   * onglets du navigateur : chaque onglet reçoit donc son propre identifiant de joueur.
   */
  private get identity(): Identity {
    let id = this.profile.id;
    let name = this.profile.name;
    if (!this.online) {
      let tab = sessionStorage.getItem('nocturne.onglet');
      if (!tab) {
        tab = Math.random().toString(36).slice(2, 6);
        sessionStorage.setItem('nocturne.onglet', tab);
      }
      id = `${id}-${tab}`;
      // Paramètre d'URL pratique pour distinguer les onglets lors d'essais locaux.
      name = this.params.get('nom')?.slice(0, 20) || name;
    }
    return { id, name, title: this.profile.title, color: this.profile.color };
  }

  /* ================================================================ */
  /* Écrans                                                            */
  /* ================================================================ */

  /**
   * Remplace l'écran courant ; le nouvel écran apparaît en fondu. L'ancien est retiré
   * aussitôt : deux écrans ne coexistent jamais (pas de bouton fantôme encore cliquable).
   */
  private show(next: HTMLElement | null): void {
    this.current?.remove();
    this.current = next;
    if (next) {
      this.ui.append(next);
      requestAnimationFrame(() => requestAnimationFrame(() => next.classList.add('visible')));
    }
  }

  private click(): void {
    this.audio?.play('ui_clic');
  }

  private showMenu(): void {
    this.show(
      menuScreen(this.profile, this.online, supabaseConfigured, {
        solo: () => (this.click(), void this.createRoom({ isPublic: false, maxPlayers: 1, name: 'Expédition en solo' }, true)),
        create: () => (this.click(), this.show(createRoomScreen(this.profile, this.online, (s) => this.createRoom(s, false), () => this.showMenu()))),
        join: () => (this.click(), this.show(findRoomScreen(() => this.transport.listRooms(), (code) => this.joinRoom(code), () => this.showMenu()))),
        profile: () => (this.click(), this.showProfile()),
        archives: () => (this.click(), this.show(archivesScreen(this.profile, () => this.showMenu()))),
        settings: () => (this.click(), this.showSettings(() => this.showMenu())),
        account: () => (this.click(), this.showAccount('connexion')),
      }),
    );
  }

  private showProfile(): void {
    this.show(
      profileScreen(
        this.profile,
        async (patch) => {
          try {
            this.profile = await this.store.saveIdentity(patch);
            return null;
          } catch (e) {
            return e instanceof Error ? e.message : String(e);
          }
        },
        () => this.showMenu(),
      ),
    );
  }

  private showSettings(back: () => void): void {
    const el = settingsScreen(
      this.settings,
      () => {
        saveSettings(this.settings);
        this.audio?.applyVolumes();
        this.input?.rebind();
      },
      back,
      this.inGame,
    );
    if (this.inGame) this.setOverlay(el);
    else this.show(el);
  }

  private showAccount(mode: 'connexion' | 'inscription'): void {
    const refresh = async (): Promise<string | null> => {
      await this.resolveAccount();
      if (!this.online) return 'Connexion établie, mais le profil reste introuvable. Vérifiez que les migrations SQL sont appliquées.';
      this.showMenu();
      return null;
    };
    this.show(
      accountScreen(
        mode,
        supabaseConfigured,
        this.online,
        this.profile,
        {
          signIn: async (email, password) => {
            const { error } = await supabase!.auth.signInWithPassword({ email, password });
            return error ? error.message : refresh();
          },
          signUp: async (email, password, name) => {
            const { data, error } = await supabase!.auth.signUp({ email, password, options: { data: { display_name: name } } });
            if (error) return error.message;
            if (!data.session) return 'Compte créé. Confirmez votre adresse depuis le courriel reçu, puis connectez-vous.';
            return refresh();
          },
          guest: async () => {
            const { error } = await supabase!.auth.signInAnonymously();
            return error ? `Compte invité refusé : ${error.message}` : refresh();
          },
          signOut: async () => {
            await supabase?.auth.signOut();
            await this.resolveAccount();
            this.showMenu();
          },
          back: () => this.showMenu(),
        },
        (m) => this.showAccount(m),
      ),
    );
  }

  /* ================================================================ */
  /* Salon                                                             */
  /* ================================================================ */

  private async createRoom(settings: Partial<LobbySettings>, quick: boolean): Promise<string | null> {
    try {
      // Le solo n'a besoin d'aucun réseau, même connecté.
      const transport = settings.maxPlayers === 1 ? new LocalTransport() : this.transport;
      const room = await RoomSession.create(transport, this.identity, settings);
      this.enterRoom(room);
      if (quick && this.params.get('auto') === 'solo') void this.launch();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  private async joinRoom(code: string): Promise<string | null> {
    if (code.trim().length !== 5) return 'Le code comporte cinq caractères.';
    try {
      const room = await RoomSession.join(this.transport, code, this.identity);
      // Laisse à l'hôte le temps de répondre (acceptation ou refus).
      await new Promise((r) => setTimeout(r, 450));
      if (room.closedReason) return room.closedReason;
      this.enterRoom(room);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  private enterRoom(room: RoomSession): void {
    this.room = room;
    if (this.audio && room.settings.maxPlayers > 1) {
      this.voice = new VoiceChat(room, room.self.id, this.audio);
      this.voice.onChange = () => this.lobby?.refresh();
    }
    const on = room.events;
    this.roomUnsubs.push(
      on.on('members', (members) => {
        this.lobby?.refresh();
        this.voice?.setMembers(members.filter((m) => m.state !== 'disconnected').map((m) => m.id));
        if (this.session) for (const m of members) this.session.setConnected(m.id, m.state !== 'disconnected');
      }),
      on.on('settings', () => this.lobby?.refresh()),
      on.on('host', (id) => {
        this.lobby?.refresh();
        this.session?.setHost(id);
      }),
      on.on('status', (s) => {
        this.lobby?.refresh();
        if (this.hud) this.hud.network = s === 'connected' ? '' : 'RECONNEXION…';
        if (s === 'connected') this.session?.requestSync();
      }),
      on.on('closed', (reason) => {
        this.leaveRoom();
        this.showMenu();
        setTimeout(() => this.toastMenu(reason), 400);
      }),
      on.on('start', (payload) => void this.loadExpedition(payload)),
      on.on('go', () => this.beginPlay()),
      on.on('message', (m) => {
        if (m.t === LOBBY_CHAT) {
          const d = m.d as { name: string; text: string };
          this.lobby?.addChat(String(d.name).slice(0, 20), String(d.text).slice(0, 160));
        } else if (m.t === MSG.RTC) this.voice?.receive(m.f, m.d);
        else this.session?.receive(m);
      }),
    );
    // Le salon doit continuer à battre même quand aucune image n'est rendue (menus).
    this.roomInterval = window.setInterval(() => {
      if (!this.inGame) this.room?.tick();
      if (!this.inGame) this.voice?.update(null);
    }, 400);
    this.showLobby();
    if (room.phase !== 'lobby' && room.startPayload) void this.loadExpedition(room.startPayload);
  }

  private toastMenu(text: string): void {
    const box = h('div', { class: 'notice-box', style: 'position:absolute;top:24px;left:50%;transform:translateX(-50%)', text });
    this.ui.append(box);
    setTimeout(() => box.remove(), 5000);
  }

  private showLobby(): void {
    const room = this.room;
    if (!room) return;
    this.lobby = lobbyScreen(room, this.voice, this.online, {
      ready: (r) => (this.click(), room.setReady(r), this.lobby?.refresh()),
      loadout: () =>
        this.show(
          loadoutScreen(room.me.loadout, (loadout) => {
            room.setLoadout(loadout);
            this.showLobby();
          }),
        ),
      start: () => void this.launch(),
      leave: () => {
        this.leaveRoom();
        this.showMenu();
      },
      chat: (text) => {
        room.send(LOBBY_CHAT, { name: room.self.name, text });
        this.lobby?.addChat(room.self.name, text);
      },
      settings: (patch) => room.updateSettings(patch),
      voice: () => {
        this.audio?.resume();
        if (this.voice?.listening) this.voice.disable();
        else void this.voice?.enable();
      },
    });
    this.show(this.lobby.root);
  }

  /** Hôte : ouvre la session (côté serveur en ligne) puis lance le chargement chez tous. */
  private async launch(): Promise<void> {
    const room = this.room;
    if (!room || !room.isHost) return;
    try {
      const players = room.list().map((m) => m.id);
      const sessionId = await this.store.openSession(room.code, room.settings.seed, players);
      if (!room.start(sessionId)) this.lobby?.setError('Tous les joueurs doivent être prêts.');
    } catch (e) {
      this.lobby?.setError(e instanceof Error ? e.message : String(e));
    }
  }

  private leaveRoom(): void {
    this.endGame();
    for (const off of this.roomUnsubs.splice(0)) off();
    window.clearInterval(this.roomInterval);
    this.voice?.dispose();
    this.voice = null;
    this.room?.leave();
    this.room = null;
    this.lobby = null;
  }

  /* ================================================================ */
  /* Partie                                                            */
  /* ================================================================ */

  private async loadExpedition(payload: StartPayload): Promise<void> {
    const room = this.room;
    if (!room || this.session) return;
    this.lobby = null;
    const loading = loadingScreen('Descente dans le complexe', [`Génération de la carte — graine ${payload.seed}`]);
    this.show(loading.root);
    // Laisse le navigateur afficher l'écran avant les calculs lourds.
    await new Promise((r) => setTimeout(r, 380));
    try {
      const session = new GameSession({ seed: payload.seed, sessionId: payload.sessionId, self: room.self, roster: payload.roster, hostId: room.hostId, objective: payload.objective, link: room });
      this.session = session;
      loading.set('Synthèse des matériaux et construction des secteurs…');
      await new Promise((r) => setTimeout(r, 30));
      const quality = (this.params.get('q') as Settings['quality'] | null) ?? this.settings.quality;
      if (!this.renderer) this.renderer = new Renderer(this.canvas, quality, this.settings.renderScale);
      else this.renderer.resetScene();
      this.view = new GameView(this.renderer, session, this.settings);
      this.input = new InputManager(this.canvas, this.settings);
      this.audio?.attach(session);
      this.wireSession(session);
      loading.set(payload.roster.length > 1 ? 'En attente des autres joueurs…' : 'Ouverture du sas…');
      room.markLoaded();
      if (room.phase === 'playing') this.beginPlay();
    } catch (e) {
      console.error(e);
      loading.set(`Chargement impossible : ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private wireSession(session: GameSession): void {
    session.events.on('terminal', (id) => this.openTerminal(id));
    session.events.on('document', (id) => this.hud?.toast('objet', `Document récupéré : ${DOCUMENT_BY_ID[id]?.title ?? id}`));
    session.events.on('status', (status) => {
      this.closePanels();
      this.statusBanner?.remove();
      const others = Array.from(session.players.values()).some((p) => p.id !== session.self.id && p.status === 'playing');
      this.statusBanner = statusOverlay(status === 'dead' ? 'dead' : 'out', status === 'dead' ? (others ? 'Vous observez vos coéquipiers.' : "Il ne reste personne.") : "En attente du reste de l'équipe…");
      this.ui.append(this.statusBanner);
      const banner = this.statusBanner;
      requestAnimationFrame(() => banner.classList.add('visible'));
      setTimeout(() => banner.classList.remove('visible'), 4200);
      setTimeout(() => banner.remove(), 4700);
      this.room?.setState(status === 'dead' ? 'dead' : 'extracted');
    });
    session.events.on('ended', (result) => void this.showResults(result));
  }

  /** Tous les joueurs ont chargé : la partie commence. */
  private beginPlay(): void {
    const { session, renderer, view, input } = this;
    if (!session || !renderer || !view || !input || this.inGame) return;
    this.inGame = true;
    this.resultShown = false;
    this.show(null);
    this.hud = new Hud(this.ui, session, this.settings);
    this.hud.onChatClosed = () => input.lock();
    input.onWantLock = () => {
      this.audio?.resume();
      if (!this.overlay && !this.tablet && !this.terminal) input.lock();
    };
    input.onLockChange = (locked) => {
      // Échap libère la souris : on affiche le menu de pause si rien d'autre n'est ouvert.
      if (!locked && this.inGame && !this.overlay && !this.tablet && !this.terminal && !this.hud?.chatOpen && !session.result) this.openPause();
    };
    input.onUiAction = (a) => this.onUiAction(a);
    this.canvas.addEventListener('pointerdown', this.onCanvasClick);
    this.hud.toast('info', 'Cliquez pour prendre le contrôle. Tab : inventaire · M : carte · Échap : menu.');
    // Arrivée en cours de partie : récupère l'état complet auprès de l'hôte.
    if (!session.isHost) session.requestSync();
    renderer.start((dt) => this.frame(dt));
  }

  private onCanvasClick = (): void => {
    const s = this.session;
    if (s && s.status !== 'playing' && this.input?.locked) this.view?.cycleSpectator();
  };

  private frame(dt: number): void {
    const { session, view, input, hud } = this;
    if (!session || !view || !input || !hud) return;
    const blocked = this.overlay !== null || this.tablet !== null || this.terminal !== null || hud.chatOpen || view.external !== null;
    const look = input.consumeLook(dt);
    if (!blocked && session.status === 'playing' && !session.hiddenIn) {
      session.motor.yaw += look.x;
      session.motor.pitch = Math.max(-1.45, Math.min(1.45, session.motor.pitch + look.y));
    } else if (session.hiddenIn && !blocked) {
      // Dans un casier, on ne peut que tourner légèrement la tête.
      session.motor.yaw += look.x * 0.3;
    }
    const frame = input.sample(blocked);
    if (view.external && input.locked && (frame.interactPressed || frame.usePressed)) this.closeCamera();
    session.update(dt, frame);
    view.update(dt);
    this.audio?.update(dt, view.eye.x, view.eye.y, view.eye.z, view.forward.x, view.forward.y, view.forward.z);
    hud.update(dt);
    this.tablet?.update(dt);
    this.terminal?.update(dt);

    /* Voix : pousser-pour-parler ou micro ouvert. */
    const voice = this.voice;
    if (voice) {
      const open = this.settings.voice.mode === 'ouvert' && session.status === 'playing';
      voice.setTalking(session.status !== 'playing' ? null : input.talkRadio && session.inventory.find('radio')?.on ? 'radio' : input.talk || open ? 'prox' : null);
      voice.update(session);
      hud.voice = voice.state === 'actif' ? (voice.talking ? `● MICRO ${voice.talking === 'radio' ? 'RADIO' : 'PROXIMITÉ'}` : 'VOIX') : voice.state === 'refuse' ? 'ÉCOUTE SEULE' : '';
    }
    this.roomTimer -= dt;
    if (this.roomTimer <= 0) {
      this.roomTimer = 0.25;
      this.room?.tick();
    }
  }

  private onUiAction(a: UiAction): void {
    const s = this.session;
    if (!s || !this.inGame || s.result) return;
    if (a === 'menu') {
      if (this.view?.external) this.closeCamera();
      else if (this.tablet || this.terminal) this.closePanels(true);
      else if (this.hud?.chatOpen) this.hud.closeChat();
      else if (this.overlay) this.closeOverlay(true);
      else this.openPause();
      return;
    }
    if (this.overlay || this.terminal || this.hud?.chatOpen) return;
    if (a === 'discussion' || a === 'radio') {
      // Sans voix active, la touche radio ouvre la discussion écrite sur le canal radio.
      if (a === 'radio' && this.voice?.state === 'actif') return;
      if (this.tablet) return;
      this.input?.unlock();
      this.hud?.openChat(a === 'radio' ? 'radio' : 'prox');
      return;
    }
    if (s.status !== 'playing') return;
    const tab: TabletTab = a;
    if (this.tablet) {
      if (this.tablet.current === tab) this.closePanels(true);
      else this.tablet.show(tab);
      return;
    }
    this.input?.unlock();
    this.audio?.play('ui_ouvre');
    this.tablet = new Tablet(this.ui, s, this.profile.documents, { close: () => this.closePanels(true), watch: (feed) => this.watch(feed) });
    this.tablet.show(tab);
  }

  private openTerminal(id: string): void {
    const s = this.session;
    if (!s || this.terminal) return;
    this.closePanels();
    this.input?.unlock();
    this.audio?.play('ui_ouvre');
    this.terminal = new TerminalPanel(this.ui, s, id, { close: () => this.closePanels(true), watch: (feed) => this.watch(feed) });
  }

  private watch(feed: CameraFeed): void {
    if (!this.view || !this.hud) return;
    this.tablet?.root.classList.remove('visible');
    this.terminal?.root.classList.remove('visible');
    if (this.tablet) this.tablet.root.style.display = 'none';
    if (this.terminal) this.terminal.root.style.display = 'none';
    this.view.external = { x: feed.x, y: feed.y, z: feed.z, yaw: feed.yaw, pitch: feed.pitch };
    this.hud.cctvLabel = feed.label;
    this.input?.lock();
  }

  private closeCamera(): void {
    if (!this.view || !this.hud) return;
    this.view.external = null;
    this.hud.cctvLabel = '';
    for (const panel of [this.tablet, this.terminal]) {
      if (!panel) continue;
      panel.root.style.display = '';
      panel.root.classList.add('visible');
    }
    if (this.tablet || this.terminal) this.input?.unlock();
  }

  private closePanels(relock = false): void {
    if (this.view?.external) {
      this.view.external = null;
      if (this.hud) this.hud.cctvLabel = '';
    }
    this.tablet?.dispose();
    this.tablet = null;
    this.terminal?.dispose();
    this.terminal = null;
    if (relock && this.inGame) this.input?.lock();
  }

  private setOverlay(el: HTMLElement): void {
    this.overlay?.remove();
    this.overlay = el;
    this.ui.append(el);
    requestAnimationFrame(() => el.classList.add('visible'));
  }

  private closeOverlay(relock: boolean): void {
    this.overlay?.remove();
    this.overlay = null;
    if (relock && this.inGame) this.input?.lock();
  }

  private openPause(): void {
    if (this.overlay || !this.inGame) return;
    this.input?.unlock();
    const multiplayer = (this.session?.players.size ?? 1) > 1;
    this.setOverlay(
      pauseScreen(
        {
          resume: () => this.closeOverlay(true),
          settings: () => this.showSettings(() => this.closeOverlay(true)),
          abandon: () => {
            this.closeOverlay(false);
            this.session?.abandon();
            // Seul en jeu, l'hôte clôt aussitôt ; à plusieurs, on quitte le salon.
            if (multiplayer) {
              this.leaveRoom();
              this.showMenu();
            }
          },
        },
        multiplayer,
      ),
    );
  }

  private async showResults(result: ExpeditionResult): Promise<void> {
    if (this.resultShown) return;
    this.resultShown = true;
    const session = this.session;
    const isHost = session?.isHost ?? false;
    const selfId = session?.self.id ?? this.profile.id;
    // Laisse voir la fin (mort, sas) avant de couper.
    await new Promise((r) => setTimeout(r, 2200));
    this.endGame();
    // Le salon repasse aussitôt en phase de lobby : si l'hôte relance pendant qu'un joueur
    // lit encore ses résultats, celui-ci est embarqué dans la nouvelle expédition.
    this.room?.backToLobby();
    const canLobby = this.room !== null;
    const actions = {
      lobby: () => this.showLobby(),
      menu: () => {
        this.leaveRoom();
        this.showMenu();
      },
    };
    this.show(resultsScreen(result, selfId, null, actions, canLobby));
    let outcome: ResultOutcome;
    try {
      outcome = await this.store.recordResult(result, isHost, selfId);
      this.profile = outcome.profile;
    } catch (e) {
      outcome = { profile: this.profile, xp: 0, newAchievements: [], leveledUp: false, warning: `Résultat non enregistré : ${e instanceof Error ? e.message : String(e)}` };
    }
    if (this.current && !this.inGame && !this.lobby) this.show(resultsScreen(result, selfId, outcome, actions, canLobby));
  }

  /** Démonte tout ce qui appartient à la partie en cours. */
  private endGame(): void {
    this.inGame = false;
    this.canvas.removeEventListener('pointerdown', this.onCanvasClick);
    this.closePanels();
    this.overlay?.remove();
    this.overlay = null;
    this.statusBanner?.remove();
    this.hud?.dispose();
    this.hud = null;
    this.input?.dispose();
    this.input = null;
    this.audio?.detach();
    this.renderer?.stop();
    this.view?.dispose();
    this.view = null;
    this.session = null;
  }
}
