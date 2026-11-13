# État du développement — NOCTURNE

Dernière mise à jour : 13 novembre 2026 · version 0.1 · branche `ccr-9f4b5495-15juqi`

Ce fichier dit ce qui existe réellement. À lire en premier à chaque reprise ; l'architecture est décrite dans `docs/ARCHITECTURE.md` et ne doit pas être réinventée.

## En bref

Le jeu se joue de bout en bout : lancement → menu → salon → équipement → expédition → mort ou extraction → résultats → progression. Solo et multijoueur (jusqu'à 6) fonctionnent en mode local ; le mode en ligne (Supabase) est écrit mais **n'a jamais été exécuté contre un vrai projet Supabase**.

Environ 17 900 lignes de TypeScript (55 fichiers), 610 lignes de SQL, aucun asset binaire.

## Terminé et vérifié

« Vérifié » signifie couvert par un test automatisé qui passe, ou observé sur capture d'écran pendant le développement.

| Domaine | Ce qui est fait | Vérification |
| --- | --- | --- |
| Fondations | Vite, TypeScript strict, modules séparés, CI et déploiement Pages | typage, build |
| Génération | 12 secteurs, graphe + macro-grille, salles, couloirs, sas à carte, raccourcis à loquet, conduits, passages secrets, salles cachées, escalier, ascenseur, graines reproductibles, validation et réparation | 7 tests, 40 graines |
| Décor | 49 types de salles, 54 éléments de décor, 18 machines, scènes narratives (lutte, barricade, abandon, panne, Souche), 24 documents | captures |
| Déplacement | Marche, course, accroupissement, saut, pentes, conduits, collisions par sous-pas | 6 tests |
| Physiologie | Santé, endurance, respiration/apnée, stress, température, bruit, infection, 5 blessures | 8 tests |
| Inventaire | 18 objets, emplacements, poids, piles, batteries | 4 tests |
| Interactions | Portes (7 actions), machines, terminaux, casiers, objets ; mêmes règles côté client et hôte | 18 tests |
| IA | Perception (vue, ouïe, lumière), mémoire, A* par capacités, 6 entités, le Visiteur à 9 états et traits variables | 23 tests |
| Missions | 30 objectifs, étapes, échecs, conséquences, extraction, menace croissante, 8 événements dynamiques | 11 tests |
| Réseau | Salons, états, admission par l'hôte, reprise d'hôte, reconnexion, détection de gel, désynchronisation, pertes de paquets, anti-triche de base | 27 tests en mémoire |
| Multijoueur réel | 2 clients (salon, discussion, synchronisation, action validée par l'hôte, départ de l'hôte), 6 clients, 7ᵉ refusé, rechargement de page | 4 tests navigateur |
| Voix | WebRTC pair à pair, proximité spatialisée et radio, écoute seule si micro refusé, indicateur de parole | 1 test navigateur (2 onglets, micro simulé) |
| Discussion écrite | Proximité (distance + murs), radio (appareil, relais, brouillage), lobby | tests unitaires et navigateur |
| Persistance | Profil local, expérience, niveaux, 16 déblocages cosmétiques, 10 succès | 9 tests |
| SQL | 9 tables, RLS, 6 fonctions, barème côté serveur | 53 assertions sur PostgreSQL 16 local |
| Rendu | Textures PBR procédurales, géométrie fusionnée, instances, budget de lumières, ombres de la lampe, brouillard, post-traitement, 3 qualités | captures, tests navigateur |
| Audio | 66 sons synthétisés, 7 catégories, spatialisation, occlusion, priorités, ambiance et musique dynamiques, silence dramatique | aucune vérification à l'oreille (voir plus bas) |
| Interface | Les 19 écrans demandés + pause + terminal, touches reconfigurables | 2 tests navigateur |
| Parcours complet | Solo : déplacement réel au clavier et à la souris, abandon, seconde expédition ; victoire par le sas avec récompense | 3 tests navigateur |

Total : **113 tests unitaires, 53 assertions SQL, 9 tests navigateur** — tous verts au dernier lancement.

## Fait mais non vérifié

À traiter comme « probablement fonctionnel, à éprouver » :

- **Tout le chemin Supabase côté client** : inscription, connexion, invité anonyme, `SupabaseTransport` (annuaire + canal Realtime), `SupabaseProfileStore`, appel de `start_session` / `finish_session` depuis le jeu. Le SQL est testé ; les appels depuis le navigateur ne l'ont jamais été faute de projet.
- **Les workflows GitHub Actions** : écrits, jamais exécutés sur GitHub.
- **Les performances réelles** : seul un rendu logiciel (SwiftShader, 3 à 6 images/s) était disponible. Rien ne permet d'affirmer la fluidité sur un PC moyen.
- **Le son** : aucun moyen d'écouter dans l'environnement de développement. Les recettes de synthèse s'exécutent sans erreur ; leur qualité et leur mixage sont à juger au casque.
- **L'équilibrage** : aucune partie complète jouée par un humain. Durée réelle d'une expédition, difficulté des entités, rareté des fusibles : inconnues.
- **Dans le navigateur, non couverts par un test** : terminal (portes, caméras, transfert), caméra portable, mort par une entité, spectateur. La logique sous-jacente est testée en mémoire.
- **Voix entre deux machines distinctes** (testée uniquement entre onglets en local).

## Non fait

- **Déplacer des objets du décor** (pousser une caisse, tirer un chariot) — demandé dans le cahier des charges, absent.
- **Serveur de jeu autoritaire** — l'hôte simule ; architecture d'évolution décrite dans `docs/NETWORK.md`.
- **Canaux Realtime privés** — le canal d'un salon est accessible à qui connaît son code.
- **Serveur TURN** pour la voix ; choix du périphérique d'entrée ; réglage du volume par joueur (la sourdine par joueur existe dans le lobby, pas en cours de partie).
- **Conservation de l'inventaire** après rechargement de page.
- **Hallucinations visuelles** propres au stress (seules existent les hallucinations sonores et les mirages du Visiteur).
- Modèles 3D et animations dessinés : tout est en primitives. Pas de reflets en espace écran.
- Collisions entre joueurs, trajectoire visible des objets lancés.
- Manette, mobile, langues autres que le français, options d'accessibilité au-delà de la réduction des mouvements de caméra.
- ESLint / Prettier dans le projet.

## Bugs et faiblesses connus

1. Les néons sans ombre éclairent parfois à travers une cloison (atténué par la sélection des lumières en vue directe).
2. Une entité bloquée contre un meuble traverse le décor au bout de 1,2 s pour se dégager.
3. Marches d'escalier : écart visuel de ± 6 cm avec la rampe de collision.
4. Après une reprise d'hôte, les entités perdent leur état mental (position conservée).
5. Qualité « faible » : textures en 128 px, visiblement grossières de près.
6. Un battant de porte traverse un joueur placé dans son débattement.
7. Mode local à plusieurs onglets : le profil étant commun, seul le premier onglet enregistre le résultat.

## Corrigé en cours de route (pour mémoire)

- Babylon bloquait l'événement `mousedown` → jeu incontrôlable ; passage aux événements pointeur.
- Le HUD interceptait les clics destinés à la scène.
- Un client figé par le chargement se déclarait hôte ; ajout de la détection de gel.
- La migration SQL échouait sur l'ajout d'un succès (`text[] || 'x'`).
- Deux écrans coexistaient pendant les fondus (boutons fantômes).
- L'objectif « Confiner la quarantaine » se validait d'emblée, les sas étant verrouillés d'origine.

## Prochaines tâches, par ordre d'intérêt

1. **Brancher un projet Supabase réel** et dérouler : inscription, salon public, partie à deux machines, résultat. Corriger ce qui casse.
2. **Jouer** une expédition complète à plusieurs, sur carte graphique réelle ; mesurer les images/s ; équilibrer.
3. Écouter et retravailler le mixage ; remplacer les sons les moins convaincants.
4. Tests navigateur manquants : terminal, caméras, mort par entité, spectateur.
5. Déplacement d'objets du décor.
6. Canaux Realtime privés (`realtime.messages` + RLS) ; sourdine en jeu et volume par joueur.
7. Corriger les bugs 1 à 3.
8. Serveur autoritaire (voir `docs/NETWORK.md`) si le jeu est ouvert au public.

## Dépendances externes

| Besoin | Pour quoi | Obligatoire |
| --- | --- | --- |
| Node 22, npm | Développement et build | oui |
| Projet Supabase (Auth, Postgres, Realtime) | Jeu en ligne | non — mode local sinon |
| GitHub Pages + Actions | Hébergement | non |
| PostgreSQL local (`initdb`, `pg_ctl`, `psql`) | `npm run test:sql` | pour ce test seulement |
| Chromium (Playwright) | `npm run test:e2e` | pour ces tests seulement |
| `stun.l.google.com:19302` | Voix WebRTC | pour la voix seulement |

## Note sur le dépôt

Le contenu précédent (`supertrend_alert.py`, son workflow planifié, `state.json`) a été supprimé **sur cette branche** comme demandé. Il existe toujours sur `main` et continue d'y tourner tant que la branche n'est pas fusionnée ; la fusion l'arrêtera et activera le déploiement Pages.
