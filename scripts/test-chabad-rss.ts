/**
 * lib/zmanim/chabad-rss.ts's parsing, against a REAL chabad.org RSS feed —
 * no network, `fetch` stubbed to return the fixture.
 *
 * FIXTURE: test/fixtures/chabad-zmanim-rss-33710.xml is a real published
 * zmanim feed for ZIP 33710 (Saint Petersburg, FL) on Mon 9/14/2026 — one
 * day, which is all the feed ever returns. That day is Tzom Gedaliah, so two
 * rows carry the "Fast Begins"/"Fast Ends" footnote, which exercises the
 * footnote split.
 *
 * Run with: npm run test:chabad-rss — not plain `node`. The module imports
 * `server-only`, which needs the `react-server` export condition (see the
 * npm script).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchChabadRssZmanim } from "../lib/zmanim/chabad-rss.ts";
import { isClockZman, type ChabadZman } from "../lib/zmanim/zman.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail: string | null | undefined = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function expectThrow(label: string, run: () => Promise<unknown>, mustInclude: string) {
  try {
    await run();
    check(false, label, "did not throw");
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    check(message.includes(mustInclude), label, message);
  }
}

const XML = readFileSync(
  fileURLToPath(new URL("../test/fixtures/chabad-zmanim-rss-33710.xml", import.meta.url)),
  "utf8",
);

const captured: { url: URL | null } = { url: null };
function stubFetch(body: string) {
  const original = globalThis.fetch;
  captured.url = null;
  globalThis.fetch = (async (input: URL | string) => {
    captured.url = new URL(String(input));
    return { ok: true, status: 200, statusText: "OK", text: async () => body };
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const restore = stubFetch(XML);
const result = await fetchChabadRssZmanim({ locationId: "33710", locationType: "2", timeZone: "America/New_York" });
restore();

const DATE = "2026-09-14";
const day = result.times[DATE] ?? {};
const clock = (id: string) => {
  const value: ChabadZman | undefined = day[id];
  return value && isClockZman(value) ? value : undefined;
};

console.log("\n-- the request and the one day it returns -------------------");

check(String(captured.url).includes("locationId=33710"), "the feed is fetched by camelCase locationId", String(captured.url));
check(String(captured.url).includes("locationType=2"), "and locationType=2");
check(result.date === DATE, "the feed's one date parses from <english_date>", result.date);
check(Object.keys(result.times).length === 1, "exactly one day is cached", String(Object.keys(result.times).length));
check(result.location.includes("Saint Petersburg") && result.location.includes("33710"),
  "the location is read from the channel title", result.location);

console.log("\n-- each row maps to its canonical id, English and translit --");

// [canonical id, display, English label, transliteration or null]
const EXPECTED: [string, string, string, string | null][] = [
  ["alos_baal_hatanya", "6:02 AM", "Dawn", "Alot Hashachar"],
  ["misheyakir", "6:34 AM", "Earliest Tallit and Tefillin", "Misheyakir"],
  ["netz", "7:16 AM", "Sunrise", "Hanetz Hachamah"],
  ["sof_zman_shma_baal_hatanya", "10:19 AM", "Latest Shema", null],
  ["sof_zman_tfila_baal_hatanya", "11:21 AM", "Latest Shacharit", null],
  ["chatzos", "1:26 PM", "Midday", "Chatzot Hayom"],
  ["mincha_gedola", "1:58 PM", "Earliest Mincha", "Mincha Gedolah"],
  // The feed's inconsistent rows: the parenthetical is an English gloss, not a
  // transliteration. Accepted (plan.md §5c) — the parse is purely structural.
  ["mincha_ketana", "5:05 PM", "Mincha Ketanah", "Small Mincha"],
  ["plag_hamincha", "6:23 PM", "Plag Hamincha", "Half of Mincha"],
  ["shkia", "7:37 PM", "Sunset", "Shkiah"],
  ["tzeis_baal_hatanya", "8:01 PM", "Nightfall", "Tzeit Hakochavim"],
  ["chatzos_laila", "1:26 AM", "Midnight", "Chatzot HaLailah"],
];

for (const [id, display, label, translit] of EXPECTED) {
  const value = clock(id);
  check(value?.display === display, `${id} → "${display}"`, value?.display);
  check(value?.label === label, `${id} English label is "${label}"`, value?.label);
  check((value?.translit ?? null) === translit, `${id} transliteration is ${translit === null ? "absent" : `"${translit}"`}`, value?.translit ?? "(none)");
}

console.log("\n-- footnotes, the shaah zmanit duration, and instants -------");

check(clock("alos_baal_hatanya")?.footnote?.text === "Fast Begins",
  "the '| Fast Begins' suffix becomes a footnote", clock("alos_baal_hatanya")?.footnote?.text);
check(clock("tzeis_baal_hatanya")?.footnote?.text === "Fast Ends",
  "and '| Fast Ends' on nightfall", clock("tzeis_baal_hatanya")?.footnote?.text);

const shaah = day["chabad:ShaahZmanit"];
check(!!shaah && !isClockZman(shaah) && shaah.durationSeconds === 62 * 60 + 18,
  "Shaah Zmanit is a duration (62:18 min. → 3738s), not a clock time",
  shaah && !isClockZman(shaah) ? String(shaah.durationSeconds) : "not a duration");

// EDT (UTC-4) on 9/14/2026.
check(clock("netz")?.iso === "2026-09-14T11:16:00.000Z", "netz 7:16 AM builds an EDT instant", clock("netz")?.iso);
check(clock("shkia")?.iso === "2026-09-14T23:37:00.000Z", "shkia 7:37 PM likewise", clock("shkia")?.iso);
// Chatzos halayla reads 1:26 AM and belongs to the FOLLOWING night, so its
// instant is a day later than the row it is filed under (zman.ts's rollover).
check(clock("chatzos_laila")?.iso === "2026-09-15T05:26:00.000Z",
  "chatzos halayla 1:26 AM rolls to the next civil day", clock("chatzos_laila")?.iso);

console.log("\n-- a wrong ZIP is refused, not cached -----------------------");

const restore2 = stubFetch(XML);
await expectThrow(
  "a feed whose title doesn't contain the requested ZIP throws",
  () => fetchChabadRssZmanim({ locationId: "99999", locationType: "2", timeZone: "America/New_York" }),
  "refusing",
);
restore2();

console.log("");
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
