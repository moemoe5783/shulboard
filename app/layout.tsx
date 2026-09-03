import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shulboard",
  description: "Digital bulletin boards for shuls",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
