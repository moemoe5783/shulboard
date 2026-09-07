#!/usr/bin/env bash
# Fails if lib/database.types.ts has drifted from supabase/migrations.
#
# Regenerates the types with the same process that produced the committed
# file, then diffs. This is what would have caught build.ts querying columns
# that don't exist on `assets` before it shipped: PostgREST returns `any`, so
# typecheck cannot see a wrong column name, but a generator run against the
# real migrations can.
#
# Run with: npm run test:db-types
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMPDIR="$(mktemp -d)"
TMP_OUT="$TMPDIR/database.types.ts"

bash "$ROOT/scripts/generate-db-types.sh" "$TMP_OUT" >/dev/null

if diff -u "$ROOT/lib/database.types.ts" "$TMP_OUT"; then
  echo "lib/database.types.ts matches supabase/migrations."
  rm -rf "$TMPDIR"
else
  echo "" >&2
  echo "lib/database.types.ts is out of date with supabase/migrations." >&2
  echo "Run: bash scripts/generate-db-types.sh" >&2
  rm -rf "$TMPDIR"
  exit 1
fi
