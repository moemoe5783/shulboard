"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { SIGN_IN_PATH } from "@/lib/routes";
import { createClient, supabaseUrl } from "@/lib/supabase/client";
import { confirmUrl, describeAuthError } from "../../shared";

export function ForgotPasswordForm({ initialEmail = "", from }: { initialEmail?: string; from?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [status, setStatus] = useState<"idle" | "working" | "sent">("idle");
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setStatus("working");
    try {
      const { error: sendError } = await createClient().auth.resetPasswordForEmail(email, {
        redirectTo: confirmUrl(from),
      });
      if (sendError) {
        setError(`That didn't send. ${describeAuthError(sendError, supabaseUrl())}`);
        setStatus("idle");
        return;
      }
      setStatus("sent");
    } catch (thrown) {
      setError(`That didn't send. ${thrown instanceof Error ? thrown.message : String(thrown)}`);
      setStatus("idle");
    }
  }

  if (status === "sent") {
    return (
      <>
        <h2 className="text-heading">Check your email</h2>
        <p className="text-body text-ink-soft mt-1">
          If there&rsquo;s an account for {email}, a link to choose a new password is on its way. It works once and
          expires in an hour.
        </p>
        <p className="text-body mt-4">
          <Link href={SIGN_IN_PATH} className="text-verdigris">
            Back to sign in
          </Link>
        </p>
      </>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field
        id="email"
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={status === "working"}>
          {status === "working" ? "Sending" : "Email me a reset link"}
        </Button>
        <Link href={SIGN_IN_PATH} className="text-body text-verdigris">
          Back to sign in
        </Link>
      </div>
      {error && (
        <p role="alert" className="text-body text-ink">
          {error}
        </p>
      )}
    </form>
  );
}
