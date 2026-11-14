/**
 * Interface en jeu : informations vitales, objectifs, invite d'interaction,
 * discussion, lecture des appareils. Volontairement discrète : petits
 * caractères en bord d'écran, rien au centre hormis le point de visée.
 */
import { keyLabel, type Settings } from '../config/settings';
import { formatClock } from '../core/math';
import type { GameSession } from '../game/session';
import { itemDef, itemLabel } from '../inventory/items';
import { currentStepLabel } from '../missions/manager';
import { OBJECTIVE_BY_ID } from '../missions/objectives';
import { INJURY_NAMES } from '../player/simulation';
import { ROOM_NAMES } from '../world/dressing';
import { clear, h } from './dom';

const GLYPHS: Record<string, string> = {
  lampe: 'LMP',
  radio: 'RAD',
  medkit: 'MED',
  piles: 'PIL',
  fusible: 'FUS',
  carte: 'CRT',
  detecteur_mouvement: 'MVT',
  detecteur_sonore: 'SON',
  camera: 'CAM',
  outils: 'OUT',
  marqueurs: 'MRQ',
  mesureur: 'MES',
  serum: 'SER',
  echantillon: 'ECH',
  disque: 'DSQ',
  bande: 'BND',
  cellule: 'CEL',
  dossier: 'DOS',
};

export function itemGlyph(id: string): string {
  return GLYPHS[id] ?? id.slice(0, 3).toUpperCase();
}

/** Met à jour le texte d'un élément uniquement s'il a changé. */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

export class Hud {
  readonly root: HTMLElement;
  /** État de la liaison et de la voix, renseigné par l'application. */
  network = '';
  voice = '';
  chatOpen = false;
  chatChannel: 'prox' | 'radio' = 'prox';
  /** Libellé de la caméra consultée (vide = vue normale). */
  cctvLabel = '';
  private status = h('div', { class: 'status-line' });
  private objectives = h('div', { class: 'objectives' });
  private toasts = h('div', { class: 'toasts' });
  private prompt = h('div', { class: 'prompt' });
  private conditions = h('div', { class: 'conditions' });
  private bars: Record<string, HTMLElement> = {};
  private slots: HTMLElement[] = [];
  private activeItem = h('div', { class: 'active-item' });
  private chat = h('div', { class: 'chat' });
  private chatLines = h('div');
  private chatInput: HTMLInputElement;
  private chatTag = h('span', { class: 'badge' });
  private device = h('div', { class: 'device' });
  private radar: HTMLCanvasElement;
  private deviceLines = h('div');
  private cctv = h('div', { class: 'cctv' });
  private crosshair = h('div', { class: 'crosshair' });
  private center = h('div', { class: 'prompt', style: 'top:38%' });
  private timer = 0;
  private invRevision = -1;
  private promptKey = '';
  private objectiveKey = '';
  private conditionKey = '';
  private lastFake = -99;
  private lastOrganic = -99;
  private unsubs: (() => void)[] = [];

  constructor(
    parent: HTMLElement,
    private session: GameSession,
    private settings: Settings,
  ) {
    const bar = (cls: string, label: string): HTMLElement => {
      const fill = h('i');
      this.bars[cls] = fill;
      return h('div', { class: `vital ${cls}` }, h('span', { text: label, style: 'width:54px' }), h('div', { class: 'bar' }, fill));
    };
    const vitals = h('div', { class: 'vitals' }, this.conditions, bar('health', 'SANTÉ'), bar('stamina', 'SOUFFLE'), bar('stress', 'STRESS'), bar('noise', 'BRUIT'));
    const slotRow = h('div', { class: 'hotbar-slots' });
    for (let i = 0; i < 8; i++) {
      const slot = h('div', { class: 'slot' }, h('span', { text: String(i + 1) }), h('span', { class: 'glyph' }));
      this.slots.push(slot);
      slotRow.append(slot);
    }
    this.chatInput = h('input', {
      type: 'text',
      maxlength: 160,
      placeholder: 'Message…',
      onkeydown: (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') this.submitChat();
        else if (e.key === 'Escape') this.closeChat();
        else if (e.key === 'Tab') {
          e.preventDefault();
          this.setChannel(this.chatChannel === 'prox' ? 'radio' : 'prox');
        }
      },
    });
    this.chat.append(this.chatLines, h('div', { class: 'chat-input' }, this.chatTag, this.chatInput));
    this.radar = h('canvas');
    this.radar.width = 150;
    this.radar.height = 90;
    this.device.append(this.radar, this.deviceLines);
    this.cctv.append(h('div', { class: 'label' }), h('div', { class: 'rec', text: '● REC' }), h('div', { class: 'hint', text: `${keyLabel(settings.keys.interagir)} ou Échap : quitter la caméra` }));
    this.root = h(
      'div',
      { class: 'hud' },
      this.cctv,
      this.crosshair,
      this.status,
      this.objectives,
      this.toasts,
      this.prompt,
      this.center,
      vitals,
      h('div', { class: 'hotbar' }, this.activeItem, slotRow),
      this.chat,
      this.device,
    );
    parent.append(this.root);
    requestAnimationFrame(() => this.root.classList.add('visible'));

    this.unsubs.push(
      session.events.on('notice', (n) => this.toast(n.kind, n.text)),
      session.events.on('chat', (line) => {
        const cls = `chat-line ${line.ch}${line.flagged ? ' flagged' : ''}`;
        const who = line.ch === 'radio' ? `[RADIO] ${line.name}` : line.name;
        const el = h('div', { class: cls }, h('span', { class: 'who', text: `${who} : ` }), line.text, line.flagged ? h('span', { class: 'who', text: '  ⚠ signature non organique' }) : null);
        this.chatLines.append(el);
        while (this.chatLines.childElementCount > 8) this.chatLines.firstElementChild!.remove();
      }),
      session.events.on('fx', (fx) => {
        if (fx.type === 'fake') this.lastFake = session.time;
        else this.lastOrganic = session.time;
      }),
    );
    this.setChannel('prox');
  }

