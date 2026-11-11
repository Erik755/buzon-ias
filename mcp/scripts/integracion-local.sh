#!/usr/bin/env bash
# Prueba de integración del cliente del panel Forge contra el servidor MCP del repo,
# TODO EN LOCAL: Postgres desechable en /tmp + migraciones del repo + servidor MCP en
# 127.0.0.1 con rpcPg. Nunca toca producción ni necesita credenciales.
# Uso: cd mcp && npm ci && ./scripts/integracion-local.sh
set -euo pipefail
cd "$(dirname "$0")/.."
# Binarios del servidor: PostgreSQL >= 15 (las migraciones usan security_invoker;
# supabase/config.toml apunta a la 17). Se busca en el sistema y en paquetes PGDG
# extraídos sin root (apt-get download postgresql-17 && dpkg -x *.deb /tmp/pgsrv17),
# eligiendo la versión más alta que tenga initdb.
PGBIN=""
for d in $(ls -d /usr/lib/postgresql/*/bin /tmp/pgsrv*/usr/lib/postgresql/*/bin 2>/dev/null | sed 's/.*postgresql\/\([0-9]*\)\/bin/\1 &/' | sort -rn | cut -d' ' -f2); do
  if [ -x "$d/initdb" ]; then
    case $("$d/postgres" --version) in *' 15.'*|*' 16.'*|*' 17.'*|*' 18.'*) PGBIN=$d; break;; esac
  fi
done
if [ -z "$PGBIN" ]; then echo "No encuentro initdb de PostgreSQL >= 15 (instala postgresql-15/16/17 o extráelo en /tmp/pgsrvNN)"; exit 1; fi
export LD_LIBRARY_PATH="$(dirname "$PGBIN")/../../x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PGDATA=/tmp/buzon-int-pgdata PGHOST=/tmp/buzon-int-sock PGPORT=55433 PGUSER=postgres
rm -rf "$PGDATA" "$PGHOST"; mkdir -p "$PGHOST"
"$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust --encoding=UTF8 --locale=C.UTF-8 >/dev/null
"$PGBIN/pg_ctl" -D "$PGDATA" -l /tmp/buzon-int-pg.log -o "-k $PGHOST -p $PGPORT" -w start >/dev/null
trap '"$PGBIN/pg_ctl" -D "$PGDATA" stop -m fast >/dev/null 2>&1 || true' EXIT
node --test test/integracion-panel.test.js
