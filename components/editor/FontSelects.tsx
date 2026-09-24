"use client";

import { CATEGORY_LABELS, HEBREW_GROUPS, HEBREW_OVERRIDE_FONTS, PICKABLE_FONTS, hebrewFont, pickableFont, type FontCategory } from "@/lib/fonts";
import { PANEL_CONTROL, PANEL_LABEL } from "./panelControls";

/*
 * The font and Hebrew-font choices, for an element (Appearance tab) and for the
 * whole board (board settings). Plain selects for now, grouped the way the
 * catalog groups them (lib/fonts).
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
  return (
    <label className="flex flex-col gap-1">
      <span className={PANEL_LABEL}>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={PANEL_CONTROL}>
        {inheritLabel && <option value="inherit">{inheritLabel}</option>}
        {/* A board saved before the catalog may name a face it no longer
            offers (Miriam Libre, System) — kept selectable while chosen. */}
        {!known && <option value={value}>{value}</option>}
        {(Object.keys(CATEGORY_LABELS) as FontCategory[]).map((category) => (
          <optgroup key={category} label={CATEGORY_LABELS[category]}>
            {PICKABLE_FONTS.filter((font) => font.category === category).map((font) => (
              <option key={font.id} value={font.id}>
                {font.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

/**
 * The face Hebrew text is drawn in. "Auto (matched)" pairs it with the chosen
 * font — Frank Ruhl Libre for serifs, Heebo for the rest — and each override
 * loads nothing unless it's chosen. A face that doesn't set nikud well says so,
 * and names the one that does.
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
  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Hebrew font</span>
        <select value={value} onChange={(event) => onChange(event.target.value)} className={PANEL_CONTROL}>
          {inheritLabel && <option value="inherit">{inheritLabel}</option>}
          <option value="auto">Auto (matched)</option>
          {HEBREW_GROUPS.map((group) => (
            <optgroup key={group.id} label={group.label}>
              {HEBREW_OVERRIDE_FONTS.filter((font) => font.group === group.id).map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label ?? font.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {chosen && !chosen.nikudOk && (
        <p className={PANEL_LABEL} data-nikud-warning>
          Nikud may not show properly in {hebrewFont(chosen.id)?.name}. For text with nekudos, use Noto Serif Hebrew.
        </p>
      )}
    </div>
  );
}
