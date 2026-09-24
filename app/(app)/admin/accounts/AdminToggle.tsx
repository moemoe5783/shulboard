"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/Button";
import { setPlatformAdmin } from "../actions";

/** Make an account a platform admin, or stop it being one — behind a confirm
 *  for granting, since an admin sees every shul. */
export function AdminToggle({ userId, email, admin, self }: { userId: string; email: string; admin: boolean; self: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const run = (next: boolean) =>
    start(async () => {
      setError(undefined);
      const result = await setPlatformAdmin(userId, next);
      if (result.error) setError(result.error);
      else setConfirming(false);
    });

  if (admin) {
    return self ? (
      <span className="text-meta text-ink-soft">Admin (you)</span>
    ) : (
      <div className="flex flex-col items-end gap-1 py-1">
        <Button variant="tertiary" busy={pending} onClick={() => run(false)}>
          {pending ? "Removing" : "Remove admin"}
        </Button>
        {error && <span role="alert" className="text-meta text-offline whitespace-normal">{error}</span>}
      </div>
    );
  }
  if (!confirming) {
    return (
      <Button variant="tertiary" onClick={() => setConfirming(true)}>
        Make admin
      </Button>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1 py-1">
      <div className="flex items-center gap-2">
        <Button variant="secondary" busy={pending} onClick={() => run(true)}>
          {pending ? "Saving" : "Make admin"}
        </Button>
        <Button variant="tertiary" disabled={pending} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
      <span className="text-meta text-ink-soft max-w-64 whitespace-normal">
        {email} will see every shul and every account, and can change plans.
      </span>
      {error && <span role="alert" className="text-meta text-offline whitespace-normal">{error}</span>}
    </div>
  );
}
