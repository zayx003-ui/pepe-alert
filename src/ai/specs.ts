/**
 * Fiches des entités : caractéristiques chiffrées utilisées par l'IA, et texte
 * (comportement, parade) affiché dans les archives et repris dans docs/ENTITIES.md.
 */
import type { InjuryType } from '../player/simulation';
import type { NavCaps } from '../world/nav';
import type { SectorId } from '../world/types';

export type EntityKind = 'visiteur' | 'echo' | 'phototrope' | 'rampant' | 'porteur' | 'statique';

export interface EntitySpec {
  kind: EntityKind;
  name: string;
  /** Vitesses en m/s (le joueur marche à 2,7 et court à 5,1). */
  patrolSpeed: number;
  huntSpeed: number;
  /** Portée de vue en mètres (0 = aveugle) et demi-angle du champ de vision. */
  visionRange: number;
  visionHalfFov: number;
  /** Multiplicateur de portée des bruits perçus (0 = sourd). */
  hearing: number;
  /** Distance à laquelle une lampe allumée est repérée en ligne de vue (0 = indifférent). */
  lightSense: number;
  /** Durée pendant laquelle une dernière position connue reste exploitable. */
  memory: number;
  caps: NavCaps;
  attackRange: number;
  attackDamage: number;
  attackInjury: InjuryType;
  /** Temps de récupération après une attaque, en secondes. */
  recovery: number;
  radius: number;
  height: number;
  home: SectorId[];
  count: number;
  /** Textes de la fiche. */
  summary: string;
  intelligence: string;
  behaviour: string;
  evasion: string;
}

const caps = (openDoors: boolean, vents: boolean, breach: boolean, gates: boolean): NavCaps => ({ openDoors, vents, breach, gates });

