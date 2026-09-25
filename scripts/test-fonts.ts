/**
 * The board font catalog (lib/fonts): every font is self-hosted, licensed,
 * measured and offered the way the spec says.
 *
 * Run with: npm run test:fonts
 */

import { existsSync, readFileSync } from "node:fs";
import { digitWidthVars, matchedWeight, numericFace, numericWeight } from "../lib/board-theme.ts";
import { join } from "node:path";
import { BUILT_FONTS } from "../lib/fonts/catalog.generated.ts";
import { ENGLISH_FONTS, HEBREW_FONTS } from "../lib/fonts/catalog.ts";
import {
  catalogId,
  boldWeight,
  clampWeight,
  offeredWeights,
  hebrewFallbackFor,
  HEBREW_OVERRIDE_FONTS,
  LEGACY_FONT_IDS,
  PICKABLE_FONTS,
  pickableFont,
} from "../lib/fonts/index.ts";
import { boardFontRoles, resolveElementFont } from "../lib/fonts/roles.ts";
import { boardFonts } from "../lib/fonts/board-fonts.ts";
import { FONT_THEMES, fontThemePatch, matchesFontTheme, newBoardFontOverrides } from "../lib/fonts/themes.ts";
import { fontStack, resolvedHebrew } from "../lib/fonts/stack.ts";

const results: { ok: boolean; label: string }[] = [];
function check(ok: boolean, label: string, detail = "") {
  results.push({ ok, label });
  console.log(`${ok ? "  ok     " : "  FAILED "} ${label}${detail ? ` — ${detail}` : ""}`);
}

const ROOT = new URL("..", import.meta.url).pathname;
const all = [...ENGLISH_FONTS, ...HEBREW_FONTS];

console.log("\n-- sourcing -----------------------------------------------------");
check(all.every((f) => f.license === "OFL-1.1"), "every font records its licence (OFL-1.1)");
check(all.every((f) => f.package.startsWith("@fontsource")), "every font comes from an @fontsource package");
const faces = Object.values(BUILT_FONTS).flatMap((b) => b.faces);
check(faces.every((f) => f.url.startsWith("/fonts/") && f.url.endsWith(".woff2")), "every face is a self-hosted woff2 under /fonts", `${faces.length} faces`);
check(faces.every((f) => /\.[0-9a-f]{10}\.woff2$/.test(f.url)), "every file name carries its content hash");
const onDisk = faces.filter((f) => existsSync(join(ROOT, "public", f.url)));
check(onDisk.length === faces.length || onDisk.length === 0, "public/fonts matches the generated list (or hasn't been built yet)", `${onDisk.length} of ${faces.length}`);
check(
  ENGLISH_FONTS.every((f) => BUILT_FONTS[f.id].faces.every((face) => face.subset === "latin" || face.subset === "latin-ext")),
  "English fonts ship latin and latin-ext only",
);
check(
  HEBREW_FONTS.every((f) => BUILT_FONTS[f.id].faces.some((face) => face.subset === "hebrew")),
  "Hebrew fonts ship their hebrew subset",
);
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
check(!JSON.stringify(pkg).includes("fonts.googleapis"), "nothing points at the Google Fonts CDN");

console.log("\n-- the English catalog -------------------------------------------");
check(ENGLISH_FONTS.length === 28, "28 English fonts", String(ENGLISH_FONTS.length));
check(ENGLISH_FONTS.every((f) => f.weights.includes(f.minWeight) && f.weights.every((w) => w >= f.minWeight)), "no English font offers a weight below its minimum");
check(ENGLISH_FONTS.find((f) => f.id === "cormorant-garamond")?.minWeight === 500, "Cormorant Garamond starts at 500");
check(ENGLISH_FONTS.filter((f) => f.capsOnly).map((f) => f.id).sort().join() === "bebas-neue,cinzel", "Cinzel and Bebas Neue are capitals only");
check(
  ENGLISH_FONTS.every((f) => f.weights.every((w) => typeof BUILT_FONTS[f.id].digitEm[w] === "number")),
  "every English font has a measured digit width at every offered weight",
);
const playfair = BUILT_FONTS["playfair-display"].digitEm;
check(playfair[900] > playfair[400], "variable fonts are measured per weight (Playfair's digits widen with weight)", `${playfair[400]} → ${playfair[900]}`);

