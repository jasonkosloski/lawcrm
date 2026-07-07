/**
 * Calendar Agenda Rail
 *
 * Persistent right-side rail on the calendar page showing the user's
 * upcoming events and deadlines for the next 14 days, grouped by day.
 * Always visible regardless of what the user is looking at in the main
 * calendar view — stays anchored to "now" so it's a reliable pulse of
 * what's coming up.
 *
 * When a Create panel opens, it docks to the left of this rail so
 * both remain visible.
 */

import Link from "next/link";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { EventLink } from "./event-link";
import {
  dateKeyInTz,
  formatDate,
  instantInTz} from "@/lib/format-date";
import { getCurrentUserTimeZone } from "@/lib/current-user-tz";
import {
  getCalendarItems,
  type CalendarItem,
  type CalendarEventRow,
  type CalendarDeadlineRow,
} from "@/lib/queries/calendar";

const AGENDA_DAYS = 14;

function dayHeading(dayKey: string, todayKey: string, tomorrowKey: string): string {
  if (dayKey === todayKey) return "Today";
  if (dayKey === tomorrowKey) return "Tomorrow";
  // Reconstruct a noon-UTC Date from the YYYY-MM-DD key for
  // formatting. Noon UTC keeps `format()` from re-interpreting in
  // server-local TZ.
  const [y, m, d] = dayKey.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  return format(noon, "EEE, MMM d");
}