  toast(kind: string, text: string): void {
    if (!text) return;
    // Pas de doublon immédiat (même refus répété).
    const last = this.toasts.lastElementChild as HTMLElement | null;
    if (last && last.textContent === text && Date.now() - Number(last.dataset['at']) < 1500) return;
    const el = h('div', { class: `toast ${kind}`, text, 'data-at': String(Date.now()) });
    this.toasts.append(el);
    while (this.toasts.childElementCount > 4) this.toasts.firstElementChild!.remove();
    setTimeout(() => el.remove(), 5600);
  }

  /* ---------------- discussion ---------------- */

  private setChannel(ch: 'prox' | 'radio'): void {
    this.chatChannel = ch;
    this.chatTag.textContent = ch === 'radio' ? 'RADIO' : 'PROXIMITÉ';
    this.chatTag.className = `badge ${ch === 'radio' ? 'warn' : ''}`;
  }

  openChat(ch: 'prox' | 'radio'): void {
    this.setChannel(ch);
    this.chatOpen = true;
    this.chat.classList.add('open');
    this.chatInput.value = '';
    setTimeout(() => this.chatInput.focus(), 0);
  }

  closeChat(): void {
    this.chatOpen = false;
    this.chat.classList.remove('open');
    this.chatInput.blur();
    this.onChatClosed();
  }

  /** Appelé à la fermeture de la discussion (l'application recapture la souris). */
  onChatClosed: () => void = () => {};

  private submitChat(): void {
    const text = this.chatInput.value;
    if (text.trim()) {
      const error = this.session.sendChat(this.chatChannel, text);
      if (error) this.toast('refus', error);
    }
    this.closeChat();
  }

  /* ---------------- rafraîchissement ---------------- */