console.log("\n-- Hebrew & English ------------------------------------------------");
const bilingual = PICKABLE_FONTS.filter((f) => f.category === "bilingual").map((f) => f.id);
for (const id of ["heebo", "assistant", "rubik", "ibm-plex-sans-hebrew", "frank-ruhl-libre", "bona-nova"]) {
  check(bilingual.includes(id), `${id} is offered as Hebrew & English`);
}
check(bilingual.every((id) => BUILT_FONTS[id].latin && BUILT_FONTS[id].hebrew), "every Hebrew & English face covers both scripts in full");
check(!bilingual.includes("noto-rashi-hebrew"), "Noto Rashi Hebrew isn't (its Latin isn't Rashi script)");
check(!bilingual.includes("miriam-libre"), "the legacy Miriam Libre isn't offered");
check(hebrewFallbackFor("heebo") === null, "a Hebrew & English face needs no Hebrew fallback");

console.log("\n-- Hebrew fallback and override ------------------------------------");
check(hebrewFallbackFor("playfair-display") === "frank-ruhl-libre", "a serif falls back to Frank Ruhl Libre");
for (const id of ["inter", "bebas-neue", "great-vibes"]) check(hebrewFallbackFor(id) === "heebo", `${id} falls back to Heebo`);
for (const id of ["frank-ruhl-libre", "heebo"]) {
  const weight = BUILT_FONTS[id].faces.find((f) => f.subset === "hebrew")!.weight;
  const [lo, hi] = weight.split(" ").map(Number);
  check(lo <= 300 && hi >= 900, `${id} covers 300–900 for matching weights`, weight);
}
check(HEBREW_OVERRIDE_FONTS.length === 15, "15 Hebrew override fonts (the spec's 16, less Alef)", String(HEBREW_OVERRIDE_FONTS.length));
check(!HEBREW_OVERRIDE_FONTS.some((f) => f.id === "alef") && !PICKABLE_FONTS.some((f) => f.id === "alef"), "Alef is in no picker");
check(catalogId("alef") === "alef" && catalogId("alef") !== null, "but a board that uses Alef still resolves it");
check(HEBREW_OVERRIDE_FONTS.find((f) => f.id === "noto-serif-hebrew")?.nikudOk === true, "Noto Serif Hebrew sets nikud");

console.log("\n-- boards saved before the catalog -------------------------------");
for (const [legacy, id] of Object.entries(LEGACY_FONT_IDS)) check(catalogId(legacy) === id, `"${legacy}" still names ${id}`);
check(catalogId("system") === "system", '"system" stays the device font');
check(pickableFont("sefarim")?.id === "frank-ruhl-libre", "a legacy name resolves in the picker too");

console.log("\n-- weights --------------------------------------------------------");
check(clampWeight("cormorant-garamond", 300) === 500, "a weight below the minimum is drawn at the minimum");
check(clampWeight("lato", 600) === 700 || clampWeight("lato", 600) === 400, "a weight the face lacks becomes its nearest", String(clampWeight("lato", 600)));
check(clampWeight("marcellus", 700) === 400, "a one-weight face stays at its weight");

console.log("\n-- stacks ---------------------------------------------------------");
check(fontStack("playfair-display") === '"Playfair Display", "Frank Ruhl Libre Hebrew", serif', "a serif gets Frank Ruhl Libre's Hebrew", fontStack("playfair-display"));
check(fontStack("montserrat") === '"Montserrat", "Heebo Hebrew", "Assistant Hebrew", sans-serif',
  "a sans gets Heebo's Hebrew, then Assistant for the sof pasuk and paseq Heebo lacks", fontStack("montserrat"));
check(fontStack("great-vibes").endsWith("cursive"), "a script ends in cursive", fontStack("great-vibes"));
check(fontStack("cinzel").includes('"Frank Ruhl Libre Hebrew for Cinzel"'), "a capitals-only face gets its own size-matched Hebrew", fontStack("cinzel"));
check(fontStack("heebo") === '"Heebo", "Assistant Hebrew", sans-serif', "a Hebrew & English face gets no matched fallback — only the marks face for what it lacks", fontStack("heebo"));
check(fontStack("assistant") === '"Assistant", sans-serif' && fontStack("frank-ruhl-libre") === '"Frank Ruhl Libre", serif',
  "and one that has every mark gets nothing after it");
