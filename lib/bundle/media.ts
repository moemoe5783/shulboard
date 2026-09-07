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
