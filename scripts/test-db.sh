#!/usr/bin/env bash
# Boot a throwaway Postgres, apply every migration in order, then run the SQL
# tests in supabase/tests. Nothing here touches a real Supabase project.
#
# Requires a local PostgreSQL 15+ install. On Debian/Ubuntu:
#   apt-get install postgresql-16
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${PGPORT:-55432}"
WORKDIR="${PGTMP:-$(mktemp -d)}"
DBNAME=shulboard_test

if [ ! -x "$PGBIN/initdb" ]; then
  echo "no postgres install found; set PGBIN to a postgres bin directory" >&2
  exit 1
fi

cleanup() {
  "$PGBIN/pg_ctl" -D "$WORKDIR/data" -m immediate stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$PGBIN/initdb" -D "$WORKDIR/data" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$WORKDIR/data" \
  -o "-k $WORKDIR -p $PORT -c listen_addresses=" \
  -l "$WORKDIR/pg.log" start >/dev/null

PSQL=("$PGBIN/psql" -h "$WORKDIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -d postgres -c "create database $DBNAME" >/dev/null
"${PSQL[@]}" -d "$DBNAME" -f "$ROOT/scripts/local-supabase-shim.sql" >/dev/null

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$f")"
  "${PSQL[@]}" -d "$DBNAME" -f "$f" >/dev/null
done

# Committed once, outside any transaction, so each test file can use it. The test
# files roll back, so the log starts empty for every one of them.
"${PSQL[@]}" -d "$DBNAME" -f "$ROOT/scripts/test-helpers.sql" >/dev/null

shopt -s nullglob
tests=("$ROOT"/supabase/tests/*.sql)
if [ ${#tests[@]} -eq 0 ]; then
  echo "no tests in supabase/tests" >&2
  exit 1
fi
for f in "${tests[@]}"; do
  echo "running $(basename "$f")"
  "${PSQL[@]}" -d "$DBNAME" -f "$f"
done
