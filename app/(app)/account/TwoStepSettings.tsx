"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { createClient } from "@/lib/supabase/client";

/*
 * Turning an authenticator app on and off. Supabase Auth holds the secret and
 * checks the codes (supabase.auth.mfa); this only walks through it:
 * scan → enter a code to prove it worked → on. Once on, every sign-in asks
 * for a code (lib/supabase/proxy.ts), and the database refuses a session that
 * hasn't given one (the mfa_satisfied() policies).
 */

type Factor = { id: string; created_at: string };
type Enrolling = { factorId: string; qr: string; secret: string };

export function TwoStepSettings() {
  const [factor, setFactor] = useState<Factor | null | undefined>(undefined);
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null);
  const [code, setCode] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    const { data, error: listError } = await createClient().auth.mfa.listFactors();
    if (listError) {
      setError(listError.message);
      setFactor(null);
      return;
    }
    const verified = data.totp.find((f) => f.status === "verified");
    setFactor(verified ? { id: verified.id, created_at: verified.created_at } : null);
  }, []);

  useEffect(() => {
    // Deferred a tick: the state it sets comes back from the auth server.
    void Promise.resolve().then(load);
  }, [load]);

  async function start() {
    setError(undefined);
    setWorking(true);
    const supabase = createClient();
    // An earlier attempt that was never finished leaves an unverified factor
    // behind; clear it so the new one can take the same name.
    const { data: existing } = await supabase.auth.mfa.listFactors();
    for (const stale of existing?.all.filter((f) => f.status === "unverified") ?? []) {
      await supabase.auth.mfa.unenroll({ factorId: stale.id });
    }
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Authenticator app",
      issuer: "Shulboard",
    });
    setWorking(false);
    if (enrollError || !data) {
      setError(enrollError?.message ?? "Couldn't start. Try again.");
      return;
    }
    setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setCode("");
  }

  async function finish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrolling) return;
    setError(undefined);
    setWorking(true);
    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({
      factorId: enrolling.factorId,
      code,
    });
    setWorking(false);
    if (verifyError) {
      setError("That code didn't match. Codes change every 30 seconds — enter the one showing now.");
      setCode("");
      return;
    }
    setEnrolling(null);
    await load();
  }

  async function cancel() {
    if (enrolling) await createClient().auth.mfa.unenroll({ factorId: enrolling.factorId });
    setEnrolling(null);
    setError(undefined);
  }

  async function turnOff() {
    if (!factor) return;
    setError(undefined);
    setWorking(true);
    const { error: offError } = await createClient().auth.mfa.unenroll({ factorId: factor.id });
    setWorking(false);
    setConfirmOff(false);
    if (offError) {
      setError(offError.message);
      return;
    }
    await load();
  }

  if (factor === undefined) return <p className="text-meta text-ink-soft">Checking…</p>;

  if (enrolling) {
    return (
      <form onSubmit={finish} className="flex flex-col gap-4">
        <ol className="text-body flex list-decimal flex-col gap-2 pl-5">
          <li>Open your authenticator app and add an account.</li>
          <li>Scan this code, or type the key under it.</li>
          <li>Enter the 6-digit code the app shows.</li>
        </ol>
        <div className="flex flex-col items-start gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- an SVG data URL from Supabase Auth. */}
          <img src={enrolling.qr} alt="QR code for your authenticator app" className="border-rule size-44 border bg-white" />
          <p className="text-meta text-ink-soft">
            Key:{" "}
            <span className="text-ink numeric select-all break-all">{enrolling.secret.replace(/(.{4})/g, "$1 ").trim()}</span>
          </p>
        </div>
        <div className="sm:w-48">
          <Field
            id="totp-code"
            label="Code from the app"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            className="numeric tracking-widest"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="primary" disabled={working || code.length !== 6}>
            {working ? "Checking" : "Turn on"}
          </Button>
          <Button variant="tertiary" onClick={cancel}>
            Cancel
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-body text-ink">
            {error}
          </p>
        )}
      </form>
    );
  }

  if (factor) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body">
          <span className="bg-live mr-2 inline-block size-1.5 rounded-full align-middle" aria-hidden />
          On since {new Date(factor.created_at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.
        </p>
        {confirmOff ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-body">Sign-in will only ask for your password.</span>
            <Button variant="secondary" onClick={turnOff} disabled={working}>
              {working ? "Turning off" : "Turn off two-step sign-in"}
            </Button>
            <Button variant="tertiary" onClick={() => setConfirmOff(false)}>
              Keep it on
            </Button>
          </div>
        ) : (
          <div>
            <Button variant="secondary" onClick={() => setConfirmOff(true)}>
              Turn off
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-body text-ink">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-ink-soft">Off.</p>
      <div>
        <Button variant="secondary" onClick={start} disabled={working}>
          {working ? "Starting" : "Set up an authenticator app"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-body text-ink">
          {error}
        </p>
      )}
    </div>
  );
}
