/**
 * Assignee Select — the task owner picker.
 *
 * A compact select (matches the SelectField idiom in
 * `primary-fields.tsx`) with an "Unassigned" option plus every
 * active firm user, fronted by the same initials chip the task
 * rows render, so the selected assignee reads identically in the
 * form and in the list.
 *
 * Controlled: `value` is `""` for unassigned or a user id. The
 * `name`d value posts with the surrounding form (`ownerId` — the
 * tri-state the task actions expect: present-but-empty = clear).
 *
 * Inactive owners: `assignees` lists ACTIVE users only (inactive users
 * keep their historical assignments but can't receive new ones). When
 * editing a task whose owner has since been deactivated, pass them as
 * `currentOwner`: they are shown as "<name> (inactive)" and stay
 * selected, so saving an unrelated edit re-posts the same owner
 * instead of silently unassigning the task (a controlled <NativeSelect>
 * whose value has no matching option falls back to the first option).
 */

"use client";

import { cn } from "@/lib/utils";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { AssigneeOption } from "@/lib/queries/team";

export type { AssigneeOption };

export function AssigneeSelect({
  name = "ownerId",
  value,
  onChange,
  assignees,
  currentOwner = null,
  error,
}: {
  name?: string;
  /** `""` = unassigned, otherwise a user id from `assignees`. */
  value: string;
  onChange: (v: string) => void;
  assignees: AssigneeOption[];
  /** The task's existing owner, when editing. Only used if that user
   *  is not among the active `assignees`. */
  currentOwner?: AssigneeOption | null;
  error?: string;
}) {
  const inactiveOwner =
    currentOwner && !assignees.some((a) => a.id === currentOwner.id) ? currentOwner : null;
  const selected =
    assignees.find((a) => a.id === value) ??
    (inactiveOwner && inactiveOwner.id === value ? inactiveOwner : null);
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex items-center gap-2">
        {/* Initials chip — same idiom as the task-row owner badge. */}
        <span
          className={cn(
            "inline-flex items-center justify-center w-6 h-6 rounded-full text-2xs font-mono font-medium shrink-0 border",
            selected
              ? "bg-brand-50 text-brand-700 border-brand-100"
              : "bg-paper-2 text-ink-4 border-line",
          )}
          title={selected ? selected.name : "Unassigned"}
        >
          {selected ? selected.initials : "—"}
        </span>
        <NativeSelect
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Assignee"
          className="flex-1 min-w-0"
          aria-invalid={!!error || undefined}
        >
          <NativeSelectOption value="">Unassigned</NativeSelectOption>
          {inactiveOwner && (
            <NativeSelectOption value={inactiveOwner.id}>
              {inactiveOwner.name} (inactive)
            </NativeSelectOption>
          )}
          {assignees.map((a) => (
            <NativeSelectOption key={a.id} value={a.id}>
              {a.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {error && <div className="text-2xs text-warn">{error}</div>}
    </div>
  );
}
