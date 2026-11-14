# NOCTURNE — Le Protocole des Disparus

Survival horror psychologique coopératif (1 à 6 joueurs), à la première personne, jouable dans un navigateur de bureau.

Une équipe de récupération descend dans un complexe de recherche abandonné : douze secteurs générés procéduralement, un objectif principal tiré au sort, des machines qui tombent en panne sans attendre personne, et six entités qui ne se combattent pas — on les comprend, on les évite, on leur ferme la porte.

> **État du projet :** version 0.1. Le jeu est jouable de bout en bout en solo et en multijoueur. Ce qui est terminé, ce qui ne l'est pas et ce qui n'a pas pu être vérifié est tenu à jour dans [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md). À lire avant de reprendre le développement.

## Démarrer

```bash
git clone https://github.com/zayx003-ui/pepe-alert.git
cd pepe-alert
npm install
npm run dev          # http://localhost:5173
```

Sans autre configuration, le jeu démarre en **mode local** :

- solo complet ;
- multijoueur entre plusieurs onglets **du même navigateur** (pratique pour essayer : ouvrez deux onglets, créez un salon dans l'un, rejoignez-le par son code dans l'autre — ajoutez `?nom=Alice` à l'URL pour distinguer les joueurs) ;
- profil et progression conservés dans le navigateur.

Pour jouer **en ligne** (comptes, salons publics, progression sur serveur), reliez le jeu à un projet Supabase :

```bash
cp .env.example .env     # puis renseigner VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY
```

et appliquez la migration `supabase/migrations/0001_nocturne.sql`. Le pas-à-pas complet (Supabase, GitHub Pages, GitHub Actions) est dans [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Commandes

Les touches sont repérées par leur **position physique** : la disposition par défaut correspond à ZQSD sur un clavier AZERTY (WASD sur un QWERTY). Tout est reconfigurable dans *Paramètres*.

| Action | Touche | | Action | Touche |
| --- | --- | --- | --- | --- |
| Se déplacer | Z Q S D | | Inventaire | Tab |
| Regarder | Souris | | Carte | M |
| Courir | Maj | | Documents | J |
| S'accroupir | Ctrl (ou C) | | Discussion écrite | Entrée |
| Sauter | Espace | | Voix de proximité | V (maintenir) |
| Interagir | E | | Radio | G |
| Lampe torche | F | | Lâcher l'objet | X |
| Recharger (piles) | R | | Retenir sa respiration | A |
| Utiliser l'objet en main | Clic gauche | | Lancer l'objet | Clic droit |
| Changer d'action / d'objet | Molette, 1 à 8 | | Menu | Échap |

> Sur un clavier AZERTY, **Ctrl + Z** correspond au raccourci « fermer l'onglet » de certains navigateurs. Le jeu demande confirmation avant de quitter une partie, propose **C** comme seconde touche d'accroupissement, et verrouille le clavier en plein écran (*Paramètres → Plein écran*).

## Ce que contient le jeu

- **Génération procédurale** par graphe : 12 secteurs, salles, couloirs, sas à carte, raccourcis verrouillés de l'intérieur, conduits, passages secrets, escalier et ascenseur vers le Noyau. Une graine reproduit exactement la même carte. Chaque carte est validée (tout est atteignable dans l'ordre de progression) avant d'être acceptée.
- **Simulation du joueur** : santé, endurance, respiration, stress, température, bruit, infection, cinq types de blessures aux effets distincts. Le stress altère l'image et le son, jamais les commandes.
- **Interactions** : portes (ouvrir, entrebâiller, verrouiller, barricader, forcer), 18 types de machines, terminaux (portes, caméras, transferts), casiers pour se cacher.
- **18 objets** aux usages distincts, inventaire limité en emplacements et en poids.
- **Six entités** autonomes — vue, ouïe, mémoire, machine à états : voir [docs/ENTITIES.md](docs/ENTITIES.md).
- **30 objectifs** (10 principaux, 20 secondaires), événements dynamiques, extraction : voir [docs/CONTENT.md](docs/CONTENT.md).
- **Multijoueur** jusqu'à 6 : salons, états des joueurs, reprise d'hôte, reconnexion, resynchronisation — voir [docs/NETWORK.md](docs/NETWORK.md).
- **Communication** : discussion écrite de proximité et radio, voix WebRTC de proximité (spatialisée) et radio.
- **Audio entièrement synthétisé** (aucun fichier son), **textures PBR procédurales** (aucune image) : le dépôt ne contient aucun asset binaire.
- **Progression** : niveaux, titres et tenues cosmétiques, succès, archives.

## Vérifier

```bash
npm run typecheck     # TypeScript strict
npm test              # 116 tests unitaires (Vitest) dont multi-clients en mémoire et endurance
npm run test:sql      # migrations, RLS et barème sur un PostgreSQL local jetable
npm run build         # build de production dans dist/
npm run test:e2e      # 9 tests navigateur (Playwright) sur le build : solo, victoire, 2 et 6 clients, voix
npm run docs          # régénère docs/ENTITIES.md et docs/CONTENT.md depuis les données
```

`npm run test:sql` nécessite les binaires PostgreSQL (`initdb`, `pg_ctl`, `psql`) ; aucun projet Supabase n'est requis.

## Organisation

```
src/
  core/         utilitaires (aléa déterministe, bus d'événements, maths)
  config/       réglages et touches
  world/        génération, validation, grille de collision, navigation, état du monde
  player/       déplacement et physiologie
  interaction/  règles d'interaction (communes au client et à l'hôte)
  inventory/    objets et inventaire
  ai/           agents, cerveaux des entités, gestionnaire
  missions/     objectifs, gestionnaire de mission, événements dynamiques
  network/      transports, salon, protocole, Supabase, voix WebRTC
  game/         session de jeu et autorité de l'hôte
  persistence/  profil, progression, stockage local ou Supabase
  audio/        synthèse, bibliothèque sonore, mixage
  engine/       rendu Babylon.js (matériaux, géométrie, éclairage, avatars, caméra)
  ui/           écrans, HUD, panneaux
supabase/       migration SQL et tests
tests/          unit/ (Vitest) et e2e/ (Playwright)
docs/           architecture, réseau, déploiement, contenu
```

L'architecture et les interfaces entre modules sont décrites dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Limites à connaître

- En ligne, l'hôte de la partie simule le monde et les entités : il n'y a **pas de serveur de jeu autoritaire**. Les récompenses, elles, sont calculées par la base de données. Le détail et l'architecture d'évolution proposée sont dans [docs/NETWORK.md](docs/NETWORK.md).
- Le chemin Supabase (authentification, annuaire des salons, canal temps réel) est écrit et son SQL est testé, mais il **n'a pas été exercé contre un vrai projet Supabase** pendant le développement.
- Les performances sur carte graphique réelle n'ont pas été mesurées (l'environnement de développement ne disposait que d'un rendu logiciel).
