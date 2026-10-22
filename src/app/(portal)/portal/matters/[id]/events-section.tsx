/** "Coming up": events the firm shared with the client, with past ones collapsed. */

import { CalendarDays, MapPin } from "lucide-react";
import { dateKeyInTz, formatDate } from "@/lib/format-date";
import { PORTAL_TIME_ZONE } from "@/lib/portal/time-zone";
import type { PortalSharedEventView } from "@/lib/portal/status";

/**
 * All-day events are date-only values (ADR-012): read them in UTC so the
 * day never shifts. Timed events show date + start time, and the end time
 * (with its date when it falls on another day).
 */
export function whenLabel(e: PortalSharedEventView): string {
  if (e.isAllDay) {
    const start = formatDate(e.startTime, "full_short", "UTC");
    const sameDay =
      e.endTime.getTime() <= e.startTime.getTime() ||
      formatDate(e.endTime, "iso", "UTC") === formatDate(e.startTime, "iso", "UTC");
    return sameDay ? start : `${start} to ${formatDate(e.endTime, "full_short", "UTC")}`;
  }
  const date = formatDate(e.startTime, "full_short", PORTAL_TIME_ZONE);
  const start = formatDate(e.startTime, "time", PORTAL_TIME_ZONE);
  if (dateKeyInTz(e.startTime, PORTAL_TIME_ZONE) === dateKeyInTz(e.endTime, PORTAL_TIME_ZONE)) {
    const end = formatDate(e.endTime, "time", PORTAL_TIME_ZONE);
    return end === start ? `${date}, ${start}` : `${date}, ${start} to ${end}`;
  }
  const endDate = formatDate(e.endTime, "full_short", PORTAL_TIME_ZONE);
  const end = formatDate(e.endTime, "time", PORTAL_TIME_ZONE);
  return `${date}, ${start} to ${endDate}, ${end}`;
}

function EventItem({ e }: { e: PortalSharedEventView }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-display text-base font-medium text-ink">{e.title}</span>
      <span className="inline-flex items-center gap-1.5 text-sm text-ink-3">
        <CalendarDays className="size-4 shrink-0" aria-hidden="true" />
        {whenLabel(e)}
      </span>
      {e.location ? (
        <span className="inline-flex items-center gap-1.5 text-sm text-ink-3">
          <MapPin className="size-4 shrink-0" aria-hidden="true" />
          {e.location}
        </span>
      ) : null}
      {e.note ? <p className="text-sm whitespace-pre-line text-ink-2">{e.note}</p> : null}
    </div>
  );
}

export function EventsSection({
  upcoming,
  past,
}: {
  upcoming: PortalSharedEventView[];
  past: PortalSharedEventView[];
}) {
  if (upcoming.length === 0 && past.length === 0) return null;
  return (
    <section aria-labelledby="events-heading" className="flex flex-col gap-3">
      <h2 id="events-heading" className="text-sm font-semibold text-ink-2">
        Coming up
      </h2>
      {upcoming.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {upcoming.map((e) => (
            <li key={e.id} className="rounded-xl bg-white p-5 shadow-xs ring-1 ring-line">
              <EventItem e={e} />
            </li>
          ))}
        </ul>
      ) : null}
      {past.length > 0 ? (
        <details className="group rounded-xl bg-white shadow-xs ring-1 ring-line">
          <summary className="flex min-h-12 cursor-pointer items-center px-5 py-3 text-sm font-medium text-ink-2">
            Past
          </summary>
          <ul className="divide-y divide-line-2 border-t border-line-2">
            {past.map((e) => (
              <li key={e.id} className="px-5 py-4">
                <EventItem e={e} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
