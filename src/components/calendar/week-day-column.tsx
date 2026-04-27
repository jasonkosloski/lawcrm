/**
 * Per-day client cells for WeekView.
 *
 * Two components, both client-side because they own drag/drop:
 *
 *   - `WeekAllDayCell` — sits in the all-day row above the hour
 *     grid. Renders all-day event chips + deadlines for the day,
 *     and is the drop target for "make this all-day on this date"
 *     moves.
 *
 *   - `WeekTimeColumn` — sits in the hour grid below. Renders
 *     timed events positioned by start/end time only; the gridlines
 *     in this column line up exactly with the gutter labels because
 *     no top offset is applied. Drop target for "schedule at this
 *     time slot" moves with the chip-top-lands-where-you-see-it
 *     drop math + a live preview line.
 *
 * Splitting the all-day chips into their own row above the hour
 * grid is the standard calendar layout (Google / Apple / Outlook).
 * Trying to render both in the same column is what produced the
 * "9am chip is actually 8:15" bug — timed chips were shifted down
 * past the all-day bar, but the gridlines stayed put.
 */

"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { isSameDay } from "date-fns";
import { cn } from "@/lib/utils";
import {
  eventHeightPx,
  eventTopPx,
  HOUR_HEIGHT_PX,
  HOURS,
  isWeekend,
  nowOffsetPx,
} from "@/lib/calendar-utils";
import {
  clearActiveDrag,
  hasKind,
  peekActiveDrag,
  setActiveDrag,
  setDragPayload,
  useDropTarget,
  type DragPayload,
} from "@/lib/dnd";
import { moveCalendarEvent } from "@/app/actions/calendar-events";
import {
  CALENDAR_EVENT_KIND,
  type CalendarEventDragData,
} from "./event-drag";
import type {
  CalendarEventRow,
  CalendarDeadlineRow,
} from "@/lib/queries/calendar";

// ── Shared move handler ────────────────────────────────────────────────

function useMoveEvent(): (
  eventId: string,
  schedule: { isAllDay: boolean; start: Date; end: Date }
) => void {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (eventId, schedule) => {
    startTransition(async () => {
      const res = await moveCalendarEvent(eventId, {
        isAllDay: schedule.isAllDay,
        startTime: schedule.start.toISOString(),
        endTime: schedule.end.toISOString(),
      });
      if (!res.ok) {
        // eslint-disable-next-line no-alert
        alert(res.error ?? "Couldn't move event.");
      }
      router.refresh();
    });
  };
}

// ── All-day row cell ───────────────────────────────────────────────────

export type WeekAllDayCellProps = {
  day: Date;
  events: CalendarEventRow[];
  deadlines: CalendarDeadlineRow[];
  canEdit: boolean;
};

export function WeekAllDayCell({
  day,
  events,
  deadlines,
  canEdit,
}: WeekAllDayCellProps) {
  const move = useMoveEvent();
  const drop = useDropTarget<CalendarEventDragData>({
    kind: CALENDAR_EVENT_KIND,
    disabled: !canEdit,
    onDrop: (data) => {
      const droppedDate = startOfLocalDay(day);
      const originalStart = new Date(data.startTimeIso);
      // No-op when the chip is already all-day on this date.
      if (data.isAllDay && isSameDay(originalStart, droppedDate)) {
        return;
      }
      move(data.id, {
        isAllDay: true,
        start: droppedDate,
        end: droppedDate,
      });
    },
  });

  const weekend = isWeekend(day);
  return (
    <div
      {...drop.handlers}
      className={cn(
        "border-l border-line p-1 flex flex-col gap-0.5 transition-colors",
        weekend && "bg-paper",
        drop.isOver && "bg-brand-tint/40 ring-2 ring-brand-300 ring-inset"
      )}
    >
      {events.map((e) => (
        <DraggableAllDayChip key={e.id} event={e} canEdit={canEdit} />
      ))}
      {deadlines.map((d) => (
        <DeadlineChip key={d.id} deadline={d} />
      ))}
    </div>
  );
}

// ── Time grid column ───────────────────────────────────────────────────

export type WeekTimeColumnProps = {
  day: Date;
  today: Date;
  now: Date;
  events: CalendarEventRow[];
  canEdit: boolean;
};

