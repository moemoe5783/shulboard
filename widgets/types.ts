import type { ComponentType } from "react";
import type { z } from "zod";

/*
 * The widget interface — docs/plan.md §5.
 *
 * One folder per widget: manifest.ts, Renderer.tsx, and later Settings.tsx.
 * Adding widget number twenty-six is meant to be creating that folder and
 * nothing else, so nothing in this file may require a central edit per widget.
 *
 * THE MANIFEST HOLDS NO COMPONENT. That separation is load-bearing rather than
 * tidy: the bundle builder runs on the server and reads `dataNeeds` off every
 * manifest to work out what to fetch, and it must be able to do that without
 * pulling a React tree — and without pulling the "use client" modules the
 * renderers are — into a server route. manifest.ts is data; Renderer.tsx is the
 * component; the registry is the only thing that knows they belong together.
 */

export type WidgetCategory = "time" | "text" | "media" | "content" | "interactive";

/**
 * What a widget needs the bundle builder to fetch for it.
 *
 * Declarative only for now — nothing reads this yet. It exists from the first
 * widget because §5 makes it the mechanism that stops two calendar widgets
 * pointing at the same Google Calendar from becoming two API calls, and a field
 * added after twenty widgets exist is twenty folders to revisit.
 *
 * Deliberately a plain string array rather than a union: a widget declares its
 * own needs, and a union here would mean every new need is an edit to this file.
 * The bundle builder will dedupe on the string.
 */
export type DataNeed = string;

/** Design units on the board's canvas, not pixels on a screen. */
export type WidgetSize = { w: number; h: number };

export type WidgetManifest<TConfig = Record<string, unknown>> = {
  /** Matches `type` in the board document. Stable forever once shipped. */
  id: string;
  /** Shown in the add-widget menu. Sentence case. */
  name: string;
  /** One line in the add-widget menu, saying what it puts on the board. */
  description: string;
  category: WidgetCategory;
  /** How big it arrives, in design units. */
  defaultSize: WidgetSize;
  /** Gated behind a paid plan (§9, P8). False for all three of these. */
  isPro: boolean;
  /**
   * The widget's settings, and the only definition of them.
   *
   * Every field carries a `.default()`, which is what makes
   * `settingsSchema.parse({})` the widget's default config — so there is no
   * second list of defaults to fall out of step with the schema.
   */
  settingsSchema: z.ZodType<TConfig>;
  dataNeeds: readonly DataNeed[];
  /**
   * What to call one instance of this widget in a layers panel.
   *
   * Without it the panel shows "Title, Title, Title" for three headings, and
   * the only alternative is the panel switching on widget type — which is
   * exactly the central edit per widget that this interface exists to avoid.
   * Falls back to `name` when a widget has nothing better to say.
   */
  instanceLabel?: (config: TConfig) => string;
};

/**
 * What every Renderer receives.
 *
 * THERE IS NO `surface` PROP, AND THERE MUST NEVER BE ONE. CLAUDE.md: the
 * renderer is shared by the editor and the display route, and if it renders
 * differently in the two places that is a bug. A prop saying which one it is
 * would be the fork, just spelled as a conditional instead of a second file.
 *
 * What legitimately differs between the two lives outside the renderer: the
 * editor wraps this in a transform frame and suppresses pointer events on the
 * content. The renderer itself cannot tell where it is, which is the point.
 */
export type WidgetRendererProps<TConfig = Record<string, unknown>> = {
  config: TConfig;
  /**
   * The board's design canvas, in design units.
   *
   * Type is sized against this and emitted in `cqw`, so a board renders
   * identically at 1920 wide on a TV and at 640 wide in the editor at 33% —
   * which is what makes the editor WYSIWYG rather than approximately so.
   */
  canvas: { width: number; height: number };
};

export type WidgetRenderer<TConfig = Record<string, unknown>> = ComponentType<
  WidgetRendererProps<TConfig>
>;

/** A manifest and its renderer, which is what the registry hands out. */
export type RegisteredWidget = {
  manifest: WidgetManifest<never>;
  Renderer: WidgetRenderer<never>;
};
