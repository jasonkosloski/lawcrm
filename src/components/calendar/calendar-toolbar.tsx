/**
 * Calendar Toolbar
 *
 * Renders above the calendar grid: prev / today / next navigation,
 * view toggle (Week / Month), and range label. Pure server component
 * — all state lives in the URL and each control is a `<Link>`.
 */

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addDays,
  addMonths,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
  endOfWeek,
  endOfMonth,
} from "date-fns";
import { cn } from "@/lib/utils";
import {
  buildCalendarHref,
  type CalendarView,
} from "@/lib/calendar-utils";

function formatRangeLabel(view: CalendarView, focal: Date): string {
  if (view === "week") {
    const start = startOfWeek(focal, { weekStartsOn: 1 });
    const end = endOfWeek(focal, { weekStartsOn: 1 });
    if (start.getMonth() === end.getMonth()) {
      return `Week of ${format(start, "MMM d, yyyy")}`;
    }
    return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  }
  return format(focal, "MMMM yyyy");
}

export function CalendarToolbar({
  view,
  focal,
}: {
  view: CalendarView;
  focal: Date;
}) {
  const today = startOfDay(new Date());
  const prev =
    view === "week"
      ? addDays(focal, -7)
      : addMonths(startOfMonth(focal), -1);
  const next =
    view === "week"
      ? addDays(focal, 7)
      : addMonths(startOfMonth(focal), 1);

  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-line shrink-0">
      <div className="flex items-center gap-3">
        <div className="flex items-center border border-line rounded-md bg-white">
          <Link
            href={buildCalendarHref(view, focal, { focal: prev })}
            className="p-1.5 text-ink-3 hover:text-brand-700 border-r border-line"
            aria-label={view === "week" ? "Previous week" : "Previous month"}
          >
            <ChevronLeft size={14} />
          </Link>
          <Link
            href={buildCalendarHref(view, focal, { focal: today })}
            className="px-2.5 h-7 inline-flex items-center text-xs font-medium text-ink-2 hover:text-brand-700 border-r border-line"
          >
            Today
          </Link>
          <Link
            href={buildCalendarHref(view, focal, { focal: next })}
            className="p-1.5 text-ink-3 hover:text-brand-700"
            aria-label={view === "week" ? "Next week" : "Next month"}
          >
            <ChevronRight size={14} />
          </Link>
        </div>
        <h2 className="text-sm font-display font-medium text-ink">
          {formatRangeLabel(view, focal)}
        </h2>
      </div>

      <div className="inline-flex items-center rounded-md border border-line bg-white p-0.5">
        {(["week", "month"] as CalendarView[]).map((v) => {
          const active = v === view;
          return (
            <Link
              key={v}
              href={buildCalendarHref(view, focal, { view: v })}
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

// Exported for the page's range query calc — keeps the date math next
// to the toolbar that displays it.
export function weekRange(focal: Date): { start: Date; end: Date } {
  return {
    start: startOfWeek(focal, { weekStartsOn: 1 }),
    end: endOfWeek(focal, { weekStartsOn: 1 }),
  };
}

export function monthGridRange(focal: Date): { start: Date; end: Date } {
  return {
    start: startOfWeek(startOfMonth(focal), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(focal), { weekStartsOn: 1 }),
  };
}
