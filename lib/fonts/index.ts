import { BUILT_FONTS, type BuiltFont } from "./catalog.generated.ts";
import {
  ENGLISH_FONTS,
  HEBREW_FALLBACK,
  HEBREW_MARKS_FALLBACK,
  HEBREW_FONTS,
  type EnglishFont,
  type FontCategory,
  type HebrewFont,
} from "./catalog.ts";

/*
 * The board font catalog as the rest of the app reads it: lib/fonts/catalog.ts
 * (what each font is) merged with lib/fonts/catalog.generated.ts (what the
 * build measured in its files). Plain TypeScript, relative imports, so Node
 * tests and the build script read the same thing the editor does.
 */

export { HEBREW_FALLBACK, HEBREW_GROUPS, type FontCategory, type HebrewGroup } from "./catalog.ts";

type Measured = {
  /** Has the 'tnum' feature, so `tabular-nums` lines its digits up. */
  hasTabularNums: boolean;
  /** Its default digits are already one width. */
  digitsEqual: boolean;
  /** Widest digit (em) per offered weight. */
  digitEm: Record<number, number>;
  /** Its digits, as drawn, are lining. False: old-style with no lining set
   *  (Marcellus, the scripts, Suez One) — times take the fallback's digits. */
  liningDigits: boolean;
  latin: boolean;
  hebrew: boolean;
  /** One variable file covers its weights (instances in between exist);
   *  false: separate files, and a weight between them is drawn with one. */
  variable: boolean;
  /** Sets nikud properly. Measured, then confirmed by eye in /fonts-lab. */
  nikudOk: boolean;
  /** Hebrew punctuation and nikud points it has no glyph for (sof pasuk,
   *  paseq…) — drawn from the marks fallback (hebrewMarksFallbackFor). */
  hebrewMissing: readonly string[];
};

/** A font the main picker offers: an English face, or a face with both
 *  scripts ("Hebrew & English"). */
export type PickableFont = Measured & {
  id: string;
  name: string;
  category: FontCategory;
  weights: readonly number[];
  minWeight: number;
  italic: boolean;
  capsOnly: boolean;
  license: "OFL-1.1";
  /** The name in Hebrew — Hebrew & English faces only. */
  hebrewName?: string;
};

/** A font the Hebrew override list offers. */
export type HebrewOverrideFont = Measured & HebrewFont;

const measured = (id: string): Measured => {
  const built: BuiltFont | undefined = BUILT_FONTS[id];
  if (!built) throw new Error(`font "${id}" has no build output — run npm run fonts`);
  return {
    hasTabularNums: built.hasTabularNums,
    digitsEqual: built.digitsEqual,
    digitEm: built.digitEm,
    liningDigits: built.liningDigits,
    variable: built.faces.some((face) => face.weight.includes(" ")),
    latin: built.latin,
    hebrew: built.hebrew,
    nikudOk: built.nikud,
    hebrewMissing: built.hebrewMissing,
  };
};

const fromEnglish = (font: EnglishFont): PickableFont => ({
  ...measured(font.id),
  id: font.id,
  name: font.name,
  category: font.category,
  weights: font.weights,
  minWeight: font.minWeight,
  italic: font.italic,
  capsOnly: Boolean(font.capsOnly),
  license: font.license,
});

/**
 * "Hebrew & English": the Hebrew fonts whose files the build confirmed cover
 * both scripts in full. Noto Rashi Hebrew is left out on purpose — its Latin
 * letters are plain Noto Serif, not Rashi script, so as a face for English
 * text it would be a different font from the one its name promises. It stays
 * in the Hebrew override list, which is what it's for.
 */
const NOT_BILINGUAL = new Set(["noto-rashi-hebrew"]);

/** The order the Hebrew & English category starts with; others follow in
 *  catalog order. */
const BILINGUAL_FIRST = ["heebo", "assistant", "rubik", "ibm-plex-sans-hebrew", "frank-ruhl-libre", "bona-nova"];

