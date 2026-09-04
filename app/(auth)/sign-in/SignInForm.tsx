"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { createClient } from "@/lib/supabase/client";

/**
 * Magic link and Google, both landing on /auth/callback.
 *
 * One primary action: send the link. Google is the secondary, because a shul
 * office is as likely to share a mailbox as a Google account and the email path
 * is the one that always works.
 */
export function SignInForm({
  from,
  initialError,
}: {
  from?: string;
  initialError?: string;
}) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | undefined>(initialError);

  const callback = () => {
    const url = new URL("/auth/callback", window.location.origin);
    if (from) url.searchParams.set("from", from);
    return url.toString();
  };

  async function sendMagicLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setStatus("sending");

    const supabase = createClient();
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callback() },
    });

    if (sendError) {
      // What happened and what to do.
      setError(`That didn't send: ${sendError.message}. Check the address and try again.`);
      setStatus("idle");
      return;
    }

    setStatus("sent");
  }

  async function continueWithGoogle() {
    setError(undefined);
    const supabase = createClient();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback() },
    });
    if (oauthError) {
      setError(`Google sign-in didn't start: ${oauthError.message}. Try the email link instead.`);
    }
  }

  if (status === "sent") {
    return (
      <>
        <h2 className="text-heading">Check your email</h2>
        <p className="text-body text-ink-soft mt-1">
          A sign-in link is on its way to {email}. It works once and expires in an
          hour.
        </p>
        <div className="mt-4">
          <Button variant="tertiary" onClick={() => setStatus("idle")}>
            Use a different address
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <form onSubmit={sendMagicLink} className="flex flex-col gap-4">
        <Field
          id="email"
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          placeholder="gabbai@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <div>
          <Button type="submit" variant="primary" disabled={status === "sending"}>
            {status === "sending" ? "Sending" : "Email me a link"}
          </Button>
        </div>
      </form>

      <div className="border-rule mt-6 border-t pt-6">
        <Button variant="secondary" onClick={continueWithGoogle}>
          Continue with Google
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-body text-offline mt-4">
          {error}
        </p>
      )}
    </>
  );
}
