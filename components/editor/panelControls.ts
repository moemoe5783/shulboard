/*
 * Form control geometry for the properties panel — dark chrome, same as the
 * toolbar and layers panel (design.md §4: "Dark chrome, light canvas").
 *
 * The dashboard's Field/SelectField (components/Field.tsx) do not apply here:
 * their secondary text is --ink, invisible on an --ink panel. Same 32px
 * height, 5px radius and hairline geometry, palette inverted — the same
 * relationship editor-lab/chrome.ts already draws between the dashboard's
 * Button and CHROME_BUTTON.
 */

export const PANEL_LABEL = "text-meta text-paper/60";

/*
 * bg-ink, not bg-transparent — docs/sizing.md §5. Visually identical for a
 * plain input (the panel's own ambient background already is --ink, so
 * transparent and opaque-ink painted the same pixels), but a <select>'s
 * native dropdown list does not reliably inherit a transparent background
 * from the element it drops down from. An explicit, opaque background is
 * what Chromium and Firefox actually paint that popup from; color-scheme
 * (app/globals.css, scoped to [data-dark-chrome]) covers the engine that
 * ignores this too.
 */
export const PANEL_CONTROL =
  "text-cell rounded-control text-paper border-paper/20 bg-ink h-8 w-full border px-2";

export const PANEL_CHECKBOX = "size-4 accent-verdigris";
