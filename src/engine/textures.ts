/**
 * Textures PBR procédurales.
 *
 * Le jeu n'embarque aucun fichier image : chaque matériau (albédo, normale,
 * occlusion/rugosité/métal) est calculé au chargement à partir de bruit
 * périodique, donc raccordable sans couture. Les recettes décrivent des surfaces
 * industrielles usées : béton fissuré, tôle rivetée et rouillée, carrelage
 * humide, peinture écaillée…
 */

export interface TextureSet {
  size: number;
  /** RGBA (alpha utilisé par les décalques). */
  albedo: Uint8Array;
  /** Tangent-space, RGB. */
  normal: Uint8Array;
  /** R = occlusion, G = rugosité, B = métal. */
  orm: Uint8Array;
  /** Longueur réelle couverte par une répétition, en mètres. */
  tile: number;
  alpha: boolean;
}

interface Pixel {
  r: number;
  g: number;
  b: number;
  /** Hauteur relative (-1 à 1) servant à dériver la normale et l'occlusion. */
  h: number;
  rough: number;
  metal: number;
  a: number;
}

type Recipe = (u: number, v: number, px: Pixel, n: Noise) => void;

/* ------------------------------------------------------------------ */
/* Bruit périodique                                                    */
/* ------------------------------------------------------------------ */

class Noise {
  private perm: Uint8Array;

  constructor(seed: number) {
    this.perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = seed >>> 0 || 1;
    for (let i = 255; i > 0; i--) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const j = s % (i + 1);
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;
  }

  /** Valeur pseudo-aléatoire stable pour une case entière. */
  hash(x: number, y: number): number {
    return this.perm[(this.perm[x & 255]! + y) & 255]! / 255;
  }

  /** Bruit de valeur lissé, périodique de période `period` sur les deux axes. */
  value(x: number, y: number, period: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % period) + period) % period;
    const y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const y1 = (y0 + 1) % period;
    const a = this.hash(x0, y0);
    const b = this.hash(x1, y0);
    const c = this.hash(x0, y1);
    const d = this.hash(x1, y1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }

  /** Bruit fractal (u, v dans [0,1)), périodique. */
  fbm(u: number, v: number, freq: number, octaves = 4): number {
    let sum = 0;
    let amp = 0.5;
    let f = freq;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += this.value(u * f, v * f, f) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
}

