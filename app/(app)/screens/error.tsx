"use client";

import { Button } from "@/components/Button";
import { Notice } from "@/components/Notice";

/*
 * A failed load inside the screens section. This boundary is below the app
 * shell, so the rail stays put and only the content pane reports the problem —
 * one section failing should not blank the whole dashboard.
 */

export default function ScreensError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Notice
      tone="problem"
      title="Couldn't load your screens"
      reference={error.digest}
      actions={
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
      }
    >
      Try again. The screens themselves keep showing their board while this is
      down — nothing on the wall has gone dark.
    </Notice>
  );
}
