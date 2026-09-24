"use client";

import { CATEGORY_LABELS, HEBREW_GROUPS, HEBREW_OVERRIDE_FONTS, PICKABLE_FONTS, hebrewFont, pickableFont, type FontCategory } from "@/lib/fonts";
import { FontPicker, type FontGroup } from "./FontPicker";
import { PANEL_LABEL } from "./panelControls";

/*
 * The font and Hebrew-font choices, for an element (Appearance tab) and for the
 * whole board (board settings), grouped the way the catalog groups them
 * (lib/fonts) — each name drawn in its own font (./FontPicker.tsx).
 */

/** The main font: "Hebrew & English" faces, then Serif, Sans serif, Display
 *  and Script. `inheritLabel` adds a first option for "use the board's". */
export function FontSelect({
  label = "Font",
  value,
  inheritLabel,
  onChange,
}: {
  label?: string;
  value: string;
  inheritLabel?: string;
  onChange: (font: string) => void;
}) {
  const known = value === "inherit" || Boolean(pickableFont(value));
  const groups: FontGroup[] = [];
  // A board saved before the catalog may name a face it no longer offers
  // (Miriam Libre, System) — kept selectable while chosen.
  const first = [
    ...(inheritLabel ? [{ value: "inherit", name: inheritLabel }] : []),
    ...(!known ? [{ value, name: pickableFont(value)?.name ?? hebrewFont(value)?.name ?? value }] : []),
  ];
  if (first.length) groups.push({ options: first });
  for (const category of Object.keys(CATEGORY_LABELS) as FontCategory[]) {
    groups.push({
      label: CATEGORY_LABELS[category],
      options: PICKABLE_FONTS.filter((font) => font.category === category).map((font) => ({
        value: font.id,
        name: font.name,
        family: `"${font.name}"`,
        hebrewName: font.hebrewName,
        capsOnly: font.capsOnly,
      })),
    });
  }
  return <FontPicker label={label} value={value} groups={groups} onChange={onChange} />;
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
}: {
  value: string;
  inheritLabel?: string;
  onChange: (hebrew: string) => void;
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
        name: font.label ?? font.name,
        family: `"${font.name}"`,
        hebrewName: font.hebrewName,
      })),
    })),
  ];
  return (
    <div className="flex flex-col gap-1">
      <FontPicker label="Hebrew font" value={value} groups={groups} onChange={onChange} />
      {chosen && !chosen.nikudOk && (
        <p className={PANEL_LABEL} data-nikud-warning>
          Nikud may not show properly in {hebrewFont(chosen.id)?.name}. For text with nekudos, use Noto Serif Hebrew.
        </p>
      )}
    </div>
  );
}
