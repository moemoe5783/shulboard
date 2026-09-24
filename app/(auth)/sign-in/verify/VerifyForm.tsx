"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { createClient, supabaseUrl } from "@/lib/supabase/client";
import { describeAuthError } from "../../shared";

export function VerifyForm({ next }: { next: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "working">("idle");
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setStatus("working");
    try {
      const supabase = createClient();
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) throw listError;
      const factor = factors.totp.find((f) => f.status === "verified");
      if (!factor) {
        // Nothing to verify against — the app was removed elsewhere.
        window.location.assign(next);
        return;
      }
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (verifyError) {
        setError(
          /invalid|expired/i.test(verifyError.message)
            ? "That code didn't match. Codes change every 30 seconds — enter the one showing now."
            : describeAuthError(verifyError, supabaseUrl()),
        );
        setCode("");
        setStatus("idle");
        inputRef.current?.focus();
        return;
      }
      window.location.assign(next);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
      setStatus("idle");
    }
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field
        ref={inputRef}
        id="code"
        label="Code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        className="numeric tracking-widest"
        value={code}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "").slice(0, 6);
          setCode(digits);
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" busy={status === "working"} disabled={code.length !== 6}>
          {status === "working" ? "Checking" : "Continue"}
        </Button>
        <Button variant="tertiary" onClick={signOut}>
          Sign in as someone else
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-body text-ink">
          {error}
        </p>
      )}
      <p className="text-meta text-ink-soft">
        Lost your phone? Contact Shulboard support to reset two-step sign-in for your account.
      </p>
    </form>
  );
}