check(fontStack("montserrat", "rubik") === '"Rubik Hebrew", "Montserrat", "Assistant Hebrew", sans-serif', "a Hebrew override comes first, Hebrew only", fontStack("montserrat", "rubik"));
check(fontStack("playfair-display", "suez-one").endsWith('"Frank Ruhl Libre Hebrew", serif'), "after a serif the marks face is Frank Ruhl Libre", fontStack("playfair-display", "suez-one"));
{
  // Every stack draws every Hebrew mark from some face that has it.
  const MARKS = ["sof pasuk", "maqaf", "geresh", "gershayim", "paseq"];
  const covering = new Set(["frank-ruhl-libre", "assistant"]);
  const gaps = [...PICKABLE_FONTS.map((f) => [f.id, "auto"]), ...HEBREW_OVERRIDE_FONTS.map((h) => ["inter", h.id])].filter(([font, hebrew]) => {
    const stack = fontStack(font, hebrew);
    const hebrewId = hebrew === "auto" ? (hebrewFallbackFor(font) ?? font) : hebrew;
    const missing = BUILT_FONTS[hebrewId].hebrewMissing.filter((m) => MARKS.includes(m));
    return missing.length > 0 && ![...covering].some((id) => stack.includes(id === "assistant" ? '"Assistant' : '"Frank Ruhl Libre'));
  });
  check(gaps.length === 0, "no stack leaves sof pasuk, maqaf, geresh, gershayim or paseq to a device font", gaps.map((g) => g.join("+")).join(", ") || "none");
}
check(fontStack("heebo", "suez-one").startsWith('"Suez One Hebrew", "Heebo"'), "an override beats even a face's own Hebrew", fontStack("heebo", "suez-one"));
check(fontStack("montserrat", "auto") === fontStack("montserrat"), '"auto" is the matched fallback');
check(fontStack("montserrat", "not-a-font") === fontStack("montserrat"), "an unknown override is ignored");
check(fontStack("sefarim") === '"Frank Ruhl Libre", serif', "a pre-catalog name draws the same face", fontStack("sefarim"));
check(fontStack("system") === "var(--type-neutral)", "System stays the device font");
check(fontStack(undefined) === fontStack("assistant"), "no font is Assistant, as before");
check(resolvedHebrew("playfair-display") === "frank-ruhl-libre" && resolvedHebrew("heebo") === "heebo" && resolvedHebrew("inter", "rubik") === "rubik", "the Hebrew face a stack draws in is known");

console.log("\n-- nikud (measured; confirmed by eye in /fonts-lab) -----------------");
for (const font of HEBREW_OVERRIDE_FONTS) console.log(`         ${font.nikudOk ? "sets nikud " : "NIKUD POOR "} ${font.name}`);
check(HEBREW_OVERRIDE_FONTS.some((f) => !f.nikudOk), "the measurement can fail a font (not everything passes)");

console.log("\n-- font roles and themes ---------------------------------------------");
{
  const old = boardFontRoles({ font: "rubik", hebrewFont: "auto" });
  check(old.heading.font === "rubik" && old.accent.font === "rubik" && old.quote.font === "rubik",
    "a board saved before themes: heading, accent and quote all fall back to its one font");
  const empty = boardFontRoles({});
  check(empty.body.font === "assistant" && empty.body.hebrew === "auto", "no font at all: Assistant, Auto Hebrew");

  check(FONT_THEMES.length === 6, "six font themes", FONT_THEMES.map((t) => t.name).join(", "));
  for (const theme of FONT_THEMES) {
    for (const [role, value] of Object.entries(theme.roles)) {
      check(Boolean(pickableFont(value!.font) || catalogId(value!.font)), `${theme.name}: ${role} font ${value!.font} is in the catalog`);
      check(value!.hebrew === "auto" || HEBREW_OVERRIDE_FONTS.some((f) => f.id === value!.hebrew),
        `${theme.name}: ${role} Hebrew ${value!.hebrew} is Auto or an override`);
    }
  }

  const simcha = FONT_THEMES.find((t) => t.id === "simcha")!;
  const roles = boardFontRoles({ ink: "ink", ...fontThemePatch(simcha) });
  check(roles.heading.font === "dm-serif-display" && roles.heading.hebrew === "suez-one", "Simcha: DM Serif Display headings, Suez One Hebrew");
  check(roles.accent.font === "great-vibes" && roles.body.font === "lato", "Great Vibes accent, Lato body");
  check(resolveElementFont("inherit", "inherit", "heading", roles).font === "dm-serif-display", "a Title left to the theme takes the heading font");
  check(resolveElementFont("inherit", "inherit", "body", roles).font === "lato", "any other element takes the body font");
  check(resolveElementFont("accent", "inherit", "body", roles).font === "great-vibes", "an element set to Accent takes the accent font");
  const own = resolveElementFont("cinzel", "inherit", "heading", roles);
  check(own.font === "cinzel" && own.hebrew === "suez-one", "a font picked by name stays, with its role's Hebrew");

  const warm = FONT_THEMES.find((t) => t.id === "warm")!;
  const switched = boardFontRoles({ ...fontThemePatch(simcha), ...fontThemePatch(warm) });
  check(switched.accent.font === "outfit", "switching to a theme without an accent clears the old one (falls back to heading)");
  check(matchesFontTheme(fontThemePatch(warm), warm) && !matchesFontTheme(fontThemePatch(warm), simcha), "the applied theme reads back as chosen");

  const scholarly = boardFontRoles(fontThemePatch(FONT_THEMES.find((t) => t.id === "scholarly")!));
  check(scholarly.quote.font === "eb-garamond" && scholarly.quote.hebrew === "noto-rashi-hebrew", "Scholarly's quote style sets Hebrew in Rashi script");

  const fresh = boardFontRoles(newBoardFontOverrides());
  check(fresh.heading.font === "montserrat" && fresh.body.font === "inter", "a new board starts on Modern (Montserrat / Inter)");
  check(!("accentFont" in newBoardFontOverrides()), "and stores nothing for the roles Modern leaves out");
}

