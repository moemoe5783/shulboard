"use client";

import { PANEL_CHECKBOX, PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import { CANONICAL_ZMAN_ORDER, CHABAD_SUPPLIES, ZMAN_PANEL_LABEL } from "@/lib/zmanim/zman";
import type { WidgetSettingsProps } from "@/widgets/types";
import type { ZmanimConfig } from "./manifest";

/**
 * Why a canonical id is not selectable — plan.md §5c's capability matrix,
 * made visible. §5c: "the settings UI greys out unavailable ones — never
 * render a blank row on a screen someone is standing in front of."
 *
 * The reason string matters as much as the disabling: the GRA and MGA shitos
 * are missing because Chabad publishes Baal HaTanya, not because nobody got
 * round to them.
 */
function reasonUnavailable(id: string): string | null {
  return CHABAD_SUPPLIES.has(id) ? null : "Chabad.org doesn't publish this shitah.";
}

export function Settings({ config, onChange }: WidgetSettingsProps<ZmanimConfig>) {
  const selected = new Set(config.zmanim);

  /**
   * Toggling one zman keeps `CANONICAL_ZMAN_ORDER`'s order rather than
   * appending, so the stored array reads the same way the list does.
   */
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onChange({ zmanim: CANONICAL_ZMAN_ORDER.filter((candidate) => next.has(candidate)) });
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Show</span>
        <select
          value={config.displayMode}
          onChange={(event) => onChange({ displayMode: event.target.value as ZmanimConfig["displayMode"] })}
          className={PANEL_CONTROL}
        >
          <option value="all">All chosen times</option>
          <option value="next">Next one only</option>
        </select>
        <span className={PANEL_LABEL}>
          The box&rsquo;s width sets the type size (bigger box, bigger text — set it exactly on the Size tab). The
          height never shrinks the text.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>When it doesn&rsquo;t fit</span>
        <select
          value={config.overflow}
          onChange={(event) => onChange({ overflow: event.target.value as ZmanimConfig["overflow"] })}
          className={PANEL_CONTROL}
        >
          <option value="page">Page through them</option>
          <option value="scroll">Scroll continuously</option>
        </select>
        <span className={PANEL_LABEL}>
          When more rows are chosen than fit the height — page a screenful at a time, or scroll like a departures board.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Label language</span>
        <select
          value={config.labelScript}
          onChange={(event) => onChange({ labelScript: event.target.value as ZmanimConfig["labelScript"] })}
          className={PANEL_CONTROL}
        >
          <option value="english">English</option>
          <option value="transliteration">Transliterated Hebrew</option>
        </select>
        <span className={PANEL_LABEL}>
          {config.labelScript === "transliteration"
            ? "The Hebrew name spelled in English — “Shkiah”, “Tzeit Hakochavim” — from Chabad.org's own feed. A row Chabad.org sends no transliteration for stays in English."
            : "Chabad.org's own English names, exactly as it sends them."}
        </span>
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className={PANEL_LABEL}>Times</legend>
        {CANONICAL_ZMAN_ORDER.map((id) => {
          const unavailable = reasonUnavailable(id);
          return (
            <label key={id} className="flex items-center gap-2" title={unavailable ?? undefined}>
              <input
                type="checkbox"
                checked={selected.has(id)}
                disabled={unavailable !== null}
                onChange={(event) => toggle(id, event.target.checked)}
                className={`${PANEL_CHECKBOX} disabled:opacity-40`}
              />
              {/*
                House vocabulary, and only here — this is chrome (design.md
                §1b). The BOARD shows the provider's own label for the same row
                ("Latest Shacharit" where this says "Sof zman tfila (Baal
                HaTanya)"); lib/zmanim/zman.ts's note on ZMAN_PANEL_LABEL is the
                longer version.
              */}
              <span className={`text-cell ${unavailable ? "text-paper/40" : "text-paper"}`}>
                {ZMAN_PANEL_LABEL[id] ?? id}
              </span>
            </label>
          );
        })}
      </fieldset>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={config.hour12}
          onChange={(event) => onChange({ hour12: event.target.checked })}
          className={PANEL_CHECKBOX}
        />
        <span className="text-cell text-paper">12-hour</span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.showFootnotes}
            onChange={(event) => onChange({ showFootnotes: event.target.checked })}
            className={PANEL_CHECKBOX}
          />
          <span className="text-cell text-paper">Show the source&rsquo;s notes</span>
        </span>
        <span className={PANEL_LABEL}>
          Full sentences, written for a printed luach — &ldquo;light candles after this time&rdquo; on the second
          night of a Yom Tov. Off by default because of the space they take.
        </span>
      </label>
    </div>
  );
}
