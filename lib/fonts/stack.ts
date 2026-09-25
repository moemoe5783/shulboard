import { HEBREW_ALIASES } from "./catalog.generated.ts";
import { catalogId, fontInfo, hebrewFallbackFor, hebrewFont, hebrewMarksFallbackFor } from "./index.ts";

/*
 * A board font as CSS: the chosen face, the Hebrew that goes with it, and a
 * generic family — built here and nowhere else, so the editor and a screen
 * draw identical stacks.
 *
 * AUTOMATIC HEBREW. An English face has no Hebrew letters, so its stack names
 * the matched Hebrew fallback next: Frank Ruhl Libre for serifs, Heebo for
 * the rest —
 *
 *   "Playfair Display", "Frank Ruhl Libre Hebrew", serif
 *
 * — where "Frank Ruhl Libre Hebrew" is a Hebrew-only family (unicode-range
 * U+0590–05FF, FB1D–FB4F) with a size-adjust that stands its letters as tall
 * as the Latin beside them (scripts/build-fonts.ts). Its file only downloads
 * when a board actually has Hebrew text. A face with its own Hebrew (Hebrew &
 * English) needs no fallback.
 *
 * LAST, A FACE FOR THE MARKS. Ten Hebrew faces have no sof pasuk or paseq
 * (one no gershayim, one no qamats qatan). A stack whose Hebrew face lacks any
 * ends with Frank Ruhl Libre (after a serif) or Assistant (the rest), which
 * the build confirms have them all — so those marks never fall to a device
 * font.
 *
 * A HEBREW OVERRIDE goes first, so its Hebrew wins even over a face that has
 * Hebrew of its own; being Hebrew-only, it leaves the Latin to the chosen face.
 *
 * Documents store names, never stacks (lib/board-theme.ts), so every board ever
 * saved picks up a change here.
 */

/** The device's own font — the old "System" choice, outside the catalog. */
export const SYSTEM_STACK = "var(--type-neutral)";

/** What an unknown or missing font resolves to. */
export const DEFAULT_FONT = "assistant";

/** The size-matched Hebrew-only family for a Hebrew face beside an English one. */
export function hebrewFamily(hebrewId: string, englishId?: string | null): string {
  const aliases = HEBREW_ALIASES[hebrewId];
  if (!aliases) return hebrewFont(hebrewId)?.name ?? hebrewId;
  return (englishId && aliases.pairings[englishId]?.family) || aliases.base.family;
}

/** A Hebrew override that names a real Hebrew face, or null for Auto. */
export function hebrewOverride(hebrew: string | null | undefined): string | null {
  return hebrew && hebrew !== "auto" && hebrewFont(hebrew) ? hebrew : null;
}

/** The CSS font-family for a stored font name and Hebrew choice. */
export function fontStack(font: string | null | undefined, hebrew?: string | null): string {
  const id = catalogId(font) ?? DEFAULT_FONT;
  if (id === "system") return SYSTEM_STACK;
  const info = fontInfo(id) ?? fontInfo(DEFAULT_FONT)!;
  const override = hebrewOverride(hebrew);
  const parts: string[] = [];
  if (override) parts.push(`"${hebrewFamily(override, info.id)}"`);
  parts.push(`"${info.name}"`);
  const fallback = override ? null : hebrewFallbackFor(info.id);
  if (fallback) parts.push(`"${hebrewFamily(fallback, info.id)}"`);
  // Hebrew punctuation or nikud the Hebrew face above lacks — sof pasuk and
  // paseq, in ten faces — from a face that has it all, before the device's
  // own font would get it.
  const marks = hebrewMarksFallbackFor(info.id, override ?? fallback ?? info.id);
  if (marks) {
    const family = `"${hebrewFamily(marks, info.id)}"`;
    if (!parts.includes(family)) parts.push(family);
  }
  parts.push(info.generic);
  return parts.join(", ");
}

/** The Hebrew face a stack actually draws Hebrew in: the override, the
 *  fallback, or the face itself when it has its own Hebrew. */
export function resolvedHebrew(font: string | null | undefined, hebrew?: string | null): string | null {
  const id = catalogId(font) ?? DEFAULT_FONT;
  if (id === "system") return null;
  return hebrewOverride(hebrew) ?? hebrewFallbackFor(id) ?? id;
}
