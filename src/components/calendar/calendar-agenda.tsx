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

import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { EventLink } from "./event-link";
import {
  addDaysToKey,
  formatDate,
  formatDateOnly,
  instantInTz,
  parseDateOnly,
  todayKey as todayKeyInTz,
  type DayKey,
} from "@/lib/format-date";
import {
  getCalendarItems,
  type CalendarItem,
  type CalendarEventRow,
  type CalendarDeadlineRow,
} from "@/lib/queries/calendar";
import { deadlineRank, itemDayKeys } from "./bucket-items";

export const AGENDA_DAYS = 14;

function dayHeading(dayKey: DayKey, todayKey: DayKey, tomorrowKey: DayKey): string {
  if (dayKey === todayKey) return "Today";
  if (dayKey === tomorrowKey) return "Tomorrow";
  const date = parseDateOnly(dayKey);
  return date ? formatDateOnly(date, "short_weekday") : dayKey;
}

/** The instant bounds `getCalendarItems` is queried with: the start
 *  of the viewer's today through the end of day `AGENDA_DAYS` later,
 *  in the viewer's zone. Exported for tests. */
export function agendaRange(todayKey: DayKey, tz: string): { start: Date; end: Date } {
  const [ty, tm, td] = todayKey.split("-").map(Number) as [number, number, number];
  const [ey, em, ed] = addDaysToKey(todayKey, AGENDA_DAYS).split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return {
    start: instantInTz(ty, tm, td, 0, 0, tz),
    end: instantInTz(ey, em, ed, 23, 59, tz),
  };
}

/** Order within one agenda day: deadlines first (critical-first),
 *  then all-day events, then timed events by start. */
function compareWithinDay(a: CalendarItem, b: CalendarItem): number {
  if (a.kind !== b.kind) return a.kind === "deadline" ? -1 : 1;
  if (a.kind === "deadline" && b.kind === "deadline") {
    return deadlineRank(a) - deadlineRank(b);
  }
  if (a.kind === "event" && b.kind === "event") {
    if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
    return a.startTime.getTime() - b.startTime.getTime();
  }
  return 0;
}

/**
 * Group items into the agenda's per-day sections, `todayKey` through
 * `AGENDA_DAYS` later. Timed events group by the viewer's calendar
 * day; deadlines and all-day events are date-only values grouped by
 * their stored calendar date (ADR-012) — so a deadline due today sits
 * under "Today", not under yesterday. A multi-day all-day event shows
 * under every day it covers inside the window. Exported for tests.
 */
export function buildAgendaGroups(
  items: readonly CalendarItem[],
  userTz: string,
  todayKey: DayKey,
): Array<{ dayKey: DayKey; items: CalendarItem[] }> {
  const lastKey = addDaysToKey(todayKey, AGENDA_DAYS);
  const byDay = new Map<DayKey, CalendarItem[]>();
  for (const item of items) {
    for (const key of itemDayKeys(item, userTz)) {
      if (key < todayKey || key > lastKey) continue;
      const list = byDay.get(key);
      if (list) list.push(item);
      else byDay.set(key, [item]);
    }
  }
  return [...byDay.keys()].sort().map((dayKey) => ({
    dayKey,
    items: byDay.get(dayKey)!.sort(compareWithinDay),
  }));
}

export async function CalendarAgenda({ userTz }: { userTz: string }) {
  // The viewer's zone comes from the page (already resolved there) —
  // one fewer user lookup per render.
  const todayKey = todayKeyInTz(userTz);
  const { start, end } = agendaRange(todayKey, userTz);
  const items = await getCalendarItems(start, end);
  const groups = buildAgendaGroups(items, userTz, todayKey);
  const tomorrowKey = addDaysToKey(todayKey, 1);

  return (
    <aside className="hidden lg:flex w-72 shrink-0 border-l border-line bg-paper-2/30 flex-col min-h-0">
      <header className="px-4 py-3 border-b border-line shrink-0 bg-white">
        <div className="text-2xs font-medium text-ink-3">Agenda</div>
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
              <li key={group.dayKey} className="border-b border-line last:border-b-0">
                <div
                  className={cn(
                    "sticky top-0 z-10 bg-paper-2/80 backdrop-blur-sm px-4 py-1.5 text-2xs font-mono",
                    group.dayKey === todayKey ? "text-brand-700 font-semibold" : "text-ink-4",
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
                    ),
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
export function agendaTimeLabel(startTime: Date, isAllDay: boolean, userTz: string): string {
  if (isAllDay) return "All day";
  // `formatDate` returns "3:30 PM" (Intl may use a narrow no-break
  // space before the dayperiod — `\s` matches it).
  return formatDate(startTime, "time", userTz).toLowerCase().replace(/\s+/g, "");
}

function AgendaEvent({ event, userTz }: { event: CalendarEventRow; userTz: string }) {
  const timeLabel = agendaTimeLabel(event.startTime, event.isAllDay, userTz);
  return (
    <li>
      <EventLink eventId={event.id} className="block">
        <div className="flex items-start gap-2 px-4 py-2 hover:bg-brand-tint transition-colors cursor-pointer">
          <span className="text-2xs font-mono text-ink-4 w-12 pt-0.5 shrink-0">{timeLabel}</span>
          <span
            className="w-1 self-stretch rounded-full mt-0.5 shrink-0"
            style={{ background: event.color }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-ink truncate">{event.title}</div>
            {event.matterName && (
              <div className="text-2xs font-mono text-ink-4 truncate">{event.matterName}</div>
            )}
          </div>
        </div>
      </EventLink>
    </li>
  );
}

function AgendaDeadline({ deadline }: { deadline: CalendarDeadlineRow }) {
  const pillCls = deadline.deadlineKind === "critical" ? "text-danger" : "text-ink-2";
  return (
    <li>
      <Link
        href={`/matters/${deadline.matterId}/deadlines`}
        className="flex items-start gap-2 px-4 py-2 hover:bg-brand-tint transition-colors"
      >
        <span
          className={cn(
            "text-2xs w-12 pt-0.5 shrink-0 inline-flex items-center gap-0.5",
            deadline.deadlineKind === "critical" ? "text-danger" : "text-warn",
          )}
        >
          <CalendarClock size={11} strokeWidth={2} aria-hidden /> Due
        </span>
        <div className="flex-1 min-w-0">
          <div className={cn("text-xs font-medium truncate", pillCls)}>{deadline.title}</div>
          <div className="text-2xs font-mono text-ink-4 truncate">{deadline.matterName}</div>
        </div>
      </Link>
    </li>
  );
}
