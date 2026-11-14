/**
 * Catalogue des objectifs (30) : 10 principaux et 20 secondaires.
 * Chaque objectif est une suite d'étapes évaluées par l'hôte sur l'état du monde.
 */
import type { EntityKind } from '../ai/specs';
import type { SectorId } from '../world/types';

export type StepDef =
  /** L'équipe a ramassé `count` exemplaires de l'objet. */
  | { type: 'collect'; item: string; data?: string; count: number; label: string }
  /** Une machine remplit une condition. */
  | { type: 'fixture'; id: string; cond: 'on' | 'off' | 'fused' | 'running' | 'value'; value?: number; label: string }
  | { type: 'flag'; name: string; label: string }
  /** Un joueur vivant se trouve dans le secteur. */
  | { type: 'reach'; sector: SectorId; label: string }
  | { type: 'power'; sector: SectorId | 'principal'; label: string }
  | { type: 'terminal'; id: string; label: string }
  | { type: 'download'; id: string; label: string }
  /** Relevés à l'appareil de mesure dans des salles distinctes des secteurs donnés. */
  | { type: 'measure'; sectors: SectorId[]; count: number; label: string }
  | { type: 'camera'; sector: SectorId; label: string }
  | { type: 'documents'; count: number; label: string }
  | { type: 'observe'; kind: EntityKind; label: string }
  | { type: 'markers'; count: number; label: string }
  /** Tous les sas du secteur fermés et verrouillés. */
  | { type: 'seal'; sector: SectorId; label: string }
  | { type: 'valves'; label: string };

export type Consequence =
  /** La menace globale augmente (les entités deviennent plus entreprenantes). */
  | 'menace+'
  | 'menace-'
  /** Le Visiteur est tiré de sa dormance. */
  | 'reveil'
  /** Un colis de soins est déposé au hall d'accueil. */
  | 'ravitaillement'
  /** Toutes les salles visitées par l'équipe sont révélées sur la carte. */
  | 'carte';

export interface ObjectiveDef {
  id: string;
  kind: 'principal' | 'secondaire';
  title: string;
  brief: string;
  /** Condition de départ : l'objectif reste masqué tant qu'elle n'est pas remplie. */
  start?: StepDef;
  steps: StepDef[];
  /** Condition d'échec (objectifs secondaires uniquement : un principal n'échoue que par la mort de l'équipe). */
  fail?: { type: 'timer'; seconds: number } | { type: 'flag'; name: string } | { type: 'deaths'; count: number };
  /** Récompense en points d'expérience (calculée et attribuée côté serveur). */
  xp: number;
  /** Conséquence sur la partie en cas de réussite. */
  consequence?: Consequence;
  /** Conséquence en cas d'échec. */
  penalty?: Consequence;
  /** Texte décrivant la conséquence, affiché dans le briefing. */
  consequenceText: string;
  /** Deux objectifs partageant une étiquette ne sont pas tirés ensemble. */
  tags: string[];
}

