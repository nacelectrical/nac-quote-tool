#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# THE TEST DATABASE
#
# Brings up a local PostgreSQL carrying NAC's real schema, so the quote
# endpoints can be tested against a database rather than against a stub. It is
# idempotent: run it as often as you like.
#
#   tools/test-db.sh up      start it, creating and loading it if it is new
#   tools/test-db.sh down    stop it
#   tools/test-db.sh status  say whether it is running
#   tools/test-db.sh reset   drop every row, keep the schema
#
# tests/helpers/pg-rest.mjs calls `up` by itself, so `node --test tests/*.test.mjs`
# needs nothing done first. The suites skip, with a reason, if PostgreSQL is not
# installed at all.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
PGDIR=${NAC_PGDIR:-/var/lib/postgresql/nacpg}
SOCK=${NAC_PGSOCK:-/var/run/nacpg}
PORT=${NAC_PGPORT:-5433}
DB=nacquote
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

have_pg() { [ -x "$PGBIN/initdb" ]; }
running() { "$PGBIN/pg_isready" -h "$SOCK" -p "$PORT" -q 2>/dev/null; }
psq() { PGHOST="$SOCK" PGPORT="$PORT" PGUSER=postgres "$PGBIN/psql" "$@"; }

up() {
  have_pg || { echo "PostgreSQL is not installed — the database suites will skip."; exit 0; }
  running && { echo "already running on $SOCK:$PORT"; exit 0; }

  mkdir -p "$SOCK"; chown postgres:postgres "$SOCK"
  if [ ! -f "$PGDIR/PG_VERSION" ]; then
    mkdir -p "$PGDIR"; chown -R postgres:postgres "$(dirname "$PGDIR")" "$PGDIR"; chmod 700 "$PGDIR"
    su postgres -c "$PGBIN/initdb -D $PGDIR -U postgres --auth=trust -E UTF8" >/dev/null
  fi
  su postgres -c "$PGBIN/pg_ctl -D $PGDIR \
    -o '-p $PORT -k $SOCK -c listen_addresses=' -l $PGDIR/server.log start" >/dev/null
  for _ in $(seq 1 30); do running && break; sleep 0.3; done
  running || { echo "could not start PostgreSQL; see $PGDIR/server.log"; exit 1; }

  if ! psq -lqt | cut -d'|' -f1 | grep -qw "$DB"; then
    psq -q -c "create database $DB"
    # The schema the application actually ships.
    psq -d "$DB" -q -f "$ROOT/designer/schema.sql"
    psq -d "$DB" -q -f "$ROOT/designer/quote-presentation-schema.sql"
    # nac_settings predates these scripts and lives in NAC's project already;
    # the shape here is the one store.mjs reads and writes.
    psq -d "$DB" -q -c "create table if not exists public.nac_settings (
      key text primary key, value text, updated_at timestamptz default now());
      alter table public.nac_settings enable row level security;"
    echo "created $DB with designer/schema.sql and quote-presentation-schema.sql"
  fi
  echo "ready on $SOCK:$PORT/$DB"
}

case "${1:-up}" in
  up)     up ;;
  down)   have_pg && su postgres -c "$PGBIN/pg_ctl -D $PGDIR -m fast stop" >/dev/null 2>&1 || true
          echo "stopped" ;;
  status) running && echo "running on $SOCK:$PORT" || echo "not running" ;;
  reset)  psq -d "$DB" -q -c "truncate public.nac_quote_issues, public.nac_designs,
            public.nac_presentation_content, public.nac_settings" && echo "emptied" ;;
  *)      echo "usage: tools/test-db.sh [up|down|status|reset]"; exit 2 ;;
esac
