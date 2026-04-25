/**
 * Comm Time Logged Indicator
 *
 * Compact "🕒 0.6h · JK 0.4h, RK 0.2h" pill that surfaces on each
 * email message and messenger item once time has been logged on it.
 * Click expands to show each entry with date + activity.
 *
 * Used on:
 *   - EmailMessage card header (next to timestamp + Log time button)
 *   - SMS bubble footer (next to timestamp)
 *   - Call event row (right after the call pill)
 *   - Voicemail card (alongside Log time + inbox actions)
 *
 * Renders nothing when no time is logged — keeps clean items clean.
 */

"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Clock, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export type CommTimeEntryView = {
  id: string;
  hours: number;
  date: Date;
  activity: string;
  userName: string;
  userInitials: string;
  billable: boolean;
};

export function CommTimeLoggedIndicator({
  entries,
  /** When true, render with reduced padding for tight surfaces
   *  (SMS bubbles, call events). */
  compact = false,
  /** Position the expanded panel above the chip instead of below
   *  — useful for items near the bottom of a scrolling area. */
  align = "left",
}: {
  entries: CommTimeEntryView[];
  compact?: boolean;
  align?: "left" | "right";
}) {
  const [expanded, setExpanded] = useState(false);
  if (entries.length === 0) return null;

  const totalHours = entries.reduce((s, e) => s + e.hours, 0);
  const billableHours = entries
    .filter((e) => e.billable)
    .reduce((s, e) => s + e.hours, 0);
  const byUser = aggregateByUser(entries);
  const userBreakdown =
    byUser.length > 1
      ? byUser
          .map((u) => `${u.initials} ${u.hours.toFixed(1)}h`)
          .join(" · ")
      : null;

  return (
    <div className={cn("flex flex-col gap-1", align === "right" && "items-end")}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title={
          billableHours !== totalHours
            ? `${totalHours.toFixed(1)}h total · ${billableHours.toFixed(1)}h billable`
            : `${totalHours.toFixed(1)}h logged`
        }
        className={cn(
          "inline-flex items-center gap-1 rounded-md border transition-colors",
          "bg-white text-ink-3 border-line",
          "hover:border-brand-300 hover:bg-brand-soft hover:text-brand-700",
          compact ? "h-5 px-1 text-3xs" : "h-6 px-1.5 text-2xs"
        )}
      >
        {expanded ? (
          <ChevronDown size={9} className="shrink-0 text-ink-4" />
        ) : (
          <ChevronRight size={9} className="shrink-0 text-ink-4" />
        )}
        <Clock size={compact ? 9 : 10} className="shrink-0 text-ink-4" />
        <span className="font-mono">
          {totalHours.toFixed(1)}h
        </span>
        {userBreakdown ? (
          <span className="text-ink-4 font-mono">· {userBreakdown}</span>
        ) : (
          <span className="text-ink-4 font-mono">
            · {byUser[0]?.initials ?? ""}
          </span>
        )}
      </button>

      {expanded && (
        <ul
          className={cn(
            "flex flex-col gap-1 rounded-md border border-line bg-paper-2/40 px-2 py-1.5",
            compact ? "min-w-48 max-w-72" : "min-w-56 max-w-80"
          )}
        >
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex items-center gap-2 text-2xs"
            >
              <span
                className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand-50 text-[10px] font-mono font-medium text-brand-700 border border-brand-100 shrink-0"
                title={e.userName}
              >
                {e.userInitials}
              </span>
              <span className="flex-1 min-w-0 text-ink truncate">
                {e.activity}
              </span>
              <span className="font-mono text-ink-4 shrink-0">
                {e.date.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
              <span className="font-mono text-ink shrink-0">
                {e.hours.toFixed(1)}h
              </span>
              {!e.billable && (
                <span
                  title="Non-billable"
                  className="text-[10px] text-ink-4"
                >
                  nb
                </span>
              )}
            </li>
          ))}
          {byUser.length > 1 && (
            <li className="border-t border-line pt-1 mt-1 flex items-center gap-2 text-3xs font-mono text-ink-4">
              <Lock size={8} className="opacity-0" /> {/* spacer */}
              <span className="flex-1">Total</span>
              <span>{totalHours.toFixed(1)}h</span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function aggregateByUser(
  entries: CommTimeEntryView[]
): Array<{ initials: string; name: string; hours: number }> {
  const byUser = new Map<
    string,
    { initials: string; name: string; hours: number }
  >();
  for (const e of entries) {
    const existing = byUser.get(e.userInitials);
    if (existing) {
      existing.hours += e.hours;
    } else {
      byUser.set(e.userInitials, {
        initials: e.userInitials,
        name: e.userName,
        hours: e.hours,
      });
    }
  }
  return Array.from(byUser.values()).sort((a, b) => b.hours - a.hours);
}
