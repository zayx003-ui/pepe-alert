-- ============================================================================
-- NOCTURNE — schéma Supabase
--
-- Principes :
--   * le client ne peut écrire directement que son nom, son titre et sa tenue ;
--   * salons, sessions et récompenses passent par des fonctions SECURITY DEFINER
--     qui vérifient l'identité de l'appelant (auth.uid()) ;
--   * l'expérience est calculée ICI à partir de la table objective_rewards et de
--     l'horloge du serveur — jamais à partir d'un montant fourni par le client.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.player_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20),
  title text not null default 'Recrue',
  color text not null default '#8a8f98' check (color ~ '^#[0-9a-fA-F]{6}$'),
  xp integer not null default 0 check (xp >= 0),
  achievements text[] not null default '{}',
  documents text[] not null default '{}',
  creatures text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.player_statistics (
  user_id uuid primary key references public.player_profiles (id) on delete cascade,
  playtime_seconds integer not null default 0,
  expeditions integer not null default 0,
  successes integer not null default 0,
  failures integer not null default 0,
  deaths integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.rooms (
  code text primary key check (code ~ '^[A-HJ-NP-Z2-9]{5}$'),
  name text not null check (char_length(name) between 1 and 40),
  host_id uuid not null references auth.users (id) on delete cascade,
  host_name text not null,
  players integer not null default 1 check (players between 0 and 6),
  max_players integer not null default 6 check (max_players between 1 and 6),
  status text not null default 'lobby' check (status in ('lobby', 'playing')),
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes'
);

create table public.room_members (
  room_code text not null references public.rooms (code) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (room_code, user_id)
);

create table public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  room_code text not null,
  host_id uuid not null references auth.users (id) on delete cascade,
  seed text not null,
  status text not null default 'playing' check (status in ('playing', 'finished')),
  outcome text check (outcome in ('succes', 'echec')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer
);

create table public.session_players (
  session_id uuid not null references public.game_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (session_id, user_id)
);

create table public.expedition_results (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.game_sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  outcome text not null check (outcome in ('succes', 'echec')),
  status text not null check (status in ('extrait', 'mort', 'disparu', 'abandon')),
  xp_awarded integer not null,
  duration_seconds integer not null,
  objectives text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (session_id, user_id)
);

-- Barème des objectifs : doit rester identique à src/missions/objectives.ts
-- (vérifié par tests/unit/persistence.test.ts).
create table public.objective_rewards (
  id text primary key,
  kind text not null check (kind in ('principal', 'secondaire')),
  xp integer not null check (xp > 0)
);

insert into public.objective_rewards (id, kind, xp) values
  ('P-MED', 'principal', 420),
  ('P-PWR', 'principal', 460),
  ('P-CORE', 'principal', 620),
  ('P-DATA', 'principal', 480),
  ('P-PURGE', 'principal', 520),
  ('P-SAMPLE', 'principal', 500),
  ('P-ACOUSTIC', 'principal', 520),
  ('P-DOSSIER', 'principal', 440),
  ('P-RELAY', 'principal', 460),
  ('P-CRYO', 'principal', 540),
  ('S-CONTAM', 'secondaire', 140),
  ('S-THERM', 'secondaire', 160),
  ('S-CAM-EXP', 'secondaire', 150),
  ('S-CAM-CORE', 'secondaire', 220),
  ('S-DOCS-5', 'secondaire', 120),
  ('S-DOCS-10', 'secondaire', 260),
  ('S-RELAY', 'secondaire', 150),
  ('S-AUX', 'secondaire', 130),
  ('S-ARCH-PWR', 'secondaire', 130),
  ('S-COOL', 'secondaire', 200),
  ('S-VALVES', 'secondaire', 180),
  ('S-ID-ECHO', 'secondaire', 220),
  ('S-ID-VISITOR', 'secondaire', 260),
  ('S-ID-STATIC', 'secondaire', 220),
  ('S-FRESH', 'secondaire', 160),
  ('S-SEAL', 'secondaire', 200),
  ('S-STAFF', 'secondaire', 150),
  ('S-VAULT', 'secondaire', 190),
  ('S-MARK', 'secondaire', 100),
  ('S-PROBE', 'secondaire', 210);

-- Déblocages cosmétiques : doit rester identique à src/persistence/progression.ts.
create table public.cosmetic_unlocks (
  kind text not null check (kind in ('titre', 'tenue')),
  value text not null,
  min_level integer,
  achievement text,
  primary key (kind, value)
);

insert into public.cosmetic_unlocks (kind, value, min_level, achievement) values
  ('titre', 'Recrue', 1, null),
  ('titre', 'Éclaireur', 3, null),
  ('titre', 'Technicien de nuit', 5, null),
  ('titre', 'Veilleur', 8, null),
  ('titre', 'Chef d''expédition', 12, null),
  ('titre', 'Archiviste', null, 'archiviste'),
  ('titre', 'Témoin', null, 'bestiaire'),
  ('titre', 'Dixième occupant', null, 'noyau'),
  ('tenue', '#8a8f98', 1, null),
  ('tenue', '#d9952b', 2, null),
  ('tenue', '#3d6fa8', 4, null),
  ('tenue', '#4f9a52', 6, null),
  ('tenue', '#b8382f', 9, null),
  ('tenue', '#7d4fb0', 11, null),
  ('tenue', '#d8dde2', null, 'sans_perte'),
  ('tenue', '#23252b', null, 'noyau');

create index rooms_public_idx on public.rooms (is_public, updated_at desc);
create index room_members_user_idx on public.room_members (user_id);
create index expedition_results_user_idx on public.expedition_results (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Fonctions utilitaires
-- ---------------------------------------------------------------------------

-- Niveau atteint pour une quantité d'expérience (même courbe que le client).
create or replace function public.level_for_xp(p_xp integer)
returns integer
language plpgsql
immutable
as $$
declare
  lvl integer := 1;
begin
  while lvl < 50 and p_xp >= round(350 * power(lvl, 1.45)) loop
    lvl := lvl + 1;
  end loop;
  return lvl;
end;
$$;

-- Crée le profil à l'inscription.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  v_name := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'Agent-' || substr(new.id::text, 1, 4)), 20);
  insert into public.player_profiles (id, display_name) values (new.id, v_name) on conflict (id) do nothing;
  insert into public.player_statistics (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Un joueur ne peut porter qu'un titre ou une tenue qu'il a débloqués.
create or replace function public.validate_cosmetics()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_level integer := public.level_for_xp(new.xp);
begin
  new.display_name := left(trim(new.display_name), 20);
  if new.title is distinct from old.title and not exists (
    select 1 from public.cosmetic_unlocks u
    where u.kind = 'titre' and u.value = new.title
      and ((u.min_level is not null and v_level >= u.min_level) or (u.achievement is not null and u.achievement = any (new.achievements)))
  ) then
    raise exception 'Titre non débloqué';
  end if;
  if new.color is distinct from old.color and not exists (
    select 1 from public.cosmetic_unlocks u
    where u.kind = 'tenue' and lower(u.value) = lower(new.color)
      and ((u.min_level is not null and v_level >= u.min_level) or (u.achievement is not null and u.achievement = any (new.achievements)))
  ) then
    raise exception 'Tenue non débloquée';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger player_profiles_cosmetics
  before update on public.player_profiles
  for each row execute function public.validate_cosmetics();

-- ---------------------------------------------------------------------------
-- Salons
-- ---------------------------------------------------------------------------

create or replace function public.create_room(p_code text, p_name text, p_host_name text, p_is_public boolean, p_max_players integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Authentification requise';
  end if;
  delete from public.rooms where expires_at < now();
  -- Un joueur n'héberge qu'un salon à la fois.
  delete from public.rooms where host_id = v_uid;
  insert into public.rooms (code, name, host_id, host_name, is_public, max_players)
  values (p_code, left(trim(p_name), 40), v_uid, left(trim(p_host_name), 20), p_is_public, least(6, greatest(1, p_max_players)));
  insert into public.room_members (room_code, user_id) values (p_code, v_uid);
end;
$$;

-- Entrée dans un salon : inscrit l'appelant parmi les membres et renvoie le salon.
-- Renvoie zéro ligne si le salon n'existe pas ou a expiré.
create or replace function public.join_room(p_code text)
returns setof public.rooms
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Authentification requise';
  end if;
  select * into v_room from public.rooms where code = upper(p_code) and expires_at > now() for update;
  if not found then
    return;
  end if;
  if not exists (select 1 from public.room_members where room_code = v_room.code and user_id = v_uid) then
    select count(*) into v_count from public.room_members
      where room_code = v_room.code and last_seen > now() - interval '2 minutes';
    if v_count >= v_room.max_players then
      raise exception 'Salon complet';
    end if;
    insert into public.room_members (room_code, user_id) values (v_room.code, v_uid);
  else
    update public.room_members set last_seen = now() where room_code = v_room.code and user_id = v_uid;
  end if;
  return next v_room;
end;
$$;

-- Battement et mise à jour de l'annuaire. Réservé à l'hôte ; un membre peut
-- reprendre le rôle d'hôte si celui-ci ne s'est plus manifesté depuis 20 s.
create or replace function public.touch_room(
  p_code text,
  p_name text default null,
  p_is_public boolean default null,
  p_max_players integer default null,
  p_players integer default null,
  p_status text default null,
  p_host_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.rooms;
begin
  select * into v_room from public.rooms where code = p_code for update;
  if not found then
    raise exception 'Salon introuvable';
  end if;
  if not exists (select 1 from public.room_members where room_code = p_code and user_id = v_uid) then
    raise exception 'Vous ne faites pas partie de ce salon';
  end if;
  update public.room_members set last_seen = now() where room_code = p_code and user_id = v_uid;
  if v_room.host_id <> v_uid then
    if v_room.updated_at > now() - interval '20 seconds' then
      raise exception 'Seul l''hôte peut modifier le salon';
    end if;
    -- Reprise du salon par un membre après disparition de l'hôte.
    update public.rooms set host_id = v_uid where code = p_code;
  end if;
  update public.rooms set
    name = coalesce(left(trim(p_name), 40), name),
    is_public = coalesce(p_is_public, is_public),
    max_players = coalesce(least(6, greatest(1, p_max_players)), max_players),
    players = coalesce(least(6, greatest(0, p_players)), players),
    status = coalesce(p_status, status),
    host_name = coalesce(left(trim(p_host_name), 20), host_name),
    updated_at = now(),
    expires_at = now() + interval '30 minutes'
  where code = p_code;
end;
$$;

create or replace function public.close_room(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.rooms where code = p_code and host_id = auth.uid();
  delete from public.room_members where room_code = p_code and user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- Sessions et récompenses
-- ---------------------------------------------------------------------------

-- L'hôte déclare le début d'une expédition. Seuls les membres réels du salon
-- sont retenus comme participants.
create or replace function public.start_session(p_room text, p_seed text, p_players uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if not exists (select 1 from public.rooms where code = p_room and host_id = v_uid) then
    raise exception 'Seul l''hôte du salon peut lancer une expédition';
  end if;
  insert into public.game_sessions (room_code, host_id, seed) values (p_room, v_uid, left(p_seed, 32)) returning id into v_id;
  insert into public.session_players (session_id, user_id)
    select v_id, m.user_id from public.room_members m
    where m.room_code = p_room and (m.user_id = any (p_players) or m.user_id = v_uid);
  update public.rooms set status = 'playing', updated_at = now(), expires_at = now() + interval '90 minutes' where code = p_room;
  return v_id;
end;
$$;

-- Clôture d'une expédition et attribution des récompenses.
--   * appelable une seule fois par session, par l'un de ses participants ;
--   * la durée est mesurée par le serveur ;
--   * l'expérience vient du barème objective_rewards (1 principal + 3 secondaires au plus) ;
--   * le client ne transmet aucun montant.
create or replace function public.finish_session(
  p_session uuid,
  p_outcome text,
  p_objectives text[],
  p_documents text[],
  p_creatures text[],
  p_players jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.game_sessions;
  v_duration integer;
  v_primary integer := 0;
  v_secondary integer := 0;
  v_docs text[];
  v_creatures text[];
  v_objectives text[];
  v_total integer;
  v_player record;
  v_status text;
  v_xp integer;
  v_won boolean;
  v_all_out boolean;
  v_profile public.player_profiles;
  v_stats public.player_statistics;
  v_ach text[];
begin
  if p_outcome not in ('succes', 'echec') then
    raise exception 'Issue invalide';
  end if;
  select * into v_session from public.game_sessions where id = p_session for update;
  if not found then
    raise exception 'Session introuvable';
  end if;
  if not exists (select 1 from public.session_players where session_id = p_session and user_id = v_uid) then
    raise exception 'Vous ne participez pas à cette session';
  end if;
  if v_session.status <> 'playing' then
    raise exception 'Session déjà clôturée';
  end if;

  v_duration := greatest(0, extract(epoch from now() - v_session.started_at)::integer);

  -- Objectifs reconnus uniquement, bornés à un principal et trois secondaires.
  select coalesce(array_agg(id), '{}') into v_objectives from (
    (select r.id from public.objective_rewards r where r.id = any (p_objectives) and r.kind = 'principal' order by r.xp desc limit 1)
    union all
    (select r.id from public.objective_rewards r where r.id = any (p_objectives) and r.kind = 'secondaire' order by r.xp desc limit 3)
  ) o;
  select coalesce(sum(xp), 0) into v_primary from public.objective_rewards where id = any (v_objectives) and kind = 'principal';
  select coalesce(sum(xp), 0) into v_secondary from public.objective_rewards where id = any (v_objectives) and kind = 'secondaire';
  if p_outcome = 'succes' and v_primary = 0 then
    raise exception 'Une réussite exige un objectif principal accompli';
  end if;

  -- Documents et créatures : identifiants au format attendu, sans doublon, bornés.
  select coalesce(array_agg(distinct d), '{}') into v_docs
    from unnest(coalesce(p_documents, '{}')) d where d ~ '^[a-z]{3}-[0-9]{2}$';
  v_docs := v_docs[1:24];
  select coalesce(array_agg(distinct c), '{}') into v_creatures
    from unnest(coalesce(p_creatures, '{}')) c
    where c in ('visiteur', 'echo', 'phototrope', 'rampant', 'porteur', 'statique');

  select count(*) into v_total from public.session_players where session_id = p_session;
  select coalesce(bool_and(coalesce(e ->> 'status', '') = 'extrait'), false) into v_all_out
    from jsonb_array_elements(p_players) e;

  for v_player in select sp.user_id from public.session_players sp where sp.session_id = p_session loop
    select e ->> 'status' into v_status from jsonb_array_elements(p_players) e where (e ->> 'id') = v_player.user_id::text limit 1;
    if v_status is null or v_status not in ('extrait', 'mort', 'disparu', 'abandon') then
      v_status := 'abandon';
    end if;

    if v_status = 'abandon' then
      v_xp := 0;
    elsif v_duration < 180 then
      v_xp := 40;
    else
      if p_outcome = 'succes' then
        v_xp := round((v_primary + v_secondary) * (case when v_status = 'extrait' then 1 else 0.5 end));
      else
        v_xp := round(60 + v_secondary * 0.5);
      end if;
      v_xp := v_xp + coalesce(array_length(v_docs, 1), 0) * 12;
    end if;
    v_won := p_outcome = 'succes' and v_status = 'extrait';

    insert into public.expedition_results (session_id, user_id, outcome, status, xp_awarded, duration_seconds, objectives)
      values (p_session, v_player.user_id, p_outcome, v_status, v_xp, v_duration, v_objectives);

    update public.player_statistics set
      playtime_seconds = playtime_seconds + v_duration,
      expeditions = expeditions + 1,
      successes = successes + (case when v_won then 1 else 0 end),
      failures = failures + (case when v_won then 0 else 1 end),
      deaths = deaths + (case when v_status = 'mort' then 1 else 0 end),
      updated_at = now()
    where user_id = v_player.user_id
    returning * into v_stats;

    update public.player_profiles set
      xp = xp + v_xp,
      documents = (select coalesce(array_agg(distinct x), '{}') from unnest(documents || v_docs) x),
      creatures = (select coalesce(array_agg(distinct x), '{}') from unnest(creatures || v_creatures) x)
    where id = v_player.user_id
    returning * into v_profile;

    -- Succès (mêmes règles que src/persistence/progression.ts).
    v_ach := v_profile.achievements;
    if v_won and not ('premiere_sortie' = any (v_ach)) then v_ach := array_append(v_ach, 'premiere_sortie'); end if;
    if v_won and v_total > 1 and v_all_out and not ('sans_perte' = any (v_ach)) then v_ach := array_append(v_ach, 'sans_perte'); end if;
    if v_stats.expeditions >= 10 and not ('veteran' = any (v_ach)) then v_ach := array_append(v_ach, 'veteran'); end if;
    if v_stats.successes >= 5 and not ('survivant' = any (v_ach)) then v_ach := array_append(v_ach, 'survivant'); end if;
    if coalesce(array_length(v_profile.documents, 1), 0) >= 10 and not ('lecteur' = any (v_ach)) then v_ach := array_append(v_ach, 'lecteur'); end if;
    if coalesce(array_length(v_profile.documents, 1), 0) >= 24 and not ('archiviste' = any (v_ach)) then v_ach := array_append(v_ach, 'archiviste'); end if;
    if coalesce(array_length(v_profile.creatures, 1), 0) >= 6 and not ('bestiaire' = any (v_ach)) then v_ach := array_append(v_ach, 'bestiaire'); end if;
    if v_won and 'P-CORE' = any (v_objectives) and not ('noyau' = any (v_ach)) then v_ach := array_append(v_ach, 'noyau'); end if;
    if v_won and 'P-PURGE' = any (v_objectives) and not ('purge' = any (v_ach)) then v_ach := array_append(v_ach, 'purge'); end if;
    if v_won and 'P-PWR' = any (v_objectives) and not ('lumiere' = any (v_ach)) then v_ach := array_append(v_ach, 'lumiere'); end if;
    if v_ach is distinct from v_profile.achievements then
      update public.player_profiles set achievements = v_ach where id = v_player.user_id;
    end if;
  end loop;

  update public.game_sessions set status = 'finished', outcome = p_outcome, ended_at = now(), duration_seconds = v_duration where id = p_session;
  update public.rooms set status = 'lobby', updated_at = now() where code = v_session.room_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- Vue de l'annuaire public
-- ---------------------------------------------------------------------------

create view public.public_rooms
with (security_invoker = on) as
  select code, name, host_id, host_name, players, max_players, status, is_public, created_at, updated_at
  from public.rooms
  where is_public and expires_at > now() and updated_at > now() - interval '45 seconds';

-- ---------------------------------------------------------------------------
-- Sécurité au niveau des lignes
-- ---------------------------------------------------------------------------

alter table public.player_profiles enable row level security;
alter table public.player_statistics enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.game_sessions enable row level security;
alter table public.session_players enable row level security;
alter table public.expedition_results enable row level security;
alter table public.objective_rewards enable row level security;
alter table public.cosmetic_unlocks enable row level security;

-- Profils : lisibles par tout joueur connecté (nom, titre, tenue, niveau).
create policy "profils lisibles" on public.player_profiles
  for select to authenticated using (true);
-- Seul le propriétaire modifie son profil, et uniquement les colonnes cosmétiques (voir GRANT plus bas).
create policy "profil modifiable par son proprietaire" on public.player_profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "statistiques personnelles" on public.player_statistics
  for select to authenticated using (user_id = auth.uid());

create policy "salons publics ou rejoints" on public.rooms
  for select to authenticated using (
    is_public or host_id = auth.uid()
    or exists (select 1 from public.room_members m where m.room_code = rooms.code and m.user_id = auth.uid())
  );

create policy "ses propres adhesions" on public.room_members
  for select to authenticated using (user_id = auth.uid());

create policy "sessions auxquelles on participe" on public.game_sessions
  for select to authenticated using (
    host_id = auth.uid()
    or exists (select 1 from public.session_players sp where sp.session_id = game_sessions.id and sp.user_id = auth.uid())
  );

create policy "ses propres participations" on public.session_players
  for select to authenticated using (user_id = auth.uid());

create policy "ses propres resultats" on public.expedition_results
  for select to authenticated using (user_id = auth.uid());

create policy "bareme lisible" on public.objective_rewards
  for select to authenticated using (true);

create policy "deblocages lisibles" on public.cosmetic_unlocks
  for select to authenticated using (true);

-- Aucune politique INSERT / DELETE : toutes les écritures passent par les fonctions ci-dessus.

-- ---------------------------------------------------------------------------
-- Privilèges
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon;

grant select on public.player_profiles, public.player_statistics, public.rooms, public.room_members,
  public.game_sessions, public.session_players, public.expedition_results,
  public.objective_rewards, public.cosmetic_unlocks, public.public_rooms to authenticated;

-- Le client ne peut modifier QUE ces trois colonnes de son profil.
grant update (display_name, title, color) on public.player_profiles to authenticated;

grant execute on function public.create_room(text, text, text, boolean, integer) to authenticated;
grant execute on function public.join_room(text) to authenticated;
grant execute on function public.touch_room(text, text, boolean, integer, integer, text, text) to authenticated;
grant execute on function public.close_room(text) to authenticated;
grant execute on function public.start_session(text, text, uuid[]) to authenticated;
grant execute on function public.finish_session(uuid, text, text[], text[], text[], jsonb) to authenticated;
grant execute on function public.level_for_xp(integer) to authenticated;
