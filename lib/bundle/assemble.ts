import { parseBoardDoc, type BoardWidget } from "@/lib/board-doc";
import { dedupeDataNeeds } from "@/widgets/data-needs";
import { getManifest } from "@/widgets/manifests";
import type { DataNeed } from "@/widgets/types";
import { mediaProxyPath } from "./media";
import type { BundleAsset, BundleBoard, BundleContent, BundlePayload } from "./types";

/*
 * Turning rows into a bundle. PURE — no database, no clock, no network.
 *
 * Separated from the build job on purpose. The job's interesting behaviour is
 * transactional (build in memory, hash, write only if changed, clear the flag
 * only if unchanged) and needs a database to exercise. Everything else — which
 * assets a board references, what the payload looks like, whether two builds of
 * the same content hash the same — is a function, and a function can be tested
 * without infrastructure.
 */

/** A row from `assets`, as much of it as the bundle needs. */
export type AssetRow = {
  id: string;
  variant: string;
  content_hash: string;
  extension: string;
  content_type: string;
  bytes: number;
};

export type AssembleInput = {
  screen: {
    id: string;
    name: string;
    canvas_width: number;
    canvas_height: number;
    orientation: string;
    timezone: string | null;
    /** Already resolved screen-or-org by the caller — see BundlePayload's own
     *  `latitude`/`longitude` comment. */
    latitude: number | null;
    longitude: number | null;
    hebrew_prefs: Record<string, unknown>;
    /** Already resolved screen-or-org by the caller, same tier as above —
     *  see BundlePayload's own comment on these two. */
    zmanim_provider: "hebcal" | "chabad" | "myzmanim" | "manual";
    has_chabad_location: boolean;
  };
  theme: Record<string, unknown>;
  playlist: { id: string; name: string } | null;
  playlistItems: { board_id: string; position: number; duration_seconds: number }[];
  boards: { id: string; name: string; doc: unknown }[];
  content: BundleContent;
  /** Every asset the boards could reference, by id. The job fetches these after
   *  a first pass over the boards tells it which ids matter. */
  assets: Map<string, AssetRow>;
};

/**
 * Every data need declared on a set of widgets, deduped — the shared first
 * half of both `assetIdsFor` and `needsZmanim` below. Split out because
 * "walk the widgets, call their manifest's `dataNeeds`, dedupe the result"
 * is identical for either kind; only what happens to the result differs —
 * one becomes a list of ids, the other a yes/no.
 */
function collectDataNeeds(widgets: BoardWidget[]): DataNeed[] {
  const needs: DataNeed[] = [];

  for (const widget of widgets) {
    const manifest = getManifest(widget.type);
    if (!manifest) continue;
    needs.push(...manifest.dataNeeds(widget.config as never));
  }

  return dedupeDataNeeds(needs);
}

/**
 * Every asset id a board references, via the widgets' own declarations.
 *
 * Reads `dataNeeds`, which is why that field carries its parameters: a bare
 * `"asset"` would say a widget wants a picture without saying which. The
 * registry is the only thing that knows how to ask, so this stays true as
 * widgets are added without anything here changing.
 */
export function assetIdsFor(widgets: BoardWidget[]): string[] {
  return collectDataNeeds(widgets)
    .filter((need) => need.kind === "asset" && typeof need.assetId === "string")
    .map((need) => need.assetId as string);
}

/**
 * Whether any widget on a board wants Chabad zmanim at all — unlike an
 * `assetId`, a zmanim need carries no per-widget identity to collect (the
 * location it resolves against is screen/org state the builder already
 * reads regardless, not per-widget config; see the proposal this was built
 * from). This is a yes/no, not a list: does `resolveContent`
 * (lib/bundle/build.ts) need to bother reading `zmanim_cache` for this
 * board at all, sparing a board with no time-sensitive widget the read.
 *
 * candle-lighting/manifest.ts returns this need for `provider: "chabad"`
 * OR `"inherit"` — deliberately over-inclusive, since `dataNeeds` only
 * sees the widget's own config and can't know whether "inherit" resolves
 * to Chabad at the screen level. hebcal and manual never return one,
 * regardless of what the screen resolves to — see this file's own note
 * plus the proposal thread for why that split is deliberate.
 */
export function needsZmanim(widgets: BoardWidget[]): boolean {
  return collectDataNeeds(widgets).some((need) => need.kind === "zmanim");
}

/**
 * Rewrite a widget's asset references into proxy paths.
 *
 * THE RENDERER NEVER LEARNS ABOUT ASSETS. §6: widgets bind to albums and never
 * learn where photos came from. The board document stores an `assetId`; the
 * bundle hands the display a `src` it can put straight in an `<img>`. So the
 * same Renderer works in the editor (where a preview URL is resolved live) and
 * on a television reading a cached bundle, with no branch in either.
 */
function resolveWidgetAssets(widget: BoardWidget, assets: Map<string, AssetRow>): BoardWidget {
  const assetId = widget.config.assetId;
  if (typeof assetId !== "string" || !assetId) return widget;

  const asset = assets.get(assetId);
  // A missing asset leaves the widget alone rather than blanking it. The widget
  // shows its own empty state, the rest of the board is unaffected, and the
  // build does not fail over one deleted photograph.
  if (!asset) return widget;

  return { ...widget, config: { ...widget.config, src: mediaProxyPath(asset) } };
}

export function assembleBundle(input: AssembleInput): BundlePayload {
  const boards: BundleBoard[] = input.boards.map((board) => {
    // Through parseBoardDoc like every other read (lib/board-doc.ts): a document
    // written before a schema change still has to be understood, and one that
    // came from anywhere but this function may not be what it claims.
    const doc = parseBoardDoc(board.doc);

    return {
      id: board.id,
      name: board.name,
      doc: { ...doc, widgets: doc.widgets.map((w) => resolveWidgetAssets(w, input.assets)) },
    };
  });

  // Only the assets these boards actually use, deduped, in a stable order — the
  // display's atomic swap waits on exactly this list, so an asset that crept in
  // from another board would hold up a swap forever.
  const usedIds = [...new Set(boards.flatMap((board) => assetIdsFor(board.doc.widgets)))].sort();

  const assets: BundleAsset[] = usedIds
    .map((id) => input.assets.get(id))
    .filter((asset): asset is AssetRow => asset !== undefined)
    .map((asset) => ({
      id: asset.id,
      url: mediaProxyPath(asset),
      variant: asset.variant,
      contentType: asset.content_type,
      bytes: asset.bytes,
    }));

  return {
    screen: {
      id: input.screen.id,
      name: input.screen.name,
      canvas: { width: input.screen.canvas_width, height: input.screen.canvas_height },
      orientation: input.screen.orientation,
      timezone: input.screen.timezone,
      latitude: input.screen.latitude,
      longitude: input.screen.longitude,
      hebrewPrefs: input.screen.hebrew_prefs,
      zmanimProvider: input.screen.zmanim_provider,
      hasChabadLocation: input.screen.has_chabad_location,
    },
    theme: input.theme,
    playlist: input.playlist
      ? {
          id: input.playlist.id,
          name: input.playlist.name,
          items: input.playlistItems
            .slice()
            .sort((a, b) => a.position - b.position)
            .map((item) => ({
              boardId: item.board_id,
              position: item.position,
              durationSeconds: item.duration_seconds,
            })),
        }
      : null,
    boards,
    content: input.content,
    assets,
  };
}
