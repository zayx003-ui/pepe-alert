/**
 * Voix en WebRTC (maillage pair à pair, signalisation par le canal du salon).
 *
 *  - Voix de proximité : spatialisée, atténuée par la distance et les murs.
 *  - Radio : sans position, filtrée en bande étroite, soumise aux mêmes règles
 *    de portée que la radio écrite (appareil allumé, relais, brouillage).
 *
 * Le microphone n'est jamais ouvert sans action explicite du joueur, et le flux
 * n'est ni enregistré ni rejoué : le Visiteur n'imite que des sons de synthèse.
 * Sans serveur TURN, la connexion peut échouer derrière certains pare-feu ; la
 * discussion écrite reste alors disponible et l'interface l'indique.
 */
import type { AudioManager } from '../audio/manager';
import { dist } from '../core/math';
import type { GameSession, SessionLink } from '../game/session';
import { FLAG_RADIO, MSG } from './protocol';

export type VoiceState = 'inactif' | 'demande' | 'actif' | 'refuse' | 'indisponible';
export type VoiceChannel = 'prox' | 'radio';

type Signal =
  | { k: 'offer' | 'answer'; sdp: string }
  | { k: 'ice'; c: RTCIceCandidateInit }
  | { k: 'talk'; ch: VoiceChannel | null }
  | { k: 'hello' };

interface Peer {
  pc: RTCPeerConnection;
  gain: GainNode | null;
  panner: PannerNode | null;
  radio: BiquadFilterNode | null;
  source: MediaStreamAudioSourceNode | null;
  /** Élément audio muet : nécessaire sur Chromium pour que le flux distant soit décodé. */
  sink: HTMLAudioElement | null;
  talking: VoiceChannel | null;
  connected: boolean;
}

const ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
const PROX_RANGE = 18;

export class VoiceChat {
  state: VoiceState = 'inactif';
  /** Joueurs dont la parole est coupée localement. */
  readonly muted = new Set<string>();
  /** Volume propre à chaque joueur (1 par défaut). */
  readonly volumes = new Map<string, number>();
  talking: VoiceChannel | null = null;
  onChange: () => void = () => {};
  private stream: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  private members: string[] = [];

  constructor(
    private link: SessionLink,
    private selfId: string,
    private audio: AudioManager,
  ) {
    if (typeof RTCPeerConnection === 'undefined' || !navigator.mediaDevices?.getUserMedia) this.state = 'indisponible';
  }

