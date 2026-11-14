/**
 * AudioManager — mixage par catégories, sons spatialisés, gestion des priorités,
 * ambiance et musique pilotées par l'état de la partie.
 *
 * Le silence fait partie de la mise en scène : quand une entité observe le
 * joueur à proximité, l'ambiance s'efface presque entièrement.
 */
import type { Settings } from '../config/settings';
import { clamp, dist } from '../core/math';
import type { GameSession, SoundEvent } from '../game/session';
import type { FxMsg } from '../network/protocol';
import { SOUNDS, type Category } from './library';
import { SAMPLE_RATE } from './synth';

const MAX_VOICES = 22;

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  priority: number;
  ends: number;
}

interface Loop {
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner: PannerNode | null;
  target: number;
}

export class AudioManager {
  readonly ctx: AudioContext;
  private master: GainNode;
  private buses: Record<Category, GainNode>;
  private buffers = new Map<string, AudioBuffer>();
  private voices: Voice[] = [];
  private loops = new Map<string, Loop>();
  private session: GameSession | null = null;
  private unsubs: (() => void)[] = [];
  private heartTimer = 0;
  private ambientTimer = 4;
  private hallucinationTimer = 30;
  private radarTimer = 0;
  private duck = 1;
  private ex = 0;
  private ey = 0;
  private ez = 0;
  /** Nombre de sons refusés faute de voix libre (diagnostic). */
  dropped = 0;

