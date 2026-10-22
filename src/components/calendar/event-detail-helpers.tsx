/**
 * Event Detail Modal — inline-editor state (the whole-row shape the
 * update action takes) and the small layout helpers shared by the
 * modal and its sections.
 */

import type { ReactNode } from "react";
import { formatDate, formatDateOnly, parseDateOnly, parseWallClock } from "@/lib/format-date";
import { dateOnly, toScheduleInput } from "@/lib/event-schedule";
import type { EditableAttendee } from "./attendee-picker";
import type { CalendarEventDetail } from "@/lib/queries/calendar";

// ── Editor state ────────────────────────────────────────────────────────

// `EditableAttendee` + the attendee list editor live in
// ./attendee-picker.tsx (shared with the standalone create form).

/** All fields the inline editor manages. Mirrors the action's
 *  schema: when a single field commits, we still build a full
 *  FormData from this state because the action is a whole-row
 *  update. */
export type EventEditState = {
  title: string;
  type: string;
  isAllDay: boolean;
  /** Always stored as datetime-local format ("YYYY-MM-DDTHH:mm")
   *  even when isAllDay (then "YYYY-MM-DDT00:00" — the date half
   *  is the date-only value) — FormData branches on the flag at
   *  submission time. Timed values are wall-clock in the user's
   *  profile zone. */
  startTime: string;
  endTime: string;
  location: string;
  zoomUrl: string;
  description: string;
  attendees: EditableAttendee[];
  /** Per-event visibility override. "default" applies the
   *  resolver's standard rules; "show_details" makes this event
   *  publicly visible in full. */
  visibility: string;
};

export const buildInitialState = (event: CalendarEventDetail, tz: string): EventEditState => ({
  title: event.title,
  type: event.type,
  isAllDay: event.isAllDay,
  startTime: toScheduleInput(event.startTime, event.isAllDay, tz),
  endTime: toScheduleInput(event.endTime, event.isAllDay, tz),
  location: event.location ?? "",
  zoomUrl: event.zoomUrl ?? "",
  description: event.description ?? "",
  visibility: event.visibility,
  attendees: event.attendees.map((a) => ({
    kind: a.userId ? "user" : a.contactId ? "contact" : "new",
    attendeeId: a.id,
    userId: a.userId,
    contactId: a.contactId,
    name: a.name,
    email: a.email ?? "",
    initials: a.userInitials,
    jobTitle: a.userJobTitle,
    contactType: a.contactType,
    status: a.status,
  })),
});

// ── Layout helpers ──────────────────────────────────────────────────────

export function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-ink-3 pt-0.5 shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

/** Date heading + range line for the read-only / collapsed time row.
 *  All-day boundaries are date-only (UTC read); timed ones are the
 *  committed wall-clock strings in `tz` converted back to instants so
 *  the output is the same on the server render and after hydration. */
export function describeSchedule(
  c: EventEditState,
  event: CalendarEventDetail,
  tz: string,
): { dateLabel: string; startsAndEnds: string } {
  if (c.isAllDay) {
    const start = parseDateOnly(dateOnly(c.startTime));
    const end = parseDateOnly(dateOnly(c.endTime));
    const multiDay = dateOnly(c.startTime) !== dateOnly(c.endTime);
    return {
      dateLabel: formatDateOnly(start, "full_long"),
      startsAndEnds:
        multiDay && end ? `All day · through ${formatDateOnly(end, "medium")}` : "All day",
    };
  }
  const start = parseWallClock(c.startTime, tz) ?? event.startTime;
  const end = parseWallClock(c.endTime, tz) ?? event.endTime;
  const sameDay = dateOnly(c.startTime) === dateOnly(c.endTime);
  return {
    dateLabel: formatDate(start, "full_long", tz),
    startsAndEnds: sameDay
      ? `${formatDate(start, "time", tz)} – ${formatDate(end, "time", tz)}`
      : `${formatDate(start, "datetime", tz)} – ${formatDate(end, "datetime", tz)}`,
  };
}