export function WeekTimeColumn({
  day,
  today,
  now,
  events,
  canEdit,
}: WeekTimeColumnProps) {
  const move = useMoveEvent();
  const [previewTopY, setPreviewTopY] = useState<number | null>(null);

  // Snap helper — used by both drop and the dragover preview so
  // the line + commit stay in sync.
  const computeSnap = (
    cursorYInColumn: number,
    data: CalendarEventDragData
  ): { topY: number; date: Date } => {
    const chipTopY = data.isAllDay
      ? cursorYInColumn
      : cursorYInColumn - data.grabOffsetY;
    const totalMinutes = clamp(
      Math.round((chipTopY / HOUR_HEIGHT_PX) * 60 / 15) * 15,
      0,
      (HOURS.length - 1) * 60 + 45
    );
    const topY = (totalMinutes / 60) * HOUR_HEIGHT_PX;
    const startHour = HOURS[0]!;
    const dayStart = startOfLocalDay(day);
    const date = new Date(dayStart);
    date.setHours(startHour, 0, 0, 0);
    date.setMinutes(date.getMinutes() + totalMinutes);
    return { topY, date };
  };

  const drop = useDropTarget<CalendarEventDragData>({
    kind: CALENDAR_EVENT_KIND,
    disabled: !canEdit,
    onDrop: (data, e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const cursorYInColumn = e.clientY - rect.top;
      const { date: newStart } = computeSnap(cursorYInColumn, data);
      const originalStart = new Date(data.startTimeIso);
      const originalEnd = new Date(data.endTimeIso);
      const durationMs = data.isAllDay
        ? 2 * 60 * 60 * 1000
        : Math.max(
            15 * 60 * 1000,
            originalEnd.getTime() - originalStart.getTime()
          );
      const newEnd = new Date(newStart.getTime() + durationMs);
      setPreviewTopY(null);
      move(data.id, { isAllDay: false, start: newStart, end: newEnd });
    },
  });

  // Layer cursor-tracking on top of the drop handlers for the
  // live preview line.
  const handlers = {
    ...drop.handlers,
    onDragOver: (e: React.DragEvent) => {
      drop.handlers.onDragOver(e);
      if (!canEdit) return;
      if (!hasKind(e, CALENDAR_EVENT_KIND)) return;
      const data = peekActiveDrag<CalendarEventDragData>(CALENDAR_EVENT_KIND);
      if (!data) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const cursorYInColumn = e.clientY - rect.top;
      const { topY } = computeSnap(cursorYInColumn, data);
      setPreviewTopY(topY);
    },
    onDragLeave: (e: React.DragEvent) => {
      drop.handlers.onDragLeave(e);
      setPreviewTopY(null);
    },
    onDrop: (e: React.DragEvent) => {
      drop.handlers.onDrop(e);
      setPreviewTopY(null);
    },
  };

  // Preview label + height derived from previewTopY.
  const activeDrag = peekActiveDrag<CalendarEventDragData>(
    CALENDAR_EVENT_KIND
  );
  let previewLabel: string | null = null;
  let previewHeight = 0;
  if (previewTopY !== null && activeDrag) {
    const minutesFromStart = (previewTopY / HOUR_HEIGHT_PX) * 60;
    const startHour = HOURS[0]!;
    const totalHours = startHour + minutesFromStart / 60;
    const hour24 = Math.floor(totalHours);
    const minute = Math.round((totalHours - hour24) * 60);
    const h12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    const suffix = hour24 < 12 ? "a" : "p";
    previewLabel = `${h12}:${String(minute).padStart(2, "0")}${suffix}`;
    const originalStart = new Date(activeDrag.startTimeIso);
    const originalEnd = new Date(activeDrag.endTimeIso);
    const durationHours = activeDrag.isAllDay
      ? 2
      : Math.max(
          0.25,
          (originalEnd.getTime() - originalStart.getTime()) /
            (60 * 60 * 1000)
        );
    previewHeight = durationHours * HOUR_HEIGHT_PX;
  }

  const nowTop = nowOffsetPx(now, day);
  const isTodayCol = isSameDay(day, today);
  const weekend = isWeekend(day);

  return (
    <div
      {...handlers}
      className={cn(
        "border-l border-line relative",
        weekend && "bg-paper",
        drop.isOver && "bg-brand-tint/30"
      )}
    >
      {/* Hour rows for grid lines. Borders on the BOTTOM mean
          the line at Y=48 visually marks 7am (the boundary
          between the 6am and 7am rows). Gutter labels render
          at the top of each row, so a "7a" label aligns with
          the line below the 6am row. */}
      {HOURS.map((h) => (
        <div
          key={h}
          className="border-b border-line"
          style={{ height: HOUR_HEIGHT_PX }}
        />
      ))}

      {/* Timed events — Y position computed from start time alone
          (no all-day offset since the all-day chips are in their
          own row above this column). */}
      {events.map((e) => (
        <DraggableEventBlock key={e.id} event={e} canEdit={canEdit} />
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

      {/* Live preview line + label while dragging. Hidden when
          no drag is active. */}
      {previewTopY !== null && activeDrag && (
        <>
          <div
            className="absolute left-1 right-1 rounded-sm border-2 border-dashed border-brand-500/60 bg-brand-tint/40 pointer-events-none z-[15]"
            style={{
              top: previewTopY,
              height: Math.max(20, previewHeight),
            }}
            aria-hidden="true"
          />
          <div
            className="absolute -left-12 text-2xs font-mono text-brand-700 bg-white px-1 rounded shadow-sm pointer-events-none z-[16]"
            style={{ top: previewTopY - 7 }}
            aria-hidden="true"
          >
            {previewLabel}
          </div>
        </>
      )}

      {/* Today indicator placeholder — preserves the prior API
          surface for future highlight work. */}
      {isTodayCol && null}
    </div>
  );
}

// ── Chip components (shared) ────────────────────────────────────────────

function DraggableAllDayChip({
  event,
  canEdit,
}: {
  event: CalendarEventRow;
  canEdit: boolean;
}) {
  const style: React.CSSProperties = {
    background: `color-mix(in oklch, ${event.color} 16%, white)`,
    borderColor: `color-mix(in oklch, ${event.color} 35%, white)`,
    color: "var(--color-ink)",
  };
  return (
    <DraggableEventWrapper
      eventId={event.id}
      canDrag={canEdit}
      buildPayload={(grabOffsetY) => ({
        kind: CALENDAR_EVENT_KIND,
        data: {
          id: event.id,
          isAllDay: true,
          startTimeIso: event.startTime.toISOString(),
          endTimeIso: event.endTime.toISOString(),
          grabOffsetY,
        },
      })}
      title={`All day: ${event.title}${event.matterName ? ` · ${event.matterName}` : ""}`}
      style={style}
      className="text-3xs px-1.5 py-0.5 rounded border block overflow-hidden"
    >
      <div className="font-medium truncate">All day: {event.title}</div>
      {event.matterName && (
        <div className="font-mono text-ink-3 truncate leading-tight">
          {event.matterName}
        </div>
      )}
    </DraggableEventWrapper>
  );
}

function DraggableEventBlock({
  event,
  canEdit,
}: {
  event: CalendarEventRow;
  canEdit: boolean;
}) {
  const top = eventTopPx(event.startTime);
  const height = eventHeightPx(event.startTime, event.endTime);
  const style: React.CSSProperties = {
    top,
    height,
    background: `color-mix(in oklch, ${event.color} 16%, white)`,
    boxShadow: `inset 3px 0 0 0 ${event.color}`,
  };
  return (
    <DraggableEventWrapper
      eventId={event.id}
      canDrag={canEdit}
      buildPayload={(grabOffsetY) => ({
        kind: CALENDAR_EVENT_KIND,
        data: {
          id: event.id,
          isAllDay: false,
          startTimeIso: event.startTime.toISOString(),
          endTimeIso: event.endTime.toISOString(),
          grabOffsetY,
        },
      })}
      title={`${event.title}${event.matterName ? ` · ${event.matterName}` : ""}`}
      style={style}
      className="absolute left-1 right-1 px-1.5 py-1 rounded-sm overflow-hidden hover:shadow-[inset_3px_0_0_0,0_2px_6px_-2px_rgba(0,0,0,0.1)] transition-shadow"
      // Stays above the column's drop-zone background so the
      // drag pickup stays reliable.
      extraStyle={{ zIndex: 5 }}
    >
      <div className="text-2xs font-medium text-ink leading-tight line-clamp-2">
        {event.title}
      </div>
      {event.matterName && (
        <div className="text-3xs font-mono text-ink-3 mt-0.5 truncate">
          {event.matterName}
        </div>
      )}
    </DraggableEventWrapper>
  );
}

/** Shared draggable wrapper. Read-only mode renders a Link;
 *  editable mode renders a draggable div with manual click
 *  navigation (anchor's default URL drag would compete with the
 *  payload). Captures the cursor's Y offset within the chip on
 *  dragstart so the drop handler can land the chip's TOP at the
 *  hovered slot rather than the cursor itself. */
function DraggableEventWrapper({
  eventId,
  canDrag,
  buildPayload,
  title,
  style,
  extraStyle,
  className,
  children,
}: {
  eventId: string;
  canDrag: boolean;
  buildPayload: (
    grabOffsetY: number
  ) => DragPayload<typeof CALENDAR_EVENT_KIND, CalendarEventDragData>;
  title: string;
  style: React.CSSProperties;
  extraStyle?: React.CSSProperties;
  className: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const sp = useSearchParams();

  if (!canDrag) {
    const params = new URLSearchParams(sp.toString());
    params.set("event", eventId);
    return (
      <Link
        href={`${pathname}?${params.toString()}`}
        scroll={false}
        className={className}
        style={{ ...style, ...extraStyle }}
        title={title}
      >
        {children}
      </Link>
    );
  }

  const open = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const params = new URLSearchParams(sp.toString());
    params.set("event", eventId);
    window.location.href = `${pathname}?${params.toString()}`;
  };

  return (
    <div
      role="button"
      tabIndex={0}
      title={title}
      className={cn(className, "cursor-grab active:cursor-grabbing")}
      style={{ ...style, ...extraStyle }}
      draggable
      onDragStart={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const grabOffsetY = e.clientY - rect.top;
        e.dataTransfer.clearData();
        const payload = buildPayload(grabOffsetY);
        setDragPayload(e, payload);
        setActiveDrag(payload.kind, payload.data);
      }}
      onDragEnd={() => {
        clearActiveDrag();
      }}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open(e as unknown as React.MouseEvent<HTMLDivElement>);
        }
      }}
    >
      {children}
    </div>
  );
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

// ── Helpers ─────────────────────────────────────────────────────────────

function startOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
