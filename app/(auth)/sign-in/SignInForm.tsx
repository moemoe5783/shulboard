"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { FORGOT_PASSWORD_PATH, MFA_VERIFY_PATH, SIGN_UP_PATH, safeNext } from "@/lib/routes";
import { createClient, supabaseUrl } from "@/lib/supabase/client";
import { supabaseConfigProblem } from "@/lib/supabase/env";
import { callbackUrl, confirmUrl, describeAuthError } from "../shared";

/**
 * Email and password, with an emailed link and Google as the alternatives.
 *
 * One primary action: sign in. The link is for whoever doesn't remember a
 * password (or has none yet — a Google account, a link-only account). Google
 * is the secondary, shown only when the Supabase project has it turned on.
 */
export function SignInForm({
  from,
  initialEmail = "",
  initialError,
  googleEnabled = false,
}: {
  from?: string;
  initialEmail?: string;
  initialError?: string;
  /** Offered only once Google is turned on in Supabase (lib/supabase/auth-settings.ts). */
  googleEnabled?: boolean;
}) {
  const [mode, setMode] = useState<"password" | "link">("password");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "sent">("idle");
  const [error, setError] = useState<string | undefined>(initialError);

  // The client holds the values that were inlined at build time; the page that
  // rendered this read them at request time. When those disagree, this is the
  // half that decides, because this is the half that makes the call.
  const configProblem = supabaseConfigProblem();
  const next = safeNext(from);
  const withFrom = (path: string, extra: Record<string, string> = {}) => {
    const params = new URLSearchParams({ ...(from ? { from } : {}), ...extra });
    const query = params.toString();
    return query ? `${path}?${query}` : path;
  };

  async function run(action: () => Promise<void>, failure: string) {
    setError(undefined);
    setStatus("working");
    try {
      await action();
    } catch (thrown) {
      // createClient() throws when the configuration is unusable. Without this
      // the button would sit on "Signing in" forever with the reason only in
      // the console.
      setError(`${failure} ${thrown instanceof Error ? thrown.message : String(thrown)}`);
      setStatus("idle");
    }
  }

  const signInWithPassword = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        setError(describeAuthError(signInError, supabaseUrl()));
        setStatus("idle");
        return;
      }
      // An account with an authenticator app isn't finished signing in yet.
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const target = aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2" ? withFrom(MFA_VERIFY_PATH) : next;
      // A full navigation, so the server renders with the new session cookie.
      window.location.assign(target);
    }, "That didn't sign you in.");
  };

  const sendMagicLink = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run(async () => {
      const supabase = createClient();
      const { error: sendError } = await supabase.auth.signInWithOtp({
        email,
        // Sign-in only: an unknown address gets an error, not a new account.
        // Accounts are made on the Create an account page, with a password.
        options: { emailRedirectTo: confirmUrl(from), shouldCreateUser: false },
      });
      if (sendError) {
        setError(`That didn't send. ${describeAuthError(sendError, supabaseUrl())}`);
        setStatus("idle");
        return;
      }
      setStatus("sent");
    }, "That didn't send.");
  };

  const continueWithGoogle = () =>
    run(async () => {
      const supabase = createClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl(from) },
      });
      if (oauthError) {
        setError(`Google sign-in didn't start. ${describeAuthError(oauthError, supabaseUrl())}`);
        setStatus("idle");
      }
    }, "Google sign-in didn't start.");

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
          A sign-in link is on its way to {email}. It works once and expires in an hour.
        </p>
        <div className="mt-4">
          <Button variant="tertiary" onClick={() => setStatus("idle")}>
            Use a different address
          </Button>
        </div>
      </>
    );
  }

  const working = status === "working";

  return (
    <>
      {mode === "password" ? (
        <form onSubmit={signInWithPassword} className="flex flex-col gap-4">
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
          <div className="flex flex-col gap-1">
            <Field
              id="password"
              label="Password"
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <Link href={withFrom(FORGOT_PASSWORD_PATH, email ? { email } : {})} className="text-meta text-verdigris self-start">
              Forgot your password?
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" busy={working}>
              {working ? "Signing in" : "Sign in"}
            </Button>
            <Button variant="tertiary" onClick={() => setMode("link")}>
              Email me a link instead
            </Button>
          </div>
        </form>
      ) : (
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
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" busy={working}>
              {working ? "Sending" : "Email me a link"}
            </Button>
            <Button variant="tertiary" onClick={() => setMode("password")}>
              Use my password
            </Button>
          </div>
        </form>
      )}

      {googleEnabled && (
        <div className="border-rule mt-6 border-t pt-6">
          <Button variant="secondary" onClick={continueWithGoogle} disabled={working}>
            Continue with Google
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-body text-ink mt-4">
          {error}
        </p>
      )}

      <p className="text-body text-ink-soft mt-6">
        New to Shulboard?{" "}
        <Link href={withFrom(SIGN_UP_PATH, email ? { email } : {})} className="text-verdigris">
          Create an account
        </Link>
      </p>
    </>
  );
}
