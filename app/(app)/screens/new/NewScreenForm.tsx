"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, buttonClassName } from "@/components/Button";
import { Field, SelectField } from "@/components/Field";
import { RESOLUTIONS } from "@/lib/screens";
import { createScreen, type ScreenFormState } from "../actions";

export function NewScreenForm() {
  const [state, formAction, pending] = useActionState<ScreenFormState, FormData>(
    createScreen,
    {},
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field
        id="name"
        name="name"
        label="Name"
        required
        maxLength={80}
        placeholder="Main lobby"
        hint="The room it's in reads better than a device model."
      />

      <Field
        id="location"
        name="location"
        label="Where it is"
        maxLength={120}
        placeholder="Entrance, north wall"
        hint="Optional. Shown under the name so anyone can find the right screen."
      />

      <SelectField id="resolution" name="resolution" label="Resolution" required defaultValue="1080p">
        {RESOLUTIONS.map((resolution) => (
          <option key={resolution.id} value={resolution.id}>
            {resolution.label}
          </option>
        ))}
      </SelectField>

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Adding" : "Add screen"}
        </Button>
        <Link href="/screens" className={buttonClassName("tertiary")}>
          Cancel
        </Link>
      </div>

      {state.error && (
        <p role="alert" className="text-body text-ink">
          {state.error}
        </p>
      )}
    </form>
  );
}
