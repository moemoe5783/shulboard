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
 * was changed, and reports how far ahead the screens are now covered
 * rather than a checkmark — or the provider's own error verbatim. About
 * four weeks is the whole window the embed offers (WARM_WEEKS in
 * lib/zmanim/warm.ts), so "through October 4" is the expected answer, not
 * a short one.
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
          Reads about four weeks of candle lighting and Shabbos end times
          from chabad.org for the saved ZIP — that&rsquo;s as far ahead as
          chabad.org will give. Anything beyond it is calculated instead.
          This runs on its own once a day; use this to check it works, or
          after changing the ZIP.
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
