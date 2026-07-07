/**
 * Time Toolbar
 *
 * Prev / today / next navigation + the Week / Day view toggle for
 * the standalone /time page. Mirrors CalendarToolbar: async server
 * component, all state in the URL, every control a `<Link>`. The
 * only data read is the viewer's time zone, so the "Today" link
 * targets the user's calendar day, not the server's.
 */

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, format, parseISO, startOfWeek, endOfWeek } from "date-fns";
import { cn } from "@/lib/utils";
import { WEEK_STARTS_ON } from "@/lib/calendar-utils";
import { dateKeyInTz } from "@/lib/format-date";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import { buildTimeHref, type TimeView } from "./time-view-utils";

function formatRangeLabel(view: TimeView, focal: Date): string {
  if (view === "week") {
    const start = startOfWeek(focal, { weekStartsOn: WEEK_STARTS_ON });
    const end = endOfWeek(focal, { weekStartsOn: WEEK_STARTS_ON });
    if (start.getMonth() === end.getMonth()) {
      return `Week of ${format(start, "MMM d, yyyy")}`;
    }
    return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
  }
  return format(focal, "EEEE, MMM d, yyyy");
}

export async function TimeToolbar({
  view,
  focal,
}: {
  view: TimeView;
  focal: Date;
}) {
  const userTz = await getCurrentUserTimeZone();
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