const bilingual: PickableFont[] = HEBREW_FONTS.filter((font) => {
  if (font.group === "legacy" || NOT_BILINGUAL.has(font.id)) return false;
  const m = measured(font.id);
  return m.latin && m.hebrew;
})
  .sort((a, b) => {
    const rank = (id: string) => (BILINGUAL_FIRST.includes(id) ? BILINGUAL_FIRST.indexOf(id) : BILINGUAL_FIRST.length);
    return rank(a.id) - rank(b.id);
  })
  .map((font) => ({
    ...measured(font.id),
    id: font.id,
    name: font.name,
    category: "bilingual" as const,
    weights: font.weights.filter((w) => w >= font.minWeight),
    minWeight: font.minWeight,
    italic: font.italic,
    capsOnly: false,
    license: font.license,
    hebrewName: font.hebrewName,
  }));

/** Everything the main font picker offers, in category order. */
export const PICKABLE_FONTS: readonly PickableFont[] = [
  ...bilingual,
  ...ENGLISH_FONTS.filter((f) => f.category === "serif").map(fromEnglish),
  ...ENGLISH_FONTS.filter((f) => f.category === "sans").map(fromEnglish),
  ...ENGLISH_FONTS.filter((f) => f.category === "display").map(fromEnglish),
  ...ENGLISH_FONTS.filter((f) => f.category === "script").map(fromEnglish),
];

export const CATEGORY_LABELS: Record<FontCategory, string> = {
  bilingual: "Hebrew & English",
  serif: "Serif",
  sans: "Sans serif",
  display: "Display",
  script: "Script",
};

/** The Hebrew override list — every Hebrew font but the legacy one. */
export const HEBREW_OVERRIDE_FONTS: readonly HebrewOverrideFont[] = HEBREW_FONTS.filter((f) => f.group !== "legacy").map(
  (font) => ({ ...font, ...measured(font.id) }),
);

const byId = new Map<string, PickableFont>(PICKABLE_FONTS.map((f) => [f.id, f]));
const hebrewById = new Map<string, HebrewFont>(HEBREW_FONTS.map((f) => [f.id, f]));

/**
 * The font names boards were saved with before the catalog (lib/board-theme.ts's
 * old BOARD_FONTS). They keep working: each maps to the catalog face it always
 * was. "system" is the device's own font, which stays outside the catalog.
 */
export const LEGACY_FONT_IDS: Readonly<Record<string, string>> = {
  assistant: "assistant",
  sefarim: "frank-ruhl-libre",
  heebo: "heebo",
  rubik: "rubik",
  alef: "alef",
  davidLibre: "david-libre",
  miriamLibre: "miriam-libre",
  suezOne: "suez-one",
  secularOne: "secular-one",
};

/** A stored font name as a catalog id; `system` stays itself; unknown is null. */
export function catalogId(stored: string | null | undefined): string | "system" | null {
  if (!stored) return null;
  if (stored === "system") return "system";
  if (byId.has(stored) || hebrewById.has(stored)) return stored;
  return LEGACY_FONT_IDS[stored] ?? null;
}

/** A font the picker offers, by id (legacy names too). */
export function pickableFont(stored: string | null | undefined): PickableFont | undefined {
  const id = catalogId(stored);
  return id && id !== "system" ? byId.get(id) : undefined;
}

/** Any Hebrew font by id — override list, fallbacks and legacy alike. */
export function hebrewFont(id: string | null | undefined): HebrewFont | undefined {
  return id ? hebrewById.get(id) : undefined;
}

/** What a face offers, for any catalog id: the main picker's entry, or a
 *  Hebrew font's own (a legacy board may name Miriam Libre). */