console.log("\n-- old-style figures: times set wholly in the matched fallback ------");
{
  for (const [id, fallback, weight] of [
    ["marcellus", "frank-ruhl-libre", 500],
    ["suez-one", "frank-ruhl-libre", 900],
    ["pinyon-script", "heebo", 400],
    ["parisienne", "heebo", 400],
    ["alef", "heebo", 600],
  ] as const) {
    check(numericFace(id) === fontStack(fallback), `${id}: a time (digits, colon, AM/PM) is set in ${fallback}`, numericFace(id));
    check(numericWeight(id) === weight, `${id}: at weight ${weight}, matched to the face`, String(numericWeight(id)));
    check(!fontStack(id).includes(fontStack(fallback)), `${id}: everywhere else it keeps its own figures`);
  }
  for (const id of ["inter", "playfair-display", "dancing-script", "caveat", "heebo"]) {
    check(numericFace(id) === fontStack(id) && numericWeight(id) === null, `${id}: lining figures, its times in its own face and weight`);
  }
  check(matchedWeight(600, [300, 400, 700]) === 700 && matchedWeight(450, [300, 400, 700]) === 400 && matchedWeight(350, [400, 700]) === 400,
    "a static face's in-between weight is the file CSS font matching picks");
  check(digitWidthVars("karantina")["--board-digit-600"] === digitWidthVars("karantina")["--board-digit-700"],
    "so Karantina's digit box at 600 (a ticking clock) is its 700 file's, the one drawn");
  check(Object.keys(digitWidthVars("marcellus")).length === 0, "a ticking Marcellus clock is Frank Ruhl Libre's, tabular — no boxes");
  const pinyon = digitWidthVars("pinyon-script");
  check(new Set(Object.values(pinyon)).size === 1 && Object.keys(pinyon).length === 9, "a ticking Pinyon Script clock is boxed to Heebo's widest digit at its one matched weight");
}

