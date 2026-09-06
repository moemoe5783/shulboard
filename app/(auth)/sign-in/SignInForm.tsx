"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { createClient, supabaseUrl } from "@/lib/supabase/client";
import { supabaseConfigProblem } from "@/lib/supabase/env";

/**
 * Magic link and Google, both landing on /auth/callback.
 *
 * One primary action: send the link. Google is the secondary, because a shul
 * office is as likely to share a mailbox as a Google account and the email path
 * is the one that always works.
 */
/**
 * A network failure from supabase-js arrives as "Failed to fetch", which is the
 * browser saying the request never completed and nothing else. The usual causes
 * are a wrong project URL, a paused project, or a build that predates the
 * environment variables — so name them, rather than repeating the browser.
 */
function describe(error: { message: string }, url: string | null): string {
  if (/failed to fetch|networkerror|load failed/i.test(error.message)) {
    return (
      `Couldn't reach Supabase${url ? ` at ${url}` : ""}. Check that the project ` +
      `is running and not paused, that NEXT_PUBLIC_SUPABASE_URL points at it, and ` +
      `that this build was made after those variables were set.`
    );
  }
  return `${error.message}. Check the address and try again.`;
}

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

  // The client holds the values that were inlined at build time; the page that
  // rendered this read them at request time. When those disagree, this is the
  // half that decides, because this is the half that makes the call.
  const configProblem = supabaseConfigProblem();

  const callback = () => {
    const url = new URL("/auth/callback", window.location.origin);
    if (from) url.searchParams.set("from", from);
    return url.toString();
  };

  async function sendMagicLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setStatus("sending");

    try {
      const supabase = createClient();
      const { error: sendError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: callback() },
      });

      if (sendError) {
        setError(`That didn't send. ${describe(sendError, supabaseUrl())}`);
        setStatus("idle");
        return;
      }

      setStatus("sent");
    } catch (thrown) {
      // createClient() throws when the configuration is unusable. Without this
      // the button would sit on "Sending" forever with the reason only in the
      // console.
      setError(
        `That didn't send. ${thrown instanceof Error ? thrown.message : String(thrown)}`,
      );
      setStatus("idle");
    }
  }

  async function continueWithGoogle() {
    setError(undefined);
    try {
      const supabase = createClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callback() },
      });
      if (oauthError) {
        setError(`Google sign-in didn't start. ${describe(oauthError, supabaseUrl())}`);
      }
    } catch (thrown) {
      setError(
        `Google sign-in didn't start. ${thrown instanceof Error ? thrown.message : String(thrown)}`,
      );
    }
  }

  if (configProblem) {
    return (
      <>
        <h2 className="text-heading">Sign-in isn&rsquo;t configured yet</h2>
        <p className="text-body text-ink-soft mt-1">{configProblem}</p>
      </>
    );
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
        <p role="alert" className="text-body text-ink mt-4">
          {error}
        </p>
      )}
    </>
  );
}
