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

  # ── ALREADY RUNNING IS NOT ALREADY MIGRATED ──────────────────────────────
  #
  # This used to `exit 0` here, which skipped the schema load below as well. A
  # container whose server was already up therefore never picked up a new
  # migration, and the suites written against the new table failed on missing
  # data — a test-harness problem that reads exactly like a product defect.
  if running; then
    echo "already running on $SOCK:$PORT"
  else
    mkdir -p "$SOCK"; chown postgres:postgres "$SOCK"
    if [ ! -f "$PGDIR/PG_VERSION" ]; then
      mkdir -p "$PGDIR"; chown -R postgres:postgres "$(dirname "$PGDIR")" "$PGDIR"; chmod 700 "$PGDIR"
      su postgres -c "$PGBIN/initdb -D $PGDIR -U postgres --auth=trust -E UTF8" >/dev/null
    fi
    su postgres -c "$PGBIN/pg_ctl -D $PGDIR \
      -o '-p $PORT -k $SOCK -c listen_addresses=' -l $PGDIR/server.log start" >/dev/null
    for _ in $(seq 1 30); do running && break; sleep 0.3; done
    running || { echo "could not start PostgreSQL; see $PGDIR/server.log"; exit 1; }
  fi

  if ! psq -lqt | cut -d'|' -f1 | grep -qw "$DB"; then
    psq -q -c "create database $DB"
    echo "created $DB"
  fi

  # ── THE SCHEMA IS APPLIED EVERY TIME, NOT ONLY ON CREATION ───────────────
  #
  # It used to be loaded inside the `if` above, which meant a database created
  # before a new migration existed never got it: the suites then ran against a
  # template missing the table they were written for and failed on an assertion
  # about missing data, which reads as a product defect and is not one.
  #
  # Every file here is `create table if not exists`, so re-applying is a no-op
  # on a database that already has them.
  psq -d "$DB" -q -f "$ROOT/designer/schema.sql"
  psq -d "$DB" -q -f "$ROOT/designer/quote-presentation-schema.sql"
  psq -d "$DB" -q -f "$ROOT/designer/enquiries-handovers-schema.sql"
  # nac_settings and nac_quotes predate these scripts and live in NAC's project
  # already; the shapes here are the ones store.mjs and api/intake-submit.js
  # read and write. nac_quotes matters for the enquiry suites: every enquiry
  # NAC took before nac_enquiries existed is a row in it whose notes begin
  # `INTAKE DRAFT`, and /api/enquiries reads those in place.
  psq -d "$DB" -q -c "create table if not exists public.nac_settings (
    key text primary key, value text, updated_at timestamptz default now());
    alter table public.nac_settings enable row level security;
    create table if not exists public.nac_quotes (
      id text primary key, client text, job_desc text, line_items text, notes text,
      accepted boolean default false, customer_id text, job_ref text,
      created_at timestamptz default now(), updated_at timestamptz default now());
    create table if not exists public.nac_staff_roles (
      user_email text primary key, role text not null, note text,
      created_at timestamptz default now());"
  echo "ready on $SOCK:$PORT/$DB"
}

case "${1:-up}" in
  up)     up ;;
  down)   have_pg && su postgres -c "$PGBIN/pg_ctl -D $PGDIR -m fast stop" >/dev/null 2>&1 || true
          echo "stopped" ;;
  status) running && echo "running on $SOCK:$PORT" || echo "not running" ;;
  reset)  psq -d "$DB" -q -c "truncate public.nac_quote_issues, public.nac_designs,
            public.nac_presentation_content, public.nac_settings,
            public.nac_enquiries, public.nac_handovers, public.nac_quotes,
            public.nac_staff_roles" && echo "emptied" ;;
  *)      echo "usage: tools/test-db.sh [up|down|status|reset]"; exit 2 ;;
esac
