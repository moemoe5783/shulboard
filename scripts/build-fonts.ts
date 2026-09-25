/**
 * Builds the self-hosted board fonts — lib/fonts/catalog.ts's other half.
 *
 * For every catalog font it:
 *   1. copies only the woff2 files a board can use out of its @fontsource
 *      package into public/fonts/<id>/, named by content hash so a URL names
 *      one file forever (the service worker caches them like photos): latin and
 *      latin-ext for every face, plus hebrew for the Hebrew fonts, normal and
 *      (where offered) italic, one variable file or one file per weight;
 *   2. measures each face with fontkit, reading the font files themselves
 *      rather than trusting a list: whether it has tabular figures ('tnum'),
 *      its widest digit at every offered weight (variable fonts are
 *      instanced at each one), whether it covers Latin and Hebrew fully, whether
 *      it sets nikud properly (every point, and GPOS mark positioning), and
 *      the heights the Hebrew size-matching is derived from;
 *   3. writes lib/fonts/catalog.generated.ts.
 *
 * Runs before every build and dev server (package.json prebuild / predev), so
 * public/fonts is never committed and never stale. The generated TS is
 * committed — it is deterministic from the pinned packages — so typecheck and
 * tests work without running this first.
 *
 * Run with: npm run fonts
 */

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fontkit from "fontkit";
import { decompress } from "wawoff2";
import { DIGIT_FAMILIES, ENGLISH_FONTS, HEBREW_FONTS, HEBREW_MARKS_FALLBACK, HEBREW_PUNCTUATION } from "../lib/fonts/catalog.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "public/fonts");
const GENERATED = join(ROOT, "lib/fonts/catalog.generated.ts");

type Face = { subset: string; style: "normal" | "italic"; weight: string; url: string; unicodeRange: string };

type Built = {
  faces: Face[];
  hasTabularNums: boolean;
  /** Widest digit, in em, at each offered weight (normal style). */
  digitEm: Record<number, number>;
  /** Its digits, as a time widget draws them, are already one width. */
  digitsEqual: boolean;
  /** Has the 'lnum' OpenType feature. */
  hasLiningNums: boolean;
  /** Its digits, as drawn (lnum on where it has it), are lining. */
  liningDigits: boolean;
  /** Has a glyph for every digit 0–9. */
  digits: boolean;
  latin: boolean;
  hebrew: boolean;
  nikud: boolean;
  hebrewMissing: string[];
  metrics: { capHeight: number; xHeight: number; hebrewHeight: number | null };
};

// Anything fontkit hands back; its types don't cover the parts read here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFont = any;

/** Open a woff2 as plain TrueType: fontkit instances variable fonts
 *  (getVariation) from TrueType but not from WOFF2. */
const open = async (path: string): Promise<AnyFont> => fontkit.create(Buffer.from(await decompress(readFileSync(path))));

const has = (font: AnyFont, codePoint: number) => font.hasGlyphForCodePoint(codePoint);
const all = (font: AnyFont, from: number, to: number) => {
  for (let c = from; c <= to; c += 1) if (!has(font, c)) return false;
  return true;
};

/** A glyph's top, in em. */
const top = (font: AnyFont, char: string) => {
  const glyph = font.glyphForCodePoint(char.codePointAt(0)!);
  return glyph?.bbox ? glyph.bbox.maxY / font.unitsPerEm : 0;
};

const DIGITS = "0123456789";

/**
 * The digits as a time widget draws them: with lining figures switched on
 * where the face has them (widgets/Digits.tsx sets `lining-nums
 * tabular-nums`), so widths and heights are measured on the same glyphs the
 * board shows — Playfair Display's default figures are old-style, its lining
 * ones are what a clock uses.
 */
const digitRun = (font: AnyFont) => {
  const features = (font.availableFeatures ?? []).includes("lnum") ? ["lnum"] : [];
  return font.layout(DIGITS, features);
};

