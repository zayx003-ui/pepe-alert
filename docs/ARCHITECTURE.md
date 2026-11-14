# Architecture

Pile : TypeScript strict, Vite, Babylon.js (`@babylonjs/core`, imports ciblés), Supabase (`@supabase/supabase-js`), WebRTC, Vitest, Playwright. Aucune autre dépendance d'exécution.

## Principe directeur : une logique pure, des vues autour

Tout ce qui décide de l'issue d'une partie — génération, collisions, physiologie, interactions, IA, missions, protocole réseau — est du TypeScript **sans dépendance au moteur 3D ni au DOM**. Le rendu, l'audio et l'interface lisent cet état et écoutent ses événements.

Conséquences :

- les tests unitaires font tourner de vraies parties à plusieurs clients en mémoire (`tests/unit/helpers.ts`) ;
- l'hôte et les clients exécutent le même code de règles (`interaction/actions.ts`) : ce que le client affiche comme possible est exactement ce que l'hôte acceptera ;
- un serveur autoritaire pourrait réutiliser `world/`, `ai/`, `missions/`, `interaction/` et `game/host.ts` tels quels (voir NETWORK.md).

```
                    ┌──────────────────────────── ui/ (DOM) ────────────────────────────┐
                    │  app.ts  écrans, HUD, tablette, terminal                          │
                    └───────┬──────────────────────────────┬─────────────────┬──────────┘
                            │                              │                 │
                  engine/ (Babylon)                 audio/ (WebAudio)   network/voice.ts
                  GameView, WorldView, LightRig     AudioManager         (WebRTC)
                            │ lit                         │ écoute
                            ▼                             ▼
        ┌──────────────────────────── game/session.ts — GameSession ───────────────────────────┐
        │ personnage local : PlayerMotor + PlayerSimulation + Inventory                         │
        │ monde : WorldState (portes, machines, objets)        joueurs distants, entités        │
        │ game/host.ts — HostAuthority (chez l'hôte seulement) :                                │
        │     EntityAIManager · MissionManager · EventDirector · validation des demandes        │
        └───────────────┬───────────────────────────────────────────────┬───────────────────────┘
                        │ SessionLink.send / receive                    │
                network/room.ts — RoomSession                    persistence/store.ts
                (présence, lobby, hôte, reconnexion)             (profil local ou Supabase)
                        │
                network/transport.ts — Transport
                Supabase Realtime │ BroadcastChannel │ mémoire (tests)
```

## Modules et interfaces

| Module | Rôle | Interface principale |
| --- | --- | --- |
| `core/` | `Rng` déterministe et fourchable, `EventBus` typé, maths | — |
| `config/settings.ts` | Réglages persistés, touches par position physique | `Settings`, `loadSettings`, `keyLabel` |
| `world/generator.ts` | Carte à partir d'une graine | `generateLayout(seed): Layout` |
| `world/validate.ts` | Atteignabilité par progression, réparation des verrous | `validateLayout`, `computeReach` |
| `world/grid.ts` | Collisions, hauteur du sol, vue, occlusion sonore | `WorldGrid.resolve / sight / soundOcclusion / heightAt` |
| `world/nav.ts` | A* selon les capacités de l'entité | `findPath(grid, doors, from, to, caps)` |
| `world/state.ts` | État dynamique, opérations sérialisables | `WorldState.commit(op) / apply(op) / snapshot() / load()` |
| `player/motor.ts` | Déplacement, pentes, accroupissement | `PlayerMotor.update(dt, intent, mods, grid)` |
| `player/simulation.ts` | Physiologie et blessures | `PlayerSimulation.update(dt, input)`, `damage`, `perception()` |
| `interaction/actions.ts` | Règles d'interaction | `listActions`, `performAction`, `performTerminal` |
| `inventory/` | Catalogue et inventaire | `ITEMS`, `Inventory` |
| `ai/agent.ts` | Perception, mémoire, suivi de chemin | `EntityAgent` |
| `ai/brains.ts` | Une machine à états par entité | `BRAINS[kind].think / act` |
| `ai/manager.ts` | Cycle de vie des entités | `EntityAIManager.update(dt, targets, threat)`, `snapshots()`, `restore()` |
| `missions/` | Objectifs, extraction, événements | `MissionManager`, `EventDirector` |
| `network/transport.ts` | Canal de messages et annuaire | `Transport`, `RoomChannel` |
| `network/room.ts` | Salon | `RoomSession` (événements `members`, `host`, `start`, `go`…) |
| `network/protocol.ts` | Messages de jeu | constantes `MSG`, types des charges utiles |
| `game/session.ts` | Une expédition vue par un joueur | `GameSession.update(dt, input)`, `receive(msg)`, événements |
| `game/host.ts` | Autorité | `HostAuthority.handleRequest / handleFact / finish` |
| `persistence/` | Progression | `ProfileStore`, `computeXp`, `applyResult` |
| `audio/` | Synthèse et mixage | `AudioManager.play / update / attach` |
| `engine/` | Rendu | `Renderer`, `GameView.update(dt)` |
| `ui/` | Écrans et HUD | `App` |

