/**
 * Catalogue des éléments de décor : dimensions (pour les collisions et le placement)
 * indépendantes du moteur 3D. Le rendu correspondant est dans engine/propMeshes.ts.
 */
export interface PropSpec {
  /** Largeur (axe local X), profondeur (axe local Z) et hauteur en mètres. */
  w: number;
  d: number;
  h: number;
  /** Bloque le déplacement. */
  solid: boolean;
  /** Hauteur d'un plan de pose pour les objets (bureau, étagère…). */
  surface?: number;
  /** Bloque la vue des entités (meuble haut). */
  tall?: boolean;
}

const s = (w: number, d: number, h: number, solid = true, surface?: number): PropSpec => ({
  w,
  d,
  h,
  solid,
  surface,
  tall: solid && h >= 1.7,
});

export const PROPS: Record<string, PropSpec> = {
  bureau: s(1.5, 0.7, 0.76, true, 0.78),
  table: s(1.6, 0.8, 0.75, true, 0.77),
  chaise: s(0.5, 0.5, 0.9, false),
  chaise_tombee: s(0.9, 0.5, 0.5, false),
  etagere: s(1.6, 0.45, 2.0, true, 1.02),
  etagere_archives: s(1.8, 0.5, 2.2, true, 1.1),
  casier_decor: s(1.5, 0.5, 1.9),
  armoire: s(1.0, 0.5, 1.9),
  armoire_ouverte: s(1.0, 0.5, 1.9),
  classeur: s(1.0, 0.6, 1.3, true, 1.32),
  lit: s(1.9, 0.9, 0.6, true, 0.62),
  lit_protocole: s(1.9, 0.9, 0.7, true),
  brancard: s(1.8, 0.7, 0.9, true, 0.92),
  caisse: s(0.8, 0.8, 0.8, true, 0.82),
  caisses: s(1.4, 0.8, 1.5),
  baril: s(0.6, 0.6, 0.9),
  baie_serveur: s(0.8, 1.0, 2.1),
  console: s(1.6, 0.7, 1.15),
  ecrans: s(1.6, 0.12, 0.9, false),
  tuyaux: s(1.9, 0.25, 2.6, false),
  cuve: s(1.0, 1.0, 2.0),
  etabli: s(1.7, 0.7, 0.9, true, 0.92),
  paillasse: s(1.8, 0.7, 0.9, true, 0.92),
  tube_specimen: s(0.8, 0.8, 2.2),
  tube_brise: s(0.8, 0.8, 2.2),
  table_operation: s(1.8, 0.8, 0.9, true),
  potence: s(0.4, 0.4, 1.8, false),
  banc: s(1.6, 0.5, 0.45),
  plante: s(0.5, 0.5, 1.2, false),
  comptoir: s(1.8, 0.7, 1.1, true, 1.12),
  distributeur: s(0.9, 0.7, 1.9),
  transfo: s(1.4, 1.0, 1.8),
  turbine: s(1.6, 1.6, 1.6),
  capsule_cryo: s(0.9, 0.9, 2.1),
  mousse: s(1.9, 0.3, 2.6, false),
  enceinte: s(0.8, 0.5, 1.6),
  housse: s(1.8, 0.6, 0.3, false),
  fauteuil_roulant: s(0.6, 0.8, 0.9, false),
  chariot: s(0.9, 0.5, 0.9, true, 0.9),
  rack_outils: s(1.5, 0.3, 1.8),
  lavabo: s(0.8, 0.5, 0.9),
  canape: s(1.7, 0.8, 0.8),
  tableau: s(1.6, 0.08, 1.0, false),
  debris: s(1.0, 1.0, 0.2, false),
  papiers: s(1.2, 1.2, 0.01, false),
  sang: s(1.2, 1.2, 0.01, false),
  trainee: s(1.8, 0.6, 0.01, false),
  flaque: s(1.4, 1.4, 0.01, false),
  souche: s(1.2, 1.2, 0.6, false),
  noyau_coeur: s(2.4, 2.4, 3.6),
  micro: s(0.4, 0.4, 1.6, false),
  tiroirs_morgue: s(1.9, 0.8, 2.0),
  rideau: s(1.8, 0.08, 2.0, false),
  panneau: s(1.2, 0.06, 0.8, false),
};

export function propSpec(type: string): PropSpec {
  const spec = PROPS[type];
  if (!spec) throw new Error(`Élément de décor inconnu : ${type}`);
  return spec;
}

/** Dimensions des machines et équipements fixes (FixtureType). */
export const FIXTURE_SPECS: Record<string, PropSpec> = {
  fusebox: s(0.7, 0.2, 1.0, false),
  generator_main: s(2.6, 1.6, 2.0),
  generator_aux: s(1.8, 1.1, 1.4),
  terminal: s(1.2, 0.6, 1.4),
  airlock: s(0.8, 0.2, 1.2, false),
  medstation: s(1.0, 0.4, 1.8),
  valve: s(0.7, 0.3, 1.3, false),
  purge: s(1.4, 0.6, 1.2),
  emitter: s(1.0, 1.0, 1.9),
  coolant: s(1.2, 0.5, 1.6),
  antenna: s(1.0, 0.5, 1.7),
  incinerator: s(1.6, 0.8, 2.0),
  cryo: s(1.2, 0.5, 1.5),
  core_console: s(1.6, 0.7, 1.2),
  locker: s(0.8, 0.7, 2.0),
  camera: s(0.3, 0.3, 0.3, false),
  sampler: s(1.2, 0.6, 1.5),
  probe: s(1.2, 0.6, 1.6),
};
