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

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

{
  // A manifest runs on the SERVER too: the bundle build and publishBoard call
  // its dataNeeds. Anything it imports from a "use client" module arrives
  // there as a client reference, and calling it throws — so every build of a
  // board holding that widget fails, and the screen keeps its old bundle (or
  // waits forever). Nothing else catches this: the editor runs it client-side
  // and works, and `next build` passes.
  const root = resolve(import.meta.dirname, "..");
  const resolveLocal = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? join(root, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
    if (!base) return null;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
      if (existsSync(candidate) && candidate.match(/\.tsx?$/)) return candidate;
    }
    return null;
  };
  const clientReach = (entry: string): string[] => {
    const seen = new Set<string>();
    const hits: string[] = [];
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      if (/^\s*["']use client["']/.test(source)) hits.push(file.slice(root.length + 1));
      for (const match of source.matchAll(/^\s*(?:import|export)(?!\s+type\b)[^;]*?from\s+["']([^"']+)["']/gm)) {
        const next = resolveLocal(file, match[1]);
        if (next) visit(next);
      }
    };
    visit(entry);
    return hits;
  };
  const widgetsDir = join(root, "widgets");
  for (const name of readdirSync(widgetsDir)) {
    const manifest = join(widgetsDir, name, "manifest.ts");
    if (!existsSync(manifest)) continue;
    const hits = clientReach(manifest);
    check(hits.length === 0, `${name}/manifest.ts reaches no "use client" module`, hits.join(", "));
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
