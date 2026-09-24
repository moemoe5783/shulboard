"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { createClient } from "@/lib/supabase/client";

export function ProfileForm({ name: initial }: { name: string }) {
  const [name, setName] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setStatus("saving");
    const { error: updateError } = await createClient().auth.updateUser({ data: { full_name: name.trim() } });
    if (updateError) {
      setError(updateError.message);
      setStatus("idle");
      return;
    }
    setStatus("saved");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="sm:w-80">
        <Field
          id="full-name"
          label="Name"
          autoComplete="name"
          maxLength={120}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setStatus("idle");
          }}
        />
      </div>
      <div>
        <Button type="submit" variant="secondary" disabled={status === "saving" || name.trim() === initial}>
          {status === "saving" ? "Saving" : status === "saved" ? "Saved" : "Save name"}
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
