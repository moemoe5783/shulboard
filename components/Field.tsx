import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

/*
 * A labelled input. 32px high, 5px radius, 1px --rule — the same control
 * geometry as Button.
 *
 * Not a general form kit. It exists because sign-in and org creation both need a
 * labelled field, and two views hand-rolling one is how a fourth radius arrives.
 */

const CONTROL =
  "text-body rounded-control border-rule text-ink bg-surface h-8 w-full border px-2 " +
  "placeholder:text-ink-faint disabled:text-ink-faint";

function Wrapper({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-meta text-ink-soft">
        {label}
      </label>
      {children}
      {hint && <p className="text-meta text-ink-soft">{hint}</p>}
    </div>
  );
}

export type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  id: string;
  hint?: string;
};

export function Field({ label, id, hint, className = "", ...props }: FieldProps) {
  return (
    <Wrapper label={label} htmlFor={id} hint={hint}>
      <input id={id} className={`${CONTROL} ${className}`} {...props} />
    </Wrapper>
  );
}

export type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  id: string;
  hint?: string;
};

export function SelectField({
  label,
  id,
  hint,
  className = "",
  children,
  ...props
}: SelectFieldProps) {
  return (
    <Wrapper label={label} htmlFor={id} hint={hint}>
      <select id={id} className={`${CONTROL} ${className}`} {...props}>
        {children}
      </select>
    </Wrapper>
  );
}
