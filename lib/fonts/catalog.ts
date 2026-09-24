/*
 * The board font catalog — the single source of truth for every face a board
 * can use. Hand-written here: what each font is, which package it comes from,
 * which weights a gabbai may pick. Measured at build time and merged in from
 * ./catalog.generated.ts (scripts/build-fonts.ts): its files, whether its
 * digits are tabular, the width of its widest digit at each weight, its script
 * coverage and whether it sets nikud properly.
 *
 * SELF-HOSTED, ALWAYS. Every face is a woff2 copied out of its @fontsource
 * package into /fonts at build time — no font host is contacted at runtime,
 * which is what lets a screen with no network still draw its board.
 *
 * Every font here is SIL Open Font License 1.1 (Google Fonts), recorded per
 * entry so the list can be audited without opening each package.
 *
 * Plain TypeScript with relative imports only, so the build script and Node
 * tests can import it.
 */

export type FontCategory = "serif" | "sans" | "display" | "script" | "bilingual";

/** A face as the catalog knows it — English and Hebrew alike. */
type FontSource = {
  /** The stable id board documents store. Never renamed. */
  id: string;
  /** The family name as people know it, and as CSS declares it. */
  name: string;
  /** The @fontsource package the files come from. */
  package: string;
  license: "OFL-1.1";
};

export type EnglishFont = FontSource & {
  category: Exclude<FontCategory, "bilingual">;
  /** The weights a board may use, lightest first. */
  weights: readonly number[];
  /** Nothing lighter is offered: thin strokes vanish on a TV across a room.
   *  An element saved with a lighter weight is drawn at this one. */
  minWeight: number;
  italic: boolean;
  /** Draws capitals only (Cinzel, Bebas Neue) — the picker says so. */
  capsOnly?: boolean;
};

export type HebrewGroup = "classic" | "clean" | "personality" | "special";

export type HebrewFont = FontSource & {
  group: HebrewGroup | "legacy";
  /** The name in Hebrew, shown (in the font) in the picker. */
  hebrewName: string;
  /** A friendlier name where the family name says little ("Rashi script"). */
  label?: string;
  /** Serif or sans, for the generic family at the end of its stack. */
  generic: "serif" | "sans-serif";
  weights: readonly number[];
  minWeight: number;
  italic: boolean;
};

const OFL = "OFL-1.1" as const;

const range = (from: number, to: number) => Array.from({ length: (to - from) / 100 + 1 }, (_, i) => from + i * 100);

const english = (
  id: string,
  name: string,
  category: EnglishFont["category"],
  weights: readonly number[],
  options: { variable?: boolean; italic?: boolean; minWeight?: number; capsOnly?: boolean } = {},
): EnglishFont => ({
  id,
  name,
  category,
  package: `@fontsource${options.variable ? "-variable" : ""}/${id}`,
  license: OFL,
  weights,
  minWeight: options.minWeight ?? weights[0],
  italic: options.italic ?? false,
  ...(options.capsOnly ? { capsOnly: true } : {}),
});

export const ENGLISH_FONTS: readonly EnglishFont[] = [
  // Serif — Hebrew falls back to Frank Ruhl Libre.
  english("cinzel", "Cinzel", "serif", range(400, 900), { variable: true, capsOnly: true }),
  english("playfair-display", "Playfair Display", "serif", range(400, 900), { variable: true, italic: true }),
  english("eb-garamond", "EB Garamond", "serif", range(400, 800), { variable: true, italic: true }),
  english("cormorant-garamond", "Cormorant Garamond", "serif", range(500, 700), { variable: true, italic: true, minWeight: 500 }),
  english("libre-baskerville", "Libre Baskerville", "serif", [400, 700], { variable: true, italic: true }),
  english("marcellus", "Marcellus", "serif", [400]),
  english("dm-serif-display", "DM Serif Display", "serif", [400], { italic: true }),
  english("fraunces", "Fraunces", "serif", range(400, 900), { variable: true }),
  english("lora", "Lora", "serif", range(400, 700), { variable: true, italic: true }),
  english("crimson-pro", "Crimson Pro", "serif", range(400, 800), { variable: true, italic: true }),
  english("bodoni-moda", "Bodoni Moda", "serif", range(400, 900), { variable: true, italic: true }),
  // Sans — Hebrew falls back to Heebo.
  english("inter", "Inter", "sans", range(400, 900), { variable: true }),
  english("montserrat", "Montserrat", "sans", range(400, 900), { variable: true, italic: true }),
  english("lato", "Lato", "sans", [400, 700, 900], { italic: true }),
  english("josefin-sans", "Josefin Sans", "sans", range(400, 700), { variable: true }),
  english("raleway", "Raleway", "sans", range(400, 900), { variable: true }),
  english("outfit", "Outfit", "sans", range(400, 900), { variable: true }),
  english("figtree", "Figtree", "sans", range(400, 900), { variable: true }),
  english("work-sans", "Work Sans", "sans", range(400, 900), { variable: true }),
  english("poppins", "Poppins", "sans", range(400, 900)),
  // Display — Heebo.
  english("abril-fatface", "Abril Fatface", "display", [400]),
  english("bebas-neue", "Bebas Neue", "display", [400], { capsOnly: true }),
  english("oswald", "Oswald", "display", range(400, 700), { variable: true }),
  // Script — Heebo. For titles and accents, not running text.
  english("great-vibes", "Great Vibes", "script", [400]),
  english("pinyon-script", "Pinyon Script", "script", [400]),
  english("parisienne", "Parisienne", "script", [400]),
  english("dancing-script", "Dancing Script", "script", range(400, 700), { variable: true }),
  english("caveat", "Caveat", "script", range(400, 700), { variable: true }),
];