## Le monde

- **Grille** de cellules de 2 m (80 × 64), regroupées en **régions** (salle, couloir, conduit, cabine d'ascenseur). Les murs sont des **arêtes** entre cellules ; une porte est une arête particulière.
- **Macro-grille** 5 × 4 : chaque secteur occupe un emplacement de 16 × 16 cellules. Les secteurs reliés dans le graphe sont toujours voisins sur la macro-grille, ce qui garantit des raccords rectilignes.
- **Hauteur** : chaque cellule a une hauteur de sol et une pente. Le Noyau est 4 m plus bas, rejoint par une rampe d'escalier (4 cellules) et par un ascenseur dont le plancher est dynamique.
- **Progression** : cartes d'accès de niveau 1 à 3 placées dans un palier inférieur à celui qu'elles ouvrent ; raccourcis verrouillés depuis le secteur le plus profond ; ascenseur conditionné au générateur principal. Le validateur simule cette progression jusqu'au point fixe et retire un verrou si une région reste inaccessible.

### Reproduire une carte

La graine est affichée dans le lobby, dans les résultats et dans l'URL de test : `/?local=1&auto=solo&seed=MAGRAINE` lance directement une partie solo sur cette carte. Dans les tests : `generateLayout('MAGRAINE')`.

## Boucle de jeu (une image)

1. `InputManager.sample()` → `FrameInput` ; la souris met à jour `motor.yaw / pitch`.
2. `GameSession.update(dt, input)` : environnement → déplacement → physiologie → interactions → objets → envoi de l'état (10 Hz) → `WorldState.update` → `HostAuthority.update` (chez l'hôte) → interpolation.
3. `GameView.update(dt)` : caméra, portes, lumières, avatars, particules, post-traitement.
4. `AudioManager.update`, `Hud.update`, voix, battement du salon.

## Performances

- Géométrie statique fusionnée : un maillage par secteur et par matériau (`GeoBatch`) ; portes, objets, néons et voyants en **instances**.
- Secteurs éloignés désactivés (au-delà de 55 m), brouillard exponentiel, plan lointain à 90 m.
- **Budget de lumières** fixe : la lampe du joueur (avec ombres), 2 à 6 néons attribués aux plus proches en vue directe, 0 à 2 lampes de coéquipiers. Les autres néons sont de simples surfaces émissives.
- IA : réflexion à 5 Hz près des joueurs, 1,7 Hz au-delà de 45 m ; A* sur tableaux typés réutilisés ; aucune allocation dans la résolution des collisions.
- Réseau : états des personnages à 10 Hz, entités à 8 Hz, opérations du monde groupées par image.
- Trois niveaux de qualité (`faible`, `moyenne`, `élevée`) : taille des textures, nombre de lumières, ombres, post-traitement, particules, échelle de rendu.
