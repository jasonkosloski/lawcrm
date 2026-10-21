/**
 * "This will change other deadlines" confirmation (ADR-040).
 *
 * Rendered INSIDE the form whose save would move rule-generated
 * deadlines (deadline edit dialog, matter edit form) after the server
 * answered `status: "confirm"`. Lists every deadline that would move,
 * old → new, with what it counts from. The user ticks which to update
 * and resubmits through one of two explicit buttons:
 *   - "Save and update N deadlines" → cascadeDecision=apply + cascadeId[]
 *   - "Save, don't change them"     → cascadeDecision=skip
 * Nothing moves unless it's ticked here.
 *
 * Defaults: ticked, except deadlines whose date was set by hand
 * (flagged). A deadline counting from an unticked one is disabled —
 * if its anchor doesn't move, neither does it.
 */

"use client";

import { useState } from "react";
import { CalendarClock, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateOnly, parseDateOnly } from "@/lib/format-date";
import type { RecalcChange } from "@/lib/automations/recalc-plan";

const day = (key: string) => formatDateOnly(parseDateOnly(key), "medium");

export function CascadeConfirm({
  changes,
  /** What the user changed, for the heading ("this deadline's date",
   *  "the incident date"). */
  changedLabel,
  isPending,
  onCancel,
}: {
  changes: RecalcChange[];
  changedLabel: string;
  isPending: boolean;
  onCancel: () => void;
}) {
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(changes.filter((c) => !c.manual).map((c) => c.deadlineId))
  );
  // A row is usable only if its anchor (another listed row) is ticked.
  const listed = new Set(changes.map((c) => c.deadlineId));
  const anchorTicked = (c: RecalcChange): boolean =>
    c.anchorDeadlineId === null || !listed.has(c.anchorDeadlineId) || effective.has(c.anchorDeadlineId);
  // Resolve top-down (the server lists anchors before dependents).
  const effective = new Set<string>();
  for (const c of changes) {
    if (ticked.has(c.deadlineId) && anchorTicked(c)) effective.add(c.deadlineId);
  }
  const toggle = (id: string, on: boolean) =>
    setTicked((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const n = effective.size;
  return (
    <div
      role="alertdialog"
      aria-labelledby="cascade-confirm-title"
      className="flex flex-col gap-3 rounded-md border border-warn-border bg-warn-soft p-3"
    >
      <div className="flex items-start gap-2">
        <TriangleAlert size={14} className="text-warn mt-0.5 shrink-0" />
        <div className="text-xs text-ink">
          <div id="cascade-confirm-title" className="font-semibold">
            Changing {changedLabel} will change {changes.length === 1 ? "another deadline" : `${changes.length} other deadlines`}
          </div>
          <div className="text-ink-3 mt-0.5">
            {changes.length === 1 ? "It counts" : "They count"} from it under the firm&apos;s deadline rules.
            Choose which to update — nothing changes unless it&apos;s ticked.
          </div>
        </div>
      </div>

      <ul className="flex flex-col divide-y divide-warn-border/60 rounded-md border border-warn-border/60 bg-white">
        {changes.map((c) => {
          const usable = anchorTicked(c);
          return (
            <li key={c.deadlineId} className={cn("px-3 py-2", !usable && "opacity-60")}>
              <label className="flex items-start gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  name="cascadeId"
                  value={c.deadlineId}
                  checked={effective.has(c.deadlineId)}
                  disabled={!usable}
                  onChange={(e) => toggle(c.deadlineId, e.target.checked)}
                  className="mt-0.5"
                  aria-label={`Update ${c.title}`}
                />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5 font-medium text-ink">
                    <CalendarClock size={12} className="text-ink-4" /> {c.title}
                  </span>
                  <span className="block font-mono text-2xs text-ink-2 mt-0.5">
                    <span className="line-through text-ink-4">{day(c.fromKey)}</span> → <strong>{day(c.toKey)}</strong>
                  </span>
                  <span className="block text-2xs text-ink-4">
                    Counts from {c.anchorText} · rule &ldquo;{c.ruleTitle}&rdquo;
                  </span>
                  {c.manual && (
                    <span className="block text-2xs text-warn mt-0.5">
                      This date was changed by hand — left unticked so it isn&apos;t overwritten.
                    </span>
                  )}
                  {!usable && (
                    <span className="block text-2xs text-ink-4 mt-0.5">
                      Stays as is because the deadline it counts from isn&apos;t being updated.
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-8 px-3 rounded-md text-xs text-ink-3 hover:text-ink"
        >
          Go back
        </button>
        <button
          type="submit"
          name="cascadeDecision"
          value="skip"
          disabled={isPending}
          className="h-8 px-3 rounded-md text-xs font-medium border border-line bg-white text-ink-2 hover:border-brand-300 disabled:opacity-60"
        >
          Save, don&apos;t change them
        </button>
        <button
          type="submit"
          name="cascadeDecision"
          value="apply"
          disabled={isPending || n === 0}
          className="h-8 px-3 rounded-md text-xs font-medium bg-brand-700 text-white hover:bg-brand-900 disabled:opacity-60"
        >
          {isPending ? "Saving…" : `Save and update ${n} deadline${n === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
}
