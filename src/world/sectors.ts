import type { SectorId } from './types';

export interface SectorDef {
  id: SectorId;
  name: string;
  /** Rôle narratif affiché dans la carte et les archives. */
  role: string;
  /** Palier de progression (0 = accessible dès le départ). */
  tier: 0 | 1 | 2 | 3 | 4;
  /** Secteurs auxquels celui-ci peut être rattaché dans l'arbre principal. */
  parents: SectorId[];
  /** Niveau de carte exigé par le sas d'entrée (0 = libre). */
  gateLevel: 0 | 1 | 2 | 3;
  /** Salle centrale éventuelle (hall) : type + dimensions en cellules. */
  hub: { type: string; w: number; h: number } | null;
  /** Types de salles : les premières sont prioritaires (attribuées aux plus grandes salles). */
  rooms: string[];
  /** Types de remplissage une fois les salles prioritaires attribuées. */
  filler: string[];
  /** Couleur d'accent (signalétique, bandes murales) en RGB 0-1. */
  accent: [number, number, number];
  wall: string;
  floor: string;
  /** Surface dominante pour les sons de pas. */
  surface: 'beton' | 'metal' | 'carrelage' | 'grille' | 'moquette';
  /** Température ambiante en °C. */
  temperature: number;
  /** Contamination biologique ambiante (0-1). */
  contamination: number;
  /** Bruit de fond du secteur (masque partiellement les bruits des joueurs). */
  ambientNoise: number;
  /** Risque particulier du secteur, décrit dans la documentation. */
  hazard: string;
}

