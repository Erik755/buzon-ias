#!/usr/bin/env bash
# Pruebas negativas contra un Supabase LOCAL (supabase start). Todo corre en una transacción que se deshace.
# Uso: DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres ./tests/run-supabase.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
case "$DB_URL" in *127.0.0.1*|*localhost*) ;; *) echo "Solo se permite un Supabase local" >&2; exit 1;; esac
{ echo 'begin;'; cat tests/sql/pruebas_negativas.sql tests/sql/pruebas_v2.sql; echo 'rollback;'; } \
  | psql -q -X -v ON_ERROR_STOP=1 "$DB_URL" 2>&1 | sed 's/^psql:.*NOTICE:  /  /' | tee /tmp/sql.log
grep -q TODAS_LAS_PRUEBAS_PASARON /tmp/sql.log
echo "Pruebas SQL: $(grep -c '  OK ' /tmp/sql.log) OK"
