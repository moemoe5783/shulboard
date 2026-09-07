#!/usr/bin/env node
/**
 * Introspect a live Postgres and print the Supabase-shaped `Database` type to
 * stdout.
 *
 * `@supabase/postgrest-typegen` is the actual generator behind
 * `supabase gen types typescript` — extracted from postgres-meta into a
 * driver-agnostic library — used directly here because the CLI's own
 * `gen types` command shells out to a Docker container for this step, and
 * this environment has no Docker daemon. Same generator, same output shape,
 * no container.
 *
 * Not meant to be run by hand — see scripts/generate-db-types.sh, which
 * boots the throwaway Postgres this connects to.
 */

import { Pool } from "pg";
import { generateTypescript, sortGeneratorMetadata } from "@supabase/postgrest-typegen/generation";
import { introspect } from "@supabase/postgrest-typegen/introspection";

const dbUrl = process.argv[2];
if (!dbUrl) {
  console.error("usage: run-postgrest-typegen.mjs <postgres-url>");
  process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl });
try {
  const metadata = await introspect(pool, { includedSchemas: ["public"] });
  const types = await generateTypescript(sortGeneratorMetadata(metadata), {
    defaultSchema: "public",
  });
  process.stdout.write(types);
} finally {
  await pool.end();
}
