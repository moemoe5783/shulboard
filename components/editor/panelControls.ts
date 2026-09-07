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

export const PANEL_CONTROL =
  "text-cell rounded-control text-paper border-paper/20 h-8 w-full border bg-transparent px-2";

export const PANEL_CHECKBOX = "size-4 accent-verdigris";
