-- Scénarios de test du schéma NOCTURNE. Chaque assertion lève une exception en cas d'échec.
\set ON_ERROR_STOP on

create function pg_temp.login(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false);
end $$;

create function pg_temp.assert(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'ÉCHEC : %', label; end if;
  raise notice 'ok — %', label;
end $$;

-- Exécute une requête qui DOIT échouer.
create function pg_temp.refuse(q text, label text) returns void language plpgsql as $$
begin
  begin
    execute q;
  exception when others then
    raise notice 'ok — % (refusé : %)', label, sqlerrm;
    return;
  end;
  raise exception 'ÉCHEC : % aurait dû être refusé', label;
end $$;

-- Trois comptes.
insert into auth.users (id, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', '{"display_name": "Alice"}'),
  ('00000000-0000-0000-0000-00000000000b', '{"display_name": "Bruno"}'),
  ('00000000-0000-0000-0000-00000000000c', '{}');

select pg_temp.assert((select count(*) from public.player_profiles) = 3, 'profil créé à l''inscription');
select pg_temp.assert((select display_name from public.player_profiles where id = '00000000-0000-0000-0000-00000000000a') = 'Alice', 'nom repris des métadonnées');
select pg_temp.assert((select count(*) from public.player_statistics) = 3, 'statistiques créées à l''inscription');

-- ---------------------------------------------------------------- RLS : profils
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');

update public.player_profiles set display_name = 'Alice2' where id = auth.uid();
select pg_temp.assert((select display_name from public.player_profiles where id = auth.uid()) = 'Alice2', 'un joueur renomme son profil');

select pg_temp.refuse($$update public.player_profiles set xp = 99999 where id = auth.uid()$$, 'un joueur ne s''attribue pas d''expérience');
select pg_temp.refuse($$update public.player_profiles set achievements = '{noyau}' where id = auth.uid()$$, 'un joueur ne s''attribue pas de succès');
select pg_temp.refuse($$update public.player_statistics set successes = 50 where user_id = auth.uid()$$, 'un joueur ne modifie pas ses statistiques');
select pg_temp.refuse($$insert into public.expedition_results (session_id, user_id, outcome, status, xp_awarded, duration_seconds) values (gen_random_uuid(), auth.uid(), 'succes', 'extrait', 5000, 900)$$, 'un joueur n''insère pas de résultat');
select pg_temp.refuse($$update public.player_profiles set title = 'Dixième occupant' where id = auth.uid()$$, 'titre non débloqué refusé');
select pg_temp.refuse($$update public.player_profiles set color = '#23252b' where id = auth.uid()$$, 'tenue non débloquée refusée');
select pg_temp.refuse($$insert into public.rooms (code, name, host_id, host_name) values ('ABCDE', 'x', auth.uid(), 'x')$$, 'création directe de salon refusée');

update public.player_profiles set display_name = 'Pirate' where id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.assert((select display_name from public.player_profiles where id = '00000000-0000-0000-0000-00000000000b') = 'Bruno', 'un joueur ne modifie pas le profil d''un autre');
select pg_temp.assert((select count(*) from public.player_statistics) = 1, 'statistiques des autres invisibles');

-- ---------------------------------------------------------------- Salons
select public.create_room('ABCDE', 'Nuit 4', 'Alice2', true, 2);
select pg_temp.assert((select count(*) from public.public_rooms where code = 'ABCDE') = 1, 'salon public listé');
select pg_temp.refuse($$select public.create_room('abcde', 'x', 'x', true, 2)$$, 'code de salon invalide refusé');

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.assert((select count(*) from public.join_room('ABCDE')) = 1, 'un invité rejoint le salon');
select pg_temp.assert((select count(*) from public.join_room('ZZZZZ')) = 0, 'salon inconnu : aucune ligne');
select pg_temp.refuse($$select public.touch_room('ABCDE', 'Détourné')$$, 'un invité ne modifie pas le salon');
select pg_temp.refuse($$select public.start_session('ABCDE', 'GRAINE', array[auth.uid()])$$, 'un invité ne lance pas l''expédition');

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.refuse($$select public.join_room('ABCDE')$$, 'salon complet refusé');
select pg_temp.refuse($$select public.touch_room('ABCDE', 'x')$$, 'un non-membre ne touche pas au salon');

-- Salon privé : invisible dans l'annuaire.
select public.create_room('PQRST', 'Privé', 'Charlie', false, 4);
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.assert((select count(*) from public.public_rooms where code = 'PQRST') = 0, 'salon privé absent de l''annuaire');
select pg_temp.assert((select count(*) from public.rooms where code = 'PQRST') = 0, 'salon privé invisible aux non-membres');

-- ---------------------------------------------------------------- Session et récompenses
create temp table t_session (id uuid);
grant all on t_session to authenticated;
insert into t_session select public.start_session('ABCDE', 'GRAINE', array['00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c']::uuid[]);
select pg_temp.assert((select count(*) from public.session_players) = 1, 'un joueur ne voit que sa propre participation');
reset role;
select pg_temp.assert((select count(*) from public.session_players) = 2, 'seuls les membres réels du salon participent');
set role authenticated;
select pg_temp.assert((select status from public.rooms where code = 'ABCDE') = 'playing', 'salon marqué en jeu');

-- Un tiers ne peut pas clore la session.
select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select pg_temp.refuse(format($$select public.finish_session(%L, 'succes', '{P-CORE}', '{}', '{}', '[]')$$, (select id from t_session)), 'un non-participant ne clôt pas la session');

-- Clôture immédiate : la durée mesurée par le serveur est trop courte → lot de base uniquement.
reset role;
create table t_copy as select * from t_session;
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select public.finish_session((select id from t_session), 'succes', '{P-CORE,S-DOCS-5,INCONNU}', '{acc-01,acc-01,<script>}', '{visiteur,dragon}',
  '[{"id":"00000000-0000-0000-0000-00000000000a","status":"extrait"},{"id":"00000000-0000-0000-0000-00000000000b","status":"mort"}]');
select pg_temp.assert((select xp_awarded from public.expedition_results where user_id = auth.uid()) = 40, 'expédition éclair : lot de base, quel que soit le résultat annoncé');
select pg_temp.assert((select xp from public.player_profiles where id = auth.uid()) = 40, 'expérience créditée par le serveur');
select pg_temp.assert((select documents from public.player_profiles where id = auth.uid()) = '{acc-01}', 'documents filtrés et dédoublonnés');
select pg_temp.assert((select creatures from public.player_profiles where id = auth.uid()) = '{visiteur}', 'créatures inconnues ignorées');
select pg_temp.assert((select objectives from public.expedition_results where user_id = auth.uid()) = '{P-CORE,S-DOCS-5}', 'objectifs inconnus ignorés');
select pg_temp.refuse(format($$select public.finish_session(%L, 'succes', '{P-CORE}', '{}', '{}', '[]')$$, (select id from t_session)), 'une session ne se clôt qu''une fois');
select pg_temp.assert((select status from public.rooms where code = 'ABCDE') = 'lobby', 'salon de retour au lobby');

-- Expédition de durée normale : on antidate le début (opération réservée au serveur).
reset role;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
set role authenticated;
truncate t_session;
insert into t_session select public.start_session('ABCDE', 'GRAINE2', array['00000000-0000-0000-0000-00000000000b']::uuid[]);
select pg_temp.refuse(format($$update public.game_sessions set started_at = now() - interval '1 hour' where id = %L$$, (select id from t_session)), 'un joueur n''antidate pas sa session');
reset role;
update public.game_sessions set started_at = now() - interval '20 minutes' where id = (select id from t_session);
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
-- Après changement d'hôte en jeu, un participant peut clore.
select public.finish_session((select id from t_session), 'succes', '{P-CORE,P-MED,S-DOCS-5,S-MARK,S-AUX,S-RELAY}', '{acc-02,med-01}', '{echo}',
  '[{"id":"00000000-0000-0000-0000-00000000000a","status":"extrait"},{"id":"00000000-0000-0000-0000-00000000000b","status":"mort"}]');
-- Bruno (mort) : (620 + 150 + 130 + 120) / 2 + 2 documents × 12 = 534. Un seul principal et trois secondaires comptés.
select pg_temp.assert((select xp_awarded from public.expedition_results where user_id = auth.uid() order by id desc limit 1) = 534, 'barème serveur : joueur mort, moitié des points');
select pg_temp.assert((select deaths from public.player_statistics where user_id = auth.uid()) = 2, 'morts comptées');
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
-- Alice (extraite) : 620 + 150 + 130 + 120 + 24 = 1044, plus les 40 précédents.
select pg_temp.assert((select xp from public.player_profiles where id = auth.uid()) = 1084, 'barème serveur : joueur extrait, points complets');
select pg_temp.assert((select achievements @> '{premiere_sortie,noyau}' from public.player_profiles where id = auth.uid()), 'succès attribués par le serveur');
select pg_temp.assert(not (select achievements @> '{sans_perte}' from public.player_profiles where id = auth.uid()), 'pas de « personne derrière » avec un mort');
select pg_temp.assert((select successes from public.player_statistics where user_id = auth.uid()) = 2, 'réussites comptées');
select pg_temp.assert(public.level_for_xp(1084) = 3, 'niveau recalculé');

-- Le succès « noyau » débloque désormais le titre et la tenue correspondants.
update public.player_profiles set title = 'Dixième occupant', color = '#23252b' where id = auth.uid();
select pg_temp.assert((select title from public.player_profiles where id = auth.uid()) = 'Dixième occupant', 'titre débloqué accepté');

-- Résultats des autres invisibles.
select pg_temp.assert((select count(*) from public.expedition_results) = 2, 'un joueur ne voit que ses résultats');

-- Échec : lot de consolation + moitié des secondaires.
truncate t_session;
insert into t_session select public.start_session('ABCDE', 'GRAINE3', array['00000000-0000-0000-0000-00000000000b']::uuid[]);
reset role;
update public.game_sessions set started_at = now() - interval '10 minutes' where id = (select id from t_session);
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select pg_temp.refuse(format($$select public.finish_session(%L, 'succes', '{S-MARK}', '{}', '{}', '[]')$$, (select id from t_session)), 'réussite sans objectif principal refusée');
select public.finish_session((select id from t_session), 'echec', '{S-MARK}', '{}', '{}', '[{"id":"00000000-0000-0000-0000-00000000000a","status":"mort"}]');
select pg_temp.assert((select xp_awarded from public.expedition_results where user_id = auth.uid() order by id desc limit 1) = 110, 'échec : 60 + moitié des secondaires');
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select pg_temp.assert((select xp_awarded from public.expedition_results where user_id = auth.uid() order by id desc limit 1) = 0, 'joueur absent du rapport : abandon, aucune récompense');

-- ---------------------------------------------------------------- Reprise d'hôte et fermeture
select pg_temp.refuse($$select public.touch_room('ABCDE', 'x')$$, 'reprise d''hôte refusée tant que l''hôte est actif');
reset role;
update public.rooms set updated_at = now() - interval '1 minute' where code = 'ABCDE';
set role authenticated;
select public.touch_room('ABCDE', null, null, null, 1, null, 'Bruno');
select pg_temp.assert((select host_id from public.rooms where code = 'ABCDE') = auth.uid(), 'un membre reprend le salon d''un hôte disparu');
select public.close_room('ABCDE');
select pg_temp.assert((select count(*) from public.rooms where code = 'ABCDE') = 0, 'l''hôte ferme le salon');

-- Expiration.
reset role;
update public.rooms set expires_at = now() - interval '1 second' where code = 'PQRST';
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select public.create_room('FGHJK', 'Nouveau', 'Bruno', true, 6);
reset role;
select pg_temp.assert((select count(*) from public.rooms where code = 'PQRST') = 0, 'les salons expirés sont purgés');

-- Anonyme : rien.
set role anon;
select pg_temp.login(null);
select pg_temp.refuse($$select * from public.player_profiles$$, 'un visiteur anonyme ne lit pas les profils');
select pg_temp.refuse($$select public.create_room('LMNPQ', 'x', 'x', true, 2)$$, 'un visiteur anonyme ne crée pas de salon');
reset role;

select 'TOUS LES SCÉNARIOS SQL SONT PASSÉS' as resultat;
