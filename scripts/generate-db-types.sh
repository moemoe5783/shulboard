#!/usr/bin/env bash
# Generate lib/database.types.ts from the migrations in supabase/migrations,
# against a throwaway local Postgres -- never against a real Supabase project.
#
# Usage: scripts/generate-db-types.sh [output-path]
# Defaults to lib/database.types.ts. scripts/check-db-types.sh calls this with
# a temp path and diffs it against the committed file to catch drift.
#
# Requires a local PostgreSQL 15+ install, same as test-db.sh. On Debian/Ubuntu:
#   apt-get install postgresql-16
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$ROOT/lib/database.types.ts}"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${PGPORT:-55433}"
WORKDIR="${PGTMP:-$(mktemp -d)}"
DBNAME=shulboard_types
TMP_OUT="$WORKDIR/database.types.ts"

if [ ! -x "$PGBIN/initdb" ]; then
  echo "no postgres install found; set PGBIN to a postgres bin directory" >&2
  exit 1
fi

WORKER="$ROOT/scripts/generate-db-types-worker.sh"

# initdb refuses to run as root, and the generated file has to land back in
# the repo, which the postgres OS user cannot write to. So the Postgres half
# runs as postgres (like test-db.sh) and writes into $WORKDIR, which IS
# writable by it; this script -- still running as whoever invoked it --
# copies the result into place afterward. Not `exec`, deliberately: this
# process has to get control back to do that copy.
if [ "$(id -u)" -eq 0 ] && id postgres >/dev/null 2>&1 && command -v runuser >/dev/null; then
  chown postgres "$WORKDIR"
  runuser -u postgres -- \
    env PGTMP="$WORKDIR" PGBIN="$PGBIN" PGPORT="$PORT" ROOT="$ROOT" DBNAME="$DBNAME" TMP_OUT="$TMP_OUT" \
    bash "$WORKER"
else
  PGTMP="$WORKDIR" PGBIN="$PGBIN" PGPORT="$PORT" ROOT="$ROOT" DBNAME="$DBNAME" TMP_OUT="$TMP_OUT" \
    bash "$WORKER"
fi

mkdir -p "$(dirname "$OUT")"
cp "$TMP_OUT" "$OUT"
rm -rf "$WORKDIR"
echo "wrote $OUT"
