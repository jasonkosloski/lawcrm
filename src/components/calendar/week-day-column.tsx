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
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { isSameDay } from "date-fns";
import { cn } from "@/lib/utils";
import {
  eventHeightPx,
  eventTopPx,
  HOUR_HEIGHT_PX,
  HOURS,
  isWeekend,
  layoutOverlappingEvents,
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
        // `min-w-0` is what keeps the cell honest to its `1fr`
        // grid track. Without it, grid items default to
        // `min-width: auto` — a long chip title would push this
        // cell wider than its share and visibly desync from the
        // hour-grid column directly below it.
        "border-l border-line p-1 flex flex-col gap-0.5 min-w-0 overflow-hidden transition-colors",
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
        // `min-w-0` mirrors the all-day cell — grid items in a
        // `1fr` track expand to their content's natural width by
        // default. Time columns happen to be safe today (their
        // children are absolute-positioned), but a future relative
        // child shouldn't break the column width silently.
        "border-l border-line relative min-w-0",
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
          own row above this column). Overlapping events split the
          column horizontally via `layoutOverlappingEvents`. */}
      {layoutOverlappingEvents(
        events.map((e) => ({ ...e, start: e.startTime, end: e.endTime }))
      ).map(({ event, lane, laneCount }) => (
        <DraggableEventBlock
          key={event.id}
          event={event}
          canEdit={canEdit}
          lane={lane}
          laneCount={laneCount}
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
  lane,
  laneCount,
}: {
  event: CalendarEventRow;
  canEdit: boolean;
  /** 0-indexed slot within the event's overlap cluster. */
  lane: number;
  /** Total slots in the event's overlap cluster. Drives the
   *  per-chip width = 1 / laneCount. */
  laneCount: number;
}) {
  const move = useMoveEvent();

  // Resize state — captures the original schedule + initial mouse
  // Y at mousedown so mousemove can compute the snapped delta.
  // Top edge drag changes start; bottom edge drag changes end.
  // Both snap to 15min and respect a 15min minimum duration.
  const [resizing, setResizing] = useState<null | {
    edge: "top" | "bottom";
    startMouseY: number;
    originalStart: Date;
    originalEnd: Date;
    /** Live preview — what the chip will commit on mouseup. */
    previewStart: Date;
    previewEnd: Date;
  }>(null);

  // Document-level mousemove + mouseup while a resize is active.
  // We attach to `document` (not the chip) so the drag keeps
  // tracking even when the cursor slides outside the chip's
  // bounds — which happens constantly when growing toward the
  // edges of the day column.
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) => {
      const deltaY = e.clientY - resizing.startMouseY;
      // Pixel delta → minute delta, snapped to 15. Same snap
      // resolution as the move drag for consistency.
      const deltaMinutes =
        Math.round((deltaY / HOUR_HEIGHT_PX) * 60 / 15) * 15;
      const minDurationMs = 15 * 60_000;

      if (resizing.edge === "top") {
        // Move start; clamp so duration stays >= 15min and the
        // start doesn't slide above the grid's first hour.
        const proposed = new Date(
          resizing.originalStart.getTime() + deltaMinutes * 60_000
        );
        const max = new Date(resizing.originalEnd.getTime() - minDurationMs);
        const next = clampDateAboveGrid(proposed, resizing.originalStart);
        const constrained = next.getTime() > max.getTime() ? max : next;
        setResizing({ ...resizing, previewStart: constrained });
      } else {
        const proposed = new Date(
          resizing.originalEnd.getTime() + deltaMinutes * 60_000
        );
        const min = new Date(resizing.originalStart.getTime() + minDurationMs);
        const next = clampDateBelowGrid(proposed, resizing.originalEnd);
        const constrained = next.getTime() < min.getTime() ? min : next;
        setResizing({ ...resizing, previewEnd: constrained });
      }
    };
    const onUp = () => {
      // Commit only if something changed. Same-time mouseup =
      // accidental click on the handle; no-op.
      const startChanged =
        resizing.previewStart.getTime() !== resizing.originalStart.getTime();
      const endChanged =
        resizing.previewEnd.getTime() !== resizing.originalEnd.getTime();
      if (startChanged || endChanged) {
        move(event.id, {
          isAllDay: false,
          start: resizing.previewStart,
          end: resizing.previewEnd,
        });
      }
      setResizing(null);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [resizing, event.id, move]);

  const startResize = (edge: "top" | "bottom") =>
    (e: React.MouseEvent) => {
      if (!canEdit) return;
      // Stop the chip's HTML5 drag from kicking in — the
      // wrapper is `draggable`, but mousedown on a handle should
      // initiate resize, not move.
      e.preventDefault();
      e.stopPropagation();
      setResizing({
        edge,
        startMouseY: e.clientY,
        originalStart: event.startTime,
        originalEnd: event.endTime,
        previewStart: event.startTime,
        previewEnd: event.endTime,
      });
    };

  // Display schedule = preview during resize, committed otherwise.
  const renderStart = resizing?.previewStart ?? event.startTime;
  const renderEnd = resizing?.previewEnd ?? event.endTime;

  const top = eventTopPx(renderStart);
  const height = eventHeightPx(renderStart, renderEnd);
  // Lane → horizontal position. We leave a hairline gap between
  // adjacent chips so the boundary reads cleanly. The first lane
  // starts at the column's left padding (4px); subsequent lanes
  // are offset by `lane * laneWidthPct%`.
  const laneWidthPct = 100 / laneCount;
  const leftPct = lane * laneWidthPct;
  const widthCss = `calc(${laneWidthPct}% - ${laneCount > 1 ? 6 : 8}px)`;
  const style: React.CSSProperties = {
    top,
    height,
    left: `calc(${leftPct}% + 4px)`,
    width: widthCss,
    background: `color-mix(in oklch, ${event.color} 16%, white)`,
    boxShadow: `inset 3px 0 0 0 ${event.color}`,
  };
  return (
    <DraggableEventWrapper
      eventId={event.id}
      canDrag={canEdit && !resizing}
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
      className={cn(
        "absolute px-1.5 py-1 rounded-sm overflow-hidden transition-shadow",
        // Drop the hover-shadow during a resize — the live
        // outline is feedback enough.
        !resizing &&
          "hover:shadow-[inset_3px_0_0_0,0_2px_6px_-2px_rgba(0,0,0,0.1)]",
        resizing && "shadow-[0_4px_12px_-2px_rgba(0,0,0,0.15)]"
      )}
      // Stays above the column's drop-zone background so the
      // drag pickup stays reliable.
      extraStyle={{ zIndex: resizing ? 20 : 5 }}
    >
      {/* Top resize handle — only when canEdit. The 6px strip
          gives a real click target without intruding on the
          chip body's text. Cursor switches to n-resize so the
          affordance is obvious on hover. */}
      {canEdit && (
        <div
          aria-label="Resize event start"
          onMouseDown={startResize("top")}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-brand-500/30 z-10"
        />
      )}

      <ChipBody event={event} renderHeight={height} />

      {/* Bottom resize handle */}
      {canEdit && (
        <div
          aria-label="Resize event end"
          onMouseDown={startResize("bottom")}
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-brand-500/30 z-10"
        />
      )}

      {/* Live time label during a resize — shows the user the
          exact start/end the chip will commit on release. Sits
          in the corner opposite the handle being dragged so it
          doesn't fight with the cursor. */}
      {resizing && (
        <div
          className={cn(
            "absolute right-1 text-3xs font-mono text-brand-700 bg-white/90 px-1 rounded shadow-sm pointer-events-none",
            resizing.edge === "top" ? "bottom-1" : "top-1"
          )}
          aria-live="polite"
        >
          {formatTimeShort(renderStart)} – {formatTimeShort(renderEnd)}
        </div>
      )}
    </DraggableEventWrapper>
  );
}

