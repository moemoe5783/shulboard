"use client";

import { useState } from "react";
import { Button } from "@/components/Button";

/*
 * The display link, and the one action this page is for.
 *
 * The URL is rendered server-side so it is correct in the markup and correct
 * for anyone reading it off the page; only the copying needs the browser.
 */
export function DisplayLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused — an insecure origin, a permission
      // prompt declined. The URL is on screen either way, so say what to do
      // rather than failing silently.
      setCopied(false);
      window.prompt("Copy the link:", url);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Not <code>. The display link is data a gabbai reads off the screen and
          types into a TV, not source, and preflight would set <code> in a
          monospace face this product does not specify. */}
      <span className="text-cell text-ink border-rule rounded-control bg-paper min-w-0 flex-1 truncate border px-2 py-1.5">
        {url}
      </span>
      <Button variant="primary" onClick={copy}>
        {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}