/** The widest of 0–9 as drawn, in em. */
const widestDigit = (font: AnyFont) => {
  const widest = Math.max(...digitRun(font).positions.map((p: { xAdvance: number }) => p.xAdvance));
  return Math.round((widest / font.unitsPerEm) * 10000) / 10000;
};

/** Whether 0–9 all share one advance as drawn. */
const digitsEqual = (font: AnyFont) =>
  new Set(digitRun(font).positions.map((p: { xAdvance: number }) => Math.round(p.xAdvance))).size === 1;

/**
 * Whether the digits as drawn are lining — all one height, standing on the
 * baseline — rather than old-style (3, 4, 5, 7 and 9 dropping below it, 6 and 8
 * rising above the rest). Read from the glyphs' own extents.
 */
const liningDigits = (font: AnyFont) => {
  const glyphs = digitRun(font).glyphs.filter((g: AnyFont) => g.bbox);
  const tops = glyphs.map((g: AnyFont) => g.bbox.maxY / font.unitsPerEm);
  const bottoms = glyphs.map((g: AnyFont) => g.bbox.minY / font.unitsPerEm);
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
  // Spreads, not absolute positions: a script face whose figures all hang the
  // same small way below the line (Dancing Script) is still lining, and a
  // hand-drawn one wobbles a few hundredths (Caveat); old-style figures drop
  // 0.10–0.27 em.
  return spread(tops) < 0.08 && spread(bottoms) < 0.08;
};

/** Whether the face has a glyph for every digit 0–9. */
const hasDigits = (font: AnyFont) => DIGITS.split("").every((d) => font.hasGlyphForCodePoint(d.codePointAt(0)!));

/** The nikud points, and whether the font positions them over letters. */
const NIKUD = [0x05b0, 0x05b1, 0x05b2, 0x05b3, 0x05b4, 0x05b5, 0x05b6, 0x05b7, 0x05b8, 0x05b9, 0x05bb, 0x05bc, 0x05c1, 0x05c2, 0x05c7];

