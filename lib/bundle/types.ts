import type { BoardDoc } from "@/lib/board-doc";

/*
 * The bundle — docs/plan.md §3a.
 *
 * One JSON document that contains everything a screen needs to run for months
 * without the network: board definitions, resolved content with a 30–60 day
 * lookahead, 90 days of zmanim, asset URLs, theme tokens.
 *
 * TWO SHAPES, AND THE SPLIT IS LOAD-BEARING.
 *
 * `BundlePayload` is what gets hashed and stored. It contains only things that
 * come from content. `BundleEnvelope` is what the endpoint serves: the payload
 * plus the version, the hash and the build time.
 *
 * `builtAt` is deliberately NOT in the payload. Put it there and the hash
 * changes on every build, `version` bumps on every build, every screen refetches
 * a bundle identical to the one it already has, and §10's whole argument for
 * cheap over-invalidation collapses. The one field in the wrong object would
 * turn a spurious rebuild from free into a cross-fade on every screen in the
 * shul.
 */

/** A board, as the display renders it. */
export type BundleBoard = {
  id: string;
  name: string;
  doc: BoardDoc;
};

/** What the screen shows and for how long. A screen points at a playlist, never
 *  at a board (§1) — even a shul with one board has a playlist of one. */
export type BundlePlaylistItem = {
  boardId: string;
  position: number;
  durationSeconds: number;
};

/**
 * An asset the board references, as a media-proxy path (§6).
 *
 * NEVER A SIGNED URL. A signature carries an expiry and this document is stored:
 * a bundle built on Monday with a 24-hour signature serves dead image links on
 * Wednesday to a screen that is perfectly online, because the content hash has
 * not changed and nothing triggers a rebuild. Proxy paths do not expire, so a
 * bundle stays valid exactly as long as its content does.
 */
export type BundleAsset = {
  id: string;
  /** `/m/<asset_id>/<variant>-<hash>.<ext>` — immutable, so re-processing an
   *  asset is a cache miss rather than a stale hit. */
  url: string;
  variant: string;
  contentType: string;
  bytes: number;
};

export type BundleContent = {
  announcements: unknown[];
  schedules: unknown[];
  /** Birthdays and yahrzeits, 60 days out. */
  people: unknown[];
  /** Calendar events, 30 days out. */
  events: unknown[];
  /** 90 days of resolved zmanim, keyed by date. §3b: the screen only needs to
   *  reconnect sometime within three months. */
  zmanim: Record<string, unknown>;
};

export type BundlePayload = {
  screen: {
    id: string;
    name: string;
    canvas: { width: number; height: number };
    orientation: string;
    timezone: string | null;
    hebrewPrefs: Record<string, unknown>;
  };
  theme: Record<string, unknown>;
  playlist: { id: string; name: string; items: BundlePlaylistItem[] } | null;
  boards: BundleBoard[];
  content: BundleContent;
  /** Every asset the boards reference, already resolved to proxy paths. The
   *  display caches all of these before it is allowed to swap to this bundle. */
  assets: BundleAsset[];
};

export type BundleEnvelope = BundlePayload & {
  bundleVersion: number;
  contentHash: string;
  builtAt: string;
  ttlSeconds: number;
};

/** What a screen POSTs every 60 seconds (§3e). */
export type HeartbeatBody = {
  bundleVersion?: number | null;
  boardId?: string | null;
  appVersion?: string | null;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
  uptimeSeconds?: number | null;
  errorCount?: number | null;
  lastError?: string | null;
};
