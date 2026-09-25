"use client";

import { CATEGORY_LABELS, HEBREW_GROUPS, HEBREW_OVERRIDE_FONTS, PICKABLE_FONTS, fontInfo, hebrewFont, pickableFont, type FontCategory } from "@/lib/fonts";
import { FONT_ROLE_LABELS, FONT_ROLES, isFontRole, type BoardFontRoles } from "@/lib/fonts/roles";
import { fontStack } from "@/lib/fonts/stack";
import { FontPicker, type FontGroup } from "./FontPicker";
import { PANEL_LABEL } from "./panelControls";

/*
 * The font and Hebrew-font choices, for an element (Appearance tab) and for the
 * whole board (board settings), grouped the way the catalog groups them
 * (lib/fonts) — each name drawn in its own font (./FontPicker.tsx).
 */

/** What every face's row says in that face. */
const SAMPLE = "Shabbos shalom 7:18";
const HEBREW_SAMPLE = "שבת שלום";

/** The main font: "Hebrew & English" faces, then Serif, Sans serif, Display
 *  and Script. `inheritLabel` adds a first option for "use the board's". */
export function FontSelect({
  label = "Font",
  value,
  inheritLabel,
  inheritFamily,
  roles,
  exclude,
  onChange,
  onPreview,
}: {
  label?: string;
  value: string;
  inheritLabel?: string;
  /** The face "inherit" draws in, to show it in. */
  inheritFamily?: string;
  /** The board's font roles — offered by name, so an element can follow the
   *  theme's heading, body, accent or quote font. */
  roles?: BoardFontRoles;
  /** Categories not offered here (script faces, for a clock). A value already
   *  in one stays selectable. */
  exclude?: readonly FontCategory[];
  onChange: (font: string) => void;
  /** A font hovered, for the canvas to show (./FontPicker.tsx). */
  onPreview?: (font: string | null) => void;
}) {
  const offered = PICKABLE_FONTS.filter((font) => !exclude?.includes(font.category));
  const known = value === "inherit" || isFontRole(value) || offered.some((font) => font.id === value);
  const groups: FontGroup[] = [];
  // A board saved before the catalog may name a face it no longer offers
  // (Miriam Libre, System, Alef), or a face this element no longer offers — kept
  // selectable while chosen.
  const current = pickableFont(value);
  const first = [
    ...(inheritLabel ? [{ value: "inherit", name: inheritLabel, family: inheritFamily }] : []),
    ...(!known
      ? [
          {
            value,
            name: current?.name ?? hebrewFont(value)?.name ?? value,
            family: current || hebrewFont(value) ? `"${current?.name ?? hebrewFont(value)?.name}"` : undefined,
          },
        ]
      : []),
  ];
  if (first.length) groups.push({ options: first });
  if (roles) {
    groups.push({
      label: "From the theme",
      options: FONT_ROLES.map((role) => ({
        value: role,
        name: FONT_ROLE_LABELS[role],
        family: fontStack(roles[role].font, roles[role].hebrew),
        note: fontInfo(roles[role].font)?.name,
        sample: SAMPLE,
      })),
    });
  }
  for (const category of Object.keys(CATEGORY_LABELS) as FontCategory[]) {
    if (exclude?.includes(category)) continue;
    groups.push({
      label: CATEGORY_LABELS[category],
      options: offered.filter((font) => font.category === category).map((font) => ({
        value: font.id,
        name: font.name,
        family: `"${font.name}"`,
        hebrewName: font.hebrewName,
        capsOnly: font.capsOnly,
        // English faces show English only — they have no Hebrew, and the
        // fallback drawn in their place would be a claim about the wrong font.
        sample: SAMPLE,
        hebrewSample: font.hebrewName ? HEBREW_SAMPLE : undefined,
      })),
    });
  }
  return <FontPicker label={label} value={value} groups={groups} onChange={onChange} onPreview={onPreview} />;
}

/**
 * The face Hebrew text is drawn in. "Auto (matched)" pairs it with the chosen
 * font — Frank Ruhl Libre for serifs, Heebo for the rest — and each override
 * loads nothing unless it's chosen (or scrolled past in this list). A face
 * that doesn't set nikud well says so, and names the one that does.
 */
export function HebrewFontSelect({
  value,
  inheritLabel,
  onChange,
  onPreview,
}: {
  value: string;
  inheritLabel?: string;
  onChange: (hebrew: string) => void;
  onPreview?: (hebrew: string | null) => void;
}) {
  const chosen = value !== "inherit" && value !== "auto" ? HEBREW_OVERRIDE_FONTS.find((f) => f.id === value) : undefined;
  const groups: FontGroup[] = [
    {
      options: [...(inheritLabel ? [{ value: "inherit", name: inheritLabel }] : []), { value: "auto", name: "Auto (matched)" }],
    },
    ...HEBREW_GROUPS.map((group) => ({
      label: group.label,
      options: HEBREW_OVERRIDE_FONTS.filter((font) => font.group === group.id).map((font) => ({
        value: font.id,
        // The Hebrew name and a Hebrew sample in the face; the English name
        // small, in the UI face, to say which font it is; an English sample
        // too where the face has Latin letters of its own.
        name: font.label ? `${font.label} (${font.name})` : font.name,
        nameInUi: true,
        family: `"${font.name}"`,
        hebrewName: font.hebrewName,
        hebrewSample: HEBREW_SAMPLE,
        sample: font.latin ? "Shabbos shalom" : undefined,
      })),
    })),
  ];
  return (
    <div className="flex flex-col gap-1">
      <FontPicker label="Hebrew font" value={value} groups={groups} onChange={onChange} onPreview={onPreview} />
      {chosen && !chosen.nikudOk && (
        <p className={PANEL_LABEL} data-nikud-warning>
          Nikud may not show properly in {hebrewFont(chosen.id)?.name}. For text with nekudos, use Noto Serif Hebrew.
        </p>
      )}
    </div>
  );
}
