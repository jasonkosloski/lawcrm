/**
 * Profile Edit Form — current user edits their own row.
 *
 * Editable: name, initials, phone, bar number, avatar URL.
 * Identity / governance fields (email, role, admin status, active
 * state) are surfaced read-only on the surrounding page so the user
 * sees them but can't change them — those flow through admin
 * governance on /settings/team.
 *
 * Initials force-uppercase as the user types so the avatar fallback
 * stays consistent with the seed/admin-set values.
 */

"use client";

import { useActionState } from "react";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateProfileAction } from "@/app/actions/profile";
import {
  profileInitialState,
  type ProfileFormState,
} from "@/lib/profile-form";

export type EditableProfile = {
  name: string;
  initials: string;
  phone: string | null;
  barNumber: string | null;
  avatarUrl: string | null;
};

export function ProfileEditForm({ profile }: { profile: EditableProfile }) {
  const [state, formAction, isPending] = useActionState<
    ProfileFormState,
    FormData
  >(updateProfileAction, profileInitialState);

  const errs = state.errors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Display name" name="name" required error={errs.name?.[0]}>
          <input
            name="name"
            type="text"
            required
            defaultValue={profile.name}
            className={inputClass(!!errs.name)}
          />
        </Field>
        <Field
          label="Initials"
          name="initials"
          required
          error={errs.initials?.[0]}
          hint="Used in avatar circles across the app."
        >
          <input
            name="initials"
            type="text"
            required
            maxLength={3}
            defaultValue={profile.initials}
            className={cn(inputClass(!!errs.initials), "uppercase font-mono")}
          />
        </Field>
        <Field label="Phone" name="phone" error={errs.phone?.[0]}>
          <input
            name="phone"
            type="tel"
            defaultValue={profile.phone ?? ""}
            placeholder="(555) 555-5555"
            className={inputClass(!!errs.phone)}
          />
        </Field>
        <Field
          label="Bar number"
          name="barNumber"
          error={errs.barNumber?.[0]}
          hint="State bar number — attorneys only."
        >
          <input
            name="barNumber"
            type="text"
            defaultValue={profile.barNumber ?? ""}
            className={inputClass(!!errs.barNumber)}
          />
        </Field>
        <Field
          label="Avatar URL"
          name="avatarUrl"
          error={errs.avatarUrl?.[0]}
          hint="Optional — leave blank to fall back to your initials."
          className="col-span-2"
        >
          <input
            name="avatarUrl"
            type="url"
            defaultValue={profile.avatarUrl ?? ""}
            placeholder="https://example.com/me.jpg"
            className={inputClass(!!errs.avatarUrl)}
          />
        </Field>
      </div>

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
          {isPending ? "Saving…" : "Save changes"}
        </button>
        {state.status === "ok" && (
          <span className="inline-flex items-center gap-1.5 text-2xs text-ok">
            <CheckCircle2 size={12} />
            Saved
          </span>
        )}
        {state.status === "error" && !state.errors && (
          <span className="inline-flex items-center gap-1.5 text-2xs text-warn">
            <TriangleAlert size={12} />
            Couldn’t save — check the highlighted fields.
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
  required,
  className,
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label
        htmlFor={name}
        className="text-2xs font-mono uppercase tracking-wider text-ink-4"
      >
        {label}
        {required && <span className="text-warn ml-1">*</span>}
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
    "placeholder:text-ink-4",
    hasError ? "border-warn" : "border-line"
  );
}