  update(dt: number): void {
    const s = this.session;
    const sim = s.sim;
    const playing = s.status === 'playing' && sim.alive;

    // Les jauges suivent en continu ; le reste est rafraîchi dix fois par seconde.
    this.bars['health']!.style.width = `${sim.health}%`;
    this.bars['stamina']!.style.width = `${sim.stamina}%`;
    this.bars['stress']!.style.width = `${sim.stress}%`;
    this.bars['noise']!.style.width = `${Math.min(100, (s.noise / 14) * 100)}%`;
    this.updatePrompt(playing);

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.1;

    this.cctv.style.display = this.cctvLabel ? '' : 'none';
    if (this.cctvLabel) setText(this.cctv.firstElementChild as HTMLElement, this.cctvLabel);
    this.crosshair.style.display = playing && !this.cctvLabel && !s.hiddenIn ? '' : 'none';

    /* Ligne d'état */
    const region = s.world.grid.regionAt(s.motor.x, s.motor.z);
    const room = region >= 0 ? (ROOM_NAMES[s.layout.regions[region]!.type] ?? '') : '';
    const powered = s.world.sectorPowered(s.sector.id);
    const elapsed = s.mission ? formatClock(s.mission.elapsed) : '';
    clear(this.status);
    this.status.append(
      `${s.sector.name.toUpperCase()} — ${room}`,
      powered ? '' : h('span', { class: 'warn', text: '  · HORS TENSION' }),
      h('br'),
      `${elapsed}${this.network ? `  ·  ${this.network}` : ''}${this.voice ? `  ·  ${this.voice}` : ''}`,
    );

    /* Objectifs */
    const m = s.mission;
    if (m) {
      const key = JSON.stringify([m.objectives, m.phase, m.extractionLeft, s.world.flag('airlock')]);
      if (key !== this.objectiveKey) {
        this.objectiveKey = key;
        clear(this.objectives);
        for (const [i, o] of m.objectives.entries()) {
          if (o.status === 'cache') continue;
          const def = OBJECTIVE_BY_ID[o.id]!;
          const cls = `objective ${i === 0 ? '' : 'secondary'} ${o.status === 'reussi' ? 'done' : o.status === 'echoue' ? 'failed' : ''}`;
          const step = o.status === 'actif' ? currentStepLabel(o) : o.status === 'reussi' ? 'Accompli' : 'Échoué';
          this.objectives.append(
            h('div', { class: cls }, h('div', { class: 'name', text: `${i === 0 ? 'Objectif' : 'Secondaire'} — ${def.title}` }), h('div', { class: 'step', text: step + (o.timeLeft > 0 ? `  (${formatClock(o.timeLeft)})` : '') })),
          );
        }
        if (m.phase === 'extraction') {
          const airlock = s.world.flag('airlock');
          const text = airlock === 2 ? 'Rejoignez le sas, côté intérieur' : airlock === 1 ? "Cycle du sas en cours — tenez l'accueil" : "Retournez à l'accueil et lancez le cycle du sas";
          this.objectives.append(h('div', { class: 'objective' }, h('div', { class: 'name', text: 'Extraction' }), h('div', { class: 'step', text }), m.extractionLeft >= 0 ? h('div', { class: 'timer', text: formatClock(m.extractionLeft) }) : null));
        }
      }
    }

    /* État physique */
    const parts: string[] = [];
    for (const inj of sim.injuries) parts.push(`${inj.treated ? 't' : 'n'}:${inj.type}`);
    if (sim.infection > 10) parts.push(`i:${Math.round(sim.infection / 5)}`);
    if (sim.bodyTemp < 35.6) parts.push('f');
    if (sim.exhausted) parts.push('e');
    const ckey = parts.join('|');
    if (ckey !== this.conditionKey) {
      this.conditionKey = ckey;
      clear(this.conditions);
      for (const inj of sim.injuries) this.conditions.append(h('span', { class: `condition ${inj.treated ? 'treated' : ''}`, text: INJURY_NAMES[inj.type] + (inj.treated ? ' (soignée)' : '') }));
      if (sim.infection > 10) this.conditions.append(h('span', { class: 'condition', text: `Infection ${Math.round(sim.infection)} %` }));
      if (sim.bodyTemp < 35.6) this.conditions.append(h('span', { class: 'condition', text: 'Hypothermie' }));
      if (sim.exhausted) this.conditions.append(h('span', { class: 'condition treated', text: 'Épuisé' }));
    }

    /* Inventaire rapide */
    const inv = s.inventory;
    if (inv.revision !== this.invRevision) {
      this.invRevision = inv.revision;
      inv.slots.forEach((item, i) => {
        const el = this.slots[i]!;
        el.className = `slot${item ? ' filled' : ''}${i === inv.selected ? ' selected' : ''}${item?.on ? ' active-device' : ''}`;
        (el.lastElementChild as HTMLElement).textContent = item ? itemGlyph(item.id) : '';
      });
    }
    const active = inv.active;
    if (active) {
      const def = itemDef(active.id);
      let charge = '';
      if (def.chargeLabel === 'batterie') charge = `${Math.ceil(active.charge)} %${active.on ? ' · allumé' : ''}`;
      else if (def.chargeLabel) charge = `${Math.ceil(active.charge)} ${def.chargeLabel === 'usages' ? '×' : '%'}`;
      clear(this.activeItem);
      this.activeItem.append(itemLabel(active.id, active.data), h('br'), h('span', { class: 'charge', text: charge }));
    } else setText(this.activeItem, '');

    this.updateDevice(playing);
    this.updateCenter(playing);
  }

