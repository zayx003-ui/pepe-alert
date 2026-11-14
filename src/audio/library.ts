/**
 * Bibliothèque de sons, organisée par catégorie. Chaque entrée est une recette
 * de synthèse exécutée à la première utilisation puis mise en cache.
 */
import { SAMPLE_RATE, brown, buffer, echo, envelope, filter, gain, mix, noise, normalize, rng, seamless, tone, vocal, type Samples } from './synth';

export type Category = 'ambiance' | 'environnement' | 'musique' | 'entites' | 'joueur' | 'interactions' | 'communications';

export interface SoundDef {
  category: Category;
  /** Priorité : un son plus prioritaire en évince un moins prioritaire quand toutes les voix sont prises. */
  priority: number;
  volume: number;
  /** Distance de référence et distance maximale d'écoute (sons spatialisés). */
  ref: number;
  max: number;
  loop?: boolean;
  /** Nombre de variantes (pas, coups…). */
  variants?: number;
  make: (variant: number) => Samples;
}

const def = (category: Category, priority: number, volume: number, ref: number, max: number, make: (v: number) => Samples, extra: Partial<SoundDef> = {}): SoundDef => ({
  category,
  priority,
  volume,
  ref,
  max,
  make,
  ...extra,
});

/** Pas : un choc sourd et un grain propre à la surface. */
function step(low: number, grainFreq: number, grainQ: number, grainGain: number, ring = 0): (v: number) => Samples {
  return (v) => {
    const thump = envelope(tone(0.16, low * (1 + v * 0.06), low * 0.55), 0.002, 0.06);
    const grain = envelope(filter(noise(0.14, 11 + v * 7), 'bp', grainFreq * (1 + v * 0.08), grainQ), 0.001, 0.05);
    const tracks: [Samples, number][] = [
      [gain(thump, 0.8), 0],
      [gain(grain, grainGain), 0.004],
    ];
    if (ring > 0) tracks.push([gain(envelope(tone(0.3, ring * (1 + v * 0.05)), 0.001, 0.14), 0.25), 0.006]);
    return normalize(mix(0.36, ...tracks), 0.85);
  };
}

function creak(seconds: number, f0: number, f1: number, seed: number): Samples {
  const src = tone(seconds, f0, f1, 'saw');
  const r = rng(seed);
  // Grincement : modulation irrégulière de l'amplitude.
  let g = 0;
  for (let i = 0; i < src.length; i++) {
    if (i % 90 === 0) g = 0.3 + r() * 0.7;
    src[i]! *= g;
  }
  return envelope(filter(src, 'bp', (f0 + f1) / 2, 3), 0.03, seconds * 0.6, seconds * 0.2);
}

const thud = (f: number, d: number): Samples => envelope(tone(d, f, f * 0.4), 0.001, d * 0.5);
const hiss = (seconds: number, freq: number, seed: number): Samples => filter(noise(seconds, seed), 'hp', freq);
const click = (f: number, seed: number): Samples => envelope(filter(noise(0.03, seed), 'bp', f, 4), 0.0005, 0.012);

