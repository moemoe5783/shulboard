"use client";

import type { AppearanceSection, WidgetSettingsComponent } from "./types";

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
  ): {
    keys(): string[];
    (id: string): { Settings?: WidgetSettingsComponent<never>; appearance?: readonly AppearanceSection<never>[] };
  };
};

const context = require.context("./", true, /^\.\/[a-z0-9-]+\/Settings\.tsx$/);

const byId = new Map<string, WidgetSettingsComponent<never>>();
const appearanceById = new Map<string, readonly AppearanceSection<never>[]>();

for (const key of context.keys()) {
  // "./clock/Settings.tsx" -> "clock", same convention as renderers.ts.
  const folder = key.split("/")[1];
  const { Settings, appearance } = context(key);
  if (folder && Settings) byId.set(folder, Settings);
  if (folder && appearance?.length) appearanceById.set(folder, appearance);
}

/** Undefined for a widget type with no Settings.tsx, or none in this build. */
export function getSettings(id: string): WidgetSettingsComponent<never> | undefined {
  return byId.get(id);
}

/** A widget's own Appearance-tab sections (widgets/types.ts, AppearanceSection),
 *  or none. */
export function getAppearanceSections(id: string): readonly AppearanceSection<never>[] {
  return appearanceById.get(id) ?? [];
}
