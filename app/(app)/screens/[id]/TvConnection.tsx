"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { connectTv, disconnectTv, type ConnectTvState } from "../actions";

/*
 * The screen's TV: which one it is, or how to connect one. One TV per screen
 * (supabase/migrations/20260925090200_screen_pairing.sql) — to use a different
 * TV, disconnect this one first.
 */

export function ConnectTvForm({ screenId, initialCode = "" }: { screenId: string; initialCode?: string }) {
  const [state, action, pending] = useActionState<ConnectTvState, FormData>(connectTv, {});
  if (state.connected) {
    return (
      <p role="status" className="text-body">
        Connected. The TV will show {state.connected}&rsquo;s board in a few seconds.
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="screenId" value={screenId} />
      <div className="sm:w-44">
        <Field
          id={`code-${screenId}`}
          name="code"
          label="Code on the TV"
          inputMode="numeric"
          autoComplete="off"
          placeholder="482 915"
          defaultValue={initialCode}
          maxLength={7}
          required
          className="numeric tracking-widest"
        />
      </div>
      <div>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Connecting" : "Connect TV"}
        </Button>
      </div>
      {state.error && (
        <p role="alert" className="text-body text-ink sm:basis-full">
          {state.error}
        </p>
      )}
    </form>
  );
}

export function DisconnectTv({ screenId }: { screenId: string }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button variant="secondary" onClick={() => setConfirming(true)}>
        Disconnect TV
      </Button>
    );
  }
  return (
    <form action={disconnectTv} className="flex flex-col gap-3">
      <input type="hidden" name="screenId" value={screenId} />
      <p className="text-body">
        The TV stops showing this board the next time it checks in — within a minute — and shows a code to connect it
        again. Use this to move the screen to a new TV.
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="text-cell rounded-control border-rule-firm text-offline hover:bg-verdigris-wash/40 h-8 border px-3">
          Disconnect TV
        </button>
        <Button variant="tertiary" onClick={() => setConfirming(false)}>
          Keep it connected
        </Button>
      </div>
    </form>
  );
}
