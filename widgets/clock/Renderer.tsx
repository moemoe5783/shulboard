"use client";

import { useMemo } from "react";
import { useSecond } from "@/lib/tick";
import { boardFontSize } from "@/lib/board-theme";
import type { WidgetRendererProps } from "../types";
import type { ClockConfig } from "./manifest";

/*
 * The one widget with a heartbeat, and the reason lib/tick.ts exists.
 *
 * It has no timer of its own. Twelve clocks on a board share one, and it stops
 * when the last unmounts — plan.md §3e, the rule that keeps a display running
 * for months instead of accumulating an interval per board rotation.
 */

export function Renderer({ config, canvas }: WidgetRendererProps<ClockConfig>) {
  const second = useSecond();

  const format = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        ...(config.showSeconds ? { second: "2-digit" as const } : {}),
        hour12: config.hour12,
        ...(config.timeZone ? { timeZone: config.timeZone } : {}),
      }),
    [config.hour12, config.showSeconds, config.timeZone],
  );

  const align =
    config.align === "center" ? "justify-center" : config.align === "right" ? "justify-end" : "justify-start";

  return (
    <div className={`flex h-full w-full items-center ${align}`}>
      {/* The numeric utility is what stops the digits jittering as they change.
          Whether it does anything depends on the face the board document chose —
          Frank Ruhl Libre has tabular figures, Assistant has none — and the
          widget applies it either way rather than deciding the face itself. */}
      <span
        className="numeric font-semibold leading-none whitespace-nowrap"
        style={{ fontSize: boardFontSize(config.size, canvas.width) }}
      >
        {/* A non-breaking space until the browser has a clock. The server's
            second would be a different second by the time the markup reached a
            TV, so rendering it would be a hydration mismatch on every load, and
            rendering nothing would make the board jump on first paint. */}
        {second === null ? " " : format.format(new Date(second * 1000))}
      </span>
    </div>
  );
}
