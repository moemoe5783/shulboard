/**
 * A stand-in for Vercel's request context, for a local `next start` under
 * test: @vercel/functions' addCacheTag and purge calls land here and are
 * appended, one JSON line each, to the file named by FAKE_VERCEL_LOG.
 *
 * Loaded with NODE_OPTIONS=--import=./scripts/fake-vercel-context.mjs by
 * scripts/test-dashboard.mjs. Never part of a real deployment.
 */
import { appendFileSync } from "node:fs";

const log = process.env.FAKE_VERCEL_LOG;
const write = (entry) => {
  if (log) appendFileSync(log, `${JSON.stringify(entry)}\n`);
};

globalThis[Symbol.for("@vercel/request-context")] = {
  get: () => ({
    addCacheTag: async (tag) => write({ addCacheTag: tag }),
    purge: {
      dangerouslyDeleteByTag: async (tags) => write({ purge: [].concat(tags) }),
      invalidateByTag: async (tags) => write({ invalidate: [].concat(tags) }),
    },
  }),
};
