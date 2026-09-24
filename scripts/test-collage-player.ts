/**
 * The collage player against a fake set of files on the device — what a TV's
 * cache looks like to it (lib/board-assets.tsx, BoardFiles).
 *
 *   - Pages are planned against the FULL album, identically on two players,
 *     whatever each device holds.
 *   - Every file those pages use is declared, once per photo, in display order,
 *     and the declaration says when it covers the whole cycle.
 *   - A page shows only when every one of its files is here; until then the
 *     current page stays, and after three intervals the next ready page
 *     shows instead.
 *   - A bigger copy already here serves a smaller cell.
 *   - With no files (the editor) everything shows and nothing is declared.
 *
 * Run with: npm run test:collage-player
 */

import { EVERY_FILE_READY, type BoardFiles } from "../lib/board-files.ts";
import type { BoardPhoto } from "../lib/media/album-photos.ts";
import type { CollageConfig } from "../widgets/collage/manifest.ts";
import { CollagePlayer, type PlannedPage } from "../widgets/collage/player.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

// The player decodes images before a swap; in Node an image "loads" at once.
(globalThis as { Image?: unknown }).Image = class {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
  decode() {
    return Promise.resolve();
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const SIZES = [
  { name: "thumb", maxEdge: 400 },
  { name: "display", maxEdge: 1080 },
  { name: "large", maxEdge: 2160 },
];

function album(count: number): BoardPhoto[] {
  return Array.from({ length: count }, (_, i) => {
    const width = i % 3 === 0 ? 3000 : 2000;
    const height = i % 3 === 0 ? 2000 : 3000;
    const variants = SIZES.map((size) => {
      const scale = Math.min(1, size.maxEdge / Math.max(width, height));
      return {
        name: size.name,
        src: `/m/p${i}/${size.name}-h${i}.webp`,
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        contentType: "image/webp",
        bytes: 1000,
      };
    });
    return {
      assetId: `p${i}`,
      src: variants[1].src,
      width,
      height,
      caption: null,
      addedAt: null,
      displayUntil: null,
      variants,
    };
  });
}

const CONFIG = {
  gutter: 12,
  density: "medium",
  exactCount: 6,
  order: "album",
  style: "clean",
  artsyFrame: "polaroid",
  artsyTilt: "medium",
  artsyOverlap: "some",
  artsyFasteners: "none",
  intervalSeconds: 10,
  transition: "none",
  transitionSpeed: 1,
} as unknown as CollageConfig;

type Fake = BoardFiles & { ready: Set<string>; wanted: string[]; complete: boolean; calls: number };

function fakeFiles(): Fake {
  const fake: Fake = {
    gated: true,
    ready: new Set(),
    wanted: [],
    complete: false,
    calls: 0,
    version: 0,
    isReady: (src) => fake.ready.has(src),
    want: (_owner, srcs, complete) => {
      fake.wanted = [...srcs];
      fake.complete = complete;
      fake.calls += 1;
    },
  };
  return fake;
}

function start(photos: BoardPhoto[], files: BoardFiles, config: CollageConfig = CONFIG) {
  const player = new CollagePlayer();
  const feed = (f: BoardFiles) =>
    player.setInputs({
      photos,
      box: { width: 1200, height: 800 },
      boxPx: { width: 1200, height: 800 },
      dpr: 1,
      config,
      albumKey: "albums:a",
      files: f,
    });
  feed(files);
  return { player, feed };
}

/** Wait for the background planning to cover the cycle. */
async function planned(files: Fake) {
  for (let i = 0; i < 200 && !files.complete; i += 1) await sleep(20);
}

const pagesOf = (player: CollagePlayer): PlannedPage[] =>
  ((player as unknown as { cycles: Map<number, { pages: PlannedPage[] }> }).cycles.get(0)?.pages ?? []).slice();

const photos = album(30);

console.log("\n-- planning against the full album ---------------------------");
const a = fakeFiles();
const one = start(photos, a);
await planned(a);
const pages = pagesOf(one.player);
check(a.complete, "the whole cycle gets planned and declared", `${pages.length} pages`);
check(
  new Set(pages.flatMap((page) => page.photoIds)).size === photos.length,
  "every photo is on exactly one page of the cycle",
);
check(a.wanted.length === photos.length && new Set(a.wanted).size === photos.length, "one file declared per photo", `${a.wanted.length} files`);
const firstPageFiles = pages[0].cells.map((cell) => cell.src);
check(
  firstPageFiles.every((src) => a.wanted.slice(0, firstPageFiles.length).includes(src)),
  "the first page's files are declared first",
);
check(
  pages.every((page) =>
    page.cells.every((cell) => {
      const size = cell.variants.find((v) => v.src === cell.src)!;
      return size.width >= cell.needed || size === cell.variants[cell.variants.length - 1];
    }),
  ),
  "each planned file is at least as wide as its cell draws, or the largest there is",
);
check(!a.wanted.some((src) => src.includes("/large-")) || pages.some((p) => p.cells.some((c) => c.needed > 1080)), "no large file is declared that no cell needs");

const b = fakeFiles();
b.ready = new Set(firstPageFiles.slice(0, 2)); // a different device, holding different files
const two = start(photos, b);
await planned(b);
check(
  JSON.stringify(pagesOf(two.player).map((p) => p.photoIds)) === JSON.stringify(pages.map((p) => p.photoIds)),
  "a second screen holding different files plans the identical pages",
);

console.log("\n-- a page shows only when all of it is here ------------------");
one.player.tick(0);
await sleep(5);
check(one.player.getSnapshot().current === null, "with nothing on the device, nothing shows");

for (const src of firstPageFiles) a.ready.add(src);
a.version += 1;
one.feed({ ...a });
one.player.tick(1);
await sleep(5);
check(one.player.getSnapshot().current?.index === 0, "once page 1's files are here, page 1 shows", String(one.player.getSnapshot().current?.index));

// Page 2 isn't here; page 3 is.
for (const src of pages[2].cells.map((cell) => cell.src)) a.ready.add(src);
one.feed({ ...a });
one.player.tick(11);
await sleep(5);
check(one.player.getSnapshot().current?.index === 0, "at the boundary, with page 2 missing, page 1 stays");
one.player.tick(25);
await sleep(5);
check(one.player.getSnapshot().current?.index === 0, "and keeps staying until it has been up three intervals");
one.player.tick(31);
await sleep(5);
check(one.player.getSnapshot().current?.index === 2, "then the next page that's fully here shows instead", String(one.player.getSnapshot().current?.index));

console.log("\n-- a bigger copy serves a smaller cell -----------------------");
{
  const c = fakeFiles();
  const three = start(photos, c);
  await planned(c);
  const page = pagesOf(three.player)[0];
  // Everything for page 1 here, but one photo only as its large copy.
  const swapped = page.cells[0];
  const large = swapped.variants[swapped.variants.length - 1];
  for (const cell of page.cells) if (cell !== swapped) c.ready.add(cell.src);
  if (large.src !== swapped.src) c.ready.add(large.src);
  else c.ready.add(swapped.src);
  three.feed({ ...c });
  three.player.tick(0);
  await sleep(5);
  const shown = three.player.getSnapshot().current;
  check(shown?.index === 0, "the page shows");
  check(shown?.cells.find((cell) => cell.id === swapped.id)?.src === large.src, "drawing the larger copy it already has", large.name);
  three.player.dispose();
}

console.log("\n-- the editor --------------------------------------------------");
{
  const editor = start(photos, EVERY_FILE_READY);
  await sleep(50);
  editor.player.tick(0);
  await sleep(5);
  check(editor.player.getSnapshot().current?.index === 0, "with no files to ask, page 1 shows straight away");
  editor.player.next();
  await sleep(5);
  check(editor.player.getSnapshot().current?.index === 1, "and Next page moves on");
  editor.player.dispose();
}

console.log("\n-- shuffle plans the next cycle too ---------------------------");
{
  const d = fakeFiles();
  const shuffled = start(photos, d, { ...CONFIG, order: "shuffle" } as CollageConfig);
  await planned(d);
  const cycles = (shuffled.player as unknown as { cycles: Map<number, { done: boolean }> }).cycles;
  check(cycles.get(0)?.done === true && cycles.get(1)?.done === true, "both this cycle and the next are planned");
  check(d.wanted.length === photos.length, "still one file per photo — the biggest either cycle needs", `${d.wanted.length}`);
  shuffled.player.dispose();
}

one.player.dispose();
two.player.dispose();
check(a.wanted.length === 0 && a.complete, "a collage that goes away withdraws what it wanted");

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