export const ENTITY_SPECS: Record<EntityKind, EntitySpec> = {
  visiteur: {
    kind: 'visiteur',
    name: 'Le Visiteur',
    patrolSpeed: 1.9,
    huntSpeed: 4.6,
    visionRange: 22,
    visionHalfFov: 1.05,
    hearing: 1.2,
    lightSense: 30,
    memory: 14,
    caps: caps(true, false, true, true),
    attackRange: 1.5,
    attackDamage: 36,
    attackInjury: 'profonde',
    recovery: 32,
    radius: 0.35,
    height: 2.3,
    home: ['noyau', 'experimental'],
    count: 1,
    summary: "Ce qui est revenu de la Nuit commune à la place des neuf sujets. Grand, lent tant qu'il observe, il emprunte les voix et les gestes de ceux qu'il a croisés.",
    intelligence: "Élevée. Neuf états (dormant, observation, investigation, imitation, approche, chasse, attaque, disparition, repositionnement) et trois traits tirés à chaque expédition — agressivité, ruse, patience — qui modifient ses choix. Il mémorise les zones où il a perçu des joueurs, remarque les portes déplacées et ne connaît jamais une position qu'il n'a ni vue ni entendue.",
    behaviour: "Observe de loin depuis l'ombre et disparaît si on l'éclaire trop longtemps. Imite des pas, des portes, des appels ou un message radio pour isoler quelqu'un. Frappe une fois puis se retire : il revient plus tard, ailleurs. Courant principal rétabli, il perçoit mieux et patiente moins.",
    evasion: "Rompre la ligne de vue puis se cacher (casier, pièce fermée) : il perd la trace au bout d'une quinzaine de secondes. Rester groupés : il n'attaque pas un groupe qui le regarde. Vérifier toute voix au détecteur sonore : une imitation n'a pas de signature organique. Une porte verrouillée ou barricadée le retarde mais ne l'arrête pas.",
  },
  echo: {
    kind: 'echo',
    name: "L'Écho",
    patrolSpeed: 1.6,
    huntSpeed: 5.6,
    visionRange: 0,
    visionHalfFov: 0,
    hearing: 2.4,
    lightSense: 0,
    memory: 9,
    caps: caps(true, false, true, false),
    attackRange: 1.6,
    attackDamage: 44,
    attackInjury: 'traumatisme',
    recovery: 12,
    radius: 0.4,
    height: 1.9,
    home: ['acoustique'],
    count: 1,
    summary: "Né dans la chambre anéchoïque. Totalement aveugle, il se dirige par cliquetis et fond sur la moindre réponse sonore.",
    intelligence: "Moyenne. Trie les bruits par intensité et par répétition : un bruit isolé l'intrigue, deux bruits au même endroit déclenchent la charge. Son cliquetis révèle tout ce qui bouge à moins de cinq mètres.",
    behaviour: "Patrouille lentement en cliquetant. Va écouter l'endroit d'où est venu un bruit, puis charge à 5,6 m/s — plus vite qu'un joueur — si le bruit se répète. Enfonce les portes plutôt que de les ouvrir.",
    evasion: "S'immobiliser dès qu'il cliquette, marcher accroupi, retenir sa respiration quand il passe. Lancer un objet au loin pour le détourner. Ne jamais courir : sa charge rattrape un sprinteur. La lampe ne l'attire pas.",
  },
  phototrope: {
    kind: 'phototrope',
    name: 'Le Phototrope',
    patrolSpeed: 1.2,
    huntSpeed: 4.8,
    visionRange: 0,
    visionHalfFov: Math.PI,
    hearing: 0.25,
    lightSense: 30,
    memory: 5,
    caps: caps(true, false, false, false),
    attackRange: 1.5,
    attackDamage: 28,
    attackInjury: 'brulure',
    recovery: 8,
    radius: 0.4,
    height: 1.7,
    home: ['medical', 'archives', 'experimental'],
    count: 1,
    summary: "Masse pâle qui dérive dans les secteurs éteints. Elle ne perçoit que la lumière et s'y jette.",
    intelligence: 'Faible. Suit la source lumineuse la plus vive en ligne de vue : lampe torche, marqueur lumineux, pièce éclairée. Sans lumière, elle erre.',
    behaviour: "Dérive lentement dans le noir. Converge sur toute lampe visible puis charge son porteur ; son contact brûle. Absorbe les marqueurs lumineux qu'elle atteint.",
    evasion: "Éteindre sa lampe : elle perd la cible en quelques secondes et rejoint la dernière lueur vue. Lancer ou déposer un marqueur lumineux comme leurre. Presque sourde : on peut courir dans le noir. Rétablir le courant d'un secteur l'y attire et l'y fixe.",
  },
  rampant: {
    kind: 'rampant',
    name: 'Le Rampant',
    patrolSpeed: 2.2,
    huntSpeed: 2.5,
    visionRange: 9,
    visionHalfFov: 1.4,
    hearing: 1.5,
    lightSense: 0,
    memory: 8,
    caps: caps(false, true, false, false),
    attackRange: 1.5,
    attackDamage: 24,
    attackInjury: 'legere',
    recovery: 26,
    radius: 0.35,
    height: 0.8,
    home: ['maintenance'],
    count: 1,
    summary: "Habitant des conduits. On l'entend racler dans les plafonds avant de le voir jaillir d'une grille.",
    intelligence: "Moyenne. Connaît le réseau de conduits et choisit la grille la plus proche du bruit entendu. Ne sait pas ouvrir une porte.",
    behaviour: "Écoute depuis un conduit, rejoint la grille la plus proche d'une proie et attend qu'elle passe à portée pour surgir. À découvert il est lent et renonce après quelques secondes pour regagner une grille.",
    evasion: "Se tenir au milieu des pièces, loin des grilles. Refermer les grilles : il doit les forcer bruyamment. À découvert, marcher suffit à le distancer ; toute porte fermée l'arrête.",
  },
  porteur: {
    kind: 'porteur',
    name: 'Le Porteur',
    patrolSpeed: 0.9,
    huntSpeed: 1.9,
    visionRange: 13,
    visionHalfFov: 1.2,
    hearing: 1,
    lightSense: 0,
    memory: 20,
    caps: caps(false, false, false, true),
    attackRange: 1.3,
    attackDamage: 14,
    attackInjury: 'legere',
    recovery: 3,
    radius: 0.35,
    height: 1.8,
    home: ['quarantaine'],
    count: 3,
    summary: "Ancien sujet recouvert par la Souche. Il ne dort plus, ne court pas, et suit quiconque passe à portée.",
    intelligence: 'Très faible. Marche vers ce qu’il voit ou entend et ne renonce presque jamais. Incapable d’ouvrir une porte.',
    behaviour: "Erre dans la quarantaine et en sort par toute porte laissée ouverte. Son simple voisinage infecte ; son contact blesse et infecte davantage.",
    evasion: "Marcher : il est plus lent qu'un joueur. Fermer les portes derrière soi — une porte fermée l'arrête définitivement. La purge thermique de la quarantaine les détruit tous.",
  },
  statique: {
    kind: 'statique',
    name: 'Le Statique',
    patrolSpeed: 1.1,
    huntSpeed: 2.1,
    visionRange: 0,
    visionHalfFov: Math.PI,
    hearing: 0,
    lightSense: 0,
    memory: 4,
    caps: caps(true, true, true, false),
    attackRange: 2.4,
    attackDamage: 20,
    attackInjury: 'brulure',
    recovery: 22,
    radius: 0.3,
    height: 1.6,
    home: ['serveurs'],
    count: 1,
    summary: "Présence électromagnétique née des baies de calcul. Presque invisible à l'œil nu, elle traverse les cloisons et se nourrit du courant.",
    intelligence: "Faible. Se dirige vers la plus forte concentration d'appareils allumés dans un rayon de vingt-cinq mètres, sans se soucier des murs.",
    behaviour: "Dérive entre les baies. À son approche les lampes faiblissent, la radio grésille et les batteries se vident six fois plus vite. Rester à son contact provoque une décharge qui brûle, après quoi elle se dissipe un moment.",
    evasion: "Éteindre lampe, radio et détecteurs : elle se désintéresse aussitôt. Surveiller l'appareil de mesure, qui signale l'anomalie électromagnétique bien avant le contact. Sortir de son rayon en marchant.",
  },
};

export const ENTITY_KINDS = Object.keys(ENTITY_SPECS) as EntityKind[];
