/*
 * Which photo files are on hand — what a Gallery or Collage needs to know
 * beside its albums (lib/board-assets.tsx), under the same no-fork contract:
 * the widget never learns where it's running, only these answers.
 *
 * On a display, a board only shows a page once every file on it is on the
 * device (the atomic swap's promise, lib/display/assets.ts). The widget hears:
 *
 *  - `gated`: whether pages wait for their files at all. Only the display's
 *    runtime says yes.
 *  - `isReady(src)`: this file can be shown now. `version` bumps as more
 *    arrive, so a widget waiting on a page knows to look again.
 *  - `want(owner, srcs, complete)`: the files its pages use, in the order it
 *    will show them — what the display downloads. `complete` says the list
 *    covers every page. An empty list withdraws.
 *
 * EVERYTHING IS READY BY DEFAULT. Anywhere without the display's runtime —
 * the editor's canvas, its previews, a thumbnail, a lab, a server render —
 * gets EVERY_FILE_READY: every page shows at once and images load straight
 * from their URLs, as on any web page. A missing provider can never mean
 * "nothing is ready"; that failure drew empty photo widgets in the editor
 * once, and this is what makes it impossible for the next widget.
 *
 * Plain TypeScript, no React, so a Node test can import the default.
 */

export type BoardFiles = {
  gated: boolean;
  isReady: (src: string) => boolean;
  version: number;
  want: (owner: string, srcs: readonly string[], complete: boolean) => void;
};

export const EVERY_FILE_READY: BoardFiles = Object.freeze({
  gated: false,
  isReady: () => true,
  version: 0,
  want: () => {},
});
