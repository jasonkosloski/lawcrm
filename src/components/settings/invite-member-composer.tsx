/**
 * Invite Member Composer — admin-only.
 *
 * Collapsed: a single "Invite member" button. Expanded: inline form
 * for name, email, initials, jobTitle, optional phone + bar number,
 * and a roles multi-select. The "default" role is always granted
 * server-side regardless of form state. On success Clerk emails the
 * invitation (sign-in is Google); if that email failed the action
 * returns a warning and the admin uses Resend invite from the row.
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
import type { RoleChip } from "@/lib/queries/team";
import { Field, FormErrorBanner, formErrorMessage, inputClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

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
  const [invitedEmail, setInvitedEmail] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  // Each action result is a fresh object, so tracking the last one
  // handled (rather than state.status) reacts to EVERY success.
  const [handledState, setHandledState] = useState(state);

  if (state !== handledState) {
    setHandledState(state);
    if (state.status === "ok") {
      setInvitedEmail(submittedEmail ?? "");
      setWarning(state.warning ?? null);
    }
  }

  if (!expanded && invitedEmail === null) {
    return (
      <Button
        variant="outline"
        type="button"
        onClick={() => setExpanded(true)}
        className="gap-2 text-xs border-dashed"
      >
        <Plus size={13} />
        Invite member
      </Button>
    );
  }

  const errs = state.errors ?? {};
  const v = state.values ?? {};
  const lockedRoleIds = viewerIsAdmin
    ? new Set<string>()
    : new Set(privilegedRoleIds);

  return (
    <div className="flex flex-col gap-3 p-4 rounded-md border border-line bg-paper-2/40">
      {invitedEmail !== null ? (
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs text-ink">
            <div className="font-medium mb-1">
              {warning
                ? warning
                : invitedEmail
                  ? `Invitation sent to ${invitedEmail}.`
                  : "Invitation sent."}
            </div>
            <div className="text-ink-4">
              They sign in with Google using this email address.
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setInvitedEmail(null);
              setWarning(null);
              setSubmittedEmail(null);
              setExpanded(false);
            }}
            className="text-ink-4 hover:text-ink shrink-0"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const email = formData.get("email");
            if (typeof email === "string") setSubmittedEmail(email);
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
            <Button
              size="sm"
              type="submit"
              disabled={isPending}
            >
              {isPending ? "Inviting…" : "Send invite"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
