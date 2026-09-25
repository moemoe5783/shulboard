"use client";

import { useEditor } from "@/lib/editor/store";
import { isFontRole, boardFontRoles, ROLE_KEYS, type FontRole } from "@/lib/fonts/roles";
import { fontStack } from "@/lib/fonts/stack";
import { FONT_THEMES, fontThemePatch, matchesFontTheme } from "@/lib/fonts/themes";
import { catalogId } from "@/lib/fonts";
import { FontSelect, HebrewFontSelect } from "./FontSelects";
import { PANEL_LABEL } from "./panelControls";

/*
 * The board's fonts, in board settings: one-click font themes (lib/fonts/
 * themes.ts), then each role on its own — heading, body, accent and quote,
 * each with its Hebrew (lib/fonts/roles.ts). A theme only fills in the roles;
 * any of them can be changed afterwards, and any element can take a font of
 * its own on its Appearance tab.
 *
 * Themes are a list of rows, not a grid of cards (design.md §5): each row's
 * name is drawn in the theme's heading font and a sample under it in its body
 * font, so the choice is made by looking, not by reading font names.
 */

const ROLE_HINTS: Record<FontRole, string> = {
  heading: "Titles and every element's header.",
  body: "Everything else.",
  accent: "Only where an element's font is set to Accent.",
  quote: "Only where an element's font is set to Quote.",
};

const FALLBACK_LABEL: Partial<Record<FontRole, string>> = {
  heading: "Same as body",
  accent: "Same as heading",
  quote: "Same as body",
};

export function BoardFontSettings() {
  const doc = useEditor((s) => s.doc);
  const setBoardStyle = useEditor((s) => s.setBoardStyle);
  const setWidgetConfig = useEditor((s) => s.setWidgetConfig);
  const overrides = doc.themeOverrides as Record<string, unknown>;
  const roles = boardFontRoles(overrides);

  /** Write themeOverrides keys; `undefined` removes one (the role falls back). */
  const write = (patch: Record<string, string | undefined>, label: string) => {
    const next: Record<string, unknown> = { ...overrides };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    setBoardStyle({ themeOverrides: next }, label);
  };

  // Elements with a font picked by name: a theme doesn't reach them.
  const ownFont = doc.widgets.filter((widget) => {
    const config = widget.config as { font?: unknown; hebrewFont?: unknown };
    const font = typeof config.font === "string" ? config.font : "inherit";
    return (font !== "inherit" && !isFontRole(font) && catalogId(font)) || (config.hebrewFont && config.hebrewFont !== "inherit");
  });

  return (
    <div className="flex flex-col gap-5" data-board-fonts>
      <div className="flex flex-col gap-2">
        <span className={PANEL_LABEL}>Font theme</span>
        <div className="flex flex-col" role="radiogroup" aria-label="Font theme">
          {FONT_THEMES.map((theme) => {
            const chosen = matchesFontTheme(overrides, theme);
            const heading = theme.roles.heading;
            const body = theme.roles.body;
            return (
              <button
                key={theme.id}
                type="button"
                role="radio"
                aria-checked={chosen}
                data-font-theme={theme.id}
                onClick={() => write(fontThemePatch(theme), `Apply the ${theme.name} font theme`)}
                className={`border-paper/10 flex flex-col items-start gap-1 border-b px-2 py-2 text-left first:border-t ${
                  chosen ? "bg-paper/10" : "hover:bg-paper/5"
                }`}
              >
                <span className="text-paper text-[19px] leading-tight" style={{ fontFamily: fontStack(heading.font, heading.hebrew) }}>
                  {theme.name}
                </span>
                <span className="text-paper/80 text-[14px] leading-tight" style={{ fontFamily: fontStack(body.font, body.hebrew) }}>
                  Shabbos shalom, candle lighting 6:45 <span lang="he">שבת שלום</span>
                </span>
                <span className="text-meta text-paper/50">{theme.description}</span>
              </button>
            );
          })}
        </div>
        {ownFont.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className={PANEL_LABEL}>
              {ownFont.length === 1 ? "1 element has" : `${ownFont.length} elements have`} a font of its own, so the theme
              doesn&rsquo;t change {ownFont.length === 1 ? "it" : "them"}.
            </p>
            <button
              type="button"
              className="text-meta text-paper self-start underline underline-offset-2"
              onClick={() =>
                setWidgetConfig(
                  ownFont.map((widget) => widget.id),
                  { font: "inherit", hebrewFont: "inherit" },
                  "Use the theme's fonts",
                )
              }
            >
              Use the theme&rsquo;s fonts for {ownFont.length === 1 ? "it" : "them"}
            </button>
          </div>
        )}
      </div>

      {(["heading", "body", "accent", "quote"] as const).map((role) => {
        const keys = ROLE_KEYS[role];
        const own = typeof overrides[keys.font] === "string" && catalogId(overrides[keys.font] as string);
        const value = role === "body" ? roles.body.font : own ? (overrides[keys.font] as string) : "inherit";
        const name = role[0].toUpperCase() + role.slice(1);
        return (
          <div key={role} className="flex flex-col gap-2" data-board-font-role={role}>
            <FontSelect
              label={`${name} font`}
              value={value}
              inheritLabel={FALLBACK_LABEL[role]}
              onChange={(font) =>
                write(
                  font === "inherit" ? { [keys.font]: undefined, [keys.hebrew]: undefined } : { [keys.font]: font },
                  `Change the ${role} font`,
                )
              }
            />
            {(role === "body" || own) && (
              <HebrewFontSelect
                value={roles[role].hebrew}
                onChange={(hebrew) => write({ [keys.hebrew]: hebrew }, `Change the ${role} Hebrew font`)}
              />
            )}
            <p className={PANEL_LABEL}>{ROLE_HINTS[role]}</p>
          </div>
        );
      })}
    </div>
  );
}
