import type { Metadata, Viewport } from "next";
import { Assistant, Frank_Ruhl_Libre } from "next/font/google";
import { FONT_FACES_CSS } from "@/lib/fonts/catalog.generated";
import "./globals.css";

/*
 * TWO FONT SYSTEMS, KEPT APART.
 *
 * The dashboard's chrome faces — Assistant and Frank Ruhl Libre — come from
 * next/font, which downloads them at build time and serves them from this
 * app; nothing reaches Google at runtime. Neither is applied to the document
 * root: `variable` declares a CSS custom property without setting
 * font-family, so chrome opts in with the `font-ui` utility (lib/tokens.css).
 *
 * Board fonts are the catalog (lib/fonts): every face a board can use,
 * self-hosted from @fontsource and declared in one stylesheet the build writes
 * (scripts/build-fonts.ts). It's linked here, on every page, so the editor and
 * a screen declare exactly the same faces. Declaring a face downloads nothing;
 * a browser fetches a file only for text that uses it.
 */

// The UI face for both scripts. 400 and 600 only — the spec has no other weights.
const assistant = Assistant({
  subsets: ["latin", "hebrew"],
  weight: ["400", "600"],
  variable: "--font-assistant",
  display: "swap",
});

// Sefarim typography — Hebrew dates and columns of times in chrome.
const frankRuhlLibre = Frank_Ruhl_Libre({
  subsets: ["latin", "hebrew"],
  weight: ["400", "600"],
  variable: "--font-frank-ruhl",
  display: "swap",
});

const FONT_VARIABLES = `${assistant.variable} ${frankRuhlLibre.variable}`;

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
      <head>
        {/* The board font catalog's faces — see above. Self-hosted, hashed,
            cached forever. */}
        <link rel="stylesheet" href={FONT_FACES_CSS} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
