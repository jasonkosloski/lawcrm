/**
 * Week Day Column — client component owning the day's drag-and-
 * drop wiring. Lives inside the server-rendered WeekView so the
 * data fetch stays on the server while the interaction layer is
 * client-side.
 *
 * Two drop zones per day:
 *
 *   1. **All-day bar** at the top. Drops here flip the event to
 *      isAllDay=true on this date. Same-day all-day → all-day is
 *      a no-op when the event is already on this date.
 *   2. **Hour grid** below. Drop Y position → the hour the cursor
 *      is over (snapped to 15 minutes). Behavior:
 *        - dragged event was timed: keep duration, shift
 *        - dragged event was all-day: become timed, default 2h
 *
 * Permission: the server gates `moveCalendarEvent` on
 * `events.edit`. The page-level `canEditEvents` flag here drives
 * the UI: chips become draggable, drop zones light up. A user
 * without permission still sees the chips (read-only) but no
 * drag handles + the drop zones decline payloads.
 */

"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { format, isSameDay } from "date-fns";
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

export type WeekDayColumnProps = {
  day: Date;
  today: Date;
  now: Date;
  allDayEvents: CalendarEventRow[];
  timedEvents: CalendarEventRow[];
  deadlines: CalendarDeadlineRow[];
  /** When false the column is read-only — chips don't drag and
   *  drop targets decline payloads. */
  canEdit: boolean;
};