async function build(
  font: { id: string; package: string; weights: readonly number[]; italic: boolean },
  withHebrew: boolean,
): Promise<Built> {
  const dir = join(ROOT, "node_modules", font.package);
  const metadata = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"));
  const unicode = JSON.parse(readFileSync(join(dir, "unicode.json"), "utf8")) as Record<string, string>;
  const variable = Boolean(metadata.variable?.wght);
  const subsets = ["latin", "latin-ext", ...(withHebrew ? ["hebrew"] : [])].filter((s) => metadata.subsets.includes(s));
  const styles: ("normal" | "italic")[] = font.italic && metadata.styles.includes("italic") ? ["normal", "italic"] : ["normal"];

  const faces: Face[] = [];
  const local: Record<string, string> = {};
  mkdirSync(join(OUT, font.id), { recursive: true });
  const place = (file: string, subset: string, style: Face["style"], weight: string) => {
    const source = join(dir, "files", file);
    if (!existsSync(source)) {
      // An italic a package doesn't cut at some weight (Bona Nova's is 400
      // only) is left out; the browser slants the upright there. A missing
      // upright is a catalog error.
      if (style === "italic") return;
      throw new Error(`${font.package} has no ${file}`);
    }
    const hash = createHash("sha256").update(readFileSync(source)).digest("hex").slice(0, 10);
    const name = file.replace(/\.woff2$/, `.${hash}.woff2`).replace(`${metadata.id}-`, "");
    copyFileSync(source, join(OUT, font.id, name));
    faces.push({ subset, style, weight, url: `/fonts/${font.id}/${name}`, unicodeRange: unicode[subset] });
    local[`${subset}-${style}-${weight}`] = source;
  };

  for (const subset of subsets) {
    for (const style of styles) {
      if (variable) {
        const { min, max } = metadata.variable.wght;
        place(`${metadata.id}-${subset}-wght-${style}.woff2`, subset, style, `${min} ${max}`);
      } else {
        for (const weight of font.weights) {
          if (metadata.weights.includes(weight)) place(`${metadata.id}-${subset}-${weight}-${style}.woff2`, subset, style, String(weight));
        }
      }
    }
  }

  // Measure on the normal, latin face(s).
  const latinFace = (weight: number) =>
    variable ? local[`latin-normal-${metadata.variable.wght.min} ${metadata.variable.wght.max}`] : local[`latin-normal-${weight}`];
  const base = await open(latinFace(font.weights.includes(400) ? 400 : font.weights[0]));
  const digitEm: Record<number, number> = {};
  for (const weight of font.weights) {
    if (variable) {
      const { min, max } = metadata.variable.wght;
      const clamped = Math.min(Number(max), Math.max(Number(min), weight));
      digitEm[weight] = widestDigit(base.getVariation({ wght: clamped }));
    } else if (latinFace(weight)) {
      digitEm[weight] = widestDigit(await open(latinFace(weight)));
    }
  }

  let hebrew = false;
  let nikud = false;
  let hebrewMissing: string[] = [];
  let hebrewHeight: number | null = null;
  if (withHebrew) {
    const hebrewFile = Object.entries(local).find(([key]) => key.startsWith("hebrew-normal"))?.[1];
    if (hebrewFile) {
      const hf = await open(hebrewFile);
      hebrew = all(hf, 0x05d0, 0x05ea);
      nikud = NIKUD.every((c) => has(hf, c)) && (hf.availableFeatures ?? []).includes("mark");
      hebrewMissing = [
        ...Object.entries(HEBREW_PUNCTUATION).filter(([, c]) => !has(hf, c)).map(([name]) => name),
        ...NIKUD.filter((c) => !has(hf, c)).map((c) => `U+${c.toString(16).toUpperCase().padStart(4, "0")}`),
      ];
      hebrewHeight = Math.round((["ב", "ה", "מ", "ר", "ש"].reduce((sum, c) => sum + top(hf, c), 0) / 5) * 10000) / 10000;
    }
  }

  return {
    faces,
    hasTabularNums: (base.availableFeatures ?? []).includes("tnum"),
    digitEm,
    digitsEqual: digitsEqual(base),
    hasLiningNums: (base.availableFeatures ?? []).includes("lnum"),
    liningDigits: liningDigits(base),
    digits: hasDigits(base),
    latin: all(base, 0x41, 0x5a) && all(base, 0x61, 0x7a) && all(base, 0x30, 0x39),
    hebrew,
    nikud,
    hebrewMissing,
    metrics: {
      capHeight: Math.round(top(base, "H") * 10000) / 10000,
      xHeight: Math.round(top(base, "x") * 10000) / 10000,
      hebrewHeight,
    },
  };
}

// ---------------------------------------------------------------------------
// Hebrew size matching
// ---------------------------------------------------------------------------
//
// Hebrew letters sit between Latin x-height and cap height, and at the same
// font-size most Hebrew faces read smaller than the Latin beside them. Each
// Hebrew face gets a `size-adjust` so its letters stand as tall as the Latin
// they're mixed with: the target is the midpoint of the English face's cap
// height and x-height (its cap height when it draws capitals only), over the
// Hebrew face's own letter height. One value per Hebrew face — the median of
// its pairings — and a separate per-pairing alias only where one English face
// needs something clearly different (over 8% off), e.g. a capitals-only face.

const round = (n: number, step = 0.01) => Math.round(n / step) * step;

type Alias = { family: string; sizeAdjust: number };
type HebrewAliases = Record<string, { base: Alias; pairings: Record<string, Alias> }>;

