/** Catalogue des objets transportables. Chaque objet a un usage distinct. */
export type ItemCategory = 'equipement' | 'consommable' | 'cle' | 'mission';
export type ItemRarity = 'commun' | 'rare' | 'unique';
export type ItemUse =
  /** Allumé / éteint, consomme sa batterie. */
  | 'toggle'
  /** Usage maintenu (soin, injection). */
  | 'consume'
  /** Déposé dans le monde (caméra, marqueur). */
  | 'deploy'
  /** Utilisé par une interaction (fusible, carte, outils). */
  | 'passive';

export interface ItemDef {
  id: string;
  name: string;
  description: string;
  /** Poids en kilogrammes. */
  weight: number;
  /** Emplacements occupés dans l'inventaire. */
  size: 1 | 2;
  category: ItemCategory;
  rarity: ItemRarity;
  use: ItemUse;
  /** Charge maximale : batterie en %, nombre d'usages ou durabilité. */
  maxCharge: number;
  /** Type de charge, pour l'affichage. */
  chargeLabel: 'batterie' | 'usages' | 'durabilité' | '';
  /** Consommation en % par seconde lorsque l'appareil est allumé. */
  drain: number;
  /** Peut être rechargé avec des piles. */
  rechargeable: boolean;
  /** Disponible dans la sélection d'équipement du lobby (coût en points). */
  loadoutCost?: number;
}

const def = (d: Partial<ItemDef> & Pick<ItemDef, 'id' | 'name' | 'description' | 'weight'>): ItemDef => ({
  size: 1,
  category: 'equipement',
  rarity: 'commun',
  use: 'passive',
  maxCharge: 0,
  chargeLabel: '',
  drain: 0,
  rechargeable: false,
  ...d,
});

