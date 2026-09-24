"use client";

import { useState } from "react";
import { describeAuthError, MIN_PASSWORD_LENGTH, PASSWORD_HINT, passwordProblem } from "@/app/(auth)/shared";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { createClient, supabaseUrl } from "@/lib/supabase/client";

export function NewPasswordForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [status, setStatus] = useState<"idle" | "working" | "done">("idle");
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== again) return setError("The two passwords don't match.");
    setStatus("working");
    try {
      const { error: updateError } = await createClient().auth.updateUser({ password });
      if (updateError) {
        setError(describeAuthError(updateError, supabaseUrl()));
        setStatus("idle");
        return;
      }
      setStatus("done");
      window.location.assign(next);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
      setStatus("idle");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field
        id="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        hint={PASSWORD_HINT}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Field
        id="again"
        label="The same password again"
        type="password"
        autoComplete="new-password"
        required
        value={again}
        onChange={(event) => setAgain(event.target.value)}
      />
      <div>
        <Button type="submit" variant="primary" busy={status === "working"} disabled={status !== "idle"}>
          {status === "working" ? "Saving" : status === "done" ? "Saved" : "Save password"}
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
