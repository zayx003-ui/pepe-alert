/**
 * Dessin des éléments de décor et des machines à partir de primitives.
 * Repère local : origine au sol, au centre de l'emprise ; +Z = face avant.
 * Les dimensions correspondent à world/props.ts (collisions).
 */
import type { GeoBatch } from './geometry';

type Draw = (b: GeoBatch, variant: number, accent: string) => void;

/** Pieds d'un meuble rectangulaire. */
function legs(b: GeoBatch, mat: string, w: number, d: number, h: number, t = 0.05): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(mat, sx * (w / 2 - t), h / 2, sz * (d / 2 - t), t, h, t);
}

/** Étagère : montants et tablettes garnies de boîtes. */
function shelf(b: GeoBatch, w: number, d: number, h: number, levels: number, variant: number, frame: string): void {
  for (const sx of [-1, 1]) b.box(frame, sx * (w / 2 - 0.025), h / 2, 0, 0.05, h, d);
  b.box(frame, 0, h / 2, -d / 2 + 0.01, w, h, 0.02);
  for (let i = 0; i <= levels; i++) {
    const y = 0.08 + (i * (h - 0.12)) / levels;
    b.box(frame, 0, y, 0, w - 0.06, 0.03, d - 0.02);
    if (i === levels) continue;
    // Contenu : boîtes et classeurs de tailles variées.
    let x = -w / 2 + 0.12;
    let k = variant + i * 7;
    while (x < w / 2 - 0.2) {
      k = (k * 31 + 17) % 97;
      const bw = 0.08 + (k % 5) * 0.045;
      const bh = 0.16 + (k % 4) * 0.05;
      if (k % 6 !== 0) b.box(k % 3 === 0 ? 'paper' : k % 3 === 1 ? 'painted_grey' : 'wood', x + bw / 2, y + 0.015 + bh / 2, 0.02, bw, bh, d * 0.6);
      x += bw + 0.03;
    }
  }
}

