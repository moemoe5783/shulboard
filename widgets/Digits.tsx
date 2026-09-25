import { Fragment } from "react";
import { digitWidthVar } from "@/lib/board-theme";

/*
 * A string with numbers in it — a time, a countdown, a date — set in the
 * font's own lining figures (`lining-nums tabular-nums`: even height, and even
 * width where the face has tabular figures).
 *
 * BOXED ONLY WHERE DIGITS TICK IN PLACE. A zmanim table already lines its
 * times up on its grid (hour track right-aligned to the colon, minutes and
 * AM/PM in their own tracks — widgets/zmanim/Renderer.tsx), and a clock or a
 * date changing width once a minute is fine. But a display whose digits change
 * every second — a clock showing seconds — would shimmy in a face without
 * tabular figures, so there, and only there, `boxed` puts each digit in a
 * fixed-width box as wide as the face's widest digit AT THIS WEIGHT, measured
 * in the font files at build time (scripts/build-fonts.ts, published as
 * `--board-digit-<weight>` by lib/board-theme.ts's digitWidthVars; `auto`, the
 * digit's own width, for a face with tabular figures).
 *
 * Colons, spaces and AM/PM stay natural width. Splitting is display only: the
 * characters rendered are exactly the input's, in order.
 */
export function Digits({ text, weight = 400, boxed = false }: { text: string; weight?: number; boxed?: boolean }) {
  if (!boxed) return <span data-digits style={{ fontVariantNumeric: "lining-nums tabular-nums" }}>{text}</span>;
  const width = digitWidthVar(weight);
  return (
    <>
      {text.split(/(\d)/).map((part, i) =>
        /^\d$/.test(part) ? (
          <span key={i} data-digit style={{ display: "inline-block", width, textAlign: "center", fontVariantNumeric: "lining-nums tabular-nums" }}>
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