/** Format a Date as "9:00am" — used in the resize preview label. */
function formatTimeShort(d: Date): string {
  const h24 = d.getHours();
  const m = d.getMinutes();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const suffix = h24 < 12 ? "am" : "pm";
  return `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

/** Chip body — title plus secondary lines (time, location,
 *  attendees, matter) prioritized into the available vertical
 *  space. Lines are appended in priority order until the next
 *  one wouldn't fit; we never render a partial line.
 *
 *  Why explicit thresholds rather than CSS overflow-hidden:
 *  visual quality. A clipped half-line of "9:00am – 10:30am"
 *  reads as broken. Counting slots first guarantees every
 *  visible line is fully readable.
 *
 *  Approximate heights (kept conservative — better to skip a
 *  line than overflow):
 *    - chip y-padding (top + bottom):   8px
 *    - title (text-2xs leading-tight):  ~14px (1 line)
 *    - secondary line (text-3xs):       ~13px each
 */
function ChipBody({
  event,
  renderHeight,
}: {
  event: CalendarEventRow;
  renderHeight: number;
}) {
  // Build the priority-ordered list of secondary lines. Time
  // is the user's strongest "when" anchor (visual position is
  // approximate; the exact label removes ambiguity). Location
  // tells them where to be. Attendees: who. Matter: case
  // context (color already encodes it; the name is the
  // tiebreaker when two cases share a color).
  type Line = { key: string; render: () => React.ReactNode };
  const lines: Line[] = [];
  lines.push({
    key: "time",
    render: () => (
      <span className="text-3xs font-mono text-ink-3 truncate block">
        {formatTimeShort(event.startTime)} – {formatTimeShort(event.endTime)}
      </span>
    ),
  });
  if (event.location) {
    lines.push({
      key: "location",
      render: () => (
        <span className="text-3xs text-ink-3 truncate block">
          📍 {event.location}
        </span>
      ),
    });
  }
  if (event.attendeeCount > 0) {
    const names = event.attendeeNames;
    const extra = event.attendeeCount - names.length;
    lines.push({
      key: "attendees",
      render: () => (
        <span className="text-3xs text-ink-3 truncate block">
          👥 {names.join(", ")}
          {extra > 0 && ` +${extra} more`}
        </span>
      ),
    });
  }
  if (event.matterName) {
    lines.push({
      key: "matter",
      render: () => (
        <span className="text-3xs font-mono text-ink-3 truncate block">
          {event.matterName}
        </span>
      ),
    });
  }

  // Available secondary slots = (height - title - padding) / line height
  // The title itself uses ~14px; padding is 8px (py-1 each side).
  const TITLE_HEIGHT = 14;
  const PADDING = 8;
  const LINE_HEIGHT = 13;
  const availableSlots = Math.max(
    0,
    Math.floor((renderHeight - TITLE_HEIGHT - PADDING) / LINE_HEIGHT)
  );
  const visibleLines = lines.slice(0, availableSlots);

  return (
    <>
      <div className="text-2xs font-medium text-ink leading-tight truncate">
        {event.title}
      </div>
      {visibleLines.map((line) => (
        <div key={line.key} className="leading-tight mt-0.5">
          {line.render()}
        </div>
      ))}
    </>
  );
}

/** Clamp a Date to the grid's first hour boundary. Used when
 *  resizing the top edge so a top-drag past 6am stops at 6am. */
function clampDateAboveGrid(proposed: Date, fallback: Date): Date {
  const startHour = HOURS[0]!;
  const min = new Date(fallback);
  min.setHours(startHour, 0, 0, 0);
  return proposed.getTime() < min.getTime() ? min : proposed;
}

/** Clamp a Date to the grid's last hour boundary (HOURS[-1] + 1
 *  hour, exclusive). Used when resizing the bottom edge. */
function clampDateBelowGrid(proposed: Date, fallback: Date): Date {
  const endHour = HOURS[HOURS.length - 1]! + 1;
  const max = new Date(fallback);
  max.setHours(endHour, 0, 0, 0);
  return proposed.getTime() > max.getTime() ? max : proposed;
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
  const router = useRouter();
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
    // Soft client-side navigation — keeps the current page
    // rendered while Next preps the new searchParams snapshot.
    // The previous `window.location.href` was a hard reload
    // that fired the loading.tsx skeleton, producing a visible
    // flash of the wireframe state on every event click.
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
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
