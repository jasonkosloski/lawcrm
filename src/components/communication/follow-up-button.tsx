/**
 * Follow Up Button
 *
 * Renders in the header of an email or messenger thread reader.
 * Three states:
 *   - No follow-up set → small "Follow up" button (BellPlus icon)
 *   - Follow-up set → date chip with overdue styling when past
 *   - Click either → popover with date input + presets + Clear
 *
 * Calls the per-source server action (setEmailThreadFollowUp /
 * setMessengerThreadFollowUp) bound by the caller.
 */

"use client";

import { useEffect, useState, useTransition } from "react";
import { BellPlus, BellRing, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export type FollowUpAction = (
  threadId: string,
  dateString: string | null
) => Promise<{ ok: boolean; error?: string }>;

export function FollowUpButton({
  threadId,
  followUpAt,
  action,
}: {
  threadId: string;
  followUpAt: Date | null;
  action: FollowUpAction;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState(toDateInput(followUpAt));

  // Re-sync the date input on every open — `followUpAt` changes under
  // us after a save (server revalidation), and the mount-time value
  // would otherwise show a stale date that Save could silently
  // reapply over the newer follow-up.
  useEffect(() => {
    if (open) setPicked(toDateInput(followUpAt));
  }, [open, followUpAt]);

  const isOverdue = followUpAt !== null && followUpAt.getTime() < Date.now();
  const isToday = followUpAt !== null && isSameDay(followUpAt, new Date());

  const save = (dateString: string | null) => {
    // Presets and Clear bypass the input — keep `picked` consistent
    // with what was just submitted; the on-open resync above takes
    // over once the server revalidates `followUpAt`.
    setPicked(dateString ?? "");
    setOpen(false);
    startTransition(async () => {
      const res = await action(threadId, dateString);
      if (!res.ok && res.error) alert(res.error);
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={pending}
            title={
              followUpAt
                ? `Follow up by ${followUpAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`
                : "Set follow-up reminder"
            }
            className={cn(
              "inline-flex items-center gap-1.5 h-7 px-2 text-2xs font-medium rounded-md border transition-colors",
              followUpAt === null
                ? "bg-white text-ink-3 border-line hover:border-brand-300 hover:text-brand-700 hover:bg-brand-soft"
                : isOverdue
                  ? "bg-warn-soft text-warn border-warn-border hover:border-warn"
                  : isToday
                    ? "bg-brand-soft text-brand-700 border-brand-200 hover:border-brand-300"
                    : "bg-paper-2/60 text-ink-2 border-line hover:border-brand-300 hover:text-brand-700",
              "disabled:opacity-50"
            )}
          >
            {followUpAt ? (
              <>
                <BellRing size={11} />
                {labelFor(followUpAt)}
              </>
            ) : (
              <>
                <BellPlus size={11} />
                Follow up
              </>
            )}
          </button>
        }
      />
      <PopoverContent align="end" className="w-64">
        <div className="flex flex-col gap-2.5">
          <div className="text-2xs font-mono uppercase tracking-wider text-ink-3">
            Follow up by
          </div>

          {/* Presets */}
          <div className="flex flex-wrap gap-1.5">
            <PresetPill onClick={() => save(toDateInput(addDays(0)))}>
              Today
            </PresetPill>
            <PresetPill onClick={() => save(toDateInput(addDays(1)))}>
              Tomorrow
            </PresetPill>
            <PresetPill onClick={() => save(toDateInput(nextMonday()))}>
              Next Mon
            </PresetPill>
            <PresetPill onClick={() => save(toDateInput(addDays(7)))}>
              In a week
            </PresetPill>
          </div>

          {/* Date picker */}
          <input
            type="date"
            value={picked}
            min={toDateInput(new Date())}
            onChange={(e) => setPicked(e.target.value)}
            className="h-8 px-2 rounded-md border border-line bg-white text-xs text-ink focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30"
          />

          <div className="flex items-center justify-between gap-2">
            {followUpAt && (
              <button
                type="button"
                onClick={() => save(null)}
                className="inline-flex items-center gap-1 text-2xs text-ink-3 hover:text-warn"
              >
                <X size={11} />
                Clear
              </button>
            )}
            <button
              type="button"
              disabled={!picked}
              onClick={() => save(picked || null)}
              className="ml-auto inline-flex items-center h-7 px-3 rounded-md text-xs font-medium bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PresetPill({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center h-6 px-2 text-2xs rounded-md border border-line bg-white text-ink-2 hover:border-brand-300 hover:bg-brand-soft hover:text-brand-700 transition-colors"
    >
      {children}
    </button>
  );
}

// ── Date helpers ──────────────────────────────────────────────────────

function toDateInput(d: Date | null): string {
  if (!d) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

function nextMonday(): Date {
  const d = new Date();
  const day = d.getDay(); // 0 = Sun, 1 = Mon
  const diff = (8 - day) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Compact label for the chip — "Today" / "Tomorrow" / "Mar 12" /
 *  "Late: Mar 8" — surfaces what matters at a glance. */
function labelFor(d: Date): string {
  const now = new Date();
  if (d.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
    // More than a day overdue
    return `Late: ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }
  if (isSameDay(d, now)) return "Today";
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (isSameDay(d, tomorrow)) return "Tomorrow";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