  constructor(private settings: Settings) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    // Limiteur doux en sortie : évite la saturation quand beaucoup de sons se superposent.
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 8;
    this.master.connect(limiter).connect(this.ctx.destination);
    const bus = (): GainNode => {
      const g = this.ctx.createGain();
      g.connect(this.master);
      return g;
    };
    this.buses = { ambiance: bus(), environnement: bus(), musique: bus(), entites: bus(), joueur: bus(), interactions: bus(), communications: bus() };
    this.applyVolumes();
  }

  /** Les navigateurs exigent un geste de l'utilisateur avant de produire du son. */
  resume(): void {
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  applyVolumes(): void {
    const v = this.settings.volumes;
    this.master.gain.value = v.general;
    this.buses.ambiance.gain.value = v.ambiance;
    this.buses.environnement.gain.value = v.effets;
    this.buses.interactions.gain.value = v.effets;
    this.buses.joueur.gain.value = v.effets;
    this.buses.entites.gain.value = v.entites;
    this.buses.musique.gain.value = v.musique;
    this.buses.communications.gain.value = v.comms;
  }

  /** Nœud d'entrée pour la voix des coéquipiers (WebRTC). */
  get voiceBus(): GainNode {
    return this.buses.communications;
  }

  private bufferFor(id: string, variant: number): AudioBuffer | null {
    const def = SOUNDS[id];
    if (!def) return null;
    const key = `${id}#${variant}`;
    let buf = this.buffers.get(key);
    if (!buf) {
      const samples = def.make(variant);
      buf = this.ctx.createBuffer(1, samples.length, SAMPLE_RATE);
      buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      this.buffers.set(key, buf);
    }
    return buf;
  }

  /** Libère une voix en évinçant la moins prioritaire si nécessaire. */
  private allocate(priority: number): boolean {
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter((v) => v.ends > now);
    if (this.voices.length < MAX_VOICES) return true;
    let weakest = 0;
    for (let i = 1; i < this.voices.length; i++) {
      const v = this.voices[i]!;
      const w = this.voices[weakest]!;
      if (v.priority < w.priority || (v.priority === w.priority && v.ends < w.ends)) weakest = i;
    }
    if (this.voices[weakest]!.priority > priority) {
      this.dropped++;
      return false;
    }
    const victim = this.voices.splice(weakest, 1)[0]!;
    victim.gain.gain.setTargetAtTime(0, now, 0.02);
    victim.source.stop(now + 0.1);
    return true;
  }

  /**
   * Joue un son. Avec une position, il est spatialisé et étouffé par les murs
   * (`occlusion` : nombre de cloisons traversées).
   */
  play(id: string, opts: { x?: number; y?: number; z?: number; volume?: number; occlusion?: number; rate?: number } = {}): void {
    const def = SOUNDS[id];
    if (!def || this.ctx.state !== 'running') return;
    const spatial = opts.x !== undefined && opts.z !== undefined;
    if (spatial && dist(opts.x!, opts.z!, this.ex, this.ez) > def.max) return;
    if (!this.allocate(def.priority)) return;
    const variant = def.variants ? Math.floor(Math.random() * def.variants) : 0;
    const buf = this.bufferFor(id, variant);
    if (!buf) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buf;
    source.playbackRate.value = (opts.rate ?? 1) * (0.96 + Math.random() * 0.08);
    const gain = this.ctx.createGain();
    const occ = opts.occlusion ?? 0;
    gain.gain.value = def.volume * (opts.volume ?? 1) * (1 - Math.min(0.8, occ * 0.28));
    let node: AudioNode = source;
    if (occ > 0.05) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 16000 / (1 + occ * occ * 5);
      node.connect(lp);
      node = lp;
    }
    if (spatial) {
      const p = this.ctx.createPanner();
      p.panningModel = this.settings.quality === 'faible' ? 'equalpower' : 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = def.ref;
      p.maxDistance = def.max;
      p.rolloffFactor = 1.3;
      p.positionX.value = opts.x!;
      p.positionY.value = opts.y ?? this.ey;
      p.positionZ.value = opts.z!;
      node.connect(p);
      node = p;
    }
    node.connect(gain).connect(this.buses[def.category]);
    source.start();
    this.voices.push({ source, gain, priority: def.priority, ends: this.ctx.currentTime + buf.duration / source.playbackRate.value });
  }

  /** Boucle persistante dont on fait varier le volume cible. */
  private loop(key: string, id: string, target: number, pos?: { x: number; y: number; z: number }): void {
    let l = this.loops.get(key);
    if (!l) {
      if (target <= 0.001 || this.ctx.state !== 'running') return;
      const def = SOUNDS[id]!;
      const buf = this.bufferFor(id, 0);
      if (!buf) return;
      const source = this.ctx.createBufferSource();
      source.buffer = buf;
      source.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      let panner: PannerNode | null = null;
      if (pos) {
        panner = this.ctx.createPanner();
        panner.panningModel = 'equalpower';
        panner.distanceModel = 'inverse';
        panner.refDistance = def.ref;
        panner.maxDistance = def.max;
        panner.rolloffFactor = 1.2;
        source.connect(panner).connect(gain);
      } else source.connect(gain);
      gain.connect(this.buses[def.category]);
      source.start();
      l = { source, gain, panner, target: 0 };
      this.loops.set(key, l);
    }
    if (pos && l.panner) {
      l.panner.positionX.value = pos.x;
      l.panner.positionY.value = pos.y;
      l.panner.positionZ.value = pos.z;
    }
    if (Math.abs(l.target - target) > 0.01) {
      l.target = target;
      l.gain.gain.setTargetAtTime(target * SOUNDS[id]!.volume, this.ctx.currentTime, 0.6);
    }
    if (target <= 0.001 && l.gain.gain.value < 0.003) {
      l.source.stop();
      l.gain.disconnect();
      this.loops.delete(key);
    }
  }

  /* ================================================================ */
  /* Liaison avec la partie                                            */
  /* ================================================================ */

  attach(session: GameSession): void {
    this.detach();
    this.session = session;
    this.unsubs.push(
      session.events.on('sound', (e) => this.onSound(e)),
      session.events.on('fx', (fx) => this.onFx(fx)),
      session.events.on('hurt', () => this.play('impact', { volume: 0.7 })),
      session.events.on('chat', (line) => {
        if (line.ch === 'radio') this.play('radio_bip');
      }),
      session.events.on('notice', (n) => {
        if (n.kind === 'objectif') this.play('reussite');
        else if (n.kind === 'echec' || n.kind === 'mort') this.play('stinger', { volume: 0.6 });
      }),
      session.events.on('status', (st) => {
        if (st === 'dead') this.play('stinger');
      }),
    );
  }

  detach(): void {
    for (const off of this.unsubs) off();
    this.unsubs.length = 0;
    for (const [key, l] of this.loops) {
      l.source.stop();
      l.gain.disconnect();
      this.loops.delete(key);
    }
    this.session = null;
  }

  private occlusion(x: number, z: number): number {
    return this.session ? this.session.world.grid.soundOcclusion(x, z, this.ex, this.ez) : 0;
  }

  private onSound(e: SoundEvent): void {
    if (e.self) this.play(e.id, { volume: e.volume });
    else this.play(e.id, { x: e.x, y: e.y, z: e.z, volume: e.volume, occlusion: this.occlusion(e.x, e.z) });
  }

  private onFx(fx: FxMsg): void {
    const id = fx.type === 'fake' ? `fake_${fx.what}` : fx.sound;
    if (!SOUNDS[id]) return;
    this.play(id, { x: fx.x, y: this.ey, z: fx.z, occlusion: this.occlusion(fx.x, fx.z) });
  }

  /** À appeler à chaque image avec la position et l'orientation de l'écoute. */
  update(dt: number, ex: number, ey: number, ez: number, fx: number, fy: number, fz: number): void {
    this.ex = ex;
    this.ey = ey;
    this.ez = ez;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = ex;
      l.positionY.value = ey;
      l.positionZ.value = ez;
      // Babylon est main gauche, WebAudio main droite : on reste dans le repère du jeu
      // (l'inversion gauche/droite est compensée en inversant l'axe vertical).
      l.forwardX.value = fx;
      l.forwardY.value = fy;
      l.forwardZ.value = fz;
      l.upX.value = 0;
      l.upY.value = -1;
      l.upZ.value = 0;
    }
    const s = this.session;
    if (!s || this.ctx.state !== 'running') return;
    const sim = s.sim;
    const per = sim.perception();
    const playing = s.status === 'playing' && sim.alive;

    /* Silence dramatique : une entité qui observe, tout près, fait taire le décor. */
    let watched = false;
    let hunted = s.chased;
    let staticNear = 0;
    for (const e of s.entities.values()) {
      const d = dist(e.x, e.z, ex, ez);
      if (e.kind === 'visiteur' && e.visible && (e.state === 'observation' || e.state === 'approche') && d < 22) watched = true;
      if (e.kind === 'statique') staticNear = Math.max(staticNear, clamp(1 - d / 12, 0, 1));
      if (e.state === 'chasse' && d < 30) hunted = true;
    }
    this.duck += ((watched ? 0.12 : 1) - this.duck) * Math.min(1, dt * (watched ? 0.8 : 0.4));

    /* Ambiance par secteur */
    const sector = s.sector;
    const powered = s.world.sectorPowered(sector.id);
    const cold = sector.temperature < 12 ? 1 : 0;
    this.loop('grave', 'amb_grave', (0.5 + sector.ambientNoise) * this.duck);
    this.loop('air', 'amb_air', (powered ? 0.6 : 0.25) * this.duck);
    this.loop('froid', 'amb_froid', cold * 0.8 * this.duck);
    this.loop('serveurs', 'amb_serveurs', sector.id === 'serveurs' ? this.duck : 0);
    this.loop('neon', 'neon', powered ? 0.8 * this.duck : 0);

    /* Machines audibles */
    for (const id of ['generator_main.centrale', 'generator_aux.maintenance']) {
      const f = s.world.fixture(id);
      const def = s.world.fixtureDefs.get(id);
      if (!f || !def) continue;
      const level = f.t > 0 ? 1.4 : f.on ? 0.8 : 0;
      this.loop(id, 'generateur', dist(def.x, def.z, ex, ez) < 50 ? level : 0, { x: def.x, y: def.y + 1, z: def.z });
    }
    let leak: { x: number; y: number; z: number } | null = null;
    let best = 34;
    for (const [id, f] of s.world.fixtures) {
      if (!f.broken || !f.on || !id.startsWith('valve.')) continue;
      const def = s.world.fixtureDefs.get(id)!;
      const d = dist(def.x, def.z, ex, ez);
      if (d < best) {
        best = d;
        leak = { x: def.x, y: def.y + 1.1, z: def.z };
      }
    }
    this.loop('vapeur', 'vapeur', leak ? 1 : 0, leak ?? undefined);

    /* Musique : nappe de tension selon la menace, percussion en cas de chasse. */
    const threat = s.mission?.threat ?? 0;
    this.loop('tension', 'tension', playing ? (0.15 + threat * 0.5 + per.heartbeat * 0.3) * this.duck : 0.1);
    this.loop('poursuite', 'poursuite', playing && hunted ? 1 : 0);
    this.loop('parasites', 'parasites', playing ? staticNear * (s.inventory.find('radio')?.on ? 1 : 0.4) : 0);

    /* Corps du joueur */
    this.loop('respiration', 'respiration', playing ? clamp(sim.breathNoise / 6, 0, 1) : 0);
    if (playing && per.heartbeat > 0.25) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        this.heartTimer = 1.05 - per.heartbeat * 0.6;
        this.play('coeur', { volume: 0.3 + per.heartbeat * 0.7 });
      }
    }

    /* Vie du décor : gouttes, métal qui travaille, loin dans les couloirs. */
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = 5 + Math.random() * 14;
      const a = Math.random() * Math.PI * 2;
      const d = 8 + Math.random() * 22;
      const x = ex + Math.sin(a) * d;
      const z = ez + Math.cos(a) * d;
      this.play(Math.random() < 0.5 ? 'goutte' : 'metal_lointain', { x, y: ey, z, occlusion: Math.min(2, this.occlusion(x, z)), volume: this.duck });
    }

    /* Hallucinations sonores sous stress élevé : jamais d'effet sur les commandes. */
    if (playing && sim.stress > 65) {
      this.hallucinationTimer -= dt * (sim.stress > 85 ? 2 : 1);
      if (this.hallucinationTimer <= 0) {
        this.hallucinationTimer = 18 + Math.random() * 25;
        const yaw = s.motor.yaw + Math.PI + (Math.random() - 0.5) * 1.6;
        const d = 3 + Math.random() * 5;
        this.play(Math.random() < 0.55 ? 'murmure' : 'fake_pas', { x: ex + Math.sin(yaw) * d, y: ey, z: ez + Math.cos(yaw) * d });
        sim.addStress(5);
      }
    }

    /* Détecteur de mouvement : bips audibles (et entendus par les entités). */
    if (playing && s.inventory.find('detecteur_mouvement')?.on) {
      this.radarTimer -= dt;
      if (this.radarTimer <= 0) {
        this.radarTimer = 1.1;
        this.play('bip_radar');
      }
    }
  }

  dispose(): void {
    this.detach();
    void this.ctx.close();
  }
}