export const OBJECTIVES: ObjectiveDef[] = [
  /* ------------------------- PRINCIPAUX ------------------------- */
  {
    id: 'P-MED',
    kind: 'principal',
    title: 'Restaurer le secteur médical',
    brief: "Le dossier expérimental n'existe plus que dans le terminal médical. Rétablissez le courant du secteur et extrayez-le.",
    steps: [
      { type: 'collect', item: 'fusible', count: 3, label: 'Trouver trois fusibles' },
      { type: 'fixture', id: 'generator_aux.maintenance', cond: 'on', label: 'Démarrer le générateur secondaire (Maintenance)' },
      { type: 'fixture', id: 'fusebox.medical', cond: 'fused', label: 'Rétablir le courant du secteur médical' },
      { type: 'terminal', id: 'terminal.medical', label: 'Redémarrer le terminal médical' },
      { type: 'download', id: 'terminal.medical', label: 'Récupérer le dossier expérimental' },
    ],
    xp: 420,
    consequence: 'reveil',
    consequenceText: 'Le générateur secondaire attire ce qui dort. Le Visiteur se réveille dès la fin du transfert.',
    tags: ['medical', 'aux', 'fuses'],
  },
  {
    id: 'P-PWR',
    kind: 'principal',
    title: 'Rallumer la centrale',
    brief: 'Sans le générateur principal, laboratoires et ascenseur restent morts. Remettez la centrale en service.',
    steps: [
      { type: 'reach', sector: 'centrale', label: 'Atteindre la centrale électrique' },
      { type: 'fixture', id: 'fusebox.centrale', cond: 'fused', label: 'Compléter le tableau de la centrale' },
      { type: 'fixture', id: 'generator_main.centrale', cond: 'on', label: 'Démarrer le générateur principal' },
      { type: 'power', sector: 'serveurs', label: 'Alimenter le secteur des serveurs' },
      { type: 'power', sector: 'bio', label: 'Alimenter le laboratoire biologique' },
    ],
    xp: 460,
    consequence: 'menace+',
    consequenceText: 'La lumière revient partout : le Visiteur perçoit mieux et patiente moins.',
    tags: ['main', 'fuses'],
  },
  {
    id: 'P-CORE',
    kind: 'principal',
    title: 'Désaccorder le Noyau',
    brief: "Tant que le Noyau résonne, le seuil reste ouvert. Descendez et refermez-le.",
    steps: [
      { type: 'collect', item: 'cellule', count: 2, label: "Récupérer deux cellules d'énergie" },
      { type: 'power', sector: 'principal', label: 'Démarrer le générateur principal' },
      { type: 'reach', sector: 'noyau', label: 'Descendre au Noyau' },
      { type: 'fixture', id: 'core_console.noyau', cond: 'value', value: 2, label: 'Insérer les cellules dans la console' },
      { type: 'fixture', id: 'core_console.noyau', cond: 'running', label: 'Lancer le désaccord' },
      { type: 'flag', name: 'detuned', label: 'Tenir deux minutes pendant le désaccord' },
    ],
    xp: 620,
    consequence: 'menace+',
    consequenceText: 'Le Visiteur ne peut plus repartir. Il le sait.',
    tags: ['main', 'core', 'cells'],
  },
  {
    id: 'P-DATA',
    kind: 'principal',
    title: 'Extraire les données du Protocole',
    brief: 'Le consortium veut les modèles de la Nuit commune. Récupérez les disques et les journaux des serveurs.',
    steps: [
      { type: 'collect', item: 'disque', count: 3, label: 'Récupérer trois disques de données' },
      { type: 'power', sector: 'serveurs', label: 'Alimenter le secteur des serveurs' },
      { type: 'download', id: 'terminal.serveurs', label: 'Transférer le journal système (Serveurs)' },
      { type: 'power', sector: 'archives', label: 'Alimenter les archives' },
      { type: 'download', id: 'terminal.archives', label: "Transférer l'index des archives" },
    ],
    xp: 480,
    consequence: 'menace+',
    consequenceText: 'Chaque transfert réveille un peu plus les baies : le Statique gagne en vigueur.',
    tags: ['data', 'servers', 'archives'],
  },
  {
    id: 'P-PURGE',
    kind: 'principal',
    title: 'Purger la quarantaine',
    brief: "La Souche déborde des cellules. Lancez la purge thermique avant qu'elle n'atteigne les secteurs sains.",
    steps: [
      { type: 'power', sector: 'principal', label: 'Démarrer le générateur principal' },
      { type: 'power', sector: 'quarantaine', label: 'Alimenter la zone de quarantaine' },
      { type: 'fixture', id: 'purge.quarantaine', cond: 'running', label: "Lancer la purge depuis la salle d'observation" },
      { type: 'flag', name: 'purged', label: 'Attendre la fin de la purge — hors de la zone' },
    ],
    xp: 520,
    consequence: 'menace-',
    consequenceText: 'Les Porteurs sont détruits et la contamination de la quarantaine disparaît.',
    tags: ['main', 'purge', 'quarantine'],
  },
  {
    id: 'P-SAMPLE',
    kind: 'principal',
    title: 'Détruire la Souche',
    brief: "Aucune culture ne doit quitter le complexe. Rassemblez les échantillons et brûlez-les.",
    steps: [
      { type: 'collect', item: 'echantillon', count: 3, label: 'Rassembler trois échantillons (Laboratoire biologique)' },
      { type: 'power', sector: 'quarantaine', label: "Alimenter la quarantaine (incinérateur)" },
      { type: 'fixture', id: 'incinerator.quarantaine', cond: 'value', value: 3, label: 'Incinérer les trois échantillons' },
    ],
    xp: 500,
    consequence: 'menace-',
    consequenceText: 'Privés de la Souche, les Porteurs ralentissent.',
    tags: ['samples', 'quarantine'],
  },
  {
    id: 'P-ACOUSTIC',
    kind: 'principal',
    title: 'Reconstituer la réponse',
    brief: "Le Noyau répondait à une fréquence précise. Retrouvez les bandes, réglez l'émetteur et enregistrez ce qui revient.",
    steps: [
      { type: 'collect', item: 'bande', count: 3, label: 'Retrouver trois bandes acoustiques' },
      { type: 'power', sector: 'acoustique', label: 'Alimenter le laboratoire acoustique' },
      { type: 'fixture', id: 'emitter.acoustique', cond: 'value', value: 1, label: "Régler l'émetteur sur la fréquence B" },
      { type: 'fixture', id: 'emitter.acoustique', cond: 'on', label: "Activer l'émetteur" },
      { type: 'fixture', id: 'probe.experimental', cond: 'value', value: 1, label: "Enregistrer la réponse au banc d'induction" },
    ],
    xp: 520,
    consequence: 'reveil',
    consequenceText: "L'émetteur s'entend dans tout le complexe. Quelque chose répond.",
    tags: ['acoustic', 'probe'],
  },
  {
    id: 'P-DOSSIER',
    kind: 'principal',
    title: 'Récupérer les dossiers scellés',
    brief: 'Deux dossiers papier prouvent ce qui est arrivé aux neuf sujets. Rapportez-les, avec tout document utile.',
    steps: [
      { type: 'collect', item: 'dossier', data: 'protocole', count: 1, label: 'Dossier « Protocole » (chambre forte des Archives)' },
      { type: 'collect', item: 'dossier', data: 'sujets', count: 1, label: 'Dossier « Sujets » (Secteur expérimental)' },
      { type: 'documents', count: 6, label: 'Rassembler six documents' },
    ],
    xp: 440,
    consequence: 'carte',
    consequenceText: "Les plans joints aux dossiers révèlent l'ensemble du complexe sur la carte.",
    tags: ['dossier', 'documents'],
  },
  {
    id: 'P-RELAY',
    kind: 'principal',
    title: 'Rétablir la liaison',
    brief: "La surface n'entend plus rien. Réparez le relais, refroidissez les baies et transmettez le journal.",
    steps: [
      { type: 'fixture', id: 'antenna.accueil', cond: 'on', label: 'Réparer et activer le relais radio (Accueil)' },
      { type: 'power', sector: 'serveurs', label: 'Alimenter le secteur des serveurs' },
      { type: 'fixture', id: 'coolant.serveurs', cond: 'on', label: 'Redémarrer le refroidissement des baies' },
      { type: 'download', id: 'terminal.serveurs', label: 'Transmettre le journal système' },
    ],
    xp: 460,
    consequence: 'ravitaillement',
    consequenceText: "La surface répond : un colis de soins est envoyé par le sas de l'accueil.",
    tags: ['relay', 'servers', 'data'],
  },
  {
    id: 'P-CRYO',
    kind: 'principal',
    title: 'Interrompre le Protocole',
    brief: "Les dortoirs instrumentés tournent encore. Coupez la cryogénie et enregistrez l'arrêt.",
    steps: [
      { type: 'reach', sector: 'experimental', label: 'Atteindre le secteur expérimental' },
      { type: 'fixture', id: 'cryo.experimental', cond: 'off', label: 'Désactiver la cryogénie' },
      { type: 'power', sector: 'experimental', label: 'Alimenter le secteur expérimental' },
      { type: 'fixture', id: 'probe.experimental', cond: 'value', value: 1, label: "Enregistrer l'arrêt au banc d'induction" },
      { type: 'download', id: 'terminal.experimental', label: "Transférer la transcription d'induction" },
    ],
    xp: 540,
    consequence: 'reveil',
    consequenceText: 'Les capsules se vident. Ce qui y veillait se met en marche.',
    tags: ['cryo', 'probe', 'experimental'],
  },

  /* ------------------------- SECONDAIRES ------------------------- */
  {
    id: 'S-CONTAM',
    kind: 'secondaire',
    title: 'Cartographier la contamination',
    brief: "Trois relevés à l'appareil de mesure dans des salles contaminées.",
    steps: [{ type: 'measure', sectors: ['bio', 'quarantaine'], count: 3, label: 'Relevés en laboratoire biologique ou en quarantaine' }],
    xp: 140,
    consequenceText: 'Aucune.',
    tags: ['measure'],
  },
  {
    id: 'S-THERM',
    kind: 'secondaire',
    title: 'Relevés thermiques profonds',
    brief: 'Mesurer la température dans les secteurs les plus froids.',
    steps: [{ type: 'measure', sectors: ['experimental', 'noyau', 'serveurs'], count: 3, label: 'Relevés en secteur expérimental, serveurs ou Noyau' }],
    xp: 160,
    consequenceText: 'Aucune.',
    tags: ['measure'],
  },
  {
    id: 'S-CAM-EXP',
    kind: 'secondaire',
    title: 'Surveiller les dortoirs',
    brief: 'Déposer une caméra portable dans le secteur expérimental.',
    steps: [{ type: 'camera', sector: 'experimental', label: 'Poser une caméra dans le secteur expérimental' }],
    xp: 150,
    consequenceText: 'La caméra reste consultable depuis tous les terminaux.',
    tags: ['camera'],
  },
  {
    id: 'S-CAM-CORE',
    kind: 'secondaire',
    title: 'Un œil sur le Noyau',
    brief: 'Déposer une caméra portable dans le Noyau.',
    steps: [{ type: 'camera', sector: 'noyau', label: 'Poser une caméra dans le Noyau' }],
    xp: 220,
    consequenceText: 'La caméra reste consultable depuis tous les terminaux.',
    tags: ['camera', 'core'],
  },
  {
    id: 'S-DOCS-5',
    kind: 'secondaire',
    title: 'Témoignages',
    brief: 'Rassembler cinq documents.',
    steps: [{ type: 'documents', count: 5, label: 'Rassembler cinq documents' }],
    xp: 120,
    consequenceText: 'Les documents rejoignent vos archives permanentes.',
    tags: ['documents'],
  },
  {
    id: 'S-DOCS-10',
    kind: 'secondaire',
    title: 'Dépouiller les archives',
    brief: 'Rassembler dix documents.',
    steps: [{ type: 'documents', count: 10, label: 'Rassembler dix documents' }],
    xp: 260,
    consequenceText: 'Les documents rejoignent vos archives permanentes.',
    tags: ['documents'],
  },
  {
    id: 'S-RELAY',
    kind: 'secondaire',
    title: 'Relais radio',
    brief: "Réparer puis activer le relais du poste de sécurité pour étendre la portée des radios.",
    steps: [{ type: 'fixture', id: 'antenna.accueil', cond: 'on', label: 'Réparer et activer le relais radio' }],
    xp: 150,
    consequenceText: 'Les radios portent dans tout le complexe (hors serveurs).',
    tags: ['relay'],
  },
  {
    id: 'S-AUX',
    kind: 'secondaire',
    title: 'Courant de proximité',
    brief: 'Démarrer le générateur secondaire de la Maintenance.',
    steps: [{ type: 'fixture', id: 'generator_aux.maintenance', cond: 'on', label: 'Démarrer le générateur secondaire' }],
    xp: 130,
    consequenceText: 'Les secteurs proches retrouvent lumière, terminaux et station médicale.',
    tags: ['aux'],
  },
  {
    id: 'S-ARCH-PWR',
    kind: 'secondaire',
    title: 'Éclairer les rayonnages',
    brief: 'Rétablir le circuit des Archives.',
    steps: [{ type: 'power', sector: 'archives', label: 'Alimenter les Archives' }],
    xp: 130,
    consequenceText: 'Le Phototrope est attiré par les secteurs rallumés.',
    tags: ['archives', 'fuses'],
  },
  {
    id: 'S-COOL',
    kind: 'secondaire',
    title: 'Avant la surchauffe',
    brief: 'Redémarrer le refroidissement des baies avant leur arrêt définitif.',
    start: { type: 'reach', sector: 'serveurs', label: '' },
    steps: [{ type: 'fixture', id: 'coolant.serveurs', cond: 'on', label: 'Redémarrer le refroidissement des baies' }],
    fail: { type: 'timer', seconds: 420 },
    xp: 200,
    penalty: 'menace+',
    consequenceText: "En cas d'échec, les baies lâchent et le Statique s'agite.",
    tags: ['servers', 'cool'],
  },
  {
    id: 'S-VALVES',
    kind: 'secondaire',
    title: 'Couper la vapeur',
    brief: 'Fermer toutes les vannes de vapeur du complexe.',
    steps: [{ type: 'valves', label: 'Fermer les trois vannes (Maintenance, Centrale)' }],
    xp: 180,
    consequenceText: 'Plus aucune fuite de vapeur ne peut survenir.',
    tags: ['valves'],
  },
  {
    id: 'S-ID-ECHO',
    kind: 'secondaire',
    title: "Observer l'Écho",
    brief: "Approcher l'Écho à moins de douze mètres et le garder en vue.",
    steps: [{ type: 'observe', kind: 'echo', label: "Observer l'Écho de près" }],
    xp: 220,
    consequenceText: 'Sa fiche complète rejoint vos archives.',
    tags: ['observe'],
  },
  {
    id: 'S-ID-VISITOR',
    kind: 'secondaire',
    title: 'Voir le Visiteur',
    brief: 'Garder le Visiteur en vue quelques instants.',
    steps: [{ type: 'observe', kind: 'visiteur', label: 'Observer le Visiteur' }],
    xp: 260,
    consequenceText: 'Sa fiche complète rejoint vos archives.',
    tags: ['observe'],
  },
  {
    id: 'S-ID-STATIC',
    kind: 'secondaire',
    title: "Mesurer l'anomalie",
    brief: "Approcher le Statique avec l'appareil de mesure allumé.",
    steps: [{ type: 'observe', kind: 'statique', label: "Relever l'anomalie électromagnétique" }],
    xp: 220,
    consequenceText: 'Sa fiche complète rejoint vos archives.',
    tags: ['observe'],
  },
  {
    id: 'S-FRESH',
    kind: 'secondaire',
    title: 'Culture fraîche',
    brief: "Prélever un échantillon au préleveur du laboratoire de culture.",
    steps: [{ type: 'fixture', id: 'sampler.bio', cond: 'value', value: 1, label: 'Prélever un échantillon frais' }],
    xp: 160,
    consequenceText: "Transporter un échantillon attire les Porteurs.",
    tags: ['samples'],
  },
  {
    id: 'S-SEAL',
    kind: 'secondaire',
    title: 'Confiner la quarantaine',
    brief: 'Fermer et verrouiller tous les sas de la zone de quarantaine.',
    start: { type: 'reach', sector: 'quarantaine', label: '' },
    steps: [{ type: 'seal', sector: 'quarantaine', label: 'Verrouiller tous les sas de la quarantaine' }],
    xp: 200,
    consequence: 'menace-',
    consequenceText: 'Les Porteurs restent enfermés.',
    tags: ['quarantine', 'purge'],
  },
  {
    id: 'S-STAFF',
    kind: 'secondaire',
    title: 'Registre du personnel',
    brief: "Transférer le registre depuis le terminal de l'Administration.",
    steps: [{ type: 'download', id: 'terminal.administration', label: 'Transférer le registre du personnel' }],
    xp: 150,
    consequenceText: 'Aucune.',
    tags: ['data-adm'],
  },
  {
    id: 'S-VAULT',
    kind: 'secondaire',
    title: 'La chambre forte',
    brief: 'Récupérer le dossier « Protocole » dans la chambre forte des Archives.',
    steps: [{ type: 'collect', item: 'dossier', data: 'protocole', count: 1, label: 'Récupérer le dossier « Protocole »' }],
    xp: 190,
    consequenceText: 'Aucune.',
    tags: ['dossier'],
  },
  {
    id: 'S-MARK',
    kind: 'secondaire',
    title: 'Baliser le retour',
    brief: 'Déposer cinq marqueurs lumineux pour jalonner le chemin.',
    steps: [{ type: 'markers', count: 5, label: 'Déposer cinq marqueurs lumineux' }],
    xp: 100,
    consequenceText: 'Les marqueurs attirent le Phototrope… loin de vous.',
    tags: ['markers'],
  },
  {
    id: 'S-PROBE',
    kind: 'secondaire',
    title: 'Une dernière induction',
    brief: "Lancer un enregistrement complet au banc d'induction.",
    start: { type: 'reach', sector: 'experimental', label: '' },
    steps: [{ type: 'fixture', id: 'probe.experimental', cond: 'value', value: 1, label: "Mener l'enregistrement à son terme" }],
    fail: { type: 'deaths', count: 2 },
    xp: 210,
    penalty: 'menace+',
    consequenceText: "L'enregistrement dure 45 secondes et s'entend de loin.",
    tags: ['probe'],
  },
];

export const OBJECTIVE_BY_ID: Record<string, ObjectiveDef> = Object.fromEntries(OBJECTIVES.map((o) => [o.id, o]));
