"use client";

/*
 * Font parity between the editor and the display route — CLAUDE.md's shared-
 * renderer rule, and the reason it's load-bearing: "if a widget renders
 * differently in the two places, that's a bug," and a previous session's
 * fit/fixed sizing work only ever measured type at the same fraction of
 * board width, which proves SIZE parity, not FAMILY parity.
 *
 * A dev reference page, like /tokens, /primitives and /editor-lab — permanent,
 * not a throwaway, because scripts/test-font-parity.mjs drives it on every
 * `npm test` run. It mounts the REAL BoardEditor (the actual /boards/[id]
 * chrome — editor-lab's own canvas is deliberately safe by construction and
 * would not have caught the font-ui leak this page exists to catch) next to
 * a BoardRenderer wrapped exactly the way DisplayBoard.tsx wraps it, both fed
 * the SAME document, so a font difference between them can be measured
 * directly rather than argued about.
 *
 * THE THEME IS DELIBERATELY NOT ASSISTANT. Testing with a board theme that
 * happens to already be Assistant — the same face dashboard chrome opts into
 * — would hide a real chrome-font leak by coincidence: a leaked font-ui and a
 * correctly-inherited board theme would render identically. `sefarim` (Frank
 * Ruhl Libre) is about as visually different from Assistant as this product
 * has, which is what makes it an actual test rather than a decoration.
 * Override with ?font=assistant or ?font=system to check the others too.
 */

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { BoardEditor } from "@/app/(editor)/boards/[id]/BoardEditor";
import { BoardRenderer } from "@/components/board/BoardRenderer";
import { boardDocAsJson, parseBoardDoc, type BoardDoc } from "@/lib/board-doc";
import type { BoardFont } from "@/lib/board-theme";
import { DEMO_LOCATION } from "@/lib/demo-board";

const CANVAS = { width: 1920, height: 1080 };

export const TITLE_ID = "11111111-1111-4111-8111-111111111111";
export const CLOCK_FIXED_ID = "22222222-2222-4222-8222-222222222222";
export const CLOCK_FIT_ID = "33333333-3333-4333-8333-333333333333";
export const HEBREW_DATE_ID = "44444444-4444-4444-8444-444444444444";
export const HAVDALAH_ID = "66666666-6666-4666-8666-666666666666";

function buildDoc(font: BoardFont): BoardDoc {
  return parseBoardDoc({
    schemaVersion: 1,
    themeOverrides: { font, ink: "ink", background: "surface" },
    widgets: [
      {
        id: TITLE_ID,
        type: "title",
        x: 4,
        y: 4,
        w: 60,
        h: 20,
        z: 0,
        config: { text: "Font parity title", subtitle: "A subtitle line", align: "left" },
      },
      {
        id: CLOCK_FIXED_ID,
        type: "clock",
        x: 4,
        y: 30,
        w: 55,
        h: 20,
        z: 1,
        config: { hour12: true, showSeconds: true, align: "left", size: 96, sizingMode: "fixed" },
      },
      {
        id: CLOCK_FIT_ID,
        type: "clock",
        x: 4,
        y: 55,
        w: 55,
        h: 20,
        z: 2,
        config: { hour12: true, showSeconds: true, align: "left", sizingMode: "fit" },
      },
      {
        id: HEBREW_DATE_ID,
        type: "hebrew-date",
        x: 4,
        y: 78,
        w: 55,
        h: 18,
        z: 3,
        config: { script: "both", numerals: "gematria", align: "left", sizingMode: "fixed" },
      },
      {
        // scripts/test-hebrew-widgets.mjs's own Havdalah shitah checks —
        // transliterated, so its rendered text is plain digits/letters with
        // no Hebrew line to strip out when reading back the clock time.
        id: HAVDALAH_ID,
        type: "havdalah",
        x: 65,
        y: 4,
        w: 30,
        h: 30,
        z: 4,
        config: { script: "transliterated", align: "left", sizingMode: "fixed", shitah: "tzeis_3_stars" },
      },
    ],
  });
}

const VALID_FONTS = new Set<BoardFont>(["assistant", "sefarim", "system"]);

function FontParityInner() {
  const params = useSearchParams();
  const requested = params.get("font") ?? "sefarim";
  const font = (VALID_FONTS.has(requested as BoardFont) ? requested : "sefarim") as BoardFont;
  const doc = buildDoc(font);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div data-parity-half="editor" style={{ height: "60vh", position: "relative" }}>
        <BoardEditor
          boardId="00000000-0000-4000-8000-000000000000"
          name="Font parity"
          canvas={CANVAS}
          doc={boardDocAsJson(doc)}
          location={DEMO_LOCATION}
          publishState={{ publishedAt: null, screenCount: 0, pendingChanges: true }}
        />
      </div>
      {/* The exact wrapper DisplayBoard.tsx uses around BoardRenderer. */}
      <div
        data-parity-half="display"
        className="bg-ink flex items-center justify-center overflow-hidden"
        style={{ height: "40vh", position: "relative" }}
      >
        <BoardRenderer
          doc={doc}
          canvas={CANVAS}
          location={DEMO_LOCATION}
          widgetProps={(widget) => ({ "data-widget-id": widget.id })}
          style={{
            aspectRatio: `${CANVAS.width} / ${CANVAS.height}`,
            width: "100%",
          }}
        />
      </div>
    </div>
  );
}

export default function FontParityPage() {
  return (
    <Suspense fallback={null}>
      <FontParityInner />
    </Suspense>
  );
}
