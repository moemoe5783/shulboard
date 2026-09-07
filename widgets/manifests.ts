import type { WidgetManifest } from "./types";

/*
 * Every widget's manifest, collected by looking rather than by listing.
 *
 * plan.md §5: "Adding widget #26 should mean creating one folder and nothing
 * else." A hand-maintained array here would break that on the first widget
 * somebody forgets to add — and the symptom is a widget that exists, works, and
 * is simply absent from the add menu, which is a confusing afternoon.
 *
 * require.context is a bundler feature: it resolves the glob at build time, so
 * every match is a static import as far as the bundle is concerned. Verified
 * against Turbopack, which is what `next build` uses here.
 *
 * NO "use client" IN THIS FILE, deliberately. Manifests are data — ids, sizes,
 * zod schemas, dataNeeds — and the bundle builder reads them on the server to
 * work out what to fetch. Marking this client would turn every manifest into a
 * client reference the server could not read. The renderers are collected
 * separately, in widgets/renderers.ts, for exactly that reason.
 */

declare const require: {
  context(
    directory: string,
    useSubdirectories: boolean,
    regExp: RegExp,
  ): { keys(): string[]; (id: string): { manifest?: WidgetManifest<never> } };
};

const context = require.context("./", true, /^\.\/[a-z0-9-]+\/manifest\.ts$/);

export const WIDGET_MANIFESTS: WidgetManifest<never>[] = context
  .keys()
  .map((key) => context(key).manifest)
  .filter((manifest): manifest is WidgetManifest<never> => Boolean(manifest))
  .sort((a, b) => a.name.localeCompare(b.name));

const byId = new Map(WIDGET_MANIFESTS.map((manifest) => [manifest.id, manifest]));

/** Undefined for a widget type this build does not have — a board written by a
 *  newer version, or one whose widget was removed. Callers must handle it: a
 *  screen in a lobby does not get to throw. */
export function getManifest(id: string): WidgetManifest<never> | undefined {
  return byId.get(id);
}

/**
 * A widget's default settings.
 *
 * Straight from the schema, because every field carries a `.default()`. There is
 * deliberately no separate defaults object to fall out of step with it.
 */
export function defaultConfig(manifest: WidgetManifest<never>): Record<string, unknown> {
  return manifest.settingsSchema.parse({}) as Record<string, unknown>;
}