export const ITEMS: ItemDef[] = [
  def({
    id: 'lampe',
    name: 'Lampe torche',
    description: "Éclaire devant soi. Sa lumière se voit de loin : certaines entités s'en approchent.",
    weight: 0.4,
    use: 'toggle',
    maxCharge: 100,
    chargeLabel: 'batterie',
    drain: 100 / 480,
    rechargeable: true,
    loadoutCost: 0,
  }),
  def({
    id: 'radio',
    name: 'Radio',
    description: "Communication d'équipe à longue portée. Décroche près des serveurs et en cas de panne du relais.",
    weight: 0.5,
    use: 'toggle',
    maxCharge: 100,
    chargeLabel: 'batterie',
    drain: 100 / 1500,
    rechargeable: true,
    loadoutCost: 1,
  }),
  def({
    id: 'medkit',
    name: 'Trousse médicale',
    description: "Traite la blessure la plus grave et rend un peu de santé. Ne soigne pas l'infection.",
    weight: 0.8,
    category: 'consommable',
    use: 'consume',
    maxCharge: 3,
    chargeLabel: 'usages',
    loadoutCost: 2,
  }),
  def({
    id: 'piles',
    name: 'Piles',
    description: "Rechargent entièrement l'appareil tenu en main (touche de rechargement).",
    weight: 0.2,
    category: 'consommable',
    maxCharge: 3,
    chargeLabel: 'usages',
    loadoutCost: 1,
  }),
  def({
    id: 'fusible',
    name: 'Fusible',
    description: "Se place dans un tableau électrique pour rétablir le circuit d'un secteur.",
    weight: 0.3,
    category: 'cle',
  }),
  def({
    id: 'carte',
    name: "Carte d'accès",
    description: 'Ouvre les sas du niveau indiqué et des niveaux inférieurs.',
    weight: 0.05,
    category: 'cle',
    rarity: 'rare',
  }),
  def({
    id: 'detecteur_mouvement',
    name: 'Détecteur de mouvement',
    description: 'Signale ce qui bouge devant soi dans un rayon de vingt mètres. Ses bips sont audibles.',
    weight: 0.6,
    use: 'toggle',
    maxCharge: 100,
    chargeLabel: 'batterie',
    drain: 100 / 300,
    rechargeable: true,
    rarity: 'rare',
    loadoutCost: 2,
  }),
  def({
    id: 'detecteur_sonore',
    name: 'Détecteur sonore',
    description: "Mesure le bruit que l'on produit et analyse les sons proches : une imitation n'a pas de signature organique.",
    weight: 0.5,
    use: 'toggle',
    maxCharge: 100,
    chargeLabel: 'batterie',
    drain: 100 / 420,
    rechargeable: true,
    rarity: 'rare',
    loadoutCost: 2,
  }),
  def({
    id: 'camera',
    name: 'Caméra portable',
    description: 'Se pose au sol. Son image se consulte depuis les terminaux et depuis la carte.',
    weight: 0.9,
    use: 'deploy',
    rarity: 'rare',
    loadoutCost: 2,
  }),
  def({
    id: 'outils',
    name: 'Outils de réparation',
    description: 'Indispensables pour réparer une machine, forcer un mécanisme ou poser une barricade solide.',
    weight: 1.8,
    size: 2,
    maxCharge: 100,
    chargeLabel: 'durabilité',
    loadoutCost: 2,
  }),
  def({
    id: 'marqueurs',
    name: 'Marqueurs lumineux',
    description: 'Bâtons chimiques à déposer pour baliser un chemin. Leur lueur peut servir de leurre.',
    weight: 0.3,
    use: 'deploy',
    maxCharge: 6,
    chargeLabel: 'usages',
    loadoutCost: 1,
  }),
  def({
    id: 'mesureur',
    name: 'Appareil de mesure',
    description: 'Affiche température, contamination et anomalies électromagnétiques. Requis pour certains relevés.',
    weight: 0.5,
    use: 'toggle',
    maxCharge: 100,
    chargeLabel: 'batterie',
    drain: 100 / 600,
    rechargeable: true,
    loadoutCost: 1,
  }),
  def({
    id: 'serum',
    name: 'Sérum antifongique',
    description: "Élimine une infection par la Souche. Une dose, une personne.",
    weight: 0.1,
    category: 'consommable',
    use: 'consume',
    maxCharge: 1,
    chargeLabel: 'usages',
    rarity: 'rare',
  }),
  def({ id: 'echantillon', name: 'Échantillon de Souche', description: 'Culture scellée prélevée au laboratoire biologique.', weight: 0.4, category: 'mission', rarity: 'rare' }),
  def({ id: 'disque', name: 'Disque de données', description: 'Support extrait des baies du Protocole.', weight: 0.2, category: 'mission', rarity: 'rare' }),
  def({ id: 'bande', name: 'Bande acoustique', description: 'Enregistrement magnétique des « réponses » du Noyau.', weight: 0.2, category: 'mission', rarity: 'rare' }),
  def({ id: 'cellule', name: "Cellule d'énergie", description: 'Accumulateur industriel. Lourd et encombrant.', weight: 2.6, size: 2, category: 'mission', rarity: 'rare' }),
  def({ id: 'dossier', name: 'Dossier confidentiel', description: 'Chemise cartonnée frappée du sceau du Protocole.', weight: 0.3, category: 'mission', rarity: 'unique' }),
];

export const ITEM_BY_ID: Record<string, ItemDef> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

export function itemDef(id: string): ItemDef {
  const d = ITEM_BY_ID[id];
  if (!d) throw new Error(`Objet inconnu : ${id}`);
  return d;
}

/** Nom affiché tenant compte de la donnée portée par l'objet (niveau de carte…). */
export function itemLabel(id: string, data?: string): string {
  const d = itemDef(id);
  if (id === 'carte' && data) return `${d.name} niv. ${data}`;
  if (id === 'dossier' && data) return data === 'protocole' ? 'Dossier « Protocole »' : data === 'sujets' ? 'Dossier « Sujets »' : 'Dossier expérimental';
  return d.name;
}

/** Budget de points pour la sélection d'équipement du lobby. */
export const LOADOUT_POINTS = 5;
