"use client";

import { PANEL_CHECKBOX, PANEL_CONTROL, PANEL_LABEL } from "@/components/editor/panelControls";
import { CANONICAL_ZMAN_ORDER, CHABAD_SUPPLIES, ZMAN_PANEL_LABEL } from "@/lib/zmanim/zman";
import type { WidgetSettingsProps } from "@/widgets/types";
import type { ZmanimConfig } from "./manifest";

/**
 * Why a canonical id is not selectable — plan.md §5c's capability matrix,
 * made visible.
 *
 * §5c: "the settings UI greys out unavailable ones — never render a blank
 * row on a screen someone is standing in front of," and design.md §4 says
 * the same at more length: "unavailable zmanim for the chosen source are
 * shown disabled with a tooltip explaining why, not hidden. Hiding them
 * makes users think the app is broken."
 *
 * One source to check now rather than three. It used to branch on the
 * widget's own provider override and take the union for "inherit";
 * Chabad.org is the only source (lib/zmanim/provider.ts), so the answer is
 * `CHABAD_SUPPLIES` unconditionally.
 *
 * The reason string matters as much as the disabling. The GRA and MGA
 * shitos are missing because Chabad publishes Baal HaTanya, not because
 * nobody got round to them, and a gabbai who davens by the GRA's sof zman
 * shma needs to know that is a provider question rather than a bug.
 */
function reasonUnavailable(id: string): string | null {
  return CHABAD_SUPPLIES.has(id) ? null : "Chabad.org doesn't publish this shitah.";
}

export function Settings({ config, onChange }: WidgetSettingsProps<ZmanimConfig>) {
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
          /*
           * NO SIZING MODE IS FORCED HERE ANY MORE. This used to move a
           * `fit` widget to `hug` when "all" was picked, because a fitted
           * table rescaled on the days a date-conditional row appeared.
           * That rescale is gone — the Renderer pads the measured list to
           * the declared selection with spacer rows, so the fit no longer
           * moves when the real count does (manifest.ts's sizing note).
           * `fit` is now the recommended mode for "all" rather than the
           * refused one, and nothing needs rescuing.
           */
          onChange={(event) => onChange({ displayMode: event.target.value as ZmanimConfig["displayMode"] })}
          className={PANEL_CONTROL}
        >
          <option value="all">All chosen times</option>
          <option value="next">Next one only</option>
        </select>
        {/*
          The one configuration `fit` should not be in, and the panel says
          so rather than overriding it: a single row's size is bound by its
          own label's width, and that label changes several times a day
          ("Sunrise", "Latest Shacharit", "Midnight"). All three modes are
          legible for one row; only this one is jumpy.
        */}
        {config.displayMode === "next" && config.sizingMode === "fit" && (
          <span className={PANEL_LABEL}>
            One row rescales as its own label changes through the day. Fixed size holds still.
          </span>
        )}
        {/* What fit means here is not what it means elsewhere, and a gabbai
            dragging a box needs to know which handle does what. */}
        {config.displayMode === "all" && config.sizingMode === "fit" && (
          <span className={PANEL_LABEL}>
            Drag the box taller for bigger type. Widening it doesn&rsquo;t change the size — it only stops long
            labels having to shrink.
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Label language</span>
        <select
          value={config.labelScript}
          onChange={(event) => onChange({ labelScript: event.target.value as ZmanimConfig["labelScript"] })}
          className={PANEL_CONTROL}
        >
          <option value="english">English</option>
          <option value="hebrew">Hebrew</option>
        </select>
        <span className={PANEL_LABEL}>
          {config.labelScript === "hebrew"
            ? "Chabad.org's own Hebrew names, and the table mirrors — labels right, times left. Rows Chabad.org hasn't sent a Hebrew name for stay in English rather than being translated here."
            : "Chabad.org's own English names, exactly as it sends them."}
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>When rows don&rsquo;t fit</span>
        <select
          value={config.overflow}
          onChange={(event) => onChange({ overflow: event.target.value as ZmanimConfig["overflow"] })}
          disabled={config.sizingMode === "hug" || config.displayMode === "next"}
          className={`${PANEL_CONTROL} disabled:opacity-40`}
        >
          <option value="page">Page through them</option>
          <option value="scroll">Scroll continuously</option>
          <option value="clip">Cut them off</option>
        </select>
        <span className={PANEL_LABEL}>
          {config.sizingMode === "hug"
            ? "Hug height grows the box to its rows, so nothing can overflow."
            : config.displayMode === "next"
              ? "Only one row is shown, so nothing can overflow."
              : config.overflow === "clip"
                ? "Rows past the bottom of the box are cut off, with nothing on the board saying so."
                : "Only happens when the rows really don't fit — otherwise the table sits still."}
        </span>
      </label>

      {/* Only means anything for the one mode that moves continuously.
          Paging holds each screenful for eight seconds and has no speed to
          set; clipping does not move at all. */}
      <label className="flex flex-col gap-1">
        <span className={PANEL_LABEL}>Scroll speed</span>
        <select
          value={config.scrollSpeed}
          onChange={(event) => onChange({ scrollSpeed: event.target.value as ZmanimConfig["scrollSpeed"] })}
          disabled={config.overflow !== "scroll" || config.sizingMode === "hug" || config.displayMode === "next"}
          className={`${PANEL_CONTROL} disabled:opacity-40`}
        >
          <option value="slow">Slow</option>
          <option value="medium">Medium</option>
          <option value="fast">Fast</option>
        </select>
        <span className={PANEL_LABEL}>
          {config.overflow === "scroll"
            ? "Medium takes about eight seconds to come round a full screen — the same as one page step."
            : "Only applies when the rows scroll."}
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

      {/*
        THE "Zmanim source" SELECT AND THE "Calculate missing times"
        CHECKBOX BOTH STOOD HERE, and both are gone rather than reduced —
        the same removal candle-lighting/Settings.tsx records, for the same
        two reasons.

        Chabad.org is the only source (lib/zmanim/provider.ts), so the
        per-widget override had one option left, and a one-item dropdown is
        a label that looks interactive. With no Hebcal leg there is nothing
        to calculate either, so a switch offering to calculate had one
        outcome: a date Chabad has not published shows "No zmanim for this
        date".

        `config.provider` stays in the schema, unread — see manifest.ts on
        why a stored document keeps parsing and why re-offering the choice
        is a control here plus a read there, not a migration.
      */}

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
