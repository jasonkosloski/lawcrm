/**
 * Team Roster Row — toggles between display + inline edit.
 *
 * Display mode: avatar, name, email, role, admin/active chips, kebab
 * (admin-only). Edit mode: collapses into a colSpan cell with the
 * MemberEditForm; cancel returns to display.
 *
 * Reset-password is a separate inline action (not in the kebab) so
 * the temp password renders right next to the row that's affected.
 * Once email-based reset lands, this becomes "Send reset email"
 * instead.
 */

"use client";

import { useState, useTransition } from "react";
import { Pencil, KeyRound, MoreHorizontal, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { resetFirmMemberPassword } from "@/app/actions/team";
import { MemberEditForm } from "./member-edit-form";
import type { FirmUserRow } from "@/lib/queries/team";

export function MemberRow({
  member,
  isCurrentUserAdmin,
}: {
  member: FirmUserRow;
  isCurrentUserAdmin: boolean;
}) {
  const [editing, setEditing] = useState(false);
  // Last-shown reset password — shown until the user dismisses it
  // OR another row's reset overwrites the global state. Per-row
  // state keeps the password tied to the row that triggered it.
  const [resetPassword, setResetPassword] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onResetPassword = () => {
    if (
      !confirm(
        `Reset ${member.name}'s password?\n\nA new temporary password will be generated. Their existing password stops working immediately. You'll need to deliver the new one to them out-of-band.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await resetFirmMemberPassword(member.id);
      if (result.status === "ok" && result.resetPassword) {
        setResetPassword(result.resetPassword);
      } else {
        alert(result.errors?._form?.[0] ?? "Couldn't reset password.");
      }
    });
  };

  if (editing) {
    return (
      <TableRow>
        <TableCell colSpan={6} className="p-3 bg-paper-2/30">
          <MemberEditForm
            member={member}
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
                <span className="text-2xs font-medium px-1.5 py-px rounded-full bg-brand-soft text-brand-700 border border-brand-200">
                  you
                </span>
              )}
            </div>
            <span className="text-2xs text-ink-4 truncate">{member.email}</span>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-xs text-ink-3">{member.role}</TableCell>
      <TableCell>
        {member.isAdmin ? (
          <span className="inline-flex items-center gap-1 text-2xs font-medium px-1.5 py-0.5 rounded-full bg-brand-soft text-brand-700 border border-brand-200">
            <ShieldCheck size={10} />
            Admin
          </span>
        ) : (
          <span className="text-2xs text-ink-4">—</span>
        )}
      </TableCell>
      <TableCell>
        {member.isActive ? (
          <span className="text-2xs text-ok">Active</span>
        ) : (
          <span className="text-2xs text-ink-4">Deactivated</span>
        )}
      </TableCell>
      <TableCell>
        {resetPassword && (
          <div className="text-2xs">
            <div className="text-ink-4 mb-0.5">New temp password:</div>
            <code className="px-1.5 py-0.5 rounded bg-paper-2 font-mono text-ink select-all">
              {resetPassword}
            </code>
            <button
              type="button"
              onClick={() => setResetPassword(null)}
              className="ml-2 text-ink-4 hover:text-ink"
            >
              dismiss
            </button>
          </div>
        )}
      </TableCell>
      <TableCell className="pr-4 text-right">
        {isCurrentUserAdmin && (
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
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <Pencil />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onResetPassword}>
                <KeyRound />
                Reset password
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
}
