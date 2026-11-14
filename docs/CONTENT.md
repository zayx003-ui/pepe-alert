# Contenu : secteurs, objectifs, équipement, sons

> Fichier généré par `npm run docs`. Ne pas modifier à la main.

## Les douze secteurs

| Secteur | Palier | Sas | Rôle | Risque particulier |
| --- | --- | --- | --- | --- |
| Accueil | 0 | libre | Sas d'entrée, poste de sécurité et point d'extraction. | Le sas ne se rouvre qu'une fois le cycle d'extraction lancé : attendre ici attire ce qui rôde. |
| Administration | 0 | libre | Bureaux de direction, badges et registres du personnel. | La moquette étouffe les pas… ceux de tout le monde. |
| Secteur médical | 1 | carte niv. 1 | Infirmerie, bloc opératoire et suivi des sujets du protocole. | Les moniteurs encore branchés bipent à intervalles irréguliers et couvrent les bruits proches. |
| Maintenance | 1 | carte niv. 1 | Ateliers, générateur secondaire et accès aux conduits techniques. | Réseau de conduits dense : le Rampant y circule librement. |
| Archives | 1 | carte niv. 1 | Dossiers papier du Protocole et salle de lecture. | Rayonnages serrés : lignes de vue très courtes et silence presque total. |
| Laboratoire acoustique | 2 | carte niv. 2 | Chambres anéchoïques où l'on enregistrait les « réponses » du Noyau. | Territoire de l'Écho. Le moindre bruit porte deux fois plus loin. |
| Laboratoire biologique | 2 | carte niv. 2 | Culture de la Souche et analyses des tissus prélevés. | Air contaminé : sans décontamination, une infection progresse lentement. |
| Serveurs | 2 | carte niv. 2 | Baies de calcul qui modélisaient le Protocole. Tout n'est pas éteint. | Interférences : la radio décroche et le Statique vide les batteries. |
| Centrale électrique | 2 | carte niv. 2 | Générateur principal, transformateurs et distribution. | Vapeur sous pression et arcs électriques : brûlures. Le vacarme masque les approches. |
| Zone de quarantaine | 3 | carte niv. 3 | Cellules de confinement des sujets infectés par la Souche. | Contamination élevée, Porteurs errants. Chaque porte laissée ouverte étend la Souche. |
| Secteur expérimental | 3 | carte niv. 3 | Dortoirs instrumentés du Protocole : là où les sujets « partaient ». | Froid intense et hallucinations plus fréquentes : le stress monte sans raison apparente. |
| Noyau NOCTURNE | 4 | carte niv. 3 | Chambre du Noyau, quatre mètres sous le reste du complexe. | Le Visiteur y revient toujours. Température proche de zéro. |

## Objectifs (30)

### Principaux

#### P-MED — Restaurer le secteur médical (420 XP)

Le dossier expérimental n'existe plus que dans le terminal médical. Rétablissez le courant du secteur et extrayez-le.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Trouver trois fusibles
  2. Démarrer le générateur secondaire (Maintenance)
  3. Rétablir le courant du secteur médical
  4. Redémarrer le terminal médical
  5. Récupérer le dossier expérimental
- **Réussite :** toutes les étapes accomplies, puis extraction d'au moins un joueur.
- **Échec :** toute l'équipe meurt ou personne ne s'extrait.
- **Conséquence :** Le générateur secondaire attire ce qui dort. Le Visiteur se réveille dès la fin du transfert.

#### P-PWR — Rallumer la centrale (460 XP)

Sans le générateur principal, laboratoires et ascenseur restent morts. Remettez la centrale en service.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Atteindre la centrale électrique
  2. Compléter le tableau de la centrale
  3. Démarrer le générateur principal
  4. Alimenter le secteur des serveurs
  5. Alimenter le laboratoire biologique
- **Réussite :** toutes les étapes accomplies, puis extraction d'au moins un joueur.
- **Échec :** toute l'équipe meurt ou personne ne s'extrait.
- **Conséquence :** La lumière revient partout : le Visiteur perçoit mieux et patiente moins.

