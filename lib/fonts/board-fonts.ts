import { BUILT_FONTS, FONT_FACES_CSS, type BuiltFace } from "./catalog.generated.ts";
import { DIGIT_FAMILIES } from "./catalog.ts";
import { boldWeight, catalogId, clampWeight, digitFallbackFor, fontInfo } from "./index.ts";
import { boardFontRoles, resolveElementFont, type FontRole } from "./roles.ts";
import { hebrewFamily, hebrewOverride, resolvedHebrew } from "./stack.ts";

/*
 * THE FONTS A BOARD USES — and only those — for the bundle (plan.md §3a).
 *
 * Every face in the catalog is declared in one stylesheet, and declaring one
 * downloads nothing: the browser fetches a file only when text on the page
 * uses it. That is enough online. Offline it isn't — a screen that reboots
 * without a network has to have its fonts already, so the display caches
 * exactly the files listed here, with the same service worker and rules as
 * the board's pictures (lib/display/assets.ts), and waits for them before
 * the board is first shown. The rest of the catalog never reaches a screen.
 *
 * WHICH FILES. For every element: the face it resolves to (its own, a role by
 * name, or its role's default — ./roles.ts), at the weights a board draws
 * text in (regular and semibold; a variable face is one file for both), its
 * Latin files; the Hebrew face drawn with it (override, matched fallback, or
 * the face's own) — its Hebrew file only when the board has Hebrew to draw; a
 * time widget whose face has old-style figures, the fallback's digits; and
 * Frank Ruhl Libre for the Hebrew-calendar widgets, which set it themselves.
 *
 * `faces` is the same list as families the page can ask the browser to load
 * (document.fonts.load) before first paint, each with a sample of the text
 * that makes the right file load (Hebrew for a Hebrew-only family).
 *
 * Plain TypeScript, relative imports: the bundle builder and Node tests read it.
 */

export type BundleFontFace = { family: string; weight: number; text: string };

export type BundleFonts = {
  /** The stylesheet declaring every face — cached so a reboot offline can read it. */
  stylesheet: string;
  /** Every font file the boards use, deduped and sorted. */
  files: string[];
  /** Families to load before first paint. */
  faces: BundleFontFace[];
};

/** What the builder needs to know about a widget type (its manifest). */
export type WidgetFontInfo = (type: string) => { fontRole?: FontRole; showsTimes?: boolean } | undefined;

type Doc = { themeOverrides: Record<string, unknown>; widgets: readonly { type: string; hidden?: boolean; config: unknown }[] };

/** The widgets that set Frank Ruhl Libre themselves (lib/board-theme.ts,
 *  BOARD_FONTS.sefarim) for Hebrew dates, the parsha, the daf and candle
 *  lighting's labels. */
const SEFARIM_TYPES = new Set(["hebrew-date", "parsha", "daf-yomi", "candle-lighting"]);
/** Widgets that draw Hebrew letters whatever their text says. */
const HEBREW_TYPES = new Set(["hebrew-date", "parsha", "daf-yomi"]);
const HEBREW_LETTER = /[֐-׿יִ-ﭏ]/;

/** The weights a board draws text in: regular, and semibold for titles,
 *  headers and clocks — plus each face's own bold (Text's Bold), and any weight
 *  an element chooses. */
const TEXT_WEIGHTS = [400, 600];

const LATIN = new Set(["latin", "latin-ext"]);
const HEBREW_SAMPLE = "אבג";
const LATIN_SAMPLE = "Aa1";

/** The files of a face at a weight: one variable file covers every weight;
 *  a static face gives the file nearest to it. */
