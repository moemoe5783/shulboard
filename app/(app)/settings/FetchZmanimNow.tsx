"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { fetchChabadZmanimNow, type FetchZmanimNowState } from "../actions";

/*
 * "Fetch now" — the one thing missing from the Chabad.org setup path.
 *
 * The warming cron is right for steady state, but after picking Chabad.org
 * a gabbai has nothing to do but wait, and no way to tell "the cron hasn't
 * run yet" from "the cron is broken". This answers that where the setting
 * was changed, and reports the day counts rather than a checkmark: how many
 * days came back, how many carry a candle-lighting time, or the provider's
 * own error.
 *
 * Only rendered when Chabad.org is the selected source — it does nothing
 * for Hebcal or Manual, which never read the cache. The action re-checks
 * admin, the ZMANIM_CHABAD_ENABLED flag and a per-location cooldown
 * server-side; none of that is this component's to enforce.
 */
export function FetchZmanimNow() {
  const [state, setState] = useState<FetchZmanimNowState>({ status: "idle" });
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Button
          onClick={() =>
            startTransition(async () => {
              setState(await fetchChabadZmanimNow());
            })
          }
          disabled={pending}
        >
          {pending ? "Fetching" : "Fetch now"}
        </Button>
        <p className="text-meta text-ink-soft">
          Warms 90 days from chabad.org for the saved ZIP. Runs daily on its
          own; this is for checking it works.
        </p>
      </div>

      {state.status !== "idle" && (
        <p
          role="status"
          className={`text-body ${state.status === "failed" ? "text-stale" : "text-ink-soft"}`}
        >
          {state.message}
        </p>
      )}
    </div>
  );
}