function hebrewAliases(built: Record<string, Built>): HebrewAliases {
  const target = (font: (typeof ENGLISH_FONTS)[number]) => {
    const m = built[font.id].metrics;
    return font.capsOnly ? m.capHeight : (m.capHeight + m.xHeight) / 2;
  };
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const out: HebrewAliases = {};
  for (const hebrew of HEBREW_FONTS) {
    const height = built[hebrew.id].metrics.hebrewHeight;
    if (!height) continue;
    // Frank Ruhl Libre is the serifs' fallback, Heebo everyone else's; every
    // other face is only ever chosen as an override, against any face.
    const partners = ENGLISH_FONTS.filter((f) =>
      hebrew.id === "frank-ruhl-libre" ? f.category === "serif" : hebrew.id === "heebo" ? f.category !== "serif" : true,
    );
    const values = partners.filter((f) => !f.capsOnly).map((f) => target(f) / height);
    const base = { family: `${hebrew.name} Hebrew`, sizeAdjust: round(median(values)) };
    const pairings: Record<string, Alias> = {};
    if (hebrew.id === "frank-ruhl-libre" || hebrew.id === "heebo") {
      for (const partner of partners) {
        const value = round(target(partner) / height);
        if (Math.abs(value / base.sizeAdjust - 1) > 0.08) {
          pairings[partner.id] = { family: `${hebrew.name} Hebrew for ${partner.name}`, sizeAdjust: value };
        }
      }
    }
    out[hebrew.id] = { base, pairings };
  }
  return out;
}

// ---------------------------------------------------------------------------
// The one stylesheet
// ---------------------------------------------------------------------------
//
// Every @font-face a board can use, in one file the root layout links, so the
// editor and a screen declare exactly the same faces (CLAUDE.md: one
// renderer). Declaring a face downloads nothing: a browser fetches a file only
// when text on the page uses that family and falls in its unicode-range — so
// a board downloads its own fonts, and a Hebrew alias's file only arrives when
// Hebrew text does.

const HEBREW_RANGE = "U+0590-05FF, U+FB1D-FB4F";

