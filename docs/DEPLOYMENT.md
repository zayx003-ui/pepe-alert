# Déploiement et configuration

Le jeu fonctionne sans aucun service (mode local). Supabase n'est nécessaire que pour le jeu en ligne.

## 1. Supabase

1. Créez un projet sur <https://supabase.com>.
2. **SQL Editor** → collez et exécutez `supabase/migrations/0001_nocturne.sql`.
   Avec la CLI : `supabase link --project-ref <ref>` puis `supabase db push`.
3. **Authentication → Providers → Email** : activé par défaut. Si « Confirm email » est actif, le joueur doit confirmer son adresse avant sa première connexion (le jeu l'en informe).
4. *(Facultatif)* **Authentication → Sign In / Providers → Anonymous sign-ins** : à activer pour le bouton « Jouer en invité ».
5. **Authentication → URL Configuration** : ajoutez l'adresse du jeu (par exemple `https://<utilisateur>.github.io/<dépôt>/`) aux URL de redirection.
6. **Project Settings → API** : relevez `Project URL` et la clé `anon` `public`.

La clé `anon` est faite pour être publique : la sécurité repose sur les politiques RLS et les fonctions de la migration. Ne mettez **jamais** la clé `service_role` dans le client ni dans le dépôt.

Realtime (diffusion) est actif par défaut sur les projets Supabase ; aucune table n'a besoin d'être publiée.

### Ce que crée la migration

| Table | Contenu | Lecture | Écriture |
| --- | --- | --- | --- |
| `player_profiles` | Nom, titre, tenue, expérience, succès, documents, créatures | joueurs connectés | propriétaire : nom, titre, tenue uniquement |
| `player_statistics` | Temps de jeu, expéditions, réussites, échecs, morts | propriétaire | fonctions SQL |
| `rooms` | Annuaire des salons | publics ou rejoints | fonctions SQL |
| `room_members` | Membres des salons | soi-même | fonctions SQL |
| `game_sessions`, `session_players` | Sessions et participants | participants | fonctions SQL |
| `expedition_results` | Résultat et expérience par joueur | propriétaire | fonctions SQL |
| `objective_rewards`, `cosmetic_unlocks` | Barèmes | joueurs connectés | — |

Fonctions : `create_room`, `join_room`, `touch_room`, `close_room`, `start_session`, `finish_session`. Le barème `objective_rewards` doit rester identique à `src/missions/objectives.ts` : un test unitaire échoue en cas d'écart.

### Vérifier la migration sans projet Supabase

```bash
npm run test:sql
```

Le script crée un PostgreSQL jetable, simule le schéma `auth`, applique la migration et déroule 53 vérifications (un joueur ne s'attribue pas d'expérience, un invité ne lance pas l'expédition, une session ne se clôt qu'une fois…).

## 2. En local

```bash
cp .env.example .env
# VITE_SUPABASE_URL=https://xxxx.supabase.co
# VITE_SUPABASE_ANON_KEY=eyJ...
npm install
npm run dev
```

L'écran de lancement indique le mode actif en bas à gauche. Ajoutez `?local=1` à l'URL pour forcer le mode local même si Supabase est configuré.

## 3. GitHub Pages

1. **Settings → Pages → Build and deployment → Source : GitHub Actions.**
2. **Settings → Secrets and variables → Actions** :
   - onglet *Variables* : `VITE_SUPABASE_URL` ;
   - onglet *Secrets* : `VITE_SUPABASE_ANON_KEY`.
   Sans ces valeurs, le site est publié en mode local.
3. Poussez sur `main` (ou lancez le workflow « Déploiement GitHub Pages » à la main).

Le build utilise des chemins relatifs (`base: './'`) : il fonctionne sous `https://<utilisateur>.github.io/<dépôt>/` comme sur un domaine racine.

## 4. Workflows

| Fichier | Déclencheur | Étapes |
| --- | --- | --- |
| `.github/workflows/ci.yml` | chaque push et pull request | typage, tests unitaires, tests SQL, build, tests navigateur |
| `.github/workflows/deploy.yml` | push sur `main`, ou manuel | tests unitaires, build, publication sur Pages |

## 5. Paramètres d'URL utiles

| Paramètre | Effet |
| --- | --- |
| `?local=1` | Force le mode local. |
| `?nom=Alice` | Nom affiché pour cet onglet (mode local). |
| `?q=faible` \| `moyenne` \| `elevee` | Force la qualité graphique. |
| `?auto=solo&seed=XXXX` | Lance directement une partie solo sur la graine donnée (débogage). |
