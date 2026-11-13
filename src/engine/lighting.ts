/**
 * Éclairage dynamique sous budget.
 *
 * Le complexe compte plus de deux cents néons mais seuls les plus proches et
 * visibles reçoivent une vraie lumière (réserve de taille fixe, attribuée
 * plusieurs fois par seconde). Les autres restent de simples surfaces émissives.
 * La lampe torche du joueur est un projecteur avec ombres portées.
 */
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { GameSession } from '../game/session';
import { FLAG_LIGHT } from '../network/protocol';
import type { Layout, LightDef } from '../world/types';
import type { WorldView } from './worldView';

export interface LightBudget {
  /** Néons simultanément actifs. */
  pool: number;
  /** Lampes torches des coéquipiers. */
  remote: number;
  shadows: boolean;
  shadowSize: number;
}

interface Slot {
  light: PointLight;
  /** Néon attribué (-1 = libre). */
  id: number;
  target: number;
}

const WARM = new Color3(1, 0.86, 0.66);
const COOL = new Color3(0.72, 0.86, 1);
const EMERGENCY = new Color3(1, 0.12, 0.06);

export class LightRig {
  readonly flashlight: SpotLight;
  readonly shadow: ShadowGenerator | null = null;
  private ambient: HemisphericLight;
  private slots: Slot[] = [];
  private remotes: SpotLight[] = [];
  private timer = 0;
  private time = 0;
  /** Intensité affichée de chaque néon (pour les fondus et les clignotements). */
  private level: Float32Array;
  private candidates: { def: LightDef; score: number }[] = [];
  private aim = new Vector3(0, 0, 1);

  constructor(
    scene: Scene,
    private layout: Layout,
    private view: WorldView,
    readonly budget: LightBudget,
  ) {
    this.ambient = new HemisphericLight('ambiance', new Vector3(0.2, 1, 0.1), scene);
    this.ambient.intensity = 0.05;
    this.ambient.diffuse = new Color3(0.55, 0.65, 0.8);
    this.ambient.groundColor = new Color3(0.08, 0.07, 0.06);
    this.ambient.specular = Color3.Black();

    this.flashlight = new SpotLight('lampe', Vector3.Zero(), new Vector3(0, 0, 1), 0.95, 22, scene);
    this.flashlight.diffuse = new Color3(1, 0.96, 0.86);
    this.flashlight.specular = new Color3(1, 0.96, 0.86);
    this.flashlight.range = 30;
    this.flashlight.intensity = 0;
    if (budget.shadows) {
      const gen = new ShadowGenerator(budget.shadowSize, this.flashlight);
      gen.usePercentageCloserFiltering = true;
      gen.filteringQuality = ShadowGenerator.QUALITY_LOW;
      gen.bias = 0.0015;
      gen.normalBias = 0.02;
      gen.darkness = 0.1;
      this.shadow = gen;
    }
    for (let i = 0; i < budget.pool; i++) {
      const light = new PointLight(`neon:${i}`, Vector3.Zero(), scene);
      light.range = 13;
      light.intensity = 0;
      this.slots.push({ light, id: -1, target: 0 });
    }
    for (let i = 0; i < budget.remote; i++) {
      const spot = new SpotLight(`lampe-distante:${i}`, Vector3.Zero(), new Vector3(0, 0, 1), 0.9, 20, scene);
      spot.diffuse = new Color3(1, 0.95, 0.85);
      spot.range = 22;
      spot.intensity = 0;
      this.remotes.push(spot);
    }
    this.level = new Float32Array(layout.lights.length);
  }

  /** Nombre total de lumières influençant les matériaux. */
  get lightCount(): number {
    return 2 + this.slots.length + this.remotes.length;
  }

  setShadowCasters(meshes: Mesh[]): void {
    const map = this.shadow?.getShadowMap();
    if (!map) return;
    map.renderList = meshes;
    map.refreshRate = 2;
  }

