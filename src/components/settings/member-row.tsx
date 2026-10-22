/**
 * Team Roster Row — toggles between display + inline edit.
 *
 * Display mode: avatar, name, email, jobTitle, role chips, status,
 * kebab (admin-only). Edit mode: collapses into a colSpan cell with
 * the MemberEditForm.
 *
 * Sign-in management (sign out everywhere, reset sign-in link, resend
 * invite) lives in the kebab; sign-in itself is Google via Clerk.
 */

"use client";

import { useState, useTransition } from "react";
import {
  KeyRound,
  Lock,
  LogOut,
  MailPlus,
  MoreHorizontal,
  Pencil,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { confirmAction, notifyError, notifySuccess } from "@/lib/feedback";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  resendFirmMemberInvite,
  resetFirmMemberSignInLink,
  signOutFirmMemberEverywhere,
} from "@/app/actions/team";
import type { TeamFormState } from "@/lib/team-form";
import { ADMIN_ROLE_NAME } from "@/lib/role-constants";
import { MemberEditForm } from "./member-edit-form";
import type { FirmUserRow, RoleChip } from "@/lib/queries/team";
import { Badge } from "@/components/ui/badge";

export function MemberRow({
  member,
  canManageDirectory,
  rolePickerOptions,
  viewerIsAdmin = true,
  privilegedRoleIds = [],
}: {
  member: FirmUserRow;
  canManageDirectory: boolean;
  /** False for a delegated (non-Admin) directory manager. The server
   *  refuses edits to Admins and sign-in management of Admin-class
   *  members from them, so those actions are hidden. */
  viewerIsAdmin?: boolean;
  /** Admin + every role carrying an admin-only permission. */
  privilegedRoleIds?: string[];
  /** Full list of firm roles, passed down so the edit form's
   *  multi-select shows everything available. */
  rolePickerOptions: RoleChip[];
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const privileged = new Set(privilegedRoleIds);
  const targetIsPrivileged =
    member.isAdmin || member.roles.some((r) => privileged.has(r.id));
  // Delegated managers can't touch Admin-class accounts at all.
  const canEditMember = viewerIsAdmin || !member.isAdmin;
  const canTakeOverMember = viewerIsAdmin || !targetIsPrivileged;

  const report = (result: TeamFormState, success: string) => {
    if (result.status !== "ok") {
      notifyError(result.errors?._form?.[0] ?? "Something went wrong.");
    } else if (result.warning) {
      notifyError(result.warning);
    } else {
      notifySuccess(success);
    }
  };

  const onSignOutEverywhere = async () => {
    if (
      !(await confirmAction({
        title: `Sign ${member.name} out everywhere?`,
        description:
          "Every active session ends immediately. They can sign back in with Google.",
        confirmLabel: "Sign out everywhere",
        destructive: true,
      }))
    ) {
      return;
    }
    startTransition(async () => {
      report(
        await signOutFirmMemberEverywhere(member.id),
        `${member.name} was signed out everywhere.`
      );
    });
  };

  const onResetLink = async () => {
    if (
      !(await confirmAction({
        title: `Reset ${member.name}'s sign-in link?`,
        description:
          "Detaches their current Google sign-in and ends its sessions. The next time they sign in with a verified Google account on their firm email, it links again.",
        confirmLabel: "Reset sign-in link",
        destructive: true,
      }))
    ) {
      return;
    }
    startTransition(async () => {
      report(
        await resetFirmMemberSignInLink(member.id),
        `${member.name}'s sign-in link was reset.`
      );
    });
  };

  const onResendInvite = () => {
    startTransition(async () => {
      report(
        await resendFirmMemberInvite(member.id),
        `Invitation re-sent to ${member.email}.`
      );
    });
  };

  if (editing && canEditMember) {
    return (
      <TableRow>
        <TableCell colSpan={6} className="p-3 bg-paper-2/30">
          <MemberEditForm
            member={member}
            rolePickerOptions={rolePickerOptions}
            viewerIsAdmin={viewerIsAdmin}
            privilegedRoleIds={privilegedRoleIds}
            onDone={() => setEditing(false)}
          />
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow className={cn(!member.isActive && "opacity-60")}>
      <TableCell className="pl-4">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-brand-50 text-2xs font-mono font-medium text-brand-700 border border-brand-100 shrink-0">
            {member.initials}
          </span>
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-ink truncate">
                {member.name}
              </span>
              {member.isSelf && (
                <Badge>
                  you
                </Badge>
              )}
            </div>
            <span className="text-2xs text-ink-4 truncate">{member.email}</span>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-xs text-ink-3">{member.jobTitle}</TableCell>
      <TableCell>
        <RoleChips roles={member.roles} />
      </TableCell>
      <TableCell>
        {member.isActive ? (
          <span className="text-2xs text-ok">Active</span>
        ) : (
          <span className="text-2xs text-ink-4">Deactivated</span>
        )}
      </TableCell>
      <TableCell>
        {member.isActive && !member.hasSignedIn && (
          <span className="text-2xs text-ink-4">Invite pending</span>
        )}
      </TableCell>
      <TableCell className="pr-4 text-right">
        {canManageDirectory && (canEditMember || canTakeOverMember) && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label="Member actions"
                  disabled={pending}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink disabled:opacity-50"
                >
                  <MoreHorizontal size={14} />
                </button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-44">
              {canEditMember && (
                <DropdownMenuItem onClick={() => setEditing(true)}>
                  <Pencil />
                  Edit
                </DropdownMenuItem>
              )}
              {canTakeOverMember && (
                <>
                  {member.hasSignedIn ? (
                    <>
                      <DropdownMenuItem onClick={onSignOutEverywhere}>
                        <LogOut />
                        Sign out everywhere
                      </DropdownMenuItem>
                      {!member.isSelf && (
                        <DropdownMenuItem onClick={onResetLink}>
                          <KeyRound />
                          Reset sign-in link
                        </DropdownMenuItem>
                      )}
                    </>
                  ) : (
                    member.isActive && (
                      <DropdownMenuItem onClick={onResendInvite}>
                        <MailPlus />
                        Resend invite
                      </DropdownMenuItem>
                    )
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
}

/** Compact pill row of the user's roles. Admin chip is colored;
 *  system roles get a small lock; custom roles are neutral. */
function RoleChips({ roles }: { roles: RoleChip[] }) {
  if (roles.length === 0) {
    return <span className="text-2xs text-ink-4">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((r) => {
        const isAdmin = r.name === ADMIN_ROLE_NAME;
        return (
          <span
            key={r.id}
            className={cn(
              "inline-flex items-center gap-1 text-2xs font-medium px-1.5 py-0.5 rounded-full border",
              isAdmin
                ? "bg-brand-soft text-brand-700 border-brand-200"
                : "bg-paper-2 text-ink-3 border-line"
            )}
            title={r.isSystem ? "System role" : undefined}
          >
            {isAdmin && <ShieldCheck size={10} />}
            {r.isSystem && !isAdmin && <Lock size={9} />}
            {r.name}
          </span>
        );
      })}
    </div>
  );
}