export const SECTORS: SectorDef[] = [
  {
    id: 'accueil',
    name: 'Accueil',
    role: "Sas d'entrée, poste de sécurité et point d'extraction.",
    tier: 0,
    parents: [],
    gateLevel: 0,
    hub: { type: 'hall_accueil', w: 5, h: 4 },
    rooms: ['sas_extraction', 'poste_securite', 'vestiaire', 'salle_attente'],
    filler: ['reserve', 'bureau'],
    accent: [0.85, 0.62, 0.2],
    wall: 'wall_panel',
    floor: 'floor_tile',
    surface: 'carrelage',
    temperature: 17,
    contamination: 0,
    ambientNoise: 0.12,
    hazard: "Le sas ne se rouvre qu'une fois le cycle d'extraction lancé : attendre ici attire ce qui rôde.",
  },
  {
    id: 'administration',
    name: 'Administration',
    role: 'Bureaux de direction, badges et registres du personnel.',
    tier: 0,
    parents: ['accueil'],
    gateLevel: 0,
    hub: null,
    rooms: ['bureau_direction', 'salle_reunion', 'bureau', 'bureau', 'salle_badges'],
    filler: ['bureau', 'reserve', 'salle_repos'],
    accent: [0.3, 0.5, 0.75],
    wall: 'wall_panel',
    floor: 'floor_carpet',
    surface: 'moquette',
    temperature: 18,
    contamination: 0,
    ambientNoise: 0.08,
    hazard: 'La moquette étouffe les pas… ceux de tout le monde.',
  },
  {
    id: 'medical',
    name: 'Secteur médical',
    role: 'Infirmerie, bloc opératoire et suivi des sujets du protocole.',
    tier: 1,
    parents: ['accueil', 'administration'],
    gateLevel: 1,
    hub: null,
    rooms: ['bloc_operatoire', 'infirmerie', 'pharmacie', 'morgue', 'chambre_patient', 'chambre_patient'],
    filler: ['chambre_patient', 'reserve', 'bureau'],
    accent: [0.3, 0.75, 0.65],
    wall: 'wall_tile',
    floor: 'floor_tile',
    surface: 'carrelage',
    temperature: 16,
    contamination: 0.05,
    ambientNoise: 0.1,
    hazard: 'Les moniteurs encore branchés bipent à intervalles irréguliers et couvrent les bruits proches.',
  },
  {
    id: 'maintenance',
    name: 'Maintenance',
    role: 'Ateliers, générateur secondaire et accès aux conduits techniques.',
    tier: 1,
    parents: ['accueil', 'administration'],
    gateLevel: 1,
    hub: null,
    rooms: ['salle_generateur_aux', 'atelier', 'magasin', 'local_technique'],
    filler: ['local_technique', 'reserve', 'magasin'],
    accent: [0.9, 0.45, 0.1],
    wall: 'wall_concrete',
    floor: 'floor_metal',
    surface: 'metal',
    temperature: 21,
    contamination: 0,
    ambientNoise: 0.25,
    hazard: 'Réseau de conduits dense : le Rampant y circule librement.',
  },
  {
    id: 'archives',
    name: 'Archives',
    role: 'Dossiers papier du Protocole et salle de lecture.',
    tier: 1,
    parents: ['administration'],
    gateLevel: 1,
    hub: null,
    rooms: ['salle_archives', 'salle_archives', 'salle_lecture', 'chambre_forte'],
    filler: ['salle_archives', 'bureau', 'reserve'],
    accent: [0.6, 0.5, 0.35],
    wall: 'wall_concrete',
    floor: 'floor_concrete',
    surface: 'beton',
    temperature: 15,
    contamination: 0,
    ambientNoise: 0.05,
    hazard: 'Rayonnages serrés : lignes de vue très courtes et silence presque total.',
  },
  {
    id: 'acoustique',
    name: 'Laboratoire acoustique',
    role: "Chambres anéchoïques où l'on enregistrait les « réponses » du Noyau.",
    tier: 2,
    parents: ['administration', 'archives', 'maintenance'],
    gateLevel: 2,
    hub: null,
    rooms: ['chambre_anechoique', 'regie_son', 'labo_resonance', 'salle_ecoute'],
    filler: ['salle_ecoute', 'reserve', 'bureau'],
    accent: [0.6, 0.35, 0.75],
    wall: 'wall_foam',
    floor: 'floor_carpet',
    surface: 'moquette',
    temperature: 17,
    contamination: 0,
    ambientNoise: 0.02,
    hazard: "Territoire de l'Écho. Le moindre bruit porte deux fois plus loin.",
  },
  {
    id: 'bio',
    name: 'Laboratoire biologique',
    role: 'Culture de la Souche et analyses des tissus prélevés.',
    tier: 2,
    parents: ['medical', 'archives'],
    gateLevel: 2,
    hub: null,
    rooms: ['labo_culture', 'labo_analyse', 'salle_specimens', 'sas_decontamination'],
    filler: ['labo_analyse', 'reserve', 'bureau'],
    accent: [0.45, 0.8, 0.3],
    wall: 'wall_tile',
    floor: 'floor_tile',
    surface: 'carrelage',
    temperature: 14,
    contamination: 0.25,
    ambientNoise: 0.1,
    hazard: 'Air contaminé : sans décontamination, une infection progresse lentement.',
  },
  {
    id: 'serveurs',
    name: 'Serveurs',
    role: "Baies de calcul qui modélisaient le Protocole. Tout n'est pas éteint.",
    tier: 2,
    parents: ['archives', 'administration', 'acoustique'],
    gateLevel: 2,
    hub: null,
    rooms: ['salle_serveurs', 'salle_serveurs', 'salle_controle', 'local_onduleurs'],
    filler: ['salle_serveurs', 'local_technique', 'bureau'],
    accent: [0.2, 0.6, 0.9],
    wall: 'wall_metal',
    floor: 'floor_grate',
    surface: 'grille',
    temperature: 12,
    contamination: 0,
    ambientNoise: 0.3,
    hazard: 'Interférences : la radio décroche et le Statique vide les batteries.',
  },
  {
    id: 'centrale',
    name: 'Centrale électrique',
    role: 'Générateur principal, transformateurs et distribution.',
    tier: 2,
    parents: ['maintenance'],
    gateLevel: 2,
    hub: { type: 'hall_generateur', w: 5, h: 5 },
    rooms: ['salle_commande', 'salle_transfo', 'local_technique'],
    filler: ['local_technique', 'magasin', 'reserve'],
    accent: [0.9, 0.8, 0.15],
    wall: 'wall_metal',
    floor: 'floor_grate',
    surface: 'grille',
    temperature: 24,
    contamination: 0,
    ambientNoise: 0.4,
    hazard: 'Vapeur sous pression et arcs électriques : brûlures. Le vacarme masque les approches.',
  },
  {
    id: 'quarantaine',
    name: 'Zone de quarantaine',
    role: 'Cellules de confinement des sujets infectés par la Souche.',
    tier: 3,
    parents: ['bio', 'medical'],
    gateLevel: 3,
    hub: null,
    rooms: ['cellule_confinement', 'cellule_confinement', 'salle_observation', 'incinerateur', 'cellule_confinement'],
    filler: ['cellule_confinement', 'sas_decontamination', 'reserve'],
    accent: [0.85, 0.2, 0.15],
    wall: 'wall_metal',
    floor: 'floor_concrete',
    surface: 'beton',
    temperature: 11,
    contamination: 0.6,
    ambientNoise: 0.08,
    hazard: 'Contamination élevée, Porteurs errants. Chaque porte laissée ouverte étend la Souche.',
  },
  {
    id: 'experimental',
    name: 'Secteur expérimental',
    role: 'Dortoirs instrumentés du Protocole : là où les sujets « partaient ».',
    tier: 3,
    parents: ['quarantaine', 'bio', 'serveurs', 'acoustique'],
    gateLevel: 3,
    hub: null,
    rooms: ['dortoir_protocole', 'salle_induction', 'salle_observation', 'labo_resonance', 'cryo'],
    filler: ['dortoir_protocole', 'bureau', 'reserve'],
    accent: [0.7, 0.2, 0.5],
    wall: 'wall_panel',
    floor: 'floor_metal',
    surface: 'metal',
    temperature: 9,
    contamination: 0.1,
    ambientNoise: 0.06,
    hazard: 'Froid intense et hallucinations plus fréquentes : le stress monte sans raison apparente.',
  },
  {
    id: 'noyau',
    name: 'Noyau NOCTURNE',
    role: 'Chambre du Noyau, quatre mètres sous le reste du complexe.',
    tier: 4,
    parents: ['experimental'],
    gateLevel: 3,
    hub: { type: 'chambre_noyau', w: 6, h: 6 },
    rooms: ['antichambre', 'salle_controle', 'cryo'],
    filler: ['local_technique', 'antichambre', 'reserve'],
    accent: [0.55, 0.1, 0.1],
    wall: 'wall_metal',
    floor: 'floor_grate',
    surface: 'grille',
    temperature: 5,
    contamination: 0.15,
    ambientNoise: 0.2,
    hazard: 'Le Visiteur y revient toujours. Température proche de zéro.',
  },
];

export const SECTOR_BY_ID: Record<SectorId, SectorDef> = Object.fromEntries(SECTORS.map((s) => [s.id, s])) as Record<
  SectorId,
  SectorDef
>;

export function sectorName(id: SectorId): string {
  return SECTOR_BY_ID[id].name;
}
