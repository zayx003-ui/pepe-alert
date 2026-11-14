/**
 * Primitives de synthèse sonore hors ligne. Tous les sons du jeu sont calculés
 * (aucun fichier audio, aucun enregistrement) : bruit filtré, sinusoïdes,
 * enveloppes, filtres biquadratiques, formants vocaux.
 */
export const SAMPLE_RATE = 32000;

export type Samples = Float32Array;

/** Générateur déterministe pour le bruit. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buffer(seconds: number): Samples {
  return new Float32Array(Math.max(1, Math.floor(seconds * SAMPLE_RATE)));
}

export function noise(seconds: number, seed = 1): Samples {
  const out = buffer(seconds);
  const r = rng(seed);
  for (let i = 0; i < out.length; i++) out[i] = r() * 2 - 1;
  return out;
}

/** Bruit brun (énergie dans les graves) : grondements, souffle lointain. */
export function brown(seconds: number, seed = 1): Samples {
  const out = buffer(seconds);
  const r = rng(seed);
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    last = (last + (r() * 2 - 1) * 0.04) * 0.996;
    out[i] = last * 6;
  }
  return out;
}

/** Oscillateur dont la fréquence glisse de f0 à f1. */
export function tone(seconds: number, f0: number, f1 = f0, shape: 'sine' | 'saw' | 'square' = 'sine'): Samples {
  const out = buffer(seconds);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / out.length;
    phase += (f0 + (f1 - f0) * t) / SAMPLE_RATE;
    const p = phase - Math.floor(phase);
    out[i] = shape === 'sine' ? Math.sin(p * Math.PI * 2) : shape === 'saw' ? p * 2 - 1 : p < 0.5 ? 1 : -1;
  }
  return out;
}

/** Filtre biquadratique (passe-bas, passe-haut ou passe-bande). */
export function filter(input: Samples, type: 'lp' | 'hp' | 'bp', freq: number, q = 0.707): Samples {
  const out = new Float32Array(input.length);
  const w = (2 * Math.PI * Math.min(freq, SAMPLE_RATE * 0.45)) / SAMPLE_RATE;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b0: number;
  let b1: number;
  let b2: number;
  if (type === 'lp') {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = b0;
  } else if (type === 'hp') {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = b0;
  } else {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
  }
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i]!;
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    out[i] = y;
  }
  return out;
}

/** Enveloppe attaque / chute exponentielle. */
export function envelope(input: Samples, attack: number, decay: number, hold = 0): Samples {
  const out = new Float32Array(input.length);
  const a = Math.max(1, attack * SAMPLE_RATE);
  const h = hold * SAMPLE_RATE;
  const d = Math.max(1, decay * SAMPLE_RATE);
  for (let i = 0; i < input.length; i++) {
    let g: number;
    if (i < a) g = i / a;
    else if (i < a + h) g = 1;
    else g = Math.exp((-(i - a - h) / d) * 4);
    out[i] = input[i]! * g;
  }
  return out;
}

export function gain(input: Samples, g: number): Samples {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i]! * g;
  return out;
}

/** Additionne des pistes, chacune décalée de `at` secondes. */
export function mix(seconds: number, ...tracks: [Samples, number][]): Samples {
  const out = buffer(seconds);
  for (const [track, at] of tracks) {
    const offset = Math.floor(at * SAMPLE_RATE);
    for (let i = 0; i < track.length && i + offset < out.length; i++) out[i + offset]! += track[i]!;
  }
  return out;
}

/** Écho à réinjection : donne de l'espace (couloirs, salles vides). */
export function echo(input: Samples, delay: number, feedback: number, tail = 0.6): Samples {
  const out = new Float32Array(input.length + Math.floor(tail * SAMPLE_RATE));
  out.set(input);
  const d = Math.max(1, Math.floor(delay * SAMPLE_RATE));
  for (let i = d; i < out.length; i++) out[i]! += out[i - d]! * feedback;
  return out;
}

/** Rend une boucle sans raccord audible en fondant la fin dans le début. */
export function seamless(input: Samples, fade = 0.5): Samples {
  const n = Math.floor(fade * SAMPLE_RATE);
  const len = input.length - n;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = input[i]!;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i] = input[i]! * t + input[len + i]! * (1 - t);
  }
  return out;
}

/** Ramène le niveau de crête à `peak`. */
export function normalize(input: Samples, peak = 0.9): Samples {
  let max = 0;
  for (let i = 0; i < input.length; i++) max = Math.max(max, Math.abs(input[i]!));
  return max > 0 ? gain(input, peak / max) : input;
}

/**
 * Appel d'allure vocale : source en dents de scie filtrée par trois formants
 * qui glissent d'une voyelle à l'autre. Entièrement synthétique.
 */
export function vocal(seconds: number, pitch: number, seed: number): Samples {
  const r = rng(seed);
  const src = buffer(seconds);
  let phase = 0;
  const glide = 0.85 + r() * 0.3;
  for (let i = 0; i < src.length; i++) {
    const t = i / src.length;
    const vibrato = Math.sin(t * seconds * 5.5 * Math.PI * 2) * 0.012;
    phase += (pitch * (1 + (glide - 1) * t) * (1 + vibrato)) / SAMPLE_RATE;
    const p = phase - Math.floor(phase);
    src[i] = (p * 2 - 1) * 0.6 + (r() * 2 - 1) * 0.08;
  }
  const vowels = [
    [800, 1150, 2900],
    [450, 800, 2830],
    [400, 1700, 2600],
    [350, 2000, 2800],
  ];
  const a = vowels[Math.floor(r() * vowels.length)]!;
  const b = vowels[Math.floor(r() * vowels.length)]!;
  const half = Math.floor(src.length / 2);
  const first = src.subarray(0, half);
  const second = src.subarray(half);
  const shape = (part: Samples, f: number[]): Samples => {
    const f1 = filter(part, 'bp', f[0]!, 6);
    const f2 = filter(part, 'bp', f[1]!, 8);
    const f3 = filter(part, 'bp', f[2]!, 9);
    const out = new Float32Array(part.length);
    for (let i = 0; i < part.length; i++) out[i] = f1[i]! + f2[i]! * 0.6 + f3[i]! * 0.3;
    return out;
  };
  const out = buffer(seconds);
  out.set(shape(first, a));
  out.set(shape(second, b), half);
  return normalize(envelope(out, 0.08, seconds * 0.7, seconds * 0.2), 0.8);
}
