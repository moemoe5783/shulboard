"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { deleteScreen, rotateToken } from "../actions";

/*
 * Rotating and deleting, both behind an inline confirm.
 *
 * Neither is reversible from here: rotating blacks out the TV until somebody
 * walks over and retypes the link, and deleting takes the screen and its
 * history. A confirm step in place beats a modal, which would be the only
 * floating thing on the page and would need a shadow to earn it.
 */
export function ScreenSettings({ screenId }: { screenId: string }) {
  const [confirming, setConfirming] = useState<"rotate" | "delete" | null>(null);

  if (confirming === "rotate") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body text-ink-soft max-w-prose">
          The old link stops working straight away. Any screen already showing
          this board goes dark until you open the new link on it.
        </p>
        <div className="flex items-center gap-2">
          <form action={rotateToken}>
            <input type="hidden" name="screenId" value={screenId} />
            <Button type="submit" variant="secondary">
              Rotate link
            </Button>
          </form>
          <Button variant="tertiary" onClick={() => setConfirming(null)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (confirming === "delete") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body text-ink-soft max-w-prose">
          The screen and everything it has reported go with it. The link stops
          working and can&rsquo;t be brought back.
        </p>
        <div className="flex items-center gap-2">
          <form action={deleteScreen}>
            <input type="hidden" name="screenId" value={screenId} />
            <Button type="submit" variant="secondary">
              Delete screen
            </Button>
          </form>
          <Button variant="tertiary" onClick={() => setConfirming(null)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" onClick={() => setConfirming("rotate")}>
        Rotate link
      </Button>
      <Button variant="tertiary" onClick={() => setConfirming("delete")}>
        Delete screen
      </Button>
    </div>
  );
}
