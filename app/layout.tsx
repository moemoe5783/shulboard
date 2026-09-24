import type { Metadata, Viewport } from "next";
import {
  Alef,
  Assistant,
  David_Libre,
  Frank_Ruhl_Libre,
  Heebo,
  Miriam_Libre,
  Rubik,
  Secular_One,
  Suez_One,
} from "next/font/google";
import "./globals.css";

/*
 * The faces are loaded here and NONE is applied to the document root. next/font's
 * `variable` option declares a CSS custom property without setting font-family,
 * so nothing inherits a face from the root.
 *
 * That is the point. Dashboard chrome opts into Assistant with the `font-ui`
 * utility; the board renderer takes its type from the board document instead,
 * because board fonts are user-selectable per text element. See the type section
 * of lib/tokens.css and lib/board-theme.ts's BOARD_FONTS.
 *
 * TWO FACES ARE CHROME, THE REST ARE BOARD-ONLY. Assistant and Frank Ruhl Libre
 * back the dashboard (`--type-ui`, `--type-sefarim`). Every other face here
 * exists only so a shul can pick it for its own board content (design.md §1b) —
 * they are all bilingual Hebrew-and-Latin Google faces, chosen so a board that
 * mixes scripts stays readable whichever the gabbai picks. The display faces
 * (Suez One, Secular One) ship one weight; the text faces ship 400 and 700.
 */

// The UI face for both scripts. 400 and 600 only — the spec has no other weights.
const assistant = Assistant({
  subsets: ["latin", "hebrew"],
  weight: ["400", "600"],
  variable: "--font-assistant",
  display: "swap",
});

// Sefarim typography — Hebrew dates and zmanim values in chrome, and a board face.
const frankRuhlLibre = Frank_Ruhl_Libre({
  subsets: ["latin", "hebrew"],
  weight: ["400", "600"],
  variable: "--font-frank-ruhl",
  display: "swap",
});

// Board-only faces, all bilingual. See the note above.
const heebo = Heebo({ subsets: ["latin", "hebrew"], weight: ["400", "700"], variable: "--font-heebo", display: "swap" });
const rubik = Rubik({ subsets: ["latin", "hebrew"], weight: ["400", "700"], variable: "--font-rubik", display: "swap" });
const alef = Alef({ subsets: ["latin", "hebrew"], weight: ["400", "700"], variable: "--font-alef", display: "swap" });
const davidLibre = David_Libre({
  subsets: ["latin", "hebrew"],
  weight: ["400", "700"],
  variable: "--font-david-libre",
  display: "swap",
});
const miriamLibre = Miriam_Libre({
  subsets: ["latin", "hebrew"],
  weight: ["400", "700"],
  variable: "--font-miriam-libre",
  display: "swap",
});
const suezOne = Suez_One({ subsets: ["latin", "hebrew"], weight: ["400"], variable: "--font-suez-one", display: "swap" });
const secularOne = Secular_One({
  subsets: ["latin", "hebrew"],
  weight: ["400"],
  variable: "--font-secular-one",
  display: "swap",
});

const FONT_VARIABLES = [
  assistant,
  frankRuhlLibre,
  heebo,
  rubik,
  alef,
  davidLibre,
  miriamLibre,
  suezOne,
  secularOne,
]
  .map((face) => face.variable)
  .join(" ");

export const metadata: Metadata = {
  title: "Shulboard",
  description: "Digital bulletin boards for shuls",
};

/** The same light-only declaration as app/globals.css, as a meta tag — some
 *  browsers decide on forced darkening before they read any CSS. */
export const viewport: Viewport = {
  colorScheme: "only light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${FONT_VARIABLES} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
