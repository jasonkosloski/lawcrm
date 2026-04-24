/**
 * Week View
 *
 * 7 day columns + a left-rail time gutter. Events are positioned
 * absolutely within their day column based on start/end times.
 * Deadlines (time-less) float above the hour grid as a bar at the
 * top of their day.
 *
 * Hour range is fixed at 6am–9pm (HOURS in calendar-utils) — legal
 * work hours fit comfortably inside without scrolling.
 */

import Link from "next/link";
import { addDays, format, isSameDay, startOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import {
  eventHeightPx,
  eventTopPx,
  formatHourLabel,
  HOUR_HEIGHT_PX,
  HOURS,
  nowOffsetPx,
} from "@/lib/calendar-utils";
import type {
  CalendarItem,
  CalendarEventRow,
  CalendarDeadlineRow,
} from "@/lib/queries/calendar";
import { weekRange } from "./calendar-toolbar";

export function WeekView({
  focal,
  items,
}: {
  focal: Date;
  items: CalendarItem[];
}) {
  const { start } = weekRange(focal);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = startOfDay(new Date());
  const now = new Date();

  // Pre-bucket items by day (YYYY-MM-DD key).
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const d =
      item.kind === "event"
        ? format(item.startTime, "yyyy-MM-dd")
        : format(item.dueDate, "yyyy-MM-dd");
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d)!.push(item);
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
      {/* Day header row — sticky */}
      <div
        className="grid sticky top-0 z-10 bg-card border-b border-line"
        style={{ gridTemplateColumns: "56px repeat(7, 1fr)" }}
      >
        <div />
        {days.map((day) => {
          const isToday = isSameDay(day, today);
          return (
            <div
              key={day.toISOString()}
              className="flex flex-col items-center gap-0.5 py-2 border-l border-line"
            >
              <div className="text-2xs font-mono uppercase tracking-wider text-ink-4">
                {format(day, "EEE")}
              </div>
              <div
                className={cn(
                  "text-base font-display tracking-tight",
                  isToday ? "text-brand-500 font-semibold" : "text-ink"
                )}
              >
                {format(day, "d")}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time grid */}
      <div
        className="grid relative flex-1"
        style={{ gridTemplateColumns: "56px repeat(7, 1fr)" }}
      >
        {/* Hour gutter */}
        <div className="border-r border-line">
          {HOURS.map((h) => (
            <div
              key={h}
              className="text-2xs font-mono text-ink-4 text-right pr-1.5 pt-0.5"
              style={{ height: HOUR_HEIGHT_PX }}
            >
              {formatHourLabel(h)}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayItems = byDay.get(key) ?? [];
          const events = dayItems.filter(
            (i): i is CalendarEventRow => i.kind === "event"
          );
          const deadlines = dayItems.filter(
            (i): i is CalendarDeadlineRow => i.kind === "deadline"
          );
          const nowTop = nowOffsetPx(now, day);

          return (
            <div
              key={day.toISOString()}
              className="border-l border-line relative"
            >
              {/* Hour rows for grid lines */}
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="border-b border-line"
                  style={{ height: HOUR_HEIGHT_PX }}
                />
              ))}

              {/* Deadlines — stack as thin bars at the very top of the column */}
              {deadlines.length > 0 && (
                <div className="absolute top-0 left-1 right-1 flex flex-col gap-0.5 pt-0.5 z-10">
                  {deadlines.map((d) => (
                    <DeadlineChip key={d.id} deadline={d} />
                  ))}
                </div>
              )}

              {/* Events */}
              {events.map((e) => (
                <EventBlock
                  key={e.id}
                  event={e}
                  topOffset={deadlines.length * 18 + 4}
                />
              ))}

              {/* "Now" line */}
              {nowTop !== null && (
                <div
                  className="absolute left-0 right-0 z-20 pointer-events-none"
                  style={{ top: nowTop }}
                >
                  <div className="h-px bg-warn">
                    <div
                      className="w-2 h-2 rounded-full bg-warn -mt-[3px] -ml-[3px]"
                      aria-label="Current time"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────

function EventBlock({
  event,
  topOffset,
}: {
  event: CalendarEventRow;
  topOffset: number;
}) {
  const top = eventTopPx(event.startTime) + topOffset;
  const height = eventHeightPx(event.startTime, event.endTime);
  const content = (
    <div
      className="absolute left-1 right-1 px-1.5 py-1 rounded-sm overflow-hidden shadow-[inset_3px_0_0_0] hover:shadow-[inset_3px_0_0_0,0_2px_6px_-2px_rgba(0,0,0,0.1)] transition-shadow cursor-default"
      style={{
        top,
        height,
        background: `color-mix(in oklch, ${event.color} 16%, white)`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ["--tw-shadow-color" as any]: event.color,
        boxShadow: `inset 3px 0 0 0 ${event.color}`,
      }}
    >
      <div className="text-2xs font-medium text-ink leading-tight line-clamp-2">
        {event.title}
      </div>
      {event.matterName && (
        <div className="text-3xs font-mono text-ink-3 mt-0.5 truncate">
          {event.matterName}
        </div>
      )}
    </div>
  );
  if (event.matterId) {
    return (
      <Link href={`/matters/${event.matterId}`} className="block">
        {content}
      </Link>
    );
  }
  return content;
}

function DeadlineChip({ deadline }: { deadline: CalendarDeadlineRow }) {
  const cls =
    deadline.deadlineKind === "critical"
      ? "bg-warn-soft text-warn border-warn-border"
      : deadline.deadlineKind === "auto_rule"
        ? "bg-brand-soft text-brand-700 border-brand-200"
        : "bg-paper-2 text-ink-3 border-line";
  return (
    <Link
      href={`/matters/${deadline.matterId}/deadlines`}
      className={cn(
        "text-3xs font-medium px-1.5 py-0.5 rounded border truncate flex items-center gap-1",
        cls
      )}
      title={`${deadline.title} — ${deadline.matterName}`}
    >
      <span className="shrink-0">⚠</span>
      <span className="truncate">{deadline.title}</span>
    </Link>
  );
}
