import { ROLE_KEYS, type FontRole, type RoleFont } from "./roles.ts";

/*
 * One-click font themes. A theme is nothing but values for the board's four
 * font roles (./roles.ts): applying one writes them into themeOverrides, as
 * one undoable step, and every element that follows a role follows it. Any
 * element can still be given its own font afterwards, and any role can be
 * changed on its own — a theme is a starting point, not a lock.
 *
 * A role a theme leaves out is cleared, so it falls back (accent → heading,
 * quote → body) rather than keeping a previous theme's choice.
 */

export type FontTheme = {
  id: string;
  name: string;
  /** One line on what it's for, under the name. */
  description: string;
  roles: Partial<Record<FontRole, RoleFont>> & { heading: RoleFont; body: RoleFont };
};

export const FONT_THEMES: readonly FontTheme[] = [
  {
    id: "classic-shul",
    name: "Classic shul",
    description: "Inscription capitals over a traditional book face.",
    roles: {
      heading: { font: "cinzel", hebrew: "frank-ruhl-libre" },
      body: { font: "eb-garamond", hebrew: "frank-ruhl-libre" },
    },
  },
  {
    id: "elegant",
    name: "Elegant",
    description: "A high-contrast serif with a clean sans.",
    roles: {
      heading: { font: "playfair-display", hebrew: "auto" },
      body: { font: "lato", hebrew: "auto" },
    },
  },
  {
    id: "modern",
    name: "Modern",
    description: "Geometric and plain, easy to read across a room.",
    roles: {
      heading: { font: "montserrat", hebrew: "auto" },
      body: { font: "inter", hebrew: "auto" },
    },
  },
  {
    id: "warm",
    name: "Warm",
    description: "Rounded and friendly, with Rubik for Hebrew.",
    roles: {
      heading: { font: "outfit", hebrew: "rubik" },
      body: { font: "figtree", hebrew: "rubik" },
    },
  },
  {
    id: "simcha",
    name: "Simcha",
    description: "Celebration headings, a script accent, and Suez One Hebrew.",
    roles: {
      heading: { font: "dm-serif-display", hebrew: "suez-one" },
      accent: { font: "great-vibes", hebrew: "auto" },
      body: { font: "lato", hebrew: "auto" },
    },
  },
  {
    id: "scholarly",
    name: "Scholarly",
    description: "A book face throughout, with Rashi script for quotes.",
    roles: {
      heading: { font: "eb-garamond", hebrew: "frank-ruhl-libre" },
      body: { font: "eb-garamond", hebrew: "frank-ruhl-libre" },
      quote: { font: "eb-garamond", hebrew: "noto-rashi-hebrew" },
    },
  },
];

/** What new boards start with. */
export const DEFAULT_FONT_THEME = "modern";

export function fontTheme(id: string | null | undefined): FontTheme | undefined {
  return FONT_THEMES.find((theme) => theme.id === id);
}

/** The themeOverrides patch that applies a theme: every role's font and
 *  Hebrew, a role it leaves out cleared, and which theme it was. */
export function fontThemePatch(theme: FontTheme): Record<string, string | undefined> {
  const patch: Record<string, string | undefined> = { fontTheme: theme.id };
  for (const role of Object.keys(ROLE_KEYS) as FontRole[]) {
    const value = theme.roles[role];
    patch[ROLE_KEYS[role].font] = value?.font;
    patch[ROLE_KEYS[role].hebrew] = value?.hebrew;
  }
  return patch;
}

/** Whether a board's roles are still exactly a theme's — for marking the
 *  theme card chosen; a role changed on its own un-marks it. */
export function matchesFontTheme(overrides: Record<string, unknown>, theme: FontTheme): boolean {
  const patch = fontThemePatch(theme);
  return Object.entries(patch).every(([key, value]) => key === "fontTheme" || (overrides[key] ?? undefined) === value);
}

/** The font part of a new board's themeOverrides: the default theme's roles,
 *  with nothing stored for a role it leaves out. */
export function newBoardFontOverrides(): Record<string, string> {
  const theme = fontTheme(DEFAULT_FONT_THEME)!;
  return Object.fromEntries(
    Object.entries(fontThemePatch(theme)).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
