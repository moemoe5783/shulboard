"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button, buttonClassName } from "@/components/Button";
import { SelectField, Field } from "@/components/Field";
import { RESOLUTIONS } from "@/lib/screens";
import { createBoard, type BoardFormState } from "../actions";

export function NewBoardForm() {
  const [state, formAction, pending] = useActionState<BoardFormState, FormData>(createBoard, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field
        id="name"
        name="name"
        label="Name"
        required
        maxLength={120}
        placeholder="Weekday board"
        hint="What you'll call it in the boards list."
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
          {pending ? "Adding" : "Add board"}
        </Button>
        <Link href="/boards" className={buttonClassName("tertiary")}>
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
