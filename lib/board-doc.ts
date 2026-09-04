import { z } from "zod";

/**
 * The board document schema.
 *
 * A board is one row with one `doc` jsonb column — there is no board_widgets
 * table. That means the database enforces almost nothing about this shape: the
 * only constraint on the column is `jsonb_typeof(doc) = 'object'`.
 *
 * NO WRITE PATH MAY BYPASS parseBoardDoc().
 *
 * That is not a style preference, it is the entire guard. Widget positions are
 * percentages of the board's canvas, never pixels (CLAUDE.md), and this file is
 * the only place that rule is checked. Every writer goes through parseBoardDoc:
 * the editor's autosave, template instantiation, board duplication, import,
 * "copy board to another org", seed scripts, and repair scripts. A writer that
 * skips it can persist pixel coordinates, and nothing downstream will notice
 * until a screen in a lobby renders a widget three canvases off to the right.
 *
 * See docs/schema.md §5.
 */

/**
 * Positions are percentages of `boards.canvas_width` / `boards.canvas_height`.
 *
 * The range is deliberately wider than 0–100: a widget can legitimately hang off
 * the canvas edge. It is deliberately much narrower than a pixel range, so that a
 * stray pixel value like 960 fails loudly here instead of being stored.
 */
export const POSITION_MIN = -100;
export const POSITION_MAX = 200;

/**
 * Ceilings, so that "the editor got slow" surfaces as a validation error naming
 * the limit rather than as a performance mystery. Every autosave rewrites and
 * re-TOASTs the whole document, so document size is a real cost.
 */
export const MAX_WIDGETS = 200;
export const MAX_DOC_BYTES = 1_000_000;

/** Bump when the document shape changes, and handle the old value on read. */
export const BOARD_DOC_SCHEMA_VERSION = 1;

const percentage = z
  .number()
  .finite()
  .min(POSITION_MIN, { message: `must be at least ${POSITION_MIN}% of the canvas` })
  .max(POSITION_MAX, { message: `must be at most ${POSITION_MAX}% of the canvas` });

const extent = percentage.refine((v) => v > 0, {
  message: "width and height are percentages of the canvas and must be positive",
});

/** Per-widget settings, validated against the widget's own manifest schema. */
const widgetConfig = z.record(z.string(), z.unknown());

export const boardWidgetSchema = z.object({
  id: z.uuid(),
  /** Matches the `id` in `widgets/<name>/manifest.ts`. */
  type: z.string().min(1),
  x: percentage,
  y: percentage,
  w: extent,
  h: extent,
  rotation: z.number().finite().min(-360).max(360).default(0),
  z: z.number().int().default(0),
  locked: z.boolean().default(false),
  hidden: z.boolean().default(false),
  opacity: z.number().min(0).max(1).default(1),
  groupId: z.uuid().nullable().default(null),
  config: widgetConfig.default({}),
  styleOverrides: z.record(z.string(), z.unknown()).default({}),
});

export const boardDocSchema = z.object({
  schemaVersion: z.literal(BOARD_DOC_SCHEMA_VERSION),
  background: z.record(z.string(), z.unknown()).default({}),
  themeOverrides: z.record(z.string(), z.unknown()).default({}),
  widgets: z.array(boardWidgetSchema).max(MAX_WIDGETS).default([]),
});

export type BoardWidget = z.infer<typeof boardWidgetSchema>;
export type BoardDoc = z.infer<typeof boardDocSchema>;

export class BoardDocError extends Error {
  readonly issues: z.core.$ZodIssue[];

  constructor(message: string, issues: z.core.$ZodIssue[] = []) {
    super(message);
    this.name = "BoardDocError";
    this.issues = issues;
  }
}

/** A new, valid, empty document. */
export function emptyBoardDoc(): BoardDoc {
  return boardDocSchema.parse({ schemaVersion: BOARD_DOC_SCHEMA_VERSION });
}

/**
 * Parse and normalise a board document. Throws BoardDocError on anything invalid.
 *
 * This is the only validator. Call it on every read from the database and on
 * every write to it — reads too, because a document written before a schema
 * change still has to be understood, and because a document that came from
 * anywhere but this function may not be what it claims.
 */
export function parseBoardDoc(input: unknown): BoardDoc {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new BoardDocError("A board document must be a JSON object.");
  }

  const upgraded = upgradeBoardDoc(input as Record<string, unknown>);
  const result = boardDocSchema.safeParse(upgraded);

  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join(".") || "document";
    throw new BoardDocError(
      `Board document is not valid at ${path}: ${first?.message ?? "unknown problem"}`,
      result.error.issues,
    );
  }

  const doc = result.data;

  const ids = new Set<string>();
  for (const widget of doc.widgets) {
    if (ids.has(widget.id)) {
      throw new BoardDocError(`Two widgets share the id ${widget.id}.`);
    }
    ids.add(widget.id);
  }

  for (const widget of doc.widgets) {
    if (widget.groupId !== null && !ids.has(widget.groupId)) {
      throw new BoardDocError(
        `Widget ${widget.id} is grouped under ${widget.groupId}, which is not on this board.`,
      );
    }
  }

  return doc;
}

/**
 * Serialise for storage, enforcing the size ceiling.
 *
 * Every write goes through here so the ceiling is checked against the bytes that
 * actually reach Postgres rather than against an estimate.
 */
export function serializeBoardDoc(doc: BoardDoc): string {
  const json = JSON.stringify(boardDocSchema.parse(doc));
  const bytes = new TextEncoder().encode(json).length;

  if (bytes > MAX_DOC_BYTES) {
    throw new BoardDocError(
      `Board document is ${bytes} bytes, over the ${MAX_DOC_BYTES} byte limit. Remove some widgets or reduce their settings.`,
    );
  }

  return json;
}

/**
 * Migrate an older document forward.
 *
 * Lazy migration: a document is upgraded when it is read and the upgraded form is
 * persisted on the next save. There is only one version so far, so this is a
 * pass-through with the entry point already in place — a document written before
 * `schemaVersion` existed is treated as version 1.
 */
function upgradeBoardDoc(doc: Record<string, unknown>): Record<string, unknown> {
  if (doc.schemaVersion === undefined) {
    return { ...doc, schemaVersion: BOARD_DOC_SCHEMA_VERSION };
  }
  return doc;
}
