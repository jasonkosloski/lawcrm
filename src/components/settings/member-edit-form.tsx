/**
 * Member Edit Form — inline within the team table.
 *
 * Edits the same fields as the invite composer minus email (email
 * is identity here — changing it requires a separate flow that
 * deals with email re-verification, deferred). Plus the two
 * permission toggles: isAdmin + isActive.
 *
 * Self-protection: the isActive checkbox is force-disabled for the
 * row that represents the current user (the action also enforces it
 * server-side; this is just UI mistake-proofing).
 */

"use client";

import { useActionState, useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { updateFirmMember } from "@/app/actions/team";
import {
  teamInitialState,
  type TeamFormState,
} from "@/lib/team-form";
import type { FirmUserRow } from "@/lib/queries/team";

export function MemberEditForm({
  member,
  onDone,
}: {
  member: FirmUserRow;
  onDone: () => void;
}) {
  const action = updateFirmMember.bind(null, member.id);
  const [state, formAction, isPending] = useActionState<
    TeamFormState,
    FormData
  >(action, teamInitialState);

  useEffect(() => {
    if (state.status === "ok") onDone();
  }, [state.status, onDone]);

  const errs = state.errors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" name="name" required error={errs.name?.[0]}>
          <input
            name="name"
            type="text"
            required
            defaultValue={member.name}
            className={inputClass(!!errs.name)}
          />
        </Field>
        <Field label="Initials" name="initials" required error={errs.initials?.[0]}>
          <input
            name="initials"
            type="text"
            required
            maxLength={3}
            defaultValue={member.initials}
            className={cn(inputClass(!!errs.initials), "uppercase font-mono")}
          />
        </Field>
        <Field label="Role" name="role" required error={errs.role?.[0]}>
          <input
            name="role"
            type="text"
            required
            defaultValue={member.role}
            placeholder="Managing / Partner / Counsel / Paralegal / Investigator / Intake"
            className={inputClass(!!errs.role)}
          />
        </Field>
        <Field label="Phone" name="phone">
          <input
            name="phone"
            type="tel"
            defaultValue={member.phone ?? ""}
            placeholder="(555) 555-5555"
            className={inputClass(!!errs.phone)}
          />
        </Field>
        <Field label="Bar number" name="barNumber" hint="Attorneys only.">
          <input
            name="barNumber"
            type="text"
            defaultValue={member.barNumber ?? ""}
            className={inputClass(!!errs.barNumber)}
          />
        </Field>
        <div className="flex flex-col gap-1.5 pt-5">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              name="isAdmin"
              value="on"
              defaultChecked={member.isAdmin}
              className="accent-brand-500"
            />
            <span>
              <span className="font-medium text-ink">Admin</span>
              <span className="text-ink-4 ml-1.5">
                — can edit firm + manage team
              </span>
            </span>
          </label>
          {errs.isAdmin && (
            <div className="text-2xs text-warn">{errs.isAdmin[0]}</div>
          )}
          <label
            className={cn(
              "flex items-center gap-2 text-xs",
              member.isSelf
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer"
            )}
            title={member.isSelf ? "You can't deactivate yourself." : undefined}
          >
            <input
              type="checkbox"
              name="isActive"
              value="on"
              defaultChecked={member.isActive}
              disabled={member.isSelf}
              className="accent-brand-500"
            />
            <span>
              <span className="font-medium text-ink">Active</span>
              <span className="text-ink-4 ml-1.5">
                — can sign in
              </span>
            </span>
          </label>
          {errs.isActive && (
            <div className="text-2xs text-warn">{errs.isActive[0]}</div>
          )}
        </div>
      </div>

      {state.status === "error" && !state.errors && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
          <TriangleAlert size={12} className="shrink-0 mt-px" />
          <span>Couldn’t save — check the highlighted fields.</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onDone}
          className="text-2xs text-ink-3 hover:text-ink-2 px-2"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className={cn(
            "inline-flex items-center h-8 px-3 rounded-md text-xs font-medium",
            "bg-brand-500 text-white hover:bg-brand-600 transition-colors",
            "disabled:opacity-60 disabled:cursor-not-allowed"
          )}
        >
          {isPending ? "Saving…" : "Save"}
        </button>
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
  children,
}: {
  label: string;
  name: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
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
    "h-8 px-2.5 rounded-md border bg-white text-xs text-ink",
    "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
    "placeholder:text-ink-4",
    hasError ? "border-warn" : "border-line"
  );
}