export function WeekDayColumn({
  day,
  today,
  now,
  allDayEvents,
  timedEvents,
  deadlines,
  canEdit,
}: WeekDayColumnProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Snapped chip-top Y inside the hour grid while a drag is
  // hovering this column. Drives the preview line + time label.
  // Reset on dragleave / drop / when no drag is in flight.
  const [previewTopY, setPreviewTopY] = useState<number | null>(null);

  // Bar offset math — must match WeekView's previous logic so a
  // user toggling between editable / read-only sees the same
  // layout. Two-line all-day chips with matter linkage are taller.
  const topBarHeight =
    deadlines.length * 18 +
    allDayEvents.reduce((acc, e) => acc + (e.matterName ? 28 : 18), 0);

  const handleMove = async (
    eventId: string,
    schedule: { isAllDay: boolean; start: Date; end: Date }
  ): Promise<void> => {
    startTransition(async () => {
      const res = await moveCalendarEvent(eventId, {
        isAllDay: schedule.isAllDay,
        startTime: schedule.start.toISOString(),
        endTime: schedule.end.toISOString(),
      });
      if (!res.ok) {
        // Surface the server error inline. Toast system isn't
        // wired yet — alert is the simplest safety net so the
        // user knows the move didn't land.
        // eslint-disable-next-line no-alert
        alert(res.error ?? "Couldn't move event.");
      }
      // Revalidation in the action triggers a re-fetch; refresh
      // here ensures Next picks it up even if client-side
      // routing held a stale snapshot.
      router.refresh();
    });
  };

  // ── Drop: all-day bar ─────────────────────────────────────────────────
  const allDayDrop = useDropTarget<CalendarEventDragData>({
    kind: CALENDAR_EVENT_KIND,
    disabled: !canEdit,
    onDrop: (data) => {
      // Already all-day on this date? No-op — saves a round trip
      // when the user drops a chip back on its own bar.
      const droppedDate = startOfLocalDay(day);
      const originalStart = new Date(data.startTimeIso);
      if (
        data.isAllDay &&
        isSameDay(originalStart, droppedDate)
      ) {
        return;
      }
      handleMove(data.id, {
        isAllDay: true,
        start: droppedDate,
        end: droppedDate,
      });
    },
  });

  // ── Drop: hour grid ───────────────────────────────────────────────────
  //
  // Shared snap helper — used by both the drop handler (commits)
  // and the dragover preview (renders the line). Returns the
  // snapped chip-top in pixels relative to the grid's top edge,
  // plus the Date that pixel maps to and the matching minutes-
  // from-grid-start (handy for the time label).
  const computeSnap = (
    cursorYInGrid: number,
    data: CalendarEventDragData
  ): { topY: number; date: Date; minutesFromStart: number } => {
    const chipTopY = data.isAllDay
      ? cursorYInGrid
      : cursorYInGrid - data.grabOffsetY;
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
    return { topY, date, minutesFromStart: totalMinutes };
  };

  const hourGridDrop = useDropTarget<CalendarEventDragData>({
    kind: CALENDAR_EVENT_KIND,
    disabled: !canEdit,
    onDrop: (data, e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const cursorYInGrid = e.clientY - rect.top;
      const { date: newStart } = computeSnap(cursorYInGrid, data);

      // Duration: preserve when the source was timed; default to
      // 2 hours when the source was all-day (per spec).
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
      handleMove(data.id, { isAllDay: false, start: newStart, end: newEnd });
    },
  });

  // Wrap the hour-grid handlers with cursor-tracking so we can
  // render a "where it'll land" preview line. We keep the
  // counter-based isOver state from useDropTarget AND layer in
  // the per-pixel cursor position here.
  const hourGridHandlers = {
    ...hourGridDrop.handlers,
    onDragOver: (e: React.DragEvent) => {
      hourGridDrop.handlers.onDragOver(e);
      if (!canEdit) return;
      if (!hasKind(e, CALENDAR_EVENT_KIND)) return;
      const data = peekActiveDrag<CalendarEventDragData>(CALENDAR_EVENT_KIND);
      if (!data) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const cursorYInGrid = e.clientY - rect.top;
      const { topY } = computeSnap(cursorYInGrid, data);
      setPreviewTopY(topY);
    },
    onDragLeave: (e: React.DragEvent) => {
      hourGridDrop.handlers.onDragLeave(e);
      setPreviewTopY(null);
    },
    onDrop: (e: React.DragEvent) => {
      hourGridDrop.handlers.onDrop(e);
      setPreviewTopY(null);
    },
  };

  // Compute the preview's time label from previewTopY. We re-use
  // `computeSnap` shape via direct math here since we already have
  // a snapped Y. Read the active drag once for the duration so
  // the preview can also render an outline of the resulting chip.
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

    // Resulting chip height in px — duration preserved for timed,
    // 2h default for all-day.
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

  const weekend = isWeekend(day);
  const isToday = isSameDay(day, today);
  const nowTop = nowOffsetPx(now, day);

  return (
    <div
      className={cn(
        "border-l border-line relative",
        weekend && "bg-paper"
      )}
    >
      {/* Hour rows for grid lines */}
      {HOURS.map((h) => (
        <div
          key={h}
          className="border-b border-line"
          style={{ height: HOUR_HEIGHT_PX }}
        />
      ))}

      {/* Top bar — all-day events + deadlines + drop zone for
          all-day moves. Always rendered with at least a small
          height so the user has a target to drop on, even on
          days with no chips. */}
      <div
        {...allDayDrop.handlers}
        className={cn(
          "absolute top-0 left-1 right-1 flex flex-col gap-0.5 pt-0.5 z-10 rounded-sm transition-colors",
          allDayDrop.isOver && "ring-2 ring-brand-300 bg-brand-tint/40"
        )}
        style={{ minHeight: Math.max(topBarHeight, 16) }}
      >
        {allDayEvents.map((e) => (
          <DraggableAllDayChip key={e.id} event={e} canEdit={canEdit} />
        ))}
        {deadlines.map((d) => (
          <DeadlineChip key={d.id} deadline={d} />
        ))}
      </div>

      {/* Hour grid drop zone — sits over the hour rows below the
          bar. The drop handler reads cursor Y to pick the slot. */}
      <div
        {...hourGridHandlers}
        className={cn(
          "absolute left-0 right-0 z-0 transition-colors",
          hourGridDrop.isOver && "bg-brand-tint/30"
        )}
        style={{
          top: topBarHeight + 4,
          height: HOURS.length * HOUR_HEIGHT_PX - (topBarHeight + 4),
        }}
        aria-hidden="true"
      >
        {/* Live preview of where the chip will land. Only renders
            while a drag is hovering and a payload is active.
            The outlined block + the time label make the snap
            target obvious before the user releases. */}
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
      </div>

      {/* Timed events — same render as before, just draggable. */}
      {timedEvents.map((e) => (
        <DraggableEventBlock
          key={e.id}
          event={e}
          topOffset={topBarHeight + 4}
          canEdit={canEdit}
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

      {/* Today indicator dot — preserves the existing visual.
          The today-pill itself lives in the header row up in
          WeekView; this column doesn't render its own date
          label. */}
      {isToday && null}
    </div>
  );
}

// ── Chips (draggable) ───────────────────────────────────────────────────

function DraggableAllDayChip({
  event,
  canEdit,
}: {
  event: CalendarEventRow;
  canEdit: boolean;
}) {
  const content = (
    <>
      <div className="font-medium truncate">All day: {event.title}</div>
      {event.matterName && (
        <div className="font-mono text-ink-3 truncate leading-tight">
          {event.matterName}
        </div>
      )}
    </>
  );
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
      {content}
    </DraggableEventWrapper>
  );
}

function DraggableEventBlock({
  event,
  topOffset,
  canEdit,
}: {
  event: CalendarEventRow;
  topOffset: number;
  canEdit: boolean;
}) {
  const top = eventTopPx(event.startTime) + topOffset;
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
      // The hour-grid drop zone sits below this block visually,
      // but draggable elements need pointer events for the drag
      // to pick them up. Keep z-index above the drop zone.
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

/** Shared wrapper: navigates on click (?event=<id>) and, when
 *  `canDrag`, exposes the drag source. We don't use a Link here
 *  because anchor's default URL drag would compete with the
 *  payload we want to set. Cursor is `grab` in editable mode and
 *  `pointer` otherwise.
 *
 *  Payload is built lazily on dragstart so we can include the
 *  grab offset (cursor Y minus chip top at the moment of grab).
 *  The drop handler uses that offset to land the chip's TOP at
 *  the time slot the user is hovering over — otherwise grabbing
 *  a chip mid-way down would shift it up by however much was
 *  below the cursor, which is the bug everyone hits with naive
 *  HTML5 DnD. */
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

  // Read-only path: a normal Link still works fine and gets
  // browser-native focus + open-in-new-tab affordances.
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
    // Only navigate on a real click — drag operations should not
    // open the detail modal. The browser already suppresses click
    // when a drag occurred, but if a drag never started (the user
    // just clicked) we route here.
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
        // Cursor Y relative to the chip's top edge at the moment
        // of grab. We pass this through the payload so the drop
        // target can land the chip's top where it visually
        // appears, rather than where the cursor is.
        const rect = e.currentTarget.getBoundingClientRect();
        const grabOffsetY = e.clientY - rect.top;
        // Wipe any default drag content (e.g., the browser's
        // text-selection drag image) before our payload lands.
        e.dataTransfer.clearData();
        const payload = buildPayload(grabOffsetY);
        setDragPayload(e, payload);
        // Mirror into the active-drag registry so dragover
        // handlers (which can't read the dataTransfer JSON for
        // security reasons) can render a preview of where the
        // chip will land.
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
