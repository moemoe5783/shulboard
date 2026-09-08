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
 * One thing a widget needs the bundle builder to fetch for it.
 *
 * STRUCTURED, NOT A BARE STRING, and the parameters are the whole point. §5
 * makes this the mechanism that stops two calendar widgets pointing at the same
 * Google Calendar from becoming two API calls — and `"calendar"` cannot express
 * that, because two widgets reading different calendars declare the identical
 * string. `{ kind: "calendar", calendarId }` can: the builder collects every
 * need on the board, dedupes on the whole object, and fetches each distinct one
 * once.
 *
 * `kind` is a free string rather than a union, so a new kind of need is a new
 * widget folder and not an edit to this file. Parameters are scalars, so a need
 * has a stable identity that can be compared — see dataNeedKey().
 *
 * Nothing reads this yet. It carries its parameters now because changing the
 * shape after twenty widgets exist is twenty folders to revisit.
 */
export type DataNeed = {
  /** What kind of thing to fetch. The bundle builder switches on this. */
  kind: string;
  /** Everything that makes one need different from another of the same kind. */
  [parameter: string]: string | number | boolean | null | undefined;
};

/** Design units on the board's canvas, not pixels on a screen. */
export type WidgetSize = { w: number; h: number };

/**
 * How a widget's box relates to its content — docs/sizing.md §2.
 *
 * `fit`: the box is authoritative and content scales to fill it (a title
 * "should fill this area"). `fixed`: the declared type size is authoritative
 * and the box is a boundary/alignment frame, not a scaling factor (a zmanim
 * table whose type rescales when the box is nudged is worse than one that
 * doesn't) — content that doesn't fit clips. `hug`: the declared type size is
 * authoritative, same as `fixed`, but the box's height resizes to exactly
 * contain the content at that size instead of clipping it — width stays the
 * box's own boundary, same wrap role it has in `fixed`. `minFontSize`/
 * `maxFontSize` are design units, read by `fit` mode's auto-fit search — see
 * widgets/useFitFontSize.ts.
 */
export type SizingMode = "fit" | "fixed" | "hug";

export type ElementSizing = {
  /** The manifest's default. A per-instance override lives in that widget's
   *  own config (see clock/manifest.ts's `sizingMode` field) when
   *  `userToggleable` is true — the manifest only ever states the default. */
  mode: SizingMode;
  /** Whether the properties panel shows the Fit to box / Fixed size toggle
   *  (docs/sizing.md §2, "The toggle"). False for widgets where only one
   *  mode is ever defensible, e.g. Title (always fit) or Zmanim (always
   *  fixed). */
  userToggleable: boolean;
  minFontSize?: number;
  maxFontSize?: number;
};

export type WidgetManifest<TConfig = Record<string, unknown>> = {
  /** Matches `type` in the board document. Stable forever once shipped. */
  id: string;
  /** Shown in the add-widget menu. Sentence case. */
  name: string;
  /** One line in the add-widget menu, saying what it puts on the board. */
  description: string;
  category: WidgetCategory;
  /**
   * Names an icon for the add-widget menu. Optional, and unset on every widget
   * so far because there is no icon set yet.
   *
   * Here from the start rather than added later: at twenty-six entries a menu
   * distinguished only by name and one line of prose stops working, and a field
   * introduced at that point is twenty-six folders to revisit. A widget folder
   * fills it in when the set exists. A NAME, never a path or a component —
   * a manifest holds no React (see the note above).
   */
  icon?: string;
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
  /**
   * What this widget needs fetching, for one instance of it.
   *
   * A FUNCTION OF THE INSTANCE'S CONFIG, not a static list, and it has to be:
   * which calendar, which album, which asset all live in the config, and a
   * manifest-level constant cannot see them. The builder walks every widget on
   * every board, calls this with that widget's config, and dedupes what comes
   * back — which is exactly the two-widgets-one-API-call behaviour §5 asks for.
   *
   * Return [] for a widget that needs nothing. It is still a function, so
   * there is one shape to read rather than two.
   */
  dataNeeds: (config: TConfig) => readonly DataNeed[];
  /**
   * How this widget's box relates to its content — docs/sizing.md §2.
   * Required on every manifest so a widget can't ship without a considered
   * answer; there is no default to silently fall back to.
   */
  sizing: ElementSizing;
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

/**
 * What every widget's Settings.tsx receives — the properties panel's contract
 * with a widget folder, the same way WidgetRendererProps is BoardRenderer's.
 *
 * A Settings component does not touch the store directly; the panel is the
 * only thing that does, so a multi-selection of the same widget type can
 * apply one Settings form to all of them without every widget folder knowing
 * that is possible. `onChange` fires on every change — a keystroke, a
 * checkbox click — and each call is one undoable edit; see the comment on
 * setWidgetConfig (lib/editor/store.ts) for why coalescing keystrokes into
 * one edit turned out to be the wrong thing to build.
 */
export type WidgetSettingsProps<TConfig = Record<string, unknown>> = {
  config: TConfig;
  onChange: (patch: Partial<TConfig>) => void;
};

export type WidgetSettingsComponent<TConfig = Record<string, unknown>> = ComponentType<
  WidgetSettingsProps<TConfig>
>;
