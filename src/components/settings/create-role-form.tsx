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
import { roleInitialState, type RoleFormState } from "@/lib/role-form";
import {
  Field,
  FormErrorBanner,
  formErrorMessage,
  inputClass,
  textareaClass,
} from "@/components/ui/field";
import { Button } from "@/components/ui/button";

export function CreateRoleForm() {
  const [state, formAction, isPending] = useActionState<RoleFormState, FormData>(
    createRoleAction,
    roleInitialState,
  );
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
      <Button
        variant="outline"
        type="button"
        onClick={() => setExpanded(true)}
        className="gap-2 text-xs border-dashed"
      >
        <Plus size={13} />
        New role
      </Button>
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
            className={cn(textareaClass(!!errs.description), "resize-y")}
          />
        )}
      </Field>

      <FormErrorBanner
        message={formErrorMessage(state, "Couldn’t create — check the highlighted fields.")}
      />

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-2xs text-ink-3 hover:text-ink-2 px-2"
        >
          Cancel
        </button>
        <Button size="sm" type="submit" disabled={isPending}>
          {isPending ? "Creating…" : "Create role"}
        </Button>
      </div>
    </form>
  );
}
