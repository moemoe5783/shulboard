"use client";

import type { WidgetSettingsComponent } from "./types";

/*
 * Every widget's Settings panel, collected the same way its renderer is.
 *
 * A widget with no Settings.tsx is valid — not every widget has anything to
 * configure yet — and getSettings() returning undefined is how the properties
 * panel tells "nothing to show" apart from "this widget type doesn't exist".
 */

declare const require: {
  context(
    directory: string,
    useSubdirectories: boolean,
    regExp: RegExp,
  ): { keys(): string[]; (id: string): { Settings?: WidgetSettingsComponent<never> } };
};

const context = require.context("./", true, /^\.\/[a-z0-9-]+\/Settings\.tsx$/);

const byId = new Map<string, WidgetSettingsComponent<never>>();

for (const key of context.keys()) {
  // "./clock/Settings.tsx" -> "clock", same convention as renderers.ts.
  const folder = key.split("/")[1];
  const Settings = context(key).Settings;
  if (folder && Settings) byId.set(folder, Settings);
}

/** Undefined for a widget type with no Settings.tsx, or none in this build. */
export function getSettings(id: string): WidgetSettingsComponent<never> | undefined {
  return byId.get(id);
}
