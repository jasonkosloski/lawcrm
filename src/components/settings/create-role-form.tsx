/**
 * Create Role Composer — admin-only.
 *
 * Collapsed: a single "New role" button. Expanded: inline form
 * for name + optional description. Reserved names ("Admin",
 * "default") are blocked at the action level — Zod surfaces the
 * error inline.
 *
 * Submission is dispatched manually (not `<form action>`) so React 19
 * doesn't wipe the typed name after a rejected create.
 */

"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { createRoleAction } from "@/app/actions/roles";
import {
  roleInitialState,
  type RoleFormState,
} from "@/lib/role-form";
import { Field, FormErrorBanner, formErrorMessage, inputClass } from "@/components/ui/field";

export function CreateRoleForm() {
  const [state, formAction, isPending] = useActionState<
    RoleFormState,
    FormData
  >(createRoleAction, roleInitialState);
  const [, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  // The action returns a fresh object on every call, so comparing the
  // whole state (not just its status string) collapses the composer
  // after EVERY successful create, not only the first.
  const [handledState, setHandledState] = useState(state);

  if (state !== handledState) {
    setHandledState(state);
    if (state.status === "ok") setExpanded(false);
  }

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
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
      className="flex flex-col gap-3 p-4 rounded-md border border-line bg-paper-2/40"
    >
      <Field label="Name" required error={errs.name?.[0]}>
        {(c) => (
          <input
            {...c}
            name="name"
            type="text"
            required
            maxLength={60}
            autoFocus
            defaultValue={v.name ?? ""}
            placeholder="e.g. Billing, Litigation, Read-only"
            className={inputClass(!!errs.name, "md")}
          />
        )}
      </Field>

      <Field label="Description" error={errs.description?.[0]}>
        {(c) => (
          <textarea
            {...c}
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
        )}
      </Field>

      <FormErrorBanner
        message={formErrorMessage(
          state,
          "Couldn’t create — check the highlighted fields."
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
            "bg-brand-700 text-white hover:bg-brand-900 transition-colors",
            "disabled:opacity-60 disabled:cursor-not-allowed"
          )}
        >
          {isPending ? "Creating…" : "Create role"}
        </button>
      </div>
    </form>
  );
}
