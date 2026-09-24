import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A test that needs its own build (different NEXT_PUBLIC_* values, which are
  // inlined at build time) builds into its own folder rather than replacing
  // the one every other test runs against — scripts/with-mock-supabase.mjs.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default nextConfig;