export function fontInfo(stored: string | null | undefined): {
  id: string;
  name: string;
  weights: readonly number[];
  minWeight: number;
  italic: boolean;
  measured: Measured;
  generic: "serif" | "sans-serif" | "cursive";
  category: FontCategory;
} | null {
  const id = catalogId(stored);
  if (!id || id === "system") return null;
  const pick = byId.get(id);
  if (pick) {
    return {
      id,
      name: pick.name,
      weights: pick.weights,
      minWeight: pick.minWeight,
      italic: pick.italic,
      measured: pick,
      generic: pick.category === "serif" ? "serif" : pick.category === "script" ? "cursive" : pick.category === "bilingual" ? (hebrewById.get(id)?.generic ?? "sans-serif") : "sans-serif",
      category: pick.category,
    };
  }
  const heb = hebrewById.get(id);
  if (!heb) return null;
  return {
    id,
    name: heb.name,
    weights: heb.weights,
    minWeight: heb.minWeight,
    italic: heb.italic,
    measured: measured(id),
    generic: heb.generic,
    category: "bilingual",
  };
}

/**
 * The weight to draw at: the stored one clamped into what the face offers.
 * Below its minimum it's raised to the minimum (thin strokes vanish on a TV);
 * otherwise the nearest offered weight.
 */
export function clampWeight(stored: string | null | undefined, weight: number | undefined): number {
  const info = fontInfo(stored);
  const wanted = weight ?? 400;
  if (!info) return wanted;
  const allowed = info.weights.filter((w) => w >= info.minWeight);
  if (allowed.length === 0) return wanted;
  if (wanted <= allowed[0]) return allowed[0];
  return allowed.reduce((best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) ? w : best), allowed[0]);
}

/** The weights a face may be drawn at: what it offers, from its minimum up. */
export function offeredWeights(stored: string | null | undefined): number[] {
  const info = fontInfo(stored);
  return info ? info.weights.filter((w) => w >= info.minWeight) : [];
}

/**
 * The weight "bold" means in a face: 700 where it offers it, else the offered
 * weight nearest to 700 from 600 up, else its heaviest. A face with one
 * weight has no bold and draws that one.
 */
export function boldWeight(stored: string | null | undefined): number {
  const weights = offeredWeights(stored);
  if (weights.length === 0) return 700;
  const heavy = weights.filter((w) => w >= 600);
  if (heavy.length === 0) return weights[weights.length - 1];
  return heavy.reduce((best, w) => (Math.abs(w - 700) < Math.abs(best - 700) ? w : best), heavy[0]);
}

/** For a face with old-style figures and no lining set, the fallback whose
 *  digits a time is drawn in: Frank Ruhl Libre for a serif, Heebo otherwise.
 *  Null for every other face. */
export function digitFallbackFor(stored: string | null | undefined): "frank-ruhl-libre" | "heebo" | null {
  const info = fontInfo(stored);
  if (!info || info.measured.liningDigits) return null;
  return info.generic === "serif" ? HEBREW_FALLBACK.serif : HEBREW_FALLBACK.other;
}

/**
 * The last Hebrew face a stack needs, if any: when the Hebrew face it draws in
 * (`hebrewId`) lacks some Hebrew punctuation or nikud, Frank Ruhl Libre after
 * a serif and Assistant after anything else, both confirmed complete by the
 * build. Null when the Hebrew face has everything, or is that fallback.
 */
export function hebrewMarksFallbackFor(stored: string | null | undefined, hebrewId: string | null): string | null {
  if (!hebrewId) return null;
  const hebrewInfo = fontInfo(hebrewId);
  if (!hebrewInfo || hebrewInfo.measured.hebrewMissing.length === 0) return null;
  const info = fontInfo(stored);
  const marks = info?.generic === "serif" ? HEBREW_MARKS_FALLBACK.serif : HEBREW_MARKS_FALLBACK.other;
  return marks === hebrewId ? null : marks;
}

/** The Hebrew fallback a face gets when nothing overrides it: Frank Ruhl
 *  Libre for serifs, Heebo for everything else. A face with its own Hebrew
 *  needs none. */
export function hebrewFallbackFor(stored: string | null | undefined): string | null {
  const info = fontInfo(stored);
  if (!info) return HEBREW_FALLBACK.other;
  if (info.measured.hebrew) return null;
  return info.category === "serif" ? HEBREW_FALLBACK.serif : HEBREW_FALLBACK.other;
}
