/**
 * PlayerSimulation — état physiologique du joueur.
 *
 * Santé, endurance, respiration, stress, température, bruit, blessures, infection.
 * Le stress et les blessures altèrent la perception (image, son) et les capacités
 * physiques, jamais les commandes elles-mêmes.
 */
import { EventBus } from '../core/events';
import { clamp, clamp01 } from '../core/math';

export type InjuryType = 'legere' | 'profonde' | 'fracture' | 'brulure' | 'traumatisme';

export const INJURY_NAMES: Record<InjuryType, string> = {
  legere: 'Blessure légère',
  profonde: 'Blessure profonde',
  fracture: 'Fracture',
  brulure: 'Brûlure',
  traumatisme: 'Traumatisme',
};

export interface Injury {
  type: InjuryType;
  /** Gravité de 0 à 1. */
  severity: number;
  treated: boolean;
  /** Secondes écoulées depuis la blessure. */
  age: number;
}

export interface SimInput {
  moving: boolean;
  sprinting: boolean;
  crouching: boolean;
  /** 0 = à l'aise, 1 = charge maximale. */
  encumbrance: number;
  ambientTemp: number;
  /** Contamination de l'air, 0 à 1. */
  contamination: number;
  /** Aucun coéquipier vivant à proximité (toujours faux en solo). */
  isolated: boolean;
  chased: boolean;
  seesEntity: boolean;
  inDark: boolean;
  holdingBreath: boolean;
  /** Malaise propre au secteur (secteur expérimental, Noyau). */
  dread: number;
}

export interface SimEvents {
  hurt: { amount: number; type: InjuryType | null; source: string };
  died: { source: string };
  /** Reprise d'air bruyante après une apnée trop longue. */
  gasp: null;
  cough: null;
  injury: Injury;
}

export interface SimSnapshot {
  health: number;
  stamina: number;
  stress: number;
  infection: number;
  bodyTemp: number;
  injuries: Injury[];
  alive: boolean;
}

const BLEED: Record<InjuryType, number> = { legere: 0.12, profonde: 0.45, fracture: 0, brulure: 0.05, traumatisme: 0 };

export class PlayerSimulation {
  health = 100;
  stamina = 100;
  /** Réserve d'air en apnée (100 = pleine). */
  breath = 100;
  stress = 0;
  bodyTemp = 37;
  infection = 0;
  alive = true;
  readonly injuries: Injury[] = [];
  readonly events = new EventBus<SimEvents>();
  /** L'endurance est tombée à zéro : plus de course tant qu'elle n'est pas remontée. */
  exhausted = false;
  /** Bruit de respiration produit (portée en mètres). */
  breathNoise = 0;
  /** Temps écoulé depuis le dernier dégât (pour les effets visuels). */
  sinceHurt = 99;
  private sprintCooldown = 0;
  private gaspLock = 0;
  private coughTimer = 20;
  private seenTime = 0;
  /** Générateur injecté pour rendre les tests déterministes. */
  random: () => number = Math.random;

  /* ---------------- capacités ---------------- */

  has(type: InjuryType, includeTreated = true): boolean {
    for (const i of this.injuries) if (i.type === type && (includeTreated || !i.treated)) return true;
    return false;
  }

  maxStamina(): number {
    let max = 100;
    for (const i of this.injuries) if (i.type === 'brulure') max -= i.treated ? 10 : 22;
    if (this.infection > 60) max -= 20;
    return Math.max(35, max);
  }

  /** Multiplicateur de vitesse dû aux blessures, au froid et à la charge. */
  speedFactor(encumbrance: number): number {
    let f = 1 - encumbrance * 0.3;
    for (const i of this.injuries) {
      if (i.type === 'fracture') f *= i.treated ? 0.85 : 0.62;
      if (i.type === 'profonde' && !i.treated) f *= 0.9;
    }
    if (this.bodyTemp < 35) f *= 0.9;
    if (this.health < 25) f *= 0.88;
    return f;
  }

  canSprint(): boolean {
    return !this.exhausted && this.stamina > 1 && !this.has('fracture', false);
  }

  canJump(): boolean {
    return this.stamina > 8 && !this.has('fracture', false);
  }

