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

import { useState, useTransition } from "react";
import { BellPlus, BellRing, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { notifyError } from "@/lib/feedback";
// followUpAt is stored as an instant (end of the chosen day). Which
// calendar day it denotes - and whether that day is today, tomorrow
// or past - is judged in the viewer's PROFILE zone (ADR-012), the
// same zone the server rendered with, so SSR and hydration agree and
// the chip never flips "Today"/"Tomorrow" on the client.
import {
  addDaysToKey,
  daysBetweenKeys,
  dateKeyInTz,
  formatDate,
  todayKey,
} from "@/lib/format-date";
import { useUserTimeZone } from "@/components/user-time-zone";
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
  const tz = useUserTimeZone();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const followKey = followUpAt ? dateKeyInTz(followUpAt, tz) : "";
  const [picked, setPicked] = useState(followKey);

  // Re-sync the date input on every open - `followUpAt` changes under
  // us after a save (server revalidation), and the mount-time value
  // would otherwise show a stale date that Save could silently
  // reapply over the newer follow-up. Done during render (stored
  // previous token) rather than in an effect: the token is null while
  // closed, so every open - and every new follow-up date while open -
  // is a change.
  const syncToken = open ? followKey : null;
  const [syncedToken, setSyncedToken] = useState<string | null>(null);
  if (syncToken !== syncedToken) {
    setSyncedToken(syncToken);
    if (open) setPicked(followKey);
  }

  const today = todayKey(tz);
  // Whole days from today to the follow-up day (negative = past).
  const daysAway = followUpAt ? daysBetweenKeys(today, followKey) : 0;
  const isOverdue = followUpAt !== null && daysAway < 0;
  const isToday = followUpAt !== null && daysAway === 0;

  const save = (dateString: string | null) => {
    // Presets and Clear bypass the input - keep `picked` consistent
    // with what was just submitted; the on-open resync above takes
    // over once the server revalidates `followUpAt`.
    setPicked(dateString ?? "");
    setOpen(false);
    startTransition(async () => {
      try {
        const res = await action(threadId, dateString);
        if (!res.ok && res.error) notifyError(res.error);
      } catch {
        // A thrown action (DB blip, dropped connection) must not
        // swap the whole page for the error boundary.
        notifyError("Couldn't save the follow-up - try again.");
      }
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
                ? `Follow up by ${formatDate(followUpAt, "short_weekday", tz)}`
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
                {labelFor(followUpAt, daysAway, tz)}
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
          <div className="text-2xs font-medium text-ink-3">
            Follow up by
          </div>

          {/* Presets */}
          <div className="flex flex-wrap gap-1.5">
            <PresetPill onClick={() => save(today)}>Today</PresetPill>
            <PresetPill onClick={() => save(addDaysToKey(today, 1))}>
              Tomorrow
            </PresetPill>
            <PresetPill onClick={() => save(nextMondayKey(today))}>
              Next Mon
            </PresetPill>
            <PresetPill onClick={() => save(addDaysToKey(today, 7))}>
              In a week
            </PresetPill>
          </div>

          {/* Date picker */}
          <input
            type="date"
            value={picked}
            min={today}
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
              className="ml-auto inline-flex items-center h-7 px-3 rounded-md text-xs font-medium bg-brand-700 text-white hover:bg-brand-900 disabled:opacity-50"
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

/** The next Monday strictly after the day `key` (a Monday jumps a
 *  full week), as a day key. */
function nextMondayKey(key: string): string {
  // Noon UTC of the key's calendar day - the weekday is zone-independent.
  const dow = new Date(`${key}T12:00:00Z`).getUTCDay(); // 0 = Sun, 1 = Mon
  const diff = (8 - dow) % 7 || 7;
  return addDaysToKey(key, diff);
}

/** Compact label for the chip - "Today" / "Tomorrow" / "Mar 12" /
 *  "Late: Mar 8" - surfaces what matters at a glance. `daysAway` is
 *  whole calendar days from the viewer's today (negative = past). */
function labelFor(d: Date, daysAway: number, tz: string): string {
  if (daysAway < -1) {
    // More than a day overdue
    return `Late: ${formatDate(d, "short", tz)}`;
  }
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  return formatDate(d, "short_weekday", tz);
}
