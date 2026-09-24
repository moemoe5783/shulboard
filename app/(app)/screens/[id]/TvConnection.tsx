"use client";

import { startTransition, useActionState, useCallback, useState } from "react";
import { Button, Spinner } from "@/components/Button";
import { useFormStatus } from "react-dom";
import { Field } from "@/components/Field";
import { pairingCodeFrom, QrScanner } from "@/components/QrScanner";
import { connectTv, disconnectTv, type ConnectTvState } from "../actions";

/*
 * The screen's TV: which one it is, or how to connect one. One TV per screen
 * (supabase/migrations/20260925090200_screen_pairing.sql) — to use a different
 * TV, disconnect this one first.
 */

export function ConnectTvForm({ screenId, initialCode = "" }: { screenId: string; initialCode?: string }) {
  const [state, action, pending] = useActionState<ConnectTvState, FormData>(connectTv, {});
  const [code, setCode] = useState(initialCode);
  const [scanning, setScanning] = useState(false);
  const [scanProblem, setScanProblem] = useState<string>();

  // A scan fills the code in and connects straight away — the whole point is
  // not having to type anything.
  const onScan = useCallback((value: string) => {
    setScanning(false);
    const scanned = pairingCodeFrom(value);
    if (!scanned) {
      setScanProblem("That QR code isn't a Shulboard TV code. Scan the code on the TV's pairing screen.");
      return;
    }
    setScanProblem(undefined);
    setCode(scanned);
    const form = new FormData();
    form.set("screenId", screenId);
    form.set("code", scanned);
    startTransition(() => action(form));
  }, [action, screenId]);

  if (state.connected) {
    return (
      <p role="status" className="text-body">
        Connected. The TV will show {state.connected}&rsquo;s board in a few seconds.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {scanning ? (
        <QrScanner onScan={onScan} onClose={() => setScanning(false)} />
      ) : (
        <div className="flex flex-col gap-1">
          <div>
            <Button variant="secondary" onClick={() => setScanning(true)}>
              Scan the TV&rsquo;s QR code
            </Button>
          </div>
          {scanProblem && (
            <p role="alert" className="text-body text-ink">
              {scanProblem}
            </p>
          )}
        </div>
      )}
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <input type="hidden" name="screenId" value={screenId} />
        <div className="sm:w-44">
          <Field
            id={`code-${screenId}`}
            name="code"
            label="Or type the code on the TV"
            inputMode="numeric"
            autoComplete="off"
            placeholder="482 915"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            maxLength={7}
            required
            className="numeric tracking-widest"
          />
        </div>
        <div>
          <Button type="submit" variant="primary" busy={pending}>
            {pending ? "Connecting" : "Connect TV"}
          </Button>
        </div>
        {state.error && (
          <p role="alert" className="text-body text-ink sm:basis-full">
            {state.error}
          </p>
        )}
      </form>
    </div>
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
        <DisconnectButton />
        <KeepConnected onKeep={() => setConfirming(false)} />
      </div>
    </form>
  );
}

/** Reads the form it sits in, so it can say it's working while the TV is
 *  disconnected — a second or two, and without this nothing on the page moved. */
function DisconnectButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="text-cell rounded-control border-rule-firm text-offline enabled:hover:bg-verdigris-wash/40 inline-flex h-8 items-center gap-2 border px-3 disabled:cursor-progress"
    >
      {pending && <Spinner />}
      {pending ? "Disconnecting" : "Disconnect TV"}
    </button>
  );
}

function KeepConnected({ onKeep }: { onKeep: () => void }) {
  const { pending } = useFormStatus();
  return (
    <Button variant="tertiary" onClick={onKeep} disabled={pending}>
      Keep it connected
    </Button>
  );
}
