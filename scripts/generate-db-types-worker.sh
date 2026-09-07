#!/usr/bin/env bash
# The half of type generation that has to run as the postgres OS user --
# initdb refuses to run as root. Not meant to be invoked directly; see
# generate-db-types.sh, which sets every variable this reads and copies the
# result back into the repo afterward (a step this half cannot do itself,
# since the postgres user cannot write there).
set -euo pipefail

: "${PGTMP:?}" "${PGBIN:?}" "${PGPORT:?}" "${ROOT:?}" "${DBNAME:?}" "${TMP_OUT:?}"

cleanup() {
  "$PGBIN/pg_ctl" -D "$PGTMP/data" -m immediate stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

"$PGBIN/initdb" -D "$PGTMP/data" -U postgres --auth=trust >/dev/null
# TCP too, not just the unix socket test-db.sh relies on -- the supabase CLI
# connects with a postgresql:// URL.
"$PGBIN/pg_ctl" -D "$PGTMP/data" \
  -o "-k $PGTMP -p $PGPORT -c listen_addresses=127.0.0.1" \
  -l "$PGTMP/pg.log" start >/dev/null

PSQL=("$PGBIN/psql" -h "$PGTMP" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -d postgres -c "create database $DBNAME" >/dev/null
"${PSQL[@]}" -d "$DBNAME" -f "$ROOT/scripts/local-supabase-shim.sql" >/dev/null

for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -d "$DBNAME" -f "$f" >/dev/null
done

node "$ROOT/scripts/run-postgrest-typegen.mjs" \
  "postgresql://postgres@127.0.0.1:$PGPORT/$DBNAME" \
  > "$TMP_OUT"