  /** Demande l'accès au microphone (à déclencher par un geste de l'utilisateur). */
  async enable(): Promise<VoiceState> {
    if (this.state === 'indisponible' || this.state === 'actif') return this.state;
    this.state = 'demande';
    this.onChange();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      for (const track of this.stream.getAudioTracks()) track.enabled = false;
      this.state = 'actif';
      this.link.send(MSG.RTC, { k: 'hello' } satisfies Signal);
      for (const id of this.members) this.connect(id);
    } catch {
      // Micro refusé ou absent : écoute seule (on entend les autres sans pouvoir parler).
      this.state = 'refuse';
      this.link.send(MSG.RTC, { k: 'hello' } satisfies Signal);
      for (const id of this.members) this.connect(id);
    }
    this.onChange();
    return this.state;
  }

  disable(): void {
    for (const id of Array.from(this.peers.keys())) this.drop(id);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.talking = null;
    if (this.state !== 'indisponible') this.state = 'inactif';
    this.onChange();
  }

  /** Ouvre ou coupe le micro sur un canal (pousser-pour-parler ou micro ouvert). */
  setTalking(ch: VoiceChannel | null): void {
    if (this.state !== 'actif' || ch === this.talking) return;
    this.talking = ch;
    for (const track of this.stream?.getAudioTracks() ?? []) track.enabled = ch !== null;
    this.link.send(MSG.RTC, { k: 'talk', ch } satisfies Signal);
    this.onChange();
  }

  /** Canal sur lequel parle un joueur, ou null. */
  speaking(id: string): VoiceChannel | null {
    if (id === this.selfId) return this.talking;
    return this.peers.get(id)?.talking ?? null;
  }

  connectedPeers(): number {
    let n = 0;
    for (const p of this.peers.values()) if (p.connected) n++;
    return n;
  }

  /** Met à jour la liste des membres du salon : ouvre et ferme les liaisons. */
  setMembers(ids: string[]): void {
    this.members = ids.filter((id) => id !== this.selfId);
    for (const id of Array.from(this.peers.keys())) if (!this.members.includes(id)) this.drop(id);
    if (this.listening) for (const id of this.members) this.connect(id);
  }

  /** La voix est-elle branchée (avec ou sans microphone) ? */
  get listening(): boolean {
    return this.state === 'actif' || this.state === 'refuse';
  }

  private drop(id: string): void {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    p.source?.disconnect();
    p.gain?.disconnect();
    if (p.sink) p.sink.srcObject = null;
    this.peers.delete(id);
    this.onChange();
  }

  private connect(id: string): Peer {
    let peer = this.peers.get(id);
    if (peer) return peer;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    peer = { pc, gain: null, panner: null, radio: null, source: null, sink: null, talking: null, connected: false };
    this.peers.set(id, peer);
    const p = peer;
    const tracks = this.stream?.getAudioTracks() ?? [];
    for (const track of tracks) pc.addTrack(track, this.stream!);
    if (tracks.length === 0) pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.onicecandidate = (e) => {
      if (e.candidate) this.link.send(MSG.RTC, { k: 'ice', c: e.candidate.toJSON() } satisfies Signal, id);
    };
    pc.onconnectionstatechange = () => {
      p.connected = pc.connectionState === 'connected';
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(id);
      this.onChange();
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      const ctx = this.audio.ctx;
      const sink = new Audio();
      sink.srcObject = stream;
      sink.muted = true;
      void sink.play().catch(() => {});
      p.sink = sink;
      p.source = ctx.createMediaStreamSource(stream);
      p.radio = ctx.createBiquadFilter();
      p.radio.type = 'allpass';
      p.panner = ctx.createPanner();
      p.panner.panningModel = 'HRTF';
      p.panner.distanceModel = 'linear';
      p.panner.refDistance = 1.5;
      p.panner.maxDistance = PROX_RANGE;
      p.gain = ctx.createGain();
      p.gain.gain.value = 0;
      p.source.connect(p.radio).connect(p.panner).connect(p.gain).connect(this.audio.voiceBus);
    };
    // Un seul des deux pairs émet l'offre : celui dont l'identifiant est le plus petit.
    if (this.selfId < id) {
      void pc
        .createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => this.link.send(MSG.RTC, { k: 'offer', sdp: pc.localDescription!.sdp } satisfies Signal, id))
        .catch(() => this.drop(id));
    }
    return peer;
  }

  /** Message de signalisation reçu d'un autre joueur. */
  receive(from: string, d: unknown): void {
    const msg = d as Signal;
    if (msg.k === 'talk') {
      const p = this.peers.get(from);
      if (p) p.talking = msg.ch;
      this.onChange();
      return;
    }
    if (!this.listening) return;
    if (msg.k === 'hello') {
      // Un pair vient d'activer sa voix : on (re)négocie proprement.
      this.drop(from);
      if (this.members.includes(from)) this.connect(from);
      return;
    }
    const peer = this.connect(from);
    const pc = peer.pc;
    if (msg.k === 'offer') {
      void pc
        .setRemoteDescription({ type: 'offer', sdp: msg.sdp })
        .then(() => pc.createAnswer())
        .then((answer) => pc.setLocalDescription(answer))
        .then(() => this.link.send(MSG.RTC, { k: 'answer', sdp: pc.localDescription!.sdp } satisfies Signal, from))
        .catch(() => this.drop(from));
    } else if (msg.k === 'answer') {
      void pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp }).catch(() => this.drop(from));
    } else if (msg.k === 'ice') {
      void pc.addIceCandidate(msg.c).catch(() => {});
    }
  }

  /** Applique les règles d'audibilité (distance, murs, radio) à chaque voix. */
  update(session: GameSession | null): void {
    const now = this.audio.ctx.currentTime;
    for (const [id, p] of this.peers) {
      if (!p.gain || !p.panner || !p.radio) continue;
      let level = 0;
      const base = this.muted.has(id) ? 0 : (this.volumes.get(id) ?? 1);
      if (!session) {
        // Lobby : tout le monde s'entend, sans spatialisation.
        level = p.talking ? base : 0;
        p.panner.positionX.value = this.audio.ctx.listener.positionX?.value ?? 0;
        p.panner.positionY.value = this.audio.ctx.listener.positionY?.value ?? 0;
        p.panner.positionZ.value = this.audio.ctx.listener.positionZ?.value ?? 0;
        p.radio.type = 'allpass';
      } else {
        const other = session.players.get(id);
        const me = session.motor;
        if (other && p.talking === 'prox' && other.status === 'playing') {
          const d = dist(other.x, other.z, me.x, me.z);
          const occ = session.world.grid.soundOcclusion(other.x, other.z, me.x, me.z);
          level = d < PROX_RANGE ? base * Math.max(0, 1 - occ * 0.4) : 0;
          p.panner.positionX.value = other.x;
          p.panner.positionY.value = other.y + 1.6;
          p.panner.positionZ.value = other.z;
          p.radio.type = occ > 0.5 ? 'lowpass' : 'allpass';
          p.radio.frequency.value = 2200;
        } else if (other && p.talking === 'radio' && other.flags & FLAG_RADIO && session.inventory.find('radio')?.on) {
          const relay = session.world.fixture('antenna.accueil')?.on === true;
          const d = dist(other.x, other.z, me.x, me.z);
          level = relay || d < 45 ? base * (session.sector.id === 'serveurs' ? 0.35 : 0.85) : 0;
          // Son « radio » : bande étroite, non spatialisé.
          p.panner.positionX.value = me.x;
          p.panner.positionY.value = me.y + 1.6;
          p.panner.positionZ.value = me.z;
          p.radio.type = 'bandpass';
          p.radio.frequency.value = 1700;
          p.radio.Q.value = 1.1;
        }
      }
      p.gain.gain.setTargetAtTime(level, now, 0.05);
    }
  }

  dispose(): void {
    this.disable();
  }
}