  canHoldBreath(): boolean {
    return this.gaspLock <= 0 && this.breath > 5;
  }

  bleeding(): number {
    let b = 0;
    for (const i of this.injuries) if (!i.treated) b += BLEED[i.type] * (0.5 + i.severity);
    return b;
  }

  /** Dépense d'endurance ponctuelle (saut, lancer). */
  spend(amount: number): void {
    this.stamina = Math.max(0, this.stamina - amount);
    this.sprintCooldown = 1;
  }

  /* ---------------- mise à jour ---------------- */

  update(dt: number, input: SimInput): void {
    if (!this.alive) return;
    this.sinceHurt += dt;

    /* Endurance */
    const max = this.maxStamina();
    if (input.sprinting && input.moving) {
      let cost = 11 * (1 + input.encumbrance * 0.9);
      if (this.has('fracture')) cost *= 1.5;
      if (this.has('brulure', false)) cost *= 1.25;
      this.stamina -= cost * dt;
      this.sprintCooldown = 1.1;
      if (this.stamina <= 0) {
        this.stamina = 0;
        this.exhausted = true;
      }
    } else {
      this.sprintCooldown -= dt;
      if (this.sprintCooldown <= 0) {
        let regen = input.moving ? 6 : 10;
        regen *= 1 - (this.stress / 100) * 0.6;
        if (this.bodyTemp < 35.5) regen *= 0.7;
        if (input.holdingBreath) regen *= 0.2;
        this.stamina = Math.min(max, this.stamina + regen * dt);
      }
      if (this.exhausted && this.stamina >= 25) this.exhausted = false;
    }
    if (this.stamina > max) this.stamina = max;

    /* Respiration */
    this.gaspLock -= dt;
    if (input.holdingBreath && this.canHoldBreath()) {
      const drain = (100 / 14) * (1 + this.stress / 120) * (this.stamina < 30 ? 1.6 : 1);
      this.breath -= drain * dt;
      this.breathNoise = 0;
      if (this.breath <= 5) {
        this.breath = 0;
        this.gaspLock = 3.5;
        this.breathNoise = 9;
        this.events.emit('gasp', null);
      }
    } else {
      this.breath = Math.min(100, this.breath + 22 * dt);
      const winded = clamp01((40 - this.stamina) / 40);
      const panic = clamp01((this.stress - 60) / 40);
      const target = this.gaspLock > 0 ? 9 : Math.max(winded * 6, panic * 3.5);
      this.breathNoise += (target - this.breathNoise) * Math.min(1, dt * 3);
    }

    /* Stress */
    let gain = 0;
    if (input.chased) gain += 9;
    if (input.seesEntity) {
      this.seenTime += dt;
      gain += this.seenTime < 2 ? 16 : 5;
    } else this.seenTime = 0;
    if (input.isolated) gain += 0.55;
    if (input.inDark) gain += 0.45;
    gain += input.dread;
    if (this.bleeding() > 0.3) gain += 0.4;
    if (gain > 0.3) this.stress += gain * dt;
    else {
      let calm = input.isolated ? 1.6 : 3.2;
      if (this.has('traumatisme', false)) calm *= 0.5;
      this.stress -= calm * dt;
    }
    this.stress = clamp(this.stress, 0, 100);

    /* Température corporelle */
    const equilibrium = 37 - Math.max(0, 14 - input.ambientTemp) * 0.24 + (input.moving ? 0.25 : 0);
    this.bodyTemp += (equilibrium - this.bodyTemp) * Math.min(1, dt * 0.012);
    if (this.bodyTemp < 34.6) this.applyLoss(0.3 * dt, 'hypothermie');

    /* Infection */
    if (input.contamination > 0) this.infection += input.contamination * 0.75 * dt;
    else if (this.infection > 8) this.infection += 0.02 * dt;
    this.infection = clamp(this.infection, 0, 100);
    if (this.infection > 30) {
      this.coughTimer -= dt * (this.infection > 60 ? 1.8 : 1);
      if (this.coughTimer <= 0) {
        this.coughTimer = 14 + this.random() * 18;
        this.events.emit('cough', null);
      }
    }
    if (this.infection > 85) this.applyLoss(0.4 * dt, 'infection');
    if (this.infection >= 100) this.applyLoss(100, 'infection');

    /* Blessures */
    let bleed = 0;
    for (let i = this.injuries.length - 1; i >= 0; i--) {
      const inj = this.injuries[i]!;
      inj.age += dt;
      if (!inj.treated) bleed += BLEED[inj.type] * (0.5 + inj.severity);
      // Une blessure légère se referme seule ; un traumatisme soigné finit par passer.
      if ((inj.type === 'legere' && inj.age > 45) || (inj.type === 'traumatisme' && inj.treated && inj.age > 40)) {
        this.injuries.splice(i, 1);
      }
    }
    if (bleed > 0) this.applyLoss(bleed * dt, 'hémorragie');
    else if (this.health < 30 && this.infection < 85) this.health = Math.min(30, this.health + 0.25 * dt);
  }