export const SOUNDS: Record<string, SoundDef> = {
  /* ------------------------------- joueur ------------------------------- */
  pas_beton: def('joueur', 2, 0.5, 1.2, 16, step(95, 900, 1.2, 0.5), { variants: 4 }),
  pas_metal: def('joueur', 2, 0.6, 1.4, 22, step(120, 2400, 3, 0.7, 520), { variants: 4 }),
  pas_carrelage: def('joueur', 2, 0.5, 1.2, 18, step(110, 3200, 2, 0.6), { variants: 4 }),
  pas_grille: def('joueur', 2, 0.65, 1.5, 24, step(130, 3800, 5, 0.8, 880), { variants: 4 }),
  pas_moquette: def('joueur', 2, 0.3, 1, 9, step(70, 400, 0.8, 0.5), { variants: 4 }),
  toux: def('joueur', 5, 0.7, 1.5, 20, (v) =>
    normalize(mix(0.7, [envelope(filter(noise(0.18, 3 + v), 'bp', 700, 1.5), 0.005, 0.08), 0], [envelope(filter(noise(0.22, 9 + v), 'bp', 560, 1.5), 0.005, 0.1), 0.24]), 0.8),
  ),
  souffle: def('joueur', 5, 0.6, 1.5, 16, () => normalize(envelope(filter(noise(0.9, 5), 'bp', 1100, 0.9), 0.25, 0.4, 0.1), 0.7)),
  respiration: def('joueur', 3, 0.35, 1, 8, () => {
    const inhale = envelope(filter(noise(0.7, 21), 'bp', 1500, 1.1), 0.3, 0.3);
    const exhale = envelope(filter(noise(0.9, 22), 'bp', 800, 0.9), 0.2, 0.5);
    return normalize(mix(2.2, [inhale, 0], [gain(exhale, 0.8), 0.95]), 0.6);
  }, { loop: true }),
  coeur: def('joueur', 4, 0.8, 1, 6, () => normalize(mix(0.5, [thud(62, 0.14), 0], [gain(thud(52, 0.16), 0.75), 0.17]), 0.9)),
  acouphene: def('joueur', 3, 0.25, 1, 6, () => envelope(tone(3, 6200, 6100), 0.05, 2.4), {}),

  /* ----------------------------- interactions ----------------------------- */
  porte_ouvre: def('interactions', 4, 0.7, 2, 26, (v) =>
    normalize(mix(0.9, [click(1800, 2 + v), 0], [gain(creak(0.55, 320 + v * 40, 520, 4 + v), 0.5), 0.04], [gain(thud(90, 0.12), 0.5), 0.6]), 0.8),
    { variants: 2 },
  ),
  porte_ferme: def('interactions', 4, 0.75, 2, 28, (v) =>
    normalize(mix(0.6, [gain(creak(0.22, 480, 300 + v * 30, 7 + v), 0.3), 0], [thud(80, 0.22), 0.2], [click(1400, 3), 0.21]), 0.85),
    { variants: 2 },
  ),
  sas_ouvre: def('interactions', 5, 0.85, 3, 42, () =>
    normalize(echo(mix(1.9, [envelope(hiss(0.5, 3000, 4), 0.02, 0.3), 0], [gain(envelope(tone(1.2, 70, 110, 'saw'), 0.1, 0.9, 0.2), 0.5), 0.2], [thud(55, 0.3), 1.4]), 0.11, 0.3), 0.9),
  ),
  sas_ferme: def('interactions', 5, 0.85, 3, 42, () =>
    normalize(echo(mix(1.7, [gain(envelope(tone(1.0, 110, 65, 'saw'), 0.05, 0.8, 0.1), 0.5), 0], [thud(48, 0.35), 0.95], [envelope(hiss(0.4, 2500, 6), 0.01, 0.25), 1.0]), 0.12, 0.3), 0.9),
  ),
  grille: def('interactions', 4, 0.7, 2, 26, (v) => {
    const r = rng(5 + v);
    const tracks: [Samples, number][] = [];
    for (let i = 0; i < 6; i++) tracks.push([gain(envelope(tone(0.2, 900 + r() * 1800), 0.001, 0.07), 0.4), i * 0.06 + r() * 0.03]);
    tracks.push([gain(creak(0.5, 700, 400, 9), 0.4), 0.05]);
    return normalize(mix(0.8, ...tracks), 0.8);
  }, { variants: 2 }),
  coup_porte: def('interactions', 7, 1, 3, 46, (v) => normalize(echo(mix(0.5, [thud(70 + v * 8, 0.3), 0], [envelope(filter(noise(0.1, 8 + v), 'lp', 900), 0.001, 0.05), 0]), 0.09, 0.35), 0.95), { variants: 3 }),
  porte: def('interactions', 4, 0.7, 2, 26, () => normalize(mix(0.8, [click(1500, 6), 0], [gain(creak(0.6, 260, 420, 12), 0.6), 0.05]), 0.8)),
  machine: def('interactions', 3, 0.55, 2, 24, () => normalize(mix(0.5, [thud(140, 0.1), 0], [click(2600, 4), 0.02], [gain(envelope(tone(0.4, 100, 100, 'saw'), 0.02, 0.25), 0.25), 0.03]), 0.7)),
  refus: def('interactions', 3, 0.4, 1, 6, () => normalize(mix(0.3, [envelope(tone(0.12, 150, 140, 'square'), 0.005, 0.08), 0], [envelope(tone(0.12, 120, 110, 'square'), 0.005, 0.08), 0.14]), 0.4)),
  ramasser: def('interactions', 3, 0.5, 1, 8, () => normalize(mix(0.2, [envelope(filter(noise(0.1, 14), 'bp', 2400, 1), 0.005, 0.05), 0], [click(3200, 2), 0.08]), 0.6)),
  poser: def('interactions', 3, 0.5, 1.2, 12, () => normalize(mix(0.2, [thud(180, 0.07), 0], [click(1200, 5), 0]), 0.6)),
  impact: def('interactions', 6, 0.9, 2.5, 34, (v) => normalize(echo(mix(0.5, [thud(160 + v * 30, 0.12), 0], [envelope(filter(noise(0.12, 17 + v), 'bp', 2200, 2), 0.001, 0.05), 0], [gain(thud(190, 0.08), 0.5), 0.17]), 0.07, 0.25), 0.9), { variants: 3 }),
  recharge: def('interactions', 3, 0.5, 1, 8, () => normalize(mix(0.5, [click(2200, 3), 0], [click(1700, 5), 0.16], [click(2800, 7), 0.34]), 0.6)),
  clic_lampe: def('interactions', 3, 0.45, 1, 8, () => normalize(mix(0.06, [click(2900, 9), 0]), 0.6)),
  soin: def('interactions', 3, 0.5, 1, 8, () => normalize(mix(0.6, [envelope(filter(noise(0.25, 31), 'hp', 3500), 0.01, 0.15), 0], [click(1900, 2), 0.35]), 0.6)),
  marqueur: def('interactions', 3, 0.5, 1, 10, () => normalize(mix(0.25, [click(3600, 6), 0], [envelope(filter(noise(0.12, 13), 'hp', 5000), 0.001, 0.07), 0.01]), 0.6)),
  bip: def('interactions', 4, 0.4, 1, 14, () => normalize(mix(0.3, [envelope(tone(0.08, 1760), 0.002, 0.05), 0], [envelope(tone(0.1, 2640), 0.002, 0.06), 0.11]), 0.5)),
  bip_radar: def('interactions', 2, 0.25, 1, 10, () => envelope(tone(0.05, 1320), 0.002, 0.03)),

  /* ------------------------------- entités ------------------------------- */
  clic: def('entites', 8, 0.9, 3, 40, (v) => {
    const tracks: [Samples, number][] = [];
    for (let i = 0; i < 3 + v; i++) tracks.push([envelope(tone(0.04, 2400 + i * 300, 1400), 0.0005, 0.015), i * 0.085]);
    return normalize(echo(mix(0.5, ...tracks), 0.13, 0.4, 0.8), 0.9);
  }, { variants: 3 }),
  raclement: def('entites', 7, 0.8, 3, 30, (v) => normalize(echo(gain(creak(1.6, 180 + v * 30, 90, 20 + v), 1), 0.09, 0.3), 0.8), { variants: 2 }),
  cri_rampant: def('entites', 9, 1, 3, 44, () => normalize(echo(envelope(filter(tone(0.7, 900, 2600, 'saw'), 'bp', 1900, 2), 0.02, 0.4, 0.1), 0.06, 0.35), 0.95)),
  decharge: def('entites', 9, 1, 3, 40, () => {
    const r = rng(44);
    const out = buffer(0.6);
    for (let i = 0; i < out.length; i++) out[i] = (r() * 2 - 1) * (Math.sin(i * 0.11) > 0.3 ? 1 : 0.1) * Math.exp(-i / (SAMPLE_RATE * 0.2));
    return normalize(filter(out, 'hp', 1800), 0.95);
  }),
  attaque_visiteur: def('entites', 10, 1, 3, 40, () => normalize(mix(0.9, [envelope(filter(noise(0.3, 51), 'bp', 500, 0.8), 0.1, 0.12), 0], [thud(60, 0.35), 0.24], [gain(vocal(0.6, 90, 3), 0.5), 0.2]), 0.95)),
  attaque_echo: def('entites', 10, 1, 3, 40, () => normalize(mix(0.6, [envelope(tone(0.2, 3000, 600), 0.001, 0.1), 0], [thud(75, 0.3), 0.12]), 0.95)),
  attaque_phototrope: def('entites', 10, 1, 3, 36, () => normalize(envelope(filter(noise(0.8, 61), 'hp', 2500), 0.01, 0.5), 0.9)),
  attaque_rampant: def('entites', 10, 1, 3, 36, () => normalize(mix(0.5, [envelope(filter(noise(0.2, 63), 'bp', 1400, 1.5), 0.005, 0.1), 0], [thud(120, 0.18), 0.1]), 0.9)),
  attaque_porteur: def('entites', 10, 0.9, 3, 30, () => normalize(mix(0.7, [gain(vocal(0.6, 70, 9), 0.8), 0], [thud(90, 0.2), 0.3]), 0.9)),
  attaque_statique: def('entites', 10, 1, 3, 36, () => normalize(filter(noise(0.4, 67), 'hp', 3000), 0.8)),
  fake_pas: def('entites', 6, 0.7, 2, 26, () => {
    const s = step(100, 1000, 1.2, 0.5);
    const tracks: [Samples, number][] = [];
    for (let i = 0; i < 5; i++) tracks.push([gain(s(i % 4), 0.6 + i * 0.08), i * 0.48]);
    return normalize(mix(2.8, ...tracks), 0.8);
  }),
  fake_voix: def('entites', 8, 0.85, 3, 38, (v) => normalize(echo(mix(1.8, [vocal(0.7, 150 + v * 35, 5 + v), 0], [gain(vocal(0.5, 130 + v * 30, 8 + v), 0.8), 0.9]), 0.16, 0.35, 0.9), 0.85), { variants: 3 }),
  fake_porte: def('entites', 6, 0.7, 2, 30, () => normalize(mix(0.9, [click(1800, 2), 0], [gain(creak(0.55, 320, 520, 4), 0.5), 0.04], [gain(thud(90, 0.12), 0.5), 0.6]), 0.8)),
  murmure: def('entites', 5, 0.5, 1, 10, (v) => normalize(mix(2.4, [gain(filter(vocal(0.9, 190 + v * 20, 31 + v), 'hp', 900), 0.6), 0], [gain(filter(vocal(0.8, 170, 37 + v), 'hp', 900), 0.5), 1.2]), 0.5), { variants: 2 }),

  /* ----------------------------- environnement ----------------------------- */
  evt_coupure: def('environnement', 8, 0.9, 4, 60, () => normalize(mix(1.6, [thud(60, 0.4), 0], [envelope(tone(1.4, 180, 30, 'saw'), 0.01, 1.0), 0.02]), 0.9)),
  evt_fuite: def('environnement', 7, 0.9, 3, 44, () => normalize(envelope(hiss(1.8, 1800, 71), 0.03, 1.2, 0.3), 0.9)),
  evt_generateur: def('environnement', 7, 0.9, 4, 54, () => {
    const out = tone(1.8, 95, 28, 'saw');
    for (let i = 0; i < out.length; i++) out[i]! *= 0.5 + 0.5 * Math.sign(Math.sin((i / SAMPLE_RATE) * 60 * (1 - i / out.length)));
    return normalize(envelope(filter(out, 'lp', 700), 0.01, 1.3), 0.9);
  }),
  evt_porte: def('environnement', 6, 0.8, 3, 40, () => normalize(echo(mix(0.5, [thud(75, 0.3), 0], [click(1300, 4), 0]), 0.1, 0.4, 0.8), 0.9)),
  evt_annonce: def('communications', 7, 0.6, 1, 10, () => {
    const chime = mix(1.0, [envelope(tone(0.5, 660), 0.005, 0.35), 0], [envelope(tone(0.6, 523), 0.005, 0.4), 0.3]);
    const voice = mix(2.6, [vocal(0.6, 140, 71), 0], [vocal(0.5, 125, 72), 0.65], [vocal(0.7, 150, 73), 1.2], [vocal(0.5, 120, 74), 1.95]);
    // Voix de haut-parleur : bande étroite et saturation.
    const pa = filter(filter(voice, 'bp', 1400, 1.2), 'hp', 600);
    for (let i = 0; i < pa.length; i++) pa[i] = Math.tanh(pa[i]! * 4) * 0.5;
    return normalize(echo(mix(3.8, [gain(chime, 0.6), 0], [pa, 1.0]), 0.21, 0.35, 0.8), 0.8);
  }),
  evt_relais: def('communications', 6, 0.6, 1, 10, () => normalize(envelope(filter(noise(0.9, 81), 'bp', 2600, 0.7), 0.005, 0.5, 0.2), 0.7)),
  evt_surchauffe: def('environnement', 7, 0.8, 4, 50, () => {
    const tracks: [Samples, number][] = [];
    for (let i = 0; i < 4; i++) tracks.push([envelope(tone(0.18, 980, 980, 'square'), 0.005, 0.12), i * 0.3]);
    return normalize(filter(mix(1.4, ...tracks), 'lp', 3000), 0.6);
  }),
  generateur: def('environnement', 4, 0.8, 4, 46, () => {
    const hum = tone(3, 52, 52, 'saw');
    const rattle = filter(noise(3, 91), 'bp', 240, 2);
    const out = buffer(3);
    for (let i = 0; i < out.length; i++) out[i] = hum[i]! * (0.6 + 0.4 * Math.sin((i / SAMPLE_RATE) * 13 * Math.PI * 2)) * 0.5 + rattle[i]! * 0.35;
    return normalize(seamless(filter(out, 'lp', 900)), 0.8);
  }, { loop: true }),
  vapeur: def('environnement', 4, 0.7, 2.5, 34, () => normalize(seamless(hiss(2.5, 2200, 93)), 0.7), { loop: true }),
  neon: def('environnement', 1, 0.14, 1, 9, () => {
    const out = tone(2, 100, 100, 'saw');
    const high = tone(2, 3100);
    for (let i = 0; i < out.length; i++) out[i] = out[i]! * 0.5 + high[i]! * 0.08;
    return normalize(seamless(filter(out, 'hp', 180), 0.3), 0.5);
  }, { loop: true }),
  goutte: def('environnement', 1, 0.35, 1.5, 18, (v) => normalize(echo(envelope(tone(0.08, 1200 + v * 300, 2400 + v * 200), 0.001, 0.03), 0.12, 0.3, 0.6), 0.6), { variants: 3 }),
  metal_lointain: def('environnement', 2, 0.5, 4, 60, (v) => normalize(echo(envelope(tone(1.2, 140 + v * 50, 110 + v * 40), 0.002, 0.7), 0.19, 0.5, 1.6), 0.7), { variants: 3 }),

  /* ------------------------------- ambiance ------------------------------- */
  amb_grave: def('ambiance', 1, 0.6, 1, 1, () => normalize(seamless(filter(brown(9, 101), 'lp', 180), 1.5), 0.8), { loop: true }),
  amb_air: def('ambiance', 1, 0.35, 1, 1, () => normalize(seamless(filter(noise(8, 103), 'bp', 420, 0.5), 1.5), 0.6), { loop: true }),
  amb_froid: def('ambiance', 1, 0.4, 1, 1, () => {
    const wind = filter(noise(10, 105), 'bp', 900, 2.5);
    for (let i = 0; i < wind.length; i++) wind[i]! *= 0.5 + 0.5 * Math.sin((i / SAMPLE_RATE) * 0.35 * Math.PI * 2);
    return normalize(seamless(wind, 1.5), 0.6);
  }, { loop: true }),
  amb_serveurs: def('ambiance', 1, 0.4, 1, 1, () => {
    const out = buffer(6);
    const fan = filter(noise(6, 107), 'bp', 700, 1);
    const whine = tone(6, 1880, 1890);
    for (let i = 0; i < out.length; i++) out[i] = fan[i]! * 0.7 + whine[i]! * 0.05;
    return normalize(seamless(out, 1), 0.6);
  }, { loop: true }),

  /* ------------------------------- musique ------------------------------- */
  tension: def('musique', 1, 0.5, 1, 1, () => {
    const out = buffer(12);
    const freqs = [55, 58.3, 82.4, 110.7, 164];
    for (const [k, f] of freqs.entries()) {
      const t = tone(12, f, f * 1.004);
      for (let i = 0; i < out.length; i++) out[i]! += t[i]! * (0.5 + 0.5 * Math.sin((i / SAMPLE_RATE) * (0.11 + k * 0.05) * Math.PI * 2)) * (0.3 / (1 + k * 0.4));
    }
    return normalize(seamless(filter(out, 'lp', 700), 2), 0.8);
  }, { loop: true }),
  poursuite: def('musique', 1, 0.6, 1, 1, () => {
    const out = buffer(4);
    for (let b = 0; b < 8; b++) {
      const hit = thud(b % 2 === 0 ? 55 : 49, 0.3);
      const at = Math.floor(b * 0.5 * SAMPLE_RATE);
      for (let i = 0; i < hit.length && at + i < out.length; i++) out[at + i]! += hit[i]! * (b % 4 === 0 ? 1 : 0.6);
    }
    const scrape = filter(tone(4, 233, 247, 'saw'), 'bp', 900, 4);
    for (let i = 0; i < out.length; i++) out[i]! += scrape[i]! * 0.12 * (0.5 + 0.5 * Math.sin((i / SAMPLE_RATE) * 8 * Math.PI * 2));
    return normalize(seamless(out, 0.2), 0.85);
  }, { loop: true }),
  stinger: def('musique', 9, 0.8, 1, 1, () => normalize(echo(mix(1.6, [envelope(tone(1.2, 220, 233, 'saw'), 0.005, 0.8), 0], [envelope(tone(1.2, 311, 329, 'saw'), 0.005, 0.8), 0], [thud(45, 0.5), 0]), 0.17, 0.4, 1.2), 0.8)),
  reussite: def('musique', 6, 0.5, 1, 1, () => normalize(echo(mix(1.6, [envelope(tone(0.6, 220), 0.02, 0.5), 0], [envelope(tone(0.8, 329.6), 0.02, 0.6), 0.2], [envelope(tone(1.0, 440), 0.02, 0.8), 0.45]), 0.22, 0.4, 1.4), 0.6)),

  /* ---------------------------- communications ---------------------------- */
  radio_bip: def('communications', 5, 0.45, 1, 6, () => normalize(mix(0.25, [envelope(filter(noise(0.08, 111), 'bp', 2400, 1), 0.002, 0.04), 0], [envelope(tone(0.08, 1480), 0.002, 0.05), 0.07]), 0.6)),
  parasites: def('communications', 3, 0.3, 1, 6, () => normalize(seamless(filter(noise(2, 113), 'bp', 2800, 0.6), 0.3), 0.5), { loop: true }),
  ui_clic: def('interactions', 2, 0.3, 1, 1, () => normalize(click(2100, 4), 0.5)),
  ui_ouvre: def('interactions', 2, 0.3, 1, 1, () => normalize(mix(0.2, [envelope(tone(0.1, 440, 660), 0.005, 0.06), 0]), 0.4)),
};

export const SOUND_IDS = Object.keys(SOUNDS);

/** Sons par catégorie (documentation et écran des réglages). */
export function soundsByCategory(): Record<Category, string[]> {
  const out: Record<Category, string[]> = { ambiance: [], environnement: [], musique: [], entites: [], joueur: [], interactions: [], communications: [] };
  for (const [id, s] of Object.entries(SOUNDS)) out[s.category].push(id);
  return out;
}
