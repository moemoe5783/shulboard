"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { SIGN_IN_PATH, safeNext } from "@/lib/routes";
import { createClient, supabaseUrl } from "@/lib/supabase/client";
import { supabaseConfigProblem } from "@/lib/supabase/env";
import { confirmUrl, describeAuthError, MIN_PASSWORD_LENGTH, PASSWORD_HINT, passwordProblem } from "../shared";

export function SignUpForm({ from, initialEmail = "" }: { from?: string; initialEmail?: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "confirm">("idle");
  const [error, setError] = useState<string>();
  const configProblem = supabaseConfigProblem();
  const signInHref = `${SIGN_IN_PATH}?${new URLSearchParams({ ...(from ? { from } : {}), ...(email ? { email } : {}) })}`;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const problem = passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }
    setStatus("working");
    try {
      const supabase = createClient();
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // Where the confirmation email's link returns (the email template
          // builds its link from this — supabase/templates/confirmation.html).
          emailRedirectTo: confirmUrl(from),
          data: name.trim() ? { full_name: name.trim() } : undefined,
        },
      });
      if (signUpError) {
        setError(describeAuthError(signUpError, supabaseUrl()));
        setStatus("idle");
        return;
      }
      // With email confirmation on, there's no session until the link is
      // opened. An address that already has an account also comes back with
      // no session (and no error, so as not to reveal who has an account).
      if (!data.session) {
        setStatus("confirm");
        return;
      }
      window.location.assign(safeNext(from));
    } catch (thrown) {
      setError(`That didn't create an account. ${thrown instanceof Error ? thrown.message : String(thrown)}`);
      setStatus("idle");
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

  if (status === "confirm") {
    return (
      <>
        <h2 className="text-heading">Confirm your email</h2>
        <p className="text-body text-ink-soft mt-1">
          We sent a link to {email}. Open it to finish setting up your account. If you already have an account with
          this email, <Link href={signInHref} className="text-verdigris">sign in</Link> instead.
        </p>
      </>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field
        id="name"
        label="Your name"
        name="name"
        autoComplete="name"
        placeholder="Optional"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
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
      <Field
        id="password"
        label="Password"
        type="password"
        name="password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        hint={PASSWORD_HINT}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <div>
        <Button type="submit" variant="primary" busy={status === "working"}>
          {status === "working" ? "Creating your account" : "Create account"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-body text-ink">
          {error}
        </p>
      )}
      <p className="text-body text-ink-soft">
        Already have an account?{" "}
        <Link href={signInHref} className="text-verdigris">
          Sign in
        </Link>
      </p>
    </form>
  );
}