console.log("\n-- a board downloads only its own fonts (lib/fonts/board-fonts.ts) -----");
{
  const info = (type: string) =>
    ({ title: { fontRole: "heading" as const }, clock: { showsTimes: true }, zmanim: { showsTimes: true } })[type as "title"];
  const doc = (themeOverrides: Record<string, unknown>, widgets: { type: string; config: Record<string, unknown> }[]) => ({ themeOverrides, widgets });
  const english = boardFonts([doc(newBoardFontOverrides(), [{ type: "title", config: { text: "Kiddush" } }, { type: "text", config: { text: "After davening" } }])], info);
  const families = new Set(english.files.map((url) => url.split("/")[2]));
  check([...families].sort().join(",") === "assistant,heebo,inter,montserrat",
    "a Modern board: Montserrat and Inter, their matched Hebrew (Heebo) and its marks face (Assistant), nothing else", [...families].join(", "));
  check(english.files.some((url) => url.startsWith("/fonts/heebo/hebrew-")) && english.files.some((url) => url.startsWith("/fonts/assistant/hebrew-")),
    "the matched fallback's Hebrew file is bundled even with no Hebrew in the text — Hebrew can arrive as data (captions, zmanim labels, feeds)");
  check(english.files.filter((url) => url.includes("/hebrew-")).length === 2 && english.files.every((url) => !url.includes("/assistant/latin")),
    "each once, deduplicated across roles and elements, and only the marks face's Hebrew file");
  check(english.stylesheet.startsWith("/fonts/faces."), "the stylesheet is listed, for a reboot offline", english.stylesheet);

  const hebrew = boardFonts([doc(newBoardFontOverrides(), [{ type: "text", config: { text: "מנחה Mincha 6:45" } }])], info);
  check(hebrew.files.some((url) => url.startsWith("/fonts/heebo/hebrew-")), "Hebrew text: the matched fallback's Hebrew file (Heebo for Inter)");
  check(hebrew.faces.some((face) => face.family === "Heebo Hebrew for Inter" || face.family === "Heebo Hebrew"), "and its size-matched family is loaded before first paint",
    hebrew.faces.map((f) => f.family).join(", "));

  const override = boardFonts([doc({ font: "inter", hebrewFont: "suez-one" }, [{ type: "text", config: { text: "שבת" } }])], info);
  check(override.files.some((url) => url.startsWith("/fonts/suez-one/hebrew-")) && !override.files.some((url) => url.startsWith("/fonts/heebo/")),
    "a Hebrew override is bundled in place of the fallback it replaces");
  const unused = boardFonts([doc({ font: "inter" }, [{ type: "text", config: { text: "Hello" } }])], info);
  check(!unused.files.some((url) => url.includes("suez-one")) && !unused.files.some((url) => /\/(?!heebo\/|assistant\/)[^/]+\/hebrew-/.test(url)),
    "an override nobody chose is never bundled — only the matched fallback is");
  const perRole = boardFonts([doc({ font: "inter", headingFont: "playfair-display", headingHebrewFont: "auto" }, [{ type: "title", config: { text: "x" } }])], info);
  check(perRole.files.some((url) => url.startsWith("/fonts/heebo/hebrew-")) && perRole.files.some((url) => url.startsWith("/fonts/frank-ruhl-libre/hebrew-")),
    "each role's resolved Hebrew is bundled: Heebo for the Inter body, Frank Ruhl Libre for the Playfair heading");
  const simcha = boardFonts([doc(fontThemePatch(FONT_THEMES.find((t) => t.id === "simcha")!), [{ type: "text", config: { text: "Hello" } }])], info);
  check(simcha.files.some((url) => url.startsWith("/fonts/suez-one/hebrew-")),
    "even a role no element uses yet: a Simcha board with no title still bundles its heading Hebrew (Suez One)");

  const oldStyle = boardFonts([doc({ font: "marcellus" }, [{ type: "clock", config: {} }])], info);
  check(oldStyle.files.some((url) => url.startsWith("/fonts/frank-ruhl-libre/latin-")) && oldStyle.faces.some((f) => f.family === "Frank Ruhl Libre" && f.weight === 500),
    "a Marcellus clock brings Frank Ruhl Libre, at the matched 500");
  const variable = boardFonts([doc({ font: "inter" }, [])], info);
  check(variable.files.filter((url) => /^\/fonts\/inter\/latin-wght/.test(url)).length === 1, "a variable face is one file for regular and semibold", variable.files.join(", "));
  check(variable.files.every((url) => existsSync(join("public", url))), "every listed file exists");
}

console.log("\n-- weights -----------------------------------------------------------");
{
  check(offeredWeights("cormorant-garamond")[0] === 500, "Cormorant Garamond offers nothing under 500", offeredWeights("cormorant-garamond").join(", "));
  check(clampWeight("cormorant-garamond", 400) === 500, "and a regular Cormorant element is drawn at 500");
  check(boldWeight("lato") === 700 && boldWeight("playfair-display") === 700, "bold is 700 where a face offers it");
  check(boldWeight("marcellus") === 400, "a one-weight face has no bold and draws its one weight");
  check(boldWeight("david-libre") === 700, "David Libre's bold is its 700");
  const heavy = boardFonts([{ themeOverrides: { font: "lato" }, widgets: [{ type: "text", config: { text: "x", fontWeight: 900 } }] }], () => undefined);
  check(heavy.files.some((url) => /\/lato\/latin-900-normal/.test(url)), "a chosen weight in a static face brings its file", heavy.files.join(", "));
  check(heavy.files.some((url) => /\/lato\/latin-700-normal/.test(url)), "and Lato's bold comes with every Lato element");
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
