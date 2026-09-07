"use client";

import type { WidgetRenderer } from "./types";

/*
 * Every widget's renderer, collected the same way its manifest is.
 *
 * Separate module from manifests.ts because this one is client code and that
 * one must not be. The split is what lets a server route read `dataNeeds` off
 * every widget without dragging a React tree into it.
 *
 * The glob is on Renderer.tsx and the export name is `Renderer`, so the file
 * layout is the registration. There is no list to add to.
 */

declare const require: {
  context(
    directory: string,
    useSubdirectories: boolean,
    regExp: RegExp,
  ): { keys(): string[]; (id: string): { Renderer?: WidgetRenderer<never> } };
};

const context = require.context("./", true, /^\.\/[a-z0-9-]+\/Renderer\.tsx$/);

const byId = new Map<string, WidgetRenderer<never>>();

for (const key of context.keys()) {
  // "./clock/Renderer.tsx" -> "clock". The folder name is the widget id, and
  // the manifest's `id` must match it; the check below is what catches a folder
  // renamed without its manifest.
  const folder = key.split("/")[1];
  const Renderer = context(key).Renderer;
  if (folder && Renderer) byId.set(folder, Renderer);
}

/** Undefined for a widget type this build does not have. */
export function getRenderer(id: string): WidgetRenderer<never> | undefined {
  return byId.get(id);
}

/** The ids that have a renderer. Compared against the manifests in a test, so a
 *  folder with a manifest and no renderer fails loudly rather than rendering an
 *  empty box on a wall. */
export function rendererIds(): string[] {
  return [...byId.keys()].sort();
}
