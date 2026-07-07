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
 */

"use client";

import { cn } from "@/lib/utils";
import type { AssigneeOption } from "@/lib/queries/team";

export type { AssigneeOption };

export function AssigneeSelect({
  name = "ownerId",
  value,
  onChange,
  assignees,
  error,
}: {
  name?: string;
  /** `""` = unassigned, otherwise a user id from `assignees`. */
  value: string;
  onChange: (v: string) => void;
  assignees: AssigneeOption[];
  error?: string;
}) {
  const selected = assignees.find((a) => a.id === value) ?? null;
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex items-center gap-2">
        {/* Initials chip — same idiom as the task-row owner badge. */}
        <span
          className={cn(
            "inline-flex items-center justify-center w-6 h-6 rounded-full text-2xs font-mono font-medium shrink-0 border",
            selected
              ? "bg-brand-50 text-brand-700 border-brand-100"
              : "bg-paper-2 text-ink-4 border-line"
          )}
          title={selected ? selected.name : "Unassigned"}
        >
          {selected ? selected.initials : "—"}
        </span>
        <select
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Assignee"
          className={cn(
            "h-8 flex-1 min-w-0 px-2 rounded-md border bg-white text-xs text-ink",
            "focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30",
            error ? "border-warn" : "border-line"
          )}
        >
          <option value="">Unassigned</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      {error && <div className="text-2xs text-warn">{error}</div>}
    </div>
  );
}