  private applyLoss(amount: number, source: string): void {
    if (!this.alive) return;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.events.emit('died', { source });
    }
  }

  /* ---------------- événements ---------------- */

  damage(amount: number, type: InjuryType | null, source: string): void {
    if (!this.alive || amount <= 0) return;
    this.sinceHurt = 0;
    this.stress = Math.min(100, this.stress + 12 + amount * 0.3);
    if (type) {
      const existing = this.injuries.find((i) => i.type === type && !i.treated);
      const severity = clamp01(amount / 45);
      if (existing && type !== 'legere') existing.severity = clamp01(existing.severity + severity * 0.6);
      else {
        const injury: Injury = { type, severity, treated: false, age: 0 };
        this.injuries.push(injury);
        this.events.emit('injury', injury);
      }
    }
    this.events.emit('hurt', { amount, type, source });
    this.applyLoss(amount, source);
  }

  addStress(amount: number): void {
    this.stress = clamp(this.stress + amount, 0, 100);
  }

  heal(amount: number): void {
    if (this.alive) this.health = Math.min(100, this.health + amount);
  }

  /** Trousse médicale : traite la blessure non soignée la plus grave. */
  treatWorst(): Injury | null {
    const order: InjuryType[] = ['profonde', 'fracture', 'brulure', 'traumatisme', 'legere'];
    for (const type of order) {
      let best: Injury | null = null;
      for (const i of this.injuries) if (i.type === type && !i.treated && (!best || i.severity > best.severity)) best = i;
      if (best) {
        best.treated = true;
        best.age = 0;
        if (best.type === 'legere' || best.type === 'profonde') this.injuries.splice(this.injuries.indexOf(best), 1);
        return best;
      }
    }
    return null;
  }

  treatAll(): void {
    while (this.treatWorst());
  }

  cureInfection(): void {
    this.infection = 0;
  }

  /* ---------------- perception ---------------- */

  /** Intensités (0-1) des altérations visuelles et sonores. */
  perception(): { vignette: number; blur: number; desaturate: number; tremor: number; heartbeat: number; aberration: number } {
    const stress = clamp01((this.stress - 35) / 65);
    const hurt = clamp01(1 - this.health / 45);
    const concussion = this.has('traumatisme', false) ? 1 : 0;
    const sick = clamp01((this.infection - 50) / 50);
    const cold = clamp01((35.6 - this.bodyTemp) / 1.2);
    return {
      vignette: clamp01(0.15 + stress * 0.45 + hurt * 0.35),
      blur: clamp01(concussion * 0.6 + sick * 0.5),
      desaturate: clamp01(hurt * 0.7 + sick * 0.3),
      tremor: clamp01(cold * 0.6 + stress * 0.25),
      heartbeat: clamp01(Math.max(stress, hurt * 0.8, 1 - this.stamina / 30)),
      aberration: clamp01(stress * 0.6 + concussion * 0.5 + clamp01(1 - this.sinceHurt / 0.6)),
    };
  }

  snapshot(): SimSnapshot {
    return {
      health: this.health,
      stamina: this.stamina,
      stress: this.stress,
      infection: this.infection,
      bodyTemp: this.bodyTemp,
      injuries: this.injuries.map((i) => ({ ...i })),
      alive: this.alive,
    };
  }
}