  update(session: GameSession, dt: number, eye: Vector3, forward: Vector3, lampCharge: number, lampOn: boolean, tremor: number): void {
    this.time += dt;
    const t = this.time;
    const world = session.world;

    /* Lampe torche : suit le regard avec un léger retard, vacille quand la batterie faiblit. */
    const k = Math.min(1, dt * 14);
    this.aim.x += (forward.x - this.aim.x) * k;
    this.aim.y += (forward.y - this.aim.y) * k;
    this.aim.z += (forward.z - this.aim.z) * k;
    this.aim.normalize();
    this.flashlight.position.set(eye.x + forward.z * 0.18, eye.y - 0.16, eye.z - forward.x * 0.18);
    this.flashlight.direction.copyFrom(this.aim);
    this.flashlight.direction.x += Math.sin(t * 9.1) * tremor * 0.02;
    this.flashlight.direction.y += Math.sin(t * 7.3) * tremor * 0.02;
    let power = 0;
    if (lampOn) {
      power = 2.6;
      if (lampCharge < 15) power *= 0.45 + 0.4 * Math.abs(Math.sin(t * 23) * Math.sin(t * 3.7));
      else if (lampCharge < 30) power *= 0.8;
    }
    this.flashlight.intensity += (power - this.flashlight.intensity) * Math.min(1, dt * 18);

    /* Lampes des coéquipiers les plus proches. */
    let r = 0;
    if (this.remotes.length > 0) {
      for (const p of session.players.values()) {
        if (r >= this.remotes.length) break;
        if (p.id === session.self.id || !(p.flags & FLAG_LIGHT) || p.status !== 'playing' || p.hiddenIn) continue;
        const dx = p.x - eye.x;
        const dz = p.z - eye.z;
        if (dx * dx + dz * dz > 28 * 28) continue;
        const spot = this.remotes[r++]!;
        const cp = Math.cos(p.pitch);
        spot.position.set(p.x, p.y + 1.4, p.z);
        spot.direction.set(Math.sin(p.yaw) * cp, -Math.sin(p.pitch), Math.cos(p.yaw) * cp);
        spot.intensity = 2;
      }
    }
    for (; r < this.remotes.length; r++) this.remotes[r]!.intensity = 0;

    /* Néons : état, couleur et attribution de la réserve. */
    this.timer -= dt;
    const refresh = this.timer <= 0;
    if (refresh) this.timer = 0.18;
    const lights = this.layout.lights;
    if (refresh) this.candidates.length = 0;
    for (let i = 0; i < lights.length; i++) {
      const def = lights[i]!;
      const dx = def.x - eye.x;
      const dz = def.z - eye.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 46 * 46) continue;
      const mode = world.lightMode[i]!;
      const powered = world.sectorPowered(def.sector);
      let target = 0;
      let color = (i * 7) % 3 === 0 ? COOL : WARM;
      if (mode !== 2) {
        if (powered) {
          target = 1;
          if (mode === 1) {
            // Clignotement irrégulier : extinctions brèves et sursauts.
            const n = Math.sin(t * 13 + i * 1.7) * Math.sin(t * 3.1 + i) + Math.sin(t * 41 + i * 5) * 0.3;
            target = n > 0.25 ? 1 : n > -0.2 ? 0.25 : 0;
          }
        } else if (i % 3 === 0) {
          // Éclairage de secours : un néon sur trois, rouge et faible.
          target = 0.28;
          color = EMERGENCY;
        }
      }
      const level = this.level[i]! + (target - this.level[i]!) * Math.min(1, dt * (mode === 1 ? 40 : 6));
      this.level[i] = level;
      const glow = level * (color === EMERGENCY ? 1.6 : 1.25);
      this.view.setPanelColor(i, color.r * glow, color.g * glow, color.b * glow);
      if (refresh && level > 0.02 && d2 < 22 * 22 && Math.abs(def.y - eye.y) < 6) {
        // Priorité aux néons en vue directe : évite d'éclairer à travers les murs.
        const sight = world.grid.sight(eye.x, eye.z, def.x, def.z);
        this.candidates.push({ def, score: Math.sqrt(d2) + (sight ? 0 : 14) });
      }
    }
    if (refresh) {
      this.candidates.sort((a, b) => a.score - b.score);
      const wanted = this.candidates.slice(0, this.slots.length);
      // Conserve les attributions existantes pour éviter les sautes de lumière.
      for (const slot of this.slots) {
        if (slot.id >= 0 && !wanted.some((w) => w.def.id === slot.id)) slot.target = 0;
      }
      for (const w of wanted) {
        if (this.slots.some((s) => s.id === w.def.id)) continue;
        const free = this.slots.find((s) => s.id < 0 || (s.target === 0 && s.light.intensity < 0.02));
        if (!free) continue;
        free.id = w.def.id;
        free.light.position.set(w.def.x, w.def.y - 0.35, w.def.z);
      }
    }
    for (const slot of this.slots) {
      if (slot.id < 0) continue;
      const i = slot.id;
      const still = this.candidates.some((c) => c.def.id === i);
      const powered = world.sectorPowered(lights[i]!.sector);
      const color = powered ? ((i * 7) % 3 === 0 ? COOL : WARM) : EMERGENCY;
      const goal = still ? this.level[i]! * (powered ? 4.2 : 2.2) : 0;
      const light = slot.light;
      light.intensity += (goal - light.intensity) * Math.min(1, dt * 10);
      light.diffuse.copyFrom(color);
      light.specular.copyFrom(color);
      if (!still && light.intensity < 0.02) {
        slot.id = -1;
        light.intensity = 0;
      }
    }
  }

  dispose(): void {
    this.shadow?.dispose();
    this.flashlight.dispose();
    this.ambient.dispose();
    for (const s of this.slots) s.light.dispose();
    for (const s of this.remotes) s.dispose();
  }
}
