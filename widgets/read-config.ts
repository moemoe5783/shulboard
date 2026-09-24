import type { z } from "zod";

/*
 * A widget's stored config -> its complete config, defaults filled in.
 *
 * A board document stores config as a plain record, and the Renderer and
 * Settings receive it as stored — a widget written by an older version, by
 * hand, or by a lab page may be missing fields, and one bad field must not
 * throw away the good ones. So: the whole record if it parses; otherwise every
 * field that parses on its own, with defaults for the rest.
 */
export function readConfig<S extends z.ZodObject>(schema: S, raw: unknown): z.infer<S> {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const whole = schema.safeParse(record);
  if (whole.success) return whole.data;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const field = (schema.shape as Record<string, z.ZodType | undefined>)[key];
    if (field && field.safeParse(value).success) kept[key] = value;
  }
  return schema.parse(kept);
}
