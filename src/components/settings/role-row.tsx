/**
 * Role Row — display + inline edit + delete (admin-only).
 *
 * System roles render with a lock chip and disabled actions; the
 * server actions enforce the same constraint as defense-in-depth.
 */

"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  Lock,
  MoreHorizontal,
  Pencil,
  Trash2,
  TriangleAlert,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format-date";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  deleteRoleAction,
  updateRoleAction,
} from "@/app/actions/roles";
import {
  roleInitialState,
  type RoleFormState,
} from "@/lib/role-form";
import type { FirmRoleRow } from "@/lib/queries/team";

export function RoleRow({
  role,
  isAdmin,
}: {
  role: FirmRoleRow;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const onDelete = () => {
    if (
      !confirm(
        `Delete the role "${role.name}"?\n\n${role.memberCount} ${
          role.memberCount === 1 ? "member" : "members"
        } currently hold it. They keep their other roles. This can't be undone.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteRoleAction(role.id);
      if (result.status !== "ok") {
        alert(result.errors?._form?.[0] ?? "Couldn't delete role.");
      }
    });
  };

  if (editing && isAdmin && !role.isSystem) {
    return (
      <TableRow>
        <TableCell colSpan={4} className="p-3 bg-paper-2/30">
          <RoleEditForm role={role} onDone={() => setEditing(false)} />
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell className="pl-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-ink">{role.name}</span>
          {role.isSystem && (
            <span
              className="inline-flex items-center gap-1 text-2xs text-ink-4 px-1.5 py-0.5 rounded-full border border-line bg-paper-2"
              title="System role — managed automatically; can't be renamed or deleted."
            >
              <Lock size={9} />
              System
            </span>
          )}
        </div>
        {role.description && (
          <div className="text-2xs text-ink-3 mt-0.5 max-w-xl">
            {role.description}
          </div>
        )}
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1 text-2xs text-ink-3 font-mono">
          <Users size={11} className="text-ink-4" />
          {role.memberCount}
        </span>
      </TableCell>
      <TableCell className="text-2xs text-ink-4">
        {formatDate(role.createdAt, "medium")}
      </TableCell>
      <TableCell className="pr-4 text-right">
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label="Role actions"
                  disabled={pending}
                  className="inline-flex items-center justify-center w-7 h-7 rounded-md text-ink-4 hover:bg-paper-2 hover:text-ink disabled:opacity-50"
                >
                  <MoreHorizontal size={14} />
                </button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuItem
                onClick={() => setEditing(true)}
                disabled={role.isSystem}
              >
                <Pencil />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={onDelete}
                disabled={role.isSystem}
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
}

function RoleEditForm({
  role,
  onDone,
}: {
  role: FirmRoleRow;
  onDone: () => void;
}) {
  const action = updateRoleAction.bind(null, role.id);
  const [state, formAction, isPending] = useActionState<
    RoleFormState,
    FormData
  >(action, roleInitialState);

  useEffect(() => {
    if (state.status === "ok") onDone();
  }, [state.status, onDone]);

  const errs = state.errors ?? {};

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
          Name <span className="text-warn">*</span>
        </label>
        <input
          name="name"
          type="text"
          required
          maxLength={60}
          defaultValue={role.name}
          className={cn(
            "h-8 px-2.5 rounded-md border bg-white text-xs text-ink",
            "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
            errs.name ? "border-warn" : "border-line"
          )}
        />
        {errs.name && (
          <span className="text-2xs text-warn">{errs.name[0]}</span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-2xs font-mono uppercase tracking-wider text-ink-4">
          Description
        </label>
        <textarea
          name="description"
          rows={2}
          maxLength={400}
          defaultValue={role.description ?? ""}
          className={cn(
            "px-2.5 py-1.5 rounded-md border bg-white text-xs text-ink",
            "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
            "resize-y",
            errs.description ? "border-warn" : "border-line"
          )}
        />
      </div>

      {state.status === "error" && !state.errors && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
          <TriangleAlert size={12} className="shrink-0 mt-px" />
          <span>Couldn’t save — check the highlighted fields.</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
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
