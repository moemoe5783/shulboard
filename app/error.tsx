"use client";

import Link from "next/link";
import { Button, buttonClassName } from "@/components/Button";
import { Notice } from "@/components/Notice";

/*
 * Everything below the root layout. Without this, a thrown error anywhere in the
 * dashboard renders Next's own black-on-white error page, which tells a gabbai
 * nothing and looks like a different product.
 *
 * This boundary sits above the app shell, so the rail is gone by the time it
 * renders and the page has to bring its own frame. The screens segment has its
 * own boundary for the ordinary case, which keeps the rail.
 */

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="bg-paper font-ui min-h-screen px-6 py-6">
      <div className="mx-auto max-w-360">
        <Notice
          tone="problem"
          title="This page didn't load"
          reference={error.digest}
          actions={
            <>
              <Button variant="primary" onClick={reset}>
                Try again
              </Button>
              <Link href="/screens" className={buttonClassName("tertiary")}>
                Go to screens
              </Link>
            </>
          }
        >
          Try again. Screens that are already running keep showing their board —
          they only need this app when something changes.
        </Notice>
      </div>
    </div>
  );
}
