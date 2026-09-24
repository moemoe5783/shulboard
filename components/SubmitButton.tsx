"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./Button";

/**
 * A form's submit button that shows it's working while the form's action
 * runs — the label changes to `pendingLabel` and a spinner appears
 * (Button's `busy`). For a form whose action has no state of its own to read
 * `pending` from: it reads the form it sits in.
 */
export function SubmitButton({
  pendingLabel,
  children,
  ...props
}: Omit<ButtonProps, "type" | "busy"> & { pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" busy={pending} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
