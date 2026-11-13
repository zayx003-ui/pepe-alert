# Architecture réseau

## Vue d'ensemble

| Élément | Rôle | Autorité |
| --- | --- | --- |
| **GitHub Pages** | Sert le client (fichiers statiques). | — |
| **Supabase Auth** | Comptes (courriel + mot de passe, invité anonyme si activé). | Serveur |
| **Supabase Postgres** | Profils, statistiques, annuaire des salons, sessions, résultats. Écritures uniquement par fonctions SQL. | **Serveur** |
| **Supabase Realtime** | Canal de diffusion par salon (`salon:CODE`) : tous les messages de jeu. | Relais sans logique |
| **Client hôte** | Simule le monde, les entités, les missions ; valide les interactions ; arrête le résultat. | **Hôte** |
| **Chaque client** | Son personnage : position, inventaire, santé. | Client |
| **WebRTC** | Voix pair à pair (maillage), signalisation par le canal du salon. | — |

> **Il n'y a pas de serveur de jeu autoritaire.** Seul le client est déployé ; la simulation tourne dans le navigateur de l'hôte. Les limites de ce modèle et l'évolution proposée sont décrites plus bas.

## Transport

`network/transport.ts` définit deux interfaces (`Transport` pour l'annuaire, `RoomChannel` pour les messages) et trois implémentations :

- `SupabaseTransport` — en ligne ;
- `LocalTransport` — `BroadcastChannel` + `localStorage`, entre onglets d'un même navigateur, sans serveur ;
- `MemoryTransport` — tests automatisés, avec latence et pertes simulées.

Le protocole de salon et de jeu est identique sur les trois : ce qui est testé en mémoire est le code qui tourne en ligne.

## Salon (`network/room.ts`)

États d'un joueur : `connected`, `ready`, `loading`, `playing`, `dead`, `extracted`, `disconnected`.

| Situation | Traitement |
| --- | --- |
| Entrée | `hello` → l'hôte admet (ou refuse : salon complet, expédition en cours) → les membres se présentent. |
| Présence | Battement toutes les 2 s. 7 s de silence → `disconnected`. |
| Perte de connexion | La place est conservée 90 s ; au retour le joueur se réannonce et redemande l'état complet. |
| Rechargement de page | Même onglet → même identité ; le salon le reconnaît comme membre de l'expédition et le fait recharger la partie. La position est restituée par l'hôte ; **l'inventaire est perdu**. |
| Départ ou disparition de l'hôte | Le membre connecté le plus ancien se déclare hôte (`époque` incrémentée). Préséance : époque la plus haute, puis plus petit identifiant. Un ancien hôte qui revient s'incline. |
| Client figé (chargement, onglet en veille) | Détecté par l'écart entre deux battements locaux : le client n'en tire aucune conclusion sur les autres. |
| Joueur bloqué en chargement | Après 30 s, la partie démarre sans lui ; il rejoint par synchronisation complète. |
| Expiration | Annuaire : un salon sans battement d'hôte depuis 45 s n'est plus listé ; supprimé après 30 min. |
| Fin prématurée | Abandon = mort du personnage. Quand plus aucun joueur connecté n'est en jeu, l'hôte clôt l'expédition. |

## Protocole de jeu (`network/protocol.ts`)

| Message | Sens | Fréquence | Contenu |
| --- | --- | --- | --- |
| `ps` | client → tous | 10 Hz | Position, orientation, drapeaux, bruit, santé. |
| `ops` | hôte → tous | à la demande | Opérations numérotées sur le monde (porte, machine, objet…). |
| `ent` | hôte → tous | 8 Hz | Instantané des entités. |
| `mis` | hôte → tous | sur changement | État des objectifs. |
| `hst` | hôte → tous | 6 s | Numéro de séquence + état interne des missions (reprise d'hôte). |
| `req` / `res` | client ↔ hôte | à la demande | Demande d'interaction et réponse. |
| `fact` | client → hôte | à la demande | Objet lâché, relevé, mort, extraction… |
| `dmg` / `eff` | hôte → un client | à la demande | Dégâts, infection, stress, décharge des batteries. |
| `fx`, `ntc` | hôte → tous | à la demande | Sons d'entités, leurres, événements. |
| `sreq` / `sync` | client ↔ hôte | à la demande | État complet du monde. |
| `chat` | client → tous | à la demande | Discussion (proximité ou radio ; filtrée à la réception). |
| `rtc` | client ↔ client | à la demande | Signalisation WebRTC et indicateur de parole. |
| `result` | hôte → tous | 1 | Résultat de l'expédition. |

**Désynchronisation.** Chaque lot `ops` porte un numéro de séquence. Un trou, ou un battement `hst` annonçant un numéro plus élevé, déclenche une demande d'état complet. Vérifié avec 20 % et 100 % de pertes simulées.

**Interpolation.** Joueurs distants et entités glissent vers leur dernière position reçue ; un saut de plus de 5 à 6 m est appliqué directement.

**Débit mesuré** (test de charge, 6 joueurs en mouvement, 60 s) : moins de 14 messages/s par invité, moins de 30 pour l'hôte, moins de 100 au total, moins de 12 ko/s par client. Le client règle Supabase Realtime à 30 événements/s. À vérifier contre les quotas de votre offre Supabase.

## Ce que l'hôte vérifie

- La **position** utilisée pour valider une interaction est celle qu'il connaît, pas celle que le client annonce.
- Les conditions de l'action (`listActions`) sont réévaluées chez lui : carte d'accès, côté du loquet, secteur alimenté, objet encore présent.
- Un objet convoité par deux joueurs n'est attribué qu'une fois.
- Extraction acceptée seulement si le sas est ouvert et le joueur dedans.
- Messages réservés à l'hôte (`ops`, `ent`, `dmg`, `result`, imitation radio) ignorés s'ils viennent d'un autre.

## Ce que le serveur vérifie (SQL)

- Le client ne peut modifier que `display_name`, `title`, `color` de son profil (privilèges de colonnes + RLS) ; titre et tenue doivent être débloqués.
- `finish_session` : appelant participant à la session, session clôturable une seule fois, **durée mesurée par le serveur**, expérience tirée du barème `objective_rewards` (1 principal + 3 secondaires au plus), documents et créatures filtrés. Aucun montant ne vient du client.

## Limites assumées

1. **L'hôte est de confiance pour les faits de la partie** (qui est mort, quel objectif est accompli). Un hôte modifié peut déclarer une réussite ; le serveur borne le gain (barème, durée minimale, un seul principal).
2. **Chaque client est maître de son personnage** : vitesse et santé ne sont pas vérifiées. Acceptable pour un jeu coopératif, pas pour un jeu compétitif.
3. **Les inventaires sont déclaratifs** : l'hôte attribue les objets ramassés, mais croit le client quand celui-ci dit posséder un fusible.
4. **Canal de salon public** : quiconque connaît le code du salon et la clé anonyme peut écouter ou émettre sur le canal Realtime.
5. **Voix sans serveur TURN** : la liaison peut échouer derrière certains pare-feu ; la discussion écrite reste disponible et l'interface indique l'état réel de la voix.
6. La reprise d'hôte **réinitialise l'état mental des entités** (elles gardent leur position).

## Évolution : serveur de jeu autoritaire

Supabase Realtime est un relais : il ne peut pas exécuter la simulation. Pour une autorité complète, ajouter un **processus Node par salon** (Fly.io, Railway, VPS…) qui réutilise le code existant :

```
navigateur ──WebSocket──► serveur de jeu (Node)
                          ├─ world/ ai/ missions/ interaction/   (inchangés)
                          ├─ game/host.ts → HostAuthority         (inchangé)
                          ├─ simulation des personnages : le client envoie ses commandes
                          │  (FrameInput), le serveur exécute PlayerMotor et PlayerSimulation
                          └─ clé de service Supabase : finish_session réservé au serveur
```

Étapes :

1. Un quatrième `Transport` (WebSocket) — l'interface existe déjà.
2. `HostAuthority` détaché de `GameSession` : il n'en utilise que `world`, `players`, `layout` et trois méthodes d'émission. Un adaptateur serveur suffit.
3. Déplacement autoritaire avec prédiction côté client et réconciliation (`PlayerMotor` est déterministe).
4. `finish_session` restreint au rôle de service ; suppression de la confiance accordée aux participants.
5. Canaux privés et jetons de salon signés par le serveur.

Rien de cela n'est implémenté.
