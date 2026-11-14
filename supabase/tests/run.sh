#!/usr/bin/env bash
# Teste les migrations sur un PostgreSQL local jetable (aucun projet Supabase requis).
# Usage : npm run test:sql      (nécessite initdb/pg_ctl/psql ; variable PG_BIN pour leur dossier)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/initdb 2>/dev/null | tail -1)")}"
WORK="$(mktemp -d)"
PORT="${PGTEST_PORT:-54329}"
RUN=()
if [ "$(id -u)" = "0" ]; then
  # PostgreSQL refuse de tourner en root : on passe par l'utilisateur postgres.
  chown -R postgres "$WORK"
  cp -r "$ROOT/supabase" "$WORK/sql" && chown -R postgres "$WORK/sql"
  RUN=(runuser -u postgres --)
else
  cp -r "$ROOT/supabase" "$WORK/sql"
fi
cleanup() { "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
"${RUN[@]}" "$PG_BIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
"${RUN[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -c listen_addresses='' -k $WORK" -w start >/dev/null
PSQL=("${RUN[@]}" "$PG_BIN/psql" -h "$WORK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -c "create database nocturne_test" postgres
"${PSQL[@]}" -c "create extension if not exists pgcrypto" nocturne_test
"${PSQL[@]}" -f "$WORK/sql/tests/00_stub_supabase.sql" nocturne_test
for f in "$WORK"/sql/migrations/*.sql; do "${PSQL[@]}" -f "$f" nocturne_test; done
OUT="$("${PSQL[@]}" -f "$WORK/sql/tests/01_scenarios.sql" nocturne_test 2>&1 || true)"
echo "$OUT" | grep -E "ok —|ÉCHEC|ERROR|ERREUR|TOUS LES" | sed -E 's/^psql:[^ ]+: //'
# Le script échoue si le dernier scénario n'a pas été atteint.
echo "$OUT" | grep -q "TOUS LES SCÉNARIOS SQL SONT PASSÉS"
