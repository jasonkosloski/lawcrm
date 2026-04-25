/**
 * Create Role Composer — admin-only.
 *
 * Collapsed: a single "New role" button. Expanded: inline form
 * for name + optional description. Reserved names ("Admin",
 * "default") are blocked at the action level — Zod surfaces the
 * error inline.
 */

"use client";

import { useActionState, useEffect, useState } from "react";
import { Plus, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { createRoleAction } from "@/app/actions/roles";
import {
  roleInitialState,
  type RoleFormState,
} from "@/lib/role-form";

export function CreateRoleForm() {
  const [state, formAction, isPending] = useActionState<
    RoleFormState,
    FormData
  >(createRoleAction, roleInitialState);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (state.status === "ok") {
      setExpanded(false);
    }
  }, [state.status]);

  if (!expanded) {
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
        New role
      </button>
    );
  }

  const errs = state.errors ?? {};
  const v = state.values ?? {};

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 p-4 rounded-md border border-line bg-paper-2/40"
    >
      <div className="flex flex-col gap-1">
        <label
          htmlFor="name"
          className="text-2xs font-mono uppercase tracking-wider text-ink-4"
        >
          Name <span className="text-warn">*</span>
        </label>
        <input
          name="name"
          type="text"
          required
          maxLength={60}
          autoFocus
          defaultValue={v.name ?? ""}
          placeholder="e.g. Billing, Litigation, Read-only"
          className={cn(
            "h-9 px-3 rounded-md border bg-white text-xs text-ink",
            "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
            "placeholder:text-ink-4",
            errs.name ? "border-warn" : "border-line"
          )}
        />
        {errs.name && (
          <span className="text-2xs text-warn">{errs.name[0]}</span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="description"
          className="text-2xs font-mono uppercase tracking-wider text-ink-4"
        >
          Description
        </label>
        <textarea
          name="description"
          rows={2}
          maxLength={400}
          defaultValue={v.description ?? ""}
          placeholder="What does this role mean for your firm?"
          className={cn(
            "px-3 py-2 rounded-md border bg-white text-xs text-ink",
            "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
            "placeholder:text-ink-4 resize-y",
            errs.description ? "border-warn" : "border-line"
          )}
        />
        {errs.description && (
          <span className="text-2xs text-warn">{errs.description[0]}</span>
        )}
      </div>

      {state.status === "error" && !state.errors && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-warn-soft border border-warn-border text-2xs text-warn">
          <TriangleAlert size={12} className="shrink-0 mt-px" />
          <span>Couldn’t create — check the highlighted fields.</span>
        </div>
      )}

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
          {isPending ? "Creating…" : "Create role"}
        </button>
      </div>
    </form>
  );
}