function stylesheet(built: Record<string, Built>, aliases: HebrewAliases): string {
  const rules: string[] = [];
  const face = (family: string, f: Face, extra = "") =>
    `@font-face{font-family:"${family}";src:url(${f.url}) format("woff2");font-weight:${f.weight};font-style:${f.style};font-display:swap;unicode-range:${f.unicodeRange};${extra}}`;
  for (const font of [...ENGLISH_FONTS, ...HEBREW_FONTS]) {
    for (const f of built[font.id].faces) rules.push(face(font.name, f));
  }
  for (const [id, { base, pairings }] of Object.entries(aliases)) {
    for (const alias of [base, ...Object.values(pairings)]) {
      for (const f of built[id].faces.filter((x) => x.subset === "hebrew")) {
        rules.push(face(alias.family, { ...f, unicodeRange: HEBREW_RANGE }, `size-adjust:${Math.round(alias.sizeAdjust * 100)}%;`));
      }
    }
  }
  // Digit-only copies of the two fallbacks (lib/fonts/catalog.ts, DIGIT_FAMILIES).
  for (const [id, family] of Object.entries(DIGIT_FAMILIES)) {
    for (const f of built[id].faces.filter((x) => x.subset === "latin")) {
      rules.push(face(family, { ...f, unicodeRange: "U+0030-0039" }));
    }
  }
  return `/* Board fonts — generated by scripts/build-fonts.ts. */\n${rules.join("\n")}\n`;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const built: Record<string, Built> = {};
for (const font of ENGLISH_FONTS) built[font.id] = await build(font, false);
for (const font of HEBREW_FONTS) built[font.id] = await build(font, true);

const aliases = hebrewAliases(built);
const css = stylesheet(built, aliases);
const cssName = `faces.${createHash("sha256").update(css).digest("hex").slice(0, 10)}.css`;
writeFileSync(join(OUT, cssName), css);

const body = `// Generated by scripts/build-fonts.ts from the pinned @fontsource packages — don't edit.
// Run \`npm run fonts\` after changing lib/fonts/catalog.ts or a font package.

export type BuiltFace = { subset: string; style: "normal" | "italic"; weight: string; url: string; unicodeRange: string };

export type BuiltFont = {
  faces: BuiltFace[];
  /** Has the 'tnum' OpenType feature. */
  hasTabularNums: boolean;
  /** The widest digit, in em, at each offered weight. */
  digitEm: Record<number, number>;
  /** Its digits, as a time widget draws them, are already all one width. */
  digitsEqual: boolean;
  /** Has the 'lnum' OpenType feature. */
  hasLiningNums: boolean;
  /** Its digits as drawn (lnum on where it has it) are lining, not old-style. */
  liningDigits: boolean;
  /** Has a glyph for every digit 0–9. */
  digits: boolean;
  /** Covers A–Z, a–z and 0–9. */
  latin: boolean;
  /** Covers the Hebrew letters א–ת. */
  hebrew: boolean;
  /** Has every nikud point and positions them (GPOS mark). */
  nikud: boolean;
  /** Hebrew punctuation and nikud points it has no glyph for — drawn from
   *  the marks fallback (lib/fonts/catalog.ts, HEBREW_MARKS_FALLBACK). */
  hebrewMissing: string[];
  metrics: { capHeight: number; xHeight: number; hebrewHeight: number | null };
};

export const BUILT_FONTS: Record<string, BuiltFont> = ${JSON.stringify(built, null, 2)};

/** Each Hebrew face's size-matched, Hebrew-only family: \`base\` for any
 *  English face, and a per-pairing one where an English face needs its own. */
export const HEBREW_ALIASES: Record<string, { base: { family: string; sizeAdjust: number }; pairings: Record<string, { family: string; sizeAdjust: number }> }> = ${JSON.stringify(aliases, null, 2)};

/** The stylesheet declaring every face (the root layout links it). */
export const FONT_FACES_CSS = "/fonts/${cssName}";
`;
writeFileSync(GENERATED, body);

const files = Object.values(built).reduce((n, b) => n + b.faces.length, 0);
console.log(`fonts: ${Object.keys(built).length} families, ${files} files in public/fonts`);

// The build report: how each face will set a column of times, and any face
// that can't — old-style figures with no lining alternative, or a missing
// digit — flagged for a decision (drop it, or special-case it).
const flags: string[] = [];
for (const id of Object.values(HEBREW_MARKS_FALLBACK)) {
  if (built[id].hebrewMissing.length || !built[id].nikud) {
    throw new Error(`the Hebrew marks fallback ${id} lacks ${built[id].hebrewMissing.join(", ") || "nikud positioning"}`);
  }
}
for (const font of [...ENGLISH_FONTS, ...HEBREW_FONTS]) {
  const b = built[font.id];
  if (b.hebrewMissing.length) {
    const serif = "generic" in font ? font.generic === "serif" : font.category === "serif";
    flags.push(`${font.name}: no ${b.hebrewMissing.join(", ")} — drawn from ${serif ? "Frank Ruhl Libre" : "Assistant"}`);
  }
  if (!b.digits) flags.push(`${font.name}: no complete digit set`);
  else if (!b.liningDigits) {
    const fallback = ("generic" in font ? font.generic === "serif" : font.category === "serif") ? "Frank Ruhl Libre" : "Heebo";
    flags.push(`${font.name}: old-style figures, no lining set — times take ${fallback}'s digits`);
  }
}
const method = (b: Built) => (b.hasTabularNums ? "tnum" : "digit boxes");
const counts = Object.values(built).reduce<Record<string, number>>((acc, b) => {
  acc[method(b)] = (acc[method(b)] ?? 0) + 1;
  return acc;
}, {});
console.log(`fonts: times line up by ${Object.entries(counts).map(([k, v]) => `${k} ×${v}`).join(", ")}`);
console.log(flags.length ? `fonts: FLAGGED\n${flags.map((f) => `  - ${f}`).join("\n")}` : "fonts: no face flagged");