const PROP_DRAW: Record<string, Draw> = {
  bureau(b, v) {
    b.box('wood', 0, 0.74, 0, 1.5, 0.04, 0.7);
    b.box('painted_grey', -0.5, 0.37, 0, 0.45, 0.7, 0.62);
    b.box('metal_dark', 0.7, 0.36, 0, 0.04, 0.72, 0.6);
    b.box('plastic', 0.2, 0.93, -0.12, 0.42, 0.3, 0.05);
    b.box('plastic', 0.2, 0.78, -0.12, 0.16, 0.04, 0.14);
    if (v % 2 === 0) b.box('paper', -0.3, 0.77, 0.1, 0.22, 0.012, 0.3);
    if (v % 3 === 0) b.cylinder('painted_white', 0.55, 0.81, 0.18, 0.04, 0.1);
  },
  table(b) {
    b.box('wood', 0, 0.73, 0, 1.6, 0.04, 0.8);
    legs(b, 'metal_dark', 1.6, 0.8, 0.71);
  },
  chaise(b) {
    b.box('fabric_dark', 0, 0.45, 0, 0.44, 0.06, 0.44);
    b.box('fabric_dark', 0, 0.72, -0.2, 0.42, 0.42, 0.05);
    legs(b, 'metal_dark', 0.44, 0.44, 0.44, 0.03);
  },
  chaise_tombee(b) {
    b.box('fabric_dark', 0, 0.22, 0.05, 0.44, 0.44, 0.06);
    b.box('fabric_dark', 0, 0.03, -0.3, 0.42, 0.05, 0.42);
    b.box('metal_dark', -0.2, 0.22, 0.28, 0.03, 0.03, 0.44);
    b.box('metal_dark', 0.2, 0.22, 0.28, 0.03, 0.03, 0.44);
  },
  etagere(b, v) {
    shelf(b, 1.6, 0.45, 2.0, 4, v, 'metal_dark');
  },
  etagere_archives(b, v) {
    shelf(b, 1.8, 0.5, 2.2, 5, v, 'painted_grey');
  },
  casier_decor(b, v, accent) {
    for (let i = 0; i < 3; i++) {
      const x = -0.5 + i * 0.5;
      b.box(i === v % 3 ? accent : 'painted_grey', x, 0.95, 0, 0.48, 1.9, 0.5);
      b.box('metal_dark', x + 0.16, 1.05, 0.255, 0.03, 0.12, 0.02);
      for (let k = 0; k < 3; k++) b.box('metal_dark', x, 1.6 + k * 0.05, 0.252, 0.3, 0.015, 0.01);
    }
  },
  armoire(b) {
    b.box('painted_grey', 0, 0.95, 0, 1.0, 1.9, 0.5);
    b.box('metal_dark', 0, 0.95, 0.252, 0.012, 1.8, 0.01);
    b.box('metal', -0.06, 1.0, 0.262, 0.02, 0.14, 0.02);
    b.box('metal', 0.06, 1.0, 0.262, 0.02, 0.14, 0.02);
  },
  armoire_ouverte(b) {
    b.box('painted_grey', 0, 0.95, -0.2, 1.0, 1.9, 0.08);
    b.box('painted_grey', -0.48, 0.95, 0, 0.04, 1.9, 0.5);
    b.box('painted_grey', 0.48, 0.95, 0, 0.04, 1.9, 0.5);
    b.box('painted_grey', 0, 1.88, 0, 1.0, 0.04, 0.5);
    for (let i = 0; i < 4; i++) b.box('painted_grey', 0, 0.1 + i * 0.45, 0, 0.92, 0.025, 0.46);
    // Portes battantes ouvertes, une dégondée.
    b.box('painted_grey', -0.72, 0.95, 0.45, 0.48, 1.85, 0.03);
    b.box('painted_grey', 0.6, 0.5, 0.5, 0.48, 0.03, 0.9);
    b.box('paper', 0.1, 0.14, 0.1, 0.3, 0.05, 0.25);
  },
  classeur(b, v) {
    for (const sx of [-0.25, 0.25]) {
      b.box('painted_grey', sx, 0.65, 0, 0.48, 1.3, 0.6);
      for (let i = 0; i < 4; i++) {
        const open = (v + i) % 7 === 0 && sx < 0 ? 0.18 : 0;
        b.box('painted_dark', sx, 0.17 + i * 0.31, 0.3 + open / 2, 0.44, 0.28, 0.02 + open);
        b.box('metal', sx, 0.2 + i * 0.31, 0.32 + open, 0.14, 0.02, 0.02);
      }
    }
  },
  lit(b, v) {
    b.box('metal_dark', 0, 0.3, 0, 1.9, 0.06, 0.9);
    legs(b, 'metal_dark', 1.9, 0.9, 0.3, 0.04);
    b.box('fabric_white', 0, 0.42, 0, 1.85, 0.18, 0.85);
    b.box('fabric_white', -0.72, 0.56, 0, 0.36, 0.1, 0.6);
    if (v % 2 === 0) b.box('fabric_green', 0.3, 0.53, 0.05, 1.1, 0.05, 0.8);
    b.box('metal_dark', -0.94, 0.6, 0, 0.03, 0.6, 0.9);
  },
  lit_protocole(b) {
    b.box('metal_dark', 0, 0.35, 0, 1.9, 0.08, 0.9);
    legs(b, 'metal', 1.9, 0.9, 0.35, 0.05);
    b.box('fabric_white', 0, 0.48, 0, 1.85, 0.16, 0.82);
    // Sangles et arceau de capteurs au-dessus de la tête.
    for (const x of [-0.3, 0.25, 0.7]) b.box('rubber', x, 0.58, 0, 0.08, 0.02, 0.86);
    b.box('metal', -0.75, 0.95, -0.42, 0.04, 0.8, 0.04);
    b.box('metal', -0.75, 0.95, 0.42, 0.04, 0.8, 0.04);
    b.box('metal', -0.75, 1.36, 0, 0.3, 0.05, 0.9);
    b.box('plastic', -0.75, 1.28, 0, 0.2, 0.1, 0.3);
  },
  brancard(b, v) {
    b.box('metal', 0, 0.8, 0, 1.8, 0.05, 0.7);
    b.box('fabric_white', 0, 0.86, 0, 1.75, 0.08, 0.65);
    legs(b, 'metal', 1.6, 0.6, 0.78, 0.035);
    b.box('metal', 0, 0.25, 0, 1.6, 0.03, 0.6);
    if (v % 2 === 0) b.box('fabric_white', 0.1, 0.96, 0, 1.5, 0.14, 0.5);
  },
  caisse(b, v) {
    b.box(v % 2 ? 'wood' : 'painted_green', 0, 0.4, 0, 0.8, 0.8, 0.8);
    b.box('metal_dark', 0, 0.4, 0, 0.82, 0.06, 0.82);
    b.box('metal_dark', 0, 0.77, 0, 0.82, 0.06, 0.82);
  },
  caisses(b, v) {
    b.box('wood', -0.3, 0.4, 0, 0.78, 0.8, 0.78);
    b.box('painted_green', 0.42, 0.3, 0.05, 0.56, 0.6, 0.6);
    b.box(v % 2 ? 'wood' : 'painted_grey', -0.22, 1.12, -0.02, 0.62, 0.64, 0.62);
    b.box('metal_dark', -0.3, 0.4, 0, 0.8, 0.05, 0.8);
  },
  baril(b, v) {
    b.cylinder(v % 3 === 0 ? 'painted_yellow' : v % 3 === 1 ? 'painted_blue' : 'rust', 0, 0.45, 0, 0.29, 0.9, 'y', 12);
    b.cylinder('metal_dark', 0, 0.3, 0, 0.3, 0.03, 'y', 12);
    b.cylinder('metal_dark', 0, 0.62, 0, 0.3, 0.03, 'y', 12);
  },
  baie_serveur(b, v) {
    b.box('painted_dark', 0, 1.05, 0, 0.8, 2.1, 1.0);
    for (let i = 0; i < 9; i++) {
      b.box('metal_dark', 0, 0.2 + i * 0.2, 0.505, 0.68, 0.16, 0.01);
      if ((i + v) % 4 !== 0) b.box('$led', -0.26 + ((i * 3 + v) % 5) * 0.05, 0.2 + i * 0.2, 0.512, 0.03, 0.02, 0.005);
    }
    b.box('metal', 0, 2.08, 0, 0.7, 0.03, 0.9);
  },
  console(b, v) {
    b.box('painted_grey', 0, 0.42, 0, 1.6, 0.84, 0.7);
    b.box('painted_dark', 0, 0.9, 0.08, 1.56, 0.12, 0.5);
    b.box('plastic', 0, 1.02, -0.22, 1.5, 0.28, 0.12);
    b.box('$screen', -0.4, 1.03, -0.155, 0.6, 0.22, 0.005);
    if (v % 2 === 0) b.box('$screen', 0.4, 1.03, -0.155, 0.6, 0.22, 0.005);
    for (let i = 0; i < 6; i++) b.box(i % 3 === 0 ? '$red' : 'plastic', -0.6 + i * 0.24, 0.975, 0.2, 0.06, 0.03, 0.06);
  },
  ecrans(b, v) {
    b.box('plastic', 0, 1.65, 0, 1.6, 0.9, 0.08);
    b.box('$screen', -0.4, 1.65, 0.045, 0.72, 0.78, 0.005);
    if (v % 3 !== 0) b.box('$screen', 0.4, 1.65, 0.045, 0.72, 0.78, 0.005);
    else b.box('plastic', 0.4, 1.65, 0.045, 0.72, 0.78, 0.005);
  },
  tuyaux(b, v) {
    for (let i = 0; i < 3; i++) {
      b.cylinder(i === v % 3 ? 'rust' : 'metal', 0, 2.1 + i * 0.16, -0.03 + i * 0.02, 0.05 + (i % 2) * 0.015, 1.9, 'x', 8);
    }
    b.cylinder('painted_red', -0.6, 1.3, 0, 0.045, 2.6, 'y', 8);
    b.box('metal_dark', -0.6, 1.2, 0, 0.14, 0.08, 0.14);
    b.box('metal_dark', 0.3, 2.26, 0, 0.1, 0.5, 0.06);
  },
  cuve(b, v) {
    b.cylinder(v % 2 ? 'painted_white' : 'steel', 0, 1.05, 0, 0.48, 1.8, 'y', 14);
    b.cylinder('metal_dark', 0, 0.1, 0, 0.5, 0.2, 'y', 14);
    b.cylinder('metal_dark', 0, 1.97, 0, 0.3, 0.06, 'y', 14);
    b.box('hazard', 0, 1.2, 0.485, 0.4, 0.25, 0.01);
  },
  etabli(b, v) {
    b.box('wood', 0, 0.87, 0, 1.7, 0.06, 0.7);
    legs(b, 'metal_dark', 1.7, 0.7, 0.85, 0.06);
    b.box('metal_dark', 0, 0.3, 0, 1.6, 0.03, 0.6);
    b.box('painted_red', 0.5, 0.42, 0, 0.5, 0.2, 0.3);
    if (v % 2) b.box('metal', -0.4, 0.95, 0.1, 0.25, 0.1, 0.12);
    b.box('metal_dark', 0.72, 1.0, -0.2, 0.12, 0.2, 0.16);
  },
  paillasse(b, v) {
    b.box('painted_white', 0, 0.44, 0, 1.8, 0.88, 0.7);
    b.box('steel', 0, 0.9, 0, 1.84, 0.04, 0.74);
    for (let i = 0; i < 4; i++) {
      const x = -0.6 + i * 0.4;
      if ((v + i) % 3 === 0) continue;
      b.cylinder('glass', x, 1.02, -0.1 + (i % 2) * 0.15, 0.04, 0.2, 'y', 8);
    }
    b.box('plastic', 0.6, 1.06, -0.15, 0.3, 0.28, 0.25);
  },
  tube_specimen(b) {
    b.cylinder('metal_dark', 0, 0.15, 0, 0.4, 0.3, 'y', 12);
    b.cylinder('glass', 0, 1.15, 0, 0.36, 1.7, 'y', 12);
    b.cylinder('metal_dark', 0, 2.1, 0, 0.4, 0.2, 'y', 12);
    // Ce qui flotte dedans.
    b.box('organic', 0, 1.1, 0, 0.22, 0.9, 0.2);
    b.box('organic', 0.05, 1.7, 0.02, 0.18, 0.2, 0.18);
  },
  tube_brise(b) {
    b.cylinder('metal_dark', 0, 0.15, 0, 0.4, 0.3, 'y', 12);
    b.cylinder('glass', 0, 0.55, 0, 0.36, 0.5, 'y', 12);
    b.cylinder('metal_dark', 0, 2.1, 0, 0.4, 0.2, 'y', 12);
    b.box('metal_dark', -0.33, 1.2, 0, 0.04, 1.7, 0.04);
    b.box('organic', 0.1, 0.34, 0.2, 0.3, 0.08, 0.5);
  },
  table_operation(b) {
    b.cylinder('metal', 0, 0.4, 0, 0.12, 0.8, 'y', 10);
    b.box('metal_dark', 0, 0.03, 0, 0.9, 0.06, 0.6);
    b.box('steel', 0, 0.83, 0, 1.8, 0.06, 0.8);
    b.box('fabric_green', 0, 0.88, 0, 1.7, 0.04, 0.7);
    for (const x of [-0.5, 0.4]) b.box('rubber', x, 0.91, 0, 0.07, 0.015, 0.82);
  },
  potence(b) {
    b.cylinder('metal', 0, 0.9, 0, 0.015, 1.8, 'y', 6);
    b.box('metal_dark', 0, 0.03, 0, 0.36, 0.04, 0.05);
    b.box('metal_dark', 0, 0.03, 0, 0.05, 0.04, 0.36);
    b.box('metal', 0, 1.78, 0, 0.3, 0.02, 0.02);
    b.box('glass', 0.12, 1.6, 0, 0.1, 0.22, 0.04);
  },
  banc(b) {
    b.box('wood', 0, 0.42, 0, 1.6, 0.05, 0.45);
    for (const x of [-0.65, 0.65]) b.box('metal_dark', x, 0.2, 0, 0.05, 0.4, 0.4);
  },
  plante(b) {
    b.cylinder('painted_dark', 0, 0.2, 0, 0.2, 0.4, 'y', 10);
    // Plante morte : quelques tiges sèches.
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3;
      b.box('wood', Math.cos(a) * 0.08, 0.75, Math.sin(a) * 0.08, 0.02, 0.75, 0.02);
    }
    b.box('wood', 0.12, 1.05, 0.05, 0.25, 0.02, 0.06);
  },
  comptoir(b, _v, accent) {
    b.box('painted_grey', 0, 0.5, 0, 1.8, 1.0, 0.7);
    b.box('wood', 0, 1.06, 0, 1.9, 0.06, 0.78);
    b.box(accent, 0, 0.5, 0.355, 1.8, 0.16, 0.01);
    b.box('plastic', -0.5, 1.2, -0.1, 0.36, 0.26, 0.05);
    b.box('paper', 0.3, 1.1, 0.05, 0.3, 0.02, 0.22);
  },
  distributeur(b, v) {
    b.box('painted_dark', 0, 0.95, 0, 0.9, 1.9, 0.7);
    b.box(v % 2 ? '$screen' : 'glass', -0.12, 1.15, 0.352, 0.56, 1.1, 0.01);
    b.box('plastic', 0.33, 1.1, 0.352, 0.14, 0.5, 0.01);
    b.box('plastic', -0.1, 0.3, 0.352, 0.5, 0.18, 0.02);
  },
  transfo(b) {
    b.box('painted_grey', 0, 0.9, 0, 1.4, 1.8, 1.0);
    for (let i = 0; i < 9; i++) b.box('metal_dark', -0.6 + i * 0.15, 0.9, 0.52, 0.03, 1.4, 0.06);
    for (const x of [-0.4, 0, 0.4]) b.cylinder('painted_white', x, 1.95, 0, 0.07, 0.3, 'y', 8);
    b.box('hazard', 0, 1.55, 0.505, 0.5, 0.2, 0.01);
  },
  turbine(b) {
    b.cylinder('painted_green', 0, 0.85, 0, 0.75, 1.5, 'x', 14);
    b.box('metal_dark', 0, 0.12, 0, 1.6, 0.24, 1.3);
    b.cylinder('metal', 0, 0.85, 0, 0.3, 1.64, 'x', 10);
  },
  capsule_cryo(b, v) {
    b.box('painted_white', 0, 0.2, 0, 0.9, 0.4, 0.9);
    b.cylinder('metal', 0, 1.2, 0, 0.42, 1.6, 'y', 12);
    b.box(v % 4 === 0 ? 'plastic' : 'glass', 0, 1.3, 0.38, 0.5, 1.1, 0.06);
    b.box('painted_white', 0, 2.05, 0, 0.9, 0.1, 0.9);
    b.box(v % 4 === 0 ? '$red' : '$blue', 0.3, 0.3, 0.455, 0.06, 0.04, 0.005);
  },
  mousse(b) {
    for (let i = 0; i < 5; i++) for (let j = 0; j < 7; j++) b.box('foam', -0.76 + i * 0.38, 0.2 + j * 0.37, -0.05 + ((i + j) % 2) * 0.08, 0.36, 0.35, 0.12);
  },
  enceinte(b) {
    b.box('painted_dark', 0, 0.8, 0, 0.8, 1.6, 0.5);
    b.cylinder('rubber', 0, 0.5, 0.25, 0.26, 0.03, 'z', 14);
    b.cylinder('rubber', 0, 1.15, 0.25, 0.16, 0.03, 'z', 12);
    b.cylinder('metal_dark', 0, 0.5, 0.265, 0.09, 0.02, 'z', 10);
  },
  housse(b, v) {
    b.box('plastic', 0, 0.13, 0, 1.75, 0.24, 0.55);
    b.box('plastic', -0.7, 0.16, 0, 0.3, 0.3, 0.4);
    b.box('metal', 0, 0.26, 0, 1.5, 0.01, 0.02);
    if (v % 3 === 0) b.box('paper', 0.6, 0.26, 0.12, 0.12, 0.01, 0.08);
  },
  fauteuil_roulant(b) {
    b.box('fabric_dark', 0, 0.5, 0, 0.46, 0.05, 0.44);
    b.box('fabric_dark', 0, 0.75, -0.22, 0.46, 0.45, 0.04);
    for (const x of [-0.27, 0.27]) {
      b.cylinder('rubber', x, 0.3, -0.05, 0.3, 0.04, 'x', 14);
      b.cylinder('rubber', x, 0.08, 0.3, 0.08, 0.03, 'x', 8);
    }
  },
  chariot(b, v) {
    b.box('steel', 0, 0.86, 0, 0.9, 0.03, 0.5);
    b.box('steel', 0, 0.4, 0, 0.9, 0.03, 0.5);
    legs(b, 'metal', 0.9, 0.5, 0.86, 0.025);
    if (v % 2) b.box('steel', -0.2, 0.9, 0.05, 0.3, 0.04, 0.2);
    b.cylinder('glass', 0.25, 0.94, -0.1, 0.035, 0.12, 'y', 8);
  },
  rack_outils(b, v) {
    b.box('painted_dark', 0, 1.1, -0.12, 1.5, 1.4, 0.04);
    for (let i = 0; i < 6; i++) {
      if ((v + i) % 4 === 0) continue;
      b.box(i % 2 ? 'metal' : 'painted_red', -0.6 + i * 0.24, 1.2 + (i % 3) * 0.18, -0.08, 0.05, 0.3 + (i % 2) * 0.15, 0.03);
    }
    b.box('metal_dark', 0, 0.35, 0, 1.5, 0.05, 0.3);
    b.box('painted_red', -0.4, 0.5, 0, 0.4, 0.22, 0.24);
  },
  lavabo(b) {
    b.box('painted_white', 0, 0.8, 0, 0.8, 0.18, 0.5);
    b.box('plastic', 0, 0.86, 0.02, 0.6, 0.08, 0.34);
    b.cylinder('metal', 0, 0.45, -0.1, 0.04, 0.7, 'y', 8);
    b.cylinder('metal', 0, 1.0, -0.18, 0.015, 0.2, 'y', 6);
    b.box('glass', 0, 1.5, -0.23, 0.6, 0.5, 0.02);
  },
  canape(b) {
    b.box('fabric_dark', 0, 0.25, 0.05, 1.7, 0.5, 0.7);
    b.box('fabric_dark', 0, 0.6, -0.32, 1.7, 0.5, 0.16);
    for (const x of [-0.8, 0.8]) b.box('fabric_dark', x, 0.4, 0.05, 0.12, 0.6, 0.7);
  },
  tableau(b, v) {
    b.box('metal', 0, 1.5, 0, 1.6, 1.0, 0.04);
    b.box('painted_white', 0, 1.5, 0.022, 1.52, 0.92, 0.005);
    // Traits de feutre : un schéma à moitié effacé.
    for (let i = 0; i < 4; i++) b.box(i === v % 4 ? 'painted_red' : 'plastic', -0.5 + i * 0.3, 1.45 + ((v + i) % 3) * 0.12, 0.026, 0.22, 0.012, 0.003);
  },
  debris(b, v) {
    for (let i = 0; i < 6; i++) {
      const a = i * 1.1 + v;
      const r = 0.15 + (i % 3) * 0.14;
      b.box(i % 2 ? 'wall_concrete' : 'metal_dark', Math.cos(a) * r, 0.04 + (i % 2) * 0.03, Math.sin(a) * r, 0.12 + (i % 3) * 0.08, 0.06 + (i % 2) * 0.06, 0.1 + (i % 2) * 0.1);
    }
  },
  papiers(b) {
    b.decal('decal_papers', 1.2, 1.2);
  },
  sang(b) {
    b.decal('decal_blood', 1.2, 1.2);
  },
  trainee(b) {
    b.decal('decal_trail', 1.8, 0.7);
  },
  flaque(b) {
    b.decal('decal_puddle', 1.4, 1.4);
  },
  souche(b, v) {
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05 + v;
      const r = (i % 3) * 0.18;
      const h = 0.12 + ((i * 7 + v) % 5) * 0.09;
      b.cylinder('organic', Math.cos(a) * r, h / 2, Math.sin(a) * r, 0.14 + (i % 2) * 0.1, h, 'y', 7);
    }
    b.cylinder('organic', 0, 0.02, 0, 0.6, 0.04, 'y', 10);
  },
  noyau_coeur(b) {
    b.cylinder('metal_dark', 0, 0.2, 0, 1.2, 0.4, 'y', 16);
    b.cylinder('steel', 0, 1.9, 0, 0.55, 3.0, 'y', 14);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.box('metal', Math.cos(a) * 0.95, 1.8, Math.sin(a) * 0.95, 0.08, 3.2, 0.08);
    }
    for (const y of [0.9, 1.9, 2.9]) b.cylinder('metal_dark', 0, y, 0, 1.0, 0.07, 'y', 16);
    b.cylinder('$core', 0, 1.9, 0, 0.36, 2.6, 'y', 12);
    b.cylinder('metal_dark', 0, 3.5, 0, 1.2, 0.2, 'y', 16);
  },
  micro(b) {
    b.cylinder('metal_dark', 0, 0.02, 0, 0.18, 0.04, 'y', 10);
    b.cylinder('metal', 0, 0.8, 0, 0.012, 1.55, 'y', 6);
    b.cylinder('plastic', 0, 1.56, 0, 0.035, 0.12, 'y', 8);
  },
  tiroirs_morgue(b, v) {
    b.box('steel', 0, 1.0, 0, 1.9, 2.0, 0.8);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const open = (v + i * 3 + j) % 11 === 0 ? 0.3 : 0;
      b.box('metal', -0.62 + i * 0.62, 0.36 + j * 0.64, 0.405 + open / 2, 0.56, 0.56, 0.02 + open);
      b.box('metal_dark', -0.62 + i * 0.62, 0.36 + j * 0.64, 0.43 + open, 0.2, 0.03, 0.03);
    }
  },
  rideau(b, v) {
    b.box('metal', 0, 2.0, 0, 1.8, 0.03, 0.03);
    const w = v % 2 ? 1.7 : 0.9;
    for (let i = 0; i < 9; i++) b.box('fabric_green', -0.85 + (i + 0.5) * (w / 9), 1.05, (i % 2) * 0.05 - 0.02, w / 9, 1.85, 0.03);
  },
  panneau(b, _v, accent) {
    b.box('metal_dark', 0, 1.6, 0, 1.2, 0.8, 0.04);
    b.box(accent, 0, 1.85, 0.022, 1.12, 0.18, 0.005);
    for (let i = 0; i < 4; i++) b.box('paper', -0.35 + (i % 2) * 0.7, 1.45 + ((i / 2) | 0) * 0.2, 0.022, 0.4, 0.12, 0.004);
  },
};