#### P-CORE — Désaccorder le Noyau (620 XP)

Tant que le Noyau résonne, le seuil reste ouvert. Descendez et refermez-le.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Récupérer deux cellules d'énergie
  2. Démarrer le générateur principal
  3. Descendre au Noyau
  4. Insérer les cellules dans la console
  5. Lancer le désaccord
  6. Tenir deux minutes pendant le désaccord
- **Réussite :** toutes les étapes accomplies, puis extraction d'au moins un joueur.
- **Échec :** toute l'équipe meurt ou personne ne s'extrait.
- **Conséquence :** Le Visiteur ne peut plus repartir. Il le sait.

#### P-DATA — Extraire les données du Protocole (480 XP)

Le consortium veut les modèles de la Nuit commune. Récupérez les disques et les journaux des serveurs.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Récupérer trois disques de données
  2. Alimenter le secteur des serveurs
  3. Transférer le journal système (Serveurs)
  4. Alimenter les archives
  5. Transférer l'index des archives
- **Réussite :** toutes les étapes accomplies, puis extraction d'au moins un joueur.
- **Échec :** toute l'équipe meurt ou personne ne s'extrait.
- **Conséquence :** Chaque transfert réveille un peu plus les baies : le Statique gagne en vigueur.

#### P-PURGE — Purger la quarantaine (520 XP)

La Souche déborde des cellules. Lancez la purge thermique avant qu'elle n'atteigne les secteurs sains.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Démarrer le générateur principal
  2. Alimenter la zone de quarantaine
  3. Lancer la purge depuis la salle d'observation
  4. Attendre la fin de la purge — hors de la zone
- **Réussite :** toutes les étapes accomplies, puis extraction d'au moins un joueur.
- **Échec :** toute l'équipe meurt ou personne ne s'extrait.
- **Conséquence :** Les Porteurs sont détruits et la contamination de la quarantaine disparaît.

#### P-SAMPLE — Détruire la Souche (500 XP)

Aucune culture ne doit quitter le complexe. Rassemblez les échantillons et brûlez-les.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Rassembler trois échantillons (Laboratoire biologique)
  2. Alimenter la quarantaine (incinérateur)
  3. Incinérer les trois échantillons
- **Réussite :** toutes les étapes accomplies, puis extraction d'au moins un joueur.
- **Échec :** toute l'équipe meurt ou personne ne s'extrait.
- **Conséquence :** Privés de la Souche, les Porteurs ralentissent.

#### P-ACOUSTIC — Reconstituer la réponse (520 XP)

Le Noyau répondait à une fréquence précise. Retrouvez les bandes, réglez l'émetteur et enregistrez ce qui revient.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Retrouver trois bandes acoustiques
  2. Alimenter le laboratoire acoustique
  3. Régler l'émetteur sur la fréquence B
  4. Activer l'émetteur
  5. Enregistrer la réponse au banc d'induction
- **Réussite :** toutes les étapes accomplies, puis extraction d'au moins un joueur.
- **Échec :** toute l'équipe meurt ou personne ne s'extrait.
- **Conséquence :** L'émetteur s'entend dans tout le complexe. Quelque chose répond.

#### P-DOSSIER — Récupérer les dossiers scellés (440 XP)

Deux dossiers papier prouvent ce qui est arrivé aux neuf sujets. Rapportez-les, avec tout document utile.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Dossier « Protocole » (chambre forte des Archives)
  2. Dossier « Sujets » (Secteur expérimental)
  3. Rassembler six documents
- **Réussite :** toutes les étapes accomplies, puis extraction d'au moins un joueur.
- **Échec :** toute l'équipe meurt ou personne ne s'extrait.
- **Conséquence :** Les plans joints aux dossiers révèlent l'ensemble du complexe sur la carte.

#### P-RELAY — Rétablir la liaison (460 XP)

