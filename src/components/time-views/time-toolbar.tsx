/**
 * Time Toolbar
 *
 * Prev / today / next navigation + the Week / Day view toggle for
 * the standalone /time page. Mirrors CalendarToolbar: server
 * component, all state in the URL, every control a `<Link>`. The
 * page passes the viewer's time zone, so the "Today" link targets
 * the user's calendar day, not the server's.
 */

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { WEEK_STARTS_ON } from "@/lib/calendar-utils";
import {
  addDaysToKey,
  dateKeyInTz,
  formatDateOnly,
  parseDateOnly,
} from "@/lib/format-date";
import {
  buildTimeHref,
  toTimeDateParam,
  type TimeView,
} from "./time-view-utils";

/** Range label for the focal day. The focal Date is a navigation
 *  cursor (server-local midnight of a calendar day); the labels are
 *  built from its `YYYY-MM-DD` key as date-only values, so they
 *  never shift with the server's zone. */
export function formatRangeLabel(view: TimeView, focal: Date): string {
  const key = toTimeDateParam(focal);
  const day = parseDateOnly(key);
  if (!day) return key;
  if (view === "week") {
    const offset = (day.getUTCDay() - WEEK_STARTS_ON + 7) % 7;
    const startKey = addDaysToKey(key, -offset);
    const endKey = addDaysToKey(startKey, 6);
    const start = parseDateOnly(startKey)!;
    const end = parseDateOnly(endKey)!;
    if (start.getUTCMonth() === end.getUTCMonth()) {
      return `Week of ${formatDateOnly(start, "medium")}`;
    }
    return `${formatDateOnly(start, "short")} – ${formatDateOnly(end, "medium")}`;
  }
  return formatDateOnly(day, "full_long");
}

export function TimeToolbar({
  view,
  focal,
  userTz,
}: {
  view: TimeView;
  focal: Date;
  /** The viewer's profile zone - the page already resolved it. */
  userTz: string;
}) {
  // User-local "today" via the date-key round-trip (see
  // todayFocalInTz in calendar-toolbar.tsx for the full rationale).
  const today = parseISO(dateKeyInTz(new Date(), userTz));
  const step = view === "week" ? 7 : 1;
  const prev = addDays(focal, -step);
  const next = addDays(focal, step);

  return (
    <div className="flex items-center justify-between gap-2 px-3 sm:px-5 py-3 border-b border-line shrink-0">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div className="flex items-center border border-line rounded-md bg-white">
          <Link
            href={buildTimeHref(view, focal, { focal: prev })}
            className="p-1.5 text-ink-3 hover:text-brand-700 border-r border-line"
            aria-label={view === "week" ? "Previous week" : "Previous day"}
          >
            <ChevronLeft size={14} />
          </Link>
          <Link
            href={buildTimeHref(view, focal, { focal: today })}
            className="px-2.5 h-7 inline-flex items-center text-xs font-medium text-ink-2 hover:text-brand-700 border-r border-line"
          >
            Today
          </Link>
          <Link
            href={buildTimeHref(view, focal, { focal: next })}
            className="p-1.5 text-ink-3 hover:text-brand-700"
            aria-label={view === "week" ? "Next week" : "Next day"}
          >
            <ChevronRight size={14} />
          </Link>
        </div>
        <h2 className="text-sm font-display font-medium text-ink truncate">
          {formatRangeLabel(view, focal)}
        </h2>
      </div>

      <div className="inline-flex items-center rounded-md border border-line bg-white p-0.5">
        {(["week", "day"] as TimeView[]).map((v) => {
          const active = v === view;
          return (
            <Link
              key={v}
              href={buildTimeHref(view, focal, { view: v })}
              className={cn(
                "h-6 px-2.5 rounded text-2xs font-medium capitalize transition-colors",
                active
                  ? "bg-brand-soft text-brand-700"
                  : "text-ink-3 hover:text-brand-700"
              )}
            >
              {v}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