const FIXTURE_DRAW: Record<string, Draw> = {
  fusebox(b) {
    b.box('painted_grey', 0, 1.3, 0, 0.7, 1.0, 0.2);
    b.box('painted_dark', 0, 1.3, 0.102, 0.6, 0.9, 0.01);
    b.box('hazard', 0, 1.68, 0.108, 0.5, 0.1, 0.005);
    for (let i = 0; i < 3; i++) b.box('plastic', -0.18 + i * 0.18, 1.3, 0.11, 0.1, 0.3, 0.02);
    b.cylinder('metal', 0.25, 2.1, 0, 0.03, 0.6, 'y', 6);
  },
  generator_main(b) {
    b.box('metal_dark', 0, 0.15, 0, 2.6, 0.3, 1.6);
    b.cylinder('painted_green', -0.3, 1.0, 0, 0.72, 1.7, 'x', 16);
    b.cylinder('metal', -0.3, 1.0, 0, 0.3, 1.8, 'x', 10);
    b.box('painted_grey', 0.95, 0.85, 0, 0.6, 1.1, 1.4);
    b.box('hazard', 0.95, 1.25, 0.705, 0.5, 0.18, 0.01);
    for (let i = 0; i < 6; i++) b.box('metal_dark', -0.95 + i * 0.26, 1.78, 0, 0.05, 0.12, 1.3);
    b.cylinder('rust', 0.95, 1.7, -0.4, 0.1, 0.6, 'y', 8);
    b.box('plastic', 0.95, 0.9, 0.705, 0.4, 0.3, 0.02);
  },
  generator_aux(b) {
    b.box('metal_dark', 0, 0.1, 0, 1.8, 0.2, 1.1);
    b.box('painted_yellow', -0.2, 0.75, 0, 1.2, 1.1, 0.95);
    b.box('painted_dark', 0.65, 0.6, 0, 0.45, 0.8, 0.9);
    for (let i = 0; i < 5; i++) b.box('metal_dark', -0.6 + i * 0.2, 0.8, 0.48, 0.04, 0.8, 0.02);
    b.cylinder('rust', -0.6, 1.4, -0.3, 0.06, 0.4, 'y', 8);
    b.box('plastic', 0.65, 0.85, 0.455, 0.3, 0.22, 0.02);
  },
  terminal(b) {
    b.box('painted_grey', 0, 0.42, 0, 1.2, 0.84, 0.6);
    b.box('painted_dark', 0, 0.88, 0.1, 1.16, 0.08, 0.38);
    b.box('plastic', 0, 1.14, -0.14, 0.9, 0.52, 0.22);
    for (let i = 0; i < 5; i++) b.box('plastic', -0.4 + i * 0.2, 0.93, 0.14, 0.14, 0.015, 0.2);
  },
  airlock(b) {
    b.box('painted_yellow', 0, 1.3, 0, 0.8, 1.2, 0.2);
    b.box('painted_dark', 0, 1.5, 0.102, 0.6, 0.5, 0.01);
    b.box('hazard', 0, 0.82, 0.102, 0.7, 0.14, 0.01);
    b.cylinder('painted_red', 0, 1.02, 0.14, 0.09, 0.06, 'z', 12);
  },
  medstation(b) {
    b.box('painted_white', 0, 0.9, 0, 1.0, 1.8, 0.4);
    b.box('painted_red', 0, 1.5, 0.202, 0.28, 0.08, 0.005);
    b.box('painted_red', 0, 1.5, 0.202, 0.08, 0.28, 0.005);
    b.box('glass', 0, 1.0, 0.205, 0.8, 0.5, 0.01);
    b.box('steel', 0, 0.55, 0.22, 0.7, 0.04, 0.12);
  },
  valve(b) {
    b.cylinder('rust', 0, 1.1, -0.05, 0.09, 2.2, 'y', 10);
    b.cylinder('rust', 0, 1.1, 0.05, 0.11, 0.2, 'z', 10);
    b.cylinder('painted_red', 0, 1.1, 0.18, 0.22, 0.03, 'z', 14);
    b.box('painted_red', 0, 1.1, 0.19, 0.42, 0.04, 0.02);
    b.box('painted_red', 0, 1.1, 0.19, 0.04, 0.42, 0.02);
  },
  purge(b) {
    b.box('painted_red', 0, 0.45, 0, 1.4, 0.9, 0.6);
    b.box('painted_dark', 0, 1.0, -0.08, 1.36, 0.3, 0.4);
    b.box('hazard', 0, 0.45, 0.302, 1.3, 0.2, 0.01);
    b.box('glass', 0.4, 1.02, 0.15, 0.24, 0.14, 0.14);
    b.cylinder('painted_red', 0.4, 0.96, 0.15, 0.06, 0.06, 'y', 10);
  },
  emitter(b) {
    b.cylinder('metal_dark', 0, 0.1, 0, 0.5, 0.2, 'y', 14);
    b.cylinder('metal', 0, 0.9, 0, 0.08, 1.5, 'y', 8);
    for (let i = 0; i < 4; i++) b.cylinder('painted_dark', 0, 1.0 + i * 0.22, 0, 0.42 - i * 0.07, 0.04, 'y', 14);
    b.cylinder('steel', 0, 1.82, 0, 0.12, 0.16, 'y', 10);
  },
  coolant(b) {
    b.box('painted_blue', 0, 0.8, 0, 1.2, 1.6, 0.5);
    for (let i = 0; i < 7; i++) b.box('metal_dark', 0, 0.3 + i * 0.16, 0.255, 1.0, 0.05, 0.01);
    b.cylinder('metal', -0.4, 1.75, 0, 0.07, 0.3, 'y', 8);
    b.cylinder('metal', 0.4, 1.75, 0, 0.07, 0.3, 'y', 8);
  },
  antenna(b) {
    b.box('painted_dark', 0, 0.6, 0, 1.0, 1.2, 0.5);
    b.box('plastic', 0, 0.85, 0.255, 0.8, 0.4, 0.01);
    b.cylinder('metal', 0.3, 1.45, 0, 0.012, 0.6, 'y', 6);
    b.cylinder('metal', -0.3, 1.35, 0, 0.012, 0.4, 'y', 6);
    for (let i = 0; i < 4; i++) b.cylinder('plastic', -0.3 + i * 0.2, 0.45, 0.26, 0.04, 0.03, 'z', 8);
  },
  incinerator(b) {
    b.box('rust', 0, 1.0, 0, 1.6, 2.0, 0.8);
    b.box('metal_dark', 0, 0.9, 0.405, 0.8, 0.7, 0.03);
    b.box('metal', 0.3, 0.9, 0.43, 0.06, 0.3, 0.04);
    b.cylinder('rust', -0.5, 2.3, -0.1, 0.16, 0.8, 'y', 10);
    b.box('hazard', 0, 1.6, 0.402, 1.0, 0.16, 0.005);
  },
  cryo(b) {
    b.box('painted_white', 0, 0.75, 0, 1.2, 1.5, 0.5);
    b.box('painted_dark', 0, 1.05, 0.255, 0.9, 0.5, 0.01);
    b.cylinder('painted_blue', -0.35, 0.5, 0.26, 0.1, 0.03, 'z', 12);
    b.cylinder('steel', 0.45, 1.65, 0, 0.06, 0.4, 'y', 8);
  },
  core_console(b) {
    b.box('metal_dark', 0, 0.45, 0, 1.6, 0.9, 0.7);
    b.box('painted_dark', 0, 1.0, -0.05, 1.56, 0.3, 0.5);
    b.box('hazard', 0, 0.45, 0.352, 1.5, 0.14, 0.005);
    for (const x of [-0.5, 0.5]) b.cylinder('steel', x, 0.94, 0.2, 0.13, 0.12, 'y', 12);
  },
  locker(b, _v, accent) {
    b.box('painted_grey', 0, 1.0, -0.33, 0.8, 2.0, 0.04);
    b.box('painted_grey', -0.38, 1.0, 0, 0.04, 2.0, 0.7);
    b.box('painted_grey', 0.38, 1.0, 0, 0.04, 2.0, 0.7);
    b.box('painted_grey', 0, 1.98, 0, 0.8, 0.04, 0.7);
    b.box(accent, 0, 1.0, 0.34, 0.76, 1.96, 0.03);
    for (let i = 0; i < 4; i++) b.box('metal_dark', 0, 1.55 + i * 0.06, 0.357, 0.5, 0.02, 0.005);
    b.box('metal', 0.28, 1.0, 0.36, 0.03, 0.16, 0.02);
  },
  camera(b) {
    b.box('metal_dark', 0, 0.2, -0.1, 0.06, 0.06, 0.2);
    b.box('painted_white', 0, 0.1, 0.05, 0.14, 0.12, 0.28);
    b.cylinder('plastic', 0, 0.1, 0.2, 0.045, 0.04, 'z', 10);
  },
  sampler(b) {
    b.box('painted_white', 0, 0.45, 0, 1.2, 0.9, 0.6);
    b.cylinder('glass', -0.3, 1.2, 0, 0.2, 0.6, 'y', 12);
    b.box('organic', -0.3, 1.1, 0, 0.2, 0.3, 0.2);
    b.box('plastic', 0.3, 1.05, 0, 0.4, 0.3, 0.3);
    b.cylinder('steel', -0.3, 1.52, 0, 0.22, 0.05, 'y', 12);
  },
  probe(b) {
    b.box('painted_grey', 0, 0.45, 0, 1.2, 0.9, 0.6);
    b.box('plastic', 0, 1.2, -0.15, 0.9, 0.6, 0.2);
    b.cylinder('metal', 0.45, 1.3, 0.15, 0.015, 0.7, 'y', 6);
    b.cylinder('rubber', -0.4, 0.95, 0.18, 0.09, 0.05, 'y', 12);
    b.cylinder('rubber', -0.15, 0.95, 0.18, 0.09, 0.05, 'y', 12);
  },
};

export function drawProp(b: GeoBatch, type: string, variant: number, accent: string): void {
  const draw = PROP_DRAW[type];
  if (draw) draw(b, variant, accent);
}

export function drawFixture(b: GeoBatch, type: string, accent: string): void {
  const draw = FIXTURE_DRAW[type];
  if (draw) draw(b, 0, accent);
}

export const DRAWN_PROPS = Object.keys(PROP_DRAW);
export const DRAWN_FIXTURES = Object.keys(FIXTURE_DRAW);
