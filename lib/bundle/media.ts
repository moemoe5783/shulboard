/*
 * Media proxy paths — docs/schema.md §6.
 *
 * Its own module so it can be imported without a bundler: everything else in the
 * bundle's assembly reaches the widget registry, which resolves its folder
 * through require.context and only exists inside a build.
 */

/** A row from `assets`, as much of it as a path needs. */
export type AssetPathParts = {
  id: string;
  variant: string;
  content_hash: string;
  extension: string;
};

/**
 * `/m/<asset_id>/<variant>-<hash>.<ext>`
 *
 * IMMUTABLE BY CONSTRUCTION. A given triple names one byte sequence for all
 * time, so the proxy serves it `max-age=31536000, immutable` and re-processing
 * an asset changes the path rather than the contents — a cache miss rather than
 * a stale hit. There is no invalidation step and no purge to forget.
 *
 * NEVER A SIGNED URL. A signature carries an expiry and the bundle is stored: a
 * bundle built on Monday with a 24-hour signature serves dead image links on
 * Wednesday to a screen that is perfectly online, because the content hash has
 * not changed and nothing triggers a rebuild. The screen would show broken
 * images while every part of the system reported healthy.
 */
export function mediaProxyPath(asset: AssetPathParts): string {
  return `/m/${asset.id}/${asset.variant}-${asset.content_hash}.${asset.extension}`;
}

/** Split `<variant>-<hash>.<extension>` back apart. Splits on the LAST `-` and
 *  `.` rather than matching a fixed charset, because the variant and hash
 *  vocabularies are ours to grow and a regex would need updating in step with
 *  them. Malformed input fails downstream instead — nothing here needs to
 *  validate a shape it does not otherwise care about. */
export function parseVariantFile(
  file: string,
): { variant: string; contentHash: string; extension: string } | null {
  const dot = file.lastIndexOf(".");
  if (dot <= 0 || dot === file.length - 1) return null;
  const stem = file.slice(0, dot);
  const extension = file.slice(dot + 1);

  const dash = stem.lastIndexOf("-");
  if (dash <= 0 || dash === stem.length - 1) return null;

  return { variant: stem.slice(0, dash), contentHash: stem.slice(dash + 1), extension };
}

/** One generated derivative of an asset, as stored in `assets.variants` --
 *  jsonb keyed by variant name, per schema.md §6. */
export type AssetVariant = {
  storagePath: string;
  contentHash: string;
  extension: string;
  contentType: string;
  bytes: number;
};

/**
 * Pull one named variant out of an asset row's `variants` jsonb.
 *
 * THE ONE PLACE THIS SHAPE IS PARSED. Both the bundle builder (lib/bundle/build.ts,
 * choosing which variant a board embeds) and the media proxy route (validating
 * a request against what is actually on file) read through this function, so
 * they cannot drift into disagreeing about what a variant looks like. Returns
 * null for a variant that has not been generated yet or whose stored shape
 * does not match — either way, the caller treats it as "not available," never
 * as a reason to fail outright.
 */
export function readAssetVariant(variants: unknown, variant: string): AssetVariant | null {
  if (typeof variants !== "object" || variants === null) return null;

  const entry = (variants as Record<string, unknown>)[variant];
  if (typeof entry !== "object" || entry === null) return null;
  const v = entry as Record<string, unknown>;

  if (
    typeof v.storage_path !== "string" ||
    typeof v.content_hash !== "string" ||
    typeof v.extension !== "string" ||
    typeof v.content_type !== "string" ||
    typeof v.bytes !== "number"
  ) {
    return null;
  }

  return {
    storagePath: v.storage_path,
    contentHash: v.content_hash,
    extension: v.extension,
    contentType: v.content_type,
    bytes: v.bytes,
  };
}
