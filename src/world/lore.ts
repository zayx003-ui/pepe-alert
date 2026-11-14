import type { SectorId } from './types';

export interface LoreDocument {
  id: string;
  title: string;
  sector: SectorId;
  /** Auteur ou origine affichée en en-tête. */
  source: string;
  body: string;
}

/**
 * Documents récupérables dans le complexe. Ils racontent, par fragments, ce qui
 * est arrivé au Protocole NOCTURNE. Les identifiants sont persistés dans le profil.
 */
export const DOCUMENTS: LoreDocument[] = [
  {
    id: 'acc-01',
    title: 'Consigne de garde n° 14',
    sector: 'accueil',
    source: 'Poste de sécurité',
    body: "Le sas extérieur ne s'ouvre plus que par cycle complet : quatre-vingt-dix secondes, moteurs audibles dans tout le niveau. Ne lancez pas le cycle tant que l'équipe n'est pas regroupée. Ce qui vous suit entend le sas aussi bien que vous.",
  },
  {
    id: 'acc-02',
    title: 'Registre des visiteurs',
    sector: 'accueil',
    source: 'Hall',
    body: "Dernière page. Onze entrées le 3, onze sorties. Douze entrées le 4, onze sorties. La douzième signature n'est pas une signature : c'est le mot « bonsoir » recopié sur toute la largeur de la ligne.",
  },
  {
    id: 'adm-01',
    title: 'Note de la direction',
    sector: 'administration',
    source: 'Dr H. Vasseur, directrice',
    body: "Le consortium exige des résultats avant la fin du trimestre. J'ai autorisé l'induction simultanée des neuf sujets. Si la « Nuit commune » existe, nous y entrerons à neuf. Qu'on cesse de me parler des lits vides : un sujet qui quitte le dortoir est un problème de sécurité, pas de métaphysique.",
  },
  {
    id: 'adm-02',
    title: 'Attribution des badges',
    sector: 'administration',
    source: 'Service du personnel',
    body: "Niveau 1 : médical, maintenance, archives. Niveau 2 : laboratoires, serveurs, centrale. Niveau 3 : quarantaine, secteur expérimental, escalier du Noyau. Les badges des disparus restent actifs : nous n'avons pas de procédure pour quelqu'un qui n'est ni parti ni présent.",
  },
  {
    id: 'med-01',
    title: 'Compte rendu — sujet 6',
    sector: 'medical',
    source: 'Bloc opératoire',
    body: "Réveil à 04 h 12, désorienté. Affirme avoir « croisé quelqu'un dans le couloir du rêve » qui lui a demandé son prénom. Au réveil, il ne le connaissait plus. Examen neurologique normal. Il répète que la chose le lui rendra « quand elle aura fini de l'essayer ».",
  },
  {
    id: 'med-02',
    title: 'Inventaire de la pharmacie',
    sector: 'medical',
    source: 'Infirmerie',
    body: "Sérum antifongique : stock critique. Toute exposition à la Souche doit être traitée dans l'heure. Rappel : les trousses soignent les plaies, pas l'infection. Les fractures se stabilisent, elles ne se réparent pas ici.",
  },
  {
    id: 'mnt-01',
    title: "Carnet d'entretien",
    sector: 'maintenance',
    source: 'Atelier',
    body: "Le générateur secondaire tient les secteurs proches, pas plus. Pour l'ascenseur du Noyau et les laboratoires il faut le principal, à la centrale. J'ai encore trouvé une grille de conduit dévissée de l'intérieur. Personne ici ne passe par les conduits. Personne de chez nous.",
  },
  {
    id: 'mnt-02',
    title: 'Mot scotché sur un casier',
    sector: 'maintenance',
    source: 'Anonyme',
    body: "Si tu l'entends racler dans le plafond, ne cours pas vers une grille. Reste au milieu de la pièce, loin des murs. Il ne tient pas longtemps à découvert.",
  },
  {
    id: 'arc-01',
    title: 'Protocole NOCTURNE — résumé',
    sector: 'archives',
    source: 'Dossier 0',
    body: "Hypothèse : le sommeil profond synchronisé ouvre un espace partagé, la « Nuit commune ». Objectif : y maintenir neuf sujets et en rapporter une mesure. Résultat de la phase 2 : quelque chose, dans cet espace, a répondu aux signaux acoustiques. Résultat de la phase 3 : cela a suivi les sujets au réveil.",
  },
  {
    id: 'arc-02',
    title: 'Fiche de disparition',
    sector: 'archives',
    source: 'Dossier 31',
    body: "Sujet 2. Lit n° 2 retrouvé vide à 03 h 40, sangles fermées, capteurs en place et encore tièdes. Les enregistrements montrent le sujet endormi jusqu'à la dernière image. Sur l'image suivante il n'y a plus que le creux du matelas.",
  },
  {
    id: 'aco-01',
    title: 'Journal de la régie',
    sector: 'acoustique',
    source: 'Ingénieure du son',
    body: "Bande 44. Nous émettons un clic, la chambre renvoie le clic. Normal. Bande 45 : nous n'émettons rien et la chambre renvoie quand même. Bande 46 : elle renvoie ma voix disant une phrase que je n'ai pas encore prononcée. Je la dirai le lendemain, mot pour mot.",
  },
  {
    id: 'aco-02',
    title: "Avertissement — l'Écho",
    sector: 'acoustique',
    source: 'Affichette manuscrite',
    body: "Il ne voit pas. Il ne voit RIEN. Marchez accroupis, ne courez jamais, lancez quelque chose loin de vous si vous devez traverser. Et si vous l'entendez cliqueter, taisez-vous : il compte les réponses.",
  },
  {
    id: 'bio-01',
    title: 'Culture S-9',
    sector: 'bio',
    source: 'Laboratoire de culture',
    body: "La Souche provient des draps du sujet 4, prélevés après sa disparition. Elle pousse dans le noir complet, dix fois plus vite près d'un dormeur. Elle ne digère pas : elle « garde ». Les tissus qu'elle recouvre restent vivants, et en mouvement.",
  },
  {
    id: 'bio-02',
    title: 'Procédure de décontamination',
    sector: 'bio',
    source: 'Sas',
    body: "Toux, vision trouble, froid dans les doigts : vous êtes porteur. Un sérum par personne. À défaut, quittez la zone contaminée : l'infection ralentit à l'air sain mais ne recule jamais seule.",
  },
  {
    id: 'srv-01',
    title: 'Rapport de surcharge',
    sector: 'serveurs',
    source: 'Salle de contrôle',
    body: "La baie 7 tourne sans alimentation depuis mardi. Les radios grésillent à son approche, les lampes se vident en quelques minutes. Ce n'est pas une panne, c'est une présence qui se nourrit du courant. Éteignez tout et elle se désintéresse de vous.",
  },
  {
    id: 'srv-02',
    title: 'Sortie console',
    sector: 'serveurs',
    source: 'Journal système',
    body: "MODÈLE NUIT_COMMUNE : 9 occupants attendus / 10 détectés. Occupant 10 : aucune signature de sommeil. Occupant 10 : requête d'accès aux profils vocaux du personnel. Requête accordée (aucun opérateur présent).",
  },
  {
    id: 'cen-01',
    title: 'Séquence de démarrage',
    sector: 'centrale',
    source: 'Salle de commande',
    body: "Générateur principal : fusibles en place dans le tableau du secteur, puis démarrage au pupitre. Comptez une minute de montée en régime, dans un vacarme qui s'entend jusqu'aux archives. Si une vanne lâche, la vapeur brûle : fermez-la avant d'approcher.",
  },
  {
    id: 'cen-02',
    title: 'Dernière ronde',
    sector: 'centrale',
    source: 'Technicien de quart',
    body: "J'ai coupé le principal moi-même. Dans le noir il est plus lent, il hésite, il écoute. Avec la lumière il nous trouvait toujours. Si vous rallumez, faites-le en sachant ce que vous réveillez.",
  },
  {
    id: 'qua-01',
    title: 'Registre des cellules',
    sector: 'quarantaine',
    source: 'Salle d’observation',
    body: "Cellule 3 : le sujet ne dort plus, ne mange plus, marche. Il suit quiconque passe devant la vitre, sans hâte. Il n'ouvre pas les portes — il ne sait plus. Une porte fermée suffit. N'oubliez jamais de fermer.",
  },
  {
    id: 'qua-02',
    title: 'Ordre de purge',
    sector: 'quarantaine',
    source: 'Direction',
    body: "En cas de propagation hors des cellules : purge thermique depuis la console d'observation. La purge dure deux minutes et exige le courant principal. Aucun membre du personnel ne doit se trouver dans la zone. Aucun membre du personnel ne s'y trouvera de son plein gré.",
  },
  {
    id: 'exp-01',
    title: "Transcription d'induction",
    sector: 'experimental',
    source: 'Salle d’induction',
    body: "« Sujet 9, que voyez-vous ? — Le couloir. Le même que le vôtre, mais plus long. — Y a-t-il quelqu'un ? — Il y a celui qui vient en visite. Il se tient là où on ne regarde pas. Il dit qu'il aimerait venir chez vous, maintenant qu'il connaît le chemin. »",
  },
  {
    id: 'exp-02',
    title: 'Note au chevet du lit 9',
    sector: 'experimental',
    source: 'Manuscrit',
    body: "Il prend nos voix parce qu'il n'en a pas. Si l'un de nous vous appelle depuis une pièce sombre et ne vient pas quand vous répondez, ce n'est pas l'un de nous. Les vrais viennent. Lui attend.",
  },
  {
    id: 'noy-01',
    title: 'Schéma du Noyau',
    sector: 'noyau',
    source: 'Antichambre',
    body: "Le Noyau n'est pas une machine, c'est une pièce accordée : elle résonne à la fréquence de la Nuit commune et la maintient ouverte. Tant qu'elle vibre, le seuil reste franchissable dans les deux sens. La console permet de la désaccorder. Personne n'est revenu dire ce que cela coûte.",
  },
  {
    id: 'noy-02',
    title: 'Dernier message de la directrice',
    sector: 'noyau',
    source: 'Dr H. Vasseur',
    body: "Ils ne sont pas morts. Les neuf sont de l'autre côté et lui est du nôtre : un échange, rien de plus. J'ai cru pouvoir refermer la porte en gardant ce que nous avions appris. On ne garde rien. Si vous lisez ceci, éteignez le Noyau et partez sans répondre à personne.",
  },
];

export const DOCUMENT_BY_ID: Record<string, LoreDocument> = Object.fromEntries(DOCUMENTS.map((d) => [d.id, d]));
