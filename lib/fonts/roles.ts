import { catalogId, hebrewFont } from "./index.ts";
import { DEFAULT_FONT } from "./stack.ts";

/*
 * FONT ROLES — what a board's font theme sets (./themes.ts).
 *
 * A board has up to four fonts, each with its own Hebrew choice:
 *
 *   body     everything, unless something says otherwise. The board font
 *            boards have always had (themeOverrides.font / .hebrewFont).
 *   heading  Title elements and every element's header line. Falls back to
 *            body, so a board saved before themes looks exactly as it did.
 *   accent   opt-in: an element uses it only when its font is set to Accent
 *            (Simcha's Great Vibes). Falls back to heading.
 *   quote    opt-in, the same way — Scholarly's Rashi-script Hebrew. Falls
 *            back to body.
 *
 * An element's font is "inherit" (its role's default — heading for a Title,
 * body for the rest), a role by name, or a catalog font. A role keeps
 * following the theme: switch the board from Modern to Warm and every element
 * set to Heading or Accent follows; one set to Montserrat by name stays
 * Montserrat. That's what "themes apply in one click and stay editable" rests on.
 *
 * Plain TypeScript, relative imports, so Node tests and the bundle builder read
 * it too.
 */

export const FONT_ROLES = ["heading", "body", "accent", "quote"] as const;
export type FontRole = (typeof FONT_ROLES)[number];

export const FONT_ROLE_LABELS: Record<FontRole, string> = {
  heading: "Heading",
  body: "Body",
  accent: "Accent",
  quote: "Quote",
};

/** A font and the Hebrew drawn with it ("auto" for the matched fallback, or a
 *  Hebrew override's id). */
export type RoleFont = { font: string; hebrew: string };
export type BoardFontRoles = Record<FontRole, RoleFont>;

/** The themeOverrides keys each role is stored under. Body's are the board
 *  font's own, from before roles existed. */
export const ROLE_KEYS: Record<FontRole, { font: string; hebrew: string }> = {
  body: { font: "font", hebrew: "hebrewFont" },
  heading: { font: "headingFont", hebrew: "headingHebrewFont" },
  accent: { font: "accentFont", hebrew: "accentHebrewFont" },
  quote: { font: "quoteFont", hebrew: "quoteHebrewFont" },
};

export function isFontRole(value: unknown): value is FontRole {
  return typeof value === "string" && (FONT_ROLES as readonly string[]).includes(value);
}

const str = (value: unknown) => (typeof value === "string" && value !== "" ? value : undefined);
const hebrewChoice = (value: unknown) => {
  const v = str(value);
  return v && (v === "auto" || hebrewFont(v)) ? v : undefined;
};

/** A board's four fonts, from its themeOverrides, each falling back as above. */
export function boardFontRoles(theme: Record<string, unknown> | undefined): BoardFontRoles {
  const t = theme ?? {};
  const read = (role: FontRole): Partial<RoleFont> => {
    const font = str(t[ROLE_KEYS[role].font]);
    return { font: font && catalogId(font) ? font : undefined, hebrew: hebrewChoice(t[ROLE_KEYS[role].hebrew]) };
  };
  const body: RoleFont = { font: read("body").font ?? DEFAULT_FONT, hebrew: read("body").hebrew ?? "auto" };
  // A role with no font of its own takes its fallback whole — font AND Hebrew
  // — so Heading on an old board is exactly the body text.
  const withFallback = (role: FontRole, fallback: RoleFont): RoleFont => {
    const own = read(role);
    return own.font ? { font: own.font, hebrew: own.hebrew ?? "auto" } : fallback;
  };
  const heading = withFallback("heading", body);
  return {
    body,
    heading,
    accent: withFallback("accent", heading),
    quote: withFallback("quote", body),
  };
}

/**
 * The font and Hebrew an element draws in. `font` and `hebrew` are its own
 * stored choices; `role` is what "inherit" means for it (heading for a Title).
 * A Hebrew choice of "inherit" takes the Hebrew of the role in play — the
 * named role, or the element's own — so picking Heading brings the heading's
 * Hebrew with it.
 */
export function resolveElementFont(
  font: string | undefined,
  hebrew: string | undefined,
  role: FontRole,
  roles: BoardFontRoles,
): RoleFont {
  const named = isFontRole(font) ? font : null;
  const inRole = roles[named ?? role];
  const face = !font || font === "inherit" || named ? inRole.font : font;
  const hebrewFace = !hebrew || hebrew === "inherit" ? inRole.hebrew : hebrew;
  return { font: face, hebrew: hebrewFace };
}
