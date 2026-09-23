import { backgroundAssetId, libraryBackground, type BoardBackground } from "../board-background.ts";
import type { BoardDoc } from "../board-doc.ts";
import type { AssetRow } from "./assemble.ts";
import { mediaProxyPath } from "./media.ts";
import type { BundleAsset } from "./types.ts";

/*
 * A board's background in the bundle — the board-level twin of the widgets'
 * asset handling in ./assemble.ts, kept in its own module (no registry, no path
 * aliases) so scripts/test-backgrounds.ts can run it directly.
 */

/** The Media photo a board's background shows, if it shows one. */
export function boardBackgroundAssetId(doc: Pick<BoardDoc, "background">): string | null {
  const value = (doc.background as BoardBackground).value;
  return typeof value === "string" ? backgroundAssetId(value) : null;
}

/**
 * Point a board's background photo at its media-proxy path. The editor stored
 * a preview path when the photo was picked; the build re-resolves it from the
 * asset id, so a re-processed photo is a new URL. A photo that's gone (deleted,
 * not processed) loses its `src` and the board falls back to its plain ground,
 * rather than pointing a TV at a URL that 404s.
 */
export function resolveBoardBackground<T extends Pick<BoardDoc, "background">>(doc: T, assets: Map<string, AssetRow>): T {
  const assetId = boardBackgroundAssetId(doc);
  if (!assetId) return doc;
  const asset = assets.get(assetId);
  const rest: Record<string, unknown> = { ...doc.background };
  delete rest.src;
  return { ...doc, background: asset ? { ...rest, src: mediaProxyPath(asset) } : rest };
}

/**
 * The files the boards' backgrounds need cached before a swap: a Media photo
 * at its full-screen size, or a library picture (a static file under
 * /backgrounds/). Without them a screen offline would boot to a bare ground.
 * `seenUrls` is shared with the caller so nothing is listed twice.
 */
export function backgroundBundleAssets(
  docs: Pick<BoardDoc, "background">[],
  assets: Map<string, AssetRow>,
  seenUrls: Set<string>,
): BundleAsset[] {
  const out: BundleAsset[] = [];
  for (const doc of docs) {
    const background = doc.background as BoardBackground;
    const value = typeof background.value === "string" ? background.value : "";
    const library = libraryBackground(value);
    const assetId = backgroundAssetId(value);
    const url = library ? library.src : assetId ? background.src : undefined;
    if (typeof url !== "string" || !url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const photo = assetId ? assets.get(assetId) : undefined;
    out.push({
      id: library ? `library:${library.id}` : (photo?.id ?? value),
      url,
      variant: library ? "library" : (photo?.variant ?? "large"),
      contentType: photo?.content_type ?? "image/webp",
      bytes: photo?.bytes ?? 0,
    });
  }
  return out.sort((a, b) => a.url.localeCompare(b.url));
}