const fract = (x: number): number => x - Math.floor(x);
const sstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Distance au joint le plus proche pour une grille de `count` cases (0 = sur le joint). */
const seam = (u: number, count: number): number => {
  const f = fract(u * count);
  return Math.min(f, 1 - f) / count;
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

function tint(px: Pixel, r: number, g: number, b: number, t: number): void {
  px.r = mix(px.r, r, t);
  px.g = mix(px.g, g, t);
  px.b = mix(px.b, b, t);
}

/* ------------------------------------------------------------------ */
/* Recettes                                                            */
/* ------------------------------------------------------------------ */

const RECIPES: Record<string, { tile: number; alpha?: boolean; bump?: number; recipe: Recipe }> = {
  concrete: {
    tile: 3,
    bump: 2.2,
    recipe(u, v, px, n) {
      const base = n.fbm(u, v, 5, 5);
      const fine = n.fbm(u, v, 48, 2);
      const c = 0.27 + base * 0.16 + fine * 0.05;
      px.r = c * 1.02;
      px.g = c;
      px.b = c * 0.96;
      px.h = base * 0.5 + fine * 0.25;
      px.rough = 0.88;
      const crack = Math.abs(n.fbm(u + 0.31, v + 0.17, 6, 4) - 0.5);
      if (crack < 0.012) {
        const k = 1 - crack / 0.012;
        tint(px, 0.04, 0.04, 0.04, k * 0.8);
        px.h -= k * 0.8;
      }
      const stain = sstep(0.56, 0.72, n.fbm(u + 0.7, v + 0.2, 3, 3));
      tint(px, 0.09, 0.08, 0.07, stain * 0.55);
      px.rough -= stain * 0.35;
    },
  },
  floor_concrete: {
    tile: 4,
    bump: 1.4,
    recipe(u, v, px, n) {
      const base = n.fbm(u, v, 6, 5);
      const c = 0.2 + base * 0.12;
      px.r = c;
      px.g = c;
      px.b = c * 1.03;
      px.h = base * 0.35 + n.fbm(u, v, 64, 2) * 0.15;
      px.rough = 0.72;
      // Flaques : zones lisses et sombres.
      const wet = sstep(0.6, 0.7, n.fbm(u + 0.4, v + 0.9, 3, 3));
      tint(px, 0.03, 0.035, 0.04, wet * 0.75);
      px.rough = mix(px.rough, 0.06, wet);
      px.h = mix(px.h, 0.1, wet);
      const joint = Math.min(seam(u, 2), seam(v, 2));
      if (joint < 0.004) {
        tint(px, 0.03, 0.03, 0.03, 0.8);
        px.h -= 0.6;
      }
    },
  },
  wall_panel: {
    tile: 2,
    bump: 2.5,
    recipe(u, v, px, n) {
      const wear = n.fbm(u, v, 5, 4);
      const c = 0.42 + wear * 0.14;
      px.r = c * 0.97;
      px.g = c;
      px.b = c * 0.95;
      px.h = 0.3 + n.fbm(u, v, 40, 2) * 0.08;
      px.rough = 0.58 + wear * 0.15;
      const joint = Math.min(seam(u, 2), seam(v, 2));
      if (joint < 0.006) {
        const k = 1 - joint / 0.006;
        tint(px, 0.03, 0.03, 0.03, k);
        px.h -= k * 0.8;
        px.rough = 0.9;
      }
      // Rivets aux angles des panneaux.
      const ru = fract(u * 2);
      const rv = fract(v * 2);
      const dx = Math.min(Math.abs(ru - 0.06), Math.abs(ru - 0.94));
      const dy = Math.min(Math.abs(rv - 0.06), Math.abs(rv - 0.94));
      const rivet = Math.hypot(dx, dy);
      if (rivet < 0.022) {
        px.h += (1 - rivet / 0.022) * 0.7;
        px.metal = 0.7;
        tint(px, 0.3, 0.3, 0.3, 0.6);
      }
      // Peinture écaillée : métal nu et rouille.
      const chip = sstep(0.66, 0.72, n.fbm(u + 0.13, v + 0.57, 14, 4));
      tint(px, 0.24, 0.17, 0.12, chip * 0.9);
      px.metal = Math.max(px.metal, chip * 0.6);
      px.h -= chip * 0.25;
      // Coulures verticales.
      const streak = sstep(0.62, 0.8, n.value(u * 48, v * 3, 48)) * 0.4;
      tint(px, 0.1, 0.09, 0.07, streak);
    },
  },
  wall_tile: {
    tile: 1.2,
    bump: 2,
    recipe(u, v, px, n) {
      const count = 8;
      const iu = Math.floor(u * count);
      const iv = Math.floor(v * count);
      const id = n.hash(iu * 7 + 3, iv * 13 + 5);
      const c = 0.58 + id * 0.12;
      px.r = c * 0.94;
      px.g = c;
      px.b = c * 0.96;
      px.rough = 0.2 + n.fbm(u, v, 9, 3) * 0.3;
      px.h = 0.4;
      const joint = Math.min(seam(u, count), seam(v, count));
      if (joint < 0.006) {
        const k = 1 - joint / 0.006;
        tint(px, 0.1, 0.1, 0.09, k);
        px.h -= k * 0.7;
        px.rough = 0.9;
      }
      if (id < 0.05) {
        // Carreau manquant : on voit le mortier.
        const m = n.fbm(u, v, 30, 3);
        px.r = px.g = px.b = 0.2 + m * 0.1;
        px.rough = 0.95;
        px.h = m * 0.2;
      }
      const grime = sstep(0.55, 0.78, n.fbm(u + 0.5, v + 0.3, 4, 4));
      tint(px, 0.16, 0.14, 0.09, grime * 0.6);
      px.rough += grime * 0.3;
    },
  },
  wall_metal: {
    tile: 2,
    bump: 2.4,
    recipe(u, v, px, n) {
      const streak = n.value(u * 64, v * 2, 64);
      const c = 0.2 + streak * 0.07 + n.fbm(u, v, 6, 3) * 0.06;
      px.r = c * 0.95;
      px.g = c;
      px.b = c * 1.06;
      px.metal = 0.9;
      px.rough = 0.42 + streak * 0.12;
      px.h = 0.3;
      const joint = Math.min(seam(u, 2), seam(v, 2));
      if (joint < 0.005) {
        px.h -= 0.8;
        tint(px, 0.02, 0.02, 0.02, 0.9);
      }
      const ru = fract(u * 8);
      const rv = fract(v * 8);
      const edge = Math.min(seam(u, 2), seam(v, 2));
      if (edge < 0.04 && edge > 0.012 && Math.hypot(ru - 0.5, rv - 0.5) < 0.16) {
        px.h += 0.6;
        tint(px, 0.34, 0.34, 0.36, 0.5);
      }
      const rust = sstep(0.55, 0.68, n.fbm(u + 0.9, v + 0.4, 5, 5));
      tint(px, 0.26, 0.12, 0.05, rust * 0.9);
      px.metal = mix(px.metal, 0.05, rust);
      px.rough = mix(px.rough, 0.92, rust);
      px.h += rust * n.fbm(u, v, 40, 2) * 0.4;
    },
  },
  wall_foam: {
    tile: 1,
    bump: 4,
    recipe(u, v, px, n) {
      const count = 6;
      const fu = fract(u * count);
      const fv = fract(v * count);
      const alt = (Math.floor(u * count) + Math.floor(v * count)) % 2 === 0;
      // Coins de mousse orientés alternativement.
      const ridge = alt ? Math.abs(fu - 0.5) : Math.abs(fv - 0.5);
      px.h = 1 - ridge * 2;
      const c = 0.05 + px.h * 0.05 + n.fbm(u, v, 60, 2) * 0.02;
      px.r = c;
      px.g = c;
      px.b = c * 1.1;
      px.rough = 1;
    },
  },
  floor_tile: {
    tile: 2,
    bump: 1.6,
    recipe(u, v, px, n) {
      const count = 4;
      const id = n.hash(Math.floor(u * count) * 5 + 1, Math.floor(v * count) * 11 + 7);
      const c = 0.3 + id * 0.08 + n.fbm(u, v, 20, 3) * 0.05;
      px.r = c * 1.02;
      px.g = c;
      px.b = c * 0.94;
      px.rough = 0.38;
      px.h = 0.4;
      const joint = Math.min(seam(u, count), seam(v, count));
      if (joint < 0.005) {
        const k = 1 - joint / 0.005;
        tint(px, 0.04, 0.04, 0.04, k);
        px.h -= k * 0.6;
        px.rough = 0.9;
      }
      const dirt = sstep(0.5, 0.75, n.fbm(u + 0.2, v + 0.6, 4, 4));
      tint(px, 0.08, 0.07, 0.05, dirt * 0.6);
      px.rough += dirt * 0.25;
      const wet = sstep(0.64, 0.7, n.fbm(u + 0.8, v + 0.1, 3, 2));
      px.rough = mix(px.rough, 0.07, wet);
      tint(px, 0.04, 0.045, 0.05, wet * 0.5);
    },
  },
  floor_metal: {
    tile: 1,
    bump: 3,
    recipe(u, v, px, n) {
      const count = 10;
      const cu = u * count;
      const cv = v * count;
      const alt = (Math.floor(cu) + Math.floor(cv)) % 2 === 0;
      const fu = fract(cu) - 0.5;
      const fv = fract(cv) - 0.5;
      // Tôle larmée : petites ellipses en chevrons.
      const a = alt ? fu + fv : fu - fv;
      const b = alt ? fu - fv : fu + fv;
      const drop = Math.hypot(a * 1.1, b * 3.2);
      px.h = drop < 0.32 ? 0.9 - drop : 0.1;
      const wear = n.fbm(u, v, 4, 4);
      const c = 0.15 + wear * 0.1 + (drop < 0.32 ? 0.08 : 0);
      px.r = c;
      px.g = c * 1.01;
      px.b = c * 1.06;
      px.metal = 0.92;
      px.rough = 0.48 - (drop < 0.32 ? 0.12 : 0) + wear * 0.15;
      const rust = sstep(0.62, 0.74, n.fbm(u + 0.3, v + 0.8, 5, 4));
      tint(px, 0.22, 0.1, 0.04, rust * 0.8);
      px.metal = mix(px.metal, 0.1, rust);
      px.rough = mix(px.rough, 0.9, rust);
    },
  },
  floor_grate: {
    tile: 1,
    bump: 4,
    recipe(u, v, px, n) {
      const bar = Math.min(seam(u, 12), seam(v, 4));
      const solid = bar < 0.012;
      const frame = Math.min(seam(u, 1), seam(v, 1)) < 0.03;
      if (solid || frame) {
        const c = 0.17 + n.fbm(u, v, 30, 2) * 0.06;
        px.r = c;
        px.g = c;
        px.b = c * 1.05;
        px.h = 0.9;
        px.metal = 0.9;
        px.rough = 0.5;
      } else {
        px.r = px.g = px.b = 0.012;
        px.h = -0.9;
        px.rough = 1;
      }
    },
  },
  floor_carpet: {
    tile: 1,
    bump: 1.2,
    recipe(u, v, px, n) {
      const fiber = n.value(u * 128, v * 128, 128);
      const patch = n.fbm(u, v, 4, 3);
      const c = 0.5 + fiber * 0.5;
      px.r = 0.075 * c + patch * 0.02;
      px.g = 0.085 * c + patch * 0.02;
      px.b = 0.11 * c + patch * 0.02;
      px.h = fiber * 0.5;
      px.rough = 1;
      const stain = sstep(0.68, 0.76, n.fbm(u + 0.6, v + 0.6, 3, 3));
      tint(px, 0.03, 0.025, 0.02, stain * 0.7);
    },
  },
  ceiling: {
    tile: 1.2,
    bump: 2,
    recipe(u, v, px, n) {
      const c = 0.3 + n.fbm(u, v, 8, 3) * 0.08;
      px.r = c;
      px.g = c;
      px.b = c * 0.97;
      px.h = 0.5;
      px.rough = 0.9;
      const joint = Math.min(seam(u, 2), seam(v, 2));
      if (joint < 0.01) {
        px.h -= 0.7;
        tint(px, 0.08, 0.08, 0.08, 0.8);
      }
      // Perforations.
      const fu = fract(u * 24) - 0.5;
      const fv = fract(v * 24) - 0.5;
      if (Math.hypot(fu, fv) < 0.16) {
        px.h -= 0.5;
        tint(px, 0.03, 0.03, 0.03, 0.8);
      }
      const leak = sstep(0.62, 0.78, n.fbm(u + 0.2, v + 0.4, 3, 4));
      tint(px, 0.17, 0.12, 0.06, leak * 0.7);
    },
  },
  metal: {
    tile: 1,
    bump: 1,
    recipe(u, v, px, n) {
      const brush = n.value(u * 4, v * 160, 160);
      const c = 0.62 + brush * 0.14 + n.fbm(u, v, 6, 3) * 0.08;
      px.r = px.g = px.b = c;
      px.metal = 1;
      px.rough = 0.38 + brush * 0.12;
      px.h = brush * 0.2;
      const scratch = Math.abs(n.fbm(u + 0.4, v + 0.1, 9, 3) - 0.5);
      if (scratch < 0.006) {
        px.h -= 0.5;
        px.rough = 0.25;
      }
    },
  },
  painted: {
    tile: 1,
    bump: 1.5,
    recipe(u, v, px, n) {
      const c = 0.72 + n.fbm(u, v, 6, 4) * 0.2;
      px.r = px.g = px.b = c;
      px.rough = 0.55;
      px.h = 0.3 + n.fbm(u, v, 50, 2) * 0.06;
      const chip = sstep(0.68, 0.73, n.fbm(u + 0.33, v + 0.71, 11, 4));
      tint(px, 0.3, 0.24, 0.2, chip);
      px.metal = chip * 0.7;
      px.h -= chip * 0.3;
      px.rough = mix(px.rough, 0.7, chip);
    },
  },
  wood: {
    tile: 1.5,
    bump: 1.2,
    recipe(u, v, px, n) {
      const warp = n.fbm(u, v, 3, 3);
      const grain = fract(v * 26 + warp * 5 + n.value(u * 6, v * 90, 90) * 0.4);
      const g = sstep(0, 0.5, grain) * (1 - sstep(0.5, 1, grain));
      px.r = 0.26 + g * 0.1;
      px.g = 0.16 + g * 0.07;
      px.b = 0.08 + g * 0.04;
      px.h = g * 0.4;
      px.rough = 0.6;
    },
  },
  fabric: {
    tile: 0.5,
    bump: 1.5,
    recipe(u, v, px, n) {
      const weave = Math.abs(Math.sin(u * Math.PI * 64)) * Math.abs(Math.sin(v * Math.PI * 64));
      const c = 0.55 + weave * 0.25 + n.fbm(u, v, 8, 3) * 0.15;
      px.r = px.g = px.b = c;
      px.h = weave;
      px.rough = 1;
    },
  },
  organic: {
    tile: 1,
    bump: 3.5,
    recipe(u, v, px, n) {
      const body = n.fbm(u, v, 5, 5);
      const vein = Math.abs(n.fbm(u + 0.5, v + 0.2, 7, 4) - 0.5);
      const k = 1 - sstep(0, 0.05, vein);
      px.r = 0.2 + body * 0.14 + k * 0.25;
      px.g = 0.05 + body * 0.05 + k * 0.06;
      px.b = 0.07 + body * 0.06 + k * 0.05;
      px.h = body * 0.8 + k * 0.5;
      px.rough = 0.22 + body * 0.2;
    },
  },
  hazard: {
    tile: 1,
    bump: 1,
    recipe(u, v, px, n) {
      const stripe = fract((u + v) * 4) < 0.5;
      const wear = n.fbm(u, v, 10, 4);
      if (stripe) {
        px.r = 0.75;
        px.g = 0.55;
        px.b = 0.05;
      } else px.r = px.g = px.b = 0.03;
      const chip = sstep(0.6, 0.7, wear);
      tint(px, 0.2, 0.19, 0.18, chip * 0.8);
      px.metal = chip * 0.6;
      px.rough = 0.55;
      px.h = 0.3 - chip * 0.2;
    },
  },
  screen: {
    tile: 1,
    recipe(u, v, px, n) {
      // Lignes de texte fantômes sur un écran cathodique.
      const line = Math.floor(v * 22);
      const len = 0.25 + n.hash(line, 3) * 0.6;
      const on = fract(v * 22) > 0.25 && fract(v * 22) < 0.7 && u > 0.06 && u < len && n.hash(Math.floor(u * 60), line) > 0.28 && line % 5 !== 4;
      const scan = 0.75 + 0.25 * Math.sin(v * Math.PI * 256);
      const glow = on ? 1 : 0.1;
      px.r = 0.2 * glow * scan;
      px.g = 0.95 * glow * scan;
      px.b = 0.55 * glow * scan;
      px.rough = 0.15;
    },
  },
  decal_blood: {
    tile: 1,
    alpha: true,
    recipe(u, v, px, n) {
      const d = Math.hypot(u - 0.5, v - 0.5) * 2;
      const blob = n.fbm(u, v, 5, 4) * 0.9 + 0.35 - d;
      const drops = n.fbm(u + 0.3, v + 0.3, 22, 2) > 0.7 && d < 0.95 ? 0.4 : 0;
      px.a = Math.min(1, sstep(0, 0.12, blob) + drops) * (1 - sstep(0.85, 1, d));
      px.r = 0.16;
      px.g = 0.008;
      px.b = 0.008;
      px.rough = 0.12;
      px.h = px.a * 0.3;
    },
  },
  decal_trail: {
    tile: 1,
    alpha: true,
    recipe(u, v, px, n) {
      const wobble = n.fbm(u, 0.5, 4, 3) * 0.25;
      const d = Math.abs(v - 0.4 - wobble);
      const streak = n.value(u * 3, v * 60, 60);
      px.a = (1 - sstep(0.06, 0.2, d)) * (0.45 + streak * 0.55) * sstep(0, 0.08, u) * (1 - sstep(0.8, 1, u));
      px.r = 0.13;
      px.g = 0.006;
      px.b = 0.006;
      px.rough = 0.2;
    },
  },
  decal_puddle: {
    tile: 1,
    alpha: true,
    recipe(u, v, px, n) {
      const d = Math.hypot(u - 0.5, v - 0.5) * 2;
      const blob = n.fbm(u, v, 3, 3) * 0.7 + 0.5 - d;
      px.a = sstep(0, 0.1, blob) * 0.8 * (1 - sstep(0.9, 1, d));
      px.r = 0.015;
      px.g = 0.02;
      px.b = 0.024;
      px.rough = 0.02;
    },
  },
  decal_papers: {
    tile: 1,
    alpha: true,
    recipe(u, v, px, n) {
      px.a = 0;
      for (let i = 0; i < 7; i++) {
        const cx = 0.15 + n.hash(i, 1) * 0.7;
        const cy = 0.15 + n.hash(i, 2) * 0.7;
        const ang = n.hash(i, 3) * Math.PI;
        const dx = u - cx;
        const dy = v - cy;
        const lx = dx * Math.cos(ang) + dy * Math.sin(ang);
        const ly = -dx * Math.sin(ang) + dy * Math.cos(ang);
        if (Math.abs(lx) < 0.085 && Math.abs(ly) < 0.12) {
          const text = fract(ly * 60) > 0.55 && Math.abs(lx) < 0.065 && n.hash(Math.floor(lx * 200), Math.floor(ly * 60) + i) > 0.3;
          const c = text ? 0.25 : 0.62 - n.hash(i, 4) * 0.15;
          px.r = c;
          px.g = c * 0.97;
          px.b = c * 0.88;
          px.a = 1;
          px.rough = 0.85;
        }
      }
    },
  },
};

export const TEXTURE_NAMES = Object.keys(RECIPES);

/** Calcule un jeu de textures. `size` doit être une puissance de deux. */
export function generateTexture(name: string, size: number): TextureSet {
  const spec = RECIPES[name];
  if (!spec) throw new Error(`Texture inconnue : ${name}`);
  let seed = 7;
  for (let i = 0; i < name.length; i++) seed = (Math.imul(seed, 31) + name.charCodeAt(i)) >>> 0;
  const noise = new Noise(seed);
  const n = size * size;
  const albedo = new Uint8Array(n * 4);
  const orm = new Uint8Array(n * 4);
  const normal = new Uint8Array(n * 4);
  const height = new Float32Array(n);
  const px: Pixel = { r: 0, g: 0, b: 0, h: 0, rough: 0.7, metal: 0, a: 1 };
  const to8 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 255 : (x * 255) | 0);
  // Les couleurs sont décrites en espace linéaire ; l'albédo est stocké en sRGB.
  const srgb = (x: number): number => to8(Math.pow(Math.max(0, x), 1 / 2.2));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      px.r = px.g = px.b = 0.5;
      px.h = 0;
      px.rough = 0.7;
      px.metal = 0;
      px.a = 1;
      spec.recipe(x / size, y / size, px, noise);
      const i = y * size + x;
      albedo[i * 4] = srgb(px.r);
      albedo[i * 4 + 1] = srgb(px.g);
      albedo[i * 4 + 2] = srgb(px.b);
      albedo[i * 4 + 3] = to8(px.a);
      height[i] = px.h;
      orm[i * 4 + 1] = to8(px.rough);
      orm[i * 4 + 2] = to8(px.metal);
      orm[i * 4 + 3] = 255;
    }
  }
  const bump = spec.bump ?? 1;
  const mask = size - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const l = height[y * size + ((x - 1) & mask)]!;
      const r = height[y * size + ((x + 1) & mask)]!;
      const d = height[((y - 1) & mask) * size + x]!;
      const u = height[((y + 1) & mask) * size + x]!;
      const dx = (l - r) * bump;
      const dy = (d - u) * bump;
      const len = Math.hypot(dx, dy, 1);
      normal[i * 4] = to8((dx / len) * 0.5 + 0.5);
      normal[i * 4 + 1] = to8((dy / len) * 0.5 + 0.5);
      normal[i * 4 + 2] = to8((1 / len) * 0.5 + 0.5);
      normal[i * 4 + 3] = 255;
      // Occlusion : les creux reçoivent moins de lumière ambiante.
      const avg = (l + r + d + u) / 4;
      orm[i * 4] = to8(0.82 + Math.min(0.18, Math.max(-0.5, (height[i]! - avg) * 2 + (height[i]! - 0.3) * 0.25)));
    }
  }
  return { size, albedo, normal, orm, tile: spec.tile, alpha: spec.alpha === true };
}
