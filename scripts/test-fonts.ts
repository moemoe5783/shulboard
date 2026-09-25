/**
 * The board font catalog (lib/fonts): every font is self-hosted, licensed,
 * measured and offered the way the spec says.
 *
 * Run with: npm run test:fonts
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { digitWidthVars, numericFace } from "../lib/board-theme.ts";
import { join } from "node:path";
import { BUILT_FONTS } from "../lib/fonts/catalog.generated.ts";
import { ENGLISH_FONTS, HEBREW_FONTS } from "../lib/fonts/catalog.ts";
import {
  catalogId,
  clampWeight,
  hebrewFallbackFor,
  HEBREW_OVERRIDE_FONTS,
  LEGACY_FONT_IDS,
  PICKABLE_FONTS,
  pickableFont,
} from "../lib/fonts/index.ts";
import { boardFontRoles, resolveElementFont } from "../lib/fonts/roles.ts";
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
check(fontStack("montserrat") === '"Montserrat", "Heebo Hebrew", sans-serif', "a sans gets Heebo's Hebrew", fontStack("montserrat"));
check(fontStack("great-vibes").endsWith("cursive"), "a script ends in cursive", fontStack("great-vibes"));
check(fontStack("cinzel").includes('"Frank Ruhl Libre Hebrew for Cinzel"'), "a capitals-only face gets its own size-matched Hebrew", fontStack("cinzel"));
check(fontStack("heebo") === '"Heebo", sans-serif', "a Hebrew & English face needs no fallback", fontStack("heebo"));
check(fontStack("montserrat", "rubik") === '"Rubik Hebrew", "Montserrat", sans-serif', "a Hebrew override comes first, Hebrew only", fontStack("montserrat", "rubik"));
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

console.log("\n-- old-style figures: times take the fallback's digits ---------------");
{
  for (const [id, family] of [
    ["marcellus", "Frank Ruhl Libre Digits"],
    ["suez-one", "Frank Ruhl Libre Digits"],
    ["pinyon-script", "Heebo Digits"],
    ["parisienne", "Heebo Digits"],
    ["alef", "Heebo Digits"],
  ] as const) {
    check(numericFace(id).startsWith(`"${family}", `), `${id}: its times' digits come from ${family}`, numericFace(id));
    check(!fontStack(id).includes("Digits"), `${id}: everywhere else it keeps its own figures`);
  }
  for (const id of ["inter", "playfair-display", "dancing-script", "caveat", "heebo"]) {
    check(numericFace(id) === fontStack(id), `${id}: lining figures, its own digits in times too`);
  }
  check(Object.keys(digitWidthVars("marcellus")).length === 0, "Marcellus's time digits are Frank Ruhl Libre's, tabular — no boxes");
  check(Object.keys(digitWidthVars("pinyon-script")).length === 9, "Pinyon Script's are Heebo's, boxed to Heebo's widest digit");
  const css = readFileSync(join("public/fonts", readdirSync("public/fonts").find((f) => f.startsWith("faces."))!), "utf8");
  check(/font-family:"Heebo Digits"[^}]*unicode-range:U\+0030-0039/.test(css) && /font-family:"Frank Ruhl Libre Digits"[^}]*unicode-range:U\+0030-0039/.test(css),
    "the digit families cover 0–9 and nothing else");
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed > 0 ? 1 : 0);
