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
import {
  addDays,
  format,
  isSameDay,
  isToday,
  isTomorrow,
  startOfDay,
} from "date-fns";
import { cn } from "@/lib/utils";
import {
  getCalendarItems,
  type CalendarItem,
  type CalendarEventRow,
  type CalendarDeadlineRow,
} from "@/lib/queries/calendar";

const AGENDA_DAYS = 14;

function dayHeading(day: Date): string {
  if (isToday(day)) return "Today";
  if (isTomorrow(day)) return "Tomorrow";
  return format(day, "EEE, MMM d");
}

export async function CalendarAgenda() {
  const now = new Date();
  const start = startOfDay(now);
  const end = addDays(start, AGENDA_DAYS);
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

  // Bucket into day groups.
  const groups: Array<{ day: Date; items: CalendarItem[] }> = [];
  for (const item of sorted) {
    const day = startOfDay(
      item.kind === "event" ? item.startTime : item.dueDate
    );
    const last = groups[groups.length - 1];
    if (last && isSameDay(last.day, day)) {
      last.items.push(item);
    } else {
      groups.push({ day, items: [item] });
    }
  }

  return (
    <aside className="w-72 shrink-0 border-l border-line bg-paper-2/30 flex flex-col min-h-0">
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
                key={group.day.toISOString()}
                className="border-b border-line last:border-b-0"
              >
                <div
                  className={cn(
                    "sticky top-0 z-10 bg-paper-2/80 backdrop-blur-sm px-4 py-1.5 text-2xs font-mono uppercase tracking-wider",
                    isToday(group.day)
                      ? "text-brand-700 font-semibold"
                      : "text-ink-4"
                  )}
                >
                  {dayHeading(group.day)}
                </div>
                <ul className="flex flex-col">
                  {group.items.map((item) =>
                    item.kind === "event" ? (
                      <AgendaEvent key={item.id} event={item} />
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

function AgendaEvent({ event }: { event: CalendarEventRow }) {
  const timeLabel = event.isAllDay
    ? "All day"
    : format(event.startTime, "h:mmaaa").toLowerCase();
  const content = (
    <div className="flex items-start gap-2 px-4 py-2 hover:bg-brand-tint transition-colors">
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
  );
  return event.matterId ? (
    <li>
      <Link href={`/matters/${event.matterId}`} className="block">
        {content}
      </Link>
    </li>
  ) : (
    <li>{content}</li>
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
