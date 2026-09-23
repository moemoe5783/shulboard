/**
 * lib/media/selection.ts and lib/media/visibility.ts — which photos a Gallery
 * or Collage shows once several albums, "all except", and end dates are in
 * play. Pure, no DOM.
 */

import type { BoardAlbums, BoardPhoto } from "../lib/media/album-photos.ts";
import {
  ALL_ALBUMS,
  albumSelectionKey,
  albumSelectionNeeds,
  chosenAlbumIds,
  hasAlbumSelection,
  selectPhotos,
  type AlbumSelection,
} from "../lib/media/selection.ts";
import { isShowing, todayIn } from "../lib/media/visibility.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

const photo = (assetId: string, displayUntil: string | null = null): BoardPhoto => ({
  assetId,
  src: `/m/${assetId}/display-x.webp`,
  width: 800,
  height: 600,
  caption: null,
  addedAt: null,
  displayUntil,
  variants: [],
});

const selection = (patch: Partial<AlbumSelection>): AlbumSelection => ({
  albumId: "",
  albumMode: "selected",
  albumIds: [],
  excludedAlbumIds: [],
  ...patch,
});

const albums: BoardAlbums = {
  purim: [photo("a"), photo("b", "2026-03-04"), photo("shared")],
  kiddush: [photo("c"), photo("shared"), photo("d", "2026-09-30")],
  archive: [photo("e")],
};
const ids = (list: BoardPhoto[] | undefined) => (list ? list.map((p) => p.assetId).join(",") : "undefined");

console.log("\n-- chosen albums ------------------------------------------------");
check(ids(selectPhotos(selection({ albumIds: ["purim", "kiddush"] }), albums, "2026-03-01")) === "a,b,shared,c,d", "several albums merge in the chosen order");
check(ids(selectPhotos(selection({ albumIds: ["kiddush", "purim"] }), albums, "2026-03-01")) === "c,shared,d,a,b", "and the order follows the choice");
check(!ids(selectPhotos(selection({ albumIds: ["purim", "kiddush"] }), albums, "2026-03-01")).match(/shared.*shared/), "a photo in two chosen albums shows once");
check(selectPhotos(selection({ albumIds: ["purim", "missing"] }), albums, "2026-03-01") === undefined, "an album not resolved yet reads as still loading, not as empty");
check(chosenAlbumIds(selection({ albumId: "purim" })).join() === "purim", "a legacy single albumId still counts");
check(chosenAlbumIds(selection({ albumId: "purim", albumIds: ["kiddush"] })).join() === "kiddush", "albumIds wins once it's set");
check(!hasAlbumSelection(selection({})) && hasAlbumSelection(selection({ albumMode: "all" })), "nothing chosen is unconfigured; all albums is a choice");

console.log("\n-- all albums, except… ---------------------------------------");
const all = selection({ albumMode: "all", excludedAlbumIds: ["archive"] });
check(ids(selectPhotos(all, albums, "2026-03-01")) === "c,shared,d,a,b", "all albums minus the excluded, in a stable album order", ids(selectPhotos(all, albums, "2026-03-01")));
check(albumSelectionNeeds(all)[0]?.albumId === ALL_ALBUMS, "and it asks for every album, not a list frozen at setup time");
check(
  albumSelectionKey(selection({ albumMode: "all", excludedAlbumIds: ["b", "a"] })) === albumSelectionKey(selection({ albumMode: "all", excludedAlbumIds: ["a", "b"] })),
  "the selection key doesn't depend on tick order",
);

console.log("\n-- end dates ---------------------------------------------------");
check(isShowing("2026-03-04", "2026-03-04"), "the end date is the LAST day it shows");
check(!isShowing("2026-03-04", "2026-03-05"), "and the day after, it's gone");
check(isShowing(null, "2099-01-01"), "no end date shows forever");
check(ids(selectPhotos(selection({ albumIds: ["purim"] }), albums, "2026-03-05")) === "a,shared", "an ended photo drops out of the board");
check(
  todayIn("America/New_York", new Date("2026-03-05T03:30:00Z")) === "2026-03-04" &&
    todayIn("Asia/Jerusalem", new Date("2026-03-05T03:30:00Z")) === "2026-03-05",
  "'today' is the shul's date, not UTC's — 3:30 UTC is still the 4th in New York",
);
check(todayIn("Not/AZone", new Date("2026-03-05T12:00:00Z")).length === 10, "an unknown zone falls back to the device rather than throwing");

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
