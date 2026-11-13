import { itemDef } from './items';

export interface InvItem {
  id: string;
  charge: number;
  data?: string;
  /** Appareil allumé (objets « toggle »). */
  on: boolean;
}

export const INVENTORY_SLOTS = 8;
/** Au-delà de ce poids, le joueur est ralenti et s'essouffle plus vite. */
export const COMFORT_WEIGHT = 6;
export const MAX_WEIGHT = 12;

/** Inventaire limité en emplacements et en poids. */
export class Inventory {
  readonly slots: (InvItem | null)[] = new Array<InvItem | null>(INVENTORY_SLOTS).fill(null);
  selected = 0;
  /** Incrémenté à chaque modification : l'interface ne se redessine que si nécessaire. */
  revision = 0;

  get active(): InvItem | null {
    return this.slots[this.selected] ?? null;
  }

  usedSlots(): number {
    let n = 0;
    for (const s of this.slots) if (s) n += itemDef(s.id).size;
    return n;
  }

  weight(): number {
    let w = 0;
    for (const s of this.slots) if (s) w += itemDef(s.id).weight;
    return w;
  }

  /** 0 = à l'aise, 1 = charge maximale. */
  encumbrance(): number {
    const w = this.weight();
    if (w <= COMFORT_WEIGHT) return 0;
    return Math.min(1, (w - COMFORT_WEIGHT) / (MAX_WEIGHT - COMFORT_WEIGHT));
  }

  find(id: string, data?: string): InvItem | null {
    for (const s of this.slots) if (s && s.id === id && (data === undefined || s.data === data)) return s;
    return null;
  }

  count(id: string): number {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n++;
    return n;
  }

  /** Niveau de la meilleure carte d'accès transportée (0 si aucune). */
  cardLevel(): number {
    let level = 0;
    for (const s of this.slots) if (s && s.id === 'carte') level = Math.max(level, Number(s.data ?? 0));
    return level;
  }

  /** Raison du refus, ou null si l'objet peut être ajouté. */
  cannotAdd(id: string): string | null {
    const d = itemDef(id);
    if (id === 'piles' || id === 'marqueurs') {
      const stack = this.find(id);
      if (stack && stack.charge < d.maxCharge) return null;
    }
    if (this.usedSlots() + d.size > INVENTORY_SLOTS) return 'Inventaire plein';
    if (this.weight() + d.weight > MAX_WEIGHT) return 'Trop lourd';
    return null;
  }

  /** Ajoute un objet (fusionne les piles et marqueurs). Renvoie false si impossible. */
  add(id: string, charge?: number, data?: string): boolean {
    if (this.cannotAdd(id)) return false;
    const d = itemDef(id);
    const amount = charge ?? d.maxCharge;
    if (id === 'piles' || id === 'marqueurs') {
      const stack = this.find(id);
      if (stack && stack.charge < d.maxCharge) {
        stack.charge = Math.min(d.maxCharge, stack.charge + Math.max(1, amount));
        this.revision++;
        return true;
      }
    }
    const i = this.slots.indexOf(null);
    if (i < 0) return false;
    this.slots[i] = { id, charge: amount, data, on: false };
    this.revision++;
    return true;
  }

  removeAt(index: number): InvItem | null {
    const it = this.slots[index] ?? null;
    if (it) {
      this.slots[index] = null;
      this.revision++;
    }
    return it;
  }

  remove(item: InvItem): void {
    const i = this.slots.indexOf(item);
    if (i >= 0) this.removeAt(i);
  }

  /** Retire un exemplaire de l'objet demandé. */
  consume(id: string, data?: string): InvItem | null {
    const it = this.find(id, data);
    if (it) this.remove(it);
    return it;
  }

  /** Dépense une charge ; retire l'objet lorsqu'il est épuisé. Renvoie false s'il est absent. */
  spendCharge(id: string, amount = 1): boolean {
    const it = this.find(id);
    if (!it || it.charge < amount) return false;
    it.charge -= amount;
    if (it.charge <= 0 && itemDef(id).chargeLabel !== 'batterie') this.remove(it);
    this.revision++;
    return true;
  }

  select(index: number): void {
    if (index >= 0 && index < INVENTORY_SLOTS && index !== this.selected) {
      this.selected = index;
      this.revision++;
    }
  }

  cycle(delta: number): void {
    this.select((this.selected + delta + INVENTORY_SLOTS) % INVENTORY_SLOTS);
  }

  /** Recharge l'appareil actif avec un jeu de piles. Renvoie un message d'échec ou null. */
  reload(): string | null {
    const active = this.active;
    if (!active) return 'Aucun appareil en main';
    const d = itemDef(active.id);
    if (!d.rechargeable) return "Cet objet ne se recharge pas";
    if (active.charge >= d.maxCharge - 1) return 'Batterie déjà pleine';
    if (!this.spendCharge('piles')) return 'Aucune pile';
    active.charge = d.maxCharge;
    this.revision++;
    return null;
  }

  /** Décharge les appareils allumés. `multiplier` > 1 près du Statique. */
  drain(dt: number, multiplier = 1): void {
    for (const s of this.slots) {
      if (!s || !s.on) continue;
      const d = itemDef(s.id);
      if (d.drain <= 0) continue;
      s.charge -= d.drain * dt * multiplier;
      if (s.charge <= 0) {
        s.charge = 0;
        s.on = false;
        this.revision++;
      }
    }
  }

  serialize(): (InvItem | null)[] {
    return this.slots.map((s) => (s ? { ...s } : null));
  }

  clear(): void {
    this.slots.fill(null);
    this.revision++;
  }
}
