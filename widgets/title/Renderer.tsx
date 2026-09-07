"use client";

import type { WidgetRendererProps } from "../types";
import { boardFontSize } from "@/lib/board-theme";
import type { TitleConfig } from "./manifest";

/*
 * Shared by the editor and the display route. There is one of these.
 *
 * No colour and no font family: both are inherited from the board root, which
 * takes them from the board document. A widget that set its own would be
 * ignoring the theme the shul chose, and a board of widgets each picking their
 * own type is the ransom note §4d is about.
 */

export function Renderer({ config, canvas }: WidgetRendererProps<TitleConfig>) {
  const align =
    config.align === "center" ? "items-center text-center" : config.align === "right" ? "items-end text-right" : "items-start text-left";

  return (
    <div className={`flex h-full w-full flex-col justify-center gap-[0.4em] ${align}`}>
      <span
        className="font-semibold leading-tight"
        style={{ fontSize: boardFontSize(config.size, canvas.width) }}
      >
        {config.text}
      </span>

      {config.subtitle && (
        <span
          className="leading-tight opacity-70"
          style={{ fontSize: boardFontSize(config.size * config.subtitleScale, canvas.width) }}
        >
          {config.subtitle}
        </span>
      )}
    </div>
  );
}