function filesFor(id: string, weight: number, subsets: (subset: string) => boolean): BuiltFace[] {
  const faces = (BUILT_FONTS[id]?.faces ?? []).filter((face) => face.style === "normal" && subsets(face.subset));
  const bySubset = new Map<string, BuiltFace[]>();
  for (const face of faces) bySubset.set(face.subset, [...(bySubset.get(face.subset) ?? []), face]);
  const out: BuiltFace[] = [];
  for (const list of bySubset.values()) {
    const range = list.find((face) => {
      const [lo, hi] = face.weight.split(" ").map(Number);
      return hi !== undefined && weight >= lo && weight <= hi;
    });
    if (range) {
      out.push(range);
      continue;
    }
    const nearest = list.reduce((best, face) =>
      Math.abs(Number(face.weight.split(" ")[0]) - weight) < Math.abs(Number(best.weight.split(" ")[0]) - weight) ? face : best,
    );
    out.push(nearest);
  }
  return out;
}

export function boardFonts(docs: readonly Doc[], widgetInfo: WidgetFontInfo): BundleFonts {
  const files = new Set<string>();
  const faces = new Map<string, BundleFontFace>();
  const addFace = (family: string, weight: number, text: string) => faces.set(`${family}|${weight}`, { family, weight, text });

  for (const doc of docs) {
    const roles = boardFontRoles(doc.themeOverrides);
    const widgets = doc.widgets.filter((widget) => !widget.hidden);
    const hasHebrew =
      widgets.some((widget) => HEBREW_TYPES.has(widget.type)) || widgets.some((widget) => HEBREW_LETTER.test(JSON.stringify(widget.config ?? {})));

    /** A font and its Hebrew, as drawn at the text weights. */
    const addFont = (font: string, hebrew: string, extra: readonly number[] = []) => {
      const id = catalogId(font);
      if (!id || id === "system") return;
      const info = fontInfo(id);
      if (!info) return;
      for (const wanted of new Set([...TEXT_WEIGHTS, boldWeight(id), ...extra])) {
        const weight = clampWeight(id, wanted);
        for (const face of filesFor(id, weight, (subset) => LATIN.has(subset))) files.add(face.url);
        addFace(info.name, weight, LATIN_SAMPLE);
        if (!hasHebrew) continue;
        const hebrewId = resolvedHebrew(id, hebrew);
        if (!hebrewId) continue;
        const hebrewWeight = clampWeight(hebrewId, weight);
        for (const face of filesFor(hebrewId, hebrewWeight, (subset) => subset === "hebrew")) files.add(face.url);
        // The family the stack names for it: a size-matched Hebrew-only alias
        // for an override or a fallback, or the face itself.
        const family = hebrewOverride(hebrew) || hebrewId !== id ? hebrewFamily(hebrewId, id) : info.name;
        addFace(family, hebrewWeight, HEBREW_SAMPLE);
      }
    };

    addFont(roles.body.font, roles.body.hebrew);
    for (const widget of widgets) {
      const config = (widget.config ?? {}) as { font?: string; hebrewFont?: string; title?: string; fontWeight?: number };
      const meta = widgetInfo(widget.type);
      const resolved = resolveElementFont(config.font, config.hebrewFont, meta?.fontRole ?? "body", roles);
      // A weight chosen on the element (widgets/style.ts) is a file of its own
      // in a static face.
      addFont(resolved.font, resolved.hebrew, typeof config.fontWeight === "number" && config.fontWeight > 0 ? [config.fontWeight] : []);
      // A header line is set in the heading font (components/board/BoardRenderer.tsx).
      if (typeof config.title === "string" && config.title !== "") addFont(roles.heading.font, roles.heading.hebrew);
      if (meta?.showsTimes) {
        const fallback = digitFallbackFor(resolved.font);
        if (fallback) {
          for (const wanted of TEXT_WEIGHTS) {
            for (const face of filesFor(fallback, wanted, (subset) => subset === "latin")) files.add(face.url);
            addFace(DIGIT_FAMILIES[fallback], wanted, "0123456789");
          }
        }
      }
      if (SEFARIM_TYPES.has(widget.type)) addFont("frank-ruhl-libre", "auto");
    }
  }

  return {
    stylesheet: FONT_FACES_CSS,
    files: [...files].sort(),
    faces: [...faces.values()].sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight),
  };
}
