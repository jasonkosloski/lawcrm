/**
 * Member Edit Form — inline within the team table.
 *
 * Edits the same fields as the invite composer minus email (email
 * is identity here — changing it requires a separate flow that
 * deals with email re-verification, deferred). Roles are a
 * multi-select of the firm's defined Role rows; the "default" role
 * is always included server-side regardless of the form state.
 *
 * Self-protection: the isActive checkbox is force-disabled for the
 * row that represents the current user (the action also enforces it
 * server-side; this is just UI mistake-proofing).
 *
 * Escalation: a non-Admin directory manager cannot grant or remove
 * the Admin role (or any role carrying an access-management
 * permission), nor deactivate a holder of one. The server refuses
 * those; this form shows those controls locked instead of letting
 * the save bounce.
 *
 * Submission is dispatched manually (not `<form action>`) so React 19
 * does not reset the fields after a rejected save — the admin keeps
 * what they typed and sees the error next to it.
 */

"use client";

import { useActionState, useEffect, useTransition } from "react";
import { cn } from "@/lib/utils";
import { updateFirmMember } from "@/app/actions/team";
import {
  teamInitialState,
  type TeamFormState,
} from "@/lib/team-form";
import { DEFAULT_ROLE_NAME } from "@/lib/role-constants";
import type { FirmUserRow, RoleChip } from "@/lib/queries/team";
import { Field, FormErrorBanner, formErrorMessage, inputClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function MemberEditForm({
  member,
  rolePickerOptions,
  viewerIsAdmin = true,
  privilegedRoleIds = [],
  onDone,
}: {
  member: FirmUserRow;
  rolePickerOptions: RoleChip[];
  /** False for a delegated (non-Admin) directory manager — the
   *  privileged roles and the active toggle for their holders lock. */
  viewerIsAdmin?: boolean;
  /** Admin + every role carrying an admin-only permission. */
  privilegedRoleIds?: string[];
  onDone: () => void;
}) {
  const action = updateFirmMember.bind(null, member.id);
  const [state, formAction, isPending] = useActionState<
    TeamFormState,
    FormData
  >(action, teamInitialState);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (state.status === "ok") onDone();
  }, [state.status, onDone]);

  const errs = state.errors ?? {};
  const heldRoleIds = new Set(member.roles.map((r) => r.id));
  const privileged = new Set(privilegedRoleIds);
  const lockedRoleIds = viewerIsAdmin ? new Set<string>() : privileged;
  const holdsPrivileged = member.roles.some((r) => privileged.has(r.id));
  const activeLocked = member.isSelf || (!viewerIsAdmin && holdsPrivileged);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
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
              defaultValue={member.name}
              className={inputClass(!!errs.name)}
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
              defaultValue={member.initials}
              className={cn(inputClass(!!errs.initials), "uppercase font-mono")}
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
              defaultValue={member.jobTitle}
              placeholder="Managing / Partner / Counsel / Paralegal / Investigator / Intake"
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
              defaultValue={member.phone ?? ""}
              placeholder="(555) 555-5555"
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
              defaultValue={member.barNumber ?? ""}
              className={inputClass(!!errs.barNumber)}
            />
          )}
        </Field>
        <div className="flex flex-col gap-1.5 pt-5">
          {activeLocked ? (
            // Locked row (yourself, or an Admin-class member you may
            // not deactivate): a disabled checkbox WOULDN'T submit its
            // value (browsers omit disabled fields from form data), so
            // the server would see undefined and try to deactivate.
            // Force-submit the current value via a hidden input and
            // render a non-interactive indicator instead.
            <>
              <input
                type="hidden"
                name="isActive"
                value={member.isActive ? "on" : ""}
              />
              <div
                className="flex items-center gap-2 text-xs opacity-60"
                title={
                  member.isSelf
                    ? "You can't deactivate yourself — another admin can do it."
                    : "Only an Admin can deactivate or reactivate this member."
                }
              >
                <span
                  className={cn(
                    "inline-block w-3.5 h-3.5 rounded-sm border",
                    member.isActive
                      ? "bg-brand-500 border-brand-500"
                      : "border-line"
                  )}
                />
                <span>
                  <span className="font-medium text-ink">Active</span>
                  <span className="text-ink-4 ml-1.5">— can sign in</span>
                </span>
              </div>
            </>
          ) : (
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                name="isActive"
                value="on"
                defaultChecked={member.isActive}
                className="accent-brand-500"
              />
              <span>
                <span className="font-medium text-ink">Active</span>
                <span className="text-ink-4 ml-1.5">— can sign in</span>
              </span>
            </label>
          )}
          {errs.isActive && (
            <div className="text-2xs text-warn">{errs.isActive[0]}</div>
          )}
        </div>
      </div>

      <RoleMultiSelect
        options={rolePickerOptions}
        defaultSelected={heldRoleIds}
        lockedIds={lockedRoleIds}
        error={errs.roleId?.[0]}
      />

      <FormErrorBanner
        message={formErrorMessage(state, "Couldn’t save — check the highlighted fields.")}
      />

      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onDone}
          className="text-2xs text-ink-3 hover:text-ink-2 px-2"
        >
          Cancel
        </button>
        <Button
          size="sm"
          type="submit"
          disabled={isPending}
        >
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

/** Multi-select renderered as a stack of checkboxes — the
 *  `roleId=…` keys repeat in the form data, which the server
 *  reads via `formData.getAll("roleId")`. The "default" role is
 *  rendered checked + disabled because it's always assigned.
 *  `lockedIds` roles (Admin-only to grant/remove) render disabled;
 *  a locked role the member already holds still posts via a hidden
 *  input so saving other fields doesn't look like removing it. */
export function RoleMultiSelect({
  options,
  defaultSelected,
  lockedIds,
  error,
}: {
  options: RoleChip[];
  defaultSelected: Set<string>;
  lockedIds?: Set<string>;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-2 pt-2 border-t border-line">
      <div className="text-2xs font-medium text-ink-3">
        Roles
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const isDefault = opt.name === DEFAULT_ROLE_NAME;
          const isLocked = !isDefault && (lockedIds?.has(opt.id) ?? false);
          const checked = defaultSelected.has(opt.id) || isDefault;
          const disabled = isDefault || isLocked;
          return (
            <label
              key={opt.id}
              className={cn(
                "inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border bg-white",
                isDefault
                  ? "border-line cursor-not-allowed opacity-70"
                  : isLocked
                    ? "border-line cursor-not-allowed opacity-70"
                    : "border-line cursor-pointer hover:border-brand-300"
              )}
              title={
                isDefault
                  ? "Always assigned — every firm member holds the default role."
                  : isLocked
                    ? "Only an Admin can grant or remove this role."
                    : undefined
              }
            >
              <input
                type="checkbox"
                name="roleId"
                value={opt.id}
                defaultChecked={checked}
                disabled={disabled}
                className="accent-brand-500"
              />
              {isLocked && checked && (
                <input type="hidden" name="roleId" value={opt.id} />
              )}
              {opt.name}
            </label>
          );
        })}
      </div>
      {error && <div className="text-2xs text-warn">{error}</div>}
      <div className="text-3xs text-ink-4 leading-relaxed">
        Members can hold any number of roles. The{" "}
        <span className="font-mono">Admin</span> role grants admin
        powers; manage the role list on{" "}
        <span className="font-mono">Settings → Roles</span>.
      </div>
    </div>
  );
}