  private updatePrompt(playing: boolean): void {
    const f = playing && !this.cctvLabel ? this.session.focus : null;
    const use = this.session.useProgress;
    const key = f ? `${f.title}|${f.index}|${f.actions.map((a) => a.label + a.enabled).join(',')}|${f.progress > 0}` : use > 0 ? 'use' : '';
    if (key !== this.promptKey) {
      this.promptKey = key;
      clear(this.prompt);
      if (f) {
        this.prompt.append(h('div', { class: 'prompt-title', text: f.title }));
        f.actions.forEach((a, i) => {
          const selected = i === f.index;
          const cls = `prompt-action${selected ? ' selected' : ''}${a.enabled ? '' : ' disabled'}`;
          const label = a.enabled ? a.label : `${a.label} — ${a.reason ?? 'indisponible'}`;
          this.prompt.append(h('div', { class: cls }, selected && a.enabled ? h('span', { class: 'keycap', text: keyLabel(this.settings.keys.interagir) }) : null, selected && a.enabled ? ' ' : '', label, selected && a.duration > 0 && a.enabled ? ' (maintenir)' : ''));
        });
        if (f.actions.length > 1) this.prompt.append(h('div', { class: 'prompt-title', text: 'Molette : autre action', style: 'margin-top:5px' }));
        this.prompt.append(h('div', { class: 'prompt-progress', style: 'display:none' }, h('i')));
      } else if (use > 0) this.prompt.append(h('div', { class: 'prompt-progress' }, h('i')));
    }
    const progress = this.prompt.querySelector('.prompt-progress') as HTMLElement | null;
    if (progress) {
      const value = f ? f.progress : use;
      progress.style.display = value > 0 ? '' : 'none';
      (progress.firstElementChild as HTMLElement).style.width = `${Math.min(100, value * 100)}%`;
    }
  }

  private updateCenter(playing: boolean): void {
    const s = this.session;
    let text = '';
    if (s.hiddenIn && playing) text = 'Caché — retenez votre souffle';
    else if (s.extractProgress > 0) text = 'Extraction…';
    else if (s.status === 'dead' && !s.result) text = 'Clic : changer de coéquipier observé';
    setText(this.center, text);
  }

  /** Lecture de l'appareil tenu en main (détecteurs, appareil de mesure). */
  private updateDevice(playing: boolean): void {
    const s = this.session;
    const active = playing ? s.inventory.active : null;
    const on = active?.on === true;
    const id = on ? active!.id : '';
    if (id !== 'detecteur_mouvement' && id !== 'detecteur_sonore' && id !== 'mesureur') {
      this.device.style.display = 'none';
      return;
    }
    this.device.style.display = '';
    this.radar.style.display = id === 'detecteur_mouvement' ? '' : 'none';
    clear(this.deviceLines);
    const line = (a: string, b: string): void => void this.deviceLines.append(h('div', { class: 'line' }, h('span', { text: a }), h('span', { text: b })));
    if (id === 'mesureur') {
      line('TEMPÉRATURE', `${s.readout.temperature.toFixed(1)} °C`);
      line('CONTAMINATION', `${Math.round(s.readout.contamination * 100)} %`);
      line('ANOMALIE EM', s.readout.em > 0.02 ? `${Math.round(s.readout.em * 100)} %` : '—');
      line('CORPS', `${s.sim.bodyTemp.toFixed(1)} °C`);
    } else if (id === 'detecteur_sonore') {
      line('VOTRE BRUIT', `${s.noise.toFixed(1)} m`);
      const fake = s.time - this.lastFake < 6;
      const organic = s.time - this.lastOrganic < 6;
      line('DERNIER SON', fake ? '⚠ NON ORGANIQUE' : organic ? 'ORGANIQUE' : '—');
    } else {
      const ctx = this.radar.getContext('2d')!;
      const w = this.radar.width;
      const hgt = this.radar.height;
      ctx.clearRect(0, 0, w, hgt);
      ctx.strokeStyle = 'rgba(95,174,106,0.45)';
      ctx.lineWidth = 1;
      for (const r of [0.33, 0.66, 1]) {
        ctx.beginPath();
        ctx.arc(w / 2, hgt, (hgt - 4) * r, Math.PI, 0);
        ctx.stroke();
      }
      let count = 0;
      const blip = (x: number, z: number, color: string): void => {
        const dx = x - s.motor.x;
        const dz = z - s.motor.z;
        const d = Math.hypot(dx, dz);
        if (d > 20 || d < 0.5) return;
        // Repère local : devant = haut de l'écran.
        const fwd = dx * Math.sin(s.motor.yaw) + dz * Math.cos(s.motor.yaw);
        const side = dx * Math.cos(s.motor.yaw) - dz * Math.sin(s.motor.yaw);
        if (fwd < 0) return;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(w / 2 + (side / 20) * (hgt - 4), hgt - (fwd / 20) * (hgt - 4), 3, 0, Math.PI * 2);
        ctx.fill();
        count++;
      };
      for (const e of s.entities.values()) if (e.anim > 0 && e.kind !== 'statique') blip(e.x, e.z, '#ff7a6a');
      for (const p of s.players.values()) if (p.id !== s.self.id && p.speed > 0.4 && p.status === 'playing') blip(p.x, p.z, '#8fe09b');
      line('MOUVEMENTS', String(count));
    }
  }

  dispose(): void {
    for (const off of this.unsubs) off();
    this.root.remove();
  }
}