La surface n'entend plus rien. Réparez le relais, refroidissez les baies et transmettez le journal.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Réparer et activer le relais radio (Accueil)
  2. Alimenter le secteur des serveurs
  3. Redémarrer le refroidissement des baies
  4. Transmettre le journal système
- **Réussite :** toutes les étapes accomplies, puis extraction d'au moins un joueur.
- **Échec :** toute l'équipe meurt ou personne ne s'extrait.
- **Conséquence :** La surface répond : un colis de soins est envoyé par le sas de l'accueil.

#### P-CRYO — Interrompre le Protocole (540 XP)

Les dortoirs instrumentés tournent encore. Coupez la cryogénie et enregistrez l'arrêt.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Atteindre le secteur expérimental
  2. Désactiver la cryogénie
  3. Alimenter le secteur expérimental
  4. Enregistrer l'arrêt au banc d'induction
  5. Transférer la transcription d'induction
- **Réussite :** toutes les étapes accomplies, puis extraction d'au moins un joueur.
- **Échec :** toute l'équipe meurt ou personne ne s'extrait.
- **Conséquence :** Les capsules se vident. Ce qui y veillait se met en marche.

### Secondaires

#### S-CONTAM — Cartographier la contamination (140 XP)

Trois relevés à l'appareil de mesure dans des salles contaminées.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Relevés en laboratoire biologique ou en quarantaine
- **Réussite :** toutes les étapes accomplies.
- **Échec :** aucune (reste ouvert).
- **Conséquence :** Aucune.

#### S-THERM — Relevés thermiques profonds (160 XP)

Mesurer la température dans les secteurs les plus froids.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Relevés en secteur expérimental, serveurs ou Noyau
- **Réussite :** toutes les étapes accomplies.
- **Échec :** aucune (reste ouvert).
- **Conséquence :** Aucune.

#### S-CAM-EXP — Surveiller les dortoirs (150 XP)

Déposer une caméra portable dans le secteur expérimental.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Poser une caméra dans le secteur expérimental
- **Réussite :** toutes les étapes accomplies.
- **Échec :** aucune (reste ouvert).
- **Conséquence :** La caméra reste consultable depuis tous les terminaux.

#### S-CAM-CORE — Un œil sur le Noyau (220 XP)

Déposer une caméra portable dans le Noyau.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Poser une caméra dans le Noyau
- **Réussite :** toutes les étapes accomplies.
- **Échec :** aucune (reste ouvert).
- **Conséquence :** La caméra reste consultable depuis tous les terminaux.

#### S-DOCS-5 — Témoignages (120 XP)

Rassembler cinq documents.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Rassembler cinq documents
- **Réussite :** toutes les étapes accomplies.
- **Échec :** aucune (reste ouvert).
- **Conséquence :** Les documents rejoignent vos archives permanentes.

#### S-DOCS-10 — Dépouiller les archives (260 XP)

Rassembler dix documents.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Rassembler dix documents
- **Réussite :** toutes les étapes accomplies.
- **Échec :** aucune (reste ouvert).
- **Conséquence :** Les documents rejoignent vos archives permanentes.

#### S-RELAY — Relais radio (150 XP)

Réparer puis activer le relais du poste de sécurité pour étendre la portée des radios.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Réparer et activer le relais radio
- **Réussite :** toutes les étapes accomplies.
- **Échec :** aucune (reste ouvert).
- **Conséquence :** Les radios portent dans tout le complexe (hors serveurs).

#### S-AUX — Courant de proximité (130 XP)

Démarrer le générateur secondaire de la Maintenance.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Démarrer le générateur secondaire
- **Réussite :** toutes les étapes accomplies.
- **Échec :** aucune (reste ouvert).
- **Conséquence :** Les secteurs proches retrouvent lumière, terminaux et station médicale.

#### S-ARCH-PWR — Éclairer les rayonnages (130 XP)

