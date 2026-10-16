#!/usr/bin/env bash
# Corre migraciones + pruebas negativas en un Postgres local desechable.
# Uso: PGHOST=... PGPORT=... PGUSER=postgres ./tests/run-local.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=buzon_test_$$
psql -q -v ON_ERROR_STOP=1 -d postgres -c "create database $DB"
trap 'psql -q -d postgres -c "drop database if exists $DB" >/dev/null' EXIT
P="psql -q -X -v ON_ERROR_STOP=1 -d $DB"
$P -f tests/local/00_supabase_shim.sql
for f in supabase/migrations/*.sql; do $P -f "$f"; done
cat tests/sql/pruebas_negativas.sql tests/sql/pruebas_v2.sql | $P 2>&1 | sed 's/^psql:.*NOTICE:  /  /'