const hebrew = (
  id: string,
  name: string,
  hebrewName: string,
  group: HebrewFont["group"],
  generic: HebrewFont["generic"],
  weights: readonly number[],
  options: { variable?: boolean; italic?: boolean; minWeight?: number; label?: string } = {},
): HebrewFont => ({
  id,
  name,
  hebrewName,
  group,
  generic,
  package: `@fontsource${options.variable ? "-variable" : ""}/${id}`,
  license: OFL,
  weights,
  minWeight: options.minWeight ?? Math.max(400, weights[0]),
  italic: options.italic ?? false,
  ...(options.label ? { label: options.label } : {}),
});

/** The Hebrew override list, in picker order, and the two automatic
 *  fallbacks. Frank Ruhl Libre and Heebo are declared across 300–900 so a
 *  bold English line gets a matching bold Hebrew one. */
export const HEBREW_FONTS: readonly HebrewFont[] = [
  hebrew("frank-ruhl-libre", "Frank Ruhl Libre", "פרנק רוהל", "classic", "serif", range(300, 900), { variable: true }),
  hebrew("david-libre", "David Libre", "דוד", "classic", "serif", [400, 500, 700]),
  hebrew("noto-serif-hebrew", "Noto Serif Hebrew", "נוטו סריף", "classic", "serif", range(100, 900), { variable: true }),
  hebrew("bona-nova", "Bona Nova", "בונה נובה", "classic", "serif", [400, 700], { italic: true }),
  hebrew("heebo", "Heebo", "היבו", "clean", "sans-serif", range(100, 900), { variable: true }),
  hebrew("assistant", "Assistant", "אסיסטנט", "clean", "sans-serif", range(200, 800), { variable: true }),
  hebrew("rubik", "Rubik", "רוביק", "clean", "sans-serif", range(300, 900), { variable: true, italic: true }),
  hebrew("ibm-plex-sans-hebrew", "IBM Plex Sans Hebrew", "פלקס", "clean", "sans-serif", range(100, 700)),
  hebrew("alef", "Alef", "אלף", "clean", "sans-serif", [400, 700]),
  hebrew("suez-one", "Suez One", "סואץ", "personality", "serif", [400]),
  hebrew("secular-one", "Secular One", "סקולר", "personality", "sans-serif", [400]),
  hebrew("bellefair", "Bellefair", "בלפר", "personality", "serif", [400]),
  hebrew("karantina", "Karantina", "קרנטינה", "personality", "sans-serif", [300, 400, 700]),
  hebrew("amatic-sc", "Amatic SC", "אמטיק", "personality", "sans-serif", [400, 700]),
  hebrew("noto-rashi-hebrew", "Noto Rashi Hebrew", "כתב רש״י", "special", "serif", range(100, 900), {
    variable: true,
    label: "Rashi script",
  }),
  hebrew("playpen-sans-hebrew", "Playpen Sans Hebrew", "כתב יד", "special", "sans-serif", range(100, 800), {
    variable: true,
    label: "Handwriting",
  }),
  // Kept only because boards were saved with it before the catalog existed.
  hebrew("miriam-libre", "Miriam Libre", "מרים", "legacy", "sans-serif", range(400, 700), { variable: true }),
];

/** Fonts every board may need whatever it picks: the two automatic Hebrew
 *  fallbacks. */
export const HEBREW_FALLBACK = { serif: "frank-ruhl-libre", other: "heebo" } as const;

export const HEBREW_GROUPS: { id: HebrewGroup; label: string }[] = [
  { id: "classic", label: "Classic" },
  { id: "clean", label: "Clean" },
  { id: "personality", label: "Personality" },
  { id: "special", label: "Special" },
];
