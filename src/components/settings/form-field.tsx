/**
 * Shared field chrome for the settings forms (team, invite, firm,
 * roles): a label that is really associated with its control, a hint,
 * and an inline error wired up via aria-describedby.
 *
 * `children` is a render prop receiving the id / aria attributes to
 * spread onto the control, so the label's `htmlFor` always matches a
 * real `id` (useId keeps ids unique when several rows render the same
 * form on one page).
 */

"use client";

import { useId } from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type FieldControlProps = {
  id: string;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
};

export function Field({
  label,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: (control: FieldControlProps) => React.ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label
        htmlFor={id}
        className="text-xs font-medium text-ink-2"
      >
        {label}
        {required && <span className="text-warn ml-1">*</span>}
      </label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {hint && !error && (
        <span id={hintId} className="text-3xs text-ink-4 leading-relaxed">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="text-2xs text-warn">
          {error}
        </span>
      )}
    </div>
  );
}

/** Text-input classes; `size` matches the dense (team/role rows) and
 *  roomier (firm profile) form densities. */
export function inputClass(
  hasError: boolean,
  size: "sm" | "md" = "sm"
): string {
  return cn(
    "px-2.5 rounded-md border bg-white text-xs text-ink",
    size === "md" ? "h-9 px-3" : "h-8",
    "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
    "placeholder:text-ink-4",
    hasError ? "border-warn" : "border-line"
  );
}

/** Banner for form-level (`_form`) errors and any error state that
 *  carries no field errors. Renders nothing without a message. */
export function FormErrorBanner({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn"
    >
      <TriangleAlert size={12} className="shrink-0 mt-px" />
      <span>{message}</span>
    </div>
  );
}

/** The message to show in the form-level banner: the action's `_form`
 *  error, or a generic fallback when it failed without any field
 *  errors. Field errors are rendered next to their fields. */
export function formErrorMessage(
  state: { status: "idle" | "ok" | "error"; errors?: Record<string, string[]> },
  fallback: string
): string | null {
  if (state.status !== "error") return null;
  const form = state.errors?._form?.[0];
  if (form) return form;
  const hasFieldErrors = Object.keys(state.errors ?? {}).length > 0;
  return hasFieldErrors ? null : fallback;
}
