import { Fragment } from "react";
import { digitWidthVar } from "@/lib/board-theme";

/*
 * A string with numbers in it — a time, a countdown, a date — set so its
 * digits line up in a column whatever font the board uses (docs/plan.md §5
 * numbers; CLAUDE.md's column-of-times rule).
 *
 * Two mechanisms, and the font decides which one does the work:
 *
 *  - `lining-nums tabular-nums` on every digit. A face with both features
 *    draws its digits even-height AND even-width, and nothing more is needed;
 *    a feature a face lacks is simply ignored.
 *  - A fixed-width box per digit, only for a face WITHOUT tabular figures: as
 *    wide as that face's widest digit AT THIS WEIGHT, measured (lining figures
 *    where it has them) in the font files at build time
 *    (scripts/build-fonts.ts). The board root and the widget frame publish
 *    those widths as `--board-digit-<weight>` only for such a face
 *    (lib/board-theme.ts, digitWidthVars); for every other face the variable
 *    is unset and the box is `auto`, i.e. the digit's own tabular width.
 *
 * Colons, spaces and AM/PM stay natural width. Splitting is display only: the
 * characters rendered are exactly the input's, in order.
 */
export function Digits({ text, weight = 400 }: { text: string; weight?: number }) {
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
