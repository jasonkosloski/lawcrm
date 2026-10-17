/**
 * Invite Member Composer — admin-only.
 *
 * Collapsed: a single "Invite member" button. Expanded: inline form
 * for name, email, initials, jobTitle, optional phone + bar number,
 * and a roles multi-select. The "default" role is always granted
 * server-side regardless of form state. On success the action
 * returns a temporary password we render alongside a copy hint —
 * once email delivery lands (Phase 2 of AUTH_PLAN) this becomes a
 * magic-link send instead and the password panel goes away.
 *
 * Submission is dispatched manually (not `<form action>`) so React 19
 * does not reset the fields — including the ticked roles — after a
 * rejected invite (duplicate email, say): fix the one field, resubmit.
 */

"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { inviteFirmMember } from "@/app/actions/team";
import {
  teamInitialState,
  type TeamFormState,
} from "@/lib/team-form";
import { RoleMultiSelect } from "./member-edit-form";
import { Field, FormErrorBanner, formErrorMessage, inputClass } from "./form-field";
import type { RoleChip } from "@/lib/queries/team";

// No roles checked by default — server adds "default" automatically.
const NONE_SELECTED = new Set<string>();

export function InviteMemberComposer({
  rolePickerOptions,
  viewerIsAdmin = true,
  privilegedRoleIds = [],
}: {
  rolePickerOptions: RoleChip[];
  /** False for a delegated (non-Admin) directory manager — the Admin
   *  role and access-management roles can't be handed out, so those
   *  boxes lock. */
  viewerIsAdmin?: boolean;
  privilegedRoleIds?: string[];
}) {
  const [state, formAction, isPending] = useActionState<
    TeamFormState,
    FormData
  >(inviteFirmMember, teamInitialState);
  const [, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [tempEmail, setTempEmail] = useState<string | null>(null);
  // Each action result is a fresh object, so tracking the last one
  // handled (rather than state.status) reacts to EVERY success.
  const [handledState, setHandledState] = useState(state);

  if (state !== handledState) {
    setHandledState(state);
    if (state.status === "ok" && state.invitePassword) {
      setTempPassword(state.invitePassword);
    }
  }

  if (!expanded && !tempPassword) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={cn(
          "inline-flex items-center gap-2 h-9 px-3 text-xs",
          "rounded-md border border-dashed border-line bg-white",
          "hover:border-brand-300 hover:text-brand-700 transition-colors text-ink-3"
        )}
      >
        <Plus size={13} />
        Invite member
      </button>
    );
  }

  const errs = state.errors ?? {};
  const v = state.values ?? {};
  const lockedRoleIds = viewerIsAdmin
    ? new Set<string>()
    : new Set(privilegedRoleIds);

  return (
    <div className="flex flex-col gap-3 p-4 rounded-md border border-line bg-paper-2/40">
      {tempPassword ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <div className="text-xs text-ink">
              <div className="font-medium mb-1">
                Invite sent — copy this temp password to deliver out-of-band.
              </div>
              <div className="text-ink-4">
                {tempEmail ? (
                  <>
                    The new user signs in with{" "}
                    <span className="font-mono text-ink-3">{tempEmail}</span> +
                    the password below. They can change it once we wire the
                    password-change flow.
                  </>
                ) : (
                  <>
                    The new user signs in with their email + the password
                    below. They can change it once we wire the password-change
                    flow.
                  </>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setTempPassword(null);
                setTempEmail(null);
                setExpanded(false);
              }}
              className="text-ink-4 hover:text-ink shrink-0"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
          <code className="block px-3 py-2 rounded bg-white border border-line font-mono text-sm text-ink select-all">
            {tempPassword}
          </code>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const email = formData.get("email");
            if (typeof email === "string") setTempEmail(email);
            startTransition(() => formAction(formData));
          }}
          className="flex flex-col gap-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Name" required error={errs.name?.[0]}>
              {(c) => (
                <input
                  {...c}
                  name="name"
                  type="text"
                  required
                  defaultValue={v.name ?? ""}
                  className={inputClass(!!errs.name)}
                />
              )}
            </Field>
            <Field label="Email" required error={errs.email?.[0]}>
              {(c) => (
                <input
                  {...c}
                  name="email"
                  type="email"
                  required
                  defaultValue={v.email ?? ""}
                  className={inputClass(!!errs.email)}
                />
              )}
            </Field>
            <Field label="Initials" required error={errs.initials?.[0]}>
              {(c) => (
                <input
                  {...c}
                  name="initials"
                  type="text"
                  required
                  maxLength={3}
                  defaultValue={v.initials ?? ""}
                  placeholder="AB"
                  className={cn(
                    inputClass(!!errs.initials),
                    "uppercase font-mono"
                  )}
                />
              )}
            </Field>
            <Field label="Job title" required error={errs.jobTitle?.[0]}>
              {(c) => (
                <input
                  {...c}
                  name="jobTitle"
                  type="text"
                  required
                  defaultValue={v.jobTitle ?? ""}
                  placeholder="Counsel, Paralegal, Intake…"
                  className={inputClass(!!errs.jobTitle)}
                />
              )}
            </Field>
            <Field label="Phone" error={errs.phone?.[0]}>
              {(c) => (
                <input
                  {...c}
                  name="phone"
                  type="tel"
                  defaultValue={v.phone ?? ""}
                  className={inputClass(!!errs.phone)}
                />
              )}
            </Field>
            <Field
              label="Bar number"
              hint="Attorneys only."
              error={errs.barNumber?.[0]}
            >
              {(c) => (
                <input
                  {...c}
                  name="barNumber"
                  type="text"
                  defaultValue={v.barNumber ?? ""}
                  className={inputClass(!!errs.barNumber)}
                />
              )}
            </Field>
          </div>

          <RoleMultiSelect
            options={rolePickerOptions}
            defaultSelected={NONE_SELECTED}
            lockedIds={lockedRoleIds}
            error={errs.roleId?.[0]}
          />

          <FormErrorBanner
            message={formErrorMessage(
              state,
              "Couldn’t invite — check the highlighted fields."
            )}
          />

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setExpanded(false)}
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
              {isPending ? "Inviting…" : "Send invite"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
