/**
 * Change Password Form — /settings/security.
 *
 * Current + new + confirm. The rules shown under "New password" are
 * the same `passwordProblems` policy the server enforces. On success
 * the form resets and tells the user other devices were signed out
 * (ADR-017 — the password fingerprint in their sessions no longer
 * matches).
 */

"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { changePasswordAction } from "@/app/actions/auth";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import {
  changePasswordInitialState,
  type ChangePasswordFormState,
} from "@/lib/security-form";

export function ChangePasswordForm() {
  const [state, formAction, isPending] = useActionState<
    ChangePasswordFormState,
    FormData
  >(changePasswordAction, changePasswordInitialState);
  const formRef = useRef<HTMLFormElement>(null);
  // Manual dispatch: React 19 resets every `<form action>` form after
  // the action settles — even on an error — which would make a
  // confirm mismatch wipe all three fields. Clear explicitly on
  // success only (effect below).
  const [, startSubmit] = useTransition();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startSubmit(() => formAction(fd));
  };

  // Clear the fields after a successful change so the new password
  // isn't left sitting in the DOM.
  useEffect(() => {
    if (state.status === "ok") formRef.current?.reset();
  }, [state]);

  const errs = state.errors ?? {};

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-3">
      <Field
        label="Current password"
        name="currentPassword"
        error={errs.currentPassword?.[0]}
      >
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass(!!errs.currentPassword)}
        />
      </Field>
      <Field
        label="New password"
        name="newPassword"
        error={errs.newPassword?.[0]}
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. A long passphrase beats symbols and digits.`}
      >
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          className={inputClass(!!errs.newPassword)}
        />
      </Field>
      <Field
        label="Confirm new password"
        name="confirmPassword"
        error={errs.confirmPassword?.[0]}
      >
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          className={inputClass(!!errs.confirmPassword)}
        />
      </Field>

      <div className="flex items-center gap-3 pt-2 border-t border-line">
        <button
          type="submit"
          disabled={isPending}
          className={cn(
            "inline-flex items-center h-9 px-4 rounded-md text-sm font-medium",
            "bg-brand-500 text-white hover:bg-brand-600 transition-colors",
            "disabled:opacity-60 disabled:cursor-not-allowed"
          )}
        >
          {isPending ? "Updating…" : "Change password"}
        </button>
        {state.status === "ok" && (
          <span className="inline-flex items-center gap-1.5 text-2xs text-ok">
            <CheckCircle2 size={12} />
            Password changed. Other devices have been signed out.
          </span>
        )}
        {errs._form?.[0] && (
          <span className="inline-flex items-center gap-1.5 text-2xs text-warn">
            <TriangleAlert size={12} />
            {errs._form[0]}
          </span>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  hint,
  error,
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={name}
        className="text-2xs font-mono uppercase tracking-wider text-ink-4"
      >
        {label}
      </label>
      {children}
      {hint && !error && (
        <span className="text-[10px] text-ink-4 leading-relaxed">{hint}</span>
      )}
      {error && <span className="text-2xs text-warn">{error}</span>}
    </div>
  );
}

function inputClass(hasError: boolean): string {
  return cn(
    "h-9 px-3 rounded-md border bg-white text-xs text-ink",
    "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
    hasError ? "border-warn" : "border-line"
  );
}