export async function CalendarAgenda() {
  const userTz = await getCurrentUserTimeZone();
  const now = new Date();
  // Range bounds anchored to "today midnight in user TZ" through
  // "AGENDA_DAYS later" — the user thinks "next two weeks" in
  // their local time, not the server's UTC.
  const todayKey = dateKeyInTz(now, userTz);
  const [ty, tm, td] = todayKey.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const start = instantInTz(ty, tm, td, 0, 0, userTz);
  const endNoon = new Date(Date.UTC(ty, tm - 1, td, 12));
  endNoon.setUTCDate(endNoon.getUTCDate() + AGENDA_DAYS);
  const end = instantInTz(
    endNoon.getUTCFullYear(),
    endNoon.getUTCMonth() + 1,
    endNoon.getUTCDate(),
    23,
    59,
    userTz
  );
  const items = await getCalendarItems(start, end);

  // Sort chronologically. For same-day items, events sort by startTime;
  // deadlines go first within their day (higher priority visually).
  const sorted = [...items].sort((a, b) => {
    const aT =
      a.kind === "event" ? a.startTime.getTime() : a.dueDate.getTime();
    const bT =
      b.kind === "event" ? b.startTime.getTime() : b.dueDate.getTime();
    if (aT !== bT) return aT - bT;
    if (a.kind !== b.kind) return a.kind === "deadline" ? -1 : 1;
    return 0;
  });

  // Bucket into day groups using the user's TZ. Two events at
  // different UTC instants can still share the same calendar day
  // in user TZ — that's what we want.
  const groups: Array<{ dayKey: string; items: CalendarItem[] }> = [];
  for (const item of sorted) {
    const itemDate = item.kind === "event" ? item.startTime : item.dueDate;
    const dayKey = dateKeyInTz(itemDate, userTz);
    const last = groups[groups.length - 1];
    if (last && last.dayKey === dayKey) {
      last.items.push(item);
    } else {
      groups.push({ dayKey, items: [item] });
    }
  }
  // Pre-compute "tomorrow" key for the day-heading helper.
  const tomorrowNoon = new Date(Date.UTC(ty, tm - 1, td, 12));
  tomorrowNoon.setUTCDate(tomorrowNoon.getUTCDate() + 1);
  const tomorrowKey = `${tomorrowNoon.getUTCFullYear()}-${String(
    tomorrowNoon.getUTCMonth() + 1
  ).padStart(2, "0")}-${String(tomorrowNoon.getUTCDate()).padStart(2, "0")}`;

  return (
    <aside className="hidden lg:flex w-72 shrink-0 border-l border-line bg-paper-2/30 flex-col min-h-0">
      <header className="px-4 py-3 border-b border-line shrink-0 bg-white">
        <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
          Agenda
        </div>
        <h2 className="text-sm font-display font-medium text-ink">
          Upcoming · next {AGENDA_DAYS} days
        </h2>
      </header>

      <div className="flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <div className="p-4 text-xs text-ink-4">
            No events or deadlines in the next {AGENDA_DAYS} days.
          </div>
        ) : (
          <ul className="flex flex-col">
            {groups.map((group) => (
              <li
                key={group.dayKey}
                className="border-b border-line last:border-b-0"
              >
                <div
                  className={cn(
                    "sticky top-0 z-10 bg-paper-2/80 backdrop-blur-sm px-4 py-1.5 text-2xs font-mono uppercase tracking-wider",
                    group.dayKey === todayKey
                      ? "text-brand-700 font-semibold"
                      : "text-ink-4"
                  )}
                >
                  {dayHeading(group.dayKey, todayKey, tomorrowKey)}
                </div>
                <ul className="flex flex-col">
                  {group.items.map((item) =>
                    item.kind === "event" ? (
                      <AgendaEvent key={item.id} event={item} userTz={userTz} />
                    ) : (
                      <AgendaDeadline key={item.id} deadline={item} />
                    )
                  )}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

// ── Row components ───────────────────────────────────────────────────────

/**
 * Compact time label for an agenda row: "All day" or "3:30pm".
 *
 * Must format in the USER's TZ — the day headings above the rows are
 * bucketed via `dateKeyInTz(…, userTz)`, so a server-local format here
 * (UTC in production) would show a time shifted by the user's UTC
 * offset under an otherwise-correct "Today" heading. The lowercase /
 * no-space compaction keeps the label inside the rail's fixed w-12
 * time column.
 *
 * Exported for tests.
 */
export function agendaTimeLabel(
  startTime: Date,
  isAllDay: boolean,
  userTz: string
): string {
  if (isAllDay) return "All day";
  // `formatDate` returns "3:30 PM" (Intl may use a narrow no-break
  // space before the dayperiod — `\s` matches it).
  return formatDate(startTime, "time", userTz).toLowerCase().replace(/\s+/g, "");
}

function AgendaEvent({
  event,
  userTz,
}: {
  event: CalendarEventRow;
  userTz: string;
}) {
  const timeLabel = agendaTimeLabel(event.startTime, event.isAllDay, userTz);
  return (
    <li>
      <EventLink eventId={event.id} className="block">
        <div className="flex items-start gap-2 px-4 py-2 hover:bg-brand-tint transition-colors cursor-pointer">
          <span className="text-2xs font-mono text-ink-4 w-12 pt-0.5 shrink-0">
            {timeLabel}
          </span>
          <span
            className="w-1 self-stretch rounded-full mt-0.5 shrink-0"
            style={{ background: event.color }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-ink truncate">
              {event.title}
            </div>
            {event.matterName && (
              <div className="text-2xs font-mono text-ink-4 truncate">
                {event.matterName}
              </div>
            )}
          </div>
        </div>
      </EventLink>
    </li>
  );
}

function AgendaDeadline({ deadline }: { deadline: CalendarDeadlineRow }) {
  const pillCls =
    deadline.deadlineKind === "critical"
      ? "text-warn"
      : deadline.deadlineKind === "auto_rule"
        ? "text-brand-700"
        : "text-ink-3";
  return (
    <li>
      <Link
        href={`/matters/${deadline.matterId}/deadlines`}
        className="flex items-start gap-2 px-4 py-2 hover:bg-brand-tint transition-colors"
      >
        <span className={cn("text-2xs font-mono w-12 pt-0.5 shrink-0", pillCls)}>
          ⚠ due
        </span>
        <div className="flex-1 min-w-0">
          <div className={cn("text-xs font-medium truncate", pillCls)}>
            {deadline.title}
          </div>
          <div className="text-2xs font-mono text-ink-4 truncate">
            {deadline.matterName}
          </div>
        </div>
      </Link>
    </li>
  );
}
