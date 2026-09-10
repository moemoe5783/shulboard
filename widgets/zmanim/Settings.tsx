"use client";

import { PANEL_CHECKBOX, PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import { HEBCAL_COMPUTABLE } from "@/lib/zmanim/hebcal-zmanim";
import { CANONICAL_ZMAN_ORDER, CHABAD_SUPPLIES, ZMAN_PANEL_LABEL } from "@/lib/zmanim/zman";
import type { WidgetSettingsProps } from "@/widgets/types";
import type { ZmanimConfig } from "./manifest";

/**
 * Which canonical ids this instance's source can actually supply, and why
 * not when it can't — plan.md §5c's capability matrix, made visible.
 *
 * §5c: "the settings UI greys out unavailable ones — never render a blank
 * row on a screen someone is standing in front of," and design.md's own
 * editor wireframe says the same at more length: "unavailable zmanim for
 * the chosen source are shown disabled with a tooltip explaining why, not
 * hidden. Hiding them makes users think the app is broken."
 *
 * The reason strings matter as much as the disabling. The GRA and MGA
 * shitos are missing because Chabad.org publishes Baal HaTanya, not
 * because nobody got round to them, and a gabbai who davens by the GRA's
 * sof zman shma needs to know that is a provider question rather than a
 * bug.
 *
 * `"inherit"` takes the UNION of what any source can supply, because this
 * component genuinely cannot know what it resolves to: a Settings
 * component receives `{config, onChange}` (widgets/types.ts) and the
 * board's own provider lives in a context that wraps the renderer, not the
 * properties panel. Being permissive is the right direction — an id that
 * turns out to be unavailable renders no row, which is the same thing
 * `candle_lighting` does on a Tuesday, whereas wrongly greying one out
 * would hide a row that would have worked.
 */
function availability(provider: ZmanimConfig["provider"]): (id: string) => string | null {
  if (provider === "chabad") {
    return (id) => (CHABAD_SUPPLIES.has(id) ? null : "Chabad.org doesn't publish this shitah.");
  }
  if (provider === "inherit") {
    return (id) =>
      CHABAD_SUPPLIES.has(id) || HEBCAL_COMPUTABLE.has(id)
        ? null
        : "No zmanim source in this product supplies this yet.";
  }
  return (id) =>
    HEBCAL_COMPUTABLE.has(id)
      ? null
      : CHABAD_SUPPLIES.has(id)
        ? "Only Chabad.org supplies this — it's a date, not a daily time, so it isn't calculated here."
        : "No zmanim source in this product supplies this yet.";
}

export function Settings({ config, onChange }: WidgetSettingsProps<ZmanimConfig>) {
  const reasonUnavailable = availability(config.provider);
  const selected = new Set(config.zmanim);

  /**
   * Toggling one zman keeps `CANONICAL_ZMAN_ORDER`'s order rather than
   * appending, so the stored array reads the same way the list does. It
   * changes nothing on a board — the renderer sorts by instant — but a
   * config a person may read by hand should not be in click order.
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
          onChange={(event) => {
            const displayMode = event.target.value as ZmanimConfig["displayMode"];
            /*
             * Picking "all" moves a `fit` widget to `hug`, and that is the
             * answer to how these two settings interact — manifest.ts's
             * sizing note, and docs/sizing.md §2.
             *
             * `fit` is the one combination that is never honest for a
             * table: the type size would depend on the row count, so the
             * whole thing would rescale on the days a candle-lighting or
             * Shabbos-ends row appears and rescale back when it goes.
             * `fixed` is left alone — §2 names zmanim tables as its own
             * example and it is the right choice for most boards, so this
             * only rescues the broken combination rather than overriding a
             * considered one.
             *
             * Switching back to "next" does NOT undo it. All three modes
             * are honest for a single row, and silently reverting a sizing
             * choice a gabbai can see in the panel is worse than leaving
             * it where it landed.
             */
            onChange(
              displayMode === "all" && config.sizingMode === "fit"
                ? { displayMode, sizingMode: "hug" }
                : { displayMode },
            );
          }}
          className={PANEL_CONTROL}
        >
          <option value="all">All chosen times</option>
          <option value="next">Next one only</option>
        </select>
        {config.displayMode === "all" && config.sizingMode === "fixed" && (
          <span className={PANEL_LABEL}>
            Candle lighting and Shabbos ends only appear on some days, so a fixed box sized on a weekday can clip
            on Friday. Hug height never can.
          </span>
        )}
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
                House vocabulary, and only here. This is chrome (design.md
                §1b) and it reads in the product's own words like every
                other control. The BOARD shows the provider's own label for
                the same row — "Latest Shacharit" where this says "Sof zman
                tfila (Baal HaTanya)" — because a board should match the
                luach on the wall and a settings panel should match the
                rest of the app. lib/zmanim/zman.ts's note on
                ZMAN_PANEL_LABEL is the longer version.
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
        <span className={PANEL_LABEL}>Zmanim source</span>
        <select
          value={config.provider}
          onChange={(event) => onChange({ provider: event.target.value as ZmanimConfig["provider"] })}
          className={PANEL_CONTROL}
        >
          <option value="inherit">Use the screen&rsquo;s setting</option>
          <option value="hebcal">Hebcal</option>
          <option value="chabad">Chabad.org</option>
          <option value="manual">Manual</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={config.fallbackToCalculated}
            disabled={config.provider === "hebcal" || config.provider === "manual"}
            onChange={(event) => onChange({ fallbackToCalculated: event.target.checked })}
            className={`${PANEL_CHECKBOX} disabled:opacity-40`}
          />
          <span className="text-cell text-paper">Calculate missing times</span>
        </span>
        <span className={PANEL_LABEL}>
          {config.provider === "hebcal" || config.provider === "manual"
            ? "Only applies to Chabad.org, which is the one source that can be missing a time."
            : "With this off, a time Chabad.org hasn't published shows no row rather than a calculated one."}
        </span>
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