Rétablir le circuit des Archives.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Alimenter les Archives
- **Réussite :** toutes les étapes accomplies.
- **Échec :** aucune (reste ouvert).
- **Conséquence :** Le Phototrope est attiré par les secteurs rallumés.

#### S-COOL — Avant la surchauffe (200 XP)

Redémarrer le refroidissement des baies avant leur arrêt définitif.

- **Condition de départ :** atteindre le secteur serveurs
- **Étapes :**
  1. Redémarrer le refroidissement des baies
- **Réussite :** toutes les étapes accomplies.
- **Échec :** non accompli en 7 minutes.
- **Conséquence :** En cas d'échec, les baies lâchent et le Statique s'agite.

#### S-VALVES — Couper la vapeur (180 XP)

Fermer toutes les vannes de vapeur du complexe.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Fermer les trois vannes (Maintenance, Centrale)
- **Réussite :** toutes les étapes accomplies.
- **Échec :** aucune (reste ouvert).
- **Conséquence :** Plus aucune fuite de vapeur ne peut survenir.

#### S-ID-ECHO — Observer l'Écho (220 XP)

Approcher l'Écho à moins de douze mètres et le garder en vue.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Observer l'Écho de près
- **Réussite :** toutes les étapes accomplies.
- **Échec :** aucune (reste ouvert).
- **Conséquence :** Sa fiche complète rejoint vos archives.

#### S-ID-VISITOR — Voir le Visiteur (260 XP)

Garder le Visiteur en vue quelques instants.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Observer le Visiteur
- **Réussite :** toutes les étapes accomplies.
- **Échec :** aucune (reste ouvert).
- **Conséquence :** Sa fiche complète rejoint vos archives.

#### S-ID-STATIC — Mesurer l'anomalie (220 XP)

Approcher le Statique avec l'appareil de mesure allumé.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Relever l'anomalie électromagnétique
- **Réussite :** toutes les étapes accomplies.
- **Échec :** aucune (reste ouvert).
- **Conséquence :** Sa fiche complète rejoint vos archives.

#### S-FRESH — Culture fraîche (160 XP)

Prélever un échantillon au préleveur du laboratoire de culture.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Prélever un échantillon frais
- **Réussite :** toutes les étapes accomplies.
- **Échec :** aucune (reste ouvert).
- **Conséquence :** Transporter un échantillon attire les Porteurs.

#### S-SEAL — Confiner la quarantaine (200 XP)

Fermer et verrouiller tous les sas de la zone de quarantaine.

- **Condition de départ :** atteindre le secteur quarantaine
- **Étapes :**
  1. Verrouiller tous les sas de la quarantaine
- **Réussite :** toutes les étapes accomplies.
- **Échec :** aucune (reste ouvert).
- **Conséquence :** Les Porteurs restent enfermés.

#### S-STAFF — Registre du personnel (150 XP)

Transférer le registre depuis le terminal de l'Administration.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Transférer le registre du personnel
- **Réussite :** toutes les étapes accomplies.
- **Échec :** aucune (reste ouvert).
- **Conséquence :** Aucune.

#### S-VAULT — La chambre forte (190 XP)

Récupérer le dossier « Protocole » dans la chambre forte des Archives.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Récupérer le dossier « Protocole »
- **Réussite :** toutes les étapes accomplies.
- **Échec :** aucune (reste ouvert).
- **Conséquence :** Aucune.

#### S-MARK — Baliser le retour (100 XP)

Déposer cinq marqueurs lumineux pour jalonner le chemin.

- **Condition de départ :** dès le début de l'expédition
- **Étapes :**
  1. Déposer cinq marqueurs lumineux
- **Réussite :** toutes les étapes accomplies.
- **Échec :** aucune (reste ouvert).
- **Conséquence :** Les marqueurs attirent le Phototrope… loin de vous.

#### S-PROBE — Une dernière induction (210 XP)

Lancer un enregistrement complet au banc d'induction.

- **Condition de départ :** atteindre le secteur experimental
- **Étapes :**
  1. Mener l'enregistrement à son terme
