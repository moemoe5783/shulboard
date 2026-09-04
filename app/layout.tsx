import type { Metadata } from "next";
import { Assistant, Frank_Ruhl_Libre } from "next/font/google";
import "./globals.css";

/*
 * Both faces are loaded here and NEITHER is applied. next/font's `variable`
 * option declares a CSS custom property without setting font-family, so nothing
 * inherits a face from the document root.
 *
 * That is the point. Dashboard chrome opts into Assistant with the `font-ui`
 * utility; the board renderer takes its type from the board document instead,
 * because board fonts are user-selectable per text element. See the type section
 * of lib/tokens.css.
 */

// The UI face for both scripts. 400 and 600 only — the spec has no other weights.
const assistant = Assistant({
  subsets: ["latin", "hebrew"],
  weight: ["400", "600"],
  variable: "--font-assistant",
  display: "swap",
});

// Reserved for Hebrew dates and zmanim values, where sefarim typography belongs.
// Never used in UI chrome.
const frankRuhlLibre = Frank_Ruhl_Libre({
  subsets: ["latin", "hebrew"],
  weight: ["400", "600"],
  variable: "--font-frank-ruhl",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Shulboard",
  description: "Digital bulletin boards for shuls",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${assistant.variable} ${frankRuhlLibre.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
