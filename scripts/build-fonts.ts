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
import { ENGLISH_FONTS, HEBREW_FONTS } from "../lib/fonts/catalog.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "public/fonts");
const GENERATED = join(ROOT, "lib/fonts/catalog.generated.ts");

type Face = { subset: string; style: "normal" | "italic"; weight: string; url: string; unicodeRange: string };

type Built = {
  faces: Face[];
  hasTabularNums: boolean;
  /** Widest digit, in em, at each offered weight (normal style). */
  digitEm: Record<number, number>;
  /** Its default digits are already one width (Heebo), tnum or not. */
  digitsEqual: boolean;
  latin: boolean;
  hebrew: boolean;
  nikud: boolean;
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

/** The widest of 0–9, in em. */
const widestDigit = (font: AnyFont) => {
  let widest = 0;
  for (let d = 0; d <= 9; d += 1) widest = Math.max(widest, font.glyphForCodePoint(0x30 + d).advanceWidth);
  return Math.round((widest / font.unitsPerEm) * 10000) / 10000;
};

/** Whether 0–9 all share one advance in the default figures. */
const digitsEqual = (font: AnyFont) => {
  const widths = new Set<number>();
  for (let d = 0; d <= 9; d += 1) widths.add(font.glyphForCodePoint(0x30 + d).advanceWidth);
  return widths.size === 1;
};

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
  let hebrewHeight: number | null = null;
  if (withHebrew) {
    const hebrewFile = Object.entries(local).find(([key]) => key.startsWith("hebrew-normal"))?.[1];
    if (hebrewFile) {
      const hf = await open(hebrewFile);
      hebrew = all(hf, 0x05d0, 0x05ea);
      nikud = NIKUD.every((c) => has(hf, c)) && (hf.availableFeatures ?? []).includes("mark");
      hebrewHeight = Math.round((["ב", "ה", "מ", "ר", "ש"].reduce((sum, c) => sum + top(hf, c), 0) / 5) * 10000) / 10000;
    }
  }

  return {
    faces,
    hasTabularNums: (base.availableFeatures ?? []).includes("tnum"),
    digitEm,
    digitsEqual: digitsEqual(base),
    latin: all(base, 0x41, 0x5a) && all(base, 0x61, 0x7a) && all(base, 0x30, 0x39),
    hebrew,
    nikud,
    metrics: {
      capHeight: Math.round(top(base, "H") * 10000) / 10000,
      xHeight: Math.round(top(base, "x") * 10000) / 10000,
      hebrewHeight,
    },
  };
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const built: Record<string, Built> = {};
for (const font of ENGLISH_FONTS) built[font.id] = await build(font, false);
for (const font of HEBREW_FONTS) built[font.id] = await build(font, true);

const body = `// Generated by scripts/build-fonts.ts from the pinned @fontsource packages — don't edit.
// Run \`npm run fonts\` after changing lib/fonts/catalog.ts or a font package.

export type BuiltFace = { subset: string; style: "normal" | "italic"; weight: string; url: string; unicodeRange: string };

export type BuiltFont = {
  faces: BuiltFace[];
  /** Has the 'tnum' OpenType feature. */
  hasTabularNums: boolean;
  /** The widest digit, in em, at each offered weight. */
  digitEm: Record<number, number>;
  /** Its default digits are already all one width. */
  digitsEqual: boolean;
  /** Covers A–Z, a–z and 0–9. */
  latin: boolean;
  /** Covers the Hebrew letters א–ת. */
  hebrew: boolean;
  /** Has every nikud point and positions them (GPOS mark). */
  nikud: boolean;
  metrics: { capHeight: number; xHeight: number; hebrewHeight: number | null };
};

export const BUILT_FONTS: Record<string, BuiltFont> = ${JSON.stringify(built, null, 2)};
`;
writeFileSync(GENERATED, body);

const files = Object.values(built).reduce((n, b) => n + b.faces.length, 0);
console.log(`fonts: ${Object.keys(built).length} families, ${files} files in public/fonts`);