- **Réussite :** toutes les étapes accomplies.
- **Échec :** 2 morts dans l'équipe.
- **Conséquence :** L'enregistrement dure 45 secondes et s'entend de loin.

## Équipement

| Objet | Poids | Empl. | Catégorie | Usage |
| --- | --- | --- | --- | --- |
| Lampe torche | 0.4 kg | 1 | equipement | Éclaire devant soi. Sa lumière se voit de loin : certaines entités s'en approchent. |
| Radio | 0.5 kg | 1 | equipement | Communication d'équipe à longue portée. Décroche près des serveurs et en cas de panne du relais. |
| Trousse médicale | 0.8 kg | 1 | consommable | Traite la blessure la plus grave et rend un peu de santé. Ne soigne pas l'infection. |
| Piles | 0.2 kg | 1 | consommable | Rechargent entièrement l'appareil tenu en main (touche de rechargement). |
| Fusible | 0.3 kg | 1 | cle | Se place dans un tableau électrique pour rétablir le circuit d'un secteur. |
| Carte d'accès | 0.05 kg | 1 | cle | Ouvre les sas du niveau indiqué et des niveaux inférieurs. |
| Détecteur de mouvement | 0.6 kg | 1 | equipement | Signale ce qui bouge devant soi dans un rayon de vingt mètres. Ses bips sont audibles. |
| Détecteur sonore | 0.5 kg | 1 | equipement | Mesure le bruit que l'on produit et analyse les sons proches : une imitation n'a pas de signature organique. |
| Caméra portable | 0.9 kg | 1 | equipement | Se pose au sol. Son image se consulte depuis les terminaux et depuis la carte. |
| Outils de réparation | 1.8 kg | 2 | equipement | Indispensables pour réparer une machine, forcer un mécanisme ou poser une barricade solide. |
| Marqueurs lumineux | 0.3 kg | 1 | equipement | Bâtons chimiques à déposer pour baliser un chemin. Leur lueur peut servir de leurre. |
| Appareil de mesure | 0.5 kg | 1 | equipement | Affiche température, contamination et anomalies électromagnétiques. Requis pour certains relevés. |
| Sérum antifongique | 0.1 kg | 1 | consommable | Élimine une infection par la Souche. Une dose, une personne. |
| Échantillon de Souche | 0.4 kg | 1 | mission | Culture scellée prélevée au laboratoire biologique. |
| Disque de données | 0.2 kg | 1 | mission | Support extrait des baies du Protocole. |
| Bande acoustique | 0.2 kg | 1 | mission | Enregistrement magnétique des « réponses » du Noyau. |
| Cellule d'énergie | 2.6 kg | 2 | mission | Accumulateur industriel. Lourd et encombrant. |
| Dossier confidentiel | 0.3 kg | 1 | mission | Chemise cartonnée frappée du sceau du Protocole. |

## Bibliothèque sonore (66 sons synthétisés)

- **ambiance** (4) : amb_grave, amb_air, amb_froid, amb_serveurs
- **environnement** (10) : evt_coupure, evt_fuite, evt_generateur, evt_porte, evt_surchauffe, generateur, vapeur, neon, goutte, metal_lointain
- **musique** (4) : tension, poursuite, stinger, reussite
- **entites** (14) : clic, raclement, cri_rampant, decharge, attaque_visiteur, attaque_echo, attaque_phototrope, attaque_rampant, attaque_porteur, attaque_statique, fake_pas, fake_voix, fake_porte, murmure
- **joueur** (10) : pas_beton, pas_metal, pas_carrelage, pas_grille, pas_moquette, toux, souffle, respiration, coeur, acouphene
- **interactions** (20) : porte_ouvre, porte_ferme, sas_ouvre, sas_ferme, grille, coup_porte, porte, machine, refus, ramasser, poser, impact, recharge, clic_lampe, soin, marqueur, bip, bip_radar, ui_clic, ui_ouvre
- **communications** (4) : evt_annonce, evt_relais, radio_bip, parasites
