/**
 * Widget registry unit tests.
 *
 * Small enough to run without a browser or a bundler, which is why
 * widgets/data-needs.ts is its own module: the registry resolves its folder
 * through require.context and cannot be imported here, but the behaviour that
 * matters — two widgets pointing at the same thing dedupe to one fetch — can.
 *
 * Run with: npm run test:widgets
 */

import { dataNeedKey, dedupeDataNeeds } from "../widgets/data-needs.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

check(
  dataNeedKey({ kind: "calendar", calendarId: "a" }) ===
    dataNeedKey({ calendarId: "a", kind: "calendar" }),
  "property order does not change a need's identity",
);

check(
  dataNeedKey({ kind: "calendar", calendarId: "a" }) !==
    dataNeedKey({ kind: "calendar", calendarId: "b" }),
  "two calendars are two needs",
);

check(
  dataNeedKey({ kind: "calendar" }) !== dataNeedKey({ kind: "album" }),
  "different kinds are different needs",
);

check(
  dataNeedKey({ kind: "timezone", timeZone: null }) !==
    dataNeedKey({ kind: "timezone", timeZone: "Asia/Jerusalem" }),
  "the device's own zone is not the same need as a named one",
);

check(
  dataNeedKey({ kind: "asset", src: "a" }) === dataNeedKey({ kind: "asset", src: "a", alt: undefined }),
  "an undefined parameter is the same as an absent one",
);

{
  // The behaviour §5 actually asks for.
  const board = [
    { kind: "calendar", calendarId: "shul@example.com" },
    { kind: "calendar", calendarId: "shul@example.com" },
    { kind: "calendar", calendarId: "shiurim@example.com" },
    { kind: "asset", src: "/kiddush.jpg" },
    { kind: "asset", src: "/kiddush.jpg" },
  ];
  const deduped = dedupeDataNeeds(board);
  check(deduped.length === 3, "five needs across a board become three fetches", `${deduped.length}`);
  check(
    deduped.filter((n) => n.kind === "calendar").length === 2,
    "two widgets on one calendar are one API call",
  );
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
